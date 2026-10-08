# SID — Ejecución de revisión preliberación: pasos 2 a 5
Fecha: 2026-10-08. Rama: `release/sid-supervision-tech2`. **Sin autorización de producción**.

## Paso 2 — Regresión RAC: inventario y cobertura
Rutas montadas en `src/server.js`: `/api/rac`, `/api/usuarios`, `/api/cargas`, `/api/alertas`, `/api/planteles`, `/api/personal-ministerio`, `/api/mantenimiento`, `/api/credenciales`, `/api/mapeo-codigos-plantel`, `/api/planteles-consulta`, `/api/directorio-directores` y `/api/supervision`. El servidor también sirve archivos públicos y `/api/health`.

| Módulo | Cobertura verificada | Prueba de aceptación aún necesaria |
| --- | --- | --- |
| Dashboard / Consultar RAC | Chromium 375px con cinco roles ficticios; navegación y consulta vacía | CRUD RAC, búsquedas reales y casos de error con BD clonada |
| Alertas | Test de roles y pantalla de Supervisión | Ciclo crear/revisar/cerrar en entorno aislado |
| Cargas / Exportaciones | No E2E acreditado | Archivos sintéticos, permisos y verificación de integridad |
| Planteles / Directorio | Menú por rol en Chromium | Consultas reales simuladas de GESCOLAR/Drive y límites territoriales |
| Credenciales | Menú por rol en Chromium | Generar/aprobar con datos sintéticos y roles correspondientes |
| Usuarios | Menú por rol en Chromium | Alta, desactivación, cambio de rol y revocación |
| Supervisión / Matrícula | Tests HTTP + PostgreSQL 17 sintético | Esquema real restaurado y agregado sin desbordamiento |

**Estado del paso 2:** inventario registrado; regresión funcional completa **pendiente**. No inferir cobertura por la existencia de rutas.

## Paso 3 — Restauración aislada del respaldo
**Estado: pendiente de ejecución.** La existencia de un respaldo inspeccionado NO acredita que restaure. No se dispone en esta ejecución de una restauración completa comprobada.

Procedimiento de ensayo propuesto:
1. Identificar el respaldo local `SIGE_respaldo_inicial.dump` en un entorno privado; nunca subirlo a GitHub, logs o artefactos públicos.
2. Levantar PostgreSQL aislado, sin conectividad ni credenciales de producción; crear BD nueva vacía.
3. Verificar versión/formato con `pg_restore --list` en equipo controlado. Evitar volcar datos o secretos en consola.
4. Restaurar con `pg_restore --no-owner --no-acl --dbname=<BD_AISLADA> <RESPALDO_LOCAL>`; registrar código de salida y errores **sin contenido sensible**.
5. Comprobar solo metadatos y estructura de tablas/índices/constraints necesarios; nunca inspeccionar valores secretos de `configuracion`.
6. Ejecutar pruebas HTTP contra la BD aislada con registros sintéticos; documentar incompatibilidades y repetir tras corrección.

**No ejecutar en Supabase productivo.** Requiere acceso seguro al respaldo y entorno de restauración aislado.

## Paso 4 — Integraciones
`src/server.js` monta `/api/planteles-consulta` y `/api/credenciales`; el proyecto depende de `googleapis`. Matriz mínima:

| Integración | Prueba aislada requerida | Riesgo |
| --- | --- | --- |
| Sheets / GESCOLAR | Lectura con hoja ficticia y búsqueda DEA | Esquema de columnas, cuotas, latencia |
| Drive (lectura) | Enumerar carpetas ficticias por DEA | Permisos de cuenta de servicio |
| Drive (escritura OAuth) | Subida a carpeta de ensayo con token de prueba | Token revocado, permisos, límite de archivo |
| Credenciales | Generación/aprobación con identidades sintéticas | Privilegios, duplicados y trazabilidad |
| Render / variables | Verificación documental de nombres y dependencias sin leer valores | Configuración y secretos |

**Estado del paso 4:** matriz registrada; pruebas contra proveedores **no realizadas**. Nunca consultar ni mostrar valores OAuth almacenados en `configuracion`.

## Paso 5 — Puerta de liberación y reversión
**Decisión actual: NO-GO.** La ejecución #81 estaba verde antes de los cambios de validación de matrícula. Todo commit posterior requiere CI propio satisfactorio.

Condiciones obligatorias:
- [ ] Último commit candidato con preflight y PostgreSQL aislado en SUCCESS.
- [ ] Corregir respuesta 500 en suma agregada de matrícula por nivel; agregar test negativo de 400 sin escritura parcial.
- [ ] Completar regresiones de operaciones críticas RAC.
- [ ] Restauración del respaldo verificada y compatibilidad del esquema real comprobada.
- [ ] Integraciones probadas con servicios de ensayo y sin secretos expuestos.
- [ ] Plan de monitoreo, respaldo y reversión ensayado.
- [ ] Revisión funcional del usuario y **autorización explícita previa**.

**Regla de despliegue:** Render realiza auto-deploy desde `main`. **Fusionar a `main` despliega**; no hacerlo sin aprobación previa. No cambiar producción, migrar ni alterar datos por iniciativa propia.

Plan de reversión a validar antes de cualquier despliegue: documentar SHA anterior, comprobar disponibilidad de respaldo restaurable, definir criterio de interrupción, método de revertir commit/imagen y verificación posterior de rutas críticas; ninguna reversión debe ejecutarse en producción sin coordinación/autorización.

## Registro de avance
- Paso 1: validación de rango `int4` guardada en rama; CI y control del total agregado pendientes.
- Paso 2: inventario y brechas documentados, no E2E completo.
- Paso 3: procedimiento de restauración documentado, no ejecutado.
- Paso 4: matriz de pruebas documentada, no ejecutada.
- Paso 5: puerta NO-GO y condiciones documentadas, sin despliegue.

No declarar “probado” lo que solo esté “planificado” o “documentado”.
