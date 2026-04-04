import * as fs from 'fs';
import { createTwoFilesPatch } from 'diff';

export function generateDiff(sourceFile: string, targetFile: string, outFile: string): void {
  const source = fs.readFileSync(sourceFile, 'utf-8');
  const target = fs.readFileSync(targetFile, 'utf-8');
  const patch  = createTwoFilesPatch(sourceFile, targetFile, source, target, '', '', { ignoreWhitespace: true });
  fs.writeFileSync(outFile, patch);
}
