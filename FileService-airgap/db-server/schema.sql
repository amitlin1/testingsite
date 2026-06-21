-- ============================================================
-- FileService / DigitalFactory  schema
-- Run this whole file once in DBeaver against an EMPTY database.
-- Full DDL for all tables + seed data for 6 reference tables.
-- Generated 2026-05-28T11:22:06Z
-- ============================================================

--
-- PostgreSQL database dump
--

\restrict admfZWBjgAnlGQV4G3iBOwNyrVJa2sMREpBJM5YHuU3VZXPIvFIfA5dpL2ZvkVU

-- Dumped from database version 16.11
-- Dumped by pg_dump version 16.11

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: bucket; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA bucket;


--
-- Name: general; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA general;


--
-- Name: inventory_check; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA inventory_check;


--
-- Name: premia; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA premia;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: absence_hours; Type: TABLE; Schema: bucket; Owner: -
--

CREATE TABLE bucket.absence_hours (
    worker_id integer NOT NULL,
    year integer,
    month integer,
    missing_code integer NOT NULL,
    hours numeric(3,2)
);


--
-- Name: attendance_codes_dictionary; Type: TABLE; Schema: bucket; Owner: -
--

CREATE TABLE bucket.attendance_codes_dictionary (
    field_code text NOT NULL,
    field_description text NOT NULL
);


--
-- Name: auth_types; Type: TABLE; Schema: bucket; Owner: -
--

CREATE TABLE bucket.auth_types (
    auth_id integer NOT NULL,
    auth_desc text NOT NULL
);


--
-- Name: authorization2; Type: TABLE; Schema: bucket; Owner: -
--

CREATE TABLE bucket.authorization2 (
    worker_id integer NOT NULL,
    auth_id integer NOT NULL
);


--
-- Name: data; Type: TABLE; Schema: bucket; Owner: -
--

CREATE TABLE bucket.data (
    worker_id integer NOT NULL,
    hours boolean,
    task_id integer,
    "time" time without time zone,
    medic integer,
    enter_time text
);


--
-- Name: missing_code; Type: TABLE; Schema: bucket; Owner: -
--

CREATE TABLE bucket.missing_code (
    id integer NOT NULL,
    reason text,
    missing_code integer
);


--
-- Name: missing_code_id_seq; Type: SEQUENCE; Schema: bucket; Owner: -
--

CREATE SEQUENCE bucket.missing_code_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: missing_code_id_seq; Type: SEQUENCE OWNED BY; Schema: bucket; Owner: -
--

ALTER SEQUENCE bucket.missing_code_id_seq OWNED BY bucket.missing_code.id;


--
-- Name: monthly_attendance; Type: TABLE; Schema: bucket; Owner: -
--

CREATE TABLE bucket.monthly_attendance (
    zhui_ovd integer NOT NULL,
    t_chi date NOT NULL,
    rgila numeric(10,2),
    nosft numeric(10,2),
    sn075 numeric(10,2),
    sn100 numeric(10,2),
    sn125 numeric(10,2),
    sn150 numeric(10,2),
    sn175 numeric(10,2),
    sn200 numeric(10,2),
    hdrts numeric(10,2),
    hdrlt numeric(10,2),
    fil01 numeric(10,2),
    tmzak numeric(10,2),
    mclts numeric(10,2),
    neche numeric(10,2),
    yeled numeric(10,2),
    malat numeric(10,2),
    mahalat_bzug numeric(10,2),
    mahalat_hore numeric(10,2),
    mahala_mmrt numeric(10,2),
    mugbalut_mezuke numeric(10,2),
    mugbalut numeric(10,2),
    herayon numeric(10,2),
    herayon_bzug numeric(10,2),
    mhlt_bzg_mmrt numeric(10,2),
    tipuley_poriyut numeric(10,2),
    bidud numeric(10,2),
    covid numeric(10,2),
    bidud_yeled numeric(10,2),
    hufsh numeric(10,2),
    mshph numeric(10,2),
    evel numeric(10,2),
    tmura numeric(10,2),
    bhira numeric(10,2),
    leida numeric(10,2),
    nisum numeric(10,2),
    kayitz numeric(10,2),
    milum numeric(10,2),
    icbus numeric(10,2),
    teuna numeric(10,2),
    fil02 numeric(10,2),
    hstlm numeric(10,2),
    veda numeric(10,2),
    accident numeric(10,2),
    chutz numeric(10,2),
    lmakd numeric(10,2),
    chult numeric(10,2),
    hasai numeric(10,2),
    chalt numeric(10,2),
    kele numeric(10,2),
    shvta numeric(10,2),
    hdrrs numeric(10,2),
    hdrlr numeric(10,2),
    ichur numeric(10,2),
    koncl numeric(10,2),
    hamcl numeric(10,2)
);


--
-- Name: present; Type: TABLE; Schema: bucket; Owner: -
--

CREATE TABLE bucket.present (
    worker_id integer NOT NULL,
    start_hour text,
    end_hour text,
    reason_code integer,
    present_code integer,
    report_type boolean
);


--
-- Name: reasons; Type: TABLE; Schema: bucket; Owner: -
--

CREATE TABLE bucket.reasons (
    id integer NOT NULL,
    description text
);


--
-- Name: reasons_des; Type: TABLE; Schema: bucket; Owner: -
--

CREATE TABLE bucket.reasons_des (
    reason_code integer NOT NULL,
    code_description text
);


--
-- Name: tasks; Type: TABLE; Schema: bucket; Owner: -
--

CREATE TABLE bucket.tasks (
    id integer NOT NULL,
    description text,
    value real
);


--
-- Name: worker_hours; Type: TABLE; Schema: bucket; Owner: -
--

CREATE TABLE bucket.worker_hours (
    worker_id integer NOT NULL,
    date date NOT NULL,
    start_hour text NOT NULL,
    end_hour text,
    comments text,
    report_type boolean
);


--
-- Name: worker_types; Type: TABLE; Schema: bucket; Owner: -
--

CREATE TABLE bucket.worker_types (
    id integer NOT NULL,
    description text
);


--
-- Name: years; Type: TABLE; Schema: bucket; Owner: -
--

CREATE TABLE bucket.years (
    year integer NOT NULL
);


--
-- Name: factories; Type: TABLE; Schema: general; Owner: -
--

CREATE TABLE general.factories (
    id smallint NOT NULL,
    description character(30) NOT NULL
);


--
-- Name: holidays; Type: TABLE; Schema: general; Owner: -
--

CREATE TABLE general.holidays (
    holiday_date date NOT NULL,
    holiday_desc character(15),
    day_type character(1),
    holiday_hours integer,
    is_planned boolean
);


--
-- Name: inventory; Type: TABLE; Schema: general; Owner: -
--

CREATE TABLE general.inventory (
    makat character(11),
    simul integer,
    department_id integer,
    kosher character(2),
    zahali integer,
    itra_masha numeric(11,3),
    itra_maslah numeric(11,3),
    masad character(8),
    tlsttn date,
    extra_frozen_inventory numeric(11,3)
);


--
-- Name: inventory_others; Type: TABLE; Schema: general; Owner: -
--

CREATE TABLE general.inventory_others (
    makat character(11),
    itra numeric(11,3)
);


--
-- Name: makat_description; Type: TABLE; Schema: general; Owner: -
--

CREATE TABLE general.makat_description (
    makat character(11),
    makat_description character(30),
    memir character(12),
    yehmid_l character(2),
    meh_tak numeric(9,2),
    tmb character(1),
    rmt_mlai character(2),
    t_bitul character(10),
    mador character(50),
    mercaz character(50),
    mesima character varying(10),
    rechesh character(5),
    material character(1),
    etslenu character(2),
    t_hzrm character(10),
    sketch_number character(30),
    shahaton numeric(9,2),
    kod_kvutza integer,
    kod_tat_kvutza integer,
    "interval" integer,
    manufacturer_number character(24),
    manufacturer_id character(8),
    e19 character(7),
    e20 character(7)
);


--
-- Name: mesimot; Type: TABLE; Schema: general; Owner: -
--

CREATE TABLE general.mesimot (
    id integer NOT NULL,
    description character(30),
    department_id integer,
    makat character(11),
    mes_tahash character(8),
    kod_perek smallint,
    tat_perek smallint,
    mahut_mesima smallint
);


--
-- Name: mesimot_g; Type: TABLE; Schema: general; Owner: -
--

CREATE TABLE general.mesimot_g (
    id integer NOT NULL,
    year integer,
    kam_tik numeric(9,2),
    gmurim integer,
    t_sgira date,
    unit_manufacturing_time numeric(10,3)
);


--
-- Name: sections; Type: TABLE; Schema: general; Owner: -
--

