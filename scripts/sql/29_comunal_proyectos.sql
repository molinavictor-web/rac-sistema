-- 29_comunal_proyectos.sql
-- Proyectos comunales, versión por COMUNA / CIRCUITO COMUNAL: el proyecto pertenece a una comuna (código y nombre,
-- datos obligatorios), lleva año, fecha de la consulta (elección) y nombre; el número (1.ª, 2.ª, 3.ª) se calcula por
-- comuna. Debajo va la lista de planteles que atiende (cada uno «POR_ATENDER» o «ATENDIDO»).
-- Si existía la tabla del script 28 (un plantel por fila), sus filas con circuito se pasan a la nueva forma
-- (un proyecto por fila, con ese plantel en estado POR_ATENDER); la tabla vieja NO se borra (queda de respaldo).
-- Ejecutar UNA vez en Supabase (debe responder «Success. No rows returned»).
DO $$
DECLARE
  existia BOOLEAN := to_regclass('public.comunal_proyectos') IS NOT NULL;
  r RECORD;
  nuevo INTEGER;
BEGIN
  CREATE TABLE IF NOT EXISTS comunal_proyectos (
    id              SERIAL PRIMARY KEY,
    circuito_codigo TEXT NOT NULL,
    circuito_nombre TEXT NOT NULL,
    anio            INTEGER NOT NULL CHECK (anio BETWEEN 2000 AND 2100),
    fecha_consulta  DATE,
    nombre_proyecto TEXT NOT NULL,
    observaciones   TEXT,
    creado_por      INTEGER REFERENCES usuarios(id),
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_por INTEGER REFERENCES usuarios(id),
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS ix_comunal_proyectos_circuito ON comunal_proyectos (circuito_codigo);
  CREATE INDEX IF NOT EXISTS ix_comunal_proyectos_anio ON comunal_proyectos (anio);
  CREATE TABLE IF NOT EXISTS comunal_proyecto_planteles (
    proyecto_id INTEGER NOT NULL REFERENCES comunal_proyectos(id) ON DELETE CASCADE,
    codigo_dea  TEXT NOT NULL,
    estado      TEXT NOT NULL DEFAULT 'POR_ATENDER' CHECK (estado IN ('POR_ATENDER', 'ATENDIDO')),
    PRIMARY KEY (proyecto_id, codigo_dea)
  );
  CREATE INDEX IF NOT EXISTS ix_comunal_proyecto_planteles_dea ON comunal_proyecto_planteles (codigo_dea);
  ALTER TABLE comunal_proyectos ENABLE ROW LEVEL SECURITY;
  ALTER TABLE comunal_proyecto_planteles ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON comunal_proyectos FROM anon, authenticated;
  REVOKE ALL ON comunal_proyecto_planteles FROM anon, authenticated;

  IF NOT existia AND to_regclass('public.proyectos_comunales') IS NOT NULL THEN
    FOR r IN EXECUTE 'SELECT * FROM proyectos_comunales WHERE COALESCE(circuito_nombre, '''') <> '''' ORDER BY id' LOOP
      INSERT INTO comunal_proyectos (circuito_codigo, circuito_nombre, anio, nombre_proyecto, observaciones, creado_por, actualizado_por)
      VALUES (COALESCE(NULLIF(r.circuito_codigo, ''), r.circuito_nombre), r.circuito_nombre, r.anio, r.nombre_proyecto, r.observaciones, r.creado_por, r.actualizado_por)
      RETURNING id INTO nuevo;
      INSERT INTO comunal_proyecto_planteles (proyecto_id, codigo_dea, estado) VALUES (nuevo, r.codigo_dea, 'POR_ATENDER');
    END LOOP;
  END IF;
END $$;
