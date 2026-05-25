import * as vscode from 'vscode';
import { ReviewSession } from '../session/reviewSession';
import { toBaselineUri } from '../content/baselineContentProvider';
import { filePathKey } from '../utils/workspace';

export async function openSideBySideReview(
  session: ReviewSession,
  uri?: vscode.Uri
): Promise<void> {
  const target = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!target || target.scheme !== 'file') {
    void vscode.window.showInformationMessage('Redline: Open a workspace file first.');
    return;
  }

  const key = filePathKey(target);
  const diff = session.getFileDiff(key);
  if (!diff && !session.getChangedFiles().some((f) => f.uri.fsPath === target.fsPath)) {
    void vscode.window.showInformationMessage('Redline: No changes for this file.');
    return;
  }

  const baselineUri = toBaselineUri(target);
  const title = `${vscode.workspace.asRelativePath(target)} (baseline ↔ current)`;

  await vscode.commands.executeCommand('vscode.diff', baselineUri, target, title);
}

export async function toggleSideBySideReview(session: ReviewSession): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const isDiffEditor =
    vscode.window.activeTextEditor?.document.uri.scheme === 'redline-baseline' ||
    vscode.window.tabGroups.activeTabGroup.activeTab?.label?.includes('↔');

  if (isDiffEditor) {
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    const fileUri = editor.document.uri.scheme === 'file'
      ? editor.document.uri
      : undefined;
    if (fileUri) {
      const doc = await vscode.workspace.openTextDocument(fileUri);
      await vscode.window.showTextDocument(doc, { preview: false });
    }
    return;
  }

  await openSideBySideReview(session, editor.document.uri);
}
