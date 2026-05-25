import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeFileDiff,
  expandGap,
  expandGapFully,
  collapseAll,
  expandAll,
  getVisibleRanges,
} from '../src/diff/diffEngine';
import { gapId } from '../src/diff/regionModel';

describe('computeFileDiff', () => {
  it('detects a single added line', () => {
    const diff = computeFileDiff('/f.ts', 'a\n', 'a\nb\n', {
      contextLines: 3,
      collapseThreshold: 8,
    });
    assert.equal(diff.regions.length, 1);
    assert.equal(diff.additions, 1);
    assert.ok(diff.regions[0].changedLines.includes(2));
  });

  it('creates collapsed gap between distant changes', () => {
    const baseline = Array.from({ length: 30 }, (_, i) => `line${i + 1}`).join('\n');
    const current = baseline
      .split('\n')
      .map((l, i) => {
        if (i === 0) {
          return 'CHANGED_TOP';
        }
        if (i === 29) {
          return 'CHANGED_BOTTOM';
        }
        return l;
      })
      .join('\n');

    const diff = computeFileDiff('/f.ts', baseline, current, {
      contextLines: 3,
      collapseThreshold: 8,
    });

    assert.equal(diff.regions.length, 2);
    assert.ok(diff.gaps.length >= 1);
    const gap = diff.gaps[0];
    assert.ok(gap.hiddenLineCount >= 8);
    assert.equal(gap.expandedLines, 0);
  });

  it('applies persisted gap expansion', () => {
    const baseline = Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n');
    const current = baseline.replace('l10', 'CHANGED');

    let diff = computeFileDiff('/f.ts', baseline, current, {
      contextLines: 2,
      collapseThreshold: 5,
    });

    if (diff.gaps.length === 0) {
      return;
    }

    const id = diff.gaps[0].id;
    const expansions = new Map([[id, 5]]);
    diff = computeFileDiff('/f.ts', baseline, current, {
      contextLines: 2,
      collapseThreshold: 5,
      gapExpansions: expansions,
    });
    assert.equal(diff.gaps[0].expandedLines, 5);
  });
});

describe('gap expand/collapse', () => {
  const baseline = [
    'unchanged1',
    'unchanged2',
    'unchanged3',
    'unchanged4',
    'unchanged5',
    'unchanged6',
    'unchanged7',
    'unchanged8',
    'unchanged9',
    'unchanged10',
    'old',
    'unchanged12',
    'unchanged13',
    'unchanged14',
    'unchanged15',
    'unchanged16',
    'unchanged17',
    'unchanged18',
    'unchanged19',
    'unchanged20',
  ].join('\n');

  const current = baseline.replace('old', 'new');

  it('expandGap reveals more lines', () => {
    let diff = computeFileDiff('/g.ts', baseline, current, {
      contextLines: 2,
      collapseThreshold: 5,
    });
    if (diff.gaps.length === 0) {
      return;
    }
    const id = diff.gaps[0].id;
    const before = diff.gaps[0].expandedLines;
    diff = expandGap(diff, id, 10);
    assert.ok(diff.gaps[0].expandedLines > before);
  });

  it('expandGapFully reveals entire gap', () => {
    let diff = computeFileDiff('/g.ts', baseline, current, {
      contextLines: 2,
      collapseThreshold: 5,
    });
    if (diff.gaps.length === 0) {
      return;
    }
    const id = diff.gaps[0].id;
    diff = expandGapFully(diff, id);
    assert.equal(diff.gaps[0].expandedLines, diff.gaps[0].hiddenLineCount);
  });

  it('collapseAll resets expansions', () => {
    let diff = computeFileDiff('/g.ts', baseline, current, {
      contextLines: 2,
      collapseThreshold: 5,
    });
    diff = expandAll(diff);
    diff = collapseAll(diff, 2);
    for (const g of diff.gaps) {
      assert.equal(g.expandedLines, 0);
    }
  });
});

describe('getVisibleRanges', () => {
  it('includes context around changes', () => {
    const diff = computeFileDiff('/v.ts', 'a\nb\nc\nd\ne\n', 'a\nX\nc\nd\nY\n', {
      contextLines: 1,
      collapseThreshold: 100,
    });
    const visible = getVisibleRanges(diff, 1);
    assert.ok(visible.length > 0);
    const allLines = new Set<number>();
    for (const r of visible) {
      for (let l = r.startLine; l <= r.endLine; l++) {
        allLines.add(l);
      }
    }
    for (const region of diff.regions) {
      assert.ok(allLines.has(region.startLine));
    }
  });
});

describe('gapId', () => {
  it('is stable for same range', () => {
    assert.equal(gapId('/f', 5, 10), gapId('/f', 5, 10));
    assert.notEqual(gapId('/f', 5, 10), gapId('/f', 6, 10));
  });
});
