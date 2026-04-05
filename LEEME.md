# pg-dump-compare

## Objetivo

Tener una herramienta que encuentre la diferencia entre dos bases de datos (o entre dos conjuntos de esquemas) 
usando como input el `pg_dump --format=plain`.

¿Por qué no simplemente comparar ambos dumps con un `diff` de texto? 
Porque Postgres no garantiza el orden en que se aparecen las definiciones de los objetos de la base.

## Uso

```bash
$ pg-dump-compare SOURCE TARGET [-o OUTPUT_PATH] [-no-roles] [-can-roles] [-in-roles SOURCE/TARGET] [-oti]
```

parámetro|valor predeterminado
---------|-----------------------
-o       |pg-dump-compare-results

## Funcionamiento

_pg-dump-compare_ generará una serie de archivos de resultado en la carpeta _OUTPUT_PATH_

### Versiones canónicas de SOURCE y TARGET

Para que el usuario pueda utilizar su herramienta de diff preferida, _pg-dump-compare_ generará una versión canónica de _SOURCE_ y de _TARGET_ (con la extensión `.can.sql`).

La versión canónica también se puede obtener así:

```bash
$ pg-dump-compare --canonical DUMP_FILE [-o CANONICAL_FILE] [-no-roles] [-can-roles] [-in-roles SOURCE/TARGET] [-oti]
```

parámetro|valor predeterminado
---------|-----------------------
-o       |_DUMP_FILE_.can.sql

En la versión canónica:
1. Se quitarán los OID, los TOC entry y los timestamp de Started y Finalized. Funciona tanto con dumps que incluyen TOC como con los que no.
2. Se normalizan los saltos de línea (CRLF → LF).
3. Los roles se quitan con _-no-roles_, se simplifican con _-can-roles_ o se reemplazan con _-in-roles_ (ver más abajo). Aplica a `ALTER … OWNER TO`, `GRANT … TO` y `CREATE POLICY … TO`.
4. Se respetarán las siguientes partes sin reordenamiento:
    1. Definiciones iniciales (`SET` de conexión)
    2. `SET default_tablespace` / `SET default_table_access_method` (se mueven aquí si aparecen en el medio del dump)
    3. Creación de esquemas y extensiones (con sus `COMMENT ON EXTENSION`)
5. Se quitan los datos: bloques `COPY … FROM stdin` (con o sin comentario de cabecera) y llamadas a `SELECT pg_catalog.setval(…)`. Solo se compara el esquema.
6. Se ordenan todas las declaraciones de objetos por tipo y, dentro de cada tipo, alfabéticamente por nombre calificado (esquema.objeto), en este orden:

   `SCHEMA` → `EXTENSION` → `TYPE` → `FUNCTION` → `PROCEDURE` → `SEQUENCE` → `TABLE` → `VIEW` → `CONSTRAINT` → `INDEX` → `TRIGGER` → `POLICY` → `ROW LEVEL SECURITY` → `GRANTS`

7. Dentro del grupo `CONSTRAINT` se ordena por subtipo: `PRIMARY KEY` → `FOREIGN KEY` → `UNIQUE` → `CHECK` → `EXCLUDE` → otros.
8. Con _-oti_ se ordena el interior de cada `CREATE TABLE` (ver más abajo).

## Opciones

### Opciones de roles

Las tres opciones aplican a `ALTER … OWNER TO`, `GRANT … TO` y a la cláusula `TO rol` de `CREATE POLICY`.

opción|efecto
------|------
_(ninguna)_|Se conservan los nombres de roles tal como están
`-no-roles`|Se eliminan todas las líneas `ALTER … OWNER TO`, todos los `GRANT` y la cláusula `TO rol` de `CREATE POLICY`
`-can-roles`|Se acorta cada nombre de rol al sufijo después del último `_`, incluyendo el guion bajo (`ejemplo_muleto_owner` → `_owner`, `ejemplo_muleto_admin` → `_admin`)
`-in-roles SOURCE/TARGET`|Reemplaza la parte interna de cada nombre de rol (ver detalle abajo)

#### `-in-roles SOURCE/TARGET` en detalle

