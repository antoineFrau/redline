import * as vscode from 'vscode';
import { BaselineProvider, ChangedFileInfo } from './baselineProvider';
import { getConfig, toRelativePath } from '../utils/workspace';

interface GitExtension {
  getAPI(version: number): GitAPI;
}

interface GitAPI {
  repositories: Repository[];
  onDidOpenRepository: vscode.Event<Repository>;
  onDidCloseRepository: vscode.Event<Repository>;
}

interface Repository {
  rootUri: vscode.Uri;
  state: RepositoryState;
  show(ref: string, path: string): Promise<string | undefined>;
  diffWithHEAD(): Promise<GitChange[]>;
  diffIndexWithHEAD(): Promise<GitChange[]>;
}

interface RepositoryState {
  workingTreeChanges: GitChange[];
  indexChanges: GitChange[];
  onDidChange: vscode.Event<void>;
}

interface GitChange {
  uri: vscode.Uri;
  originalUri?: vscode.Uri;
  renameUri?: vscode.Uri;
  status: number;
}

/** Matches @vscode/git Status enum ordinals */
const Status = {
  INDEX_MODIFIED: 0,
  INDEX_ADDED: 1,
  INDEX_DELETED: 2,
  INDEX_RENAMED: 3,
  INDEX_COPIED: 4,
  MODIFIED: 5,
  DELETED: 6,
  UNTRACKED: 7,
  IGNORED: 8,
  RENAMED: 14,
  COPIED: 15,
} as const;

export class GitBaselineProvider implements BaselineProvider {
  readonly mode = 'git' as const;
  private _active = false;
  private _disposables: vscode.Disposable[] = [];
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  private _gitApi: GitAPI | undefined;
  private _repos: Repository[] = [];

  get isActive(): boolean {
    return this._active;
  }

  async start(): Promise<void> {
    if (this._active) {
      return;
    }
    this._active = true;
    await this.initGit();
    this._onDidChange.fire();
  }

  async stop(): Promise<void> {
    this._active = false;
    this.disposeListeners();
    this._onDidChange.fire();
  }

  async clear(): Promise<void> {
    await this.stop();
  }

  async refresh(): Promise<void> {
    if (!this._active) {
      return;
    }
    await this.initGit();
    this._onDidChange.fire();
  }

  getChangedFiles(): ChangedFileInfo[] {
    if (!this._active || !this._gitApi) {
      return [];
    }

    const compare = getConfig<'workingTreeVsHead' | 'workingTreeVsIndex'>(
      'gitCompare',
      'workingTreeVsHead'
    );
    const results: ChangedFileInfo[] = [];
    const seen = new Set<string>();

    for (const repo of this._repos) {
      const changes =
        compare === 'workingTreeVsIndex'
          ? [...repo.state.workingTreeChanges]
          : mergeChanges(repo.state.indexChanges, repo.state.workingTreeChanges);

      for (const change of changes) {
        const uri = change.uri;
        const key = uri.fsPath;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);

        results.push({
          uri,
          relativePath: toRelativePath(uri),
          status: mapStatus(change.status),
          additions: 0,
          deletions: 0,
        });
      }
    }

    return results;
  }

  async getBaselineContent(uri: vscode.Uri): Promise<string | undefined> {
    const repo = this.findRepo(uri);
    if (!repo) {
      return undefined;
    }

    const compare = getConfig<'workingTreeVsHead' | 'workingTreeVsIndex'>(
      'gitCompare',
      'workingTreeVsHead'
    );
    const relativePath = vscode.workspace.asRelativePath(uri, false);

    try {
      if (compare === 'workingTreeVsIndex') {
        return (await repo.show(':', relativePath)) ?? '';
      }
      return (await repo.show('HEAD', relativePath)) ?? '';
    } catch {
      return compare === 'workingTreeVsHead' ? '' : undefined;
    }
  }

  private async initGit(): Promise<void> {
    this.disposeListeners();

    const ext = vscode.extensions.getExtension<GitExtension>('vscode.git');
    if (!ext) {
      vscode.window.showWarningMessage(
        'Redline: Git extension not available. Switch to snapshot mode or install Git support.'
      );
      return;
    }

    const gitExt = ext.isActive ? ext.exports : await ext.activate();
    this._gitApi = gitExt.getAPI(1);
    this._repos = [...this._gitApi.repositories];

    this._disposables.push(
      this._gitApi.onDidOpenRepository((repo) => {
        this._repos.push(repo);
        this.attachRepo(repo);
        this._onDidChange.fire();
      }),
      this._gitApi.onDidCloseRepository((repo) => {
        this._repos = this._repos.filter((r) => r.rootUri.fsPath !== repo.rootUri.fsPath);
        this._onDidChange.fire();
      })
    );

    for (const repo of this._repos) {
      this.attachRepo(repo);
    }
  }

  private attachRepo(repo: Repository): void {
    this._disposables.push(
      repo.state.onDidChange(() => {
        if (this._active) {
          this._onDidChange.fire();
        }
      })
    );
  }

  private findRepo(uri: vscode.Uri): Repository | undefined {
    return this._repos.find((r) => uri.fsPath.startsWith(r.rootUri.fsPath));
  }

  private disposeListeners(): void {
    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables = [];
  }
}

function mergeChanges(indexChanges: GitChange[], workingTreeChanges: GitChange[]): GitChange[] {
  const byPath = new Map<string, GitChange>();
  for (const c of indexChanges) {
    byPath.set(c.uri.fsPath, c);
  }
  for (const c of workingTreeChanges) {
    byPath.set(c.uri.fsPath, c);
  }
  return [...byPath.values()];
}

function mapStatus(status: number): ChangedFileInfo['status'] {
  if (status === Status.DELETED || status === Status.INDEX_DELETED) {
    return 'deleted';
  }
  if (status === Status.RENAMED || status === Status.INDEX_RENAMED) {
    return 'renamed';
  }
  if (status === Status.INDEX_ADDED || status === Status.UNTRACKED) {
    return 'added';
  }
  return 'modified';
}
