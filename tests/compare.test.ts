import * as assert from 'assert';
import { parseDump }                  from '../src/parser';
import { compare, generateMigration } from '../src/compare';

function dump(blocks: string[]): ReturnType<typeof parseDump> {
  return parseDump(blocks.join('\n'));
}

function block(name: string, type: string, schema: string, sql: string): string {
  return [
    '--',
    `-- Name: ${name}; Type: ${type}; Schema: ${schema}; Owner: owner`,
    '--',
    '',
    sql,
  ].join('\n');
}

// ─── missing (exists in target, not in source) ────────────────────────────────

describe('compare — missing objects', () => {
  it('detects a missing table', () => {
    const src = dump([]);
    const tgt = dump([block('foo', 'TABLE', 'public', 'CREATE TABLE public.foo (id integer);\nALTER TABLE public.foo OWNER TO owner;')]);
    const findings = compare(src, tgt);
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].kind, 'missing');
    assert.strictEqual(findings[0].category, 'TABLE');
    assert.strictEqual(findings[0].qualifiedName, 'public.foo');
  });

  it('generates CREATE for missing table', () => {
    const src = dump([]);
    const tgt = dump([block('foo', 'TABLE', 'public', 'CREATE TABLE public.foo (id integer);\nALTER TABLE public.foo OWNER TO owner;')]);
    const migration = generateMigration(compare(src, tgt));
    assert.ok(migration.includes('CREATE TABLE public.foo'), 'missing CREATE TABLE');
  });

  it('detects a missing function', () => {
    const src = dump([]);
    const tgt = dump([block('myfn', 'FUNCTION', 'public',
      'CREATE FUNCTION public.myfn() RETURNS void LANGUAGE sql AS $$SELECT 1$$;\nALTER FUNCTION public.myfn() OWNER TO owner;')]);
    const findings = compare(src, tgt);
    assert.strictEqual(findings[0].kind, 'missing');
    assert.strictEqual(findings[0].category, 'FUNCTION');
  });
});

// ─── extra (exists in source, not in target) ──────────────────────────────────

describe('compare — extra objects', () => {
  it('detects an extra table', () => {
    const src = dump([block('foo', 'TABLE', 'public', 'CREATE TABLE public.foo (id integer);\nALTER TABLE public.foo OWNER TO owner;')]);
    const tgt = dump([]);
    const findings = compare(src, tgt);
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].kind, 'extra');
  });

  it('generates DROP TABLE for extra table', () => {
    const src = dump([block('foo', 'TABLE', 'public', 'CREATE TABLE public.foo (id integer);\nALTER TABLE public.foo OWNER TO owner;')]);
    const tgt = dump([]);
    const migration = generateMigration(compare(src, tgt));
    assert.ok(migration.includes('DROP TABLE IF EXISTS public.foo'), migration);
  });

  it('generates DROP FUNCTION for extra function', () => {
    const src = dump([block('myfn', 'FUNCTION', 'public',
      'CREATE FUNCTION public.myfn() RETURNS void LANGUAGE sql AS $$SELECT 1$$;\nALTER FUNCTION public.myfn() OWNER TO owner;')]);
    const tgt = dump([]);
    const migration = generateMigration(compare(src, tgt));
    assert.ok(migration.includes('DROP FUNCTION'), migration);
  });

  it('generates REVOKE for extra grant', () => {
    const src = dump([block('TABLE foo', 'ACL', 'public', 'GRANT SELECT ON TABLE public.foo TO myrole;')]);
    const tgt = dump([]);
    const migration = generateMigration(compare(src, tgt));
    assert.ok(migration.includes('REVOKE SELECT ON TABLE public.foo FROM myrole'), migration);
  });
});

// ─── changed objects ──────────────────────────────────────────────────────────

