#!/usr/bin/env node
import * as fs   from 'fs';
import * as path from 'path';

import { parseDump }      from './parser';
import { canonicalize }   from './canonicalize';
import { generateDiff }   from './diff';
import { CanonicalOptions } from './types';

function parseOwnerOpts(args: string[]): CanonicalOptions {
  return {
    noOwner: args.includes('-no-owner'),
    canOwner: args.includes('-can-owner'),
  };
}

function canSuffix(file: string): string {
  return file.replace(/(\.[^./\\]+)?$/, '.can.sql');
}

function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log([
      'Usage:',
      '  pg-dump-compare SOURCE TARGET [-o OUTPUT_PATH] [-no-owner] [-can-owner]',
      '  pg-dump-compare --canonical DUMP_FILE [-o CANONICAL_FILE] [-no-owner] [-can-owner]',
      '',
      'Options:',
      '  -o PATH        Output path (default: pg-dump-compare-results / <dump>.can.sql)',
      '  -no-owner      Remove all OWNER TO clauses',
      '  -can-owner     Simplify owner names to the suffix after the last underscore',
    ].join('\n'));
    process.exit(0);
  }

  const opts = parseOwnerOpts(args);

  // ── canonical mode ─────────────────────────────────────────────────────────
  if (args.includes('--canonical')) {
    const idx      = args.indexOf('--canonical');
    const dumpFile = args[idx + 1];
    if (!dumpFile) {
      console.error('Error: --canonical requires a DUMP_FILE argument');
      process.exit(1);
    }

    const oIdx    = args.indexOf('-o');
    const outFile = oIdx >= 0 ? args[oIdx + 1] : canSuffix(dumpFile);

    const content   = fs.readFileSync(dumpFile, 'utf-8');
    const canonical = canonicalize(parseDump(content), opts);
    fs.writeFileSync(outFile, canonical);
    console.log(`Written: ${outFile}`);
    return;
  }

  // ── compare mode ───────────────────────────────────────────────────────────
  const positional = args.filter(a => !a.startsWith('-') && a !== args[args.indexOf('-o') + 1]);
  if (positional.length < 2) {
    console.error('Error: SOURCE and TARGET are required');
    process.exit(1);
  }

  const [source, target] = positional;
  const oIdx             = args.indexOf('-o');
  const outputPath       = oIdx >= 0 ? args[oIdx + 1] : 'pg-dump-compare-results';

  fs.mkdirSync(outputPath, { recursive: true });

  const sourceCanFile = path.join(outputPath, canSuffix(path.basename(source)));
  const targetCanFile = path.join(outputPath, canSuffix(path.basename(target)));

  const sourceCanonical = canonicalize(parseDump(fs.readFileSync(source, 'utf-8')), opts);
  const targetCanonical = canonicalize(parseDump(fs.readFileSync(target, 'utf-8')), opts);

  fs.writeFileSync(sourceCanFile, sourceCanonical);
  fs.writeFileSync(targetCanFile, targetCanonical);
  console.log(`Written: ${sourceCanFile}`);
  console.log(`Written: ${targetCanFile}`);

  const diffFile = path.join(outputPath, 'only.diff');
  generateDiff(sourceCanFile, targetCanFile, diffFile);
  console.log(`Written: ${diffFile}`);
}

main();
