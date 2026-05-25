export interface ChangeRegion {
  id: string;
  filePath: string;
  /** 1-based start line in current document */
  startLine: number;
  /** 1-based end line in current document (inclusive) */
  endLine: number;
  removedLines: string[];
  addedLines: string[];
  /** Lines of unchanged context currently visible above the change */
  contextBefore: number;
  /** Lines of unchanged context currently visible below the change */
  contextAfter: number;
  /** 1-based lines in current doc that are additions/modifications */
  changedLines: number[];
  /** Ghost delete decorations keyed by line number */
  ghostAtLine: Map<number, string[]>;
}

export interface CollapsedGap {
  id: string;
  filePath: string;
  /** Region id before this gap, or empty for file start */
  afterRegionId: string;
  /** 1-based first hidden line (inclusive) */
  hiddenStartLine: number;
  /** 1-based last hidden line (inclusive) */
  hiddenEndLine: number;
  hiddenLineCount: number;
  /** Number of lines revealed from the start of the gap (0 = fully collapsed) */
  expandedLines: number;
}

export interface FileDiff {
  filePath: string;
  regions: ChangeRegion[];
  gaps: CollapsedGap[];
  totalLines: number;
  additions: number;
  deletions: number;
}

export interface VisibleRange {
  startLine: number;
  endLine: number;
}

export function gapId(filePath: string, startLine: number, endLine: number): string {
  return `${filePath}::gap::${startLine}-${endLine}`;
}

export function regionId(filePath: string, startLine: number, endLine: number): string {
  return `${filePath}::region::${startLine}-${endLine}`;
}
