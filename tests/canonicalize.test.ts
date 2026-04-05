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

  it('removes all OWNER TO with -no-roles', () => {
    const result = canonicalize(parseDump(raw), { noRoles: true });
    assert.ok(!result.includes('OWNER TO'), 'OWNER TO still present with -no-roles');
  });

  it('simplifies owner name with -can-roles', () => {
    const result = canonicalize(parseDump(raw), { canRoles: true });
    assert.ok(result.includes('OWNER TO _owner'), 'expected simplified "owner" suffix');
    assert.ok(!result.includes('OWNER TO ejemplo_muleto_owner'), 'full owner name still present');
  });

  it('removes GRANT lines with -no-roles', () => {
    const result = canonicalize(parseDump(raw), { noRoles: true });
    assert.ok(!/^GRANT\b/m.test(result), 'GRANT lines still present with -no-roles');
  });

  it('simplifies role in GRANT with -can-roles', () => {
    const result = canonicalize(parseDump(raw), { canRoles: true });
    assert.ok(!result.includes('TO ejemplo_muleto_admin'), 'full role name in GRANT still present');
    assert.ok(result.includes('TO _admin;'), 'expected simplified role in GRANT');
  });

  it('simplifies role in CREATE POLICY with -can-roles', () => {
    const result = canonicalize(parseDump(raw), { canRoles: true });
    assert.ok(!result.includes('TO ejemplo_muleto_admin USING'), 'full role name in POLICY still present');
  });

  it('removes TO clause from CREATE POLICY with -no-roles', () => {
    const result = canonicalize(parseDump(raw), { noRoles: true });
    // Policy should still exist but without TO role_name
    assert.ok(result.search(/^CREATE POLICY\b/m) !== -1, 'CREATE POLICY missing entirely');
    assert.ok(!result.includes('TO ejemplo_muleto_admin'), 'role name still in POLICY with -no-roles');
  });
});

// ─── canonicalize — -rep-roles ────────────────────────────────────────────────

