import * as assert from 'assert';
import * as fs     from 'fs';
import * as os     from 'os';
import * as path   from 'path';

import { generateDiff } from '../src/diff';

function tmpFile(content: string): string {
  const file = path.join(os.tmpdir(), `pg-dump-diff-test-${Math.random().toString(36).slice(2)}.sql`);
  fs.writeFileSync(file, content);
  return file;
}

function runDiff(a: string, b: string): string {
  const fileA  = tmpFile(a);
  const fileB  = tmpFile(b);
  const outFile = tmpFile('');
  try {
    generateDiff(fileA, fileB, outFile);
    return fs.readFileSync(outFile, 'utf-8');
  } finally {
    fs.rmSync(fileA,   { force: true });
    fs.rmSync(fileB,   { force: true });
    fs.rmSync(outFile, { force: true });
  }
}

function hasDiffHunk(patch: string): boolean {
  return patch.split('\n').some(l => l.startsWith('+') || l.startsWith('-'));
}

describe('generateDiff — whitespace ignored', () => {
  it('produces no diff for identical files', () => {
    const content = 'CREATE TABLE foo (id integer);\n';
    const patch   = runDiff(content, content);
    assert.ok(!hasDiffHunk(patch), 'identical files should produce no diff');
  });

  it('ignores differences in leading/trailing spaces within a line', () => {
    const a = 'CREATE TABLE foo (id integer);\n';
    const b = '  CREATE TABLE foo (id integer);  \n';
    const patch = runDiff(a, b);
    assert.ok(!hasDiffHunk(patch), 'leading/trailing space difference should be ignored');
  });

  it('ignores differences in internal whitespace (spaces vs tabs)', () => {
    const a = 'CREATE TABLE foo (id  integer);\n';
    const b = 'CREATE TABLE foo (id\t\tinteger);\n';
    const patch = runDiff(a, b);
    assert.ok(!hasDiffHunk(patch), 'internal whitespace difference should be ignored');
  });

  it('ignores blank-line-only differences', () => {
    const a = 'CREATE TABLE foo (id integer);\n';
    const b = 'CREATE TABLE foo (id integer);\n\n\n';
    const patch = runDiff(a, b);
    assert.ok(!hasDiffHunk(patch), 'blank line difference should be ignored');
  });

  it('ignores a blank line inserted between two statements', () => {
    const a = 'CREATE TABLE foo (id integer);\nCREATE TABLE bar (id integer);\n';
    const b = 'CREATE TABLE foo (id integer);\n\nCREATE TABLE bar (id integer);\n';
    const patch = runDiff(a, b);
    assert.ok(!hasDiffHunk(patch), 'inserted blank line should be ignored');
  });

  it('still detects real content differences', () => {
    const a = 'CREATE TABLE foo (id integer);\n';
    const b = 'CREATE TABLE foo (id text);\n';
    const patch = runDiff(a, b);
    assert.ok(hasDiffHunk(patch), 'real content difference should appear in diff');
  });

  it('still detects added statements', () => {
    const a = 'CREATE TABLE foo (id integer);\n';
    const b = 'CREATE TABLE foo (id integer);\nCREATE TABLE bar (id integer);\n';
    const patch = runDiff(a, b);
    assert.ok(hasDiffHunk(patch), 'added statement should appear in diff');
  });
});