Los nombres de rol suelen seguir el patrón `prefijo_medio_sufijo` (o `prefijo_sufijo` sin parte del medio). SOURCE y TARGET representan el segmento interno a reemplazar, incluyendo sus guiones bajos adyacentes:

- `_` significa "sin parte del medio" (rol de dos partes: `prefijo_sufijo`)
- `_palabra_` significa "la parte del medio es `palabra`"

El reemplazo solo ocurre cuando SOURCE aparece **exactamente una vez** en el nombre del rol, para evitar sustituciones ambiguas.

**Ejemplos:**

| Comando | Rol antes | Rol después |
|---|---|---|
| `-in-roles _muleto_/_in_` | `app_muleto_owner` | `app_in_owner` |
| `-in-roles _muleto_/_` | `app_muleto_owner` | `app_owner` |
| `-in-roles _/_staging_` | `app_owner` | `app_staging_owner` |
| `-in-roles _x_/_y_` | `ab_x_x_cd` (ambiguo) | `ab_x_x_cd` (sin cambio) |

`-in-roles` es útil cuando se comparan dumps de entornos cuyos nombres de roles comparten prefijo y sufijo pero difieren en la parte del medio (por ejemplo `miapp_prod_admin` vs `miapp_staging_admin`).

### `-oti` — Orden interno de tablas (Order Table Internally)

Con este parámetro, el interior de cada `CREATE TABLE` se reordena:

1. Las **columnas** se ordenan alfabéticamente por nombre.
2. Los **constraints** (`CONSTRAINT … CHECK`, `CONSTRAINT … UNIQUE`, etc.) se agrupan al final, también ordenados alfabéticamente por nombre.
3. Las comas se tratan como separadores: todos los elementos excepto el último las tienen, y el último no — independientemente de cómo aparecían en el dump original.

Es útil cuando la misma tabla fue definida en distinto orden en distintos entornos.

### Diferencias

A partir de las versiones canónicas se genera un archivo `only.diff` usando `git diff --no-index` con los siguientes flags:

- `--ignore-blank-lines` — se ignoran las diferencias que solo son líneas en blanco.
- `-w` — se ignoran todas las diferencias de espacios en blanco (espacios, tabs, indentación).

## Requisitos

- Node.js 18+
- Git en el PATH (se usa para generar el diff)
- Un dump en formato plain de PostgreSQL (`pg_dump --format=plain` o `pg_dump -Fp`)

## Ejemplo

```bash
# Generar dumps de dos bases (solo esquema)
pg_dump -Fp -s mydb_prod    > prod.sql
pg_dump -Fp -s mydb_staging > staging.sql

# Comparar simplificando los nombres de roles
pg-dump-compare prod.sql staging.sql -o resultados -can-roles

# Abrir el diff con la herramienta preferida
code resultados/only.diff
```

Los archivos canónicos (`resultados/prod.can.sql`, `resultados/staging.can.sql`) también se pueden comparar con cualquier herramienta de diff externa.

```bash
# Canonicalizar un solo dump con orden interno de tablas y sin owners
pg-dump-compare --canonical prod.sql -o prod.can.sql -oti -no-roles
```

## Desarrollo

```bash
npm install
npm run build   # compila TypeScript → dist/
npm test        # build + tests con Mocha
```

Los tests incluyen tests unitarios del parser y del canonicalizador, tests del comportamiento del diff ante espacios en blanco, y **tests de integración con golden files** que comparan la salida completa contra fixtures guardados en `tests/fixtures/`. Si el comportamiento cambia intencionalmente, regenerar los golden files:

```bash
node dist/cli.js --canonical tests/fixtures/dump1.sql \
    -o tests/fixtures/dump1.oti-no-roles.can.sql -oti -no-roles

node dist/cli.js --canonical tests/fixtures/dump3.sql \
    -o tests/fixtures/dump3.can.sql

node dist/cli.js tests/fixtures/dump1.sql tests/fixtures/dump2.sql \
    -o tests/fixtures -in-roles "_muleto_/_in_"
```

Luego hacer commit de los fixtures actualizados — el diff de git queda como registro de exactamente qué cambió en la salida.
