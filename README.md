# SID — Sistema Integrado Digital (evolución en desarrollo)

> **Estado:** evolución gradual del sistema RAC existente. La aplicación en producción continúa funcionando con su arquitectura y autorizaciones actuales. Los cambios SIGE se preparan en la rama `feature/sige-permisos-fase1`; no están desplegados.

La identidad de producto acordada es **SID — Sistema Integrado Digital**. **SID-Educación** comprende RAC y Supervisión Educativa (departamento ministerial); **SID-FEDE** tendrá identidad visual y administrativa propia como solución para el organismo autónomo adscrito al Ministerio. FEDE **permanece técnicamente dentro de la aplicación actual por ahora**; no se ha ejecutado ninguna separación. La rama y documentación histórica conservan el nombre SIGE durante la transición.

**[Decisión institucional y lineamientos de identidad SID](docs/SID_ARQUITECTURA_IDENTIDAD.md)**.

## Regla obligatoria de seguridad y despliegue

**No modificar ni desplegar nada en producción (Render, Supabase, integraciones Google) sin pruebas satisfactorias y autorización explícita del responsable del proyecto.** Un commit, una prueba unitaria aprobada o un workflow exitoso **no constituyen autorización de despliegue**.

1. Trabajar en la rama de desarrollo, sin fusionar a `main` por defecto.
2. Auditar las autorizaciones actuales y conservar las restricciones por municipio y plantel.
3. Ejecutar pruebas unitarias, negativas y de integración; verificar usuarios inactivos.
4. Probar migraciones y restauraciones en una base **aislada**, nunca en la base productiva.
5. Presentar resultados y riesgos para aprobación humana previa a cualquier cambio productivo.

**Precaución:** `npm run migrate` ejecuta el esquema histórico y **no debe ejecutarse en Supabase de producción**. Los comandos de despliegue y primera instalación que figuran más abajo son documentación histórica, **no instrucciones autorizadas para el entorno actual**. No restaurar un respaldo completo sobre esquemas administrados por Supabase.

## Avance SIGE — Fase 1: roles y permisos

| Componente | Estado |
|---|---|
| Respaldo PostgreSQL inicial | Archivo local generado y listado inspeccionado; **restauración integral aún no comprobada** |
| Inventario de permisos de RAC, Supervisión y FEDE | Auditoría preliminar documentada |
| Catálogo central `src/core/permissions.js` | Creado; incluye permisos generales y 24 permisos granulares **preparatorios** |
| Matriz definitiva rol × acción | **Pendiente de validar**; los permisos granulares no se conceden todavía |
| `requirePermiso` | Prototipo sin conectar a rutas productivas ni a roles persistidos en BD |
| Migración `sql/20261007_sige_roles_permisos.sql` | Propuesta **NO EJECUTADA**, pendiente de revisión y prueba aislada |
| Preflight `sql/20261007_sige_preflight_readonly.sql` | Consulta de diagnóstico de solo lectura |
| Pruebas `tests/permissions*.test.js` | Suites unitarias incorporadas; faltan pruebas de integración/alcance |
| GitHub Actions | Workflow de pruebas unitarias configurado; verificar resultados en Actions |
| Despliegue SIGE | **NO REALIZADO** |

Documentación: [Plan de fase 1](docs/SIGE_FASE1.md) · [Auditoría de permisos reales](docs/SIGE_AUDITORIA_PERMISOS.md).

### Pruebas de permisos

```bash
npm run test:permissions
```

Este comando ejecuta pruebas unitarias sin conectarse a la base de datos ni requerir credenciales de producción. El workflow `.github/workflows/sige-permissions.yml` las ejecuta en la rama de desarrollo. **No sustituyen** las pruebas de integración, los controles de alcance territorial ni la verificación de cuentas activas.

### Próximas etapas

- Completar auditoría de rutas auxiliares y construir la matriz rol × acción según comportamiento real.
- Probar denegaciones 401/403, acceso cruzado entre municipios/planteles y usuarios inactivos.
- Preparar entorno de pruebas PostgreSQL aislado y ensayar migración/recuperación.
- Diseñar integración de roles múltiples sin alterar sesiones, OAuth, Drive, Sheets o datos existentes.
- Solo después de pruebas y aprobación explícita, planificar una implementación controlada.

---

## Sistema RAC existente (documentación histórica)


Sistema web (Node.js/Express + PostgreSQL + Google Sheets/Drive) para la
Zona Educativa del estado Monagas. Nació como el backend de validación del
**RAC** (Registro de Asignación de Carga) contra la nómina del Ministerio de
Educación, y hoy reúne varios módulos relacionados: alertas de calidad de
datos, catálogo maestro de planteles, consulta de la data de GESCOLAR,
generación de credenciales con QR, y administración de usuarios/roles.

## Qué valida el RAC

