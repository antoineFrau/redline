import * as vscode from 'vscode';
import { ReviewSession } from '../session/reviewSession';
import { ChangedFileInfo } from '../baseline/baselineProvider';
import { getWorkspaceFolders } from '../utils/workspace';

type TreeItem = OpenAllItem | RootItem | FileItem;

class OpenAllItem extends vscode.TreeItem {
  constructor(fileCount: number) {
    super('Open All Changes', vscode.TreeItemCollapsibleState.None);
    this.description = `${fileCount} ${fileCount === 1 ? 'file' : 'files'}`;
    this.tooltip = 'Open all changed files in one scrollable diff tab';
    this.contextValue = 'openAllChanges';
    this.iconPath = new vscode.ThemeIcon('diff-multiple');
    this.command = {
      command: 'reviewAgent.openAllChanges',
      title: 'Open All Changes',
    };
  }
}

class RootItem extends vscode.TreeItem {
  constructor(public readonly folder: vscode.WorkspaceFolder, fileCount: number) {
    super(folder.name, vscode.TreeItemCollapsibleState.Expanded);
    this.description = `${fileCount} changed`;
    this.contextValue = 'rootFolder';
  }
}

class FileItem extends vscode.TreeItem {
  constructor(public readonly file: ChangedFileInfo) {
    const label = file.relativePath.split('/').pop() ?? file.relativePath;
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = formatStats(file);
    this.tooltip = file.relativePath;
    this.resourceUri = file.uri;
    this.contextValue = 'changedFile';
    this.command = {
      command: 'reviewAgent.openInline',
      title: 'Open',
      arguments: [file.uri],
    };

    const iconMap: Record<ChangedFileInfo['status'], string> = {
      modified: 'file',
      added: 'file-add',
      deleted: 'trash',
      renamed: 'file-submodule',
    };
    this.iconPath = new vscode.ThemeIcon(iconMap[file.status]);
  }
}

function formatStats(file: ChangedFileInfo): string {
  const parts: string[] = [];
  if (file.additions > 0) {
    parts.push(`+${file.additions}`);
  }
  if (file.deletions > 0) {
    parts.push(`-${file.deletions}`);
  }
  if (parts.length === 0) {
    return file.status;
  }
  return parts.join(' ');
}

export class ChangedFilesTreeProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly session: ReviewSession) {
    session.onDidChange(() => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
    this.updateBadge();
  }

  getTreeItem(element: TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeItem): TreeItem[] {
    const files = this.session.getChangedFiles().map((f) => {
      const diff = this.session.getFileDiff(f.uri.fsPath);
      if (diff) {
        return { ...f, additions: diff.additions, deletions: diff.deletions };
      }
      return f;
    });

    if (!element) {
      const items: TreeItem[] = [];
      if (files.length > 0) {
        items.push(new OpenAllItem(files.length));
      }

      const folders = getWorkspaceFolders();
      if (folders.length <= 1) {
        return [...items, ...files.map((f) => new FileItem(f))];
      }
      return [
        ...items,
        ...folders
          .map((folder) => {
            const folderFiles = files.filter((f) =>
              f.uri.fsPath.startsWith(folder.uri.fsPath)
            );
            if (folderFiles.length === 0) {
              return undefined;
            }
            return new RootItem(folder, folderFiles.length);
          })
          .filter((x): x is RootItem => x !== undefined),
      ];
    }

    if (element instanceof RootItem) {
      return this.session
        .getChangedFiles()
        .filter((f) => f.uri.fsPath.startsWith(element.folder.uri.fsPath))
        .map((f) => new FileItem(f));
    }

    return [];
  }

  private updateBadge(): void {
    const count = this.session.getChangedFiles().length;
    void vscode.commands.executeCommand('setContext', 'reviewAgent.changedFileCount', count);
  }
}

export function registerChangedFilesTree(
  context: vscode.ExtensionContext,
  session: ReviewSession
): ChangedFilesTreeProvider {
  const provider = new ChangedFilesTreeProvider(session);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('reviewAgent.changedFiles', provider)
  );
  return provider;
}
