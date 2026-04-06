import { canonicalize } from './canonicalize';
import { CanonicalOptions, CATEGORY_ORDER, ObjectCategory, ParsedDump } from './types';

// ─── types ────────────────────────────────────────────────────────────────────

export type FindingKind = 'missing' | 'extra' | 'changed';

export interface Finding {
  kind:          FindingKind;
  category:      ObjectCategory;
  qualifiedName: string;
  sourceSql:     string[];  // empty when kind === 'missing'
  targetSql:     string[];  // empty when kind === 'extra'
}

// ─── internal index ───────────────────────────────────────────────────────────

interface IndexedBlock {
  category:      ObjectCategory;
  qualifiedName: string;
  /** Key used to detect overloaded functions: qualifiedName + parameter signature */
  fullKey:       string;
  sqlLines:      string[];
}

function extractSignature(sqlLines: string[]): string {
  // For functions/procedures extract the parameter list so overloads are distinct
  for (const line of sqlLines) {
    const m = line.match(/^CREATE\b(?:\s+OR\s+REPLACE)?\s+(?:FUNCTION|PROCEDURE)\s+\S+\s*(\([^)]*\))/i);
    if (m) return m[1];
  }
  return '';
}

type InternalCategory = ObjectCategory | 'DATA';

function getCategory(tocType: string): InternalCategory {
  switch (tocType.toUpperCase()) {
    case 'SCHEMA':            return 'SCHEMA';
    case 'EXTENSION':         return 'EXTENSION';
    case 'COMMENT':           return 'EXTENSION';
    case 'TYPE':              return 'TYPE';
    case 'DOMAIN':            return 'TYPE';
    case 'FUNCTION':          return 'FUNCTION';
    case 'AGGREGATE':         return 'FUNCTION';
    case 'PROCEDURE':         return 'PROCEDURE';
    case 'SEQUENCE':          return 'SEQUENCE';
    case 'TABLE':             return 'TABLE';
    case 'FOREIGN TABLE':     return 'TABLE';
    case 'VIEW':              return 'VIEW';
    case 'MATERIALIZED VIEW': return 'VIEW';
    case 'CONSTRAINT':        return 'CONSTRAINT';
    case 'FK CONSTRAINT':     return 'CONSTRAINT';
    case 'INDEX':             return 'INDEX';
    case 'TRIGGER':           return 'TRIGGER';
    case 'POLICY':            return 'POLICY';
    case 'ROW SECURITY':      return 'ROW_SECURITY';
    case 'ACL':               return 'GRANT';
    case 'TABLE DATA':        return 'DATA';
    case 'SEQUENCE SET':      return 'DATA';
    case 'DEFAULT':           return 'DATA';
    default:                  return 'OTHER';
  }
}

function buildIndex(dump: ParsedDump, opts: CanonicalOptions): Map<string, IndexedBlock> {
  const index = new Map<string, IndexedBlock>();
  for (const block of dump.blocks) {
    const cat = getCategory(block.toc.type);
    if (cat === 'DATA') continue;
    const category = cat as ObjectCategory;

    // Normalize SQL lines by canonicalizing a single-block dump
    const singleCanon = canonicalize({ preamble: [], blocks: [block], footer: [] }, opts);
    // canonical output: leading blank + sql lines + trailing newline
    const sqlLines = singleCanon.split('\n').slice(1);
    while (sqlLines.length > 0 && sqlLines[sqlLines.length - 1].trim() === '') sqlLines.pop();

    const qualifiedName = block.toc.schema && block.toc.schema !== '-'
      ? `${block.toc.schema}.${block.toc.name}`
      : block.toc.name;
    const sig     = (category === 'FUNCTION' || category === 'PROCEDURE')
      ? extractSignature(sqlLines)
      : '';
    const fullKey = `${category}::${qualifiedName}${sig}`;
    index.set(fullKey, { category, qualifiedName, fullKey, sqlLines });
  }
  return index;
}

// ─── table column/constraint diff ────────────────────────────────────────────

interface TableItem {
  name: string;
  sql:  string;
}