describe('compare — changed objects', () => {
  it('detects a changed function', () => {
    const src = dump([block('myfn', 'FUNCTION', 'public',
      "CREATE FUNCTION public.myfn() RETURNS void LANGUAGE sql AS $$SELECT 1$$;\nALTER FUNCTION public.myfn() OWNER TO owner;")]);
    const tgt = dump([block('myfn', 'FUNCTION', 'public',
      "CREATE FUNCTION public.myfn() RETURNS void LANGUAGE sql AS $$SELECT 2$$;\nALTER FUNCTION public.myfn() OWNER TO owner;")]);
    const findings = compare(src, tgt);
    assert.strictEqual(findings.length, 1);
    assert.strictEqual(findings[0].kind, 'changed');
  });

  it('generates CREATE OR REPLACE for changed function', () => {
    const src = dump([block('myfn', 'FUNCTION', 'public',
      "CREATE FUNCTION public.myfn() RETURNS void LANGUAGE sql AS $$SELECT 1$$;\nALTER FUNCTION public.myfn() OWNER TO owner;")]);
    const tgt = dump([block('myfn', 'FUNCTION', 'public',
      "CREATE FUNCTION public.myfn() RETURNS void LANGUAGE sql AS $$SELECT 2$$;\nALTER FUNCTION public.myfn() OWNER TO owner;")]);
    const migration = generateMigration(compare(src, tgt));
    assert.ok(migration.includes('CREATE OR REPLACE FUNCTION public.myfn()'), migration);
    assert.ok(migration.includes('SELECT 2'), migration);
  });

  it('detects no change for identical objects', () => {
    const sql = 'CREATE TABLE public.foo (id integer);\nALTER TABLE public.foo OWNER TO owner;';
    const src  = dump([block('foo', 'TABLE', 'public', sql)]);
    const tgt  = dump([block('foo', 'TABLE', 'public', sql)]);
    assert.strictEqual(compare(src, tgt).length, 0);
  });
});

// ─── table column diff ────────────────────────────────────────────────────────

describe('compare — table column changes', () => {
  const base = (cols: string) => block('foo', 'TABLE', 'public',
    `CREATE TABLE public.foo (\n${cols}\n);\nALTER TABLE public.foo OWNER TO owner;`);

  it('generates ADD COLUMN for missing column', () => {
    const src = dump([base('    id integer NOT NULL')]);
    const tgt = dump([base('    id integer NOT NULL,\n    name text')]);
    const migration = generateMigration(compare(src, tgt));
    assert.ok(migration.includes('ADD COLUMN'), migration);
    assert.ok(migration.includes('name'), migration);
  });

  it('generates DROP COLUMN for extra column', () => {
    const src = dump([base('    id integer NOT NULL,\n    name text')]);
    const tgt = dump([base('    id integer NOT NULL')]);
    const migration = generateMigration(compare(src, tgt));
    assert.ok(migration.includes('DROP COLUMN'), migration);
    assert.ok(migration.includes('"name"'), migration);
  });

  it('generates SET NOT NULL for nullability change', () => {
    const src = dump([base('    id integer')]);
    const tgt = dump([base('    id integer NOT NULL')]);
    const migration = generateMigration(compare(src, tgt));
    assert.ok(migration.includes('SET NOT NULL'), migration);
  });
});

// ─── overloaded functions ─────────────────────────────────────────────────────

describe('compare — overloaded functions', () => {
  it('treats functions with different signatures as distinct objects', () => {
    const fn1 = block('myfn', 'FUNCTION', 'public',
      'CREATE FUNCTION public.myfn(x integer) RETURNS void LANGUAGE sql AS $$SELECT 1$$;\nALTER FUNCTION public.myfn(x integer) OWNER TO owner;');
    const fn2 = block('myfn', 'FUNCTION', 'public',
      'CREATE FUNCTION public.myfn(x text) RETURNS void LANGUAGE sql AS $$SELECT 2$$;\nALTER FUNCTION public.myfn(x text) OWNER TO owner;');
    const src = dump([fn1]);
    const tgt = dump([fn2]);
    const findings = compare(src, tgt);
    // fn1(integer) is extra, fn2(text) is missing — not a single "changed"
    assert.strictEqual(findings.length, 2);
    assert.ok(findings.some(f => f.kind === 'missing'), 'expected missing');
    assert.ok(findings.some(f => f.kind === 'extra'),   'expected extra');
  });
});

