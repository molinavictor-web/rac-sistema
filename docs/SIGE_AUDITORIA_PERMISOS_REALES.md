# SIGE — Auditoría de permisos reales (fase 1)

Estado: revisión estática de rutas de la rama feature/sige-permisos-fase1. **No aplicar aún como política de producción.**

## Hallazgos verificados
- `src/middleware/auth.js`: `supervision` y `director` solo pueden entrar a `/api/supervision` y `/api/auth` en rutas protegidas; `requireMismoPlantel` limita al director a `codigo_plantel`, mientras `admin` y `supervision` están exentos; `requireMismoMunicipio` compara `municipio_id` para roles no exentos.
- `src/routes/rac.js`: GET `/` y `/verificar-nomina` exigen autenticación; POST y PATCH principales admiten `admin`/`operador`; DELETE `/:id` solo `admin`. **Revisar además filtrado municipal en backend:** comentario de GET indica filtrado en frontend/consulta, no control territorial garantizado por middleware.
- `src/routes/supervision.js`: `ROLES_SUPERVISION=['admin','supervision']`; `ROLES_SUPERVISION_Y_DIRECTOR` añade `director` solo en endpoints puntuales protegidos por `requireMismoPlantel`, incluidos flujos de matrícula y niveles.
- `src/routes/plantelesConsulta.js`: `ROLES_CONSULTA_PLANTELES=['admin','operador_plantel']`; consulta GESCOLAR, coordenadas y archivos; GET/POST usan el mismo guard de rol, sin permisos separados de lectura/escritura. OAuth Drive de administración solo admin, excepto callback con su flujo específico.
- `src/routes/credenciales.js`: `ROLES_CREDENCIALES=['admin','operador','operador_credenciales']` para buscar, generar, pendientes y aprobar; listar todas y borrar solo admin.
- `src/routes/usuarios.js`: POST, GET, PATCH y cambio de estado protegidos con `requireRol('admin')`.

## Diferencias con catálogo SIGE preliminar
1. `rac.operar` no diferencia crear, modificar, eliminar, ni flujos de credenciales.
2. `supervision.ver` no expresa permisos de director para escribir datos específicos de su plantel.
3. `fede.operar` no diferencia coordenadas, refresco, archivos ni administración OAuth.
4. La autorización por módulo no debe reemplazar las restricciones por municipio/plantel.
5. Los roles múltiples no pueden activarse solamente añadiendo `usuario.roles`: `requireAuth` y `requireRol` actuales verifican el rol legado y existe bloqueo global para supervisión/director.
6. El comentario de GET `/api/rac` merece auditoría de exposición de datos por municipio antes de activar la nueva política.

## Propuesta para la siguiente etapa (NO APROBADA)
- Catálogo de permisos granulares por operación y recurso; preservar controles de alcance municipal/plantel.
- Separar credenciales de permisos RAC; incluir usuarios, auditoría y operaciones administrativas.
- Definir precedencia de roles múltiples y qué hacer con cuentas desactivadas.
- Crear pruebas de denegación y acceso por rol, ruta y ámbito, con énfasis en director ajeno, encargado municipal ajeno y usuarios de Supervisión fuera de su módulo.
- No conectar `requirePermiso` a rutas reales hasta que se apruebe matriz, se resuelvan controles de alcance y se pruebe en base aislada.

## Estado de seguridad
Auditoría documental únicamente. Sin ejecución SQL, sin cambio de roles, JWT, rutas ni datos de producción.
