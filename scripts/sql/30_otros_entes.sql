-- 30_otros_entes.sql
-- Atenciones de OTROS ENTES (Gobernación, alcaldías, ministerios, SENIAT, FANB…) a los planteles.
--   entes_atencion          catálogo editable de entes, por categoría (FEDE NO va aquí: es el sistema actual).
--   atenciones_otros_entes  cada atención: plantel + ente + año (+ mes opcional) + qué se hizo.
-- Un plantel atendido por varios entes (o por FEDE y otro ente) queda con TODAS sus atenciones en el historial,
-- pero cuenta UNA sola vez en el total de «Planteles atendidos».
-- Ejecutar UNA vez en Supabase (debe responder «Success. No rows returned»).
DO $$
BEGIN
  CREATE TABLE IF NOT EXISTS entes_atencion (
    id           SERIAL PRIMARY KEY,
    categoria    TEXT NOT NULL CHECK (categoria IN ('GOBERNACION', 'ALCALDIA', 'MINISTERIO', 'INSTITUTO', 'FANB', 'OTRO')),
    nombre       TEXT NOT NULL,
    municipio    TEXT,                          -- solo para alcaldías
    activo       BOOLEAN NOT NULL DEFAULT TRUE,
    creado_por   INTEGER REFERENCES usuarios(id),
    creado_en    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS ux_entes_atencion_nombre ON entes_atencion (lower(nombre));

  CREATE TABLE IF NOT EXISTS atenciones_otros_entes (
    id              SERIAL PRIMARY KEY,
    codigo_dea      TEXT NOT NULL,
    ente_id         INTEGER NOT NULL REFERENCES entes_atencion(id),
    anio            INTEGER NOT NULL CHECK (anio BETWEEN 2000 AND 2100),
    mes             INTEGER CHECK (mes BETWEEN 1 AND 12),
    descripcion     TEXT,
    creado_por      INTEGER REFERENCES usuarios(id),
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_por INTEGER REFERENCES usuarios(id),
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS ix_atenciones_otros_entes_dea ON atenciones_otros_entes (codigo_dea);
  CREATE INDEX IF NOT EXISTS ix_atenciones_otros_entes_ente ON atenciones_otros_entes (ente_id);
  CREATE INDEX IF NOT EXISTS ix_atenciones_otros_entes_anio ON atenciones_otros_entes (anio);

  ALTER TABLE entes_atencion ENABLE ROW LEVEL SECURITY;
  ALTER TABLE atenciones_otros_entes ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON entes_atencion FROM anon, authenticated;
  REVOKE ALL ON atenciones_otros_entes FROM anon, authenticated;

  -- Semilla (editable desde la pantalla): solo si el catálogo está vacío.
  IF NOT EXISTS (SELECT 1 FROM entes_atencion) THEN
    INSERT INTO entes_atencion (categoria, nombre, municipio) VALUES
      ('GOBERNACION', 'Gobernación del estado Monagas', NULL),
      ('FANB', 'FANB (Fuerza Armada Nacional Bolivariana)', NULL),
      ('MINISTERIO', 'Ministerio de Obras Públicas', NULL),
      ('INSTITUTO', 'SENIAT', NULL),
      ('ALCALDIA', 'Alcaldía de Acosta', 'ACOSTA'),
      ('ALCALDIA', 'Alcaldía de Aguasay', 'AGUASAY'),
      ('ALCALDIA', 'Alcaldía de Bolívar', 'BOLÍVAR'),
      ('ALCALDIA', 'Alcaldía de Caripe', 'CARIPE'),
      ('ALCALDIA', 'Alcaldía de Cedeño', 'CEDEÑO'),
      ('ALCALDIA', 'Alcaldía de Ezequiel Zamora', 'EZEQUIEL ZAMORA'),
      ('ALCALDIA', 'Alcaldía de Libertador', 'LIBERTADOR'),
      ('ALCALDIA', 'Alcaldía de Maturín', 'MATURÍN'),
      ('ALCALDIA', 'Alcaldía de Piar', 'PIAR'),
      ('ALCALDIA', 'Alcaldía de Punceres', 'PUNCERES'),
      ('ALCALDIA', 'Alcaldía de Santa Bárbara', 'SANTA BÁRBARA'),
      ('ALCALDIA', 'Alcaldía de Sotillo', 'SOTILLO'),
      ('ALCALDIA', 'Alcaldía de Uracoa', 'URACOA');
  END IF;
END $$;
