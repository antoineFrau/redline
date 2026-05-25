import * as Diff from 'diff';
import {
  ChangeRegion,
  CollapsedGap,
  FileDiff,
  VisibleRange,
  gapId,
  regionId,
} from './regionModel';

export interface DiffEngineOptions {
  contextLines: number;
  collapseThreshold: number;
  /** Per-gap expanded line counts keyed by gap id */
  gapExpansions?: Map<string, number>;
}

export interface LineMapping {
  /** 1-based current line */
  currentLine: number;
  type: 'unchanged' | 'added' | 'removed' | 'modified';
  baselineLine?: number;
  baselineText?: string;
  currentText?: string;
}

/**
 * Compute file diff with change regions and collapsible gaps.
 */
export function computeFileDiff(
  filePath: string,
  baselineText: string,
  currentText: string,
  options: DiffEngineOptions
): FileDiff {
  const baselineLines = splitLines(baselineText);
  const currentLines = splitLines(currentText);
  const mappings = buildLineMappings(baselineLines, currentLines);
  const rawRegions = extractChangeRegions(filePath, mappings, currentLines);
  const { regions, gaps } = buildRegionsAndGaps(
    filePath,
    currentLines.length,
    rawRegions,
    options
  );

  let additions = 0;
  let deletions = 0;
  for (const r of regions) {
    additions += r.addedLines.length;
    deletions += r.removedLines.length;
  }

  return {
    filePath,
    regions,
    gaps,
    totalLines: currentLines.length,
    additions,
    deletions,
  };
}

export function getVisibleRanges(
  fileDiff: FileDiff,
  contextLines: number
): VisibleRange[] {
  if (fileDiff.regions.length === 0) {
    return [{ startLine: 1, endLine: fileDiff.totalLines }];
  }

  const visible = new Set<number>();

  for (const region of fileDiff.regions) {
    const ctxStart = Math.max(1, region.startLine - region.contextBefore);
    const ctxEnd = Math.min(fileDiff.totalLines, region.endLine + region.contextAfter);
    for (let line = ctxStart; line <= ctxEnd; line++) {
      visible.add(line);
    }
  }

  for (const gap of fileDiff.gaps) {
    if (gap.expandedLines > 0) {
      const revealEnd = Math.min(
        gap.hiddenStartLine + gap.expandedLines - 1,
        gap.hiddenEndLine
      );
      for (let line = gap.hiddenStartLine; line <= revealEnd; line++) {
        visible.add(line);
      }
    }
  }

  return compressToRanges([...visible].sort((a, b) => a - b));
}

export function expandGap(
  fileDiff: FileDiff,
  gapIdToExpand: string,
  stepLines: number
): FileDiff {
  const gaps = fileDiff.gaps.map((g) => {
    if (g.id !== gapIdToExpand) {
      return g;
    }
    const maxExpand = g.hiddenLineCount;
    return {
      ...g,
      expandedLines: Math.min(g.expandedLines + stepLines, maxExpand),
    };
  });
  return { ...fileDiff, gaps };
}

export function expandGapFully(fileDiff: FileDiff, gapIdToExpand: string): FileDiff {
  const gaps = fileDiff.gaps.map((g) => {
    if (g.id !== gapIdToExpand) {
      return g;
    }
    return { ...g, expandedLines: g.hiddenLineCount };
  });
  return { ...fileDiff, gaps };
}

export function collapseGap(
  fileDiff: FileDiff,
  gapIdToCollapse: string,
  contextLines: number
): FileDiff {
  const gaps = fileDiff.gaps.map((g) => {
    if (g.id !== gapIdToCollapse) {
      return g;
    }
    return { ...g, expandedLines: 0 };
  });
  const regions = fileDiff.regions.map((r) => ({
    ...r,
    contextBefore: contextLines,
    contextAfter: contextLines,
  }));
  return { ...fileDiff, gaps, regions };
}

