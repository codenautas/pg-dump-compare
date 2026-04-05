--
-- PostgreSQL database dump
--

-- Dumped from database version 17.0
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


CREATE SCHEMA his;


ALTER SCHEMA his OWNER TO siper_muleto_owner;


CREATE SCHEMA siper;


ALTER SCHEMA siper OWNER TO siper_muleto_owner;


CREATE SCHEMA temp;


ALTER SCHEMA temp OWNER TO siper_muleto_owner;


CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;


COMMENT ON EXTENSION btree_gist IS 'support for indexing common datatypes in GiST';


CREATE TYPE siper.detalle_novedades_multiorigen AS (
	origen text,
	cantidad integer,
	usados integer,
	pendientes integer,
	saldo integer,
	comienzo date,
	vencimiento date
);


ALTER TYPE siper.detalle_novedades_multiorigen OWNER TO siper_muleto_owner;


CREATE TYPE siper.time_range AS RANGE (
    subtype = time without time zone,
    multirange_type_name = siper.time_multirange,
    subtype_diff = siper.time_subtype_diff
);


ALTER TYPE siper.time_range OWNER TO siper_muleto_owner;


CREATE FUNCTION siper.parcial_trg() RETURNS trigger
    LANGUAGE plpgsql
    AS $$

DECLARE

  vparcial boolean; 

BEGIN

  SELECT parcial INTO vparcial

    FROM cod_novedades

    WHERE cod_nov = NEW.cod_nov;

  IF NOT COALESCE(vparcial, false) THEN

    RAISE 'Novedad codigo % NO indica novedad PARCIAL', NEW.cod_nov USING ERRCODE = 'P1006';

  END IF;

  RETURN NEW;

END;

$$;


ALTER FUNCTION siper.parcial_trg() OWNER TO siper_muleto_owner;


CREATE FUNCTION siper.time_subtype_diff(x time without time zone, y time without time zone) RETURNS double precision
    LANGUAGE sql IMMUTABLE STRICT
    AS $$SELECT EXTRACT(EPOCH FROM (x - y))$$;


ALTER FUNCTION siper.time_subtype_diff(x time without time zone, y time without time zone) OWNER TO siper_muleto_owner;


CREATE TABLE siper.tipos_domicilio (
    tipo_domicilio text NOT NULL,
    descripcion text,
    orden integer,
    CONSTRAINT "descripcion<>''" CHECK ((descripcion <> ''::text)),
    CONSTRAINT "palabra corta y solo mayusculas en tipo_domicilio" CHECK ((tipo_domicilio ~ similar_to_escape('[A-Z][A-Z0-9]{0,9}|[1-9]\d{0,10}'::text))),
    CONSTRAINT "tipo_domicilio<>''" CHECK ((tipo_domicilio <> ''::text))
);


ALTER TABLE siper.tipos_domicilio OWNER TO siper_muleto_owner;


CREATE TABLE siper.tipos_fichada (
    tipo_fichada text NOT NULL,
    nombre text NOT NULL,
    orden integer NOT NULL,
    CONSTRAINT "nombre<>''" CHECK ((nombre <> ''::text)),
    CONSTRAINT "tipo_fichada<>''" CHECK ((tipo_fichada <> ''::text))
);


ALTER TABLE siper.tipos_fichada OWNER TO siper_muleto_owner;


CREATE TABLE siper.tipos_novedad (
    tipo_novedad text NOT NULL,
    descripcion text,
    orden integer,
    borrado_rapido boolean NOT NULL,
    CONSTRAINT "descripcion<>''" CHECK ((descripcion <> ''::text)),
    CONSTRAINT "palabra corta y solo mayusculas en tipo_novedad" CHECK ((tipo_novedad ~ similar_to_escape('[A-Z][A-Z0-9]{0,9}|[1-9]\d{0,10}'::text))),
    CONSTRAINT "tipo_novedad<>''" CHECK ((tipo_novedad <> ''::text))
);


ALTER TABLE siper.tipos_novedad OWNER TO siper_muleto_owner;


CREATE TABLE siper.tipos_sec (
    tipo_sec text NOT NULL,
    descripcion text,
    nivel integer,
    CONSTRAINT "descripcion<>''" CHECK ((descripcion <> ''::text)),
    CONSTRAINT "palabra corta y solo mayusculas en tipo_sec" CHECK ((tipo_sec ~ similar_to_escape('[A-Z][A-Z0-9]{0,9}|[1-9]\d{0,10}'::text))),
    CONSTRAINT "tipo_sec<>''" CHECK ((tipo_sec <> ''::text))
);


ALTER TABLE siper.tipos_sec OWNER TO siper_muleto_owner;


CREATE TABLE siper.tipos_telefono (
    tipo_telefono text NOT NULL,
    descripcion text,
    orden integer,
    CONSTRAINT "descripcion<>''" CHECK ((descripcion <> ''::text)),
    CONSTRAINT "palabra corta y solo mayusculas en tipo_telefono" CHECK ((tipo_telefono ~ similar_to_escape('[A-Z][A-Z0-9]{0,9}|[1-9]\d{0,10}'::text))),
    CONSTRAINT "tipo_telefono<>''" CHECK ((tipo_telefono <> ''::text))
);


ALTER TABLE siper.tipos_telefono OWNER TO siper_muleto_owner;


GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE siper.tramos TO siper_muleto_admin;


GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE siper.trayectoria_laboral TO siper_muleto_admin;



--
-- PostgreSQL database dump complete
--
