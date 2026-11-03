# Guía de traspaso para un programador — SID (rac-sistema)

Escrita el 2026-11-03. Es para una persona (o un asistente de IA) que recibe el sistema **sin haber
participado en su construcción** y necesita: entender qué es, saber dónde vive cada pieza, saber qué archivo
tocar para cada tipo de cambio y poder levantar una copia completa en otra infraestructura.

Complementa a dos documentos del mismo repo:
- `README.md`: visión general de los tres módulos (RAC, Supervisión, Inspecciones), roles y reglas del RAC.
- `docs/MANTENIMIENTO-INSPECCIONES-PLANTELES.md`: reglas de negocio y mantenimiento de Planteles/Inspecciones/Infraestructuras.

> **Idea central:** el sistema no depende de ningún asistente de IA para funcionar. Corre en Render +
> Supabase + Google (Sheets/Drive) + GitHub. Todo lo que se hizo con ayuda de IA quedó como código normal en este repo.

Lo marcado **[COMPLETAR]** son datos que solo conoce el dueño del sistema (cuentas, correos); no se escriben aquí a propósito.

---

## 1. Qué es, en un minuto

Sistema web de la Zona Educativa de Monagas (Venezuela), un solo servicio Node.js/Express que sirve la API y
las pantallas. Tiene tres módulos con perfiles de acceso separados:

| Módulo | Entrada | Para qué |
|---|---|---|
| RAC | `/login.html` | Cargar y validar el Registro de Asignación de Cargo contra la nómina del Ministerio |
| Supervisión | `/supervision/login.html` | Supervisores, circuitos, directores, matrícula, alertas |
| Inspecciones (FEDE, programa Bricomiles) | `/inspecciones/login.html` | Planes de atención, planillas de materiales, consolidados, Instrumento Uno, Infraestructuras |

Esta guía se centra en **Planteles / Inspecciones**, pero la infraestructura (servidor, base, login, menú) es compartida.

Flujo del negocio de Inspecciones: **inspección → hallazgo → rehabilitación**. En cada inspección los ingenieros
llenan una planilla con los materiales necesarios (163 rubros oficiales + adicionales); el sistema consolida las
cantidades por plan para presentarlas a las autoridades.

## 2. Mapa: qué habla con qué

```
 Navegador (HTML + JS sin framework, token JWT en sessionStorage)
        │  HTTPS  /api/...
        ▼
 Render ─ servicio "rac-sistema" (Node 18+, Express, src/server.js)
        │
        ├──► Supabase (PostgreSQL 17)  ← DATABASE_URL (Session pooler)
        │        usuarios, RAC, nómina, inspecciones, infraestructuras…
        │
        ├──► Google Sheets (cuenta de servicio)
        │        • GESCOLAR            (SHEETS_GESCOLAR_ID)      973 planteles
        │        • Coordenadas Planteles (SHEETS_COORDENADAS_ID) coordenadas + codigo_infraestructura
        │        • CredencialesEmitidas (SHEETS_CREDENCIALES_ID)
        │
        └──► Google Drive
                 • LEE con la cuenta de servicio
                 • ESCRIBE con OAuth de una cuenta Gmail real (refresh token en la tabla `configuracion`)
                 • carpeta raíz "Planteles" (DRIVE_FOLDER_PLANTELES_ID), una subcarpeta por código DEA

 Aparte, otro repo y otro servicio en Render:
 Bot de WhatsApp "whatsapp-credenciales" ──► Meta Cloud API + Drive + hoja Coordenadas
```

Decisión de diseño que conviene respetar: **GESCOLAR vive en Google Sheets y no en Supabase** (para cuidar el
espacio del plan gratuito de Supabase). Hay una caché de 15 minutos al leerlo.

## 3. Inventario: dónde vive cada pieza