1. **Cédula**: toda cédula cargada al RAC debe existir en `personal_ministerio`.
   Si no existe → alerta `no_existe_ministerio` (posible asignación sin
   aprobación del Ministerio). Cédulas repetidas en el RAC son válidas (un
   profesor puede tener varios turnos/planteles).
2. **Plantel**: el código de plantel (COD DEA) debe existir en el catálogo
   maestro `planteles`. Si no existe → alerta `plantel_no_existe` (a menos
   que el código esté registrado como typo conocido en
   `mapeo_codigos_plantel`, en cuyo caso se resuelve solo, sin alerta).
3. **Horas**: académicas y administrativas no pueden superar 168h/semana.

## Módulos

| Módulo | Para qué sirve | Roles con acceso |
|---|---|---|
| **Resumen** (dashboard) | Panorama general del RAC | todos |
| **Consultar RAC** | Ver/editar registros del RAC, traslados | todos (según municipio) |
| **Exportar RAC** | Descargar el RAC completo en CSV | admin, operador |
| **Alertas** | Bandeja de alertas de validación (cédula/plantel/horas) | todos |
| **Códigos sin catalogar** | Detecta códigos de plantel no reconocidos y permite marcarlos como typo conocido (`mapeo_codigos_plantel`) | operador, admin |
| **Depurar archivo** | Limpieza/depuración de un archivo cargado antes de procesarlo | admin |
| **Cargar por municipio** | Cada municipio sube su Excel del RAC; se valida y se guardan las alertas | encargado_municipio, operador, admin |
| **Carga completa mensual** | Carga masiva del RAC completo (todos los municipios de una vez) | admin |
| **Planteles** | Catálogo maestro de planteles en Postgres (los 973 planteles de Monagas) | admin |
| **Consultar planteles (GESCOLAR)** | Búsqueda de la hoja GESCOLAR en Google Sheets (55 columnas por plantel) con ficha completa y descarga de los archivos que tenga ese código DEA en Google Drive | admin, operador_plantel |
| **Credenciales** | Genera el PDF de notificación/credencial con QR de verificación, cruzando nómina+RAC; panel de pendientes por aprobar (firma física) y página pública `/verificar/:codigo` | admin, operador, operador_credenciales |
| **Usuarios** | Alta/baja y edición de usuarios y roles del sistema | admin |
| **Mantenimiento** | Exportar auditoría completa (CSV) y otras tareas de mantenimiento de la base de datos | admin |

### Roles

```
admin                 -- acceso total
operador              -- oficina central: ve/opera todos los municipios
encargado_municipio   -- solo su propio municipio (RAC y cargas)
operador_credenciales -- solo el módulo de Credenciales
operador_plantel      -- solo Consultar planteles (GESCOLAR + Drive)
```

## Arquitectura

- **Backend**: Node.js + Express, montado como un único servicio (`src/server.js`)
  que sirve tanto la API (`/api/...`) como el frontend estático (`/public`).
- **Base de datos**: PostgreSQL (Supabase/Render), con triggers de auditoría
  (tabla `auditoria`) sobre las operaciones sensibles del RAC.
- **Autenticación**: JWT (`Authorization: Bearer <token>`), guardado en
  `sessionStorage` del navegador — no usa cookies. El frontend (`public/js/api.js`)
  agrega el header automáticamente en cada llamada; las descargas de archivos
  (credenciales, auditoría, Drive) se piden con `fetch` + `blob()` en vez de
  un link directo, porque un `<a href>` no puede llevar ese header.
- **Frontend**: HTML + JavaScript "vanilla" (sin framework ni build step),
  un archivo `.html` + `.js` por pantalla, todos comparten `public/css/style.css`
  y el menú lateral de `public/js/nav.js` (que decide qué se muestra según el
  rol del usuario logueado).
- **Integraciones con Google** (vía una única cuenta de servicio, con permisos
  de solo lectura):
  - **Sheets**: hoja "GESCOLAR" (`SHEETS_GESCOLAR_ID`, consulta de planteles)
    y hoja "CredencialesEmitidas" (`SHEETS_CREDENCIALES_ID`, registro de
    credenciales generadas).
  - **Drive**: carpeta raíz "Planteles" (`DRIVE_FOLDER_PLANTELES_ID`), con una
    subcarpeta por código DEA; se listan y descargan sus archivos por
    streaming (sin pasar por WhatsApp, sin costo).

## Estructura del repositorio