export function collapseAll(fileDiff: FileDiff, contextLines: number): FileDiff {
  const gaps = fileDiff.gaps.map((g) => ({ ...g, expandedLines: 0 }));
  const regions = fileDiff.regions.map((r) => ({
    ...r,
    contextBefore: contextLines,
    contextAfter: contextLines,
  }));
  return { ...fileDiff, gaps, regions };
}

export function expandAll(fileDiff: FileDiff): FileDiff {
  const gaps = fileDiff.gaps.map((g) => ({ ...g, expandedLines: g.hiddenLineCount }));
  const regions = fileDiff.regions.map((r) => ({
    ...r,
    contextBefore: fileDiff.totalLines,
    contextAfter: fileDiff.totalLines,
  }));
  return { ...fileDiff, gaps, regions };
}

function splitLines(text: string): string[] {
  if (text.length === 0) {
    return [];
  }
  const lines = text.split('\n');
  if (text.endsWith('\n')) {
    lines.pop();
  }
  return lines;
}

function buildLineMappings(baselineLines: string[], currentLines: string[]): LineMapping[] {
  const changes = Diff.diffArrays(baselineLines, currentLines);
  const mappings: LineMapping[] = [];
  let baselineLine = 1;
  let currentLine = 1;

  for (const change of changes) {
    const lines = change.value as string[];
    if (change.added) {
      for (const text of lines) {
        mappings.push({ currentLine, type: 'added', currentText: text });
        currentLine++;
      }
    } else if (change.removed) {
      for (const text of lines) {
        mappings.push({
          currentLine,
          type: 'removed',
          baselineLine,
          baselineText: text,
        });
        baselineLine++;
      }
    } else {
      for (const text of lines) {
        mappings.push({
          currentLine,
          type: 'unchanged',
          baselineLine,
          baselineText: text,
          currentText: text,
        });
        currentLine++;
        baselineLine++;
      }
    }
  }

  return mappings;
}

interface RawRegion {
  startLine: number;
  endLine: number;
  removedLines: string[];
  addedLines: string[];
  changedLines: number[];
  ghostAtLine: Map<number, string[]>;
}

function extractChangeRegions(
  filePath: string,
  mappings: LineMapping[],
  currentLines: string[]
): RawRegion[] {
  const regions: RawRegion[] = [];
  let i = 0;

  while (i < mappings.length) {
    const m = mappings[i];
    if (m.type === 'unchanged') {
      i++;
      continue;
    }

    const startIdx = i;
    const removedLines: string[] = [];
    const addedLines: string[] = [];
    const changedLines: number[] = [];
    const ghostAtLine = new Map<number, string[]>();

    let regionStartLine = m.currentLine;
    let regionEndLine = m.currentLine;

    while (i < mappings.length && mappings[i].type !== 'unchanged') {
      const curr = mappings[i];
      if (curr.type === 'removed') {
        removedLines.push(curr.baselineText ?? '');
        const anchor = regionEndLine;
        const existing = ghostAtLine.get(anchor) ?? [];
        existing.push(curr.baselineText ?? '');
        ghostAtLine.set(anchor, existing);
      } else if (curr.type === 'added') {
        addedLines.push(curr.currentText ?? '');
        changedLines.push(curr.currentLine);
        regionEndLine = curr.currentLine;
        if (regionStartLine > regionEndLine) {
          regionStartLine = curr.currentLine;
        }
      }
      i++;
    }

    if (changedLines.length === 0 && removedLines.length > 0) {
      regionEndLine = Math.min(regionStartLine, currentLines.length);
      if (regionEndLine < 1) {
        regionEndLine = 1;
      }
      regionStartLine = regionEndLine;
    }

    if (changedLines.length > 0 || removedLines.length > 0) {
      regions.push({
        startLine: Math.min(...changedLines, regionStartLine),
        endLine: Math.max(...changedLines, regionEndLine, regionStartLine),
        removedLines,
        addedLines,
        changedLines,
        ghostAtLine,
      });
    }

    if (i === startIdx) {
      i++;
    }
  }

  void filePath;
  return mergeAdjacentRegions(regions);
}

