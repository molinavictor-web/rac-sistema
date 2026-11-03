# SID — Sistema Integrado Digital (rac-sistema)

Sistema web de la Zona Educativa del estado Monagas (Node.js/Express +
PostgreSQL/Supabase + Google Sheets/Drive). Nació como el validador del
**RAC** (Registro de Asignación de Cargo) contra la nómina del Ministerio de
Educación y hoy es un sistema por **módulos**, cada uno con sus propios
perfiles de acceso:

| Módulo | Entrada | Para qué sirve |
|---|---|---|
| **RAC** | `/login.html` | Carga y validación del RAC, alertas de calidad de datos, catálogo de planteles, consulta de GESCOLAR, directorio de directores, credenciales con QR, usuarios y mantenimiento |
| **Supervisión** | `/supervision/login.html` | Supervisores municipales y circuitales, circuitos educativos, directores, matrícula por período y por nivel, alertas y estadísticas |
| **Inspecciones** (FEDE) | `/inspecciones/login.html` | Planes de atención, planillas de materiales, adicionales, consolidados en Excel, Instrumento Uno CDCE y edificios compartidos |

Producción: https://rac-sistema.onrender.com (Render, plan Starter).

## Perfiles (roles)

| Rol | Acceso |
|---|---|
| `admin` | Todo |
| `operador` | RAC de todos los municipios (consultar, exportar, alertas, depurar archivo, planteles sin eliminar, directorio, cargar por municipio) |
| `encargado_municipio` | RAC y cargas solo de su municipio |
| `operador_credenciales` | Solo Credenciales |
| `operador_plantel` | Consultar planteles y Directorio; Inspecciones en solo lectura |
| `supervision` | **Solo** el panel de Supervisión |
| `director` | **Solo** "Mi plantel" en Supervisión (su propio `codigo_plantel`); la cuenta se crea desde Supervisión → Directores |
| `insp_coordinador` | **Solo** Inspecciones: planes, planteles, asignaciones, consolidados, Excel |
| `insp_ingeniero` | **Solo** Inspecciones: sus planillas asignadas y sus visitas del Instrumento Uno |
| `insp_consulta` | **Solo** Inspecciones en lectura (autoridades) |

Los roles de Supervisión e Inspecciones quedan encerrados en su módulo en
dos niveles: el backend (`src/middleware/auth.js` responde 403 fuera de
`/api/supervision` o `/api/inspecciones`) y el menú (`public/js/nav.js`
los redirige a su panel).

## Reglas del RAC

1. **Cédula**: se cruza con `personal_ministerio` solo por cédula (una cédula
   repetida en el RAC es normal: varios turnos o planteles). Si no está en
   nómina → alerta `cedula_no_existe_nomina`.
2. **Plantel**: el código DEA debe existir en `planteles` o en
   `mapeo_codigos_plantel` (typos conocidos). Si no → alerta
   `plantel_no_existe` y la fila no se inserta.
3. **Clave de un registro**: `cedula + plantel + codigo_cargo` (permite dos
   nombramientos de la misma persona en el mismo plantel).
4. **Horas**: académicas hasta 54/semana; administrativas hasta 168/semana.
5. En cada carga masiva todo se sincroniza contra el archivo, salvo nombres
   y apellidos (prioridad: nómina > archivo > lo ya guardado).

## Arquitectura

- **Backend**: Node.js + Express en un solo servicio (`src/server.js`) que
  sirve la API (`/api/...`) y el frontend estático (`/public`). Incluye una
  red de seguridad para errores en rutas async (no tumban el servidor).
- **Base de datos**: PostgreSQL en Supabase (conexión por *Session pooler*),
  con triggers de auditoría (tabla `auditoria`, retención 3 días, purga manual).
- **Autenticación**: JWT (`Authorization: Bearer <token>`) guardado en
  `sessionStorage`. `public/js/api.js` agrega el header; las descargas se
  piden con `fetch` + `blob()`.
