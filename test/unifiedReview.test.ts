import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildChangeResourceEntries,
  unifiedReviewTitle,
} from '../src/ui/unifiedReviewResources';
import { ChangedFileInfo } from '../src/baseline/baselineProvider';

function changed(
  path: string,
  status: ChangedFileInfo['status']
): ChangedFileInfo {
  return {
    uri: { fsPath: path } as ChangedFileInfo['uri'],
    relativePath: path,
    status,
    additions: 0,
    deletions: 0,
  };
}

describe('buildChangeResourceEntries', () => {
  it('maps modified files to baseline and current paths', () => {
    const [entry] = buildChangeResourceEntries([changed('/proj/src/a.ts', 'modified')]);
    assert.deepEqual(entry, {
      labelPath: '/proj/src/a.ts',
      baselinePath: '/proj/src/a.ts',
      currentPath: '/proj/src/a.ts',
    });
  });

  it('maps added files with null baseline', () => {
    const [entry] = buildChangeResourceEntries([changed('/proj/new.ts', 'added')]);
    assert.deepEqual(entry, {
      labelPath: '/proj/new.ts',
      baselinePath: null,
      currentPath: '/proj/new.ts',
    });
  });

  it('maps deleted files with null current', () => {
    const [entry] = buildChangeResourceEntries([changed('/proj/old.ts', 'deleted')]);
    assert.deepEqual(entry, {
      labelPath: '/proj/old.ts',
      baselinePath: '/proj/old.ts',
      currentPath: null,
    });
  });
});

describe('unifiedReviewTitle', () => {
  it('uses singular file label', () => {
    assert.equal(unifiedReviewTitle(1), 'Redline (1 file)');
  });

  it('uses plural files label', () => {
    assert.equal(unifiedReviewTitle(3), 'Redline (3 files)');
  });
});
