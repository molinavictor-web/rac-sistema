# SIGE — Fase 1: permisos (migración preparada)

Esta rama no ejecuta cambios sobre la base de datos de producción.

## Secuencia segura
1. Realizar respaldo de Supabase y comprobar que se puede restaurar.
2. Revisar el esquema real de `usuarios` y sus claves primarias.
3. Ejecutar `sql/20261007_sige_roles_permisos.sql` **en una base de pruebas**, no `npm run migrate`: ese comando aplica el esquema histórico completo.
4. Verificar que cada usuario existente tenga una asignación en `sige_usuario_roles` y que el número de usuarios no cambie.
5. Ejecutar `npm run test:permissions` en un entorno Node >=18.
6. Antes de usar permisos en rutas reales, incorporar resolución desde BD, revocación y validación de cuentas activas en cada petición.

## Compatibilidad y límites
- Se mantiene `usuarios.rol` como rol legado. No se cambian JWT, login ni rutas existentes.
- Los permisos actuales son **preliminares y de módulo**, no equivalen a autorizaciones granulares para credenciales, municipios, edición de planteles, etc.
- `requirePermiso` todavía no está conectado a las rutas; no usarlo como sustituto inmediato de `requireRol`, `requireMismoMunicipio` ni `requireMismoPlantel`.
- Los registros en tablas SIGE no se consultan todavía en autenticación. La asignación múltiple aún no es operativa.
- El esquema emplea `usuarios.id` tipo INTEGER, según el esquema existente; verificar antes de ejecutar.
