--
-- PostgreSQL database dump
--

-- Dumped from database version 17.2 (Ubuntu 17.2-1.pgdg22.04+1)
-- Dumped by pg_dump version 17.0

-- Started on 2026-04-03 20:08:28

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

--
-- TOC entry 13 (class 2615 OID 527582)
-- Name: his; Type: SCHEMA; Schema: -; Owner: ejemplo_in_owner
--

CREATE SCHEMA his;


ALTER SCHEMA his OWNER TO ejemplo_in_admin;

--
-- TOC entry 16 (class 2615 OID 527583)
-- Name: ejemplo; Type: SCHEMA; Schema: -; Owner: ejemplo_in_owner
--

CREATE SCHEMA ejemplo;


ALTER SCHEMA ejemplo OWNER TO ejemplo_in_owner;

--
-- TOC entry 17 (class 2615 OID 132620)
-- Name: temp; Type: SCHEMA; Schema: -; Owner: ejemplo_in_owner
--

CREATE SCHEMA temp;


ALTER SCHEMA temp OWNER TO ejemplo_in_owner;

--
-- TOC entry 2 (class 3079 OID 24265)
-- Name: btree_gist; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;


--
-- TOC entry 4946 (class 0 OID 0)
-- Dependencies: 2
-- Name: EXTENSION btree_gist; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION btree_gist IS 'support for indexing common datatypes in GiST';


--
-- TOC entry 349 (class 1255 OID 527587)
-- Name: time_subtype_diff(time without time zone, time without time zone); Type: FUNCTION; Schema: ejemplo; Owner: ejemplo_in_owner
--

CREATE FUNCTION ejemplo.time_subtype_diff(x time without time zone, y time without time zone) RETURNS double precision
    LANGUAGE sql IMMUTABLE STRICT
    AS $$SELECT EXTRACT(EPOCH FROM (x - y))$$;


ALTER FUNCTION ejemplo.time_subtype_diff(x time without time zone, y time without time zone) OWNER TO ejemplo_in_owner;


--
-- TOC entry 466 (class 1255 OID 527598)
-- Name: changes_trg(); Type: FUNCTION; Schema: his; Owner: ejemplo_in_owner
--

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
      (cha_schema     , cha_table    , cha_old_pk, cha_op, cha_old_value, cha_who      , cha_when         ) values
      (tg_table_schema, tg_table_name, v_old_pk  , tg_op , v_old_values , session_user , clock_timestamp());
    return null;
  end if;
end;
$$;


ALTER FUNCTION his.changes_trg() OWNER TO ejemplo_in_owner;
--
-- TOC entry 1225 (class 1247 OID 527591)
-- Name: time_range; Type: TYPE; Schema: ejemplo; Owner: ejemplo_in_owner
--

CREATE TYPE ejemplo.time_range AS RANGE (
    subtype = time without time zone,
    multirange_type_name = ejemplo.time_multirange,
    subtype_diff = ejemplo.time_subtype_diff
);


ALTER TYPE ejemplo.time_range OWNER TO ejemplo_in_owner;

--
-- TOC entry 476 (class 1255 OID 527601)
-- Name: annio_abrir(integer); Type: FUNCTION; Schema: ejemplo; Owner: ejemplo_in_owner
--

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


ALTER FUNCTION ejemplo.annio_abrir(p_annio integer) OWNER TO ejemplo_in_owner;

--
-- TOC entry 343 (class 1255 OID 527602)
-- Name: annio_preparar(integer); Type: FUNCTION; Schema: ejemplo; Owner: ejemplo_in_owner
--

CREATE FUNCTION ejemplo.annio_preparar(p_annio integer) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO annios (annio, abierto, anterior) VALUES (p_annio, false, (SELECT annio FROM annios WHERE annio = p_annio - 1 ));
  INSERT INTO fechas (fecha) 
    SELECT d FROM generate_series(make_date(p_annio,1,1), make_date(p_annio,12,31), '1 day'::INTERVAL) d;
END;
$$;


ALTER FUNCTION ejemplo.annio_preparar(p_annio integer) OWNER TO ejemplo_in_owner;


--
-- TOC entry 356 (class 1255 OID 527603)
-- Name: archivo_borrar_trg(); Type: FUNCTION; Schema: ejemplo; Owner: ejemplo_in_owner
--

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


ALTER FUNCTION ejemplo.archivo_borrar_trg() OWNER TO ejemplo_in_owner;

