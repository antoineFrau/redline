import * as vscode from 'vscode';
import { ChangedFileInfo } from '../baseline/baselineProvider';
import { toBaselineUri } from '../content/baselineContentProvider';
import { ReviewSession } from '../session/reviewSession';
import { getConfig } from '../utils/workspace';
import { debounce } from '../utils/debounce';
import {
  buildChangeResourceEntries,
  unifiedReviewTitle,
} from './unifiedReviewResources';

/** Tuple passed to the built-in `vscode.changes` command: [label, original?, modified?]. */
export type ChangeResource = [vscode.Uri, vscode.Uri | null, vscode.Uri | null];

export { buildChangeResourceEntries, unifiedReviewTitle };

export function buildChangeResourceList(files: ChangedFileInfo[]): ChangeResource[] {
  return buildChangeResourceEntries(files).map((entry) => {
    const label = vscode.Uri.file(entry.labelPath);
    const original = entry.baselinePath ? toBaselineUri(vscode.Uri.file(entry.baselinePath)) : null;
    const modified = entry.currentPath ? vscode.Uri.file(entry.currentPath) : null;
    return [label, original, modified];
  });
}

function reviewSignature(files: ChangedFileInfo[]): string {
  return files
    .map((f) => `${f.uri.fsPath}:${f.status}:${f.additions}:${f.deletions}`)
    .join('|');
}

let lastSyncedSignature = '';

export async function openAllChanges(session: ReviewSession): Promise<void> {
  const files = session.getChangedFiles();
  if (files.length === 0) {
    lastSyncedSignature = '';
    return;
  }

  const resourceList = buildChangeResourceList(files);
  const title = unifiedReviewTitle(files.length);

  try {
    await vscode.commands.executeCommand('vscode.changes', title, resourceList);
    lastSyncedSignature = reviewSignature(files);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(
      `Redline: Could not open unified review — ${message}`
    );
  }
}

export function createUnifiedReviewSync(session: ReviewSession): vscode.Disposable {
  const sync = debounce(async () => {
    if (!getConfig<boolean>('autoOpenUnifiedReview', true)) {
      return;
    }

    const files = session.getChangedFiles();
    const signature = reviewSignature(files);
    if (signature === lastSyncedSignature) {
      return;
    }

    if (files.length > 0) {
      await openAllChanges(session);
    } else {
      lastSyncedSignature = '';
    }
  }, getConfig<number>('debounceMs', 300) + 200);

  return session.onDidChange(() => sync());
}