CREATE TABLE general.sections (
    id smallint NOT NULL,
    id2 smallint NOT NULL,
    description character(20) NOT NULL,
    factory_id smallint NOT NULL,
    boss_id integer,
    is_active boolean DEFAULT true NOT NULL,
    tapi_worker_id integer,
    yachtash character(6)
);


--
-- Name: workers; Type: TABLE; Schema: general; Owner: -
--

CREATE TABLE general.workers (
    id integer NOT NULL,
    number integer,
    first_name character(10) NOT NULL,
    last_name character(15) NOT NULL,
    section_id smallint NOT NULL,
    worker_type_id smallint NOT NULL,
    phone1 character(11),
    phone2 character(11),
    is_active boolean NOT NULL,
    is_direct character(1) NOT NULL,
    city character(15),
    sex character(1),
    rank character(3),
    clearence_date character(10),
    birth_date character(10),
    ride_type character(1),
    ride_time integer,
    external_worker boolean,
    job_type character(1),
    manager character(1),
    daily_work_hours numeric(4,2)
);


--
-- Name: makat_consumption; Type: TABLE; Schema: inventory_check; Owner: -
--

CREATE TABLE inventory_check.makat_consumption (
    mission integer,
    makat integer NOT NULL,
    consumption_before_3_years integer,
    consumption_before_2_years integer,
    consumption_before_1_years integer,
    current_consumption integer
);


--
-- Name: makat_demands; Type: TABLE; Schema: inventory_check; Owner: -
--

CREATE TABLE inventory_check.makat_demands (
    mission integer,
    year integer,
    budget_year integer,
    makat integer,
    demands numeric(8,2)
);


--
-- Name: missions_specifications; Type: TABLE; Schema: inventory_check; Owner: -
--

CREATE TABLE inventory_check.missions_specifications (
    mission integer NOT NULL,
    makat integer NOT NULL,
    budget_code character(10),
    coefficient numeric(20,5),
    worker_id integer,
    status_date date
);


--
-- Name: department_eligibility_consumption; Type: TABLE; Schema: premia; Owner: -
--

CREATE TABLE premia.department_eligibility_consumption (
    department integer NOT NULL,
    year integer DEFAULT (EXTRACT(year FROM CURRENT_DATE))::integer NOT NULL,
    month integer DEFAULT (EXTRACT(month FROM CURRENT_DATE))::integer NOT NULL,
    score numeric
);


--
-- Name: department_missing; Type: TABLE; Schema: premia; Owner: -
--

CREATE TABLE premia.department_missing (
    department integer NOT NULL,
    year integer DEFAULT (EXTRACT(year FROM CURRENT_DATE))::integer NOT NULL,
    month integer DEFAULT (EXTRACT(month FROM CURRENT_DATE))::integer NOT NULL,
    score numeric
);


--
-- Name: department_scores; Type: TABLE; Schema: premia; Owner: -
--

CREATE TABLE premia.department_scores (
    department_id integer NOT NULL,
    year integer NOT NULL,
    month integer NOT NULL,
    factor_id integer NOT NULL,
    auto_score double precision,
    manual_score double precision,
    is_manual boolean
);


--
-- Name: department_supplies; Type: TABLE; Schema: premia; Owner: -
--

CREATE TABLE premia.department_supplies (
    department integer NOT NULL,
    year integer DEFAULT (EXTRACT(year FROM CURRENT_DATE))::integer NOT NULL,
    month integer DEFAULT (EXTRACT(month FROM CURRENT_DATE))::integer NOT NULL,
    score numeric
);


--
-- Name: department_work_plan; Type: TABLE; Schema: premia; Owner: -
--

CREATE TABLE premia.department_work_plan (
    department integer NOT NULL,
    year integer DEFAULT (EXTRACT(year FROM CURRENT_DATE))::integer NOT NULL,
    month integer DEFAULT (EXTRACT(month FROM CURRENT_DATE))::integer NOT NULL,
    score numeric
);


--
-- Name: efficiency_data; Type: TABLE; Schema: premia; Owner: -
--

CREATE TABLE premia.efficiency_data (
    month integer DEFAULT (EXTRACT(month FROM CURRENT_DATE))::integer NOT NULL,
    year integer DEFAULT (EXTRACT(year FROM CURRENT_DATE))::integer NOT NULL,
    section integer NOT NULL,
    score numeric DEFAULT 100
);


--
-- Name: factors; Type: TABLE; Schema: premia; Owner: -
--

CREATE TABLE premia.factors (
    factor_id integer NOT NULL,
    name text NOT NULL,
    is_editable boolean DEFAULT true NOT NULL,
    is_per_worker boolean,
    default_score numeric
);


--
-- Name: pages; Type: TABLE; Schema: premia; Owner: -
--

CREATE TABLE premia.pages (
    id text NOT NULL,
    department_ids integer[] DEFAULT '{}'::integer[] NOT NULL,
    factor_ids integer[] DEFAULT '{}'::integer[] NOT NULL,
    max_score numeric DEFAULT 33 NOT NULL
);


--
-- Name: worker_scores; Type: TABLE; Schema: premia; Owner: -
--

CREATE TABLE premia.worker_scores (
    id integer NOT NULL,
    year integer NOT NULL,
    month integer NOT NULL,
    factor_id integer NOT NULL,
    auto_score double precision,
    manual_score double precision,
    is_manual boolean
);


--
-- Name: worker_security_score; Type: TABLE; Schema: premia; Owner: -
--

CREATE TABLE premia.worker_security_score (
    id integer NOT NULL,
    year integer DEFAULT (EXTRACT(year FROM CURRENT_DATE))::integer NOT NULL,
    month integer DEFAULT (EXTRACT(month FROM CURRENT_DATE))::integer NOT NULL,
    score numeric
);


--
-- Name: workers_final_scores; Type: TABLE; Schema: premia; Owner: -
--

CREATE TABLE premia.workers_final_scores (
    id integer NOT NULL,
    year integer NOT NULL,
    month integer NOT NULL,
    score numeric
);


