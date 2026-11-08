-- 26_dotaciones.sql
-- Solicitudes de dotación (mobiliario y cocina, CBIT, mantenimiento) por plan y plantel.
--   dotacion_rubros : catálogo editable de rubros (unión de las dos hojas de FEDE), con su bloque y unidad.
--   dotaciones      : una solicitud por plantel dentro de un plan (el plantel puede o no estar rehabilitado).
--   dotacion_items  : cantidad de cada rubro en cada solicitud (vacío = no se pide; es_no = "NO" explícito).
-- Ejecutar UNA vez en el SQL Editor de Supabase, ANTES de publicar el cambio. Debe responder "Success. No rows returned".

CREATE TABLE IF NOT EXISTS dotacion_rubros (
  id             SERIAL PRIMARY KEY,
  bloque         TEXT NOT NULL CHECK (bloque IN ('MOBILIARIO_COCINA', 'CBIT', 'MANTENIMIENTO')),
  nombre         TEXT NOT NULL,
  unidad         TEXT NOT NULL DEFAULT 'UNIDAD',
  orden          INTEGER NOT NULL DEFAULT 0,
  activo         BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS dotacion_rubros_nombre_uq ON dotacion_rubros (bloque, lower(nombre)) WHERE activo;

CREATE TABLE IF NOT EXISTS dotaciones (
  id             SERIAL PRIMARY KEY,
  plan_id        INTEGER NOT NULL REFERENCES planes_atencion(id) ON DELETE CASCADE,
  codigo_dea     TEXT NOT NULL,
  inspeccion_id  INTEGER REFERENCES inspecciones(id) ON DELETE SET NULL,
  fecha          DATE,
  datos          JSONB NOT NULL DEFAULT '{}'::jsonb,
  observaciones  TEXT,
  creado_por     INTEGER,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_por INTEGER,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (plan_id, codigo_dea)
);

CREATE TABLE IF NOT EXISTS dotacion_items (
  dotacion_id INTEGER NOT NULL REFERENCES dotaciones(id) ON DELETE CASCADE,
  rubro_id    INTEGER NOT NULL REFERENCES dotacion_rubros(id),
  cantidad    NUMERIC(12,3) CHECK (cantidad IS NULL OR cantidad >= 0),
  es_no       BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (dotacion_id, rubro_id)
);

ALTER TABLE dotacion_rubros ENABLE ROW LEVEL SECURITY;
ALTER TABLE dotaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE dotacion_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dotacion_rubros, dotaciones, dotacion_items FROM anon, authenticated;
REVOKE ALL ON SEQUENCE dotacion_rubros_id_seq, dotaciones_id_seq FROM anon, authenticated;

-- Rubros iniciales (solo si el catálogo está vacío): los de las dos hojas del formato de FEDE.
INSERT INTO dotacion_rubros (bloque, nombre, unidad, orden)
SELECT v.bloque, v.nombre, v.unidad, v.orden
FROM (VALUES
  ('MOBILIARIO_COCINA', 'Mesas sillas para aulas', 'KIT', 1),
  ('MOBILIARIO_COCINA', 'Mesas sillas para comedor', 'UNIDAD', 2),
  ('MOBILIARIO_COCINA', 'Pizarras acrílicas 2,00 x 1,00 mts.', 'UNIDAD', 3),
  ('MOBILIARIO_COCINA', 'Pizarras acrílicas pequeñas', 'UNIDAD', 4),
  ('MOBILIARIO_COCINA', 'Carteleras grandes', 'UNIDAD', 5),
  ('MOBILIARIO_COCINA', 'Escritorio', 'UNIDAD', 6),
  ('MOBILIARIO_COCINA', 'Sillas T-6', 'UNIDAD', 7),
  ('MOBILIARIO_COCINA', 'Aulas didácticas', 'KIT', 8),
  ('MOBILIARIO_COCINA', 'Papeleras', 'UNIDAD', 9),
  ('MOBILIARIO_COCINA', 'Jabón líquido con dispensador', 'UNIDAD', 10),
  ('MOBILIARIO_COCINA', 'Papel higiénico', 'ROLLO', 11),
  ('MOBILIARIO_COCINA', 'Archivadores 4 gavetas', 'UNIDAD', 12),
  ('MOBILIARIO_COCINA', 'Estantes esqueléticos', 'UNIDAD', 13),
  ('MOBILIARIO_COCINA', 'Escaparate metálico de 2 puertas', 'UNIDAD', 14),
  ('MOBILIARIO_COCINA', 'Kit de laboratorios', 'KIT', 15),
  ('MOBILIARIO_COCINA', 'Mesón para comedor', 'UNIDAD', 16),
  ('MOBILIARIO_COCINA', 'Taburetes', 'UNIDAD', 17),
  ('MOBILIARIO_COCINA', 'Mesón para sala de profesores', 'UNIDAD', 18),
  ('MOBILIARIO_COCINA', 'Sillas para sala de profesores', 'UNIDAD', 19),
  ('MOBILIARIO_COCINA', 'Ventiladores', 'UNIDAD', 20),
  ('MOBILIARIO_COCINA', 'Kit deportivo', 'KIT', 21),
  ('MOBILIARIO_COCINA', 'Congelador', 'UNIDAD', 22),
  ('MOBILIARIO_COCINA', 'Nevera', 'UNIDAD', 23),
  ('MOBILIARIO_COCINA', 'Delantal de cocina', 'UNIDAD', 24),
  ('MOBILIARIO_COCINA', 'Cocina industrial', 'UNIDAD', 25),
  ('MOBILIARIO_COCINA', 'Menajería (bandeja, escudilla, vaso, cubiertos)', 'KIT', 26),
  ('MOBILIARIO_COCINA', 'Licuadora industrial', 'UNIDAD', 27),
  ('MOBILIARIO_COCINA', 'Olla de presión industrial (marmita)', 'UNIDAD', 28),
  ('MOBILIARIO_COCINA', 'Kit de ollas', 'KIT', 29),
  ('MOBILIARIO_COCINA', 'Utensilios de cocina', 'KIT', 30),
  ('MOBILIARIO_COCINA', 'Filtro de agua en acero inoxidable', 'UNIDAD', 31),
  ('MOBILIARIO_COCINA', 'Enfriador de agua de botellón (incluye 1 botellón)', 'UNIDAD', 32),
  ('MOBILIARIO_COCINA', 'Kit huerto escolar', 'KIT', 33),
  ('CBIT', 'Computadoras para CBIT', 'UNIDAD', 1),
  ('CBIT', 'Escritorios', 'UNIDAD', 2),
  ('CBIT', 'Sillas', 'UNIDAD', 3),
  ('CBIT', 'Computadoras para oficina', 'UNIDAD', 4),
  ('CBIT', 'Impresoras', 'UNIDAD', 5),
  ('CBIT', 'Fotocopiadoras', 'UNIDAD', 6),
  ('CBIT', 'U.P.S.', 'UNIDAD', 7),
  ('CBIT', 'Material de oficina', 'KIT', 8),
  ('CBIT', 'Guillotina', 'UNIDAD', 9),
  ('MANTENIMIENTO', 'Kit de artículos para limpieza', 'KIT', 1)
) AS v(bloque, nombre, unidad, orden)
WHERE NOT EXISTS (SELECT 1 FROM dotacion_rubros);