| Pieza | Proveedor | Identificador real | Acceso / credencial |
|---|---|---|---|
| Código | GitHub | `molinavictor-web/rac-sistema`, rama `main` | cuenta GitHub del dueño **[COMPLETAR colaboradores]** |
| Servidor | Render, espacio "My Workspace" | servicio `rac-sistema`, id `srv-da4j1nbbc2fs73bdeb9g`, URL https://rac-sistema.onrender.com | cuenta Render del dueño |
| Base de datos | Supabase | proyecto `rac-sistema`, ref `xkkyrhflkgssbrzzszma`, región `ap-northeast-2` (Seúl), PostgreSQL 17 | cuenta Supabase del dueño; la contraseña de la base está en `DATABASE_URL` en Render |
| Hoja GESCOLAR | Google Sheets | ver `SHEETS_GESCOLAR_ID` en Render | compartida como **Editor** con la cuenta de servicio |
| Hoja Coordenadas Planteles | Google Sheets | ver `SHEETS_COORDENADAS_ID` en Render | compartida como **Editor** con la cuenta de servicio |
| Hoja CredencialesEmitidas | Google Sheets | ver `SHEETS_CREDENCIALES_ID` en Render | compartida como **Editor** con la cuenta de servicio |
| Carpeta de archivos | Google Drive | ver `DRIVE_FOLDER_PLANTELES_ID` en Render | dueña: una cuenta Gmail **[COMPLETAR cuál]**; la cuenta de servicio solo lee |
| Cuenta de servicio de Google | Google Cloud | JSON guardado como *Secret File* en Render | **[COMPLETAR proyecto de Google Cloud y correo de la cuenta de servicio]** |
| Cliente OAuth de Google | Google Cloud | `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` en Render | mismo proyecto de Google Cloud |
| Bot de WhatsApp | Render + GitHub | servicio `whatsapp-credenciales`, id `srv-d9r9b5ijnfac73f6q9t0`, repo `molinavictor-web/whatsapp-credenciales` | plan Free (se duerme) |

Datos verificados en producción el 2026-11-03: Render `rac-sistema` en plan **Starter** (0,5 CPU / 512 MB, 1 instancia),
región **Oregón**, despliegue automático al hacer commit en `main`, `buildCommand: npm install`,
`startCommand: node src/server.js`. Supabase en Seúl: servidor y base están en regiones distintas, lo que añade
latencia en cada consulta (no se midió). Si algún día se migra, conviene ponerlos en la misma región.

> `render.yaml` en la raíz es solo una **referencia**: el servicio se creó a mano. Una diferencia conocida: el yaml
> declara `healthCheckPath: /api/health`, pero en producción ese campo está vacío. El endpoint existe y responde `{"ok":true}`.

## 4. Variables de entorno (el "a dónde apunta" de todo)

No hay `.env.example` a propósito. En Render van en **Environment** y el JSON de Google en **Secret Files**
(Render los monta en `/etc/secrets/<nombre-del-archivo>`; esa ruta es el valor de `GOOGLE_SERVICE_ACCOUNT_KEY_PATH`).
Para correr en local, crear un archivo `.env` en la raíz con las mismas claves.

| Variable | Apunta a | Si falta o está mal |
|---|---|---|
| `DATABASE_URL` | Cadena de conexión de Supabase → botón **Connect** → **Session pooler** | El servidor no puede consultar nada |
| `NODE_ENV` | `production` en Render | **Importante:** `src/db/pool.js` solo activa SSL hacia Supabase si vale `production`. En local, sin SSL |
| `JWT_SECRET` | Cualquier texto largo y secreto | Nadie puede iniciar sesión. Cambiarlo cierra la sesión de todos |
| `PORT` | Lo asigna Render (10000) | En local usa el que se ponga |
| `GOOGLE_SERVICE_ACCOUNT_KEY_PATH` | Ruta al JSON de la cuenta de servicio | Fallan GESCOLAR, Coordenadas, Credenciales y lectura de Drive |
| `SHEETS_GESCOLAR_ID` | ID de la hoja GESCOLAR (el texto largo de la URL entre `/d/` y `/edit`) | Error "Falta configurar SHEETS_GESCOLAR_ID" |
| `SHEETS_COORDENADAS_ID` | ID de la hoja Coordenadas Planteles | Error equivalente; Infraestructuras no escribe en la hoja |
| `SHEETS_CREDENCIALES_ID` | ID de la hoja CredencialesEmitidas | Falla el módulo de credenciales |
| `DRIVE_FOLDER_PLANTELES_ID` | ID de la carpeta raíz "Planteles" en Drive | Error "Falta configurar DRIVE_FOLDER_PLANTELES_ID" |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | Cliente OAuth (tipo aplicación web) de Google Cloud | No se puede subir ni borrar archivos en Drive |
| `GOOGLE_OAUTH_REFRESH_TOKEN` | Opcional, respaldo. El token vigente vive en la tabla `configuracion` (clave `drive_refresh_token`) | — |
| `URL_PUBLICA` | URL pública del sistema (sin barra final) | Rompe el callback de OAuth y el enlace del QR de credenciales |
| `MAX_UPLOAD_SIZE_MB`, `MAX_UPLOAD_NOMINA_MB`, `MAX_UPLOAD_PLANTELES_MB` | Límites de subida | Usa valores por defecto |
| `DIRECTOR_NOMBRE`, `DIRECTOR_CEDULA`, `DIRECTOR_CARGO`, `RESOLUCION_TEXTO` | Texto del firmante del PDF de credencial | Solo afecta ese PDF |