describe('canonicalize — -rep-roles', () => {
  // dump1 uses roles like "ejemplo_muleto_owner", "ejemplo_muleto_admin"
  // middle part is "_muleto_"

  it('replaces middle part in OWNER TO', () => {
    const result = canonicalize(parseDump(raw), { repRoles: '_muleto_/_prod_' });
    assert.ok(result.includes('OWNER TO ejemplo_prod_owner'), 'middle part not replaced in OWNER TO');
    assert.ok(!result.includes('ejemplo_muleto_owner'), 'original role still present');
  });

  it('replaces middle part in GRANT', () => {
    const result = canonicalize(parseDump(raw), { repRoles: '_muleto_/_prod_' });
    assert.ok(result.includes('TO ejemplo_prod_admin;'), 'middle part not replaced in GRANT');
  });

  it('removes middle part when target is "_"', () => {
    // _muleto_ → _ : ejemplo_muleto_owner → ejemplo_owner
    const result = canonicalize(parseDump(raw), { repRoles: '_muleto_/_' });
    assert.ok(result.includes('OWNER TO ejemplo_owner'), 'middle not removed');
    assert.ok(!result.includes('ejemplo_muleto_'), 'original middle still present');
  });

  it('adds a middle part when source is "_"', () => {
    // _ → _staging_ : app_owner (no middle) → app_staging_owner
    const simple = [
      '--',
      '-- Name: foo; Type: TABLE; Schema: public; Owner: app_owner',
      '--',
      '',
      'CREATE TABLE public.foo (id integer);',
      'ALTER TABLE public.foo OWNER TO app_owner;',
    ].join('\n');
    const result = canonicalize(parseDump(simple), { repRoles: '_/_staging_' });
    assert.ok(result.includes('OWNER TO app_staging_owner'), `expected app_staging_owner, got: ${result}`);
  });

  it('does not replace when source appears more than once', () => {
    // role "ab_x_x_cd" has "_x_" twice — should not be replaced
    const simple = [
      '--',
      '-- Name: foo; Type: TABLE; Schema: public; Owner: ab_x_x_cd',
      '--',
      '',
      'CREATE TABLE public.foo (id integer);',
      'ALTER TABLE public.foo OWNER TO ab_x_x_cd;',
    ].join('\n');
    const result = canonicalize(parseDump(simple), { repRoles: '_x_/_y_' });
    assert.ok(result.includes('OWNER TO ab_x_x_cd'), 'ambiguous role was replaced');
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

// ─── -oti: order table internally ────────────────────────────────────────────

describe('canonicalize — -oti (order table internally)', () => {
  // Wrap in a block header so parseDump recognises it as a TABLE block
  function wrapTable(body: string): string {
    return [
      '--',
      '-- Name: grupos; Type: TABLE; Schema: ejemplo; Owner: ejemplo_muleto_owner',
      '--',
      '',
      body,
    ].join('\n');
  }

  const TABLE_BODY = [
    'CREATE TABLE ejemplo.grupos (',
    '    clase text NOT NULL,',
    '    grupo text NOT NULL,',
    '    descripcion text,',
    "    CONSTRAINT \"clase<>''\" CHECK ((clase <> ''::text)),",
    "    CONSTRAINT \"grupo<>''\" CHECK ((grupo <> ''::text)),",
    "    CONSTRAINT \"descripcion<>''\" CHECK ((descripcion <> ''::text))",
    ');',
    '',
    'ALTER TABLE ejemplo.grupos OWNER TO ejemplo_muleto_owner;',
  ].join('\n');

  const TABLE_SQL = wrapTable(TABLE_BODY);

  function canonical(sql: string, opts = {}): string {
    return canonicalize(parseDump(sql), opts);
  }

  it('sorts columns alphabetically', () => {
    const result = canonical(TABLE_SQL, { orderTableInternally: true });
    const cols = result.split('\n')
      .filter(l => /^\s+(clase|grupo|descripcion)\s/.test(l))
      .map(l => l.trim().split(/\s+/)[0]);
    assert.deepStrictEqual(cols, ['clase', 'descripcion', 'grupo']);
  });

  it('places columns before constraints', () => {
    const result = canonical(TABLE_SQL, { orderTableInternally: true });
    const lastCol  = result.lastIndexOf('    grupo text');
    const firstCon = result.indexOf('    CONSTRAINT');
    assert.ok(lastCol < firstCon, 'columns should come before constraints');
  });

  it('sorts constraints alphabetically', () => {
    const result = canonical(TABLE_SQL, { orderTableInternally: true });
    const names = [...result.matchAll(/CONSTRAINT "([^"]+)"/g)].map(m => m[1]);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    assert.deepStrictEqual(names, sorted, `constraints not sorted: ${names.join(', ')}`);
  });

  it('does not add a trailing comma on the last element', () => {
    const result = canonical(TABLE_SQL, { orderTableInternally: true });
    const lines = result.split('\n');
    const closeIdx = lines.findIndex(l => /^\s*\);/.test(l));
    assert.ok(closeIdx > 0, 'closing ); not found');
    let lastItem = closeIdx - 1;
    while (lastItem > 0 && lines[lastItem].trim() === '') lastItem--;
    assert.ok(!lines[lastItem].trimEnd().endsWith(','),
      `last item before ); should not end with comma: ${JSON.stringify(lines[lastItem])}`);
  });

  it('adds a comma after every non-last element', () => {
    const result = canonical(TABLE_SQL, { orderTableInternally: true });
    const lines = result.split('\n');
    const closeIdx = lines.findIndex(l => /^\s*\);/.test(l));
    const createIdx = lines.findIndex(l => /^CREATE\s+TABLE\b/i.test(l));
    // Collect the non-blank lines inside the table body except the last one
    const bodyLines = lines.slice(createIdx + 1, closeIdx).filter(l => l.trim() !== '');
    const nonLast = bodyLines.slice(0, -1);
    for (const l of nonLast) {
      assert.ok(l.trimEnd().endsWith(','), `non-last item missing comma: ${JSON.stringify(l)}`);
    }
  });

  it('is idempotent with -oti', () => {
    const first  = canonical(TABLE_SQL, { orderTableInternally: true });
    const second = canonical(first, { orderTableInternally: true });
    assert.strictEqual(first, second, 'not idempotent with -oti');
  });

  it('does not affect output without -oti', () => {
    const with_oti    = canonical(TABLE_SQL, { orderTableInternally: true });
    const without_oti = canonical(TABLE_SQL, {});
    assert.notStrictEqual(with_oti, without_oti, '-oti should change output for unsorted table');
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
