-- 27_plantel_cambios.sql
-- Historial de los cambios que se hacen a los datos de un plantel desde la ficha de
-- «Consultar planteles» (se escriben en la hoja GESCOLAR; aquí queda quién, cuándo y el valor
-- anterior, para poder restaurar un cambio equivocado).
-- Ejecutar UNA vez en el editor SQL de Supabase (debe responder «Success. No rows returned»).
DO $$
BEGIN
  CREATE TABLE IF NOT EXISTS plantel_cambios (
    id            SERIAL PRIMARY KEY,
    codigo_dea    TEXT NOT NULL,
    usuario_id    INTEGER REFERENCES usuarios(id),
    creado_en     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    campos        JSONB NOT NULL,            -- [{campo, antes, despues}]
    revertido_en  TIMESTAMPTZ,
    revertido_por INTEGER REFERENCES usuarios(id)
  );
  CREATE INDEX IF NOT EXISTS ix_plantel_cambios_codigo ON plantel_cambios (codigo_dea, id DESC);
  ALTER TABLE plantel_cambios ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON plantel_cambios FROM anon, authenticated;
END $$;