function parseTableItems(sqlLines: string[]): { columns: TableItem[]; constraints: TableItem[] } {
  const columns:     TableItem[] = [];
  const constraints: TableItem[] = [];

  let depth   = 0;
  let inBody  = false;
  let current: string[] = [];

  const flush = () => {
    const joined = current.join(' ').trim().replace(/,$/, '').trim();
    if (!joined) return;
    const cm = joined.match(/^CONSTRAINT\s+(?:"([^"]+)"|([\w$]+))/i);
    if (cm) {
      constraints.push({ name: cm[1] ?? cm[2], sql: joined });
    } else {
      const col = joined.match(/^("?[\w$]+"?)/);
      if (col) columns.push({ name: col[1].replace(/"/g, ''), sql: joined });
    }
    current = [];
  };

  for (const line of sqlLines) {
    const t = line.trim();
    if (!inBody) {
      if (/^CREATE\b.*\(/.test(t)) inBody = true;
      continue;
    }
    for (const ch of t) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
    }
    if (depth < 0) { flush(); break; }  // hit the outermost closing ')' of CREATE TABLE
    if (depth === 0 && t.endsWith(',')) {
      current.push(t.slice(0, -1));
      flush();
    } else {
      current.push(t);
    }
  }

  return { columns, constraints };
}

function diffTable(qualifiedName: string, srcLines: string[], tgtLines: string[]): string[] {
  const src = parseTableItems(srcLines);
  const tgt = parseTableItems(tgtLines);

  const srcCols = new Map(src.columns.map(c => [c.name, c.sql]));
  const tgtCols = new Map(tgt.columns.map(c => [c.name, c.sql]));
  const srcCons = new Map(src.constraints.map(c => [c.name, c.sql]));
  const tgtCons = new Map(tgt.constraints.map(c => [c.name, c.sql]));

  const out: string[] = [];

  // Columns
  for (const [name, sql] of tgtCols) {
    if (!srcCols.has(name)) {
      out.push(`ALTER TABLE ${qualifiedName} ADD COLUMN ${sql};`);
    } else if (srcCols.get(name) !== sql) {
      // Decompose the change: type, nullability, default
      const srcDef = srcCols.get(name)!;
      const newType = sql.replace(/^"?\w+"?\s+/, '').split(/\s+/)[0];
      const oldType = srcDef.replace(/^"?\w+"?\s+/, '').split(/\s+/)[0];
      if (newType !== oldType) {
        out.push(`ALTER TABLE ${qualifiedName} ALTER COLUMN "${name}" TYPE ${newType}; -- review: may require USING clause`);
      }
      if (/\bNOT NULL\b/i.test(sql) && !/\bNOT NULL\b/i.test(srcDef)) {
        out.push(`ALTER TABLE ${qualifiedName} ALTER COLUMN "${name}" SET NOT NULL;`);
      } else if (!/\bNOT NULL\b/i.test(sql) && /\bNOT NULL\b/i.test(srcDef)) {
        out.push(`ALTER TABLE ${qualifiedName} ALTER COLUMN "${name}" DROP NOT NULL;`);
      }
      const newDefault = sql.match(/\bDEFAULT\s+(.+)/i)?.[1];
      const oldDefault = srcDef.match(/\bDEFAULT\s+(.+)/i)?.[1];
      if (newDefault !== oldDefault) {
        if (newDefault) out.push(`ALTER TABLE ${qualifiedName} ALTER COLUMN "${name}" SET DEFAULT ${newDefault};`);
        else            out.push(`ALTER TABLE ${qualifiedName} ALTER COLUMN "${name}" DROP DEFAULT;`);
      }
    }
  }
  for (const [name] of srcCols) {
    if (!tgtCols.has(name)) {
      out.push(`ALTER TABLE ${qualifiedName} DROP COLUMN "${name}";`);
    }
  }

  // Constraints
  for (const [name, sql] of tgtCons) {
    if (!srcCons.has(name)) {
      out.push(`ALTER TABLE ${qualifiedName} ADD ${sql};`);
    } else if (srcCons.get(name) !== sql) {
      out.push(`ALTER TABLE ${qualifiedName} DROP CONSTRAINT "${name}";`);
      out.push(`ALTER TABLE ${qualifiedName} ADD ${sql};`);
    }
  }
  for (const [name] of srcCons) {
    if (!tgtCons.has(name)) {
      out.push(`ALTER TABLE ${qualifiedName} DROP CONSTRAINT "${name}";`);
    }
  }

  return out;
}

// ─── migration SQL for each kind/category ────────────────────────────────────

function migrationLines(finding: Finding): string[] {
  const { kind, category, qualifiedName, sourceSql, targetSql } = finding;
  const src = sourceSql.join('\n');
  const tgt = targetSql.join('\n');

  if (kind === 'missing') {
    // Object exists in target but not in source → CREATE it
    return [...targetSql, ''];
  }

  if (kind === 'extra') {
    // Object exists in source but not in target → DROP it
    switch (category) {
      case 'FUNCTION':
      case 'PROCEDURE': {
        const sig = targetSql.length === 0 ? '' :
          sourceSql.join(' ').match(/^CREATE\b.*?(FUNCTION|PROCEDURE)\s+(\S+\s*\([^)]*\))/i)?.[2] ?? qualifiedName;
        return [`DROP ${category} IF EXISTS ${sig};`, ''];
      }
      case 'VIEW':
        return [`DROP VIEW IF EXISTS ${qualifiedName};`, ''];
      case 'TABLE':
        return [`DROP TABLE IF EXISTS ${qualifiedName};`, ''];
      case 'SEQUENCE':
        return [`DROP SEQUENCE IF EXISTS ${qualifiedName};`, ''];
      case 'INDEX':
        return [`DROP INDEX IF EXISTS ${qualifiedName};`, ''];
      case 'TRIGGER': {
        const m = sourceSql.join(' ').match(/CREATE\b.*?TRIGGER\b\s+("?[\w$]+"?)\s+.*\bON\s+([\w$.]+)/i);
        return m ? [`DROP TRIGGER IF EXISTS ${m[1]} ON ${m[2]};`, ''] : [`-- DROP TRIGGER ${qualifiedName};`, ''];
      }
      case 'CONSTRAINT': {
        const m = sourceSql.join(' ').match(/ALTER\s+TABLE\b.*?([\w$.]+)\s+ADD\s+CONSTRAINT\s+("?[\w$]+"?)/i);
        return m ? [`ALTER TABLE ${m[1]} DROP CONSTRAINT IF EXISTS ${m[2]};`, ''] : [`-- DROP CONSTRAINT ${qualifiedName};`, ''];
      }
      case 'POLICY': {
        const m = sourceSql.join(' ').match(/CREATE\s+POLICY\s+("?[^"]+?"?)\s+ON\s+([\w$.]+)/i);
        return m ? [`DROP POLICY IF EXISTS ${m[1]} ON ${m[2]};`, ''] : [`-- DROP POLICY ${qualifiedName};`, ''];
      }
      case 'GRANT': {
        const revoke = sourceSql.map(l => l.replace(/^GRANT\b/i, 'REVOKE').replace(/\bTO\b/i, 'FROM'));
        return [...revoke, ''];
      }
      default:
        return [`-- DROP ${category} ${qualifiedName} (manual review required)`, ''];
    }
  }

  // kind === 'changed'
  switch (category) {
    case 'FUNCTION':
    case 'PROCEDURE':
    case 'VIEW':
      // CREATE OR REPLACE handles it
      return [...targetSql, ''];

    case 'TABLE':
      return [...diffTable(qualifiedName, sourceSql, targetSql), ''];

    case 'SEQUENCE': {
      const out: string[] = [];
      const get = (sql: string, key: string) => sql.match(new RegExp(`${key}\\s+(\\S+)`, 'i'))?.[1];
      const keys = ['INCREMENT BY', 'MINVALUE', 'MAXVALUE', 'START WITH', 'CACHE'];
      for (const k of keys) {
        const sv = get(src, k); const tv = get(tgt, k);
        if (sv !== tv && tv) out.push(`ALTER SEQUENCE ${qualifiedName} ${k} ${tv};`);
      }
      return out.length ? [...out, ''] : [];
    }

    case 'INDEX':
      return [
        `DROP INDEX IF EXISTS ${qualifiedName};`,
        ...targetSql,
        '',
      ];

    case 'TRIGGER': {
      const m = sourceSql.join(' ').match(/CREATE\b.*?TRIGGER\b\s+("?[\w$]+"?)\s+.*\bON\s+([\w$.]+)/i);
      return [
        m ? `DROP TRIGGER IF EXISTS ${m[1]} ON ${m[2]};` : `-- DROP TRIGGER ${qualifiedName};`,
        ...targetSql,
        '',
      ];
    }

    case 'CONSTRAINT': {
      const m = sourceSql.join(' ').match(/ALTER\s+TABLE\b.*?([\w$.]+)\s+ADD\s+CONSTRAINT\s+("?[\w$]+"?)/i);
      return [
        m ? `ALTER TABLE ${m[1]} DROP CONSTRAINT IF EXISTS ${m[2]};` : `-- DROP CONSTRAINT ${qualifiedName};`,
        ...targetSql,
        '',
      ];
    }

    case 'POLICY': {
      const m = sourceSql.join(' ').match(/CREATE\s+POLICY\s+("?[^"]+?"?)\s+ON\s+([\w$.]+)/i);
      return [
        m ? `DROP POLICY IF EXISTS ${m[1]} ON ${m[2]};` : `-- DROP POLICY ${qualifiedName};`,
        ...targetSql,
        '',
      ];
    }

    case 'GRANT': {
      const revoke = sourceSql.map(l => l.replace(/^GRANT\b/i, 'REVOKE').replace(/\bTO\b/i, 'FROM'));
      return [...revoke, ...targetSql, ''];
    }

    case 'TYPE':
      return [
        `-- WARNING: changing TYPE ${qualifiedName} may require manual migration`,
        `-- DROP TYPE ${qualifiedName}; -- uncomment if safe`,
        ...targetSql,
        '',
      ];

    default:
      return [
        `-- CHANGED ${category} ${qualifiedName} (manual review required)`,
        ...targetSql,
        '',
      ];
  }
}

// ─── main compare ─────────────────────────────────────────────────────────────

export interface CompareOptions extends CanonicalOptions {
  // future: filter by schema, etc.
}

export function compare(source: ParsedDump, target: ParsedDump, opts: CompareOptions = {}): Finding[] {
  const srcIndex = buildIndex(source, opts);
  const tgtIndex = buildIndex(target, opts);

  const findings: Finding[] = [];

  // Present in target but not source → missing (need to create)
  for (const [key, tgt] of tgtIndex) {
    if (!srcIndex.has(key)) {
      findings.push({
        kind:          'missing',
        category:      tgt.category,
        qualifiedName: tgt.qualifiedName,
        sourceSql:     [],
        targetSql:     tgt.sqlLines,
      });
    }
  }

  // Present in source but not target → extra (need to drop)
  for (const [key, src] of srcIndex) {
    if (!tgtIndex.has(key)) {
      findings.push({
        kind:          'extra',
        category:      src.category,
        qualifiedName: src.qualifiedName,
        sourceSql:     src.sqlLines,
        targetSql:     [],
      });
    }
  }

  // Present in both → check if changed
  for (const [key, src] of srcIndex) {
    const tgt = tgtIndex.get(key);
    if (!tgt) continue;
    if (src.sqlLines.join('\n') !== tgt.sqlLines.join('\n')) {
      findings.push({
        kind:          'changed',
        category:      src.category,
        qualifiedName: src.qualifiedName,
        sourceSql:     src.sqlLines,
        targetSql:     tgt.sqlLines,
      });
    }
  }

  return findings;
}

// ─── migration script generation ─────────────────────────────────────────────

const CATEGORY_SORT_ORDER = new Map<ObjectCategory, number>(
  CATEGORY_ORDER.map((c, i) => [c, i])
);

export function generateMigration(findings: Finding[]): string {
  // Sort: by category order, then qualifiedName, then kind (missing < changed < extra)
  const kindOrder: Record<FindingKind, number> = { missing: 0, changed: 1, extra: 2 };

  const sorted = [...findings].sort((a, b) => {
    const ca = CATEGORY_SORT_ORDER.get(a.category) ?? 99;
    const cb = CATEGORY_SORT_ORDER.get(b.category) ?? 99;
    if (ca !== cb) return ca - cb;
    const kc = kindOrder[a.kind] - kindOrder[b.kind];
    if (kc !== 0) return kc;
    return a.qualifiedName.localeCompare(b.qualifiedName);
  });

  const lines: string[] = [
    '-- Migration script generated by pg-dump-compare',
    '-- Review carefully before executing.',
    '-- Drops are listed last within each object type.',
    '',
  ];

  let lastCategory: ObjectCategory | null = null;
  for (const finding of sorted) {
    if (finding.category !== lastCategory) {
      lines.push(`-- ─── ${finding.category} ──────────────────────────`);
      lastCategory = finding.category;
    }
    lines.push(`-- ${finding.kind.toUpperCase()}: ${finding.qualifiedName}`);
    lines.push(...migrationLines(finding));
  }

  return lines.join('\n');
}
