-- 31_infra_sugerencias_descartadas.sql
-- Parejas de planteles que el sistema sugiere como «posible edificio compartido» (mismo número de código, uno D=diurno
-- y otro N=nocturno) y que una persona descartó («no comparten edificio»). Así no vuelven a aparecer.
-- Ejecutar UNA vez en Supabase (debe responder «Success. No rows returned»).
DO $$
BEGIN
  CREATE TABLE IF NOT EXISTS infra_sugerencias_descartadas (
    clave          TEXT PRIMARY KEY,           -- p. ej. «S3806-1608»
    codigo_a       TEXT NOT NULL,
    codigo_b       TEXT NOT NULL,
    descartado_por INTEGER REFERENCES usuarios(id),
    descartado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  ALTER TABLE infra_sugerencias_descartadas ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON infra_sugerencias_descartadas FROM anon, authenticated;
END $$;
