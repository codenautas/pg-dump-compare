import * as assert from 'assert';
import * as fs     from 'fs';
import * as path   from 'path';

import { parseDump }    from '../src/parser';
import { canonicalize } from '../src/canonicalize';

const DUMP1 = path.join(__dirname, 'fixtures', 'dump1.sql');
const raw   = fs.readFileSync(DUMP1, 'utf-8');

// ─── parser ──────────────────────────────────────────────────────────────────

describe('parseDump', () => {
  it('produces a non-empty preamble', () => {
    const { preamble } = parseDump(raw);
    assert.ok(preamble.length > 0);
  });

  it('finds all expected block types', () => {
    const { blocks } = parseDump(raw);
    const types = new Set(blocks.map(b => b.toc.type.toUpperCase()));
    assert.ok(types.has('SCHEMA'),    'missing SCHEMA');
    assert.ok(types.has('TABLE'),     'missing TABLE');
    assert.ok(types.has('FUNCTION'),  'missing FUNCTION');
    assert.ok(types.has('SEQUENCE'),  'missing SEQUENCE');
    assert.ok(types.has('TABLE DATA'),'missing TABLE DATA');
  });

  it('captures sql lines for each block', () => {
    const { blocks } = parseDump(raw);
    const withSql = blocks.filter(b => b.sqlLines.length > 0);
    assert.ok(withSql.length > 0, 'no blocks with sql lines');
  });

  it('has a non-empty footer', () => {
    const { footer } = parseDump(raw);
    assert.ok(footer.length > 0, 'footer is empty');
    assert.ok(footer.some(l => /PostgreSQL database dump complete/.test(l)));
  });
});

// ─── canonicalize — timestamps ────────────────────────────────────────────────

describe('canonicalize — timestamps', () => {
  let result: string;
  before(() => { result = canonicalize(parseDump(raw)); });

  it('removes "Started on" timestamp', () => {
    assert.ok(!result.includes('-- Started on'));
  });

  it('removes "Completed on" timestamp', () => {
    assert.ok(!result.includes('-- Completed on'));
  });

  it('keeps "PostgreSQL database dump complete"', () => {
    assert.ok(result.includes('PostgreSQL database dump complete'));
  });
});

// ─── canonicalize — TOC cleanup ───────────────────────────────────────────────

describe('canonicalize — TOC cleanup', () => {
  let result: string;
  before(() => { result = canonicalize(parseDump(raw)); });

  it('removes TOC entry comments', () => {
    assert.ok(!result.includes('-- TOC entry'));
  });

  it('removes OID references', () => {
    assert.ok(!/ OID \d+/.test(result));
  });
});

// ─── canonicalize — data removal ─────────────────────────────────────────────

describe('canonicalize — data removal', () => {
  let result: string;
  before(() => { result = canonicalize(parseDump(raw)); });

  it('removes COPY … FROM stdin blocks', () => {
    assert.ok(!result.includes('FROM stdin'));
  });

  it('removes setval calls', () => {
    assert.ok(!result.includes('setval'));
  });
});

// ─── canonicalize — section order ────────────────────────────────────────────