- **Frontend**: HTML + JavaScript sin framework ni build step; un `.html` +
  un `.js` por pantalla, `public/css/style.css` compartido (más hojas `*-v6.css`
  por pantalla) y menú lateral en `public/js/nav.js`.
- **Seguridad HTTP**: `helmet` con CSP: no se permiten `<script>` en línea
  ni `onclick` en el HTML (usar `addEventListener`).
- **Google** (una cuenta de servicio + OAuth para escribir en Drive):
  - Hoja **GESCOLAR** (`SHEETS_GESCOLAR_ID`): consulta de planteles; Directorio
    escribe los datos del director; Inspecciones escribe la columna
    `RESPONSABLE` y una columna `PLAN <nombre>` por cada plan.
  - Hoja **CredencialesEmitidas** (`SHEETS_CREDENCIALES_ID`).
  - Hoja **Coordenadas Planteles** (`SHEETS_COORDENADAS_ID`): coordenadas y
    `codigo_infraestructura` (edificios compartidos).
  - Carpeta **Planteles** en Drive (`DRIVE_FOLDER_PLANTELES_ID`), una
    subcarpeta por código DEA. La escritura usa OAuth con la cuenta Gmail
    dueña de la carpeta; el refresh token se guarda en la tabla
    `configuracion` y se renueva con el botón "Reconectar Google Drive"
    (vence cada 7 días mientras la app de Google esté en modo "Prueba").

## Estructura del repositorio

```
src/
  server.js                    # entrypoint: monta todas las rutas
  db/pool.js                   # conexión a Postgres + transacción auditada
  db/schema.sql                # esquema de la base de datos
  middleware/auth.js           # JWT, roles, municipio, plantel y encierro por módulo
  utils/csv.js                 # parser CSV (RFC 4180) compartido
  assets/                      # logos (Ministerio, educación, FEDE)
  services/
    validacion.js              # reglas de validación del RAC
    gescolar.js                # lectura/escritura de GESCOLAR para Inspecciones
    coordenadasInfra.js        # columna codigo_infraestructura de Coordenadas Planteles
    infraestructuras.js        # edificios con código INFRA-000001…, clasificación e importación de la hoja
    exportarInstrumentoUno.js  # Excel con las respuestas del Instrumento Uno
    exportarExcel.js           # Excel de consolidados, planillas y reportes por plan (exceljs)
    reportesInspecciones.js    # catálogo de columnas y armado de los reportes por plan
    instrumentoUnoEsquema.js   # preguntas y validaciones del Instrumento Uno CDCE
  routes/
    auth.js                    # login
    rac.js, racCompleto.js     # RAC: consulta/edición y carga completa mensual
    cargas.js                  # carga por municipio
    alertas.js                 # bandeja y exportación de alertas
    planteles.js               # catálogo maestro de planteles (Postgres)
    plantelesConsulta.js       # GESCOLAR (Sheets) + archivos por DEA (Drive)
    directorioDirectores.js    # directorio de directores (GESCOLAR)
    personalMinisterio.js      # nómina del Ministerio
    mapeoCodigosPlantel.js     # códigos de plantel con typo conocido
    depurarArchivo.js          # depuración del CSV antes de cargarlo
    credenciales.js            # PDF + QR, aprobación y /verificar/:codigo
    usuarios.js                # usuarios y roles (eliminación suave)
    mantenimiento.js           # auditoría, respaldo y reinicio de datos
    supervision.js             # módulo Supervisión
    inspecciones.js            # módulo Inspecciones (planes, planillas, consolidados)
    instrumentoUno.js          # Instrumento Uno CDCE (/api/inspecciones/instrumento-uno)
    infraestructuras.js        # clasificar planteles: solo / comparte edificio (/api/inspecciones/infraestructuras)
    reportesInspecciones.js    # reportes por plan con columnas elegibles y Excel (/api/inspecciones/reportes)
public/
  *.html + js/*.js             # pantallas del RAC
  supervision/*.html           # pantallas de Supervisión (JS en js/supervision-*.js)
  inspecciones/*.html          # pantallas de Inspecciones (JS en js/inspecciones-*.js e instrumento-uno*.js)
  css/                         # style.css compartido + hojas por pantalla
scripts/
  migrate.js                   # aplica schema.sql
  sql/                         # semilla del catálogo de materiales (166 rubros) y script de seguridad de Supabase
  importar_planteles.js        # carga el CSV de planteles
tests/
  sid-supervision-browser.cjs  # prueba visual de Supervisión (Playwright, GitHub Actions)
```

