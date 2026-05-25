import * as vscode from 'vscode';
import { BASELINE_SCHEME, BaselineContentProvider } from './content/baselineContentProvider';
import { ExpansionStateManager } from './session/expansionState';
import { ReviewSession } from './session/reviewSession';
import { DecorationManager, ReviewFoldingProvider } from './ui/decorationManager';
import { ExpandCodeLensProvider } from './ui/expandCodeLensProvider';
import { registerChangedFilesTree } from './ui/changedFilesTree';
import { StatusBarController } from './ui/statusBar';
import { openSideBySideReview, toggleSideBySideReview } from './ui/sideBySide';
import { openAllChanges, createUnifiedReviewSync } from './ui/unifiedReview';
import { filePathKey, getConfig } from './utils/workspace';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const baselineContentProvider = new BaselineContentProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      BASELINE_SCHEME,
      baselineContentProvider
    )
  );

  const expansionState = new ExpansionStateManager(context);
  const session = new ReviewSession(context, baselineContentProvider, expansionState);
  context.subscriptions.push(session);

  const decorationManager = new DecorationManager(session);
  context.subscriptions.push(decorationManager);

  const foldingProvider = new ReviewFoldingProvider(session);
  context.subscriptions.push(
    vscode.languages.registerFoldingRangeProvider({ scheme: 'file' }, foldingProvider)
  );

  const codeLensProvider = new ExpandCodeLensProvider(session);
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ scheme: 'file' }, codeLensProvider)
  );

  registerChangedFilesTree(context, session);
  const statusBar = new StatusBarController(session);
  context.subscriptions.push(statusBar, createUnifiedReviewSync(session));

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => {
      session.onActiveEditorChanged();
      decorationManager.refreshActive();
    }),
    vscode.window.onDidChangeTextEditorSelection(() => {
      session.onActiveEditorChanged();
    }),
    vscode.workspace.onDidOpenTextDocument(() => decorationManager.refreshAll()),
    session.onDidChange(() => decorationManager.refreshAll())
  );

  registerCommands(context, session, decorationManager);

  await session.initialize();
  decorationManager.refreshAll();

  if (
    getConfig<boolean>('autoOpenUnifiedReview', true) &&
    session.getChangedFiles().length > 0
  ) {
    await openAllChanges(session);
  }
}

function registerCommands(
  context: vscode.ExtensionContext,
  session: ReviewSession,
  decorationManager: DecorationManager
): void {
  const register = (id: string, handler: (...args: unknown[]) => unknown) => {
    context.subscriptions.push(vscode.commands.registerCommand(id, handler));
  };

  register('reviewAgent.openAllChanges', () => openAllChanges(session));

  register('reviewAgent.openInline', (uri?: vscode.Uri) => {
    const target = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (target) {
      void session.openFile(target, 'inline');
    }
  });

  register('reviewAgent.openSideBySide', (uri?: vscode.Uri) => {
    void openSideBySideReview(session, uri);
  });

  register('reviewAgent.toggleSideBySide', () => {
    void toggleSideBySideReview(session);
  });

  register('reviewAgent.nextChange', () => session.navigateNextChange());
  register('reviewAgent.prevChange', () => session.navigatePrevChange());
  register('reviewAgent.nextFile', () => session.navigateNextFile());
  register('reviewAgent.prevFile', () => session.navigatePrevFile());

  register('reviewAgent.collapseAll', () => {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      session.handleCollapseAll(filePathKey(editor.document.uri));
      decorationManager.refreshActive();
    }
  });

  register('reviewAgent.expandAll', () => {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      session.handleExpandAll(filePathKey(editor.document.uri));
      decorationManager.refreshActive();
    }
  });

  register('reviewAgent.expandGap', (gapId: string, filePath: string) => {
    session.handleExpandGap(gapId, filePath);
    decorationManager.refreshAll();
  });

  register('reviewAgent.expandGapAll', (gapId: string, filePath: string) => {
    session.handleExpandGapAll(gapId, filePath);
    decorationManager.refreshAll();
  });

  register('reviewAgent.collapseGap', (gapId: string, filePath: string) => {
    session.handleCollapseGap(gapId, filePath);
    decorationManager.refreshAll();
  });

  register('reviewAgent.focusChangedFiles', async () => {
    await vscode.commands.executeCommand('reviewAgent.changedFiles.focus');
  });
}

export function deactivate(): void {}