describe('canonicalize — section order', () => {
  let result: string;
  before(() => { result = canonicalize(parseDump(raw)); });

  it('places TYPE before FUNCTION', () => {
    const ti = result.indexOf('CREATE TYPE');
    const fi = result.indexOf('CREATE FUNCTION');
    assert.ok(ti !== -1 && fi !== -1, 'TYPE or FUNCTION not found');
    assert.ok(ti < fi, `TYPE (${ti}) should precede FUNCTION (${fi})`);
  });

  it('places TABLE before CONSTRAINT', () => {
    const ti = result.indexOf('CREATE TABLE');
    const ci = result.indexOf('ADD CONSTRAINT');
    assert.ok(ti !== -1 && ci !== -1, 'TABLE or CONSTRAINT not found');
    assert.ok(ti < ci, `TABLE (${ti}) should precede CONSTRAINT (${ci})`);
  });

  it('places CONSTRAINT before INDEX', () => {
    const ci = result.indexOf('ADD CONSTRAINT');
    const ii = result.indexOf('CREATE INDEX');
    assert.ok(ci !== -1 && ii !== -1, 'CONSTRAINT or INDEX not found');
    assert.ok(ci < ii, `CONSTRAINT (${ci}) should precede INDEX (${ii})`);
  });

  it('places INDEX before TRIGGER', () => {
    // Use /^CREATE .../m so we don't match inside function bodies
    const ii = result.search(/^CREATE INDEX\b/m);
    const ti = result.search(/^CREATE TRIGGER\b/m);
    assert.ok(ii !== -1 && ti !== -1, 'INDEX or TRIGGER not found');
    assert.ok(ii < ti, `INDEX (${ii}) should precede TRIGGER (${ti})`);
  });

  it('places GRANT last (after TRIGGER)', () => {
    const ti = result.search(/^CREATE TRIGGER\b/m);
    const gi = result.search(/^GRANT\b/m);
    assert.ok(ti !== -1 && gi !== -1, 'TRIGGER or GRANT not found');
    assert.ok(ti < gi, `TRIGGER (${ti}) should precede GRANT (${gi})`);
  });
});

// ─── canonicalize — extra settings ───────────────────────────────────────────

describe('canonicalize — extra settings', () => {
  let result: string;
  before(() => { result = canonicalize(parseDump(raw)); });

  it('moves SET default_tablespace before CREATE TABLE', () => {
    const si = result.indexOf('SET default_tablespace');
    const ti = result.indexOf('CREATE TABLE');
    assert.ok(si !== -1, 'SET default_tablespace not found');
    assert.ok(si < ti, 'SET default_tablespace should precede CREATE TABLE');
  });

  it('moves SET default_table_access_method before CREATE TABLE', () => {
    const si = result.indexOf('SET default_table_access_method');
    const ti = result.indexOf('CREATE TABLE');
    assert.ok(si !== -1, 'SET default_table_access_method not found');
    assert.ok(si < ti, 'SET default_table_access_method should precede CREATE TABLE');
  });
});

// ─── canonicalize — owner options ────────────────────────────────────────────

describe('canonicalize — owner options', () => {
  it('keeps OWNER TO by default', () => {
    const result = canonicalize(parseDump(raw));
    assert.ok(result.includes('OWNER TO'));
  });

  it('removes all OWNER TO with -no-owner', () => {
    const result = canonicalize(parseDump(raw), { noOwner: true });
    assert.ok(!result.includes('OWNER TO'), 'OWNER TO still present with -no-owner');
  });

  it('simplifies owner name with -can-owner', () => {
    const result = canonicalize(parseDump(raw), { canOwner: true });
    assert.ok(result.includes('OWNER TO owner'), 'expected simplified "owner" suffix');
    assert.ok(!result.includes('OWNER TO ejemplo_muleto_owner'), 'full owner name still present');
  });

  it('removes GRANT lines with -no-owner', () => {
    const result = canonicalize(parseDump(raw), { noOwner: true });
    assert.ok(!/^GRANT\b/m.test(result), 'GRANT lines still present with -no-owner');
  });

  it('simplifies role in GRANT with -can-owner', () => {
    const result = canonicalize(parseDump(raw), { canOwner: true });
    assert.ok(!result.includes('TO ejemplo_muleto_admin'), 'full role name in GRANT still present');
    assert.ok(result.includes('TO admin;'), 'expected simplified role in GRANT');
  });

  it('simplifies role in CREATE POLICY with -can-owner', () => {
    const result = canonicalize(parseDump(raw), { canOwner: true });
    assert.ok(!result.includes('TO ejemplo_muleto_admin USING'), 'full role name in POLICY still present');
  });

  it('removes TO clause from CREATE POLICY with -no-owner', () => {
    const result = canonicalize(parseDump(raw), { noOwner: true });
    // Policy should still exist but without TO role_name
    assert.ok(result.search(/^CREATE POLICY\b/m) !== -1, 'CREATE POLICY missing entirely');
    assert.ok(!result.includes('TO ejemplo_muleto_admin'), 'role name still in POLICY with -no-owner');
  });
});

