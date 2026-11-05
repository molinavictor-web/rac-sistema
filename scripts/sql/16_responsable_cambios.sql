-- 16_responsable_cambios.sql
-- Historial de cambios del ingeniero responsable (columna RESPONSABLE de GESCOLAR) hechos desde
-- Inspecciones → Ingenieros → «Asignar plantel». Guarda quién, cuándo, el plantel, el valor anterior
-- y el nuevo. Ejecutar UNA vez en el SQL Editor de Supabase.

CREATE TABLE IF NOT EXISTS responsable_cambios (
  id           SERIAL PRIMARY KEY,
  codigo_dea   TEXT NOT NULL,
  plantel      TEXT,
  anterior     TEXT,
  nuevo        TEXT,
  usuario_id   INTEGER REFERENCES usuarios(id),
  creado_en    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS responsable_cambios_creado_idx ON responsable_cambios (creado_en DESC);

ALTER TABLE responsable_cambios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON responsable_cambios FROM anon, authenticated;
