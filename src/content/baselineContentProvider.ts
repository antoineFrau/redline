import * as vscode from 'vscode';

export const BASELINE_SCHEME = 'redline-baseline';

export class BaselineContentProvider implements vscode.TextDocumentContentProvider {
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  private _contentResolver: ((uri: vscode.Uri) => Promise<string | undefined>) | undefined;

  setContentResolver(resolver: (uri: vscode.Uri) => Promise<string | undefined>): void {
    this._contentResolver = resolver;
  }

  invalidate(uri: vscode.Uri): void {
    this._onDidChange.fire(uri);
  }

  invalidateAll(): void {
    this._onDidChange.fire(vscode.Uri.parse(`${BASELINE_SCHEME}://all`));
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    if (!this._contentResolver) {
      return '';
    }
    const content = await this._contentResolver(uri);
    return content ?? '';
  }
}

export function toBaselineUri(fileUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.from({ scheme: BASELINE_SCHEME, path: fileUri.path });
}

export function fromBaselineUri(baselineUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.file(baselineUri.path);
}
