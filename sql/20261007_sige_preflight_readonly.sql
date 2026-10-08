-- SIGE Fase 1 — diagnóstico de compatibilidad, SOLO LECTURA.
-- Ejecutar en SQL Editor o entorno de pruebas. No crea ni modifica objetos.
SELECT rol, COUNT(*) AS usuarios
FROM public.usuarios
GROUP BY rol
ORDER BY rol;

SELECT u.rol, COUNT(*) AS usuarios_sin_rol_catalogado
FROM public.usuarios u
WHERE u.rol NOT IN (
  'admin','operador','encargado_municipio','operador_credenciales',
  'operador_plantel','supervision','director'
)
GROUP BY u.rol;

SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema='public' AND table_name='usuarios'
  AND column_name IN ('id','rol','activo','municipio_id','codigo_plantel')
ORDER BY column_name;

SELECT table_name
FROM information_schema.tables
WHERE table_schema='public'
  AND table_name IN ('sige_roles','sige_permisos','sige_rol_permisos','sige_usuario_roles')
ORDER BY table_name;

-- Esta consulta no inspecciona contraseñas, tokens ni configuraciones secretas.