## 5. Google, con detalle

### 5.1 Dos formas de entrar a Google (y por qué)
1. **Cuenta de servicio** (JSON en `GOOGLE_SERVICE_ACCOUNT_KEY_PATH`): lee y escribe Sheets, y **solo lee** Drive
   (`drive.readonly`). Los scopes se declaran en `src/services/gescolar.js`, `src/services/coordenadasInfra.js`,
   `src/routes/plantelesConsulta.js` y `src/routes/credenciales.js`. No vence.
2. **OAuth de una cuenta Gmail real**, solo para **escribir en Drive** (crear carpetas, subir y borrar archivos).
   Motivo: las cuentas de servicio tienen 0 bytes de cuota en un Drive personal y fallan al subir contenido.
   - El flujo vive en `src/routes/plantelesConsulta.js` (rutas `drive-oauth/...`). Scope: `https://www.googleapis.com/auth/drive`.
   - URI de redirección que debe estar registrada en el cliente OAuth de Google Cloud:
     `<URL_PUBLICA>/api/planteles-consulta/drive-oauth/callback`
   - El refresh token se guarda en la tabla `configuracion` (`clave = 'drive_refresh_token'`). El botón **"Reconectar Google Drive"**
     (admin, en Consultar planteles) lo renueva.
   - **Vence cada 7 días** mientras la app de Google Cloud esté en modo "Prueba". Pendiente: evaluar pasarla a "En producción" (verificar
     los requisitos actuales de Google antes). Síntoma del vencimiento: falla subir/borrar archivos; leer sigue funcionando.

### 5.2 Estructura que el código espera en cada hoja
El código lee por **nombre de columna** en GESCOLAR y por **posición** en Coordenadas. Cambiar el orden o renombrar rompe cosas.

- **GESCOLAR** — pestaña llamada exactamente `GESCOLAR`, encabezados en la fila 1. Se lee la pestaña completa (así llegan las columnas nuevas).
  - Columnas que el código usa por nombre: `cod_plantel` (código DEA, llave), `nombre_plantel`, `municipio`, `parroquia`, `NOMB_CIRCUITO`
    (circuito; en las planillas se usa como comuna), `director_nombre`, `telefono_director`, `telefono_movil_director` (y las demás del director listadas al inicio de `src/routes/directorioDirectores.js`).
  - **Lo único que el sistema escribe en GESCOLAR:** las columnas del director (Directorio de directores), la columna `RESPONSABLE`
    (ingeniero de cada plantel) y una columna `PLAN <nombre>` por cada plan de atención. Instrumento Uno e Infraestructuras **nunca** la modifican.
  - El archivo original traía acentos rotos (UTF-8 leído como Windows-1252); `gescolar.js` lo corrige al leer. El nombre de GESCOLAR se respeta tal cual (caso OD06031608).
- **Coordenadas Planteles** — **primera pestaña** de la hoja (el código usa el rango `A:F` sin nombre de pestaña). Fila 1 = encabezados.
  Columnas por posición: **A** `codigo_dea` · **B** `codigo_infraestructura` · **C** `latitud` · **D** `longitud` · **E** `fecha_captura` · **F** `ingeniero`.
  El sistema escribe solo la columna **B**; **nunca** toca latitud ni longitud. (La escritura manual de coordenadas desde "Consultar planteles"
  sí escribe la fila completa A–F.) El bot de WhatsApp también escribe aquí.
