import { Block, ParsedDump, TocInfo } from './types';

function trimTrailingBlanks(lines: string[]): string[] {
  let end = lines.length;
  while (end > 0 && lines[end - 1].trim() === '') end--;
  return lines.slice(0, end);
}

function parseTocNameLine(line: string): Partial<TocInfo> {
  const field = (key: string): string => {
    const m = line.match(new RegExp(`\\b${key}: ([^;]+)`));
    return m ? m[1].trim() : '';
  };
  return {
    name:   field('Name'),
    type:   field('Type'),
    schema: field('Schema') || '-',
    owner:  field('Owner'),
  };
}

function findFooterStart(lines: string[], n: number): number {
  for (let k = n - 1; k >= 0; k--) {
    if (/^-- Completed on /.test(lines[k])) {
      let s = k;
      while (s > 0 && lines[s - 1].trim() === '') s--;
      return s;
    }
    if (lines[k] === '--' && k + 1 < n && /PostgreSQL database dump complete/.test(lines[k + 1])) {
      let s = k;
      while (s > 0 && lines[s - 1].trim() === '') s--;
      if (s > 0 && /^-- Completed on /i.test(lines[s - 1])) {
        s--;
        while (s > 0 && lines[s - 1].trim() === '') s--;
      }
      return s;
    }
  }
  return n;
}

export function parseDump(content: string): ParsedDump {
  // Normalize line endings (CRLF → LF) so all comparisons work regardless of OS
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const n = lines.length;

  // Find all metadata lines: lines starting with '--' and containing '; Type:'
  // Works for both formats:
  //   with TOC:    "-- Name: foo; Type: BAR; ..."  (after a "-- TOC entry N" line)
  //   without TOC: "-- Name: foo; Type: BAR; ..."  (directly after the opening '--')
  //   data blocks: "-- Data for Name: foo; Type: TABLE DATA; ..."
  const metaIdxs: number[] = [];
  for (let i = 0; i < n; i++) {
    if (lines[i].startsWith('--') && lines[i].includes('; Type:')) {
      metaIdxs.push(i);
    }
  }

  if (metaIdxs.length === 0) {
    return { preamble: lines, blocks: [], footer: [] };
  }

  // For each metadata line find:
  //   openIdx  — the first '--' in the run of '--'-prefixed lines ending at metaIdx
  //   closeIdx — the first bare '--' line after metaIdx (closes the comment block)
  interface Header { openIdx: number; closeIdx: number; metaLine: string; }

  const headers: Header[] = metaIdxs.map(metaIdx => {
    let openIdx = metaIdx;
    while (openIdx > 0 && lines[openIdx - 1].startsWith('--')) openIdx--;

    let closeIdx = metaIdx + 1;
    while (closeIdx < n && lines[closeIdx] !== '--') closeIdx++;

    return { openIdx, closeIdx, metaLine: lines[metaIdx] };
  });

  const preamble    = trimTrailingBlanks(lines.slice(0, headers[0].openIdx));
  const footerStart = findFooterStart(lines, n);

  const blocks: Block[] = [];
  for (let bi = 0; bi < headers.length; bi++) {
    const { closeIdx, metaLine } = headers[bi];

    const toc: TocInfo = {
      name: '', type: '', schema: '-', owner: '',
      ...parseTocNameLine(metaLine),
    };

    const sqlStart = closeIdx + 1;
    const sqlEnd   = bi + 1 < headers.length ? headers[bi + 1].openIdx : footerStart;

    const sqlLines = trimTrailingBlanks(lines.slice(sqlStart, sqlEnd));
    blocks.push({ toc, sqlLines });
  }

  const footer = footerStart < n ? lines.slice(footerStart) : [];
  return { preamble, blocks, footer };
}
