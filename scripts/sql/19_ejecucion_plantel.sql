-- 19_ejecucion_plantel.sql
-- Estado de ejecución (rehabilitación) de cada plantel dentro de un plan e ingeniero de rehabilitación.
--   ejecucion: EN_EJECUCION (por defecto) o CERRADO. Mientras esté EN_EJECUCION el plantel no se puede
--   enlazar a otro plan. Un plantel CERRADO sigue contando en el consolidado de su plan.
--   ingeniero_rehab: nombre del ingeniero (de la lista oficial) que lleva la rehabilitación en ese plan.
-- Ejecutar UNA vez en el SQL Editor de Supabase, ANTES de publicar el cambio.

ALTER TABLE plan_inspecciones
  ADD COLUMN IF NOT EXISTS ejecucion       TEXT NOT NULL DEFAULT 'EN_EJECUCION' CHECK (ejecucion IN ('EN_EJECUCION', 'CERRADO')),
  ADD COLUMN IF NOT EXISTS cerrado_en      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cerrado_por     INTEGER REFERENCES usuarios(id),
  ADD COLUMN IF NOT EXISTS reabierto_en    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reabierto_por   INTEGER REFERENCES usuarios(id),
  ADD COLUMN IF NOT EXISTS ingeniero_rehab TEXT;