function mergeAdjacentRegions(regions: RawRegion[]): RawRegion[] {
  if (regions.length <= 1) {
    return regions;
  }
  const merged: RawRegion[] = [];
  let current = { ...regions[0], ghostAtLine: new Map(regions[0].ghostAtLine) };

  for (let i = 1; i < regions.length; i++) {
    const next = regions[i];
    if (next.startLine - current.endLine <= 1) {
      current.endLine = Math.max(current.endLine, next.endLine);
      current.removedLines.push(...next.removedLines);
      current.addedLines.push(...next.addedLines);
      current.changedLines.push(...next.changedLines);
      for (const [line, ghosts] of next.ghostAtLine) {
        const existing = current.ghostAtLine.get(line) ?? [];
        current.ghostAtLine.set(line, [...existing, ...ghosts]);
      }
    } else {
      merged.push(current);
      current = { ...next, ghostAtLine: new Map(next.ghostAtLine) };
    }
  }
  merged.push(current);
  return merged;
}

function buildRegionsAndGaps(
  filePath: string,
  totalLines: number,
  rawRegions: RawRegion[],
  options: DiffEngineOptions
): { regions: ChangeRegion[]; gaps: CollapsedGap[] } {
  const { contextLines, collapseThreshold, gapExpansions } = options;

  if (rawRegions.length === 0) {
    return { regions: [], gaps: [] };
  }

  const regions: ChangeRegion[] = rawRegions.map((r) => ({
    id: regionId(filePath, r.startLine, r.endLine),
    filePath,
    startLine: r.startLine,
    endLine: r.endLine,
    removedLines: r.removedLines,
    addedLines: r.addedLines,
    contextBefore: contextLines,
    contextAfter: contextLines,
    changedLines: r.changedLines,
    ghostAtLine: r.ghostAtLine,
  }));

  const gaps: CollapsedGap[] = [];
  let prevEnd = 0;

  for (const region of regions) {
    const visibleStart = Math.max(1, region.startLine - contextLines);
    const gapStart = prevEnd + 1;
    const gapEnd = visibleStart - 1;

    if (gapEnd >= gapStart) {
      const hiddenCount = gapEnd - gapStart + 1;
      if (hiddenCount >= collapseThreshold) {
        const id = gapId(filePath, gapStart, gapEnd);
        gaps.push({
          id,
          filePath,
          afterRegionId: prevEnd === 0 ? '' : regions.find((r) => r.endLine === prevEnd)?.id ?? '',
          hiddenStartLine: gapStart,
          hiddenEndLine: gapEnd,
          hiddenLineCount: hiddenCount,
          expandedLines: gapExpansions?.get(id) ?? 0,
        });
      }
    }

    prevEnd = Math.min(totalLines, region.endLine + contextLines);
  }

  const lastGapStart = prevEnd + 1;
  if (lastGapStart <= totalLines) {
    const hiddenCount = totalLines - lastGapStart + 1;
    if (hiddenCount >= collapseThreshold) {
      const lastRegion = regions[regions.length - 1];
      const id = gapId(filePath, lastGapStart, totalLines);
      gaps.push({
        id,
        filePath,
        afterRegionId: lastRegion?.id ?? '',
        hiddenStartLine: lastGapStart,
        hiddenEndLine: totalLines,
        hiddenLineCount: hiddenCount,
        expandedLines: gapExpansions?.get(id) ?? 0,
      });
    }
  }

  return { regions, gaps };
}

function compressToRanges(sortedLines: number[]): VisibleRange[] {
  if (sortedLines.length === 0) {
    return [];
  }
  const ranges: VisibleRange[] = [];
  let start = sortedLines[0];
  let end = sortedLines[0];

  for (let i = 1; i < sortedLines.length; i++) {
    if (sortedLines[i] === end + 1) {
      end = sortedLines[i];
    } else {
      ranges.push({ startLine: start, endLine: end });
      start = sortedLines[i];
      end = sortedLines[i];
    }
  }
  ranges.push({ startLine: start, endLine: end });
  return ranges;
}

/** Exported for tests */
export { splitLines, buildLineMappings, compressToRanges };
