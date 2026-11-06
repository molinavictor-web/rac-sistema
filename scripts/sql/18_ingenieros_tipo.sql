-- 18_ingenieros_tipo.sql
-- Separa la lista oficial en dos grupos: INGENIERO (puede estar a cargo de un plantel) y APOYO
-- (personal en formación, administrativo o de sistemas: solo participa en equipos).
-- Ejecutar UNA vez en el SQL Editor de Supabase.

ALTER TABLE ingenieros_catalogo
  ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'INGENIERO' CHECK (tipo IN ('INGENIERO', 'APOYO'));

UPDATE ingenieros_catalogo SET tipo = 'APOYO' WHERE UPPER(nombre) = 'VICTOR MOLINA';
