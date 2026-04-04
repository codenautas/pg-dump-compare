export type ObjectCategory =
  | 'SCHEMA'
  | 'EXTENSION'
  | 'TYPE'
  | 'FUNCTION'
  | 'PROCEDURE'
  | 'SEQUENCE'
  | 'TABLE'
  | 'VIEW'
  | 'CONSTRAINT'
  | 'INDEX'
  | 'TRIGGER'
  | 'POLICY'
  | 'ROW_SECURITY'
  | 'GRANT'
  | 'OTHER';

export const CATEGORY_ORDER: ObjectCategory[] = [
  'SCHEMA',
  'EXTENSION',
  'TYPE',
  'FUNCTION',
  'PROCEDURE',
  'SEQUENCE',
  'TABLE',
  'VIEW',
  'CONSTRAINT',
  'INDEX',
  'TRIGGER',
  'POLICY',
  'ROW_SECURITY',
  'GRANT',
];

export const CONSTRAINT_SUBTYPE_ORDER: string[] = [
  'PRIMARY KEY',
  'FOREIGN KEY',
  'UNIQUE',
  'CHECK',
  'EXCLUDE',
];

export interface TocInfo {
  name: string;
  type: string;
  schema: string;
  owner: string;
}

export interface Block {
  toc: TocInfo;
  sqlLines: string[];
}

export interface ParsedDump {
  preamble: string[];
  blocks: Block[];
  footer: string[];
}

export interface CanonicalOptions {
  noOwner?: boolean;
  canOwner?: boolean;
}