- **CredencialesEmitidas** — pestaña con ese nombre, rango `A:I`. La columna **I** es el estado (`pendiente` al emitir).
- **Drive** — carpeta raíz "Planteles" → una subcarpeta por código DEA. La foto de fachada se llama `FACHADA_<código>.<ext>`.
  Borrar un archivo lo manda a la papelera de Drive (recuperable ~30 días).

### 5.3 Poner a andar Google desde cero (para una copia nueva)
1. En Google Cloud: crear un proyecto y **habilitar las APIs "Google Sheets API" y "Google Drive API"**.
2. Crear una **cuenta de servicio**, generar una clave JSON y guardarla (en Render, como Secret File).
3. Compartir con el correo de esa cuenta de servicio: las tres hojas como **Editor** y la carpeta "Planteles" como mínimo como **Lector**.
4. Crear un **cliente OAuth** (aplicación web) y registrar la URI de redirección del punto 5.1.
5. Cargar las variables de la sección 4 y entrar al sistema como admin → Consultar planteles → **Reconectar Google Drive**.

## 6. Base de datos

### 6.1 Qué hay
44 tablas y vistas creadas por `src/db/schema.sql` (829 líneas, es la fuente de verdad del esquema). Por módulo:

| Módulo | Tablas principales |
|---|---|
| Base / acceso | `usuarios`, `configuracion` (guarda el token de Drive), `auditoria`, `estados`, `municipios`, `parroquias`, `stg_geografico` |
| RAC | `rac`, `personal_ministerio` (nómina, ~790 mil filas), `planteles`, `mapeo_codigos_plantel`, `alertas`, `cargas_municipio`, `carga_detalle` |
| Supervisión | `planteles_supervision`, `supervisores_municipales`, `supervisores_circuitales`, `supervisor_*_plantel`, `directores_supervision`, `circuitos_educativos`, `plantel_circuito`, `matricula_*`, `niveles_matricula`, `plantel_niveles`, `alertas_supervision`, vista `v_mapa_supervision` |
| Inspecciones | `catalogo_materiales`, `planes_atencion`, `inspecciones`, `inspeccion_inspectores`, `inspeccion_asignaciones`, `plan_inspecciones`, `inspeccion_materiales`, `adicionales_catalogo`, `adicional_alias`, `inspeccion_adicionales`, vistas `v_consolidado_oficial` y `v_consolidado_adicionales` |
| Instrumento Uno | `iu_visitas`, `iu_edificio_miembros` (antigua, ya no se escribe) |
| Infraestructuras | `infraestructuras`, `infra_miembros`, `infra_espacios` |

En producción hay además dos tablas `respaldo_*_20261007_…`: copias manuales de octubre, no las usa el código.

### 6.2 Cómo conecta el código
`src/db/pool.js` crea un `Pool` de `pg` con `DATABASE_URL` (máximo 10 conexiones). Las operaciones que deben auditarse usan
`conTransaccionAuditada(usuarioId, …)`, que fija `app.usuario_id` para que los *triggers* de auditoría registren quién cambió qué
(la tabla `auditoria` conserva 3 días y se purga a mano). La aplicación entra como el usuario `postgres`, por eso ni RLS ni los
permisos de la API pública de Supabase la afectan.

### 6.3 Montar la base desde cero (probado el 2026-11-03)
Orden, en una base PostgreSQL vacía (Supabase u otra, versión 15 o superior por las vistas `security_invoker`):

1. `npm run migrate` (aplica `src/db/schema.sql`; o pegar el archivo en el editor SQL).
   - Si la base **no es Supabase**, antes crear los roles que el esquema nombra en sus `REVOKE`: `CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;`
2. `scripts/sql/semilla_catalogo_materiales.sql` → carga los 166 rubros oficiales (163 activos + 3 retirados).
   Sin esto las planillas salen vacías. **Estos datos no estaban en el esquema; se añadieron al repo con esta guía.**
