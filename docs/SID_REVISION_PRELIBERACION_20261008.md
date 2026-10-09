# SID-Educación Tech 2.0 — Revisión previa a liberación

**Fecha de revisión:** 2026-10-08  
**Repositorio:** `molinavictor-web/rac-sistema`  
**Rama evaluada:** `release/sid-supervision-tech2`  
**PR de trabajo:** https://github.com/molinavictor-web/rac-sistema/pull/1  
**CI verificado:** [GitHub Actions #81 — SUCCESS](https://github.com/molinavictor-web/rac-sistema/actions/runs/37783404688)  
**Decisión:** **NO APTO AÚN PARA DESPLIEGUE**. Continuar validaciones aisladas y revisión humana.

## 1. Alcance

- Diseño SID Tech 2.0 aplicado a las páginas del módulo Supervisión; RAC conserva su identidad visual y menú compartido.
- Acceso de `supervision` y `director` restringido a su módulo, con verificación de cuenta activa en las rutas de Supervisión.
- El director puede **consultar y registrar matrícula** de su propio plantel.
- Escritura transaccional de matrícula por nivel, agregación por plantel y conservación de períodos.
- Regresión automatizada de RAC con cinco roles ficticios, navegador Chromium y respuestas API simuladas.

## 2. Evidencia automatizada confirmada

| Evidencia | Estado | Límite de la evidencia |
| --- | --- | --- |
| Workflow #81: `preflight` | SUCCESS | Comprueba sintaxis, tests de comportamiento, interfaz y smoke en Chromium; API simulada en navegador |
| Workflow #81: `postgres-isolated` | SUCCESS | PostgreSQL 17 efímero, tablas sintéticas, no base Supabase |
| Endpoint HTTP real `POST /api/supervision/matricula-nivel/:codigoPlantel` | PASS en #81 | Router Express real + JWT + base de pruebas; no equivale a despliegue integrado del servidor completo |
| Regresión RAC en Chromium | PASS en #81 | Dashboard y consulta RAC en 375px, roles ficticios; no recorre todos los flujos RAC |
| Control de acceso y revocación de cuentas | PASS en suites automatizadas | Requiere contrastar contra estructura y datos reales de un clon aislado |
| Pruebas de rollback, histórico y agregación | PASS en #81 | Estructura de tablas simplificada |

## 3. Riesgos y tareas abiertas (bloqueantes)

1. **Esquema real sin restauración completa comprobada.** El respaldo `SIGE_respaldo_inicial.dump` fue inspeccionado históricamente, pero no se ha demostrado una restauración completa y pruebas contra ese esquema. No se debe conectar a la base productiva para suplir este paso.
2. **Migraciones no validadas.** La propuesta de permisos granulares en `feature/sige-permisos-fase1` no está ejecutada, ni se incluye como cambio aprobado en esta liberación. Revisar dependencias y ensayar exclusivamente en una base clonada y aislada.
3. **Integraciones externas no probadas de extremo a extremo.** GESCOLAR/Sheets, Drive/OAuth, generación de credenciales y flujos RAC no se han ejercitado con integraciones de prueba equivalentes a producción. Nunca leer ni registrar secretos de `configuracion`.
4. **Cobertura de RAC incompleta.** Chromium valida Dashboard/Consultar RAC y enlaces por rol, pero no exportación, cargas, alertas, credenciales, usuarios, planteles y directorio con sus operaciones completas.
5. **Validación numérica de matrícula por nivel.** La ruta acepta enteros JS sin verificar explícitamente rango de PostgreSQL `integer`; entradas mayores a `2147483647` provocan error SQL y HTTP 500 (el rollback sí se verifica). Antes de liberar, evaluar rechazo temprano HTTP 400 y límite de suma agregada, con pruebas negativas.
6. **Cambios de rol y alcance de sesión.** Se comprueba la revocación de `director` por cambio de plantel; completar pruebas de cambios de alcance territorial/rol de otras cuentas según matriz de permisos.
7. **Operación de liberación sin ensayo.** Falta procedimiento documentado de respaldo/restauración verificado, monitoreo, reversión y aceptación manual en entorno de staging. En este repositorio Render despliega automáticamente desde `main`: fusionar a `main` equivale a un despliegue.

## 4. Matriz mínima de aceptación antes de producción

| Criterio | Estado actual | Evidencia requerida |
| --- | --- | --- |
| CI de rama en verde | **Cumplido** (#81) | Nueva ejecución verde del commit candidato final |
| Pruebas HTTP y PostgreSQL aislado | **Parcial** | Completar cobertura de límites y esquema real |
| RAC sin regresiones | **Parcial** | Flujos críticos completos por rol, además de smoke visual |
| Restauración de respaldo | **Pendiente** | Restauración completa en PostgreSQL aislado con registro de resultado |
| Integraciones GESCOLAR/Drive/OAuth | **Pendiente** | Pruebas en entorno controlado sin secretos productivos expuestos |
| Plan de rollback y monitoreo | **Pendiente** | Procedimiento probado y responsables definidos |
| Revisión funcional del usuario | **Pendiente** | Aceptación explícita de resultados y limitaciones |
| Autorización para producción | **NO otorgada** | Autorización previa y explícita del usuario, después de pruebas satisfactorias |

## 5. Secuencia propuesta

1. Corregir validaciones de límites enteros y agregados de matrícula; ejecutar tests negativos en rama.
2. Ampliar regresión de RAC por módulos/roles y contrastar endpoints reales con la matriz de permisos.
3. Preparar y ensayar restauración del respaldo en PostgreSQL aislado, sin credenciales reales.
4. Verificar integraciones de prueba, seguridad de sesión, manejo de errores y compatibilidad.
5. Generar reporte de evidencia final, lista de cambios, plan de reversión y revisión con el usuario.
6. **Solo tras autorización expresa:** planificar ventana de despliegue; nunca hacer merge a `main` por iniciativa propia.

## 6. Reglas de seguridad

- No ejecutar SQL de modificación ni migraciones en Supabase productivo.
- No modificar configuración, servicios Render, datos ni integraciones productivas.
- No subir respaldos, claves ni tokens al repositorio.
- Todo avance se mantiene en `release/sid-supervision-tech2`.
- Distinguir siempre: **guardado**, **probado**, **desplegado**.

**Conclusión:** #81 acredita una base automatizada sólida para continuar la revisión; **no acredita todavía compatibilidad total con datos e integraciones productivas ni autoriza desplegar**.
