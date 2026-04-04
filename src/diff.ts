import { execSync } from 'child_process';
import * as fs from 'fs';

export function generateDiff(sourceFile: string, targetFile: string, outFile: string): void {
  let patch: string;
  try {
    patch = execSync(
      `git diff --no-index --ignore-blank-lines -w -- "${sourceFile}" "${targetFile}"`,
      { encoding: 'utf-8' }
    );
  } catch (err: unknown) {
    const e = err as { status?: number; stdout?: string };
    // git diff exits with code 1 when files differ — not an error
    if (e.status === 1 && e.stdout !== undefined) {
      patch = e.stdout;
    } else {
      throw err;
    }
  }
  fs.writeFileSync(outFile, patch);
}