3. `scripts/sql/seguridad_supabase.sql` → deja las vistas con `security_invoker` y cierra el acceso público (anon/authenticated). Se puede repetir sin problema.
4. Crear el primer administrador (no hay registro público). Generar el hash con `node -e 'console.log(require("bcryptjs").hashSync("TU_CLAVE",10))'` y:
   ```sql
   INSERT INTO usuarios (nombre, email, password_hash, rol)
   VALUES ('Tu Nombre', 'tu@email.com', '<hash bcrypt>', 'admin');
   ```
5. Los demás usuarios se crean desde la pantalla Usuarios.

Verificado: sobre PostgreSQL 16 limpio, `schema.sql` corre sin errores, la semilla deja 166 filas (LISTA2/activo = 163, LISTA1/inactivo = 3),
las vistas de consolidado quedan con `security_invoker=true`, el servidor arranca, `/api/health` responde `{"ok":true}`, el administrador inicia sesión y
`/api/inspecciones/planes` responde.

**Aviso para el editor SQL de Supabase:** los scripts deben ir en **un solo bloque** (`DO $$ … $$` cuando hay lógica), porque el editor no conserva sesión entre sentencias.

**Datos que NO están en el repo:** el contenido de producción (planes, inspecciones, cantidades cargadas, usuarios, nómina). Eso se respalda
desde Supabase (ver `docs/MANTENIMIENTO-INSPECCIONES-PLANTELES.md`, sección 2.2). El repo solo trae estructura y el catálogo oficial.

## 7. Cómo está organizado el código

```
src/server.js                  monta todas las rutas y la seguridad (helmet/CSP)
src/middleware/auth.js         JWT, requireRol(), "encierro" de roles por módulo
src/db/pool.js, schema.sql     conexión y esquema
src/routes/…                   una ruta (archivo) por área; los comentarios iniciales listan sus endpoints
src/services/…                 lógica reutilizable (GESCOLAR, Coordenadas, Infraestructuras, Excel)
public/*.html, public/inspecciones/*.html, public/supervision/*.html   una pantalla = un .html
public/js/*.js                 un .js por pantalla; api.js (fetch con token), nav.js (menú lateral y permisos de pantalla)
public/css/style.css           estilos compartidos (+ hojas por pantalla)
```

Reglas del frontend que sorprenden al principio:
- **Sin framework ni paso de compilación.** Se edita el archivo y se sube.
- **La CSP (helmet) prohíbe `<script>` en línea y `onclick`**: todo con `addEventListener` en el `.js` de la pantalla.
- Una tabla ancha se envuelve en `.tabla-responsive` para que no se corte en el teléfono.
- `nav.js`, `style.css` y `server.js` los comparten los tres módulos: partir siempre de la versión actual completa.
- La sesión es un JWT de 12 horas guardado en `sessionStorage`.

**Orden de montaje que no se debe alterar** (en `server.js`): `/api/inspecciones/instrumento-uno` y `/api/inspecciones/infraestructuras`
van **antes** de `/api/inspecciones`. Si se invierte, las rutas específicas quedan tapadas.

## 8. Cómo funciona cada flujo de Planteles (para saber dónde mirar)

**Consultar planteles** — `public/planteles-consulta.html` + `js/planteles-consulta.js` → `src/routes/plantelesConsulta.js`.
Lee GESCOLAR (Sheets) y los archivos de Drive por código DEA; muestra foto de fachada y mapa; permite coordenadas manuales (hoja Coordenadas)
y subir/borrar archivos (OAuth).

**Directorio de directores** — `src/routes/directorioDirectores.js`: edita solo las columnas del director en GESCOLAR.

**Planes y planillas (Inspecciones)** — `src/routes/inspecciones.js` (el listado de endpoints está comentado al inicio).
Al enlazar un plantel a un plan se guarda una **copia** de su fila de GESCOLAR en `inspecciones.membrete` (JSONB); las correcciones del
usuario van en `membrete.planilla`. La planilla (`planilla.html`) guarda 163 rubros en `inspeccion_materiales` y los adicionales en
`inspeccion_adicionales`. Los consolidados salen de las vistas `v_consolidado_*`; el Excel lo arma `src/services/exportarExcel.js` (exceljs).