--
-- TOC entry 414 (class 1255 OID 527604)
-- Name: fecha_actual(); Type: FUNCTION; Schema: ejemplo; Owner: ejemplo_in_owner
--

CREATE FUNCTION ejemplo.fecha_actual() RETURNS date
    LANGUAGE sql STABLE
    AS $$

    SELECT date_trunc('day', fecha_hora_actual());
$$;


ALTER FUNCTION ejemplo.fecha_actual() OWNER TO ejemplo_in_owner;

SET default_tablespace = '';

SET default_table_access_method = heap;


--
-- TOC entry 395 (class 1255 OID 527636)
-- Name: enance_table(text, text, text); Type: FUNCTION; Schema: ejemplo; Owner: ejemplo_in_owner
--

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


ALTER FUNCTION ejemplo.enance_table(table_name text, primary_key_fields text, method text) OWNER TO ejemplo_in_owner;

--
-- TOC entry 421 (class 1255 OID 527637)
-- Name: fecha_hora_actual(); Type: FUNCTION; Schema: ejemplo; Owner: ejemplo_in_owner
--

CREATE FUNCTION ejemplo.fecha_hora_actual() RETURNS timestamp without time zone
    LANGUAGE sql STABLE
    AS $$

      SELECT coalesce(fecha_hora_para_test, current_timestamp)
        from parametros
        where unico_registro;

$$;


ALTER FUNCTION ejemplo.fecha_hora_actual() OWNER TO ejemplo_in_owner;


--
-- TOC entry 397 (class 1255 OID 527639)
-- Name: get_app_user(text); Type: FUNCTION; Schema: ejemplo; Owner: ejemplo_in_owner
--

CREATE FUNCTION ejemplo.get_app_user(p_var text DEFAULT 'user'::text) RETURNS text
    LANGUAGE sql STABLE
    AS $$
  select current_setting('backend_plus._' || p_var);
$$;


ALTER FUNCTION ejemplo.get_app_user(p_var text) OWNER TO ejemplo_in_owner;

--
-- TOC entry 514 (class 1255 OID 527680)
-- Name: set_app_user(text); Type: PROCEDURE; Schema: ejemplo; Owner: ejemplo_in_owner
--

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


ALTER PROCEDURE ejemplo.set_app_user(IN p_username text) OWNER TO ejemplo_in_owner;


--
-- TOC entry 243 (class 1259 OID 527686)
-- Name: secuencia_bitacora; Type: SEQUENCE; Schema: ejemplo; Owner: ejemplo_in_owner
--

CREATE SEQUENCE ejemplo.secuencia_bitacora
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE ejemplo.secuencia_bitacora OWNER TO ejemplo_in_owner;

--
-- TOC entry 244 (class 1259 OID 527687)
-- Name: bitacora; Type: TABLE; Schema: his; Owner: ejemplo_in_owner
--

CREATE TABLE his.bitacora (
    id bigint DEFAULT nextval('ejemplo.secuencia_bitacora'::regclass) NOT NULL,
    "procedure_name" text NOT NULL,
    parameters text,
    username text,
    machine_id text,
    navigator text,
    init_date timestamp without time zone NOT NULL,
    end_date timestamp without time zone,
    has_error boolean,
    end_status text,
    CONSTRAINT "end_status<>''" CHECK ((end_status <> ''::text)),
    CONSTRAINT "machine_id<>''" CHECK ((machine_id <> ''::text)),
    CONSTRAINT "navigator<>''" CHECK ((navigator <> ''::text)),
    CONSTRAINT "parameters<>''" CHECK ((parameters <> ''::text)),
    CONSTRAINT "procedure_name<>''" CHECK ((procedure_name <> ''::text)),
    CONSTRAINT "username<>''" CHECK ((username <> ''::text))
);


ALTER TABLE his.bitacora OWNER TO ejemplo_in_owner;

--
-- TOC entry 245 (class 1259 OID 527699)
-- Name: changes; Type: TABLE; Schema: his; Owner: ejemplo_in_owner
--

CREATE TABLE his.changes (
    cha_schema text,
    cha_table text,
    cha_new_pk jsonb,
    cha_old_pk jsonb,
    cha_column text,
    cha_op text,
    cha_new_value jsonb,
    cha_old_value jsonb,
    cha_who text,
    cha_when timestamp without time zone,
    cha_context text
);


ALTER TABLE his.changes OWNER TO ejemplo_in_owner;

--
-- TOC entry 2691 (class 1259 OID 527892)
-- Name: skip_chantes; Type: TABLE; Schema: ejemplo; Owner: postgres
--

