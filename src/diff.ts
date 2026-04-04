import { execSync } from 'child_process';
import * as fs from 'fs';

export function generateDiff(sourceFile: string, targetFile: string, outFile: string): void {
  try {
    const result = execSync(`diff -u "${sourceFile}" "${targetFile}"`, { encoding: 'utf-8' });
    fs.writeFileSync(outFile, result);
  } catch (err: unknown) {
    const e = err as { status?: number; stdout?: string };
    // diff exits with code 1 when files differ — not an error condition
    if (e.status === 1 && e.stdout !== undefined) {
      fs.writeFileSync(outFile, e.stdout);
    } else {
      throw err;
    }
  }
}
