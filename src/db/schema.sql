-- schema.sql — Estructura completa de la base de datos de SID (rac-sistema).
-- Generado el 02-nov-2026 desde el proyecto Supabase «rac-sistema» (PostgreSQL 17),
-- leyendo el catálogo de Postgres (solo estructura, sin datos).
--
-- Contiene: RAC (rac, planteles, personal_ministerio, alertas, auditoría, geografía),
-- Supervisión (planteles_supervision, supervisores, circuitos, directores, matrícula),
-- Inspecciones (planes_atencion, inspecciones, catálogo de materiales, adicionales) e
-- Instrumento Uno CDCE (iu_visitas, iu_edificio_miembros), más usuarios y configuracion.
--
-- No incluye a propósito: las tablas de respaldo puntual respaldo_*_20261007_194448
-- ni la tabla de paso stg_geografico (existen en Supabase, pero no las usa el sistema).
--
-- Para una base NUEVA y vacía: psql "$DATABASE_URL" -f src/db/schema.sql
-- (o npm run migrate). NO correrlo sobre la base de producción: las tablas ya existen.


-- ======================================================================
-- 1. Extensiones
-- ======================================================================
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ======================================================================
-- 2. Secuencias
-- ======================================================================
CREATE SEQUENCE IF NOT EXISTS public.adicional_alias_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.adicionales_catalogo_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.alertas_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.alertas_supervision_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.auditoria_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.carga_detalle_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.cargas_municipio_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.catalogo_materiales_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.estados_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.inspecciones_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.iu_edificio_miembros_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.iu_visitas_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.mapeo_codigos_plantel_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.matricula_nivel_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.matricula_planteles_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.municipios_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.parroquias_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.personal_ministerio_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.planes_atencion_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.planteles_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.rac_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.supervisor_circuital_plantel_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.supervisor_municipal_plantel_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.supervisores_circuitales_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.supervisores_municipales_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.usuarios_id_seq;

-- ======================================================================
-- 3. Tablas
-- ======================================================================
CREATE TABLE public.adicional_alias (
  id integer DEFAULT nextval('adicional_alias_id_seq'::regclass) NOT NULL,
  adicional_id integer NOT NULL,
  alias text NOT NULL
);