CREATE TABLE skip_chantes (
    cha_schema text,
    cha_table text,
    primary key (cha_schema)
);

ALTER TABLE skip_chantes OWNER TO postgres;


--
-- TOC entry 269 (class 1259 OID 527892)
-- Name: grupos; Type: TABLE; Schema: ejemplo; Owner: ejemplo_in_owner
--

CREATE TABLE ejemplo.grupos (
    clase text NOT NULL,
    grupo text NOT NULL,
    descripcion text,
    CONSTRAINT "clase<>''" CHECK ((clase <> ''::text)),
    CONSTRAINT "descripcion<>''" CHECK ((descripcion <> ''::text)),
    CONSTRAINT "grupo<>''" CHECK ((grupo <> ''::text)),
    CONSTRAINT "palabra corta y solo mayusculas en grupo" CHECK ((grupo ~ similar_to_escape('[A-Z][A-Z0-9]{0,9}|[1-9]\d{0,10}'::text)))
);


ALTER TABLE ejemplo.grupos OWNER TO ejemplo_in_owner;


--
-- TOC entry 272 (class 1259 OID 527920)
-- Name: horarios; Type: VIEW; Schema: ejemplo; Owner: ejemplo_in_owner
--

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


ALTER VIEW ejemplo.horarios OWNER TO ejemplo_in_owner;

--
-- TOC entry 273 (class 1259 OID 527924)
-- Name: horarios_cod; Type: TABLE; Schema: ejemplo; Owner: ejemplo_in_owner
--

CREATE TABLE ejemplo.horarios_cod (
    horario text NOT NULL,
    CONSTRAINT "horario<>''" CHECK ((horario <> ''::text))
);


ALTER TABLE ejemplo.horarios_cod OWNER TO ejemplo_in_owner;


--
-- TOC entry 279 (class 1259 OID 527966)
-- Name: niveles_educativos; Type: TABLE; Schema: ejemplo; Owner: ejemplo_in_owner
--

CREATE TABLE ejemplo.niveles_educativos (
    nivel_educativo text NOT NULL,
    nombre text,
    CONSTRAINT "nivel_educativo<>''" CHECK ((nivel_educativo <> ''::text)),
    CONSTRAINT "nombre<>''" CHECK ((nombre <> ''::text))
);


ALTER TABLE ejemplo.niveles_educativos OWNER TO ejemplo_in_owner;



--
-- TOC entry 4875 (class 0 OID 527803)
-- Dependencies: 258
-- Data for Name: capa_modalidades; Type: TABLE DATA; Schema: ejemplo; Owner: ejemplo_in_owner
--

COPY ejemplo.capa_modalidades (modalidad, observaciones) FROM stdin;
Docente	\N
Expositor	\N
Seminario	\N
Jornada	\N
Beca	\N
Curso	\N
Disertante	\N
Diplomatura	\N
Charla	\N
Taller	\N
Congreso	\N
\.



--
-- TOC entry 4884 (class 0 OID 527876)
-- Dependencies: 267
-- Data for Name: funciones; Type: TABLE DATA; Schema: ejemplo; Owner: ejemplo_in_owner
--

INSERT INTO ejemplo.funciones (funcion, descripcion, cod_2024) VALUES
  (0,'Sin funcion  definida',0);


--
-- TOC entry 4886 (class 0 OID 527892)
-- Dependencies: 269
-- Data for Name: grupos; Type: TABLE DATA; Schema: ejemplo; Owner: ejemplo_in_owner
--

COPY ejemplo.grupos (clase, grupo, descripcion) FROM stdin;
C	CC	Con Cónyuge
C	SC	Sin Cónyuge
H	CH	Con hijos
H	SH	Sin hijos
P	E	Encuestadores
P	R	Resto
P	S	Personal superior
S	F	Femenino
S	M	Masculino
S	X	X
U	T	Todos
\.


--
-- TOC entry 4889 (class 0 OID 527924)
-- Dependencies: 273
-- Data for Name: horarios_cod; Type: TABLE DATA; Schema: ejemplo; Owner: ejemplo_in_owner
--

COPY ejemplo.horarios_cod (horario) FROM stdin;
9a16
10a17
11a18
\.



COPY ejemplo.niveles_educativos (nivel_educativo, nombre) FROM stdin;
PC	PRIMARIA COMPLETA
SC	SECUNDARIA COMPLETA
TC	TERCIARIO COMPLETO
UC	UNIVERSITARIO COMPLETO
MC	POSTGRADO COMPLETO
\.