// ─── dropped table cascades ───────────────────────────────────────────────────

describe('generateMigration — dropped table suppresses dependents', () => {
  const tableSql = (name: string) =>
    block(name, 'TABLE', 'public', `CREATE TABLE public.${name} (id integer);\nALTER TABLE public.${name} OWNER TO owner;`);
  const constraintSql = block('foo_pkey', 'CONSTRAINT', 'public',
    `ALTER TABLE ONLY public.foo ADD CONSTRAINT foo_pkey PRIMARY KEY (id);`);
  const indexSql = block('foo_idx', 'INDEX', 'public',
    `CREATE INDEX foo_idx ON public.foo USING btree (id);`);
  const grantSql = block('TABLE foo', 'ACL', 'public',
    `GRANT SELECT ON TABLE public.foo TO myrole;`);

  it('omits constraints of a dropped table', () => {
    const src = dump([tableSql('foo'), constraintSql]);
    const tgt = dump([]);
    const migration = generateMigration(compare(src, tgt));
    assert.ok(!migration.includes('DROP CONSTRAINT'), migration);
    assert.ok(migration.includes('DROP TABLE IF EXISTS public.foo'), migration);
  });

  it('omits indexes of a dropped table', () => {
    const src = dump([tableSql('foo'), indexSql]);
    const tgt = dump([]);
    const migration = generateMigration(compare(src, tgt));
    assert.ok(!migration.includes('DROP INDEX'), migration);
    assert.ok(migration.includes('DROP TABLE IF EXISTS public.foo'), migration);
  });

  it('omits grants on a dropped table', () => {
    const src = dump([tableSql('foo'), grantSql]);
    const tgt = dump([]);
    const migration = generateMigration(compare(src, tgt));
    assert.ok(!migration.includes('REVOKE'), migration);
    assert.ok(migration.includes('DROP TABLE IF EXISTS public.foo'), migration);
  });

  it('keeps dependents of tables that are NOT dropped', () => {
    const grantOnBar = block('TABLE bar', 'ACL', 'public', 'GRANT SELECT ON TABLE public.bar TO myrole;');
    const src = dump([tableSql('foo'), tableSql('bar'), grantOnBar]);
    const tgt = dump([tableSql('bar')]);
    const migration = generateMigration(compare(src, tgt));
    assert.ok(migration.includes('DROP TABLE IF EXISTS public.foo'), migration);
    assert.ok(migration.includes('REVOKE SELECT ON TABLE public.bar FROM myrole'), 'grant on bar should still be revoked');
  });
});

// ─── whitespace normalization ─────────────────────────────────────────────────

describe('compare — whitespace normalization', () => {
  it('treats objects with only whitespace differences as identical', () => {
    const src = dump([block('myfn', 'FUNCTION', 'public',
      'CREATE FUNCTION public.myfn() RETURNS void LANGUAGE sql AS $$SELECT 1$$;\nALTER FUNCTION public.myfn() OWNER TO owner;')]);
    const tgt = dump([block('myfn', 'FUNCTION', 'public',
      'CREATE FUNCTION public.myfn()  RETURNS void  LANGUAGE sql AS $$SELECT 1$$;\nALTER FUNCTION public.myfn()  OWNER TO owner;')]);
    assert.strictEqual(compare(src, tgt).length, 0);
  });
});

// ─── generateMigration ordering ───────────────────────────────────────────────

describe('generateMigration — ordering', () => {
  it('emits missing before extra within the same category', () => {
    const src = dump([block('old', 'TABLE', 'public', 'CREATE TABLE public.old (id integer);\nALTER TABLE public.old OWNER TO owner;')]);
    const tgt = dump([block('new', 'TABLE', 'public', 'CREATE TABLE public.new (id integer);\nALTER TABLE public.new OWNER TO owner;')]);
    const migration = generateMigration(compare(src, tgt));
    const missingIdx = migration.indexOf('MISSING');
    const extraIdx   = migration.indexOf('EXTRA');
    assert.ok(missingIdx < extraIdx, 'missing should come before extra');
  });
});
