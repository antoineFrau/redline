import * as vscode from 'vscode';
import { ReviewSession } from '../session/reviewSession';
import { filePathKey } from '../utils/workspace';
import { getConfig } from '../utils/workspace';

export class ExpandCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  constructor(private readonly session: ReviewSession) {
    session.onDidChange(() => this._onDidChangeCodeLenses.fire());
  }

  provideCodeLenses(
    document: vscode.TextDocument
  ): vscode.ProviderResult<vscode.CodeLens[]> {
    const key = filePathKey(document.uri);
    const fileDiff = this.session.getFileDiff(key);
    if (!fileDiff) {
      return [];
    }

    const lenses: vscode.CodeLens[] = [];
    const step = getConfig<number>('expandStepLines', 20);

    for (const gap of fileDiff.gaps) {
      const line = gap.hiddenStartLine - 1;
      if (line < 0 || line >= document.lineCount) {
        continue;
      }

      const remaining = gap.hiddenLineCount - gap.expandedLines;
      const range = new vscode.Range(line, 0, line, 0);

      if (gap.expandedLines === 0) {
        lenses.push(
          new vscode.CodeLens(range, {
            title: `⋯ ${gap.hiddenLineCount} hidden lines — Show more (+${Math.min(step, gap.hiddenLineCount)})`,
            command: 'reviewAgent.expandGap',
            arguments: [gap.id, key],
          })
        );
      } else if (remaining > 0) {
        lenses.push(
          new vscode.CodeLens(range, {
            title: `⋯ ${remaining} hidden lines — Show more (+${Math.min(step, remaining)})`,
            command: 'reviewAgent.expandGap',
            arguments: [gap.id, key],
          }),
          new vscode.CodeLens(range, {
            title: 'Show all',
            command: 'reviewAgent.expandGapAll',
            arguments: [gap.id, key],
          }),
          new vscode.CodeLens(range, {
            title: 'Show less',
            command: 'reviewAgent.collapseGap',
            arguments: [gap.id, key],
          })
        );
      } else {
        lenses.push(
          new vscode.CodeLens(range, {
            title: 'Show less',
            command: 'reviewAgent.collapseGap',
            arguments: [gap.id, key],
          })
        );
      }
    }

    return lenses;
  }
}