--
-- TOC entry 5039 (class 0 OID 0)
-- Dependencies: 274
-- Name: idr_seq; Type: SEQUENCE SET; Schema: ejemplo; Owner: ejemplo_in_owner
--

SELECT pg_catalog.setval('ejemplo.idr_seq', 3469, true);


--
-- TOC entry 5040 (class 0 OID 0)
-- Dependencies: 282
-- Name: nov_per_importado_id_importacion_seq; Type: SEQUENCE SET; Schema: ejemplo; Owner: ejemplo_in_owner
--


--
-- TOC entry 5044 (class 0 OID 0)
-- Dependencies: 243
-- Name: secuencia_bitacora; Type: SEQUENCE SET; Schema: ejemplo; Owner: ejemplo_in_owner
--

SELECT pg_catalog.setval('ejemplo.secuencia_bitacora', 3115, true);


--
-- TOC entry 4263 (class 2606 OID 528367)
-- Name: bitacora bitacora_pkey; Type: CONSTRAINT; Schema: his; Owner: ejemplo_in_owner
--

ALTER TABLE ONLY his.bitacora
    ADD CONSTRAINT bitacora_pkey PRIMARY KEY (id);


--
-- TOC entry 4299 (class 2606 OID 528397)
-- Name: clases clases_nombre_key; Type: CONSTRAINT; Schema: ejemplo; Owner: ejemplo_in_owner
--

ALTER TABLE ONLY ejemplo.clases
    ADD CONSTRAINT clases_nombre_key UNIQUE (nombre);


--
-- TOC entry 4301 (class 2606 OID 528399)
-- Name: clases clases_pkey; Type: CONSTRAINT; Schema: ejemplo; Owner: ejemplo_in_owner
--

ALTER TABLE ONLY ejemplo.clases
    ADD CONSTRAINT clases_pkey PRIMARY KEY (clase);


--
-- TOC entry 4337 (class 2606 OID 528491)
-- Name: horarios_per sin superponer fechas; Type: CONSTRAINT; Schema: ejemplo; Owner: ejemplo_in_owner
--

ALTER TABLE ONLY ejemplo.horarios_per
    ADD CONSTRAINT "sin superponer fechas" EXCLUDE USING gist (idper WITH =, lapso_fechas WITH &&);


--
-- TOC entry 4302 (class 1259 OID 528536)
-- Name: clase 4 cod_novedades IDX; Type: INDEX; Schema: ejemplo; Owner: ejemplo_in_owner
--

CREATE INDEX "clase 4 cod_novedades IDX" ON ejemplo.cod_novedades USING btree (clase);


--
-- TOC entry 4322 (class 1259 OID 528537)
-- Name: clase 4 grupos IDX; Type: INDEX; Schema: ejemplo; Owner: ejemplo_in_owner
--

CREATE INDEX "clase 4 grupos IDX" ON ejemplo.grupos USING btree (clase);


--
-- TOC entry 4610 (class 2620 OID 528624)
-- Name: clases changes_trg; Type: TRIGGER; Schema: ejemplo; Owner: ejemplo_in_owner
--

CREATE TRIGGER changes_trg AFTER INSERT OR DELETE OR UPDATE ON ejemplo.clases FOR EACH ROW EXECUTE FUNCTION his.changes_trg('clase');



--
-- TOC entry 4618 (class 2620 OID 528632)
-- Name: grupos changes_trg; Type: TRIGGER; Schema: ejemplo; Owner: ejemplo_in_owner
--

CREATE TRIGGER changes_trg AFTER INSERT OR DELETE OR UPDATE ON ejemplo.grupos FOR EACH ROW EXECUTE FUNCTION his.changes_trg('clase,grupo');


--
-- TOC entry 4509 (class 2606 OID 528692)
-- Name: adjuntos adjuntos tipos_adjunto REL; Type: FK CONSTRAINT; Schema: ejemplo; Owner: ejemplo_in_owner
--

ALTER TABLE ONLY ejemplo.adjuntos
    ADD CONSTRAINT "adjuntos tipos_adjunto REL" FOREIGN KEY (tipo_adjunto) REFERENCES ejemplo.tipos_adjunto(tipo_adjunto) ON UPDATE CASCADE;


--
-- TOC entry 4510 (class 2606 OID 528697)
-- Name: adjuntos_atributos adjuntos_atributos adjuntos REL; Type: FK CONSTRAINT; Schema: ejemplo; Owner: ejemplo_in_owner
--

