-- 24_bricomiles_2025_lista_dotacion.sql
-- Deja BRICOMILES 2025 con los 17 planteles del archivo DOTACION_2025-2026 (la lista de 25 fue reducida):
--   S0532D1601, OD01861602, OD02981603, S0349D1604, S0618D1605, S3021D1606, S4705D1607, OD02001609, OD04831610,
--   OD05831611, OD05711612, OD02591613, S1739D1608, OD09671608, OD02321608, OD02281608, S1803D1608.
--   (En el archivo vienen dos códigos con error de tipeo: OD0591613 = OD02591613 «Escuela Chaimas» y S1739F1608 = S1739D1608 «Manola Luna Silva».)
--  * Vuelve a enlazar los que se habían desenlazado (con su planilla y su ingeniero de rehabilitación).
--  * Desenlaza los 14 que se agregaron con el script 23 y no están en la lista, SOLO si no tienen nada cargado
--    (sin materiales, sin adicionales, sin ingenieros de planilla y sin cerrar). Si alguno tiene datos, se salta y se avisa.
--  * OD02981603 (U.E. Valmore Rodríguez): ingeniero de rehabilitación LUZ ALBA FIGUERA, solo si no tenía uno asignado.
-- No borra nada. Ejecutar en UN solo bloque. Se puede repetir sin duplicar.

DO $$
DECLARE
  v_plan INTEGER;
  v_reenlazados INTEGER := 0;
  v_quitados INTEGER := 0;
  v_saltados INTEGER := 0;
  r RECORD;
  c TEXT;
  lista TEXT[] := ARRAY['S0532D1601','OD01861602','OD02981603','S0349D1604','S0618D1605','S3021D1606','S4705D1607','OD02001609',
                        'OD04831610','OD05831611','OD05711612','OD02591613','S1739D1608','OD09671608','OD02321608','OD02281608','S1803D1608'];
BEGIN
  SELECT id INTO v_plan FROM planes_atencion WHERE nombre = 'BRICOMILES 2025';
  IF v_plan IS NULL THEN
    RAISE EXCEPTION 'No existe el plan BRICOMILES 2025.';
  END IF;

  FOREACH c IN ARRAY lista LOOP
    IF EXISTS (SELECT 1 FROM plan_inspecciones WHERE plan_id = v_plan AND codigo_dea = c AND desenlazado_en IS NOT NULL) THEN
      IF EXISTS (SELECT 1 FROM plan_inspecciones WHERE plan_id <> v_plan AND codigo_dea = c AND desenlazado_en IS NULL AND ejecucion = 'EN_EJECUCION') THEN
        RAISE NOTICE 'Se salta % porque sigue en ejecución en otro plan.', c;
      ELSE
        UPDATE plan_inspecciones SET desenlazado_en = NULL, desenlazado_por = NULL, enlazado_en = NOW()
        WHERE plan_id = v_plan AND codigo_dea = c AND desenlazado_en IS NOT NULL;
        v_reenlazados := v_reenlazados + 1;
      END IF;
    ELSIF NOT EXISTS (SELECT 1 FROM plan_inspecciones WHERE plan_id = v_plan AND codigo_dea = c) THEN
      RAISE NOTICE 'El plantel % no estaba en el plan: agrégalo desde la pantalla de planes.', c;
    END IF;
  END LOOP;

  FOR r IN
    SELECT pi.inspeccion_id, pi.codigo_dea, pi.ejecucion, i.estado,
           (SELECT COUNT(*) FROM inspeccion_materiales m WHERE m.inspeccion_id = pi.inspeccion_id AND m.cantidad > 0) AS mats,
           (SELECT COUNT(*) FROM inspeccion_adicionales a WHERE a.inspeccion_id = pi.inspeccion_id) AS adic,
           (SELECT COUNT(*) FROM inspeccion_inspectores x WHERE x.inspeccion_id = pi.inspeccion_id) AS insp
    FROM plan_inspecciones pi JOIN inspecciones i ON i.id = pi.inspeccion_id
    WHERE pi.plan_id = v_plan AND pi.desenlazado_en IS NULL AND NOT (pi.codigo_dea = ANY (lista))
  LOOP
    IF r.mats = 0 AND r.adic = 0 AND r.insp = 0 AND r.estado = 'BORRADOR' AND r.ejecucion = 'EN_EJECUCION' THEN
      UPDATE plan_inspecciones SET desenlazado_en = NOW() WHERE plan_id = v_plan AND inspeccion_id = r.inspeccion_id;
      v_quitados := v_quitados + 1;
    ELSE
      v_saltados := v_saltados + 1;
      RAISE NOTICE 'Se deja % en el plan porque ya tiene datos cargados (revísalo a mano).', r.codigo_dea;
    END IF;
  END LOOP;

  UPDATE plan_inspecciones SET ingeniero_rehab = 'LUZ ALBA FIGUERA'
  WHERE plan_id = v_plan AND codigo_dea = 'OD02981603' AND desenlazado_en IS NULL AND (ingeniero_rehab IS NULL OR ingeniero_rehab = '');

  RAISE NOTICE 'Re-enlazados: %, desenlazados: %, dejados por tener datos: %', v_reenlazados, v_quitados, v_saltados;
END
$$;
