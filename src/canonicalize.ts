import {
  Block,
  CanonicalOptions,
  CATEGORY_ORDER,
  CONSTRAINT_SUBTYPE_ORDER,
  ObjectCategory,
  ParsedDump,
} from './types';

// Lines to move to initial settings section when found mid-dump
const EXTRA_SETTING_RE = /^SET\s+default_(?:tablespace|table_access_method)\s*=/i;
const OWNER_LINE_RE    = /^\s*ALTER\s+\S.*\bOWNER\s+TO\b/i;
const GRANT_LINE_RE    = /^\s*GRANT\b/i;
const POLICY_LINE_RE   = /^\s*CREATE\s+POLICY\b/i;

// ─── category mapping ───────────────────────────────────────────────────────

type InternalCategory = ObjectCategory | 'DATA';

function getCategory(tocType: string): InternalCategory {
  switch (tocType.toUpperCase()) {
    case 'SCHEMA':            return 'SCHEMA';
    case 'EXTENSION':         return 'EXTENSION';
    case 'COMMENT':           return 'EXTENSION';   // COMMENT ON EXTENSION → with extension
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

// ─── qualified name extraction ───────────────────────────────────────────────

function getQualifiedName(block: Block): string {
  for (const line of block.sqlLines) {
    const t = line.trimStart();
    let m: RegExpMatchArray | null;

    // CREATE [OR REPLACE] FUNCTION/TYPE/TABLE/VIEW/PROCEDURE/SEQUENCE/SCHEMA schema.name
    m = t.match(
      /^CREATE\b(?:\s+OR\s+REPLACE)?\s+(?:AGGREGATE|DOMAIN|FOREIGN\s+TABLE|FUNCTION|MATERIALIZED\s+VIEW|PROCEDURE|SCHEMA|SEQUENCE|TABLE(?:\s+IF\s+NOT\s+EXISTS)?|TYPE|VIEW)\s+((?:"[^"]+"|[\w$]+)(?:\.(?:"[^"]+"|[\w$]+))?)/i
    );
    if (m) return unquote(m[1]);

    // CREATE EXTENSION [IF NOT EXISTS] name
    m = t.match(/^CREATE\s+EXTENSION\b(?:\s+IF\s+NOT\s+EXISTS)?\s+("?[\w$]+"?)/i);
    if (m) return unquote(m[1]);

    // COMMENT ON EXTENSION name
    m = t.match(/^COMMENT\s+ON\s+EXTENSION\s+("?[\w$]+"?)/i);
    if (m) return unquote(m[1]);

    // CREATE [UNIQUE] INDEX [IF NOT EXISTS] indexname ON schema.table
    m = t.match(
      /^CREATE\b(?:\s+UNIQUE)?\s+INDEX\b(?:\s+IF\s+NOT\s+EXISTS)?\s+("?[\w$]+"?)\s+ON\s+((?:"[^"]+"|[\w$]+)(?:\.(?:"[^"]+"|[\w$]+))?)/i
    );
    if (m) return `${unquote(m[2])}.${unquote(m[1])}`;

    // CREATE [CONSTRAINT] TRIGGER name BEFORE|AFTER|INSTEAD OF ... ON schema.table
    m = t.match(
      /^CREATE\b(?:\s+CONSTRAINT)?\s+TRIGGER\b\s+("?[\w$]+"?)\s+(?:BEFORE|AFTER|INSTEAD\s+OF)\s+.+\bON\s+((?:"[^"]+"|[\w$]+)(?:\.(?:"[^"]+"|[\w$]+))?)/i
    );
    if (m) return `${unquote(m[2])}.${unquote(m[1])}`;

    // CREATE POLICY "name" ON schema.table
    m = t.match(
      /^CREATE\s+POLICY\b\s+(?:"([^"]+)"|([\w$]+))\s+ON\s+((?:"[^"]+"|[\w$]+)(?:\.(?:"[^"]+"|[\w$]+))?)/i
    );
    if (m) return `${unquote(m[3])}.${m[1] ?? m[2]}`;

    // ALTER TABLE [ONLY] schema.table ADD CONSTRAINT "name" ...
    m = t.match(
      /^ALTER\s+TABLE\b(?:\s+ONLY)?\s+((?:"[^"]+"|[\w$]+)(?:\.(?:"[^"]+"|[\w$]+))?)\s+ADD\s+CONSTRAINT\s+(?:"([^"]+)"|([\w$]+))/i
    );
    if (m) return `${unquote(m[1])}.${m[2] ?? m[3]}`;

    // ALTER TABLE [ONLY] schema.table ENABLE ROW LEVEL SECURITY
    m = t.match(
      /^ALTER\s+TABLE\b(?:\s+ONLY)?\s+((?:"[^"]+"|[\w$]+)(?:\.(?:"[^"]+"|[\w$]+))?)\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i
    );
    if (m) return unquote(m[1]);

    // GRANT ... ON TABLE|SCHEMA|SEQUENCE|FUNCTION|PROCEDURE|ROUTINE name
    m = t.match(
      /^GRANT\b.+\bON\s+(?:TABLE|SCHEMA|SEQUENCE|FUNCTION|PROCEDURE|ROUTINE|ALL\s+\w+\s+IN\s+SCHEMA)\s+((?:"[^"]+"|[\w$]+)(?:\.(?:"[^"]+"|[\w$]+))?)/i
    );
    if (m) return unquote(m[1]);
  }

  // Fallback: TOC schema + name
  const schema = block.toc.schema && block.toc.schema !== '-' ? block.toc.schema : '';
  return schema ? `${schema}.${block.toc.name}` : block.toc.name;
}

