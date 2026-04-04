# pg-dump-compare

Compare two PostgreSQL databases (or schema sets) using plain `pg_dump` files as input.

## Why not just `diff` the dumps directly?

PostgreSQL does not guarantee the order in which object definitions appear in a plain dump. Two dumps of identical databases can produce different text output, making a raw `diff` unreliable. `pg-dump-compare` solves this by first canonicalizing each dump — sorting and normalizing the SQL — before comparing.

## Installation

```bash
npm install -g pg-dump-compare
```

Or run directly with `npx`:

```bash
npx pg-dump-compare source.sql target.sql
```

## Usage

### Compare two dumps

```bash
pg-dump-compare SOURCE TARGET [-o OUTPUT_PATH] [-no-owner] [-can-owner]
```

Generates canonical versions of both dumps and a unified diff in `OUTPUT_PATH`.

| Option | Default |
|---|---|
| `-o OUTPUT_PATH` | `pg-dump-compare-results` |
| `-no-owner` | — |
| `-can-owner` | — |

**Output files:**

| File | Description |
|---|---|
| `<source>.can.sql` | Canonical version of SOURCE |
| `<target>.can.sql` | Canonical version of TARGET |
| `only.diff` | Unified diff between the two canonicals |

### Canonicalize a single dump

```bash
pg-dump-compare --canonical DUMP_FILE [-o CANONICAL_FILE] [-no-owner] [-can-owner]
```

| Option | Default |
|---|---|
| `-o CANONICAL_FILE` | `<DUMP_FILE>.can.sql` |

## Owner options

| Flag | Effect |
|---|---|
| *(none)* | Owner and role names are kept as-is |
| `-no-owner` | Removes all `ALTER … OWNER TO` statements, all `GRANT` statements, and the `TO role` clause from `CREATE POLICY` |
| `-can-owner` | Shortens every owner/role name to the suffix after the last underscore (`ejemplo_muleto_owner` → `owner`, `ejemplo_muleto_admin` → `admin`) |

`-can-owner` is useful when comparing dumps from environments that use the same schema but different role name prefixes.

## Canonical form

The canonical version of a dump applies the following transformations:

1. **Removes noise** — TOC entry comments, OIDs, and `Started on` / `Completed on` timestamps are stripped.
2. **Owner normalization** — controlled by `-no-owner` / `-can-owner` (see above).
3. **Preserves order-sensitive sections** — the initial `SET` statements and schema/extension definitions keep their original order.
4. **Removes data** — `COPY … FROM stdin` blocks and `SELECT pg_catalog.setval(…)` calls are removed. Only the schema is compared.
5. **Sorts object definitions** by type, then alphabetically by schema-qualified name within each type, in this order:

   `SCHEMA` → `EXTENSION` → `TYPE` → `FUNCTION` → `PROCEDURE` → `SEQUENCE` → `TABLE` → `VIEW` → `CONSTRAINT` → `INDEX` → `TRIGGER` → `POLICY` → `ROW LEVEL SECURITY` → `GRANTS`

6. **Sorts constraints** within the `CONSTRAINT` group by subtype: `PRIMARY KEY` → `FOREIGN KEY` → `UNIQUE` → `CHECK` → `EXCLUDE` → others.

## Requirements

- Node.js 18+
- A plain-format PostgreSQL dump (`pg_dump -f plain` or `pg_dump --format=plain`)

## Example

```bash
# Dump two databases
pg_dump -f plain -s mydb_prod > prod.sql
pg_dump -f plain -s mydb_staging > staging.sql

# Compare, ignoring owner names
pg-dump-compare prod.sql staging.sql -o results -can-owner

# Open the diff in your preferred tool
code results/only.diff
```

The canonical files (`results/prod.can.sql`, `results/staging.can.sql`) can also be compared with any external diff tool.
