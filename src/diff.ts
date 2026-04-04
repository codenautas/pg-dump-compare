import { spawnSync } from 'child_process';
import * as fs from 'fs';

export function generateDiff(sourceFile: string, targetFile: string, outFile: string): void {
  const out = fs.openSync(outFile, 'w');
  try {
    const result = spawnSync(
      'git',
      ['diff', '--no-index', '--ignore-blank-lines', '-w', '--', sourceFile, targetFile],
      { stdio: ['ignore', out, 'pipe'] }
    );
    // git diff exits with 0 (identical) or 1 (differ) — both are success
    if (result.status !== 0 && result.status !== 1) {
      const msg = result.stderr ? result.stderr.toString() : `git exited with code ${result.status}`;
      throw new Error(msg);
    }
  } finally {
    fs.closeSync(out);
  }
}
