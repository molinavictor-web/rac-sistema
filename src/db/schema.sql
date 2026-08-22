-- =========================================================
-- ESQUEMA DE BASE DE DATOS — Sistema RAC
-- PostgreSQL
-- =========================================================
-- Tablas maestras: municipios, planteles, personal_ministerio
-- Estas tres cambian con el tiempo y son la fuente de verdad
-- contra la que se valida todo lo que sube cada municipio.
-- =========================================================

-- ---------------------------------------------------------
-- MUNICIPIOS
-- ---------------------------------------------------------
CREATE TABLE municipios (
    id              SERIAL PRIMARY KEY,
    codigo          VARCHAR(10) UNIQUE NOT NULL,   -- código oficial del municipio
    nombre          VARCHAR(120) NOT NULL,
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------
-- PLANTELES (tabla maestra — cambia: abren, cierran, se
-- reasignan de municipio o dependencia)
-- ---------------------------------------------------------
CREATE TABLE planteles (
    id                SERIAL PRIMARY KEY,
    codigo_plantel    VARCHAR(20) UNIQUE NOT NULL,  -- código oficial (DEA/código del Ministerio)
    nombre            VARCHAR(200) NOT NULL,
    municipio_id      INTEGER NOT NULL REFERENCES municipios(id),
    dependencia       VARCHAR(30),                  -- nacional / estadal / municipal / privada
    estado            VARCHAR(20) NOT NULL DEFAULT 'activo',  -- activo / cerrado / fusionado
    fecha_cierre      DATE,                          -- si aplica
    creado_en         TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_planteles_municipio ON planteles(municipio_id);
CREATE INDEX idx_planteles_estado ON planteles(estado);

-- ---------------------------------------------------------
-- PERSONAL_MINISTERIO (tabla maestra — 900k+ registros,
-- se recarga/actualiza cuando el Ministerio manda data nueva)
--
-- IMPORTANTE: la cédula NO es única. Una misma persona puede
-- tener varias filas (multi-plantel o multi-cargo). El cruce
-- RAC <-> NOMINA se hace ÚNICAMENTE por CEDULA: si una cédula
-- cargada en el RAC no existe aquí, es alerta -- significa que
-- están asignando a alguien un cargo del estado sin que esté
-- aprobado en el Ministerio.
-- ---------------------------------------------------------
CREATE TABLE personal_ministerio (
    id                SERIAL PRIMARY KEY,
    cedula            VARCHAR(15) NOT NULL,           -- SIN UNIQUE: una persona puede tener varias filas
    nombres           VARCHAR(150),
    apellidos         VARCHAR(150),
    cargo             VARCHAR(100),
    codigo_dependencia VARCHAR(20),                    -- COD_NOM: código de control de nómina por plantel (dato informativo, NO se usa para el cruce)
    codigo_plantel    VARCHAR(20) REFERENCES planteles(codigo_plantel),  -- COD_DEP: id físico del plantel según el Ministerio (dato informativo)
    estado            VARCHAR(20) NOT NULL DEFAULT 'activo',  -- activo / inactivo / jubilado / egresado
    fuente_carga      VARCHAR(50),                   -- de qué archivo/lote vino este registro
    actualizado_en    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_pmin_cedula ON personal_ministerio(cedula);
CREATE INDEX idx_pmin_estado ON personal_ministerio(estado);

-- ---------------------------------------------------------
-- RAC (registro de asignación de carga — ~30k registros,
-- lo mantiene la oficina de gestión humana)
--
-- Una misma cédula puede (y debe poder) repetirse varias veces:
-- un profesor puede dar clases en turno mañana, tarde y/o noche,
-- incluso en distintos planteles. NO hay restricción de unicidad
-- sobre cédula+plantel -- esa flexibilidad es un requisito, no
-- un error a prevenir.
--
-- Traslados entre planteles: se resuelven editando (UPDATE) el
-- registro existente y cambiando su plantel_id -- la tabla
-- auditoria ya captura automáticamente el antes/después de ese
-- cambio, así que no hace falta una tabla aparte para el historial
-- de traslados.
-- ---------------------------------------------------------
CREATE TABLE rac (
    id                SERIAL PRIMARY KEY,
    cedula            VARCHAR(15) NOT NULL,
    plantel_id        INTEGER NOT NULL REFERENCES planteles(id),  -- validado contra el COD DEA en la tabla planteles (973 registros maestros)
    codigo_dependencia VARCHAR(20),                    -- CODIGO RAC del plantel (dato informativo, copiado de la carga)
    cargo             VARCHAR(100),
    turno             VARCHAR(20),                     -- mañana / tarde / noche -- permite distinguir asignaciones múltiples en el mismo plantel
    horas_academicas  NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (horas_academicas >= 0 AND horas_academicas <= 168),
    horas_adm         NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (horas_adm >= 0 AND horas_adm <= 168),
    periodo_escolar   VARCHAR(20) NOT NULL,           -- ej. '2025-2026'
    situacion         VARCHAR(30) NOT NULL DEFAULT 'activo',  -- activo / tramite_jubilacion / reposo / tramite_incapacidad / fallecido / permiso / abandono (7 estados reales confirmados con data)
    actualizado_en    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_rac_cedula ON rac(cedula);
CREATE INDEX idx_rac_plantel ON rac(plantel_id);

-- ---------------------------------------------------------
-- USUARIOS (encargados por municipio, operadores, admin)
-- ---------------------------------------------------------
CREATE TABLE usuarios (
    id                SERIAL PRIMARY KEY,
    nombre            VARCHAR(150) NOT NULL,
    email             VARCHAR(150) UNIQUE NOT NULL,
    password_hash     VARCHAR(255) NOT NULL,
    rol               VARCHAR(30) NOT NULL,           -- encargado_municipio / operador / admin
    municipio_id      INTEGER REFERENCES municipios(id),  -- NULL si es operador/admin
    activo            BOOLEAN NOT NULL DEFAULT true,
    creado_en         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------
-- CARGAS_MUNICIPIO (cada vez que un encargado sube su Excel)
-- ---------------------------------------------------------
CREATE TABLE cargas_municipio (
    id                SERIAL PRIMARY KEY,
    municipio_id      INTEGER NOT NULL REFERENCES municipios(id),
    usuario_id        INTEGER NOT NULL REFERENCES usuarios(id),
    nombre_archivo    VARCHAR(255),
    cantidad_filas    INTEGER,
    estado            VARCHAR(20) NOT NULL DEFAULT 'procesando', -- procesando / completado / error
    fecha_carga       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------
-- CARGA_DETALLE (cada fila procesada de un archivo subido,
-- con trazabilidad hacia el archivo original)
-- ---------------------------------------------------------
CREATE TABLE carga_detalle (
    id                  SERIAL PRIMARY KEY,
    carga_id            INTEGER NOT NULL REFERENCES cargas_municipio(id),
    fila_original        INTEGER,                     -- número de fila en el Excel, para poder ubicarla
    cedula               VARCHAR(15),
    plantel_reportado    VARCHAR(20),
    horas_reportadas      NUMERIC(5,2),
    resultado_validacion VARCHAR(20) NOT NULL DEFAULT 'pendiente', -- ok / alerta / pendiente
    procesado_en         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_detalle_carga ON carga_detalle(carga_id);
CREATE INDEX idx_detalle_cedula ON carga_detalle(cedula);

-- ---------------------------------------------------------
-- ALERTAS (lo que no cuadra en la validación, para revisión
-- manual del operador)
-- ---------------------------------------------------------
CREATE TABLE alertas (
    id                SERIAL PRIMARY KEY,
    carga_detalle_id  INTEGER REFERENCES carga_detalle(id),
    cedula            VARCHAR(15) NOT NULL,
    tipo              VARCHAR(50) NOT NULL,
    -- tipos esperados:
    --   'no_existe_ministerio'    -> la cédula del RAC no está en personal_ministerio
    --                                (alguien fue asignado a un cargo del estado
    --                                 sin estar aprobado en el Ministerio)
    --   'plantel_no_existe'       -> el codigo_plantel (COD DEA) reportado no
    --                                existe en la tabla planteles (973 maestros)
    --   'horas_invalidas'         -> horas académicas/administrativas superan el
    --                                máximo físico (168h/semana) -- reforzado
    --                                también con CHECK constraints en rac
    detalle           TEXT,
    estado            VARCHAR(20) NOT NULL DEFAULT 'pendiente',  -- pendiente / revisado / resuelto / descartado
    revisado_por      INTEGER REFERENCES usuarios(id),
    fecha_revision    TIMESTAMPTZ,
    creado_en         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_alertas_estado ON alertas(estado);
CREATE INDEX idx_alertas_cedula ON alertas(cedula);

-- ---------------------------------------------------------
-- AUDITORIA (huella de toda edición/inserción/eliminación
-- hecha por operadores u admin de la oficina central sobre
-- las tablas sensibles — rac, planteles, personal_ministerio)
-- ---------------------------------------------------------
CREATE TABLE auditoria (
    id                SERIAL PRIMARY KEY,
    usuario_id        INTEGER REFERENCES usuarios(id),  -- quién hizo el cambio
    tabla_afectada    VARCHAR(50) NOT NULL,
    registro_id       INTEGER NOT NULL,                 -- id de la fila afectada
    accion            VARCHAR(10) NOT NULL,              -- INSERT / UPDATE / DELETE
    datos_anteriores  JSONB,                             -- fila completa antes del cambio (NULL si es INSERT)
    datos_nuevos      JSONB,                             -- fila completa después del cambio (NULL si es DELETE)
    fecha             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_auditoria_tabla_registro ON auditoria(tabla_afectada, registro_id);
CREATE INDEX idx_auditoria_usuario ON auditoria(usuario_id);
CREATE INDEX idx_auditoria_fecha ON auditoria(fecha);

-- Función genérica de auditoría: se reutiliza en cada tabla
-- que se quiera trazar. Toma el usuario de una variable de
-- sesión que la aplicación debe fijar en cada transacción:
--   SET LOCAL app.usuario_id = '<id del usuario logueado>';
-- Así, sin importar si el cambio vino de la app o de una
-- consulta directa a la base, queda registrado quién fue
-- (o NULL si nadie fijó la variable, lo cual es en sí mismo
-- una señal a revisar).
CREATE OR REPLACE FUNCTION fn_auditoria()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql;

-- Se activa en las tablas sensibles a auditar:
CREATE TRIGGER trg_auditoria_rac
    AFTER INSERT OR UPDATE OR DELETE ON rac
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria();

CREATE TRIGGER trg_auditoria_planteles
    AFTER INSERT OR UPDATE OR DELETE ON planteles
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria();

CREATE TRIGGER trg_auditoria_personal_ministerio
    AFTER INSERT OR UPDATE OR DELETE ON personal_ministerio
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria();

CREATE TRIGGER trg_auditoria_alertas
    AFTER INSERT OR UPDATE OR DELETE ON alertas
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria();

-- =========================================================
-- Notas de diseño:
--
-- 1. personal_ministerio y planteles son tablas MAESTRAS:
--    se actualizan por lotes cuando llega data nueva del
--    Ministerio, nunca las edita un encargado de municipio
--    directamente.
--
-- 2. El flujo de validación (a implementar en la app, no en
--    SQL puro) por cada fila de carga_detalle -- son DOS
--    validaciones independientes, no una cadena:
--
--      a) ¿la CEDULA existe en personal_ministerio?
--         NO -> alerta 'no_existe_ministerio'
--         (cruce únicamente por cédula -- el codigo_dependencia
--          es dato informativo, no se usa para esta validación)
--
--      b) ¿el codigo_plantel (COD DEA) reportado existe en la
--         tabla planteles (973 registros maestros)?
--         NO -> alerta 'plantel_no_existe'
--
--      c) ¿las horas están dentro de un rango físicamente posible?
--         NO -> alerta 'horas_invalidas'
--
--    Cédulas repetidas en el RAC (mismo profesor, varios turnos
--    o planteles) son válidas y esperadas -- NO generan alerta
--    por sí solas.
--
--    Traslados: se resuelven con un UPDATE sobre el registro de
--    rac existente (cambiando plantel_id/turno) -- el trigger de
--    auditoria ya deja registrado el plantel anterior y el nuevo.
--
-- 3. Con 900k+ registros en personal_ministerio, los índices
--    en cedula son esenciales — sin eso cada validación sería
--    un escaneo completo de la tabla.
--
-- 4. Auditoría: la aplicación DEBE ejecutar
--      SET LOCAL app.usuario_id = '<id>';
--    al inicio de cada transacción que edite rac, planteles,
--    personal_ministerio o alertas, usando el id del usuario
--    logueado (de la tabla usuarios). Los triggers capturan
--    automáticamente el resto — no hace falta lógica extra
--    en el código de la app para loguear cada cambio.
--    Como los datos_anteriores/datos_nuevos quedan en JSONB
--    con la fila completa, se puede reconstruir el historial
--    exacto de cualquier registro en cualquier momento.
-- =========================================================
