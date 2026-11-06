-- 25_avance_fases_rehabilitacion.sql
-- Avance de la rehabilitación por fases, con peso (%) configurable.
--   fases_rehabilitacion : las fases de la obra y cuánto pesa cada una (las activas deben sumar 100).
--   avance_fases         : % de avance de cada fase en cada plantel de cada plan (y si "no aplica").
-- Ejecutar UNA vez en el SQL Editor de Supabase, ANTES de publicar el cambio. Debe responder "Success. No rows returned".

CREATE TABLE IF NOT EXISTS fases_rehabilitacion (
  id             SERIAL PRIMARY KEY,
  nombre         TEXT NOT NULL,
  peso           NUMERIC(5,2) NOT NULL CHECK (peso >= 0 AND peso <= 100),
  orden          INTEGER NOT NULL DEFAULT 0,
  activa         BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS avance_fases (
  plan_id        INTEGER NOT NULL REFERENCES planes_atencion(id) ON DELETE CASCADE,
  inspeccion_id  INTEGER NOT NULL REFERENCES inspecciones(id) ON DELETE CASCADE,
  fase_id        INTEGER NOT NULL REFERENCES fases_rehabilitacion(id),
  porcentaje     NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (porcentaje >= 0 AND porcentaje <= 100),
  aplica         BOOLEAN NOT NULL DEFAULT TRUE,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_por INTEGER,
  PRIMARY KEY (plan_id, inspeccion_id, fase_id)
);

ALTER TABLE fases_rehabilitacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE avance_fases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON fases_rehabilitacion FROM anon, authenticated;
REVOKE ALL ON avance_fases FROM anon, authenticated;
REVOKE ALL ON SEQUENCE fases_rehabilitacion_id_seq FROM anon, authenticated;

-- Fases iniciales (solo si la tabla está vacía). Suman 100 %.
INSERT INTO fases_rehabilitacion (nombre, peso, orden)
SELECT v.nombre, v.peso, v.orden
FROM (VALUES
  ('Cubierta de techo', 30::numeric, 1),
  ('Instalaciones eléctricas', 20::numeric, 2),
  ('Instalaciones sanitarias', 20::numeric, 3),
  ('Pintura interna/externa', 20::numeric, 4),
  ('Albañilería/herrería', 10::numeric, 5)
) AS v(nombre, peso, orden)
WHERE NOT EXISTS (SELECT 1 FROM fases_rehabilitacion);
