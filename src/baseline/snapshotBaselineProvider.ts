import * as vscode from 'vscode';
import * as path from 'path';
import { BaselineProvider, ChangedFileInfo } from './baselineProvider';
import {
  getConfig,
  getWorkspaceFolders,
  readFileText,
  toRelativePath,
} from '../utils/workspace';
import { getIgnorePatterns, isLikelyBinary, matchesIgnore } from '../utils/ignore';

const SNAPSHOT_KEY = 'reviewAgent.snapshot.v1';
const SNAPSHOT_ACTIVE_KEY = 'reviewAgent.snapshotActive';

interface SnapshotEntry {
  relativePath: string;
  workspaceRoot: string;
  content: string;
}

export class SnapshotBaselineProvider implements BaselineProvider {
  readonly mode = 'snapshot' as const;
  private _active = false;

  private _snapshot = new Map<string, SnapshotEntry>();
  private _watchers: vscode.FileSystemWatcher[] = [];
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;
  private _debounceTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly context?: vscode.ExtensionContext) {}

  get isActive(): boolean {
    return this._active;
  }

  async start(): Promise<void> {
    if (this._active) {
      return;
    }
    this._active = true;
    await this.captureSnapshot();
    this.startWatcher();
    this._onDidChange.fire();
  }

  async stop(): Promise<void> {
    this._active = false;
    this.stopWatcher();
    this._onDidChange.fire();
  }

  async clear(): Promise<void> {
    this._active = false;
    this._snapshot.clear();
    this.stopWatcher();
    await this.persistSnapshot();
    this._onDidChange.fire();
  }

  async refresh(): Promise<void> {
    this._onDidChange.fire();
  }

  getChangedFiles(): ChangedFileInfo[] {
    if (!this._active) {
      return [];
    }

    const results: ChangedFileInfo[] = [];

    for (const [key, entry] of this._snapshot) {
      const uri = vscode.Uri.file(path.join(entry.workspaceRoot, entry.relativePath));
      const current = this._cachedCurrent.get(key);
      if (current === undefined) {
        continue;
      }
      if (current !== entry.content) {
        const stats = countLineDiff(entry.content, current);
        results.push({
          uri,
          relativePath: entry.relativePath,
          status: 'modified',
          additions: stats.additions,
          deletions: stats.deletions,
        });
      }
    }

    for (const [key, content] of this._newFiles) {
      const uri = vscode.Uri.file(key);
      results.push({
        uri,
        relativePath: toRelativePath(uri),
        status: 'added',
        additions: content.split('\n').length,
        deletions: 0,
      });
    }

    for (const key of this._deletedFiles) {
      const entry = this._snapshot.get(key);
      if (!entry) {
        continue;
      }
      const uri = vscode.Uri.file(path.join(entry.workspaceRoot, entry.relativePath));
      results.push({
        uri,
        relativePath: entry.relativePath,
        status: 'deleted',
        additions: 0,
        deletions: entry.content.split('\n').length,
      });
    }

    return results;
  }

  async getBaselineContent(uri: vscode.Uri): Promise<string | undefined> {
    const key = uri.fsPath;
    const entry = this._snapshot.get(key);
    if (entry) {
      return entry.content;
    }
    const altKey = this.findSnapshotKey(uri);
    if (altKey) {
      return this._snapshot.get(altKey)?.content;
    }
    return '';
  }

  private _cachedCurrent = new Map<string, string>();
  private _newFiles = new Map<string, string>();
  private _deletedFiles = new Set<string>();

  private async captureSnapshot(): Promise<void> {
    this._snapshot.clear();
    this._cachedCurrent.clear();
    this._newFiles.clear();
    this._deletedFiles.clear();

    const ignore = getIgnorePatterns(getConfig<string[]>('watchExclude', []));
    const maxBytes = getConfig<number>('maxFileSizeMb', 5) * 1024 * 1024;

    for (const folder of getWorkspaceFolders()) {
      await this.walkFolder(folder.uri, folder.uri.fsPath, ignore, maxBytes);
    }

    await this.persistSnapshot();
    await this.updateCurrentContents();
  }

  private async walkFolder(
    rootUri: vscode.Uri,
    workspaceRoot: string,
    ignore: string[],
    maxBytes: number
  ): Promise<void> {
    const entries = await vscode.workspace.fs.readDirectory(rootUri);

    for (const [name, type] of entries) {
      const relativePath = path.relative(workspaceRoot, path.join(rootUri.fsPath, name)).replace(/\\/g, '/');
      if (matchesIgnore(relativePath, ignore)) {
        continue;
      }

      const uri = vscode.Uri.joinPath(rootUri, name);

      if (type === vscode.FileType.Directory) {
        await this.walkFolder(uri, workspaceRoot, ignore, maxBytes);
      } else if (type === vscode.FileType.File) {
        try {
          const bytes = await vscode.workspace.fs.readFile(uri);
          if (bytes.byteLength > maxBytes || isLikelyBinary(Buffer.from(bytes))) {
            continue;
          }
          const content = Buffer.from(bytes).toString('utf8');
          this._snapshot.set(uri.fsPath, {
            relativePath,
            workspaceRoot,
            content,
          });
        } catch {
          // skip unreadable files
        }
      }
    }
  }

  private startWatcher(): void {
    this.stopWatcher();
    const schedule = () => {
      if (this._debounceTimer) {
        clearTimeout(this._debounceTimer);
      }
      this._debounceTimer = setTimeout(() => {
        void this.updateCurrentContents().then(() => this._onDidChange.fire());
      }, getConfig<number>('debounceMs', 300));
    };

    for (const folder of getWorkspaceFolders()) {
      const pattern = new vscode.RelativePattern(folder, '**/*');
      const watcher = vscode.workspace.createFileSystemWatcher(pattern);
      watcher.onDidChange(schedule);
      watcher.onDidCreate(schedule);
      watcher.onDidDelete(schedule);
      this._watchers.push(watcher);
    }
  }

  private stopWatcher(): void {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = undefined;
    }
    for (const w of this._watchers) {
      w.dispose();
    }
    this._watchers = [];
  }

  private async updateCurrentContents(): Promise<void> {
    this._cachedCurrent.clear();
    this._newFiles.clear();
    this._deletedFiles.clear();

    for (const [key, entry] of this._snapshot) {
      const uri = vscode.Uri.file(key);
      const current = await readFileText(uri);
      if (current === undefined) {
        this._deletedFiles.add(key);
      } else {
        this._cachedCurrent.set(key, current);
      }
    }

    const ignore = getIgnorePatterns(getConfig<string[]>('watchExclude', []));
    for (const folder of getWorkspaceFolders()) {
      await this.detectNewFiles(folder.uri, folder.uri.fsPath, ignore);
    }
  }

  private async detectNewFiles(
    rootUri: vscode.Uri,
    workspaceRoot: string,
    ignore: string[]
  ): Promise<void> {
    const entries = await vscode.workspace.fs.readDirectory(rootUri);
    for (const [name, type] of entries) {
      const relativePath = path.relative(workspaceRoot, path.join(rootUri.fsPath, name)).replace(/\\/g, '/');
      if (matchesIgnore(relativePath, ignore)) {
        continue;
      }
      const uri = vscode.Uri.joinPath(rootUri, name);
      if (type === vscode.FileType.Directory) {
        await this.detectNewFiles(uri, workspaceRoot, ignore);
      } else if (!this._snapshot.has(uri.fsPath)) {
        const content = await readFileText(uri);
        if (content !== undefined) {
          this._newFiles.set(uri.fsPath, content);
        }
      }
    }
  }

  private findSnapshotKey(uri: vscode.Uri): string | undefined {
    for (const key of this._snapshot.keys()) {
      if (key === uri.fsPath) {
        return key;
      }
    }
    return undefined;
  }

  private async persistSnapshot(): Promise<void> {
    if (!this.context) {
      return;
    }
    const data = Object.fromEntries(this._snapshot);
    await this.context.workspaceState.update(SNAPSHOT_KEY, data);
    await this.context.workspaceState.update(SNAPSHOT_ACTIVE_KEY, this._active);
  }

  async restoreSnapshot(): Promise<void> {
    if (!this.context) {
      return;
    }
    const stored = this.context.workspaceState.get<Record<string, SnapshotEntry>>(SNAPSHOT_KEY);
    const wasActive = this.context.workspaceState.get<boolean>(SNAPSHOT_ACTIVE_KEY, false);
    if (stored) {
      this._snapshot = new Map(Object.entries(stored));
      this._active = wasActive && this._snapshot.size > 0;
      if (this._active) {
        this.startWatcher();
        await this.updateCurrentContents();
      }
    }
  }
}

function countLineDiff(oldText: string, newText: string): { additions: number; deletions: number } {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  let additions = 0;
  let deletions = 0;
  const max = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < max; i++) {
    if (oldLines[i] === undefined) {
      additions++;
    } else if (newLines[i] === undefined) {
      deletions++;
    } else if (oldLines[i] !== newLines[i]) {
      additions++;
      deletions++;
    }
  }
  return { additions, deletions };
}