CREATE TABLE public.adicionales_catalogo (
  id integer DEFAULT nextval('adicionales_catalogo_id_seq'::regclass) NOT NULL,
  nombre text NOT NULL,
  unidad text,
  estado text DEFAULT 'ACTIVO'::text NOT NULL,
  unificado_en integer,
  propuesto_por integer,
  creado_en timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.alertas (
  id integer DEFAULT nextval('alertas_id_seq'::regclass) NOT NULL,
  carga_detalle_id integer,
  cedula character varying(15) NOT NULL,
  tipo character varying(50) NOT NULL,
  detalle text,
  estado character varying(20) DEFAULT 'pendiente'::character varying NOT NULL,
  revisado_por integer,
  fecha_revision timestamp with time zone,
  creado_en timestamp with time zone DEFAULT now() NOT NULL,
  detalle_fila jsonb
);

CREATE TABLE public.alertas_supervision (
  id integer DEFAULT nextval('alertas_supervision_id_seq'::regclass) NOT NULL,
  tipo character varying(50) NOT NULL,
  entidad character varying(30) NOT NULL,
  codigo_plantel character varying(20),
  cedula character varying(20),
  referencia character varying(250),
  detalle text NOT NULL,
  fila_excel integer,
  estado character varying(20) DEFAULT 'pendiente'::character varying NOT NULL,
  resuelto_por integer,
  fecha_resolucion timestamp with time zone,
  creado_en timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.auditoria (
  id integer DEFAULT nextval('auditoria_id_seq'::regclass) NOT NULL,
  usuario_id integer,
  tabla_afectada character varying(50) NOT NULL,
  registro_id integer NOT NULL,
  accion character varying(10) NOT NULL,
  datos_anteriores jsonb,
  datos_nuevos jsonb,
  fecha timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.carga_detalle (
  id integer DEFAULT nextval('carga_detalle_id_seq'::regclass) NOT NULL,
  carga_id integer NOT NULL,
  fila_original integer,
  cedula character varying(15),
  plantel_reportado character varying(20),
  horas_reportadas numeric(5,2),
  resultado_validacion character varying(20) DEFAULT 'pendiente'::character varying NOT NULL,
  procesado_en timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.cargas_municipio (
  id integer DEFAULT nextval('cargas_municipio_id_seq'::regclass) NOT NULL,
  municipio_id integer NOT NULL,
  usuario_id integer NOT NULL,
  nombre_archivo character varying(255),
  cantidad_filas integer,
  estado character varying(20) DEFAULT 'procesando'::character varying NOT NULL,
  fecha_carga timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.catalogo_materiales (
  id integer DEFAULT nextval('catalogo_materiales_id_seq'::regclass) NOT NULL,
  codigo text NOT NULL,
  lista text NOT NULL,
  nro_lista integer,
  ref_lista1 integer,
  capitulo text NOT NULL,
  rubro text NOT NULL,
  unidad text,
  activo boolean DEFAULT true NOT NULL,
  observacion text,
  creado_en timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.circuitos_educativos (
  codigo_circuito text NOT NULL,
  nombre text NOT NULL,
  activo boolean DEFAULT true NOT NULL,
  creado_en timestamp with time zone DEFAULT now() NOT NULL,
  actualizado_en timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.configuracion (
  clave character varying(100) NOT NULL,
  valor text
);

CREATE TABLE public.directores_supervision (
  codigo_plantel character varying(20) NOT NULL,
  cedula character varying(15),
  nombre character varying(150) NOT NULL,
  telefono character varying(30),
  correo character varying(150),
  dependencia character varying(50),
  cargo_nominal character varying(100),
  plantel_cobro character varying(200),
  titulo_pregrado character varying(200),
  numero_cuenta character varying(30),
  direccion_habitacion text,
  titulo_fecha_grado date,
  fecha_ingreso date,
  formacion_unem text,
  usuario_id integer,
  creado_en timestamp with time zone DEFAULT now() NOT NULL,
  actualizado_en timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.estados (
  id integer DEFAULT nextval('estados_id_seq'::regclass) NOT NULL,
  nombre character varying(100) NOT NULL
);

CREATE TABLE public.inspeccion_adicionales (
  inspeccion_id integer NOT NULL,
  adicional_id integer NOT NULL,
  cantidad numeric(14,3),
  actualizado_por integer,
  actualizado_en timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.inspeccion_asignaciones (
  inspeccion_id integer NOT NULL,
  usuario_id integer NOT NULL,
  asignado_por integer,
  asignado_en timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.inspeccion_inspectores (
  inspeccion_id integer NOT NULL,
  orden smallint NOT NULL,
  nombre text NOT NULL,
  usuario_id integer
);

CREATE TABLE public.inspeccion_materiales (
  inspeccion_id integer NOT NULL,
  material_id integer NOT NULL,
  cantidad numeric(14,3) NOT NULL,
  actualizado_por integer,
  actualizado_en timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.inspecciones (
  id integer DEFAULT nextval('inspecciones_id_seq'::regclass) NOT NULL,
  codigo_dea text NOT NULL,
  fecha_inspeccion date,
  membrete jsonb DEFAULT '{}'::jsonb NOT NULL,
  origen text DEFAULT 'NUEVA'::text NOT NULL,
  estado text DEFAULT 'BORRADOR'::text NOT NULL,
  observaciones text,
  creado_por integer,
  creado_en timestamp with time zone DEFAULT now() NOT NULL,
  actualizado_por integer,
  actualizado_en timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.iu_edificio_miembros (
  id integer DEFAULT nextval('iu_edificio_miembros_id_seq'::regclass) NOT NULL,
  codigo_infraestructura text NOT NULL,
  codigo_dea text,
  nombre text NOT NULL,
  visita_id integer,
  creado_en timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.iu_visitas (
  id integer DEFAULT nextval('iu_visitas_id_seq'::regclass) NOT NULL,
  codigo_dea text NOT NULL,
  estado text DEFAULT 'BORRADOR'::text NOT NULL,
  fecha_visita date DEFAULT CURRENT_DATE NOT NULL,
  gescolar jsonb DEFAULT '{}'::jsonb NOT NULL,
  datos jsonb DEFAULT '{}'::jsonb NOT NULL,
  codigo_infraestructura text,
  infra_sincronizada boolean DEFAULT false NOT NULL,
  creado_por integer,
  creado_en timestamp with time zone DEFAULT now() NOT NULL,
  actualizado_por integer,
  actualizado_en timestamp with time zone DEFAULT now() NOT NULL,
  enviado_en timestamp with time zone
);

CREATE TABLE public.mapeo_codigos_plantel (
  id integer DEFAULT nextval('mapeo_codigos_plantel_id_seq'::regclass) NOT NULL,
  codigo_incorrecto text NOT NULL,
  codigo_correcto text NOT NULL,
  nota text,
  creado_en timestamp without time zone DEFAULT now()
);

CREATE TABLE public.matricula_nivel (
  id integer DEFAULT nextval('matricula_nivel_id_seq'::regclass) NOT NULL,
  codigo_plantel character varying NOT NULL,
  periodo_escolar character varying NOT NULL,
  nivel text NOT NULL,
  hembras integer DEFAULT 0 NOT NULL,
  varones integer DEFAULT 0 NOT NULL,
  actualizado_por integer,
  actualizado_en timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.matricula_planteles (
  id integer DEFAULT nextval('matricula_planteles_id_seq'::regclass) NOT NULL,
  codigo_plantel character varying(20) NOT NULL,
  periodo_escolar character varying(20) NOT NULL,
  hembras integer DEFAULT 0 NOT NULL,
  varones integer DEFAULT 0 NOT NULL,
  total integer GENERATED ALWAYS AS (hembras + varones) STORED,
  actualizado_por integer,
  actualizado_en timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.municipios (
  id integer DEFAULT nextval('municipios_id_seq'::regclass) NOT NULL,
  codigo character varying(50),
  nombre character varying(120) NOT NULL,
  creado_en timestamp with time zone DEFAULT now() NOT NULL,
  actualizado_en timestamp with time zone DEFAULT now() NOT NULL,
  estado_id integer NOT NULL
);

CREATE TABLE public.niveles_matricula (
  clave text NOT NULL,
  nombre text NOT NULL,
  orden integer NOT NULL
);

CREATE TABLE public.parroquias (
  id integer DEFAULT nextval('parroquias_id_seq'::regclass) NOT NULL,
  nombre character varying(150) NOT NULL,
  municipio_id integer NOT NULL
);

CREATE TABLE public.personal_ministerio (
  id integer DEFAULT nextval('personal_ministerio_id_seq'::regclass) NOT NULL,
  cedula character varying(15) NOT NULL,
  nombres character varying(150),
  apellidos character varying(150),
  cargo character varying(100),
  codigo_dependencia character varying(20),
  codigo_plantel character varying(20),
  estado character varying(20) DEFAULT 'activo'::character varying NOT NULL,
  fuente_carga character varying(50),
  actualizado_en timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.plan_inspecciones (
  plan_id integer NOT NULL,
  inspeccion_id integer NOT NULL,
  codigo_dea text NOT NULL,
  enlazado_en timestamp with time zone DEFAULT now() NOT NULL,
  enlazado_por integer,
  desenlazado_en timestamp with time zone,
  desenlazado_por integer
);

CREATE TABLE public.planes_atencion (
  id integer DEFAULT nextval('planes_atencion_id_seq'::regclass) NOT NULL,
  nombre text NOT NULL,
  descripcion text,
  version_catalogo text DEFAULT 'LISTA2'::text NOT NULL,
  estado text DEFAULT 'ACTIVO'::text NOT NULL,
  creado_por integer,
  creado_en timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.plantel_circuito (
  codigo_plantel text NOT NULL,
  estado text,
  municipio text,
  parroquia text,
  codigo_circuito text,
  creado_en timestamp with time zone DEFAULT now() NOT NULL,
  actualizado_en timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.plantel_niveles (
  codigo_plantel character varying NOT NULL,
  nivel text NOT NULL
);

CREATE TABLE public.planteles (
  id integer DEFAULT nextval('planteles_id_seq'::regclass) NOT NULL,
  codigo_plantel character varying(20) NOT NULL,
  nombre character varying(300) NOT NULL,
  municipio_id integer NOT NULL,
  dependencia character varying(150),
  estado character varying(50) DEFAULT 'activo'::character varying NOT NULL,
  fecha_cierre date,
  creado_en timestamp with time zone DEFAULT now() NOT NULL,
  actualizado_en timestamp with time zone DEFAULT now() NOT NULL,
  parroquia character varying(100),
  denominacion character varying(100),
  direccion character varying(255),
  estado_geografico character varying(50),
  parroquia_id integer
);

CREATE TABLE public.planteles_supervision (
  codigo_plantel character varying(20) NOT NULL,
  eponimo_anterior character varying(200),
  eponimo_actual character varying(200) NOT NULL,
  denominacion character varying(100),
  niveles_modalidad character varying(150),
  dependencia character varying(50),
  turno character varying(50),
  direccion text,
  coordenadas_geo character varying(60),
  ubicacion_geo text,
  cod_comuna character varying(20),
  nombre_comuna character varying(150),
  creado_en timestamp with time zone DEFAULT now() NOT NULL,
  actualizado_en timestamp with time zone DEFAULT now() NOT NULL,
  municipio character varying(100),
  parroquia character varying(100),
  num_circuito character varying(20),
  nombre_circuito character varying(200),
  observaciones text,
  en_gescolar boolean DEFAULT false NOT NULL
);

CREATE TABLE public.rac (
  id integer DEFAULT nextval('rac_id_seq'::regclass) NOT NULL,
  cedula character varying(15) NOT NULL,
  plantel_id integer NOT NULL,
  codigo_dependencia character varying(50),
  cargo character varying(100),
  turno character varying(25),
  horas_academicas numeric(6,2) DEFAULT 0,
  horas_adm numeric(6,2) DEFAULT 0,
  periodo_escolar character varying(20),
  situacion character varying(30) DEFAULT 'activo'::character varying,
  actualizado_en timestamp with time zone DEFAULT now() NOT NULL,
  codigo_cargo character varying(50),
  tipo_personal character varying(40),
  visto_en timestamp without time zone,
  nivel text,
  modalidad text,
  ubicacion_geografica text,
  turnos_plantel text,
  codigo_estadistico text,
  fecha_ingreso text,
  sexo text,
  grado_imparte text,
  seccion text,
  especialidad text,
  anio text,
  secciones text,
  materia text,
  periodo_grupo text,
  observacion text,
  edad text,
  comparativa text,
  nombres character varying(150),
  apellidos character varying(150)
);

CREATE TABLE public.supervisor_circuital_plantel (
  id integer DEFAULT nextval('supervisor_circuital_plantel_id_seq'::regclass) NOT NULL,
  supervisor_circuital_id integer NOT NULL,
  codigo_plantel character varying(20) NOT NULL
);

CREATE TABLE public.supervisor_municipal_plantel (
  id integer DEFAULT nextval('supervisor_municipal_plantel_id_seq'::regclass) NOT NULL,
  supervisor_municipal_id integer NOT NULL,
  codigo_plantel character varying(20) NOT NULL
);

CREATE TABLE public.supervisores_circuitales (
  id integer DEFAULT nextval('supervisores_circuitales_id_seq'::regclass) NOT NULL,
  num_circuito character varying(20),
  nombre_circuito character varying(200),
  nombres character varying(150) NOT NULL,
  apellidos character varying(150) NOT NULL,
  cedula character varying(15) NOT NULL,
  numero_cuenta character varying(30),
  codigo_nominal character varying(30),
  plantel_dependencia character varying(200),
  titulo_pregrado character varying(200),
  titulo_pre_pos_grado text,
  cargo_nominal character varying(100),
  telefono character varying(30),
  correo character varying(150),
  fecha_ingreso date,
  creado_en timestamp with time zone DEFAULT now() NOT NULL,
  actualizado_en timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.supervisores_municipales (
  id integer DEFAULT nextval('supervisores_municipales_id_seq'::regclass) NOT NULL,
  estado character varying(60),
  municipio character varying(100) NOT NULL,
  nombre character varying(150) NOT NULL,
  cedula character varying(15) NOT NULL,
  telefono character varying(30),
  correo character varying(150),
  parroquia character varying(100),
  nro_cuenta character varying(30),
  fecha_ingreso date,
  cod_dependencia character varying(30),
  titulo_pre_pos_grado text,
  cargo_nominal character varying(100),
  fecha_ultima_credencial date,
  creado_en timestamp with time zone DEFAULT now() NOT NULL,
  actualizado_en timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.usuarios (
  id integer DEFAULT nextval('usuarios_id_seq'::regclass) NOT NULL,
  nombre character varying(150) NOT NULL,
  email character varying(150) NOT NULL,
  password_hash character varying(255) NOT NULL,
  rol character varying(30) NOT NULL,
  municipio_id integer,
  activo boolean DEFAULT true NOT NULL,
  creado_en timestamp with time zone DEFAULT now() NOT NULL,
  codigo_plantel character varying(20)
);


-- ======================================================================
-- 4. Llaves primarias, únicas y CHECK
-- ======================================================================
ALTER TABLE public.adicional_alias ADD CONSTRAINT adicional_alias_pkey PRIMARY KEY (id);
ALTER TABLE public.adicionales_catalogo ADD CONSTRAINT adicionales_catalogo_estado_check CHECK ((estado = ANY (ARRAY['ACTIVO'::text, 'PENDIENTE'::text, 'RETIRADO'::text])));
ALTER TABLE public.adicionales_catalogo ADD CONSTRAINT adicionales_catalogo_pkey PRIMARY KEY (id);
ALTER TABLE public.alertas ADD CONSTRAINT alertas_pkey PRIMARY KEY (id);
ALTER TABLE public.alertas_supervision ADD CONSTRAINT alertas_supervision_pkey PRIMARY KEY (id);
ALTER TABLE public.auditoria ADD CONSTRAINT auditoria_pkey PRIMARY KEY (id);
ALTER TABLE public.carga_detalle ADD CONSTRAINT carga_detalle_pkey PRIMARY KEY (id);
ALTER TABLE public.cargas_municipio ADD CONSTRAINT cargas_municipio_pkey PRIMARY KEY (id);
ALTER TABLE public.catalogo_materiales ADD CONSTRAINT catalogo_materiales_codigo_key UNIQUE (codigo);
ALTER TABLE public.catalogo_materiales ADD CONSTRAINT catalogo_materiales_pkey PRIMARY KEY (id);
ALTER TABLE public.circuitos_educativos ADD CONSTRAINT circuitos_educativos_pkey PRIMARY KEY (codigo_circuito);
ALTER TABLE public.configuracion ADD CONSTRAINT configuracion_pkey PRIMARY KEY (clave);
ALTER TABLE public.directores_supervision ADD CONSTRAINT directores_supervision_pkey PRIMARY KEY (codigo_plantel);
ALTER TABLE public.estados ADD CONSTRAINT estados_nombre_key UNIQUE (nombre);
ALTER TABLE public.estados ADD CONSTRAINT estados_pkey PRIMARY KEY (id);
ALTER TABLE public.inspeccion_adicionales ADD CONSTRAINT inspeccion_adicionales_cantidad_check CHECK (((cantidad IS NULL) OR (cantidad >= (0)::numeric)));
ALTER TABLE public.inspeccion_adicionales ADD CONSTRAINT inspeccion_adicionales_pkey PRIMARY KEY (inspeccion_id, adicional_id);
ALTER TABLE public.inspeccion_asignaciones ADD CONSTRAINT inspeccion_asignaciones_pkey PRIMARY KEY (inspeccion_id, usuario_id);
ALTER TABLE public.inspeccion_inspectores ADD CONSTRAINT inspeccion_inspectores_orden_check CHECK ((orden >= 1));
ALTER TABLE public.inspeccion_inspectores ADD CONSTRAINT inspeccion_inspectores_pkey PRIMARY KEY (inspeccion_id, orden);
ALTER TABLE public.inspeccion_materiales ADD CONSTRAINT inspeccion_materiales_cantidad_check CHECK ((cantidad >= (0)::numeric));
ALTER TABLE public.inspeccion_materiales ADD CONSTRAINT inspeccion_materiales_pkey PRIMARY KEY (inspeccion_id, material_id);
ALTER TABLE public.inspecciones ADD CONSTRAINT inspecciones_estado_check CHECK ((estado = ANY (ARRAY['BORRADOR'::text, 'CARGADA'::text])));
ALTER TABLE public.inspecciones ADD CONSTRAINT inspecciones_origen_check CHECK ((origen = ANY (ARRAY['NUEVA'::text, 'HISTORICA'::text])));
ALTER TABLE public.inspecciones ADD CONSTRAINT inspecciones_pkey PRIMARY KEY (id);
ALTER TABLE public.iu_edificio_miembros ADD CONSTRAINT iu_edificio_miembros_pkey PRIMARY KEY (id);
ALTER TABLE public.iu_visitas ADD CONSTRAINT iu_visitas_estado_check CHECK ((estado = ANY (ARRAY['BORRADOR'::text, 'ENVIADA'::text])));
ALTER TABLE public.iu_visitas ADD CONSTRAINT iu_visitas_pkey PRIMARY KEY (id);
ALTER TABLE public.mapeo_codigos_plantel ADD CONSTRAINT mapeo_codigos_plantel_codigo_incorrecto_key UNIQUE (codigo_incorrecto);
ALTER TABLE public.mapeo_codigos_plantel ADD CONSTRAINT mapeo_codigos_plantel_pkey PRIMARY KEY (id);
ALTER TABLE public.matricula_nivel ADD CONSTRAINT matricula_nivel_codigo_plantel_periodo_escolar_nivel_key UNIQUE (codigo_plantel, periodo_escolar, nivel);
ALTER TABLE public.matricula_nivel ADD CONSTRAINT matricula_nivel_hembras_check CHECK ((hembras >= 0));
ALTER TABLE public.matricula_nivel ADD CONSTRAINT matricula_nivel_pkey PRIMARY KEY (id);
ALTER TABLE public.matricula_nivel ADD CONSTRAINT matricula_nivel_varones_check CHECK ((varones >= 0));
ALTER TABLE public.matricula_planteles ADD CONSTRAINT matricula_planteles_codigo_plantel_periodo_escolar_key UNIQUE (codigo_plantel, periodo_escolar);
ALTER TABLE public.matricula_planteles ADD CONSTRAINT matricula_planteles_hembras_check CHECK ((hembras >= 0));
ALTER TABLE public.matricula_planteles ADD CONSTRAINT matricula_planteles_pkey PRIMARY KEY (id);
ALTER TABLE public.matricula_planteles ADD CONSTRAINT matricula_planteles_varones_check CHECK ((varones >= 0));
ALTER TABLE public.municipios ADD CONSTRAINT municipios_codigo_key UNIQUE (codigo);
ALTER TABLE public.municipios ADD CONSTRAINT municipios_nombre_estado_id_key UNIQUE (nombre, estado_id);
ALTER TABLE public.municipios ADD CONSTRAINT municipios_nombre_estado_key UNIQUE (nombre, estado_id);
ALTER TABLE public.municipios ADD CONSTRAINT municipios_pkey PRIMARY KEY (id);
ALTER TABLE public.niveles_matricula ADD CONSTRAINT niveles_matricula_pkey PRIMARY KEY (clave);
ALTER TABLE public.parroquias ADD CONSTRAINT parroquias_nombre_municipio_id_key UNIQUE (nombre, municipio_id);
ALTER TABLE public.parroquias ADD CONSTRAINT parroquias_pkey PRIMARY KEY (id);
ALTER TABLE public.personal_ministerio ADD CONSTRAINT personal_ministerio_pkey PRIMARY KEY (id);
ALTER TABLE public.plan_inspecciones ADD CONSTRAINT plan_inspecciones_pkey PRIMARY KEY (plan_id, inspeccion_id);
ALTER TABLE public.planes_atencion ADD CONSTRAINT planes_atencion_estado_check CHECK ((estado = ANY (ARRAY['ACTIVO'::text, 'CERRADO'::text])));
ALTER TABLE public.planes_atencion ADD CONSTRAINT planes_atencion_nombre_key UNIQUE (nombre);
ALTER TABLE public.planes_atencion ADD CONSTRAINT planes_atencion_pkey PRIMARY KEY (id);
ALTER TABLE public.plantel_circuito ADD CONSTRAINT plantel_circuito_pkey PRIMARY KEY (codigo_plantel);
ALTER TABLE public.plantel_niveles ADD CONSTRAINT plantel_niveles_pkey PRIMARY KEY (codigo_plantel, nivel);
ALTER TABLE public.planteles ADD CONSTRAINT planteles_codigo_plantel_key UNIQUE (codigo_plantel);
ALTER TABLE public.planteles ADD CONSTRAINT planteles_pkey PRIMARY KEY (id);
ALTER TABLE public.planteles_supervision ADD CONSTRAINT planteles_supervision_pkey PRIMARY KEY (codigo_plantel);
ALTER TABLE public.rac ADD CONSTRAINT rac_horas_academicas_check CHECK (((horas_academicas >= (0)::numeric) AND (horas_academicas <= (168)::numeric)));
ALTER TABLE public.rac ADD CONSTRAINT rac_horas_adm_check CHECK (((horas_adm >= (0)::numeric) AND (horas_adm <= (168)::numeric)));
ALTER TABLE public.rac ADD CONSTRAINT rac_pkey PRIMARY KEY (id);
ALTER TABLE public.supervisor_circuital_plantel ADD CONSTRAINT supervisor_circuital_plantel_pkey PRIMARY KEY (id);
ALTER TABLE public.supervisor_circuital_plantel ADD CONSTRAINT supervisor_circuital_plantel_supervisor_circuital_id_codigo_key UNIQUE (supervisor_circuital_id, codigo_plantel);
ALTER TABLE public.supervisor_municipal_plantel ADD CONSTRAINT supervisor_municipal_plantel_pkey PRIMARY KEY (id);
ALTER TABLE public.supervisor_municipal_plantel ADD CONSTRAINT supervisor_municipal_plantel_supervisor_municipal_id_codigo_key UNIQUE (supervisor_municipal_id, codigo_plantel);
ALTER TABLE public.supervisores_circuitales ADD CONSTRAINT supervisores_circuitales_pkey PRIMARY KEY (id);
ALTER TABLE public.supervisores_municipales ADD CONSTRAINT supervisores_municipales_pkey PRIMARY KEY (id);
ALTER TABLE public.usuarios ADD CONSTRAINT usuarios_email_key UNIQUE (email);
ALTER TABLE public.usuarios ADD CONSTRAINT usuarios_pkey PRIMARY KEY (id);

-- ======================================================================
-- 5. Llaves foráneas
-- ======================================================================
ALTER TABLE public.adicional_alias ADD CONSTRAINT adicional_alias_adicional_id_fkey FOREIGN KEY (adicional_id) REFERENCES adicionales_catalogo(id) ON DELETE CASCADE;
ALTER TABLE public.adicionales_catalogo ADD CONSTRAINT adicionales_catalogo_propuesto_por_fkey FOREIGN KEY (propuesto_por) REFERENCES usuarios(id);
ALTER TABLE public.adicionales_catalogo ADD CONSTRAINT adicionales_catalogo_unificado_en_fkey FOREIGN KEY (unificado_en) REFERENCES adicionales_catalogo(id);
ALTER TABLE public.alertas ADD CONSTRAINT alertas_carga_detalle_id_fkey FOREIGN KEY (carga_detalle_id) REFERENCES carga_detalle(id);
ALTER TABLE public.alertas ADD CONSTRAINT alertas_revisado_por_fkey FOREIGN KEY (revisado_por) REFERENCES usuarios(id);
ALTER TABLE public.alertas_supervision ADD CONSTRAINT alertas_supervision_resuelto_por_fkey FOREIGN KEY (resuelto_por) REFERENCES usuarios(id);
ALTER TABLE public.auditoria ADD CONSTRAINT auditoria_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES usuarios(id);
ALTER TABLE public.carga_detalle ADD CONSTRAINT carga_detalle_carga_id_fkey FOREIGN KEY (carga_id) REFERENCES cargas_municipio(id);
ALTER TABLE public.cargas_municipio ADD CONSTRAINT cargas_municipio_municipio_id_fkey FOREIGN KEY (municipio_id) REFERENCES municipios(id);
ALTER TABLE public.cargas_municipio ADD CONSTRAINT cargas_municipio_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES usuarios(id);
ALTER TABLE public.directores_supervision ADD CONSTRAINT directores_supervision_codigo_plantel_fkey FOREIGN KEY (codigo_plantel) REFERENCES planteles_supervision(codigo_plantel) ON DELETE CASCADE;
ALTER TABLE public.directores_supervision ADD CONSTRAINT directores_supervision_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES usuarios(id);
ALTER TABLE public.inspeccion_adicionales ADD CONSTRAINT inspeccion_adicionales_actualizado_por_fkey FOREIGN KEY (actualizado_por) REFERENCES usuarios(id);
ALTER TABLE public.inspeccion_adicionales ADD CONSTRAINT inspeccion_adicionales_adicional_id_fkey FOREIGN KEY (adicional_id) REFERENCES adicionales_catalogo(id);
ALTER TABLE public.inspeccion_adicionales ADD CONSTRAINT inspeccion_adicionales_inspeccion_id_fkey FOREIGN KEY (inspeccion_id) REFERENCES inspecciones(id) ON DELETE CASCADE;
ALTER TABLE public.inspeccion_asignaciones ADD CONSTRAINT inspeccion_asignaciones_asignado_por_fkey FOREIGN KEY (asignado_por) REFERENCES usuarios(id);
ALTER TABLE public.inspeccion_asignaciones ADD CONSTRAINT inspeccion_asignaciones_inspeccion_id_fkey FOREIGN KEY (inspeccion_id) REFERENCES inspecciones(id) ON DELETE CASCADE;
ALTER TABLE public.inspeccion_asignaciones ADD CONSTRAINT inspeccion_asignaciones_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE;
ALTER TABLE public.inspeccion_inspectores ADD CONSTRAINT inspeccion_inspectores_inspeccion_id_fkey FOREIGN KEY (inspeccion_id) REFERENCES inspecciones(id) ON DELETE CASCADE;
ALTER TABLE public.inspeccion_inspectores ADD CONSTRAINT inspeccion_inspectores_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES usuarios(id);
ALTER TABLE public.inspeccion_materiales ADD CONSTRAINT inspeccion_materiales_actualizado_por_fkey FOREIGN KEY (actualizado_por) REFERENCES usuarios(id);
ALTER TABLE public.inspeccion_materiales ADD CONSTRAINT inspeccion_materiales_inspeccion_id_fkey FOREIGN KEY (inspeccion_id) REFERENCES inspecciones(id) ON DELETE CASCADE;
ALTER TABLE public.inspeccion_materiales ADD CONSTRAINT inspeccion_materiales_material_id_fkey FOREIGN KEY (material_id) REFERENCES catalogo_materiales(id);
ALTER TABLE public.inspecciones ADD CONSTRAINT inspecciones_actualizado_por_fkey FOREIGN KEY (actualizado_por) REFERENCES usuarios(id);
ALTER TABLE public.inspecciones ADD CONSTRAINT inspecciones_creado_por_fkey FOREIGN KEY (creado_por) REFERENCES usuarios(id);
ALTER TABLE public.iu_edificio_miembros ADD CONSTRAINT iu_edificio_miembros_visita_id_fkey FOREIGN KEY (visita_id) REFERENCES iu_visitas(id) ON DELETE SET NULL;
ALTER TABLE public.iu_visitas ADD CONSTRAINT iu_visitas_actualizado_por_fkey FOREIGN KEY (actualizado_por) REFERENCES usuarios(id);
ALTER TABLE public.iu_visitas ADD CONSTRAINT iu_visitas_creado_por_fkey FOREIGN KEY (creado_por) REFERENCES usuarios(id);
ALTER TABLE public.matricula_nivel ADD CONSTRAINT matricula_nivel_codigo_plantel_fkey FOREIGN KEY (codigo_plantel) REFERENCES planteles_supervision(codigo_plantel) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE public.matricula_nivel ADD CONSTRAINT matricula_nivel_nivel_fkey FOREIGN KEY (nivel) REFERENCES niveles_matricula(clave);
ALTER TABLE public.matricula_planteles ADD CONSTRAINT matricula_planteles_actualizado_por_fkey FOREIGN KEY (actualizado_por) REFERENCES usuarios(id);
ALTER TABLE public.matricula_planteles ADD CONSTRAINT matricula_planteles_codigo_plantel_fkey FOREIGN KEY (codigo_plantel) REFERENCES planteles_supervision(codigo_plantel) ON DELETE CASCADE;
ALTER TABLE public.municipios ADD CONSTRAINT municipios_estado_id_fkey FOREIGN KEY (estado_id) REFERENCES estados(id);
ALTER TABLE public.parroquias ADD CONSTRAINT parroquias_municipio_id_fkey FOREIGN KEY (municipio_id) REFERENCES municipios(id);
ALTER TABLE public.plan_inspecciones ADD CONSTRAINT plan_inspecciones_desenlazado_por_fkey FOREIGN KEY (desenlazado_por) REFERENCES usuarios(id);
ALTER TABLE public.plan_inspecciones ADD CONSTRAINT plan_inspecciones_enlazado_por_fkey FOREIGN KEY (enlazado_por) REFERENCES usuarios(id);
ALTER TABLE public.plan_inspecciones ADD CONSTRAINT plan_inspecciones_inspeccion_id_fkey FOREIGN KEY (inspeccion_id) REFERENCES inspecciones(id) ON DELETE CASCADE;
ALTER TABLE public.plan_inspecciones ADD CONSTRAINT plan_inspecciones_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES planes_atencion(id) ON DELETE CASCADE;
ALTER TABLE public.planes_atencion ADD CONSTRAINT planes_atencion_creado_por_fkey FOREIGN KEY (creado_por) REFERENCES usuarios(id);
ALTER TABLE public.plantel_circuito ADD CONSTRAINT plantel_circuito_codigo_circuito_fkey FOREIGN KEY (codigo_circuito) REFERENCES circuitos_educativos(codigo_circuito);
ALTER TABLE public.plantel_niveles ADD CONSTRAINT plantel_niveles_codigo_plantel_fkey FOREIGN KEY (codigo_plantel) REFERENCES planteles_supervision(codigo_plantel) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE public.plantel_niveles ADD CONSTRAINT plantel_niveles_nivel_fkey FOREIGN KEY (nivel) REFERENCES niveles_matricula(clave);
ALTER TABLE public.planteles ADD CONSTRAINT planteles_municipio_id_fkey FOREIGN KEY (municipio_id) REFERENCES municipios(id);
ALTER TABLE public.planteles ADD CONSTRAINT planteles_parroquia_id_fkey FOREIGN KEY (parroquia_id) REFERENCES parroquias(id);
ALTER TABLE public.rac ADD CONSTRAINT rac_plantel_id_fkey FOREIGN KEY (plantel_id) REFERENCES planteles(id);
ALTER TABLE public.supervisor_circuital_plantel ADD CONSTRAINT supervisor_circuital_plantel_codigo_plantel_fkey FOREIGN KEY (codigo_plantel) REFERENCES planteles_supervision(codigo_plantel) ON DELETE CASCADE;
ALTER TABLE public.supervisor_circuital_plantel ADD CONSTRAINT supervisor_circuital_plantel_supervisor_circuital_id_fkey FOREIGN KEY (supervisor_circuital_id) REFERENCES supervisores_circuitales(id) ON DELETE CASCADE;
ALTER TABLE public.supervisor_municipal_plantel ADD CONSTRAINT supervisor_municipal_plantel_codigo_plantel_fkey FOREIGN KEY (codigo_plantel) REFERENCES planteles_supervision(codigo_plantel) ON DELETE CASCADE;
ALTER TABLE public.supervisor_municipal_plantel ADD CONSTRAINT supervisor_municipal_plantel_supervisor_municipal_id_fkey FOREIGN KEY (supervisor_municipal_id) REFERENCES supervisores_municipales(id) ON DELETE CASCADE;
ALTER TABLE public.usuarios ADD CONSTRAINT usuarios_municipio_id_fkey FOREIGN KEY (municipio_id) REFERENCES municipios(id);

-- ======================================================================
-- 6. Índices
-- ======================================================================
CREATE INDEX idx_alertas_cedula ON public.alertas USING btree (cedula);
CREATE INDEX idx_alertas_estado ON public.alertas USING btree (estado);
CREATE INDEX idx_alertas_sup_estado ON public.alertas_supervision USING btree (estado);
CREATE INDEX idx_alertas_sup_tipo ON public.alertas_supervision USING btree (tipo);
CREATE INDEX idx_auditoria_fecha ON public.auditoria USING btree (fecha);
CREATE INDEX idx_auditoria_tabla_registro ON public.auditoria USING btree (tabla_afectada, registro_id);
CREATE INDEX idx_auditoria_usuario ON public.auditoria USING btree (usuario_id);
CREATE INDEX idx_catalogo_materiales_activo ON public.catalogo_materiales USING btree (activo);
CREATE INDEX idx_catalogo_materiales_capitulo ON public.catalogo_materiales USING btree (capitulo);
CREATE INDEX idx_detalle_carga ON public.carga_detalle USING btree (carga_id);
CREATE INDEX idx_detalle_cedula ON public.carga_detalle USING btree (cedula);
CREATE INDEX idx_directores_supervision_usuario ON public.directores_supervision USING btree (usuario_id);
CREATE INDEX idx_inspeccion_adicionales_adicional ON public.inspeccion_adicionales USING btree (adicional_id);
CREATE INDEX idx_inspeccion_materiales_material ON public.inspeccion_materiales USING btree (material_id);
CREATE INDEX idx_inspecciones_dea ON public.inspecciones USING btree (codigo_dea);
CREATE INDEX idx_plan_inspecciones_inspeccion ON public.plan_inspecciones USING btree (inspeccion_id);
CREATE INDEX idx_plantel_circuito_circuito ON public.plantel_circuito USING btree (codigo_circuito);
CREATE INDEX idx_plantel_circuito_municipio ON public.plantel_circuito USING btree (municipio);
CREATE INDEX idx_planteles_estado ON public.planteles USING btree (estado);
CREATE INDEX idx_planteles_municipio ON public.planteles USING btree (municipio_id);
CREATE INDEX idx_pmin_cedula ON public.personal_ministerio USING btree (cedula);
CREATE INDEX idx_pmin_estado ON public.personal_ministerio USING btree (estado);
CREATE INDEX idx_rac_cedula ON public.rac USING btree (cedula);
CREATE INDEX idx_rac_plantel ON public.rac USING btree (plantel_id);
CREATE INDEX ix_asignaciones_usuario ON public.inspeccion_asignaciones USING btree (usuario_id);
CREATE INDEX ix_iu_miembro_infra ON public.iu_edificio_miembros USING btree (codigo_infraestructura);
CREATE INDEX ix_iu_visitas_creador ON public.iu_visitas USING btree (creado_por);
CREATE INDEX ix_iu_visitas_dea ON public.iu_visitas USING btree (codigo_dea);
CREATE UNIQUE INDEX ux_adicional_alias ON public.adicional_alias USING btree (upper(alias));
CREATE UNIQUE INDEX ux_adicionales_nombre ON public.adicionales_catalogo USING btree (upper(nombre));
CREATE UNIQUE INDEX ux_iu_miembro_dea ON public.iu_edificio_miembros USING btree (codigo_infraestructura, codigo_dea) WHERE (codigo_dea IS NOT NULL);
CREATE UNIQUE INDEX ux_iu_miembro_nombre ON public.iu_edificio_miembros USING btree (codigo_infraestructura, lower(nombre)) WHERE (codigo_dea IS NULL);
CREATE UNIQUE INDEX ux_plan_plantel_activo ON public.plan_inspecciones USING btree (plan_id, codigo_dea) WHERE (desenlazado_en IS NULL);

-- ======================================================================
-- 7. Funciones
-- ======================================================================
CREATE OR REPLACE FUNCTION public.fn_auditoria()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_usuario_id INTEGER;
BEGIN
    BEGIN
        v_usuario_id := current_setting('app.usuario_id', true)::INTEGER;
    EXCEPTION WHEN OTHERS THEN
        v_usuario_id := NULL;
    END;

    IF (TG_OP = 'DELETE') THEN
        INSERT INTO auditoria (usuario_id, tabla_afectada, registro_id, accion, datos_anteriores, datos_nuevos)
        VALUES (v_usuario_id, TG_TABLE_NAME, OLD.id, 'DELETE', row_to_json(OLD)::jsonb, NULL);
        RETURN OLD;
    ELSIF (TG_OP = 'UPDATE') THEN
        INSERT INTO auditoria (usuario_id, tabla_afectada, registro_id, accion, datos_anteriores, datos_nuevos)
        VALUES (v_usuario_id, TG_TABLE_NAME, NEW.id, 'UPDATE', row_to_json(OLD)::jsonb, row_to_json(NEW)::jsonb);
        RETURN NEW;
    ELSIF (TG_OP = 'INSERT') THEN
        INSERT INTO auditoria (usuario_id, tabla_afectada, registro_id, accion, datos_anteriores, datos_nuevos)
        VALUES (v_usuario_id, TG_TABLE_NAME, NEW.id, 'INSERT', NULL, row_to_json(NEW)::jsonb);
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$function$
;

-- ======================================================================
-- 8. Vistas
-- ======================================================================
CREATE OR REPLACE VIEW public.v_consolidado_adicionales AS
 SELECT pi.plan_id,
    COALESCE(a.unificado_en, a.id) AS adicional_id,
    sum(ia.cantidad) AS total,
    count(*) AS planteles_con_cantidad
   FROM plan_inspecciones pi
     JOIN inspeccion_adicionales ia ON ia.inspeccion_id = pi.inspeccion_id
     JOIN adicionales_catalogo a ON a.id = ia.adicional_id
  WHERE pi.desenlazado_en IS NULL AND ia.cantidad > 0::numeric
  GROUP BY pi.plan_id, (COALESCE(a.unificado_en, a.id));
CREATE OR REPLACE VIEW public.v_consolidado_oficial AS
 SELECT pi.plan_id,
    im.material_id,
    sum(im.cantidad) AS total,
    count(*) AS planteles_con_cantidad
   FROM plan_inspecciones pi
     JOIN inspeccion_materiales im ON im.inspeccion_id = pi.inspeccion_id
  WHERE pi.desenlazado_en IS NULL AND im.cantidad > 0::numeric
  GROUP BY pi.plan_id, im.material_id;
CREATE OR REPLACE VIEW public.v_mapa_supervision AS
 SELECT pc.codigo_plantel,
    pc.estado,
    pc.municipio,
    pc.parroquia,
    c.codigo_circuito AS nro_circuito,
    c.nombre AS nombre_circuito
   FROM plantel_circuito pc
     LEFT JOIN circuitos_educativos c ON c.codigo_circuito = pc.codigo_circuito;

-- ======================================================================
-- 9. Triggers de auditoría
-- ======================================================================
CREATE TRIGGER trg_auditoria_alertas AFTER INSERT OR DELETE OR UPDATE ON public.alertas FOR EACH ROW EXECUTE FUNCTION fn_auditoria();
CREATE TRIGGER trg_auditoria_personal_ministerio AFTER INSERT OR DELETE OR UPDATE ON public.personal_ministerio FOR EACH ROW EXECUTE FUNCTION fn_auditoria();
CREATE TRIGGER trg_auditoria_planteles AFTER INSERT OR DELETE OR UPDATE ON public.planteles FOR EACH ROW EXECUTE FUNCTION fn_auditoria();
CREATE TRIGGER trg_auditoria_rac AFTER INSERT OR DELETE OR UPDATE ON public.rac FOR EACH ROW EXECUTE FUNCTION fn_auditoria();

-- ======================================================================
-- 10. Seguridad a nivel de fila (RLS)
-- ======================================================================
-- Todas las tablas tienen RLS activado y SIN políticas: así nadie puede leerlas por la API
-- pública de Supabase (clave anon). El servidor entra con su propia conexión (DATABASE_URL).
ALTER TABLE public.adicional_alias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.adicionales_catalogo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alertas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alertas_supervision ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auditoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carga_detalle ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cargas_municipio ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogo_materiales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.circuitos_educativos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.configuracion ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.directores_supervision ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspeccion_adicionales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspeccion_asignaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspeccion_inspectores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspeccion_materiales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspecciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.iu_edificio_miembros ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.iu_visitas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mapeo_codigos_plantel ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matricula_nivel ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matricula_planteles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.municipios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.niveles_matricula ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parroquias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personal_ministerio ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_inspecciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planes_atencion ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plantel_circuito ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plantel_niveles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planteles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planteles_supervision ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rac ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supervisor_circuital_plantel ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supervisor_municipal_plantel ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supervisores_circuitales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supervisores_municipales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Infraestructuras (script 12_infraestructuras.sql): edificios con código INFRA-000001… y sus instituciones
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS infraestructuras_numero_seq;

CREATE TABLE IF NOT EXISTS infraestructuras (
  id               SERIAL      PRIMARY KEY,
  numero           INTEGER     NOT NULL DEFAULT nextval('infraestructuras_numero_seq'),
  codigo           TEXT        GENERATED ALWAYS AS ('INFRA-' || lpad(numero::text, 6, '0')) STORED,
  codigo_anterior  TEXT,                       -- código que tenía en la hoja Coordenadas Planteles (DEA o EDIF…)
  creado_por       INTEGER     REFERENCES usuarios(id),
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_infra_numero ON infraestructuras (numero);
CREATE UNIQUE INDEX IF NOT EXISTS ux_infra_codigo ON infraestructuras (codigo);
CREATE UNIQUE INDEX IF NOT EXISTS ux_infra_anterior ON infraestructuras (lower(codigo_anterior)) WHERE codigo_anterior IS NOT NULL;

-- Instituciones de cada edificio. Un plantel con código DEA pertenece a UN solo edificio.
-- Una institución sin código DEA se identifica por su nombre dentro del edificio.
CREATE TABLE IF NOT EXISTS infra_miembros (
  id                 SERIAL      PRIMARY KEY,
  infraestructura_id INTEGER     NOT NULL REFERENCES infraestructuras(id) ON DELETE CASCADE,
  codigo_dea         TEXT,
  nombre             TEXT        NOT NULL,
  creado_por         INTEGER     REFERENCES usuarios(id),
  creado_en          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_infra_miembros_infra ON infra_miembros (infraestructura_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_infra_miembro_dea ON infra_miembros (lower(codigo_dea)) WHERE codigo_dea IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_infra_miembro_nombre ON infra_miembros (infraestructura_id, lower(nombre)) WHERE codigo_dea IS NULL;

-- Seguridad (igual que el resto): la app entra como "postgres"; nadie más debe leer estas tablas por la API pública.
ALTER TABLE infraestructuras ENABLE ROW LEVEL SECURITY;
ALTER TABLE infra_miembros   ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON infraestructuras, infra_miembros FROM anon, authenticated;
REVOKE ALL ON SEQUENCE infraestructuras_numero_seq, infraestructuras_id_seq, infra_miembros_id_seq FROM anon, authenticated;

-- Espacios separados (script 13_infra_espacios.sql)
CREATE TABLE IF NOT EXISTS infra_espacios (
  id            SERIAL      PRIMARY KEY,
  codigo_dea    TEXT        NOT NULL,
  numero        INTEGER     NOT NULL,
  descripcion   TEXT        NOT NULL,          -- p. ej. "Casa de la Sra. Rosa"
  referencia    TEXT,                          -- cómo llegar / ubicación
  distancia     TEXT,                          -- distancia o tiempo desde el edificio principal
  aulas         INTEGER     CHECK (aulas IS NULL OR aulas BETWEEN 0 AND 200),
  observaciones TEXT,
  latitud       DOUBLE PRECISION CHECK (latitud IS NULL OR latitud BETWEEN -90 AND 90),
  longitud      DOUBLE PRECISION CHECK (longitud IS NULL OR longitud BETWEEN -180 AND 180),
  creado_por    INTEGER     REFERENCES usuarios(id),
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_infra_espacio_numero ON infra_espacios (lower(codigo_dea), numero);

ALTER TABLE infra_espacios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON infra_espacios FROM anon, authenticated;
REVOKE ALL ON SEQUENCE infra_espacios_id_seq FROM anon, authenticated;
