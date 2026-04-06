#!/usr/bin/env node
import * as fs   from 'fs';
import * as path from 'path';

import { parseDump }              from './parser';
import { canonicalize }           from './canonicalize';
import { generateDiff }           from './diff';
import { compare, generateMigration } from './compare';
import { CanonicalOptions }       from './types';

function parseOwnerOpts(args: string[]): CanonicalOptions {
  const inRolesIdx = args.indexOf('-in-roles');
  return {
    noRoles: args.includes('-no-roles'),
    canRoles: args.includes('-can-roles'),
    inRoles: inRolesIdx >= 0 ? args[inRolesIdx + 1] : undefined,
    orderTableInternally: args.includes('-oti'),
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
      '  pg-dump-compare SOURCE TARGET [-o OUTPUT_PATH] [-no-roles] [-can-roles] [-in-roles S/T] [-oti]',
      '  pg-dump-compare --canonical DUMP_FILE [-o CANONICAL_FILE] [-no-roles] [-can-roles] [-in-roles S/T] [-oti]',
      '  pg-dump-compare --migrate SOURCE TARGET [-o OUTPUT_PATH] [-no-roles] [-can-roles] [-in-roles S/T]',
      '',
      'Options:',
      '  -o PATH          Output path (default: pg-dump-compare-results / <dump>.can.sql)',
      '  -no-roles        Remove all OWNER TO and GRANT statements',
      '  -can-roles       Shorten role names to suffix after last underscore',
      '  -in-roles S/T    Replace internal part of role names (e.g. _prod_/_staging_)',
      '  -oti             Order table columns and constraints alphabetically',
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

  // ── migrate mode ───────────────────────────────────────────────────────────
  if (args.includes('--migrate')) {
    const cmpOIdx    = args.indexOf('-o');
    const oValue     = cmpOIdx >= 0 ? args[cmpOIdx + 1] : null;
    const positional = args.filter(a => !a.startsWith('-') && a !== '--migrate' && a !== oValue);
    if (positional.length < 2) {
      console.error('Error: --migrate requires SOURCE and TARGET');
      process.exit(1);
    }

    const [source, target] = positional;
    const outputPath       = cmpOIdx >= 0 ? args[cmpOIdx + 1] : 'pg-dump-compare-results';

    fs.mkdirSync(outputPath, { recursive: true });

    const sourceDump = parseDump(fs.readFileSync(source, 'utf-8'));
    const targetDump = parseDump(fs.readFileSync(target, 'utf-8'));

    const findings  = compare(sourceDump, targetDump, opts);
    const migration = generateMigration(findings);

    const migrateFile = path.join(outputPath, 'migrate.sql');
    fs.writeFileSync(migrateFile, migration);
    console.log(`Written: ${migrateFile}`);
    console.log(`  ${findings.filter(f => f.kind === 'missing').length} missing, ` +
                `${findings.filter(f => f.kind === 'changed').length} changed, ` +
                `${findings.filter(f => f.kind === 'extra').length} extra`);
    return;
  }

  // ── compare mode ───────────────────────────────────────────────────────────
  const cmpOIdx    = args.indexOf('-o');
  const oValue     = cmpOIdx >= 0 ? args[cmpOIdx + 1] : null;
  const positional = args.filter(a => !a.startsWith('-') && a !== oValue);
  if (positional.length < 2) {
    console.error('Error: SOURCE and TARGET are required');
    process.exit(1);
  }

  const [source, target] = positional;
  const outputPath       = cmpOIdx >= 0 ? args[cmpOIdx + 1] : 'pg-dump-compare-results';

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
