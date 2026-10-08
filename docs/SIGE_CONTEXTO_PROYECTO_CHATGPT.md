# Contexto maestro — Proyecto ChatGPT SIGE

## Identidad y propósito
**SIGE — Sistema Integrado de Gestión Educativa**, evolución del sistema RAC Monagas para integrar tres módulos: RAC, Supervisión Educativa y Planteles FEDE. Repositorio: https://github.com/molinavictor-web/rac-sistema. Aplicación existente: Node.js/Express, HTML/JavaScript, PostgreSQL Supabase, despliegue Render, Google Sheets/Drive.

## Norma irrenunciable
**Ningún cambio en producción sin pruebas satisfactorias y autorización previa y explícita del usuario.** No desplegar, fusionar a main, ejecutar migraciones, editar datos o cambiar configuraciones productivas por iniciativa propia. Usar rama `feature/sige-permisos-fase1` y entorno aislado para pruebas.

## Estado de trabajo (7 octubre 2026)
- La rama de desarrollo contiene `src/core/permissions.js`, `tests/permissions.test.js`, `tests/permissions.granular.test.js`, documentación SIGE y workflow GitHub Actions.
- El catálogo contiene permisos granulares propuestos, pero no asignados a roles ni conectados a las rutas actuales. `requirePermiso` es preparatorio, no producción.
- `sql/20261007_sige_roles_permisos.sql` es una propuesta NO EJECUTADA; no ejecutar hasta validar matriz y base aislada.
- `sql/20261007_sige_preflight_readonly.sql` es diagnóstico de solo lectura.
- La auditoría inicial está en `docs/SIGE_AUDITORIA_PERMISOS.md`.
- El README describe SIGE y advierte sobre procedimientos históricos.
- GitHub Actions configurado; consultar ejecución real antes de declarar CI exitoso.
- Existe respaldo local `SIGE_respaldo_inicial.dump` inspeccionado; restauración completa NO verificada. No subir respaldos ni secretos a GitHub.

## Hallazgos que deben preservarse
- `director` puede registrar matrícula en su propio plantel, no solo consultar.
- `encargado_municipio` tiene alcance territorial; no equivale a operador global.
- `operador_credenciales` puede generar y aprobar credenciales.
- `operador_plantel` administra funciones de GESCOLAR/Drive sujetas a roles actuales.
- El rol `operador` también participa en directorio de directores.
- `requireAuth` bloquea a `supervision` y `director` fuera de sus rutas permitidas; `requireMismoMunicipio` y `requireMismoPlantel` siguen siendo necesarios.
- La tabla `configuracion` almacena credenciales OAuth: no consultar, copiar, mostrar ni registrar secretos.

## Próximo trabajo
1. Confirmar estado del workflow en GitHub Actions y corregir errores si los hubiera.
2. Completar matriz granular rol × acción contrastando cada endpoint.
3. Añadir pruebas de integración negativas y límites de municipio/plantel y cuenta activa.
4. Ensayar migración y restauración en PostgreSQL aislado.
5. Preparar revisión con el usuario antes de cualquier paso productivo.

## Forma de colaboración
Hablar en español claro y cercano. Entregar cambios verificables (archivo, commit, pruebas) y diferenciar siempre «guardado», «probado» y «desplegado». No afirmar pruebas que no se hayan ejecutado. Priorizar la integridad de datos y las integraciones existentes.
