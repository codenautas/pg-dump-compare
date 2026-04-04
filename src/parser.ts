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

export function parseDump(content: string): ParsedDump {
  const lines = content.split('\n');
  const n = lines.length;

  // Find all "-- TOC entry N" line indices
  const tocIdxs: number[] = [];
  for (let i = 0; i < n; i++) {
    if (/^-- TOC entry \d+/.test(lines[i])) tocIdxs.push(i);
  }

  if (tocIdxs.length === 0) {
    return { preamble: lines, blocks: [], footer: [] };
  }

  // For each TOC entry, find the closing '--' of its header comment
  const headerEnds: number[] = tocIdxs.map(tocIdx => {
    let j = tocIdx + 1;
    while (j < n && lines[j] !== '--') j++;
    return j;
  });

  // Opening '--' separator before each TOC entry
  const headerStarts: number[] = tocIdxs.map(idx => idx - 1);

  // Preamble: everything before the first block's opening '--'
  const preamble = trimTrailingBlanks(lines.slice(0, headerStarts[0]));

  // Footer: search backwards for "Completed on" or "dump complete" marker
  let footerStart = n;
  for (let k = n - 1; k >= 0; k--) {
    if (/^-- Completed on /.test(lines[k])) {
      footerStart = k;
      while (footerStart > 0 && lines[footerStart - 1].trim() === '') footerStart--;
      break;
    }
    if (lines[k] === '--' && k + 1 < n && /PostgreSQL database dump complete/.test(lines[k + 1])) {
      footerStart = k;
      // Back up through blank lines, then through optional "Completed on" line, then blanks again
      while (footerStart > 0 && lines[footerStart - 1].trim() === '') footerStart--;
      if (footerStart > 0 && /^-- Completed on /i.test(lines[footerStart - 1])) {
        footerStart--;
        while (footerStart > 0 && lines[footerStart - 1].trim() === '') footerStart--;
      }
      break;
    }
  }

  // Build blocks
  const blocks: Block[] = [];
  for (let bi = 0; bi < tocIdxs.length; bi++) {
    const tocIdx    = tocIdxs[bi];
    const headerEnd = headerEnds[bi];

    // Find the metadata line inside the header comment.
    // Normal blocks:  "-- Name: foo; Type: BAR; ..."
    // Data blocks:    "-- Data for Name: foo; Type: TABLE DATA; ..."
    let nameLine = '';
    for (let j = tocIdx + 1; j < headerEnd; j++) {
      if (lines[j].includes('; Type:')) { nameLine = lines[j]; break; }
    }

    const toc: TocInfo = {
      name: '', type: '', schema: '-', owner: '',
      ...parseTocNameLine(nameLine),
    };

    // SQL range: from after header closing '--' to the next block's opening '--' (or footer)
    const sqlStart = headerEnd + 1;
    const sqlEnd   = bi + 1 < tocIdxs.length ? headerStarts[bi + 1] : footerStart;

    const sqlLines = trimTrailingBlanks(lines.slice(sqlStart, sqlEnd));
    blocks.push({ toc, sqlLines });
  }

  const footer = footerStart < n ? lines.slice(footerStart) : [];

  return { preamble, blocks, footer };
}
