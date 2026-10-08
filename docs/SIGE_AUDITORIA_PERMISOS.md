# SIGE — Auditoría de permisos reales (Fase 1)

Estado: **inventario del código**, no política definitiva ni autorización para desplegar. Rama: `feature/sige-permisos-fase1`. No se modificaron rutas, tokens ni base de datos.

## Hallazgos confirmados

### RAC
- `src/routes/rac.js`: consultas GET raíz y verificación de nómina usan `requireAuth`; crear y editar restringidos a `operador/admin`; eliminar solo `admin`.
- `src/routes/planteles.js`: consulta autenticada; alta/edición `admin/operador`; eliminación y carga masiva `admin`.
- `src/routes/credenciales.js`: búsqueda, generación, pendientes y aprobación permiten `admin/operador/operador_credenciales`; listado total y eliminación solo `admin`.
- `src/routes/usuarios.js`: administración solo `admin`.
- `src/routes/cargas.js`: carga usa `requireMismoMunicipio`; la lectura de alertas de carga usa `requireAuth`. No reemplazar controles de alcance territorial.
- `src/routes/alertas.js`: lectura autenticada; exportar y actualizar `admin/operador`.

### Supervisión
- `src/routes/supervision.js`: operaciones generales y administración de supervisores, circuitos y directores requieren `admin/supervision`.
- Director participa en endpoints concretos de consulta y carga de matrícula; requieren además `requireMismoPlantel`.
- `src/middleware/auth.js` limita el acceso general de `supervision/director` a rutas autorizadas. Mantener este límite mientras se diseña un control equivalente.

### Planteles FEDE
- `src/routes/plantelesConsulta.js`: `admin/operador_plantel` pueden consultar, editar coordenadas, refrescar, listar/subir/descargar archivos y subir fachada; OAuth administrativo solo `admin`.
- `src/routes/directorioDirectores.js`: `admin/operador_plantel/operador` pueden consultar y modificar datos del directorio.

## Riesgos antes de activar el nuevo middleware
1. `rac.operar` y `fede.operar` agrupan operaciones con autorizaciones diferentes (incluidas eliminaciones, credenciales y archivos).
2. `director` no es solo lectura: puede operar matrícula exclusivamente en su propio plantel.
3. `encargado_municipio` no equivale a `operador` global: preservar `requireMismoMunicipio` y revisar rutas de consulta.
4. El middleware `requirePermiso` actual lee roles estáticos, no los roles persistidos en BD; no conectarlo a endpoints todavía.
5. La comprobación de `requireAuth` y los endpoints no examinados exhaustivamente deben cubrirse con pruebas negativas antes del despliegue.

## Catálogo granular propuesto (pendiente de validación)
- RAC: `rac.consultar`, `rac.crear`, `rac.editar`, `rac.eliminar`, `rac.exportar`, `rac.cargar`, `rac.credenciales.generar`, `rac.credenciales.aprobar`, `rac.credenciales.eliminar`.
- Supervisión: `supervision.consultar`, `supervision.planteles.editar`, `supervision.supervisores.administrar`, `supervision.circuitos.administrar`, `supervision.directores.administrar`, `supervision.matricula.consultar`, `supervision.matricula.registrar`.
- FEDE: `fede.consultar`, `fede.coordenadas.editar`, `fede.archivos.consultar`, `fede.archivos.subir`, `fede.fachada.subir`, `fede.directorio.editar`, `fede.cache.refrescar`, `fede.oauth.administrar`.
- Transversal: `usuarios.administrar`.

**Regla fundamental:** un permiso de acción NO elimina controles de alcance por municipio/plantel ni validación de cuenta activa. La matriz rol→permiso será validada antes de codificarse.

## Próximos pasos
1. Completar inventario de rutas auxiliares y revisar las reglas de alcance.
2. Proponer matriz rol×acción preservando exactamente autorizaciones vigentes; identificar accesos amplios existentes para revisión humana.
3. Ampliar pruebas con casos de denegación, cruce de municipios/planteles, usuarios inactivos y combinaciones de roles.
4. Crear base de pruebas aislada y restaurar de manera controlada solo objetos propios de la aplicación; no sobrescribir esquemas administrados por Supabase.