**Instrumento Uno CDCE (herramienta temporal de captura)** — `src/routes/instrumentoUno.js`. Las preguntas se definen en **un solo archivo**:
`src/services/instrumentoUnoEsquema.js`; el servidor valida con él y las pantallas se dibujan desde `GET …/instrumento-uno/esquema`.
Al **enviar** una visita, el plantel se clasifica en Infraestructuras y la visita guarda su código `INFRA-…`.

**Infraestructuras (permanente)** — `src/routes/infraestructuras.js`, `src/services/infraestructuras.js`, `src/services/coordenadasInfra.js`.
Cada plantel queda "sin clasificar", "solo" o "comparte edificio"; cada edificio tiene código `INFRA-000001…`. Escribe la columna B de Coordenadas.
Importa automáticamente la hoja (como mucho cada 5 min). Si Google no responde al clasificar, responde 502 y no guarda nada. Detalle de reglas
(fusión, conflicto 409, espacios separados): sección 6b de `MANTENIMIENTO-INSPECCIONES-PLANTELES.md`.

## 9. "Quiero cambiar X, ¿qué toco?"

| Cambio | Dónde |
|---|---|
| Agregar o modificar una pregunta del Instrumento Uno | Solo `src/services/instrumentoUnoEsquema.js` (la pantalla y el Excel se adaptan) |
| Cambiar los rubros oficiales de materiales | Tabla `catalogo_materiales` (SQL). Nunca borrar rubros usados: marcar `activo = false` |
| Agregar un rol | `ROLES_VALIDOS` en `src/routes/usuarios.js`, el nombre visible en `public/js/usuarios.js`, `src/middleware/auth.js` (constantes de encierro si el rol queda limitado a un módulo), las constantes `ROLES_*` de la ruta que corresponda y `roles:` en `public/js/nav.js`. La base no restringe los valores de `usuarios.rol` |
| Agregar una pantalla nueva | `.html` en la carpeta del módulo + `.js` en `public/js/` + ruta en `src/routes/` + `app.use` en `server.js` (respetando el orden de la sección 7) + entrada en `nav.js` |
| Agregar una columna a GESCOLAR | Agregarla al final de la hoja; el sistema ya lee la pestaña completa. Si se usa en pantalla, referirla por su nombre exacto |
| Cambiar la hoja de Coordenadas | Mantener A–F en el mismo orden y como primera pestaña (el código escribe la B por posición) |
| Cambiar cuánto tarda en verse un cambio hecho directo en GESCOLAR | `DURACION_CACHE_MS` en `src/services/gescolar.js` (hoy 15 min) |
| Cambiar el plazo de la sesión | `expiresIn` en `src/routes/auth.js` (hoy 12 h) |
| Cambiar logos o colores | `src/assets/` y `public/css/` |
| Cambiar de proveedor de base de datos | Solo `DATABASE_URL` (+ sección 6.3). El código usa `pg` estándar |
| Cambiar de hosting | Cualquier servidor con Node 18+: `npm install`, `node src/server.js`, variables de la sección 4 |

## 10. Montar una copia completa en otra infraestructura (paso a paso)

1. **Código:** clonar `molinavictor-web/rac-sistema` (o pedir acceso). `npm install`.
2. **Base:** crear un proyecto de Supabase (o un PostgreSQL ≥ 15) y seguir la sección 6.3.
3. **Google:** seguir la sección 5.3; copiar las hojas actuales (Archivo → Hacer una copia) y la carpeta de Drive si se quiere una réplica completa.
4. **Servidor:** crear un servicio web de Node (en Render: repo de GitHub, `buildCommand: npm install`, `startCommand: node src/server.js`, plan que no se duerma si se usa en producción).
5. **Variables:** cargar la sección 4, con `NODE_ENV=production` y `URL_PUBLICA` con la dirección nueva.
6. **Secret File:** subir el JSON de la cuenta de servicio y poner su ruta en `GOOGLE_SERVICE_ACCOUNT_KEY_PATH`.
7. **OAuth:** registrar la nueva URI de redirección (sección 5.1) y pulsar "Reconectar Google Drive".
8. **Verificar** (lista corta):
   - `GET /api/health` responde `{"ok":true}`.
   - El admin inicia sesión en `/login.html` y en `/inspecciones/login.html`.
   - Consultar planteles lista planteles (confirma GESCOLAR) y muestra archivos de un plantel (confirma Drive).
   - Inspecciones → Planes: crear un plan de prueba y abrir una planilla (confirma el catálogo de 163 rubros).
   - Infraestructuras: abrir la pantalla y ver el avance (confirma Coordenadas).
   - Subir un archivo a un plantel (confirma OAuth de escritura).