```
src/
  server.js                    # entrypoint Express — monta todas las rutas
  db/
    pool.js                    # conexión a Postgres + helper de transacción auditada
    schema.sql                 # esquema completo (tablas, triggers de auditoría)
  services/
    validacion.js              # las 3 reglas de validación del RAC
  middleware/
    auth.js                    # JWT + control de rol/municipio
  utils/
    csv.js                     # parseo de CSV compartido
  assets/
    membrete-logo.png          # logo del Ministerio, usado en el PDF de credencial
  routes/
    auth.js                    # login
    rac.js / racCompleto.js    # CRUD del RAC (incluye traslados) y carga completa mensual
    cargas.js                  # subir Excel por municipio → valida → guarda alertas
    alertas.js                 # bandeja de alertas para el operador
    planteles.js               # catálogo maestro de planteles (Postgres)
    plantelesConsulta.js       # consulta GESCOLAR (Sheets) + archivos por DEA (Drive)
    personalMinisterio.js      # carga de la nómina del Ministerio
    credenciales.js            # generación de PDF+QR, aprobación, verificación pública
    usuarios.js                # alta/edición/roles de usuarios del sistema
    mapeoCodigosPlantel.js     # códigos de plantel marcados como typo conocido
    depurarArchivo.js          # depuración de archivos antes de cargarlos
    mantenimiento.js           # exportar auditoría y tareas de mantenimiento
public/
  *.html + js/*.js             # una pantalla por par de archivos (mismo nombre)
  js/api.js                    # cliente HTTP compartido (maneja el token JWT)
  js/nav.js                    # menú lateral, roles visibles y logout
  css/style.css                # sistema de diseño compartido por todas las pantallas
scripts/
  migrate.js                   # aplica schema.sql a la base de datos
  importar_planteles.js        # carga el CSV real de planteles (973 registros) a Postgres
```

## Variables de entorno

| Variable | Para qué |
|---|---|
| `DATABASE_URL` | Conexión a PostgreSQL |
| `JWT_SECRET` | Firma de los tokens de sesión |
| `NODE_ENV` | `production` en Render |
| `PORT` | Puerto del servidor (lo asigna Render) |
| `MAX_UPLOAD_SIZE_MB` | Límite general de subida de archivos |
| `MAX_UPLOAD_NOMINA_MB` | Límite específico para la carga de nómina |
| `MAX_UPLOAD_PLANTELES_MB` | Límite específico para la carga del catálogo de planteles |
| `GOOGLE_SERVICE_ACCOUNT_KEY_PATH` | Ruta al JSON de la cuenta de servicio de Google (cargado como Secret File en Render) — la misma cuenta que usa `whatsapp-credenciales` |
| `SHEETS_GESCOLAR_ID` | ID de la hoja de Google Sheets "GESCOLAR" |
| `SHEETS_CREDENCIALES_ID` | ID de la hoja "CredencialesEmitidas" |
| `DRIVE_FOLDER_PLANTELES_ID` | ID de la carpeta raíz "Planteles" en Drive |
| `DIRECTOR_NOMBRE` / `DIRECTOR_CEDULA` / `DIRECTOR_CARGO` | Datos de quien firma, usados en el PDF de credencial |
| `RESOLUCION_TEXTO` | Texto de la resolución que se imprime en el PDF de credencial |
| `URL_PUBLICA` | URL pública del servicio, usada para armar el link del QR de verificación |

No hay `.env.example` en el repo (para no tentar a subir credenciales reales
por accidente) — usa esta tabla como referencia al configurar las variables
en local o en Render.

## Levantar en local

```bash
npm install
# crear un archivo .env con las variables de la tabla de arriba

npm run migrate                                    # crea las tablas en Postgres
node scripts/importar_planteles.js planteles.csv   # carga el catálogo de planteles
npm run dev                                          # arranca con reinicio automático
```

## Desplegar / actualizar en Render

1. Sube los cambios a GitHub (por "Upload file" o `git push`, según el archivo).
2. Si el servicio tiene auto-deploy activado desde ese repo, Render
   redespliega solo; si no, entra al servicio → "Manual Deploy" → "Deploy latest commit".
3. Variables de entorno y el JSON de la cuenta de servicio de Google se
   administran desde las pestañas "Environment" y "Secret Files" del
   servicio — no van en el repo.
4. Primer despliegue únicamente:
   ```bash
   # desde la pestaña "Shell" del servicio en Render
   npm run migrate
   node scripts/importar_planteles.js planteles.csv
   ```
5. Crear el primer usuario admin (no hay endpoint público de registro, a
   propósito — los usuarios los crea otro admin desde el módulo "Usuarios"
   una vez que exista el primero):
   ```sql
   -- desde el Shell de la base de datos en Render:
   INSERT INTO usuarios (nombre, email, password_hash, rol)
   VALUES ('Tu Nombre', 'tu@email.com', '<hash generado con bcrypt>', 'admin');
   ```

## Pendiente / ideas a futuro

- Envío de los archivos de Drive por WhatsApp desde "Consultar planteles"
  (hoy solo tiene descarga) — pendiente decidir entre un enlace `wa.me`
  (gratis, lo envía la persona) o el bot existente de `whatsapp-credenciales`
  (puede tener costo fuera de una conversación abierta de 24h).
- Comandos "Avances \<código DEA\>" e "info \<código DEA\>" en el bot de
  WhatsApp (resumen de rehabilitación y ficha informativa del plantel).
- Refinar el mapeo de columnas en `cargas.js` a medida que se vea más
  variedad real en los Excel de cada municipio.