function unquote(s: string): string {
  return s.replace(/"/g, '');
}

// ─── constraint subtype ──────────────────────────────────────────────────────

function getConstraintSubtype(sqlLines: string[]): string {
  const sql = sqlLines.join(' ');
  const constraintName = '(?:"[^"]+"|[\\w$]+)';
  if (new RegExp(`ADD\\s+CONSTRAINT\\s+${constraintName}\\s+PRIMARY\\s+KEY`, 'i').test(sql))   return 'PRIMARY KEY';
  if (new RegExp(`ADD\\s+CONSTRAINT\\s+${constraintName}\\s+FOREIGN\\s+KEY`, 'i').test(sql))   return 'FOREIGN KEY';
  if (new RegExp(`ADD\\s+CONSTRAINT\\s+${constraintName}\\s+UNIQUE`, 'i').test(sql))            return 'UNIQUE';
  if (new RegExp(`ADD\\s+CONSTRAINT\\s+${constraintName}\\s+CHECK`, 'i').test(sql))             return 'CHECK';
  if (new RegExp(`ADD\\s+CONSTRAINT\\s+${constraintName}\\s+EXCLUDE`, 'i').test(sql))           return 'EXCLUDE';
  return 'OTHER';
}

// ─── owner handling ──────────────────────────────────────────────────────────

function shortenRole(role: string): string {
  const idx = role.lastIndexOf('_');
  return idx >= 0 ? role.slice(idx) : role;
}

function applyOwner(lines: string[], opts: CanonicalOptions): string[] {
  if (!opts.noOwner && !opts.canOwner) return lines;

  const result: string[] = [];
  for (const line of lines) {
    // ALTER ... OWNER TO role
    if (OWNER_LINE_RE.test(line)) {
      if (opts.noOwner) continue;
      result.push(line.replace(/\bOWNER\s+TO\s+([\w$]+)/i, (_, r: string) => `OWNER TO ${shortenRole(r)}`));
      continue;
    }

    // GRANT ... TO role
    if (GRANT_LINE_RE.test(line)) {
      if (opts.noOwner) continue;
      result.push(line.replace(/\bTO\s+([\w$]+)\s*;/i, (_, r: string) => `TO ${shortenRole(r)};`));
      continue;
    }

    // CREATE POLICY ... TO role  (TO clause is on the same line in pg_dump output)
    if (POLICY_LINE_RE.test(line)) {
      if (opts.noOwner) {
        // Remove the TO role clause; keep the rest of the policy definition
        result.push(line.replace(/\s+TO\s+[\w$]+\b/i, ''));
      } else {
        result.push(line.replace(/\bTO\s+([\w$]+)\b/i, (_, r: string) => `TO ${shortenRole(r)}`));
      }
      continue;
    }

    result.push(line);
  }
  return result;
}

// ─── preamble processing ─────────────────────────────────────────────────────

function processPreamble(preamble: string[]): { header: string[]; settings: string[] } {
  const header: string[] = [];
  const settings: string[] = [];
  let inSettings = false;

  for (const line of preamble) {
    if (!inSettings && /^SET\s+/i.test(line)) inSettings = true;

    if (!inSettings) {
      if (/^-- Started on /i.test(line)) continue;   // strip timestamp
      header.push(line);
    } else {
      settings.push(line);
    }
  }

  return {
    header:   trimTrailingBlanks(header),
    settings: trimTrailingBlanks(settings),
  };
}

// ─── extra settings found mid-dump ───────────────────────────────────────────

function collectExtraSettings(blocks: Block[]): string[] {
  const seen = new Set<string>();
  const extra: string[] = [];
  for (const block of blocks) {
    for (const line of block.sqlLines) {
      if (EXTRA_SETTING_RE.test(line) && !seen.has(line)) {
        seen.add(line);
        extra.push(line);
      }
    }
  }
  return extra;
}

// ─── footer processing ───────────────────────────────────────────────────────

function processFooter(footer: string[]): string[] {
  const filtered = footer.filter(line => !/^-- Completed on /i.test(line));
  return trimTrailingBlanks(filtered);
}

// ─── block rendering ─────────────────────────────────────────────────────────

// Remove inline COPY blocks that appear without their own TABLE DATA header
// (some pg_dump variants omit the header comment for data sections)
function removeCopyBlocks(lines: string[]): string[] {
  const result: string[] = [];
  let inCopy = false;
  for (const line of lines) {
    if (!inCopy && /^COPY\s+\S+.*\bFROM\s+stdin\b/i.test(line)) {
      inCopy = true;
      continue;
    }
    if (inCopy) {
      if (line === '\\.') inCopy = false;
      continue;
    }
    result.push(line);
  }
  return result;
}

function renderBlock(block: Block, opts: CanonicalOptions): string[] {
  let lines = removeCopyBlocks(block.sqlLines);
  lines = lines.filter(l => !EXTRA_SETTING_RE.test(l));
  lines = applyOwner(lines, opts);
  return trimTrailingBlanks(lines);
}

// ─── main export ─────────────────────────────────────────────────────────────

export function canonicalize(dump: ParsedDump, opts: CanonicalOptions = {}): string {
  const { header, settings } = processPreamble(dump.preamble);
  const extraSettings        = collectExtraSettings(dump.blocks);
  const footer               = processFooter(dump.footer);

  // Categorize blocks
  interface CategorizedBlock {
    category:          ObjectCategory;
    constraintSubtype: string;
    qualifiedName:     string;
    block:             Block;
  }

  const byCategory = new Map<ObjectCategory, CategorizedBlock[]>();

  for (const block of dump.blocks) {
    const cat = getCategory(block.toc.type);
    if (cat === 'DATA') continue;

    const category          = cat as ObjectCategory;
    const qualifiedName     = getQualifiedName(block);
    const constraintSubtype = category === 'CONSTRAINT' ? getConstraintSubtype(block.sqlLines) : '';

    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category)!.push({ category, constraintSubtype, qualifiedName, block });
  }

  // Sort each category (SCHEMA and EXTENSION keep original order)
  for (const [cat, items] of byCategory) {
    if (cat === 'SCHEMA' || cat === 'EXTENSION') continue;

    if (cat === 'CONSTRAINT') {
      items.sort((a, b) => {
        const ai = CONSTRAINT_SUBTYPE_ORDER.indexOf(a.constraintSubtype);
        const bi = CONSTRAINT_SUBTYPE_ORDER.indexOf(b.constraintSubtype);
        const aOrd = ai === -1 ? CONSTRAINT_SUBTYPE_ORDER.length : ai;
        const bOrd = bi === -1 ? CONSTRAINT_SUBTYPE_ORDER.length : bi;
        if (aOrd !== bOrd) return aOrd - bOrd;
        return a.qualifiedName.localeCompare(b.qualifiedName);
      });
    } else {
      items.sort((a, b) => a.qualifiedName.localeCompare(b.qualifiedName));
    }
  }

  // Emit output
  const out: string[] = [];

  for (const l of header) out.push(l);

  if (settings.length > 0 || extraSettings.length > 0) {
    if (out.length > 0 && out[out.length - 1] !== '') out.push('');
    for (const l of settings) out.push(l);
    if (extraSettings.length > 0) for (const l of extraSettings) out.push(l);
  }

  // Categories in canonical order, then any unknown ones alphabetically
  const knownSet = new Set<ObjectCategory>(CATEGORY_ORDER);
  const extraCats = [...byCategory.keys()]
    .filter(c => !knownSet.has(c) && c !== 'OTHER')
    .sort();
  const allCats: ObjectCategory[] = [...CATEGORY_ORDER, ...extraCats, 'OTHER'];

  for (const cat of allCats) {
    const items = byCategory.get(cat);
    if (!items || items.length === 0) continue;

    for (const { block } of items) {
      const blockLines = renderBlock(block, opts);
      if (blockLines.length > 0) {
        out.push('');
        for (const l of blockLines) out.push(l);
      }
    }
  }

  if (footer.length > 0) {
    out.push('');
    for (const l of footer) out.push(l);
  }

  return out.join('\n') + '\n';
}

function trimTrailingBlanks(lines: string[]): string[] {
  let end = lines.length;
  while (end > 0 && lines[end - 1].trim() === '') end--;
  return lines.slice(0, end);
}
