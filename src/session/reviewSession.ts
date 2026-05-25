import * as vscode from 'vscode';
import { BaselineProvider, ChangedFileInfo } from '../baseline/baselineProvider';
import { GitBaselineProvider } from '../baseline/gitBaselineProvider';
import { SnapshotBaselineProvider } from '../baseline/snapshotBaselineProvider';
import {
  computeFileDiff,
  collapseAll,
  expandAll,
  expandGap,
  expandGapFully,
  collapseGap,
} from '../diff/diffEngine';
import { FileDiff } from '../diff/regionModel';
import { ExpansionStateManager } from './expansionState';
import { BaselineContentProvider, fromBaselineUri } from '../content/baselineContentProvider';
import { getConfig, readFileText, filePathKey } from '../utils/workspace';
import { debounce } from '../utils/debounce';

export class ReviewSession {
  private _gitProvider = new GitBaselineProvider();
  private _snapshotProvider: SnapshotBaselineProvider;
  private _provider: BaselineProvider = this._gitProvider;
  private _fileDiffs = new Map<string, FileDiff>();
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  private _currentRegionIndex = new Map<string, number>();
  private _currentFileIndex = 0;
  private _disposables: vscode.Disposable[] = [];
  private _debouncedRefresh: (() => void) & { cancel: () => void };

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly baselineContentProvider: BaselineContentProvider,
    readonly expansionState: ExpansionStateManager
  ) {
    this._snapshotProvider = new SnapshotBaselineProvider(context);
    this._debouncedRefresh = debounce(() => {
      void this.refreshAllDiffs();
    }, getConfig<number>('debounceMs', 300));

    this.updateProviderFromSettings();
  }

  get isActive(): boolean {
    return this._provider.isActive;
  }

  get baselineMode(): 'git' | 'snapshot' {
    return getConfig<'git' | 'snapshot'>('baselineMode', 'git');
  }

  getChangedFiles(): ChangedFileInfo[] {
    const files = this._provider.getChangedFiles();
    return files.map((f) => {
      const diff = this._fileDiffs.get(filePathKey(f.uri));
      if (!diff) {
        return f;
      }
      return {
        ...f,
        additions: diff.additions,
        deletions: diff.deletions,
      };
    });
  }

  getFileDiff(filePath: string): FileDiff | undefined {
    return this._fileDiffs.get(filePath);
  }

  getAllFileDiffs(): Map<string, FileDiff> {
    return this._fileDiffs;
  }

  async getBaselineContent(uri: vscode.Uri): Promise<string | undefined> {
    return this._provider.getBaselineContent(uri);
  }

  async initialize(): Promise<void> {
    await this._snapshotProvider.restoreSnapshot();

    if (this.baselineMode === 'snapshot') {
      this._provider = this._snapshotProvider;
      if (!this._snapshotProvider.isActive) {
        await this._snapshotProvider.start();
      }
    } else {
      this._provider = this._gitProvider;
      await this._gitProvider.start();
    }

    this.baselineContentProvider.setContentResolver((uri) =>
      this._provider.getBaselineContent(fromBaselineUri(uri))
    );

    this._disposables.push(
      this._gitProvider.onDidChange(() => {
        if (this._provider === this._gitProvider) {
          void this.refreshAllDiffs();
        }
      }),
      this._snapshotProvider.onDidChange(() => {
        if (this._provider === this._snapshotProvider) {
          void this.refreshAllDiffs();
        }
      }),
      vscode.workspace.onDidChangeTextDocument((e) => {
        const key = filePathKey(e.document.uri);
        if (this._fileDiffs.has(key)) {
          this._debouncedRefresh();
        }
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('reviewAgent')) {
          this.updateProviderFromSettings();
          void this.refreshAllDiffs();
        }
      })
    );

    await this.refreshAllDiffs();
    this.updateContextKeys();
  }

  async startReview(): Promise<void> {
    const mode = getConfig<'git' | 'snapshot'>('baselineMode', 'git');
    if (mode === 'snapshot') {
      if (this._gitProvider.isActive) {
        await this._gitProvider.stop();
      }
      this._provider = this._snapshotProvider;
      await this._snapshotProvider.start();
    } else {
      if (this._snapshotProvider.isActive) {
        await this._snapshotProvider.stop();
      }
      this._provider = this._gitProvider;
      await this._gitProvider.start();
    }
    await this.refreshAllDiffs();
    this.updateContextKeys();
  }

  async stopReview(): Promise<void> {
    await this._provider.stop();
    this.updateContextKeys();
    this._onDidChange.fire();
  }

  async clearReview(): Promise<void> {
    await this._provider.clear();
    this._fileDiffs.clear();
    this.expansionState.clearAll();
    this.baselineContentProvider.invalidateAll();
    this.updateContextKeys();
    this._onDidChange.fire();
  }

  async refresh(): Promise<void> {
    await this._provider.refresh();
    await this.refreshAllDiffs();
  }

  scheduleRefresh(): void {
    this._debouncedRefresh();
  }

  async refreshAllDiffs(): Promise<void> {
    const files = this._provider.getChangedFiles();
    this._fileDiffs.clear();

    const contextLines = getConfig<number>('contextLines', 3);
    const collapseThreshold = getConfig<number>('collapseThreshold', 8);

    for (const file of files) {
      if (file.status === 'deleted') {
        continue;
      }
      const key = filePathKey(file.uri);
      const current = await readFileText(file.uri);
      if (current === undefined) {
        continue;
      }
      const baseline = (await this._provider.getBaselineContent(file.uri)) ?? '';
      const gapExpansions = this.expansionState.getGapExpansionsForFile(key);

      let fileDiff = computeFileDiff(key, baseline, current, {
        contextLines,
        collapseThreshold,
        gapExpansions,
      });

      if (this.expansionState.isFullyExpanded(key)) {
        fileDiff = expandAll(fileDiff);
      } else if (this.expansionState.isFullyCollapsed(key)) {
        fileDiff = collapseAll(fileDiff, contextLines);
      } else {
        fileDiff = {
          ...fileDiff,
          gaps: this.expansionState.applyToGaps(key, fileDiff.gaps),
        };
      }

      this._fileDiffs.set(key, fileDiff);
      this.baselineContentProvider.invalidate(
        vscode.Uri.from({ scheme: 'redline-baseline', path: vscode.Uri.file(key).path })
      );
    }

    this.updateContextKeys();
    this._onDidChange.fire();
  }

  async openFile(uri: vscode.Uri, mode?: 'inline' | 'sideBySide'): Promise<void> {
    const openMode = mode ?? getConfig<'inline' | 'sideBySide'>('defaultOpenMode', 'inline');
    if (openMode === 'sideBySide') {
      await vscode.commands.executeCommand('reviewAgent.openSideBySide', uri);
    } else {
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: false });
    }
  }

  handleExpandGap(gapId: string, filePath: string): void {
    const diff = this._fileDiffs.get(filePath);
    if (!diff) {
      return;
    }
    const step = getConfig<number>('expandStepLines', 20);
    const updated = expandGap(diff, gapId, step);
    const gap = updated.gaps.find((g) => g.id === gapId);
    if (gap) {
      this.expansionState.setGapExpansion(filePath, gapId, gap.expandedLines);
    }
    this._fileDiffs.set(filePath, updated);
    this._onDidChange.fire();
  }

  handleExpandGapAll(gapId: string, filePath: string): void {
    const diff = this._fileDiffs.get(filePath);
    if (!diff) {
      return;
    }
    const updated = expandGapFully(diff, gapId);
    const gap = updated.gaps.find((g) => g.id === gapId);
    if (gap) {
      this.expansionState.setGapExpansion(filePath, gapId, gap.expandedLines);
    }
    this._fileDiffs.set(filePath, updated);
    this._onDidChange.fire();
  }

  handleCollapseGap(gapId: string, filePath: string): void {
    const diff = this._fileDiffs.get(filePath);
    if (!diff) {
      return;
    }
    const contextLines = getConfig<number>('contextLines', 3);
    const updated = collapseGap(diff, gapId, contextLines);
    this.expansionState.setGapExpansion(filePath, gapId, 0);
    this._fileDiffs.set(filePath, updated);
    this._onDidChange.fire();
  }

  handleCollapseAll(filePath: string): void {
    const diff = this._fileDiffs.get(filePath);
    if (!diff) {
      return;
    }
    const contextLines = getConfig<number>('contextLines', 3);
    this.expansionState.setFileMode(filePath, 'collapsed');
    this._fileDiffs.set(filePath, collapseAll(diff, contextLines));
    this._onDidChange.fire();
  }

  handleExpandAll(filePath: string): void {
    const diff = this._fileDiffs.get(filePath);
    if (!diff) {
      return;
    }
    this.expansionState.setFileMode(filePath, 'expanded');
    this._fileDiffs.set(filePath, expandAll(diff));
    this._onDidChange.fire();
  }

  getChangedFileUris(): vscode.Uri[] {
    return this.getChangedFiles()
      .filter((f) => f.status !== 'deleted')
      .map((f) => f.uri);
  }

  async navigateNextChange(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      await this.navigateNextFile();
      return;
    }
    const key = filePathKey(editor.document.uri);
    const diff = this._fileDiffs.get(key);
    if (!diff || diff.regions.length === 0) {
      await this.navigateNextFile();
      return;
    }

    const currentLine = editor.selection.active.line + 1;
    const next = diff.regions.find((r) => r.startLine > currentLine);
    if (next) {
      const idx = diff.regions.indexOf(next);
      this._currentRegionIndex.set(key, idx);
      await this.revealRegion(editor, next.startLine);
    } else {
      await this.navigateNextFile();
    }
  }

  async navigatePrevChange(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      await this.navigatePrevFile();
      return;
    }
    const key = filePathKey(editor.document.uri);
    const diff = this._fileDiffs.get(key);
    if (!diff || diff.regions.length === 0) {
      await this.navigatePrevFile();
      return;
    }

    const currentLine = editor.selection.active.line + 1;
    const prev = [...diff.regions].reverse().find((r) => r.endLine < currentLine);
    if (prev) {
      const idx = diff.regions.indexOf(prev);
      this._currentRegionIndex.set(key, idx);
      await this.revealRegion(editor, prev.startLine);
    } else {
      await this.navigatePrevFile();
    }
  }

  async navigateNextFile(): Promise<void> {
    const uris = this.getChangedFileUris();
    if (uris.length === 0) {
      return;
    }
    const editor = vscode.window.activeTextEditor;
    let idx = 0;
    if (editor) {
      const currentIdx = uris.findIndex((u) => u.fsPath === editor.document.uri.fsPath);
      idx = currentIdx >= 0 ? (currentIdx + 1) % uris.length : 0;
    }
    this._currentFileIndex = idx;
    await this.openFile(uris[idx]);
    const newEditor = vscode.window.activeTextEditor;
    if (newEditor) {
      const diff = this._fileDiffs.get(filePathKey(uris[idx]));
      if (diff?.regions[0]) {
        await this.revealRegion(newEditor, diff.regions[0].startLine);
      }
    }
  }

  async navigatePrevFile(): Promise<void> {
    const uris = this.getChangedFileUris();
    if (uris.length === 0) {
      return;
    }
    const editor = vscode.window.activeTextEditor;
    let idx = uris.length - 1;
    if (editor) {
      const currentIdx = uris.findIndex((u) => u.fsPath === editor.document.uri.fsPath);
      idx = currentIdx >= 0 ? (currentIdx - 1 + uris.length) % uris.length : 0;
    }
    this._currentFileIndex = idx;
    await this.openFile(uris[idx]);
    const newEditor = vscode.window.activeTextEditor;
    if (newEditor) {
      const diff = this._fileDiffs.get(filePathKey(uris[idx]));
      if (diff?.regions[0]) {
        await this.revealRegion(newEditor, diff.regions[0].startLine);
      }
    }
  }

  getChangeCounter(filePath: string): string {
    const diff = this._fileDiffs.get(filePath);
    if (!diff || diff.regions.length === 0) {
      return '';
    }
    const idx = this._currentRegionIndex.get(filePath) ?? 0;
    return `${idx + 1}/${diff.regions.length}`;
  }

  hasActiveFileDiff(): boolean {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return false;
    }
    return this._fileDiffs.has(filePathKey(editor.document.uri));
  }

  private async revealRegion(editor: vscode.TextEditor, line: number): Promise<void> {
    const pos = new vscode.Position(line - 1, 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
  }

  private updateProviderFromSettings(): void {
    const mode = getConfig<'git' | 'snapshot'>('baselineMode', 'git');
    if (mode === 'snapshot') {
      this._provider = this._snapshotProvider;
      if (!this._snapshotProvider.isActive) {
        void this._snapshotProvider.start().then(() => this.refreshAllDiffs());
      }
    } else {
      this._provider = this._gitProvider;
      if (!this._gitProvider.isActive) {
        void this._gitProvider.start().then(() => this.refreshAllDiffs());
      }
    }
  }

  private updateContextKeys(): void {
    void vscode.commands.executeCommand('setContext', 'reviewAgent.isReviewing', true);
    void vscode.commands.executeCommand(
      'setContext',
      'reviewAgent.hasActiveFile',
      this.hasActiveFileDiff()
    );
  }

  onActiveEditorChanged(): void {
    this.updateContextKeys();
  }

  dispose(): void {
    this._debouncedRefresh.cancel();
    for (const d of this._disposables) {
      d.dispose();
    }
    this._onDidChange.dispose();
  }
}
