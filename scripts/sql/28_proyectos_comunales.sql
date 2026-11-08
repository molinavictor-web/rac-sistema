-- 28_proyectos_comunales.sql
-- Proyectos comunales aprobados para atender planteles (el gobierno nacional los ejecuta a través de los
-- circuitos comunales: la comunidad elige el proyecto en una elección; cada aprobación es una fila).
-- Un plantel puede tener varias aprobaciones (1, 2, 3…, se numeran por año). Ejecutar UNA vez en Supabase
-- (debe responder «Success. No rows returned»).
DO $$
BEGIN
  CREATE TABLE IF NOT EXISTS proyectos_comunales (
    id              SERIAL PRIMARY KEY,
    codigo_dea      TEXT NOT NULL,
    anio            INTEGER NOT NULL CHECK (anio BETWEEN 2000 AND 2100),   -- año de la elección
    nombre_proyecto TEXT NOT NULL,
    circuito_codigo TEXT,
    circuito_nombre TEXT,
    consejo_codigo  TEXT,
    consejo_nombre  TEXT,
    observaciones   TEXT,
    creado_por      INTEGER REFERENCES usuarios(id),
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_por INTEGER REFERENCES usuarios(id),
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS ix_proyectos_comunales_codigo ON proyectos_comunales (codigo_dea);
  CREATE INDEX IF NOT EXISTS ix_proyectos_comunales_anio ON proyectos_comunales (anio);
  ALTER TABLE proyectos_comunales ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON proyectos_comunales FROM anon, authenticated;
END $$;