**¿Recibes este sistema por primera vez?** Empieza por `docs/GUIA-TRASPASO-PROGRAMADOR.md` (mapa de piezas, hojas de Google, montar una copia, qué tocar para cada cambio).

## Variables de entorno

| Variable | Para qué |
|---|---|
| `DATABASE_URL` | Conexión a PostgreSQL (Supabase, Session pooler) |
| `JWT_SECRET` | Firma de los tokens de sesión |
| `NODE_ENV` | `production` en Render |
| `PORT` | Puerto (lo asigna Render) |
| `MAX_UPLOAD_SIZE_MB`, `MAX_UPLOAD_NOMINA_MB`, `MAX_UPLOAD_PLANTELES_MB` | Límites de subida |
| `GOOGLE_SERVICE_ACCOUNT_KEY_PATH` | Ruta al JSON de la cuenta de servicio (Secret File en Render) |
| `SHEETS_GESCOLAR_ID` | Hoja GESCOLAR |
| `SHEETS_CREDENCIALES_ID` | Hoja CredencialesEmitidas |
| `SHEETS_COORDENADAS_ID` | Hoja Coordenadas Planteles (Instrumento Uno y edificios compartidos) |
| `DRIVE_FOLDER_PLANTELES_ID` | Carpeta raíz "Planteles" en Drive |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | OAuth para escribir en Drive |
| `GOOGLE_OAUTH_REFRESH_TOKEN` | Respaldo; el token vigente vive en la tabla `configuracion` |
| `URL_PUBLICA` | URL pública (enlace del QR y callback de OAuth) |
| `DIRECTOR_NOMBRE`, `DIRECTOR_CEDULA`, `DIRECTOR_CARGO`, `RESOLUCION_TEXTO` | Datos de quien firma el PDF de credencial |

No hay `.env.example` a propósito (para no subir credenciales reales por accidente).

## Levantar en local

```bash
npm install
# crear un .env con las variables de la tabla
npm run migrate                                     # crea las tablas
node scripts/importar_planteles.js planteles.csv    # catálogo de planteles
npm run dev
```

## Desplegar en Render

1. Los cambios llegan a la rama `main` (Pull Request o "Upload files").
2. Render redespliega solo (auto-deploy) o con "Manual Deploy".
3. Variables y el JSON de la cuenta de servicio se administran en
   "Environment" y "Secret Files"; nunca van en el repo.
4. No tocar GitHub/Render mientras corre una carga masiva (un deploy a mitad
   reinicia el servidor).
5. El primer usuario admin se crea por SQL (no hay registro público):
   ```sql
   INSERT INTO usuarios (nombre, email, password_hash, rol)
   VALUES ('Tu Nombre', 'tu@email.com', '<hash bcrypt>', 'admin');
   ```

## Pendientes conocidos

- Envío por WhatsApp de los archivos de Drive desde "Consultar planteles".
- Comandos "Avances" e "info" del bot de WhatsApp.
- Pantalla para unificar edificios compartidos en conflicto (hoy el sistema responde 409 y se resuelve a mano).
- Opcional: migrar los códigos antiguos de la hoja Coordenadas (DEA / EDIF…) a INFRA-… para uniformar.
