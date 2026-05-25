import { ChangedFileInfo } from '../baseline/baselineProvider';

export interface ChangeResourceEntry {
  labelPath: string;
  baselinePath: string | null;
  currentPath: string | null;
}

export function buildChangeResourceEntries(files: ChangedFileInfo[]): ChangeResourceEntry[] {
  const entries: ChangeResourceEntry[] = [];

  for (const file of files) {
    const labelPath = file.uri.fsPath;
    if (file.status === 'deleted') {
      entries.push({ labelPath, baselinePath: labelPath, currentPath: null });
      continue;
    }
    if (file.status === 'added') {
      entries.push({ labelPath, baselinePath: null, currentPath: labelPath });
      continue;
    }
    entries.push({ labelPath, baselinePath: labelPath, currentPath: labelPath });
  }

  return entries;
}

export function unifiedReviewTitle(fileCount: number): string {
  const noun = fileCount === 1 ? 'file' : 'files';
  return `Redline (${fileCount} ${noun})`;
}