--
-- Name: customer_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_snapshots (
    snapshot_date date NOT NULL,
    customer_id integer NOT NULL,
    customer_code character varying(255),
    customer_name character varying(255),
    total_items integer DEFAULT 0 NOT NULL,
    items_in_queue integer DEFAULT 0 NOT NULL,
    items_in_test integer DEFAULT 0 NOT NULL,
    items_waiting_for_research integer DEFAULT 0 NOT NULL,
    items_in_research integer DEFAULT 0 NOT NULL,
    finished_items integer DEFAULT 0 NOT NULL,
    items_in_routes integer DEFAULT 0 NOT NULL,
    success_percentage numeric(5,2) DEFAULT 0 NOT NULL,
    items_in_routes_percentage numeric(5,2) DEFAULT 0 NOT NULL,
    average_time_minutes numeric(10,2),
    created_at timestamp(6) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: customer_snapshots_daily; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_snapshots_daily (
    snapshot_id integer NOT NULL,
    customer_id integer NOT NULL,
    snapshot_date date NOT NULL,
    total_items integer DEFAULT 0,
    items_in_queue integer DEFAULT 0,
    items_in_test integer DEFAULT 0,
    items_finished integer DEFAULT 0,
    items_waiting_for_research integer DEFAULT 0,
    items_in_research integer DEFAULT 0,
    items_in_routes integer DEFAULT 0,
    total_processed_in_period integer DEFAULT 0,
    created_at timestamp(6) without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: customer_snapshots_daily_snapshot_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customer_snapshots_daily_snapshot_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: customer_snapshots_daily_snapshot_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customer_snapshots_daily_snapshot_id_seq OWNED BY public.customer_snapshots_daily.snapshot_id;


--
-- Name: customer_snapshots_monthly; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_snapshots_monthly (
    snapshot_date date NOT NULL,
    customer_id integer NOT NULL,
    customer_code character varying(255),
    customer_name character varying(255),
    total_items integer DEFAULT 0 NOT NULL,
    items_in_queue integer DEFAULT 0 NOT NULL,
    items_in_test integer DEFAULT 0 NOT NULL,
    items_waiting_for_research integer DEFAULT 0 NOT NULL,
    items_in_research integer DEFAULT 0 NOT NULL,
    finished_items integer DEFAULT 0 NOT NULL,
    items_in_routes integer DEFAULT 0 NOT NULL,
    success_percentage numeric(5,2) DEFAULT 0 NOT NULL,
    items_in_routes_percentage numeric(5,2) DEFAULT 0 NOT NULL,
    average_time_minutes numeric(10,2),
    created_at timestamp(6) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: customer_snapshots_quarterly; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_snapshots_quarterly (
    snapshot_date date NOT NULL,
    customer_id integer NOT NULL,
    customer_code character varying(255),
    customer_name character varying(255),
    total_items integer DEFAULT 0 NOT NULL,
    items_in_queue integer DEFAULT 0 NOT NULL,
    items_in_test integer DEFAULT 0 NOT NULL,
    items_waiting_for_research integer DEFAULT 0 NOT NULL,
    items_in_research integer DEFAULT 0 NOT NULL,
    finished_items integer DEFAULT 0 NOT NULL,
    items_in_routes integer DEFAULT 0 NOT NULL,
    success_percentage numeric(5,2) DEFAULT 0 NOT NULL,
    items_in_routes_percentage numeric(5,2) DEFAULT 0 NOT NULL,
    average_time_minutes numeric(10,2),
    created_at timestamp(6) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    id integer NOT NULL,
    name character(50) NOT NULL,
    customer_code character varying(100) NOT NULL
);


--
-- Name: customers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.customers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: customers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.customers_id_seq OWNED BY public.customers.id;


--
-- Name: daily_counters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.daily_counters (
    date_key date NOT NULL,
    counter integer DEFAULT 0
);


--
-- Name: file_objects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.file_objects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bucket character varying(255) NOT NULL,
    object_key character varying(1024) NOT NULL,
    file_name character varying(512) NOT NULL,
    content_type character varying(255),
    size_bytes bigint DEFAULT 0 NOT NULL,
    checksum_sha256 character varying(64),
    entity_type character varying(64),
    entity_id character varying(64),
    metadata jsonb,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    created_by character varying(255),
    created_at timestamp(6) with time zone DEFAULT now() NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp(6) with time zone
);


--
-- Name: finished_item; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.finished_item (
    item_id integer NOT NULL,
    item_type_id integer NOT NULL,
    current_status integer NOT NULL,
    current_route_step integer NOT NULL,
    test_station_id integer,
    created_at timestamp(6) without time zone NOT NULL,
    finished_at timestamp(6) without time zone,
    is_finished boolean DEFAULT false NOT NULL,
    processing_start_time timestamp(6) without time zone,
    q_start_time timestamp(6) without time zone
);


--
-- Name: finished_item_item_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.finished_item_item_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: finished_item_item_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.finished_item_item_id_seq OWNED BY public.finished_item.item_id;


--
-- Name: item_route_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_route_history (
    log_id integer NOT NULL,
    item_id bigint NOT NULL,
    test_station_id integer NOT NULL,
    current_route_step integer NOT NULL,
    queue_start_time timestamp(6) without time zone,
    processing_start_time timestamp(6) without time zone,
    processing_end_time timestamp(6) without time zone,
    worker_id integer,
    route_number integer DEFAULT 1 NOT NULL
);


--
-- Name: item_route_history_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.item_route_history_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: item_route_history_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.item_route_history_log_id_seq OWNED BY public.item_route_history.log_id;


--
-- Name: item_routes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_routes (
    item_id bigint NOT NULL,
    item_type_id integer NOT NULL,
    current_status integer NOT NULL,
    current_route_step integer NOT NULL,
    test_station_id integer,
    created_at timestamp(6) without time zone NOT NULL,
    finished_at timestamp(6) without time zone,
    is_finished boolean DEFAULT false NOT NULL,
    queue_start_time timestamp(6) without time zone NOT NULL,
    processing_start_time timestamp(6) without time zone,
    route_number integer DEFAULT 1 NOT NULL
);


--
-- Name: item_routes_item_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.item_routes_item_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: item_routes_item_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.item_routes_item_id_seq OWNED BY public.item_routes.item_id;


--
-- Name: item_status; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_status (
    item_status_id integer NOT NULL,
    item_status_desc character(50) NOT NULL
);


--
-- Name: item_status_item_status_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.item_status_item_status_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: item_status_item_status_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.item_status_item_status_id_seq OWNED BY public.item_status.item_status_id;


--
-- Name: item_type_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_type_snapshots (
    snapshot_date date NOT NULL,
    item_type_id integer NOT NULL,
    item_type_desc character varying(255),
    total_items integer DEFAULT 0 NOT NULL,
    items_in_queue integer DEFAULT 0 NOT NULL,
    items_in_test integer DEFAULT 0 NOT NULL,
    items_waiting_for_research integer DEFAULT 0 NOT NULL,
    items_in_research integer DEFAULT 0 NOT NULL,
    items_finished integer DEFAULT 0 NOT NULL,
    items_in_routes integer DEFAULT 0 NOT NULL,
    completion_percentage numeric(5,2) DEFAULT 0 NOT NULL,
    items_in_routes_percentage numeric(5,2) DEFAULT 0 NOT NULL,
    created_at timestamp(6) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: item_type_snapshots_monthly; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_type_snapshots_monthly (
    snapshot_date date NOT NULL,
    item_type_id integer NOT NULL,
    item_type_desc character varying(255),
    total_items integer DEFAULT 0 NOT NULL,
    items_in_queue integer DEFAULT 0 NOT NULL,
    items_in_test integer DEFAULT 0 NOT NULL,
    items_waiting_for_research integer DEFAULT 0 NOT NULL,
    items_in_research integer DEFAULT 0 NOT NULL,
    items_finished integer DEFAULT 0 NOT NULL,
    items_in_routes integer DEFAULT 0 NOT NULL,
    completion_percentage numeric(5,2) DEFAULT 0 NOT NULL,
    items_in_routes_percentage numeric(5,2) DEFAULT 0 NOT NULL,
    created_at timestamp(6) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: item_type_snapshots_quarterly; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_type_snapshots_quarterly (
    snapshot_date date NOT NULL,
    item_type_id integer NOT NULL,
    item_type_desc character varying(255),
    total_items integer DEFAULT 0 NOT NULL,
    items_in_queue integer DEFAULT 0 NOT NULL,
    items_in_test integer DEFAULT 0 NOT NULL,
    items_waiting_for_research integer DEFAULT 0 NOT NULL,
    items_in_research integer DEFAULT 0 NOT NULL,
    items_finished integer DEFAULT 0 NOT NULL,
    items_in_routes integer DEFAULT 0 NOT NULL,
    completion_percentage numeric(5,2) DEFAULT 0 NOT NULL,
    items_in_routes_percentage numeric(5,2) DEFAULT 0 NOT NULL,
    created_at timestamp(6) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: item_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_types (
    item_type_id integer NOT NULL,
    item_type_desc character(50) NOT NULL
);


--
-- Name: item_types_item_type_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.item_types_item_type_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: item_types_item_type_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.item_types_item_type_id_seq OWNED BY public.item_types.item_type_id;


--
-- Name: items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.items (
    item_id bigint NOT NULL,
    customer_id integer NOT NULL,
    item_type_id integer NOT NULL,
    serial_no text NOT NULL,
    makat integer NOT NULL,
    model character(50) NOT NULL,
    manufacturer_name character(50) NOT NULL,
    manufacturer_no text NOT NULL,
    shipment_id integer NOT NULL,
    parent_item_id bigint
);


--
-- Name: kpi_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kpi_snapshots (
    snapshot_date date NOT NULL,
    average_queue_time_minutes numeric(10,2),
    average_processing_time_minutes numeric(10,2),
    total_items_processed integer DEFAULT 0 NOT NULL,
    items_currently_in_queue integer DEFAULT 0 NOT NULL,
    items_currently_in_test integer DEFAULT 0 NOT NULL,
    busiest_station_id integer,
    busiest_station_name character varying(255),
    busiest_station_count integer DEFAULT 0 NOT NULL,
    created_at timestamp(6) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: kpi_snapshots_monthly; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kpi_snapshots_monthly (
    snapshot_date date NOT NULL,
    average_queue_time_minutes numeric(10,2),
    average_processing_time_minutes numeric(10,2),
    total_items_processed integer DEFAULT 0 NOT NULL,
    items_currently_in_queue integer DEFAULT 0 NOT NULL,
    items_currently_in_test integer DEFAULT 0 NOT NULL,
    busiest_station_id integer,
    busiest_station_name character varying(255),
    busiest_station_count integer DEFAULT 0 NOT NULL,
    created_at timestamp(6) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: kpi_snapshots_quarterly; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kpi_snapshots_quarterly (
    snapshot_date date NOT NULL,
    average_queue_time_minutes numeric(10,2),
    average_processing_time_minutes numeric(10,2),
    total_items_processed integer DEFAULT 0 NOT NULL,
    items_currently_in_queue integer DEFAULT 0 NOT NULL,
    items_currently_in_test integer DEFAULT 0 NOT NULL,
    busiest_station_id integer,
    busiest_station_name character varying(255),
    busiest_station_count integer DEFAULT 0 NOT NULL,
    created_at timestamp(6) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: research_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.research_history (
    research_id integer NOT NULL,
    item_id integer NOT NULL,
    station_id integer NOT NULL,
    sent_at timestamp(6) without time zone,
    return_at timestamp(6) without time zone,
    result integer NOT NULL,
    comments text,
    worker_id integer
);


--
-- Name: research_history_research_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.research_history_research_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: research_history_research_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.research_history_research_id_seq OWNED BY public.research_history.research_id;


--
-- Name: shipment_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shipment_history (
    log_id integer NOT NULL,
    shipment_id integer NOT NULL,
    sent_shipment_code text NOT NULL,
    sent_date timestamp(6) without time zone NOT NULL,
    sending_worker_id integer,
    item_type_id integer,
    makat integer,
    amount integer NOT NULL,
    created_at timestamp(6) without time zone DEFAULT CURRENT_TIMESTAMP,
    signature_path text
);


--
-- Name: shipment_history_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.shipment_history_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: shipment_history_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.shipment_history_log_id_seq OWNED BY public.shipment_history.log_id;


--
-- Name: shipment_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shipment_items (
    id integer NOT NULL,
    shipment_id integer,
    item_type_id integer,
    quantity integer NOT NULL,
    created_at timestamp(6) without time zone DEFAULT CURRENT_TIMESTAMP,
    makat integer
);


--
-- Name: shipment_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.shipment_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: shipment_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.shipment_items_id_seq OWNED BY public.shipment_items.id;


--
-- Name: shipment_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shipment_snapshots (
    snapshot_date date NOT NULL,
    shipment_id integer NOT NULL,
    shipment_code character varying(255),
    shipment_date date,
    customer_id integer,
    customer_code character varying(255),
    customer_name character varying(255),
    total_items integer DEFAULT 0 NOT NULL,
    items_in_queue integer DEFAULT 0 NOT NULL,
    items_in_test integer DEFAULT 0 NOT NULL,
    items_waiting_for_research integer DEFAULT 0 NOT NULL,
    items_in_research integer DEFAULT 0 NOT NULL,
    items_finished integer DEFAULT 0 NOT NULL,
    items_in_routes integer DEFAULT 0 NOT NULL,
    completion_percentage numeric(5,2) DEFAULT 0 NOT NULL,
    items_in_routes_percentage numeric(5,2) DEFAULT 0 NOT NULL,
    created_at timestamp(6) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: shipment_snapshots_monthly; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shipment_snapshots_monthly (
    snapshot_date date NOT NULL,
    shipment_id integer NOT NULL,
    shipment_code character varying(255),
    shipment_date date,
    customer_id integer,
    customer_code character varying(255),
    customer_name character varying(255),
    total_items integer DEFAULT 0 NOT NULL,
    items_in_queue integer DEFAULT 0 NOT NULL,
    items_in_test integer DEFAULT 0 NOT NULL,
    items_waiting_for_research integer DEFAULT 0 NOT NULL,
    items_in_research integer DEFAULT 0 NOT NULL,
    items_finished integer DEFAULT 0 NOT NULL,
    items_in_routes integer DEFAULT 0 NOT NULL,
    completion_percentage numeric(5,2) DEFAULT 0 NOT NULL,
    items_in_routes_percentage numeric(5,2) DEFAULT 0 NOT NULL,
    created_at timestamp(6) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: shipment_snapshots_quarterly; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shipment_snapshots_quarterly (
    snapshot_date date NOT NULL,
    shipment_id integer NOT NULL,
    shipment_code character varying(255),
    shipment_date date,
    customer_id integer,
    customer_code character varying(255),
    customer_name character varying(255),
    total_items integer DEFAULT 0 NOT NULL,
    items_in_queue integer DEFAULT 0 NOT NULL,
    items_in_test integer DEFAULT 0 NOT NULL,
    items_waiting_for_research integer DEFAULT 0 NOT NULL,
    items_in_research integer DEFAULT 0 NOT NULL,
    items_finished integer DEFAULT 0 NOT NULL,
    items_in_routes integer DEFAULT 0 NOT NULL,
    completion_percentage numeric(5,2) DEFAULT 0 NOT NULL,
    items_in_routes_percentage numeric(5,2) DEFAULT 0 NOT NULL,
    created_at timestamp(6) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: shipments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shipments (
    id integer NOT NULL,
    shipment_code character varying(20) NOT NULL,
    customer_id integer NOT NULL,
    shipment_date timestamp(6) without time zone NOT NULL,
    makat integer NOT NULL,
    amount integer NOT NULL,
    shipment_sent_date timestamp(6) without time zone,
    is_sent boolean DEFAULT false,
    recieving_worker_id integer,
    source_id integer,
    sending_worker_id integer,
    finished_at timestamp(6) with time zone,
    signature_path text,
    poc_details character varying(255)
);


--
-- Name: shipments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.shipments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: shipments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.shipments_id_seq OWNED BY public.shipments.id;


--
-- Name: sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sources (
    source_id integer NOT NULL,
    source_desc character varying(100) NOT NULL
);


--
-- Name: sources_source_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sources_source_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sources_source_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sources_source_id_seq OWNED BY public.sources.source_id;


--
-- Name: station_hourly_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.station_hourly_snapshots (
    id integer NOT NULL,
    snapshot_hour timestamp(6) without time zone NOT NULL,
    station_id integer NOT NULL,
    items_processed integer DEFAULT 0 NOT NULL,
    avg_queue_time double precision,
    avg_test_time double precision,
    created_at timestamp(6) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: station_hourly_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.station_hourly_snapshots_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: station_hourly_snapshots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.station_hourly_snapshots_id_seq OWNED BY public.station_hourly_snapshots.id;


--
-- Name: station_live_counters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.station_live_counters (
    station_id integer NOT NULL,
    items_in_queue integer DEFAULT 0 NOT NULL,
    items_in_test integer DEFAULT 0 NOT NULL
);


--
-- Name: station_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.station_snapshots (
    snapshot_date date NOT NULL,
    station_id integer NOT NULL,
    station_name character varying(255),
    station_type_name character varying(255),
    items_in_queue integer DEFAULT 0 NOT NULL,
    items_in_test integer DEFAULT 0 NOT NULL,
    average_current_queue_time_minutes numeric(10,2),
    total_processed_in_period integer DEFAULT 0 NOT NULL,
    created_at timestamp(6) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: station_snapshots_monthly; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.station_snapshots_monthly (
    snapshot_date date NOT NULL,
    station_id integer NOT NULL,
    station_name character varying(255),
    station_type_name character varying(255),
    items_in_queue integer DEFAULT 0 NOT NULL,
    items_in_test integer DEFAULT 0 NOT NULL,
    average_current_queue_time_minutes numeric(10,2),
    total_processed_in_period integer DEFAULT 0 NOT NULL,
    created_at timestamp(6) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: station_snapshots_quarterly; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.station_snapshots_quarterly (
    snapshot_date date NOT NULL,
    station_id integer NOT NULL,
    station_name character varying(255),
    station_type_name character varying(255),
    items_in_queue integer DEFAULT 0 NOT NULL,
    items_in_test integer DEFAULT 0 NOT NULL,
    average_current_queue_time_minutes numeric(10,2),
    total_processed_in_period integer DEFAULT 0 NOT NULL,
    created_at timestamp(6) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: status_distribution_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.status_distribution_snapshots (
    snapshot_date date NOT NULL,
    status_id integer NOT NULL,
    status_name character varying(255),
    count integer DEFAULT 0 NOT NULL,
    percentage numeric(5,2) DEFAULT 0 NOT NULL,
    created_at timestamp(6) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: status_distribution_snapshots_monthly; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.status_distribution_snapshots_monthly (
    snapshot_date date NOT NULL,
    status_id integer NOT NULL,
    status_name character varying(255),
    count integer DEFAULT 0 NOT NULL,
    percentage numeric(5,2) DEFAULT 0 NOT NULL,
    created_at timestamp(6) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: status_distribution_snapshots_quarterly; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.status_distribution_snapshots_quarterly (
    snapshot_date date NOT NULL,
    status_id integer NOT NULL,
    status_name character varying(255),
    count integer DEFAULT 0 NOT NULL,
    percentage numeric(5,2) DEFAULT 0 NOT NULL,
    created_at timestamp(6) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: system_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_snapshots (
    snapshot_date date NOT NULL,
    total_items integer DEFAULT 0 NOT NULL,
    items_in_queue integer DEFAULT 0 NOT NULL,
    items_in_test integer DEFAULT 0 NOT NULL,
    items_finished integer DEFAULT 0 NOT NULL,
    items_waiting_for_research integer DEFAULT 0 NOT NULL,
    items_in_research integer DEFAULT 0 NOT NULL,
    items_in_routes integer DEFAULT 0 NOT NULL,
    created_at timestamp(6) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: system_snapshots_daily; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_snapshots_daily (
    snapshot_id integer NOT NULL,
    snapshot_date date NOT NULL,
    total_items integer DEFAULT 0,
    items_in_queue integer DEFAULT 0,
    items_in_test integer DEFAULT 0,
    items_finished integer DEFAULT 0,
    items_waiting_for_research integer DEFAULT 0,
    items_in_research integer DEFAULT 0,
    items_in_routes integer DEFAULT 0,
    created_at timestamp(6) without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: system_snapshots_daily_snapshot_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.system_snapshots_daily_snapshot_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: system_snapshots_daily_snapshot_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.system_snapshots_daily_snapshot_id_seq OWNED BY public.system_snapshots_daily.snapshot_id;


--
-- Name: system_snapshots_monthly; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_snapshots_monthly (
    snapshot_id integer NOT NULL,
    snapshot_date date NOT NULL,
    total_items integer DEFAULT 0,
    items_in_queue integer DEFAULT 0,
    items_in_test integer DEFAULT 0,
    items_finished integer DEFAULT 0,
    items_waiting_for_research integer DEFAULT 0,
    items_in_research integer DEFAULT 0,
    items_in_routes integer DEFAULT 0,
    created_at timestamp(6) without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: system_snapshots_monthly_snapshot_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.system_snapshots_monthly_snapshot_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: system_snapshots_monthly_snapshot_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.system_snapshots_monthly_snapshot_id_seq OWNED BY public.system_snapshots_monthly.snapshot_id;


--
-- Name: test_station_status; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.test_station_status (
    test_station_status_id integer NOT NULL,
    test_station_status_desc character(50) NOT NULL
);


--
-- Name: test_station_status_test_station_status_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.test_station_status_test_station_status_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: test_station_status_test_station_status_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.test_station_status_test_station_status_id_seq OWNED BY public.test_station_status.test_station_status_id;


--
-- Name: test_stations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.test_stations (
    test_station_id integer NOT NULL,
    test_station_type_id integer NOT NULL,
    test_station_desc character(50) NOT NULL,
    status integer NOT NULL,
    is_research boolean DEFAULT false NOT NULL
);


--
-- Name: test_stations_test_station_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.test_stations_test_station_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: test_stations_test_station_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.test_stations_test_station_id_seq OWNED BY public.test_stations.test_station_id;


--
-- Name: test_stations_type; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.test_stations_type (
    test_station_type_id integer NOT NULL,
    test_type_desc character(50) NOT NULL
);


--
-- Name: test_stations_type_test_station_type_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.test_stations_type_test_station_type_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: test_stations_type_test_station_type_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.test_stations_type_test_station_type_id_seq OWNED BY public.test_stations_type.test_station_type_id;


--
-- Name: testing_routes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.testing_routes (
    test_route_id integer NOT NULL,
    item_type_id integer NOT NULL,
    test_station_type_id integer NOT NULL,
    route_steps integer[] DEFAULT ARRAY[]::integer[],
    route_number integer DEFAULT 1 NOT NULL
);


--
-- Name: testing_routes_test_route_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.testing_routes_test_route_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: testing_routes_test_route_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.testing_routes_test_route_id_seq OWNED BY public.testing_routes.test_route_id;


--
-- Name: workers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workers (
    worker_id integer NOT NULL,
    worker_name character varying(100) NOT NULL,
    stokekeeper boolean DEFAULT false NOT NULL
);


--
-- Name: missing_code id; Type: DEFAULT; Schema: bucket; Owner: -
--

ALTER TABLE ONLY bucket.missing_code ALTER COLUMN id SET DEFAULT nextval('bucket.missing_code_id_seq'::regclass);


--
-- Name: customer_snapshots_daily snapshot_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_snapshots_daily ALTER COLUMN snapshot_id SET DEFAULT nextval('public.customer_snapshots_daily_snapshot_id_seq'::regclass);


--
-- Name: customers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers ALTER COLUMN id SET DEFAULT nextval('public.customers_id_seq'::regclass);


--
-- Name: finished_item item_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finished_item ALTER COLUMN item_id SET DEFAULT nextval('public.finished_item_item_id_seq'::regclass);


--
-- Name: item_route_history log_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_route_history ALTER COLUMN log_id SET DEFAULT nextval('public.item_route_history_log_id_seq'::regclass);


--
-- Name: item_routes item_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_routes ALTER COLUMN item_id SET DEFAULT nextval('public.item_routes_item_id_seq'::regclass);


--
-- Name: item_status item_status_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_status ALTER COLUMN item_status_id SET DEFAULT nextval('public.item_status_item_status_id_seq'::regclass);


--
-- Name: item_types item_type_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_types ALTER COLUMN item_type_id SET DEFAULT nextval('public.item_types_item_type_id_seq'::regclass);


--
-- Name: research_history research_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_history ALTER COLUMN research_id SET DEFAULT nextval('public.research_history_research_id_seq'::regclass);


--
-- Name: shipment_history log_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipment_history ALTER COLUMN log_id SET DEFAULT nextval('public.shipment_history_log_id_seq'::regclass);


--
-- Name: shipment_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipment_items ALTER COLUMN id SET DEFAULT nextval('public.shipment_items_id_seq'::regclass);


--
-- Name: shipments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipments ALTER COLUMN id SET DEFAULT nextval('public.shipments_id_seq'::regclass);


--
-- Name: sources source_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sources ALTER COLUMN source_id SET DEFAULT nextval('public.sources_source_id_seq'::regclass);


--
-- Name: station_hourly_snapshots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.station_hourly_snapshots ALTER COLUMN id SET DEFAULT nextval('public.station_hourly_snapshots_id_seq'::regclass);


--
-- Name: system_snapshots_daily snapshot_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_snapshots_daily ALTER COLUMN snapshot_id SET DEFAULT nextval('public.system_snapshots_daily_snapshot_id_seq'::regclass);


--
-- Name: system_snapshots_monthly snapshot_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_snapshots_monthly ALTER COLUMN snapshot_id SET DEFAULT nextval('public.system_snapshots_monthly_snapshot_id_seq'::regclass);


--
-- Name: test_station_status test_station_status_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_station_status ALTER COLUMN test_station_status_id SET DEFAULT nextval('public.test_station_status_test_station_status_id_seq'::regclass);


--
-- Name: test_stations test_station_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_stations ALTER COLUMN test_station_id SET DEFAULT nextval('public.test_stations_test_station_id_seq'::regclass);


--
-- Name: test_stations_type test_station_type_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_stations_type ALTER COLUMN test_station_type_id SET DEFAULT nextval('public.test_stations_type_test_station_type_id_seq'::regclass);


--
-- Name: testing_routes test_route_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.testing_routes ALTER COLUMN test_route_id SET DEFAULT nextval('public.testing_routes_test_route_id_seq'::regclass);


--
-- Name: absence_hours absence_hours_pkey; Type: CONSTRAINT; Schema: bucket; Owner: -
--

ALTER TABLE ONLY bucket.absence_hours
    ADD CONSTRAINT absence_hours_pkey PRIMARY KEY (worker_id, missing_code);


--
-- Name: attendance_codes_dictionary attendance_codes_dictionary_pkey; Type: CONSTRAINT; Schema: bucket; Owner: -
--

ALTER TABLE ONLY bucket.attendance_codes_dictionary
    ADD CONSTRAINT attendance_codes_dictionary_pkey PRIMARY KEY (field_code);


--
-- Name: auth_types auth_types_pkey; Type: CONSTRAINT; Schema: bucket; Owner: -
--

ALTER TABLE ONLY bucket.auth_types
    ADD CONSTRAINT auth_types_pkey PRIMARY KEY (auth_id);


--
-- Name: authorization2 authorization2_pkey; Type: CONSTRAINT; Schema: bucket; Owner: -
--

ALTER TABLE ONLY bucket.authorization2
    ADD CONSTRAINT authorization2_pkey PRIMARY KEY (worker_id);


--
-- Name: data data_pkey; Type: CONSTRAINT; Schema: bucket; Owner: -
--

ALTER TABLE ONLY bucket.data
    ADD CONSTRAINT data_pkey PRIMARY KEY (worker_id);


--
-- Name: missing_code missing_code_pkey; Type: CONSTRAINT; Schema: bucket; Owner: -
--

ALTER TABLE ONLY bucket.missing_code
    ADD CONSTRAINT missing_code_pkey PRIMARY KEY (id);


--
-- Name: monthly_attendance monthly_attendance_pkey; Type: CONSTRAINT; Schema: bucket; Owner: -
--

ALTER TABLE ONLY bucket.monthly_attendance
    ADD CONSTRAINT monthly_attendance_pkey PRIMARY KEY (zhui_ovd, t_chi);


--
-- Name: present present_pkey; Type: CONSTRAINT; Schema: bucket; Owner: -
--

ALTER TABLE ONLY bucket.present
    ADD CONSTRAINT present_pkey PRIMARY KEY (worker_id);


--
-- Name: reasons_des reasons_des_pkey; Type: CONSTRAINT; Schema: bucket; Owner: -
--

ALTER TABLE ONLY bucket.reasons_des
    ADD CONSTRAINT reasons_des_pkey PRIMARY KEY (reason_code);


--
-- Name: reasons reasons_pkey; Type: CONSTRAINT; Schema: bucket; Owner: -
--

ALTER TABLE ONLY bucket.reasons
    ADD CONSTRAINT reasons_pkey PRIMARY KEY (id);


--
-- Name: tasks tasks_pkey; Type: CONSTRAINT; Schema: bucket; Owner: -
--

ALTER TABLE ONLY bucket.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);


--
-- Name: worker_hours worker_hours_pkey; Type: CONSTRAINT; Schema: bucket; Owner: -
--

ALTER TABLE ONLY bucket.worker_hours
    ADD CONSTRAINT worker_hours_pkey PRIMARY KEY (worker_id, date, start_hour);


--
-- Name: worker_types worker_types_pkey; Type: CONSTRAINT; Schema: bucket; Owner: -
--

ALTER TABLE ONLY bucket.worker_types
    ADD CONSTRAINT worker_types_pkey PRIMARY KEY (id);


--
-- Name: years years_pkey; Type: CONSTRAINT; Schema: bucket; Owner: -
--

ALTER TABLE ONLY bucket.years
    ADD CONSTRAINT years_pkey PRIMARY KEY (year);


--
-- Name: holidays holidays_pkey; Type: CONSTRAINT; Schema: general; Owner: -
--

ALTER TABLE ONLY general.holidays
    ADD CONSTRAINT holidays_pkey PRIMARY KEY (holiday_date);


--
-- Name: workers pk_workers; Type: CONSTRAINT; Schema: general; Owner: -
--

ALTER TABLE ONLY general.workers
    ADD CONSTRAINT pk_workers PRIMARY KEY (id);


--
-- Name: department_eligibility_consumption department_eligibility_consumption_pkey; Type: CONSTRAINT; Schema: premia; Owner: -
--

ALTER TABLE ONLY premia.department_eligibility_consumption
    ADD CONSTRAINT department_eligibility_consumption_pkey PRIMARY KEY (department, year, month);


--
-- Name: department_missing department_missing_pkey; Type: CONSTRAINT; Schema: premia; Owner: -
--

ALTER TABLE ONLY premia.department_missing
    ADD CONSTRAINT department_missing_pkey PRIMARY KEY (department, year, month);


--
-- Name: department_scores department_scores_pkey; Type: CONSTRAINT; Schema: premia; Owner: -
--

ALTER TABLE ONLY premia.department_scores
    ADD CONSTRAINT department_scores_pkey PRIMARY KEY (department_id, year, month, factor_id);


--
-- Name: department_supplies department_supplies_pkey; Type: CONSTRAINT; Schema: premia; Owner: -
--

ALTER TABLE ONLY premia.department_supplies
    ADD CONSTRAINT department_supplies_pkey PRIMARY KEY (department, year, month);


--
-- Name: department_work_plan department_work_plan_pkey; Type: CONSTRAINT; Schema: premia; Owner: -
--

ALTER TABLE ONLY premia.department_work_plan
    ADD CONSTRAINT department_work_plan_pkey PRIMARY KEY (department, year, month);


--
-- Name: factors factors_pkey; Type: CONSTRAINT; Schema: premia; Owner: -
--

ALTER TABLE ONLY premia.factors
    ADD CONSTRAINT factors_pkey PRIMARY KEY (factor_id);


--
-- Name: efficiency_data headquarters_direct_pkey; Type: CONSTRAINT; Schema: premia; Owner: -
--

ALTER TABLE ONLY premia.efficiency_data
    ADD CONSTRAINT headquarters_direct_pkey PRIMARY KEY (month, year, section);


--
-- Name: pages pages_pkey; Type: CONSTRAINT; Schema: premia; Owner: -
--

ALTER TABLE ONLY premia.pages
    ADD CONSTRAINT pages_pkey PRIMARY KEY (id);


--
-- Name: worker_security_score section_security_scores_pkey; Type: CONSTRAINT; Schema: premia; Owner: -
--

ALTER TABLE ONLY premia.worker_security_score
    ADD CONSTRAINT section_security_scores_pkey PRIMARY KEY (id, year, month);


--
-- Name: worker_scores worker_scores_pkey; Type: CONSTRAINT; Schema: premia; Owner: -
--

ALTER TABLE ONLY premia.worker_scores
    ADD CONSTRAINT worker_scores_pkey PRIMARY KEY (id, year, month, factor_id);


--
-- Name: workers_final_scores workers_final_scores_pkey; Type: CONSTRAINT; Schema: premia; Owner: -
--

ALTER TABLE ONLY premia.workers_final_scores
    ADD CONSTRAINT workers_final_scores_pkey PRIMARY KEY (id, year, month);


--
-- Name: customer_snapshots_daily customer_snapshots_daily_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_snapshots_daily
    ADD CONSTRAINT customer_snapshots_daily_pkey PRIMARY KEY (snapshot_id);


--
-- Name: customer_snapshots_monthly customer_snapshots_monthly_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_snapshots_monthly
    ADD CONSTRAINT customer_snapshots_monthly_pkey PRIMARY KEY (snapshot_date, customer_id);


--
-- Name: customer_snapshots customer_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_snapshots
    ADD CONSTRAINT customer_snapshots_pkey PRIMARY KEY (snapshot_date, customer_id);


--
-- Name: customer_snapshots_quarterly customer_snapshots_quarterly_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_snapshots_quarterly
    ADD CONSTRAINT customer_snapshots_quarterly_pkey PRIMARY KEY (snapshot_date, customer_id);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: daily_counters daily_counters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.daily_counters
    ADD CONSTRAINT daily_counters_pkey PRIMARY KEY (date_key);


--
-- Name: file_objects file_objects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.file_objects
    ADD CONSTRAINT file_objects_pkey PRIMARY KEY (id);


--
-- Name: finished_item finished_item_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finished_item
    ADD CONSTRAINT finished_item_pkey PRIMARY KEY (item_id);


--
-- Name: item_route_history item_route_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_route_history
    ADD CONSTRAINT item_route_history_pkey PRIMARY KEY (log_id);


--
-- Name: item_routes item_routes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_routes
    ADD CONSTRAINT item_routes_pkey PRIMARY KEY (item_id);


--
-- Name: item_status item_status_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_status
    ADD CONSTRAINT item_status_pkey PRIMARY KEY (item_status_id);


--
-- Name: item_type_snapshots_monthly item_type_snapshots_monthly_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_type_snapshots_monthly
    ADD CONSTRAINT item_type_snapshots_monthly_pkey PRIMARY KEY (snapshot_date, item_type_id);


--
-- Name: item_type_snapshots item_type_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_type_snapshots
    ADD CONSTRAINT item_type_snapshots_pkey PRIMARY KEY (snapshot_date, item_type_id);


--
-- Name: item_type_snapshots_quarterly item_type_snapshots_quarterly_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_type_snapshots_quarterly
    ADD CONSTRAINT item_type_snapshots_quarterly_pkey PRIMARY KEY (snapshot_date, item_type_id);


--
-- Name: item_types item_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_types
    ADD CONSTRAINT item_types_pkey PRIMARY KEY (item_type_id);


--
-- Name: items items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_pkey PRIMARY KEY (item_id);


--
-- Name: kpi_snapshots_monthly kpi_snapshots_monthly_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpi_snapshots_monthly
    ADD CONSTRAINT kpi_snapshots_monthly_pkey PRIMARY KEY (snapshot_date);


--
-- Name: kpi_snapshots kpi_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpi_snapshots
    ADD CONSTRAINT kpi_snapshots_pkey PRIMARY KEY (snapshot_date);


--
-- Name: kpi_snapshots_quarterly kpi_snapshots_quarterly_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpi_snapshots_quarterly
    ADD CONSTRAINT kpi_snapshots_quarterly_pkey PRIMARY KEY (snapshot_date);


--
-- Name: research_history research_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_history
    ADD CONSTRAINT research_history_pkey PRIMARY KEY (research_id);


--
-- Name: shipment_history shipment_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipment_history
    ADD CONSTRAINT shipment_history_pkey PRIMARY KEY (log_id);


--
-- Name: shipment_items shipment_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipment_items
    ADD CONSTRAINT shipment_items_pkey PRIMARY KEY (id);


--
-- Name: shipment_snapshots_monthly shipment_snapshots_monthly_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipment_snapshots_monthly
    ADD CONSTRAINT shipment_snapshots_monthly_pkey PRIMARY KEY (snapshot_date, shipment_id);


--
-- Name: shipment_snapshots shipment_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipment_snapshots
    ADD CONSTRAINT shipment_snapshots_pkey PRIMARY KEY (snapshot_date, shipment_id);


--
-- Name: shipment_snapshots_quarterly shipment_snapshots_quarterly_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipment_snapshots_quarterly
    ADD CONSTRAINT shipment_snapshots_quarterly_pkey PRIMARY KEY (snapshot_date, shipment_id);


--
-- Name: shipments shipments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipments
    ADD CONSTRAINT shipments_pkey PRIMARY KEY (id);


--
-- Name: sources sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sources
    ADD CONSTRAINT sources_pkey PRIMARY KEY (source_id);


--
-- Name: station_hourly_snapshots station_hourly_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.station_hourly_snapshots
    ADD CONSTRAINT station_hourly_snapshots_pkey PRIMARY KEY (id);


--
-- Name: station_live_counters station_live_counters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.station_live_counters
    ADD CONSTRAINT station_live_counters_pkey PRIMARY KEY (station_id);


--
-- Name: station_snapshots_monthly station_snapshots_monthly_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.station_snapshots_monthly
    ADD CONSTRAINT station_snapshots_monthly_pkey PRIMARY KEY (snapshot_date, station_id);


--
-- Name: station_snapshots station_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.station_snapshots
    ADD CONSTRAINT station_snapshots_pkey PRIMARY KEY (snapshot_date, station_id);


--
-- Name: station_snapshots_quarterly station_snapshots_quarterly_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.station_snapshots_quarterly
    ADD CONSTRAINT station_snapshots_quarterly_pkey PRIMARY KEY (snapshot_date, station_id);


--
-- Name: status_distribution_snapshots_monthly status_distribution_snapshots_monthly_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.status_distribution_snapshots_monthly
    ADD CONSTRAINT status_distribution_snapshots_monthly_pkey PRIMARY KEY (snapshot_date, status_id);


--
-- Name: status_distribution_snapshots status_distribution_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.status_distribution_snapshots
    ADD CONSTRAINT status_distribution_snapshots_pkey PRIMARY KEY (snapshot_date, status_id);


--
-- Name: status_distribution_snapshots_quarterly status_distribution_snapshots_quarterly_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.status_distribution_snapshots_quarterly
    ADD CONSTRAINT status_distribution_snapshots_quarterly_pkey PRIMARY KEY (snapshot_date, status_id);


--
-- Name: system_snapshots_daily system_snapshots_daily_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_snapshots_daily
    ADD CONSTRAINT system_snapshots_daily_pkey PRIMARY KEY (snapshot_id);


--
-- Name: system_snapshots_monthly system_snapshots_monthly_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_snapshots_monthly
    ADD CONSTRAINT system_snapshots_monthly_pkey PRIMARY KEY (snapshot_id);


--
-- Name: system_snapshots system_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_snapshots
    ADD CONSTRAINT system_snapshots_pkey PRIMARY KEY (snapshot_date);


--
-- Name: test_station_status test_station_status_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_station_status
    ADD CONSTRAINT test_station_status_pkey PRIMARY KEY (test_station_status_id);


--
-- Name: test_stations test_stations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_stations
    ADD CONSTRAINT test_stations_pkey PRIMARY KEY (test_station_id);


--
-- Name: test_stations_type test_stations_type_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_stations_type
    ADD CONSTRAINT test_stations_type_pkey PRIMARY KEY (test_station_type_id);


--
-- Name: testing_routes testing_routes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.testing_routes
    ADD CONSTRAINT testing_routes_pkey PRIMARY KEY (test_route_id);


--
-- Name: workers workers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workers
    ADD CONSTRAINT workers_pkey PRIMARY KEY (worker_id);


--
-- Name: missing_code_code_uq; Type: INDEX; Schema: bucket; Owner: -
--

CREATE UNIQUE INDEX missing_code_code_uq ON bucket.missing_code USING btree (missing_code) WHERE (missing_code IS NOT NULL);


--
-- Name: customer_snapshots_daily_snapshot_date_customer_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX customer_snapshots_daily_snapshot_date_customer_id_key ON public.customer_snapshots_daily USING btree (snapshot_date, customer_id);


--
-- Name: file_objects_object_key_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX file_objects_object_key_key ON public.file_objects USING btree (object_key);


--
-- Name: idx_customer_snapshot_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_snapshot_customer ON public.customer_snapshots USING btree (customer_id);


--
-- Name: idx_customer_snapshot_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_snapshot_date ON public.customer_snapshots USING btree (snapshot_date);


--
-- Name: idx_customer_snapshot_monthly_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_snapshot_monthly_customer ON public.customer_snapshots_monthly USING btree (customer_id);


--
-- Name: idx_customer_snapshot_monthly_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_snapshot_monthly_date ON public.customer_snapshots_monthly USING btree (snapshot_date);


--
-- Name: idx_customer_snapshot_quarterly_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_snapshot_quarterly_customer ON public.customer_snapshots_quarterly USING btree (customer_id);


--
-- Name: idx_customer_snapshot_quarterly_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_snapshot_quarterly_date ON public.customer_snapshots_quarterly USING btree (snapshot_date);


--
-- Name: idx_file_objects_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_file_objects_created_at ON public.file_objects USING btree (created_at);


--
-- Name: idx_file_objects_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_file_objects_entity ON public.file_objects USING btree (entity_type, entity_id);


--
-- Name: idx_file_objects_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_file_objects_status ON public.file_objects USING btree (status);


--
-- Name: idx_ir_current_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ir_current_status ON public.item_routes USING btree (current_status);


--
-- Name: idx_ir_finished_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ir_finished_at ON public.item_routes USING btree (finished_at);


--
-- Name: idx_ir_is_finished; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ir_is_finished ON public.item_routes USING btree (is_finished);


--
-- Name: idx_ir_test_station_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ir_test_station_id ON public.item_routes USING btree (test_station_id);


--
-- Name: idx_irh_item_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_irh_item_id ON public.item_route_history USING btree (item_id);


--
-- Name: idx_irh_processing_end_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_irh_processing_end_time ON public.item_route_history USING btree (processing_end_time);


--
-- Name: idx_irh_station_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_irh_station_id ON public.item_route_history USING btree (test_station_id);


--
-- Name: idx_irh_worker_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_irh_worker_id ON public.item_route_history USING btree (worker_id);


--
-- Name: idx_item_type_snapshot_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_item_type_snapshot_date ON public.item_type_snapshots USING btree (snapshot_date);


--
-- Name: idx_item_type_snapshot_monthly_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_item_type_snapshot_monthly_date ON public.item_type_snapshots_monthly USING btree (snapshot_date);


--
-- Name: idx_item_type_snapshot_monthly_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_item_type_snapshot_monthly_type ON public.item_type_snapshots_monthly USING btree (item_type_id);


--
-- Name: idx_item_type_snapshot_quarterly_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_item_type_snapshot_quarterly_date ON public.item_type_snapshots_quarterly USING btree (snapshot_date);


--
-- Name: idx_item_type_snapshot_quarterly_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_item_type_snapshot_quarterly_type ON public.item_type_snapshots_quarterly USING btree (item_type_id);


--
-- Name: idx_item_type_snapshot_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_item_type_snapshot_type ON public.item_type_snapshots USING btree (item_type_id);


--
-- Name: idx_kpi_snapshot_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kpi_snapshot_date ON public.kpi_snapshots USING btree (snapshot_date);


--
-- Name: idx_kpi_snapshot_monthly_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kpi_snapshot_monthly_date ON public.kpi_snapshots_monthly USING btree (snapshot_date);


--
-- Name: idx_kpi_snapshot_quarterly_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kpi_snapshot_quarterly_date ON public.kpi_snapshots_quarterly USING btree (snapshot_date);


--
-- Name: idx_shipment_history_shipment_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shipment_history_shipment_id ON public.shipment_history USING btree (shipment_id);


--
-- Name: idx_shipment_snapshot_customer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shipment_snapshot_customer ON public.shipment_snapshots USING btree (customer_id);


--
-- Name: idx_shipment_snapshot_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shipment_snapshot_date ON public.shipment_snapshots USING btree (snapshot_date);


--
-- Name: idx_shipment_snapshot_monthly_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shipment_snapshot_monthly_date ON public.shipment_snapshots_monthly USING btree (snapshot_date);


--
-- Name: idx_shipment_snapshot_monthly_shipment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shipment_snapshot_monthly_shipment ON public.shipment_snapshots_monthly USING btree (shipment_id);


--
-- Name: idx_shipment_snapshot_quarterly_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shipment_snapshot_quarterly_date ON public.shipment_snapshots_quarterly USING btree (snapshot_date);


--
-- Name: idx_shipment_snapshot_quarterly_shipment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shipment_snapshot_quarterly_shipment ON public.shipment_snapshots_quarterly USING btree (shipment_id);


--
-- Name: idx_shipment_snapshot_shipment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shipment_snapshot_shipment ON public.shipment_snapshots USING btree (shipment_id);


--
-- Name: idx_sources_desc; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sources_desc ON public.sources USING btree (source_desc);


--
-- Name: idx_station_hourly_snapshot_hour; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_station_hourly_snapshot_hour ON public.station_hourly_snapshots USING btree (snapshot_hour);


--
-- Name: idx_station_snapshot_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_station_snapshot_date ON public.station_snapshots USING btree (snapshot_date);


--
-- Name: idx_station_snapshot_monthly_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_station_snapshot_monthly_date ON public.station_snapshots_monthly USING btree (snapshot_date);


--
-- Name: idx_station_snapshot_monthly_station; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_station_snapshot_monthly_station ON public.station_snapshots_monthly USING btree (station_id);


--
-- Name: idx_station_snapshot_quarterly_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_station_snapshot_quarterly_date ON public.station_snapshots_quarterly USING btree (snapshot_date);


--
-- Name: idx_station_snapshot_quarterly_station; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_station_snapshot_quarterly_station ON public.station_snapshots_quarterly USING btree (station_id);


--
-- Name: idx_station_snapshot_station; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_station_snapshot_station ON public.station_snapshots USING btree (station_id);


--
-- Name: idx_status_dist_snapshot_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_status_dist_snapshot_date ON public.status_distribution_snapshots USING btree (snapshot_date);


--
-- Name: idx_status_dist_snapshot_monthly_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_status_dist_snapshot_monthly_date ON public.status_distribution_snapshots_monthly USING btree (snapshot_date);


--
-- Name: idx_status_dist_snapshot_monthly_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_status_dist_snapshot_monthly_status ON public.status_distribution_snapshots_monthly USING btree (status_id);


--
-- Name: idx_status_dist_snapshot_quarterly_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_status_dist_snapshot_quarterly_date ON public.status_distribution_snapshots_quarterly USING btree (snapshot_date);


--
-- Name: idx_status_dist_snapshot_quarterly_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_status_dist_snapshot_quarterly_status ON public.status_distribution_snapshots_quarterly USING btree (status_id);


--
-- Name: idx_status_dist_snapshot_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_status_dist_snapshot_status ON public.status_distribution_snapshots USING btree (status_id);


--
-- Name: idx_system_snapshot_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_system_snapshot_date ON public.system_snapshots USING btree (snapshot_date);


--
-- Name: station_hourly_snapshots_snapshot_hour_station_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX station_hourly_snapshots_snapshot_hour_station_id_key ON public.station_hourly_snapshots USING btree (snapshot_hour, station_id);


--
-- Name: system_snapshots_daily_snapshot_date_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX system_snapshots_daily_snapshot_date_key ON public.system_snapshots_daily USING btree (snapshot_date);


--
-- Name: system_snapshots_monthly_snapshot_date_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX system_snapshots_monthly_snapshot_date_key ON public.system_snapshots_monthly USING btree (snapshot_date);


--
-- Name: department_scores department_scores_factor_id_fkey; Type: FK CONSTRAINT; Schema: premia; Owner: -
--

ALTER TABLE ONLY premia.department_scores
    ADD CONSTRAINT department_scores_factor_id_fkey FOREIGN KEY (factor_id) REFERENCES premia.factors(factor_id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: worker_scores worker_scores_factor_id_fkey; Type: FK CONSTRAINT; Schema: premia; Owner: -
--

ALTER TABLE ONLY premia.worker_scores
    ADD CONSTRAINT worker_scores_factor_id_fkey FOREIGN KEY (factor_id) REFERENCES premia.factors(factor_id);


--
-- Name: item_routes fk_item_routes_item_type; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_routes
    ADD CONSTRAINT fk_item_routes_item_type FOREIGN KEY (item_type_id) REFERENCES public.item_types(item_type_id);


--
-- Name: item_routes fk_item_routes_test_station; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_routes
    ADD CONSTRAINT fk_item_routes_test_station FOREIGN KEY (test_station_id) REFERENCES public.test_stations(test_station_id);


--
-- Name: test_stations fk_test_stations_test_station_type; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.test_stations
    ADD CONSTRAINT fk_test_stations_test_station_type FOREIGN KEY (test_station_type_id) REFERENCES public.test_stations_type(test_station_type_id);


--
-- Name: testing_routes fk_testing_routes_item_type; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.testing_routes
    ADD CONSTRAINT fk_testing_routes_item_type FOREIGN KEY (item_type_id) REFERENCES public.item_types(item_type_id);


--
-- Name: testing_routes fk_testing_routes_test_station_type; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.testing_routes
    ADD CONSTRAINT fk_testing_routes_test_station_type FOREIGN KEY (test_station_type_id) REFERENCES public.test_stations_type(test_station_type_id);


--
-- Name: items items_parent_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_parent_item_id_fkey FOREIGN KEY (parent_item_id) REFERENCES public.items(item_id);


--
-- Name: shipment_history shipment_history_item_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipment_history
    ADD CONSTRAINT shipment_history_item_type_id_fkey FOREIGN KEY (item_type_id) REFERENCES public.item_types(item_type_id);


--
-- Name: shipment_history shipment_history_sending_worker_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipment_history
    ADD CONSTRAINT shipment_history_sending_worker_id_fkey FOREIGN KEY (sending_worker_id) REFERENCES public.workers(worker_id);


--
-- Name: shipment_history shipment_history_shipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipment_history
    ADD CONSTRAINT shipment_history_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES public.shipments(id) ON DELETE CASCADE;


--
-- Name: shipment_items shipment_items_item_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipment_items
    ADD CONSTRAINT shipment_items_item_type_id_fkey FOREIGN KEY (item_type_id) REFERENCES public.item_types(item_type_id);


--
-- Name: shipment_items shipment_items_shipment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipment_items
    ADD CONSTRAINT shipment_items_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES public.shipments(id) ON DELETE CASCADE;


--
-- Name: shipments shipments_recieving_worker_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipments
    ADD CONSTRAINT shipments_recieving_worker_id_fkey FOREIGN KEY (recieving_worker_id) REFERENCES public.workers(worker_id);


--
-- Name: shipments shipments_sending_worker_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipments
    ADD CONSTRAINT shipments_sending_worker_id_fkey FOREIGN KEY (sending_worker_id) REFERENCES public.workers(worker_id);


--
-- PostgreSQL database dump complete
--

\unrestrict admfZWBjgAnlGQV4G3iBOwNyrVJa2sMREpBJM5YHuU3VZXPIvFIfA5dpL2ZvkVU



-- ============================================================
-- SEED DATA (reference tables only)
-- ============================================================

--
-- PostgreSQL database dump
--

\restrict r55S1aJ4cePUzd7MggBC1hpvVPesIhtx7kHRBU6Vo1tWJzjxj5ZWSaAlqv8xpqX

-- Dumped from database version 16.11
-- Dumped by pg_dump version 16.11

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: item_status; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.item_status (item_status_id, item_status_desc) VALUES (1, 'בדיקה                                             ');
INSERT INTO public.item_status (item_status_id, item_status_desc) VALUES (2, 'המתנה                                             ');


--
-- Data for Name: item_types; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.item_types (item_type_id, item_type_desc) VALUES (1, 'מחשב                                              ');


--
-- Data for Name: test_station_status; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.test_station_status (test_station_status_id, test_station_status_desc) VALUES (1, 'עבודה                                             ');
INSERT INTO public.test_station_status (test_station_status_id, test_station_status_desc) VALUES (2, 'המתנה                                             ');


--
-- Data for Name: test_stations_type; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.test_stations_type (test_station_type_id, test_type_desc) VALUES (1, 'חשמל                                              ');


--
-- Data for Name: test_stations; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.test_stations (test_station_id, test_station_type_id, test_station_desc, status, is_research) VALUES (1, 1, 'חשמל 21                                           ', 2, false);


--
-- Data for Name: testing_routes; Type: TABLE DATA; Schema: public; Owner: -
--

INSERT INTO public.testing_routes (test_route_id, item_type_id, test_station_type_id, route_steps, route_number) VALUES (1, 1, 1, '{1,1,1}', 1);


--
-- Name: item_status_item_status_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.item_status_item_status_id_seq', 2, true);


--
-- Name: item_types_item_type_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.item_types_item_type_id_seq', 1, true);


--
-- Name: test_station_status_test_station_status_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.test_station_status_test_station_status_id_seq', 2, true);


--
-- Name: test_stations_test_station_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.test_stations_test_station_id_seq', 1, true);


--
-- Name: test_stations_type_test_station_type_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.test_stations_type_test_station_type_id_seq', 1, true);


--
-- Name: testing_routes_test_route_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.testing_routes_test_route_id_seq', 1, true);


--
-- PostgreSQL database dump complete
--

\unrestrict r55S1aJ4cePUzd7MggBC1hpvVPesIhtx7kHRBU6Vo1tWJzjxj5ZWSaAlqv8xpqX

