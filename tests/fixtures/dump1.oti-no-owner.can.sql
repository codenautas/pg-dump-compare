--
-- PostgreSQL database dump
--

-- Dumped from database version 17.2 (Ubuntu 17.2-1.pgdg22.04+1)
-- Dumped by pg_dump version 17.0

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;
SET default_tablespace = '';
SET default_table_access_method = heap;


CREATE SCHEMA his;


CREATE SCHEMA ejemplo;


CREATE SCHEMA temp;


CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;


COMMENT ON EXTENSION btree_gist IS 'support for indexing common datatypes in GiST';


CREATE TYPE ejemplo.time_range AS RANGE (
    subtype = time without time zone,
    multirange_type_name = ejemplo.time_multirange,
    subtype_diff = ejemplo.time_subtype_diff
);


CREATE FUNCTION ejemplo.annio_abrir(p_annio integer) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  UPDATE annios 
    SET abierto = true
    WHERE annio = p_annio;
  CALL actualizar_novedades_vigentes(make_date(p_annio,1,1), make_date(p_annio,12,31));
END;
$$;


CREATE FUNCTION ejemplo.annio_preparar(p_annio integer) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO annios (annio, abierto, anterior) VALUES (p_annio, false, (SELECT annio FROM annios WHERE annio = p_annio - 1 ));
  INSERT INTO fechas (fecha) 
    SELECT d FROM generate_series(make_date(p_annio,1,1), make_date(p_annio,12,31), '1 day'::INTERVAL) d;
END;
$$;


CREATE FUNCTION ejemplo.archivo_borrar_trg() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if old.archivo_nombre_fisico is not null then
    insert into archivos_borrar ("ruta_archivo") values (old.archivo_nombre_fisico);
  end if;
  return old;
end;
$$;


