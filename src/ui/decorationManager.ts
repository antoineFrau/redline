import * as vscode from 'vscode';
import { ReviewSession } from '../session/reviewSession';
import { getVisibleRanges } from '../diff/diffEngine';
import { getConfig } from '../utils/workspace';
import { filePathKey } from '../utils/workspace';

export class DecorationManager implements vscode.Disposable {
  private readonly addedDecoration: vscode.TextEditorDecorationType;
  private readonly modifiedDecoration: vscode.TextEditorDecorationType;
  private readonly ghostDecoration: vscode.TextEditorDecorationType;
  private readonly wordAddedDecoration: vscode.TextEditorDecorationType;
  private _disposables: vscode.Disposable[] = [];

  constructor(private readonly session: ReviewSession) {
    this.addedDecoration = vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor('diffEditor.insertedLineBackground'),
      isWholeLine: true,
      overviewRulerColor: new vscode.ThemeColor('charts.green'),
      overviewRulerLane: vscode.OverviewRulerLane.Left,
    });

    this.modifiedDecoration = vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor('diffEditor.insertedLineBackground'),
      isWholeLine: true,
      overviewRulerColor: new vscode.ThemeColor('charts.green'),
      overviewRulerLane: vscode.OverviewRulerLane.Left,
    });

    this.ghostDecoration = vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor('diffEditor.removedLineBackground'),
      color: new vscode.ThemeColor('diffEditor.removedTextBackground'),
      textDecoration: 'line-through',
      before: {
        contentText: '',
        color: new vscode.ThemeColor('diffEditor.removedTextBackground'),
        textDecoration: 'none;',
        margin: '0 0 0 0',
      },
      isWholeLine: false,
    });

    this.wordAddedDecoration = vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor('diffEditor.insertedTextBackground'),
    });

    this._disposables.push(
      this.session.onDidChange(() => this.refreshAll()),
      vscode.window.onDidChangeActiveTextEditor(() => this.refreshActive())
    );
  }

  refreshAll(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      this.applyDecorations(editor);
    }
  }

  refreshActive(): void {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      this.applyDecorations(editor);
    }
    this.session.onActiveEditorChanged();
  }

  private applyDecorations(editor: vscode.TextEditor): void {
    const key = filePathKey(editor.document.uri);
    const fileDiff = this.session.getFileDiff(key);

    if (!fileDiff) {
      this.clearDecorations(editor);
      return;
    }

    const addedRanges: vscode.Range[] = [];
    const modifiedRanges: vscode.Range[] = [];
    const ghostOptions: vscode.DecorationOptions[] = [];
    const wordAddedOptions: vscode.DecorationOptions[] = [];

    for (const region of fileDiff.regions) {
      for (const lineNum of region.changedLines) {
        const lineIdx = lineNum - 1;
        if (lineIdx < 0 || lineIdx >= editor.document.lineCount) {
          continue;
        }
        const range = editor.document.lineAt(lineIdx).range;
        if (region.removedLines.length > 0 && region.addedLines.length > 0) {
          modifiedRanges.push(range);
        } else {
          addedRanges.push(range);
        }
      }

      for (const [lineNum, ghosts] of region.ghostAtLine) {
        const lineIdx = lineNum - 1;
        if (lineIdx < 0 || lineIdx >= editor.document.lineCount) {
          continue;
        }
        const ghostText = ghosts.map((g) => `− ${g}`).join('\n');
        ghostOptions.push({
          range: new vscode.Range(lineIdx, 0, lineIdx, 0),
          renderOptions: {
            before: {
              contentText: ghostText + '\n',
              color: new vscode.ThemeColor('diffEditor.removedTextBackground'),
              textDecoration: 'line-through',
              margin: '0 0 0 1em',
            },
          },
        });
      }
    }

    editor.setDecorations(this.addedDecoration, addedRanges);
    editor.setDecorations(this.modifiedDecoration, modifiedRanges);
    editor.setDecorations(this.ghostDecoration, ghostOptions);
    editor.setDecorations(this.wordAddedDecoration, wordAddedOptions);
  }

  private clearDecorations(editor: vscode.TextEditor): void {
    editor.setDecorations(this.addedDecoration, []);
    editor.setDecorations(this.modifiedDecoration, []);
    editor.setDecorations(this.ghostDecoration, []);
    editor.setDecorations(this.wordAddedDecoration, []);
  }

  dispose(): void {
    this.addedDecoration.dispose();
    this.modifiedDecoration.dispose();
    this.ghostDecoration.dispose();
    this.wordAddedDecoration.dispose();
    for (const d of this._disposables) {
      d.dispose();
    }
  }
}

export class ReviewFoldingProvider implements vscode.FoldingRangeProvider {
  constructor(private readonly session: ReviewSession) {}

  provideFoldingRanges(
    document: vscode.TextDocument
  ): vscode.ProviderResult<vscode.FoldingRange[]> {
    const fileDiff = this.session.getFileDiff(filePathKey(document.uri));
    if (!fileDiff) {
      return [];
    }

    const contextLines = getConfig<number>('contextLines', 3);
    const visible = getVisibleRanges(fileDiff, contextLines);
    const ranges: vscode.FoldingRange[] = [];

    const visibleSet = new Set<number>();
    for (const vr of visible) {
      for (let l = vr.startLine; l <= vr.endLine; l++) {
        visibleSet.add(l);
      }
    }

    for (const gap of fileDiff.gaps) {
      const foldStart = gap.hiddenStartLine - 1;
      const foldEnd = gap.hiddenEndLine - 1;
      if (foldEnd >= foldStart && foldEnd < document.lineCount) {
        ranges.push(new vscode.FoldingRange(foldStart, foldEnd, vscode.FoldingRangeKind.Region));
      }
    }

    if (fileDiff.regions.length > 0 && !this.session.expansionState.isFullyExpanded(filePathKey(document.uri))) {
      let line = 1;
      while (line <= fileDiff.totalLines) {
        if (!visibleSet.has(line)) {
          const hiddenStart = line;
          while (line <= fileDiff.totalLines && !visibleSet.has(line)) {
            line++;
          }
          const hiddenEnd = line - 1;
          if (hiddenEnd - hiddenStart + 1 >= getConfig<number>('collapseThreshold', 8)) {
            ranges.push(
              new vscode.FoldingRange(hiddenStart - 1, hiddenEnd - 1, vscode.FoldingRangeKind.Region)
            );
          }
        } else {
          line++;
        }
      }
    }

    return ranges;
  }
}