ALTER TABLE ONLY ejemplo.adjuntos_atributos
    ADD CONSTRAINT "adjuntos_atributos adjuntos REL" FOREIGN KEY (numero_adjunto) REFERENCES ejemplo.adjuntos(numero_adjunto) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- TOC entry 4832 (class 3256 OID 529144)
-- Name: novedades_vigentes bp base; Type: POLICY; Schema: ejemplo; Owner: ejemplo_in_owner
--

CREATE POLICY "bp base" ON ejemplo.novedades_vigentes TO ejemplo_in_admin USING (true);


--
-- TOC entry 4833 (class 3256 OID 529145)
-- Name: personas bp base; Type: POLICY; Schema: ejemplo; Owner: ejemplo_in_owner
--

CREATE POLICY "bp base" ON ejemplo.personas TO ejemplo_in_admin USING (true);


--
-- TOC entry 4834 (class 3256 OID 529146)
-- Name: trayectoria_laboral bp base; Type: POLICY; Schema: ejemplo; Owner: ejemplo_in_owner
--

CREATE POLICY "bp base" ON ejemplo.trayectoria_laboral TO ejemplo_in_admin USING (true);


--
-- TOC entry 4835 (class 3256 OID 529147)
-- Name: novedades_horarias bp delete; Type: POLICY; Schema: ejemplo; Owner: ejemplo_in_owner
--

CREATE POLICY "bp delete" ON ejemplo.novedades_horarias AS RESTRICTIVE FOR DELETE TO ejemplo_in_admin USING (((( SELECT roles.puede_cargar_todo
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



--
-- TOC entry 4825 (class 0 OID 528016)
-- Dependencies: 286
-- Name: novedades_registradas; Type: ROW SECURITY; Schema: ejemplo; Owner: ejemplo_in_owner
--

ALTER TABLE ejemplo.novedades_registradas ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 4823 (class 0 OID 527648)
-- Dependencies: 242
-- Name: novedades_vigentes; Type: ROW SECURITY; Schema: ejemplo; Owner: ejemplo_in_owner
--

ALTER TABLE ejemplo.novedades_vigentes ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 4826 (class 0 OID 528118)
-- Dependencies: 295
-- Name: personas; Type: ROW SECURITY; Schema: ejemplo; Owner: ejemplo_in_owner
--

GRANT USAGE ON SCHEMA ejemplo TO ejemplo_in_admin;
GRANT USAGE ON SCHEMA ejemplo TO ejemplo_modulo_fichador;


--
-- TOC entry 4945 (class 0 OID 0)
-- Dependencies: 17
-- Name: SCHEMA temp; Type: ACL; Schema: -; Owner: ejemplo_in_owner
--

GRANT USAGE ON SCHEMA temp TO ejemplo_in_admin;


--
-- TOC entry 4947 (class 0 OID 0)
-- Dependencies: 239
-- Name: TABLE annios; Type: ACL; Schema: ejemplo; Owner: ejemplo_in_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE ejemplo.annios TO ejemplo_in_admin;


--
-- TOC entry 4948 (class 0 OID 0)
-- Dependencies: 240
-- Name: TABLE fechas; Type: ACL; Schema: ejemplo; Owner: ejemplo_in_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE ejemplo.fechas TO ejemplo_in_admin;



--
-- TOC entry 4981 (class 0 OID 0)
-- Dependencies: 318 4975
-- Name: COLUMN fichadas_recibidas.texto; Type: ACL; Schema: ejemplo; Owner: ejemplo_in_owner
--

GRANT SELECT(texto),INSERT(texto),UPDATE(texto) ON TABLE ejemplo.fichadas_recibidas TO ejemplo_modulo_fichador;


--
-- TOC entry 4982 (class 0 OID 0)
-- Dependencies: 318 4975
-- Name: COLUMN fichadas_recibidas.dispositivo; Type: ACL; Schema: ejemplo; Owner: ejemplo_in_owner
--

GRANT SELECT(dispositivo),INSERT(dispositivo),UPDATE(dispositivo) ON TABLE ejemplo.fichadas_recibidas TO ejemplo_modulo_fichador;



--
-- TOC entry 5036 (class 0 OID 0)
-- Dependencies: 315
-- Name: TABLE trayectoria_laboral; Type: ACL; Schema: ejemplo; Owner: ejemplo_in_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE ejemplo.trayectoria_laboral TO ejemplo_in_admin;


-- Completed on 2026-04-03 20:08:31

--
-- PostgreSQL database dump complete
--

SET transaction_timeout = 1;