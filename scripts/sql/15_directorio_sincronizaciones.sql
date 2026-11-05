-- 15_directorio_sincronizaciones.sql
-- Registro de las actualizaciones masivas de la hoja GESCOLAR con los datos de directores de Supervisión
-- (Directorio de directores → «Actualizar con Supervisión»). Guarda quién la hizo, cuándo y el valor
-- anterior de cada celda, para poder restaurarla. Ejecutar UNA vez en el SQL Editor de Supabase.

CREATE TABLE IF NOT EXISTS directorio_sincronizaciones (
  id             SERIAL PRIMARY KEY,
  usuario_id     INTEGER REFERENCES usuarios(id),
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resumen        JSONB NOT NULL,
  cambios        JSONB NOT NULL,
  revertido_en   TIMESTAMPTZ,
  revertido_por  INTEGER REFERENCES usuarios(id)
);

ALTER TABLE directorio_sincronizaciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON directorio_sincronizaciones FROM anon, authenticated;