CREATE FUNCTION ejemplo.enance_table(table_name text, primary_key_fields text, method text DEFAULT 'iud'::text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    AS $_$
declare
  v_sql text;
begin
  v_sql=replace($sql$
    DROP TRIGGER IF EXISTS changes_trg ON table_name;
    DROP TRIGGER IF EXISTS changes_ud_trg ON table_name
  $sql$
    ,'table_name', table_name);
  execute v_sql;
  v_sql=replace(replace($sql$
    CREATE TRIGGER changes_trg
      AFTER INSERT OR UPDATE OR DELETE
      ON table_name
      FOR EACH ROW
      EXECUTE PROCEDURE his.changes_trg('primary_key_fields');
  $sql$
    ,'table_name', table_name)
    ,'primary_key_fields', primary_key_fields);
  if method = 'ud' then
    v_sql=replace(v_sql, 'AFTER INSERT OR UPDATE OR DELETE', 'AFTER UPDATE OR DELETE');
    v_sql=replace(v_sql, 'CREATE TRIGGER changes_trg', 'CREATE TRIGGER changes_ud_trg');
  end if;
  execute v_sql;
  return 'ok';
end;
$_$;


CREATE FUNCTION ejemplo.fecha_actual() RETURNS date
    LANGUAGE sql STABLE
    AS $$

    SELECT date_trunc('day', fecha_hora_actual());
$$;


CREATE FUNCTION ejemplo.fecha_hora_actual() RETURNS timestamp without time zone
    LANGUAGE sql STABLE
    AS $$

      SELECT coalesce(fecha_hora_para_test, current_timestamp)
        from parametros
        where unico_registro;

$$;


CREATE FUNCTION ejemplo.get_app_user(p_var text DEFAULT 'user'::text) RETURNS text
    LANGUAGE sql STABLE
    AS $$
  select current_setting('backend_plus._' || p_var);
$$;


CREATE FUNCTION ejemplo.time_subtype_diff(x time without time zone, y time without time zone) RETURNS double precision
    LANGUAGE sql IMMUTABLE STRICT
    AS $$SELECT EXTRACT(EPOCH FROM (x - y))$$;


CREATE FUNCTION his.changes_trg() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
declare
  p_primary_key_values text[]:=regexp_split_to_array(tg_argv[0], ',');
  v_new_pk jsonb;
  v_old_pk jsonb;
  v_new_value jsonb;
  v_old_value jsonb;
  v_new_values jsonb;
  v_old_values jsonb;
  v_column text;
  v_new_pk_values jsonb:='{}';
  v_context text;
begin
  if tg_op = 'INSERT' or tg_op = 'UPDATE' then
    v_new_pk:='{}';
    v_new_values:=to_jsonb(new);
    foreach v_column in array p_primary_key_values 
    loop
      v_new_pk:=jsonb_set(v_new_pk, array[v_column], v_new_values #> array[v_column]);
    end loop;
  else
    v_new_values:='{}';
  end if;
  if tg_op = 'DELETE' or tg_op = 'UPDATE' then
    v_old_pk:='{}';
    v_old_values:=to_jsonb(old);
    foreach v_column in array p_primary_key_values 
    loop
      v_old_pk:=jsonb_set(v_old_pk, array[v_column], v_old_values -> v_column);
    end loop;
  else
    v_old_values:='{}';
  end if;
  select nullif(setting,'') into v_context from pg_settings where name='application_name';
  if tg_op = 'INSERT' OR tg_op = 'UPDATE' then
    for v_column in select jsonb_object_keys(v_new_values) 
    loop
      v_new_value = v_new_values -> v_column;
      v_old_value = v_old_values -> v_column;
      if v_old_value is null then
        v_old_value:='null'::jsonb;
      end if;
      if v_new_value is distinct from v_old_value then
        insert into "his".changes 
          (cha_schema     , cha_table    , cha_new_pk, cha_old_pk, cha_column, cha_op, cha_new_value, cha_old_value, cha_who      , cha_when         , cha_context) values
          (tg_table_schema, tg_table_name, v_new_pk  , v_old_pk  , v_column  , tg_op , v_new_value  , v_old_value  , session_user , clock_timestamp(), v_context  );
      end if;
    end loop;
    return new;
  else
    insert into "his".changes 
      (cha_schema     , cha_table    , cha_old_pk, cha_op, cha_old_value, cha_who      , cha_when         , cha_context) values
      (tg_table_schema, tg_table_name, v_old_pk  , tg_op , v_old_values , session_user , clock_timestamp(), v_context  );
    return null;
  end if;
end;
$$;


CREATE PROCEDURE ejemplo.set_app_user(IN p_username text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
declare
    
        "v_usuario" text;
        "v_rol" text;
        "v_idper" text;
        "v_sector" text;
begin
    if p_username = '!login' then
        
        set backend_plus._usuario = '!';
        set backend_plus._rol = '!';
        set backend_plus._idper = '!';
        set backend_plus._sector = '!';

        set backend_plus._mode = login;
    else
        select "usuario", "rol", "idper", "sector"
            into "v_usuario", "v_rol", "v_idper", "v_sector"
            
            from usuarios left join personas p using (idper)
                where "usuario" = p_username;
        
        perform set_config('backend_plus._usuario', v_usuario, false);
        perform set_config('backend_plus._rol', v_rol, false);
        perform set_config('backend_plus._idper', v_idper, false);
        perform set_config('backend_plus._sector', v_sector, false);

        set backend_plus._mode = normal;
    end if;
    perform set_config('backend_plus._user', p_username, false);
end;    
$$;


CREATE SEQUENCE ejemplo.secuencia_bitacora
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


CREATE TABLE ejemplo.annios (
    abierto boolean DEFAULT false NOT NULL,
    annio integer NOT NULL,
    anterior integer,
    horario_habitual_desde time without time zone,
    horario_habitual_hasta time without time zone,
);


CREATE TABLE ejemplo.grupos (
    clase text NOT NULL,
    descripcion text,
    grupo text NOT NULL,
    CONSTRAINT "clase<>''" CHECK ((clase <> ''::text)),
    CONSTRAINT "descripcion<>''" CHECK ((descripcion <> ''::text)),
    CONSTRAINT "grupo<>''" CHECK ((grupo <> ''::text)),
    CONSTRAINT "palabra corta y solo mayusculas en grupo" CHECK ((grupo ~ similar_to_escape('[A-Z][A-Z0-9]{0,9}|[1-9]\d{0,10}'::text))),
);


CREATE TABLE ejemplo.horarios_cod (
    horario text NOT NULL,
    CONSTRAINT "horario<>''" CHECK ((horario <> ''::text)),
);


CREATE TABLE ejemplo.niveles_educativos (
    nivel_educativo text NOT NULL,
    nombre text,
    CONSTRAINT "nivel_educativo<>''" CHECK ((nivel_educativo <> ''::text)),
    CONSTRAINT "nombre<>''" CHECK ((nombre <> ''::text)),
);


CREATE TABLE his.bitacora (
    end_date timestamp without time zone,
    end_status text,
    has_error boolean,
    id bigint DEFAULT nextval('ejemplo.secuencia_bitacora'::regclass) NOT NULL,
    init_date timestamp without time zone NOT NULL,
    machine_id text NOT NULL,
    navigator text NOT NULL,
    parameters text NOT NULL,
    procedure_name text NOT NULL,
    username text NOT NULL,
    CONSTRAINT "end_status<>''" CHECK ((end_status <> ''::text)),
    CONSTRAINT "machine_id<>''" CHECK ((machine_id <> ''::text)),
    CONSTRAINT "navigator<>''" CHECK ((navigator <> ''::text)),
    CONSTRAINT "parameters<>''" CHECK ((parameters <> ''::text)),
    CONSTRAINT "procedure_name<>''" CHECK ((procedure_name <> ''::text)),
    CONSTRAINT "username<>''" CHECK ((username <> ''::text)),
);


CREATE TABLE his.changes (
    cha_column text,
    cha_context text,
    cha_new_pk jsonb,
    cha_new_value jsonb,
    cha_old_pk jsonb,
    cha_old_value jsonb,
    cha_op text,
    cha_schema text,
    cha_table text,
    cha_when timestamp without time zone,
    cha_who text,
);


CREATE VIEW ejemplo.horarios AS
 SELECT hp.idper,
    hd.dds,
    hp.annio,
    hp.desde,
    hp.hasta,
    ((hd.dds >= 1) AND (hd.dds <= 5)) AS trabaja,
    hd.hora_desde,
    hd.hora_hasta,
    hp.lapso_fechas
   FROM (ejemplo.horarios_per hp
     JOIN ejemplo.horarios_dds hd USING (horario));


ALTER TABLE ONLY ejemplo.clases
    ADD CONSTRAINT clases_pkey PRIMARY KEY (clase);


ALTER TABLE ONLY his.bitacora
    ADD CONSTRAINT bitacora_pkey PRIMARY KEY (id);


ALTER TABLE ONLY ejemplo.adjuntos
    ADD CONSTRAINT "adjuntos tipos_adjunto REL" FOREIGN KEY (tipo_adjunto) REFERENCES ejemplo.tipos_adjunto(tipo_adjunto) ON UPDATE CASCADE;


ALTER TABLE ONLY ejemplo.adjuntos_atributos
    ADD CONSTRAINT "adjuntos_atributos adjuntos REL" FOREIGN KEY (numero_adjunto) REFERENCES ejemplo.adjuntos(numero_adjunto) ON UPDATE CASCADE ON DELETE CASCADE;


ALTER TABLE ONLY ejemplo.clases
    ADD CONSTRAINT clases_nombre_key UNIQUE (nombre);


ALTER TABLE ONLY ejemplo.horarios_per
    ADD CONSTRAINT "sin superponer fechas" EXCLUDE USING gist (idper WITH =, lapso_fechas WITH &&);


CREATE INDEX "clase 4 cod_novedades IDX" ON ejemplo.cod_novedades USING btree (clase);


CREATE INDEX "clase 4 grupos IDX" ON ejemplo.grupos USING btree (clase);


CREATE TRIGGER changes_trg AFTER INSERT OR DELETE OR UPDATE ON ejemplo.clases FOR EACH ROW EXECUTE FUNCTION his.changes_trg('clase');


CREATE TRIGGER changes_trg AFTER INSERT OR DELETE OR UPDATE ON ejemplo.grupos FOR EACH ROW EXECUTE FUNCTION his.changes_trg('clase,grupo');


CREATE POLICY "bp delete" ON ejemplo.novedades_horarias AS RESTRICTIVE FOR DELETE USING (((( SELECT roles.puede_cargar_todo
   FROM ejemplo.roles
  WHERE (roles.rol = ejemplo.get_app_user('rol'::text))) OR ( SELECT roles.puede_cargar_propio
   FROM ejemplo.roles
  WHERE ((roles.rol = ejemplo.get_app_user('rol'::text)) AND (novedades_horarias.idper = ejemplo.get_app_user('idper'::text)))) OR (( SELECT roles.puede_cargar_dependientes
   FROM ejemplo.roles
  WHERE (roles.rol = ejemplo.get_app_user('rol'::text))) AND ( SELECT ejemplo.sector_pertenece(( SELECT personas.sector
           FROM ejemplo.personas
          WHERE (personas.idper = novedades_horarias.idper)), ejemplo.get_app_user('sector'::text)) AS sector_pertenece))) AND (
CASE
    WHEN (fecha > ejemplo.fecha_actual()) THEN true
    WHEN (fecha < ejemplo.fecha_actual()) THEN false
    ELSE ( SELECT ((ejemplo.fecha_hora_actual() - (ejemplo.fecha_actual())::timestamp without time zone) <= (parametros.carga_nov_hasta_hora)::interval)
       FROM ejemplo.parametros)
END OR ( SELECT roles.puede_corregir_el_pasado
   FROM ejemplo.roles
  WHERE (roles.rol = ejemplo.get_app_user('rol'::text))))));


CREATE POLICY "bp base" ON ejemplo.novedades_vigentes USING (true);


CREATE POLICY "bp base" ON ejemplo.personas USING (true);


CREATE POLICY "bp base" ON ejemplo.trayectoria_laboral USING (true);


ALTER TABLE ejemplo.novedades_registradas ENABLE ROW LEVEL SECURITY;


ALTER TABLE ejemplo.novedades_vigentes ENABLE ROW LEVEL SECURITY;




--
-- PostgreSQL database dump complete
--

SET transaction_timeout = 1;
