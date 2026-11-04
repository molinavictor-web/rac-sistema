-- 14_consultas_expres.sql
-- Consultas exprés del Instrumento Uno: una consulta toma una o varias FASES (secciones) del instrumento; se llena
-- por código DEA y actualiza el dato vigente del plantel, guardando el historial de cambios.
--   iu_consultas  la consulta (nombre, fases, abierta/cerrada)
--   iu_valores    el valor vigente de cada pregunta por plantel cargado por consulta (gana sobre la visita si es más nuevo)
--   iu_cambios    historial: quién, cuándo, valor anterior y nuevo, nota (alimenta "Cambios recientes")
-- Se puede volver a correr sin problema. Pegar y ejecutar en el SQL Editor de Supabase.

CREATE TABLE IF NOT EXISTS iu_consultas (
  id          SERIAL PRIMARY KEY,
  nombre      TEXT NOT NULL,
  descripcion TEXT,
  fases       TEXT[] NOT NULL,
  estado      TEXT NOT NULL DEFAULT 'ABIERTA' CHECK (estado IN ('ABIERTA', 'CERRADA')),
  creado_por  INTEGER REFERENCES usuarios(id),
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cerrada_en  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS iu_valores (
  codigo_dea       TEXT NOT NULL,
  clave            TEXT NOT NULL,
  valor            JSONB NOT NULL,           -- 'null' = el dato se vació a propósito
  origen           TEXT NOT NULL DEFAULT 'personal' CHECK (origen IN ('personal', 'director')),
  verificado_campo BOOLEAN NOT NULL DEFAULT FALSE,
  usuario_id       INTEGER REFERENCES usuarios(id),
  consulta_id      INTEGER REFERENCES iu_consultas(id) ON DELETE SET NULL,
  actualizado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (codigo_dea, clave)
);
CREATE INDEX IF NOT EXISTS ix_iu_valores_dea ON iu_valores (lower(codigo_dea));

CREATE TABLE IF NOT EXISTS iu_cambios (
  id             SERIAL PRIMARY KEY,
  codigo_dea     TEXT NOT NULL,
  clave          TEXT NOT NULL,
  valor_anterior JSONB,
  valor_nuevo    JSONB,
  origen         TEXT NOT NULL DEFAULT 'personal' CHECK (origen IN ('personal', 'director')),
  usuario_id     INTEGER REFERENCES usuarios(id),
  consulta_id    INTEGER REFERENCES iu_consultas(id) ON DELETE SET NULL,
  nota           TEXT,
  revertido_en   TIMESTAMPTZ,
  revertido_por  INTEGER REFERENCES usuarios(id),
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_iu_cambios_fecha ON iu_cambios (creado_en DESC);
CREATE INDEX IF NOT EXISTS ix_iu_cambios_dea ON iu_cambios (lower(codigo_dea));

-- Acceso público cerrado (el sistema se conecta directo a Postgres, no por la API de Supabase).
ALTER TABLE iu_consultas ENABLE ROW LEVEL SECURITY;
ALTER TABLE iu_valores   ENABLE ROW LEVEL SECURITY;
ALTER TABLE iu_cambios   ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON iu_consultas, iu_valores, iu_cambios FROM anon, authenticated;