## 11. Qué NO está resuelto o no se puede asegurar (honestidad)

- **El repo del bot de WhatsApp (`whatsapp-credenciales`) no está documentado aquí**; hay que leer su propio código. Usa Meta Cloud API con número de prueba.
- **Los secretos no están ni deben estar en el repo.** Si el dueño pierde el acceso a Render sin copia de las variables, no se pueden reconstruir (hay que regenerar claves y contraseña de la base).
- **Pruebas:** en el repo solo existe `tests/sid-supervision-browser.cjs` (Supervisión). Las pruebas de Inspecciones, Instrumento Uno e Infraestructuras se hicieron durante el desarrollo
  con PostgreSQL 16 local, Google simulado y un navegador simulado (jsdom), pero **no están en el repo**. Nada se probó contra Google real fuera de producción:
  ante un cambio, probar a mano en pantalla.
- **No verificado:** el aspecto en teléfono real y la impresión a PDF real.
- **Sin modo sin internet:** el borrador automático vive en el navegador (localStorage), pero no hay sincronización posterior. Es un requisito pendiente (probable PWA).
- **Una sola instancia** de servidor: la caché de GESCOLAR y el bloqueo de clasificación (`pg_advisory_xact_lock`) asumen un único proceso (el bloqueo de clasificación sí funciona con varios, porque está en la base).
- **Límites conocidos pendientes:** límite de intentos de inicio de sesión, límites de tamaño de subida, declarar `iconv-lite` en `package.json`, `.gitignore`.

## 12. Para quien entrega el sistema

**Qué darle al programador** (por canales seguros, nunca por chat ni correo en texto plano):
- Invitación como colaborador al repo de GitHub (y al del bot).
- Invitación al servicio de Render y al proyecto de Supabase, o una persona de confianza que le dé las variables de la sección 4.
- Acceso de **Editor** a las tres hojas y a la carpeta de Drive.
- Acceso al proyecto de Google Cloud (cuenta de servicio y cliente OAuth).

**Después de la entrega**, si se compartieron claves: cambiar la contraseña de la base (y actualizar `DATABASE_URL` en Render), cambiar `JWT_SECRET` y regenerar la clave de la cuenta de servicio y el secreto OAuth.

**Mensaje modelo (copiar y adaptar):**

> Te paso el sistema SID (Zona Educativa de Monagas): una aplicación Node.js/Express con PostgreSQL en Supabase y datos en Google Sheets/Drive, desplegada en Render
> desde GitHub (`molinavictor-web/rac-sistema`, rama `main`; cada cambio a `main` redespliega solo). No tiene paso de compilación ni framework de frontend.
> Empieza por `docs/GUIA-TRASPASO-PROGRAMADOR.md`: ahí está el mapa de piezas, las variables de entorno, la estructura esperada de las hojas de Google,
> cómo montar la base desde cero y qué archivo tocar para cada tipo de cambio. Después `README.md` y `docs/MANTENIMIENTO-INSPECCIONES-PLANTELES.md`.
> Reglas importantes: partir siempre de la versión actual de `server.js`, `nav.js` y `style.css` (son compartidos por tres módulos); no hay scripts en línea por la política de seguridad;
> GESCOLAR vive en Google Sheets y no en Supabase a propósito. Hay un repo aparte para el bot de WhatsApp que no está documentado en esta guía.

## 13. Cómo pedirle ayuda a un asistente de IA

Pasarle: esta guía + `README.md` + `src/db/schema.sql` + el archivo concreto a modificar (completo y actual). Pedirle: "devuélveme el archivo completo modificado,
dime en qué carpeta subirlo y qué probar". No darle nunca claves, tokens ni el JSON de la cuenta de servicio.
