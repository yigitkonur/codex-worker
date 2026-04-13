import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface PackageMetadata {
  name: string;
  version: string;
}

function isUsablePackageMetadata(value: unknown): value is PackageMetadata {
  return Boolean(
    value
    && typeof value === 'object'
    && typeof (value as { name?: unknown }).name === 'string'
    && typeof (value as { version?: unknown }).version === 'string',
  );
}

export function readPackageMetadata(moduleUrl: string): PackageMetadata {
  const moduleDir = dirname(fileURLToPath(moduleUrl));
  const candidates = Array.from({ length: 5 }, (_, index) => {
    const segments = index === 0 ? '.' : '../'.repeat(index);
    return join(moduleDir, segments, 'package.json');
  });

  const parsed = candidates
    .flatMap((candidate): Array<{ candidate: string; parsed: PackageMetadata }> => {
      if (!existsSync(candidate)) {
        return [];
      }
      const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as unknown;
      if (!isUsablePackageMetadata(parsed)) {
        return [];
      }
      return [{ candidate, parsed }];
    })
    .sort((left, right) => {
      const leftIsDist = /[/\\]dist[/\\]package\.json$/.test(left.candidate);
      const rightIsDist = /[/\\]dist[/\\]package\.json$/.test(right.candidate);
      if (leftIsDist === rightIsDist) {
        return 0;
      }
      return leftIsDist ? 1 : -1;
    });

  const match = parsed[0]?.parsed;
  if (!match) {
    throw new Error(`Could not locate package.json for ${moduleUrl}`);
  }
  return match;
}
