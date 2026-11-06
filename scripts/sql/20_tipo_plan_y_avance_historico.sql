-- 20_tipo_plan_y_avance_historico.sql
-- Tipo de plan de atención (Bricomiles, Gotas de Amor, Escuelas vandalizadas, Atención especial)
-- y avance (%) que tenía un plantel al cerrarse, para cargar planes históricos.
-- Ejecutar UNA vez en el SQL Editor de Supabase, ANTES de publicar el cambio.
-- Los planes que ya existen quedan como "BRICOMILES"; se cambia desde el plan con «Editar nombre».

ALTER TABLE planes_atencion
  ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'BRICOMILES'
    CHECK (tipo IN ('BRICOMILES', 'GOTAS_DE_AMOR', 'ESCUELAS_VANDALIZADAS', 'ATENCION_ESPECIAL'));

ALTER TABLE plan_inspecciones
  ADD COLUMN IF NOT EXISTS avance_historico NUMERIC(5,2) CHECK (avance_historico IS NULL OR (avance_historico >= 0 AND avance_historico <= 100));
