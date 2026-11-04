-- seguridad_supabase.sql (antes 11_seguridad_supabase.sql)
-- Cierra el acceso público (llave anon / authenticated de la API de Supabase) a las vistas y tablas del
-- módulo Inspecciones y a la vista del mapa de Supervisión. El sistema NO se ve afectado: se conecta
-- directo a Postgres con el usuario dueño (postgres), que no pasa por la API ni por RLS.
-- Se puede volver a correr sin problema. Pegar y ejecutar en UN solo bloque en el SQL Editor.

DO $$
DECLARE
  v text;
  t text;
BEGIN
  -- 1) Vistas: que usen los permisos de quien consulta y que anon/authenticated no puedan leerlas.
  FOREACH v IN ARRAY ARRAY['v_consolidado_oficial','v_consolidado_adicionales','v_mapa_supervision'] LOOP
    IF to_regclass('public.' || v) IS NOT NULL THEN
      EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', v);
      EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', v);
    END IF;
  END LOOP;

  -- 2) Tablas del módulo Inspecciones: activar RLS (sin políticas = la API pública no ve nada).
  FOREACH t IN ARRAY ARRAY['catalogo_materiales','planes_atencion','inspecciones','inspeccion_inspectores',
                           'plan_inspecciones','inspeccion_materiales','adicionales_catalogo','adicional_alias',
                           'inspeccion_adicionales','iu_visitas','iu_edificio_miembros','iu_consultas','iu_valores','iu_cambios'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    END IF;
  END LOOP;
END $$;
