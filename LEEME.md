# pg-dump-compare

## Objetivo

Tener una herramienta que encuentre la diferencia entre dos bases de datos (o entre dos conjuntos de esquemas) 
usando como input el el `pg_dump -f plain`.

¿Por qué no simplemente comparar ambos dumps con un `diff` de texto? 
Porque Postgres no garantiza el orden en que se aparecen las definiciones de los objetos de la base.

## Uso

```bash
$ pg-dump-compare SOURCE TARGET [-o OUTPUT_PATH] [-no-owner] [-can-owner]
```

parámetro|valor predeterminado
---------|-----------------------
-o       |pg-dump-compare-results

## Funcionamiento

_pg-dump-compare_ generará una serie de archivos de resultado en la carpeta _OUTPUT_PATH_

### Versiones canónicas de SOURCE y TARGET

Para que el usuario pueda utilizar su herramienta de diff preferida _pg-dump-compare_ generará una versión canónica de _SOURCE_ y de _TARGET_ (con la extensión .can.sql). 

La versión canónica también se puede obtener así:

```bash
$ pg-dump-compare --canonical DUMP_FILE [-o CANONICAL_FILE]
```

parámetro|valor predeterminado
---------|-----------------------
-o       |_DUMP__FILE_.con.sql

En la versión canónica:
1. Se quitarán los OID, los TOC entry y los timestamp de Started y Finalized
2. Los owner se quitan con _-no-owner_ o se simlifican con _-can-owner_ (en este último caso solo irá el sufijo después de la raya `_`)
3. Se respetarán las siguientes partes sin reordenamiento:
    1. definiciones iniciales
    2. creación de esquemas y extensiones
    3. definiciones finales (sets para restaurar opciones)
4. Se quitan los insert o copy from
5. Se ordenan todos las declaraciones de objetos de function, procedures, types, tables, etc...
6. Se ordenan por tipo de definición en un orden específico:
    SCHEMA, EXTENSION, TYPE, FUNCTION, PROCEDURE, SEQUENCE, TABLE, VIEW, CONSTRAINTS (PRIMARY KEY, FOREIGN KEY, UNIQUE, CHECK, EXCLUDE, others), INDEX, TRIGGER, POLICY, ROW LEVEL SECURITY, GRANTS
El criterio de ordenamiento es alfabético del nombre del objeto (cualificado por el esquema). 

### Diferencias

A partir de las versiones canónicas se genera un archivo `only.diff` estándar a partir de dos versiones reducidas de los canónicos donde no están las definiciones idénticas. 