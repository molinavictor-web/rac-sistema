-- 17_ingenieros_lista_equipo.sql
-- Lista oficial de ingenieros (nombres escritos una sola vez, para elegirlos y no teclearlos) y equipo
-- que participa en la inspección de cada plantel (independiente de la planilla).
-- Ejecutar UNA vez en el SQL Editor de Supabase.

CREATE TABLE IF NOT EXISTS ingenieros_catalogo (
  id         SERIAL PRIMARY KEY,
  nombre     TEXT NOT NULL,
  activo     BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS ingenieros_catalogo_nombre_uq ON ingenieros_catalogo (UPPER(nombre));

CREATE TABLE IF NOT EXISTS plantel_equipo (
  codigo_dea  TEXT NOT NULL,
  nombre      TEXT NOT NULL,
  creado_por  INTEGER REFERENCES usuarios(id),
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (codigo_dea, nombre)
);

INSERT INTO ingenieros_catalogo (nombre) VALUES
  ('JENNIFER VILLAHERMOSA'), ('JENYS DOMINGUEZ'), ('ENYLEDIS MOLINA'), ('LEURYS MORENO'),
  ('CARLES MORENO'), ('YRENE ALCALA'), ('JOSE DIAZ'), ('FRANYELIS RIVAS'), ('THALIA MARCANO'),
  ('LUIS COVA'), ('HERISMAR RODRIGUEZ'), ('NAILET GARCIA'), ('LUZ ALBA FIGUERA'),
  ('VICTOR MOLINA'), ('JESUS GIL'), ('MARIA RENGIFO'), ('MARIEL TALIS'), ('ISVELYS MARCANO')
ON CONFLICT DO NOTHING;

ALTER TABLE ingenieros_catalogo ENABLE ROW LEVEL SECURITY;
ALTER TABLE plantel_equipo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ingenieros_catalogo FROM anon, authenticated;
REVOKE ALL ON plantel_equipo FROM anon, authenticated;
