import * as vscode from 'vscode';
import { CollapsedGap } from '../diff/regionModel';

const EXPANSION_KEY = 'reviewAgent.expansionState';

interface FileExpansionState {
  gaps: Record<string, number>;
  collapsedAll?: boolean;
  expandedAll?: boolean;
}

type ExpansionStore = Record<string, FileExpansionState>;

export class ExpansionStateManager {
  private _store: ExpansionStore = {};

  constructor(private readonly context: vscode.ExtensionContext) {
    this.load();
  }

  getGapExpansion(filePath: string, gapId: string): number {
    return this._store[filePath]?.gaps[gapId] ?? 0;
  }

  getGapExpansionsForFile(filePath: string): Map<string, number> {
    const gaps = this._store[filePath]?.gaps ?? {};
    return new Map(Object.entries(gaps));
  }

  setGapExpansion(filePath: string, gapId: string, expandedLines: number): void {
    if (!this._store[filePath]) {
      this._store[filePath] = { gaps: {} };
    }
    this._store[filePath].gaps[gapId] = expandedLines;
    void this.persist();
  }

  applyToGaps(filePath: string, gaps: CollapsedGap[]): CollapsedGap[] {
    const saved = this._store[filePath];
    if (!saved) {
      return gaps;
    }
    return gaps.map((g) => ({
      ...g,
      expandedLines: saved.gaps[g.id] ?? g.expandedLines,
    }));
  }

  clearFile(filePath: string): void {
    delete this._store[filePath];
    void this.persist();
  }

  clearAll(): void {
    this._store = {};
    void this.persist();
  }

  setFileMode(filePath: string, mode: 'collapsed' | 'expanded'): void {
    if (!this._store[filePath]) {
      this._store[filePath] = { gaps: {} };
    }
    if (mode === 'collapsed') {
      this._store[filePath].collapsedAll = true;
      this._store[filePath].expandedAll = false;
      this._store[filePath].gaps = {};
    } else {
      this._store[filePath].expandedAll = true;
      this._store[filePath].collapsedAll = false;
    }
    void this.persist();
  }

  isFullyExpanded(filePath: string): boolean {
    return this._store[filePath]?.expandedAll ?? false;
  }

  isFullyCollapsed(filePath: string): boolean {
    return this._store[filePath]?.collapsedAll ?? false;
  }

  private load(): void {
    this._store = this.context.workspaceState.get<ExpansionStore>(EXPANSION_KEY, {});
  }

  private async persist(): Promise<void> {
    await this.context.workspaceState.update(EXPANSION_KEY, this._store);
  }
}