// ─── canonicalize — alphabetical order within category ───────────────────────

describe('canonicalize — alphabetical ordering', () => {
  it('sorts functions alphabetically by qualified name', () => {
    const result = canonicalize(parseDump(raw));
    const lines  = result.split('\n');
    const fnLines = lines.filter(l => /^CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\b/i.test(l));
    const names   = fnLines.map(l => {
      const m = l.match(/^CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([\w.]+)/i);
      return m ? m[1] : '';
    }).filter(Boolean);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    assert.deepStrictEqual(names, sorted, `functions not sorted: ${names.join(', ')}`);
  });
});

// ─── dump3: no-TOC format ────────────────────────────────────────────────────

describe('dump3 — pg_dump without TOC entries', () => {
  const DUMP3  = path.join(__dirname, 'fixtures', 'dump3.sql');
  const raw3   = fs.readFileSync(DUMP3, 'utf-8');

  it('parses blocks even without TOC entry lines', () => {
    const { blocks } = parseDump(raw3);
    assert.ok(blocks.length > 0, 'no blocks parsed from dump3');
  });

  it('finds expected object types', () => {
    const { blocks } = parseDump(raw3);
    const types = new Set(blocks.map(b => b.toc.type.toUpperCase()));
    assert.ok(types.has('SCHEMA'),   'missing SCHEMA');
    assert.ok(types.has('TABLE'),    'missing TABLE');
    assert.ok(types.has('FUNCTION'), 'missing FUNCTION');
  });

  it('removes TOC-style block header comments', () => {
    const result = canonicalize(parseDump(raw3));
    assert.ok(!result.includes('; Type:'), 'block header comment still present');
  });

  it('removes COPY data (with header comment)', () => {
    const result = canonicalize(parseDump(raw3));
    assert.ok(!result.includes('FROM stdin'), 'COPY data still present');
  });

  it('removes inline COPY data (without header comment)', () => {
    // dump3 line 221: COPY siper.tipos_domicilio … appears without its own header
    const result = canonicalize(parseDump(raw3));
    assert.ok(!result.includes('tipos_domicilio') || !result.includes('FROM stdin'),
      'bare COPY block not removed');
  });

  it('removes setval calls', () => {
    const result = canonicalize(parseDump(raw3));
    assert.ok(!result.includes('setval'), 'setval still present');
  });

  it('orders objects correctly', () => {
    const result = canonicalize(parseDump(raw3));
    const typeIdx = result.indexOf('CREATE TYPE');
    const funcIdx = result.search(/^CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\b/m);
    const tblIdx  = result.indexOf('CREATE TABLE');
    assert.ok(typeIdx !== -1 && funcIdx !== -1 && tblIdx !== -1, 'missing object types');
    assert.ok(typeIdx < funcIdx, 'TYPE should precede FUNCTION');
    assert.ok(funcIdx < tblIdx,  'FUNCTION should precede TABLE');
  });

  it('is idempotent', () => {
    const first  = canonicalize(parseDump(raw3));
    const second = canonicalize(parseDump(first));
    assert.strictEqual(first, second, 'not idempotent on dump3');
  });
});

// ─── canonicalize — idempotency ───────────────────────────────────────────────

describe('canonicalize — idempotency', () => {
  it('produces the same output when applied twice', () => {
    const first  = canonicalize(parseDump(raw));
    const second = canonicalize(parseDump(first));
    assert.strictEqual(first, second, 'canonicalize is not idempotent');
  });
});
