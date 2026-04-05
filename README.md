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
pg-dump-compare SOURCE TARGET [-o OUTPUT_PATH] [-no-owner] [-can-owner] [-oti]
```

Generates canonical versions of both dumps and a unified diff in `OUTPUT_PATH`.

| Option | Default |
|---|---|
| `-o OUTPUT_PATH` | `pg-dump-compare-results` |
| `-no-owner` | — |
| `-can-owner` | — |
| `-oti` | — |

**Output files:**

| File | Description |
|---|---|
| `<source>.can.sql` | Canonical version of SOURCE |
| `<target>.can.sql` | Canonical version of TARGET |
| `only.diff` | Unified diff between the two canonicals |

### Canonicalize a single dump

```bash
pg-dump-compare --canonical DUMP_FILE [-o CANONICAL_FILE] [-no-owner] [-can-owner] [-oti]
```

| Option | Default |
|---|---|
| `-o CANONICAL_FILE` | `<DUMP_FILE>.can.sql` |

## Options

### Owner options

| Flag | Effect |
|---|---|
| *(none)* | Owner and role names are kept as-is |
| `-no-owner` | Removes all `ALTER … OWNER TO` statements, all `GRANT` statements, and the `TO role` clause from `CREATE POLICY` |
| `-can-owner` | Shortens every owner/role name to the suffix after the last `_` — including the underscore (`ejemplo_muleto_owner` → `_owner`, `ejemplo_muleto_admin` → `_admin`) |

`-can-owner` is useful when comparing dumps from environments that use the same schema but different role name prefixes (e.g. `prod_owner` vs `staging_owner`).

### `-oti` — Order Table Internally

When this flag is set, the columns and constraints inside each `CREATE TABLE` statement are sorted:

1. **Columns** are sorted alphabetically by column name.
2. **Constraints** (`CONSTRAINT … CHECK`, `CONSTRAINT … UNIQUE`, etc.) follow, also sorted alphabetically by constraint name.
3. Commas are treated as separators: every item except the last has a comma, and the last item does not — regardless of how they appeared in the original dump.

This is useful when the same table was defined in different orders across environments.

## Canonical form

The canonical version of a dump applies the following transformations:

1. **Removes noise** — TOC entry comments, OIDs, and `Started on` / `Completed on` timestamps are stripped. Works with dumps that include a TOC and with those that do not (e.g. dumps generated without `--no-comments`).
2. **Normalizes line endings** — CRLF is converted to LF.
3. **Owner normalization** — controlled by `-no-owner` / `-can-owner` (see above). Applies to `ALTER … OWNER TO`, `GRANT … TO`, and `CREATE POLICY … TO`.
4. **Preserves order-sensitive sections** in their original order:
   - Initial `SET` statements (connection settings)
   - `SET default_tablespace` / `SET default_table_access_method` (moved here if found mid-dump)
   - Schema and extension definitions
5. **Removes data** — `COPY … FROM stdin` blocks (with or without a header comment) and `SELECT pg_catalog.setval(…)` calls are removed. Only the schema is compared.
6. **Sorts object definitions** by type, then alphabetically by schema-qualified name within each type, in this order:

   `SCHEMA` → `EXTENSION` → `TYPE` → `FUNCTION` → `PROCEDURE` → `SEQUENCE` → `TABLE` → `VIEW` → `CONSTRAINT` → `INDEX` → `TRIGGER` → `POLICY` → `ROW LEVEL SECURITY` → `GRANTS`

7. **Sorts constraints** within the `CONSTRAINT` group by subtype: `PRIMARY KEY` → `FOREIGN KEY` → `UNIQUE` → `CHECK` → `EXCLUDE` → others.
8. **Optionally sorts table internals** — see `-oti` above.

## Diff behaviour

The diff (`only.diff`) is generated using `git diff --no-index` with the following flags:

- `--ignore-blank-lines` — blank-line-only differences are ignored.
- `-w` — all whitespace differences (spaces, tabs, indentation) are ignored.

This matches the behaviour of `git diff -w --ignore-blank-lines`.

## Requirements

- Node.js 18+
- Git in the PATH (used for diff generation)
- A plain-format PostgreSQL dump (`pg_dump --format=plain` or `pg_dump -Fp`)

## Example

```bash
# Dump two databases (schema only)
pg_dump -Fp -s mydb_prod    > prod.sql
pg_dump -Fp -s mydb_staging > staging.sql

# Compare, simplifying role names
pg-dump-compare prod.sql staging.sql -o results -can-owner

# Open the diff in your preferred tool
code results/only.diff
```

The canonical files (`results/prod.can.sql`, `results/staging.can.sql`) can also be compared with any external diff tool.

```bash
# Canonicalize a single dump with table-internal ordering, stripping owners
pg-dump-compare --canonical prod.sql -o prod.can.sql -oti -no-owner
```

## Development

```bash
npm install
npm run build   # compile TypeScript → dist/
npm test        # build + run Mocha tests
```

Tests include unit tests for the parser and canonicalizer, whitespace-behaviour tests for the diff, and **golden-file integration tests** that compare full canonicalization output against committed fixtures in `tests/fixtures/`. If behaviour changes intentionally, regenerate the golden files:

```bash
node dist/cli.js --canonical tests/fixtures/dump1.sql \
    -o tests/fixtures/dump1.oti-no-owner.can.sql -oti -no-owner

node dist/cli.js --canonical tests/fixtures/dump3.sql \
    -o tests/fixtures/dump3.can.sql

node dist/cli.js tests/fixtures/dump1.sql tests/fixtures/dump2.sql \
    -o tests/fixtures -can-owner
```

Then commit the updated fixtures — the git diff serves as a record of exactly what changed in the output.
