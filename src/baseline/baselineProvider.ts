import * as vscode from 'vscode';

export interface ChangedFileInfo {
  uri: vscode.Uri;
  relativePath: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
}

export interface BaselineProvider {
  readonly mode: 'git' | 'snapshot';
  readonly isActive: boolean;

  start(): Promise<void>;
  stop(): Promise<void>;
  clear(): Promise<void>;
  refresh(): Promise<void>;

  getChangedFiles(): ChangedFileInfo[];
  getBaselineContent(uri: vscode.Uri): Promise<string | undefined>;
  onDidChange: vscode.Event<void>;
}
