/**
 * Integration (golden file) tests.
 *
 * Each test produces output in-memory and compares it against a committed
 * fixture. If behaviour changes intentionally, regenerate the fixtures:
 *
 *   node dist/cli.js --canonical tests/fixtures/dump1.sql \
 *       -o tests/fixtures/dump1.oti-no-roles.can.sql -oti -no-roles
 *
 *   node dist/cli.js --canonical tests/fixtures/dump3.sql \
 *       -o tests/fixtures/dump3.can.sql
 *
 *   node dist/cli.js tests/fixtures/dump1.sql tests/fixtures/dump2.sql \
 *       -o tests/fixtures -can-roles
 *
 * Then commit the updated fixtures so the diff is visible in git history.
 */

import * as assert from 'assert';
import * as fs     from 'fs';
import * as os     from 'os';
import * as path   from 'path';

import { parseDump }    from '../src/parser';
import { canonicalize } from '../src/canonicalize';
import { generateDiff } from '../src/diff';

const FIXTURES = path.join(__dirname, 'fixtures');

function read(name: string): string {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf-8');
}

// ─── canonicalize dump1 with -oti -no-roles ───────────────────────────────────

describe('integration — canonicalize dump1 (-oti -no-roles)', () => {
  let result: string;
  before(() => {
    result = canonicalize(parseDump(read('dump1.sql')), {
      orderTableInternally: true,
      noRoles: true,
    });
  });

  it('matches golden file dump1.oti-no-roles.can.sql', () => {
    const golden = read('dump1.oti-no-roles.can.sql');
    assert.strictEqual(result, golden,
      'Output differs from golden file. If the change is intentional, regenerate:\n' +
      '  node dist/cli.js --canonical tests/fixtures/dump1.sql ' +
      '-o tests/fixtures/dump1.oti-no-roles.can.sql -oti -no-roles');
  });
});

// ─── canonicalize dump3 (no options) ─────────────────────────────────────────

describe('integration — canonicalize dump3 (no options)', () => {
  let result: string;
  before(() => {
    result = canonicalize(parseDump(read('dump3.sql')));
  });

  it('matches golden file dump3.can.sql', () => {
    const golden = read('dump3.can.sql');
    assert.strictEqual(result, golden,
      'Output differs from golden file. If the change is intentional, regenerate:\n' +
      '  node dist/cli.js --canonical tests/fixtures/dump3.sql ' +
      '-o tests/fixtures/dump3.can.sql');
  });
});

// ─── compare dump1 vs dump2 with -can-roles ───────────────────────────────────

describe('integration — diff dump1 vs dump2 (-can-roles)', () => {
  let tmpDir: string;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-dump-compare-test-'));

    const can1 = canonicalize(parseDump(read('dump1.sql')), { canRoles: true });
    const can2 = canonicalize(parseDump(read('dump2.sql')), { canRoles: true });

    const file1 = path.join(tmpDir, 'dump1.can.sql');
    const file2 = path.join(tmpDir, 'dump2.can.sql');
    fs.writeFileSync(file1, can1);
    fs.writeFileSync(file2, can2);

    generateDiff(file1, file2, path.join(tmpDir, 'only.diff'));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('canonical dump1 matches golden file dump1.can.sql', () => {
    const result = canonicalize(parseDump(read('dump1.sql')), { canRoles: true });
    const golden = read('dump1.can.sql');
    assert.strictEqual(result, golden,
      'dump1 canonical differs from golden. Regenerate:\n' +
      '  node dist/cli.js tests/fixtures/dump1.sql tests/fixtures/dump2.sql ' +
      '-o tests/fixtures -can-roles');
  });

  it('canonical dump2 matches golden file dump2.can.sql', () => {
    const result = canonicalize(parseDump(read('dump2.sql')), { canRoles: true });
    const golden = read('dump2.can.sql');
    assert.strictEqual(result, golden,
      'dump2 canonical differs from golden. Regenerate:\n' +
      '  node dist/cli.js tests/fixtures/dump1.sql tests/fixtures/dump2.sql ' +
      '-o tests/fixtures -can-roles');
  });

  it('diff matches golden file only.diff', () => {
    const goldenDiff = read('only.diff');
    const resultDiff = fs.readFileSync(path.join(tmpDir, 'only.diff'), 'utf-8');

    // Normalise file paths in the diff headers (they will differ between runs)
    const normalise = (s: string) =>
      s
        .replace(/^diff --git .+$/gm, 'diff --git a/<path> b/<path>')
        .replace(/^index [0-9a-f]+\.\.[0-9a-f]+ \d+$/gm, 'index <hash>..<hash> <mode>')
        .replace(/^(---|\+\+\+) .+$/gm, (_, prefix) => `${prefix} <path>`);

    assert.strictEqual(normalise(resultDiff), normalise(goldenDiff),
      'Diff output differs from golden. Regenerate:\n' +
      '  node dist/cli.js tests/fixtures/dump1.sql tests/fixtures/dump2.sql ' +
      '-o tests/fixtures -can-roles');
  });
});
