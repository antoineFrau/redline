import * as path from 'path';

const DEFAULT_IGNORE = [
  '**/.git/**',
  '**/node_modules/**',
  '**/.vscode/**',
  '**/dist/**',
  '**/out/**',
  '**/.DS_Store',
  '**/*.vsix',
];

export function getIgnorePatterns(extra: string[] = []): string[] {
  return [...DEFAULT_IGNORE, ...extra];
}

/** Simple glob match for common patterns used in snapshot mode. */
export function matchesIgnore(relativePath: string, patterns: string[]): boolean {
  const normalized = relativePath.replace(/\\/g, '/');

  for (const pattern of patterns) {
    if (matchGlob(normalized, pattern)) {
      return true;
    }
  }
  return false;
}

function matchGlob(filePath: string, pattern: string): boolean {
  const p = pattern.replace(/\\/g, '/');

  if (p.endsWith('/**')) {
    const prefix = p.slice(0, -3);
    return filePath === prefix || filePath.startsWith(prefix + '/');
  }

  if (p.startsWith('**/') && p.endsWith('/**')) {
    const middle = p.slice(3, -3);
    return filePath.includes('/' + middle + '/') || filePath.startsWith(middle + '/');
  }

  if (p.startsWith('**/')) {
    const suffix = p.slice(3);
    if (suffix.includes('*')) {
      return globStar(filePath, suffix);
    }
    return filePath.endsWith('/' + suffix) || filePath === suffix || filePath.endsWith(suffix);
  }

  if (p.includes('*')) {
    return globStar(filePath, p);
  }

  return filePath === p || filePath.endsWith('/' + p);
}

function globStar(text: string, pattern: string): boolean {
  const regex = new RegExp(
    '^' +
      pattern
        .split('*')
        .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*') +
      '$'
  );
  const base = path.basename(text);
  return regex.test(text) || regex.test(base);
}

export function isLikelyBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === 0) {
      return true;
    }
  }
  return false;
}
