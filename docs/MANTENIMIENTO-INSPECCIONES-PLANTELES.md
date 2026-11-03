# Guía de mantenimiento — Planteles, Inspecciones e Instrumento Uno (FEDE)

Complementa al `README.md` (que describe todo el SID). Este documento es para quien
herede el sistema: una persona, o un asistente de IA al que se le pase este archivo
junto con el repo. Escrito el 2026-11-02.

> **Idea central:** el sistema NO depende de ningún asistente de IA para funcionar.
> Todo corre en Render + Supabase + Google (Sheets/Drive) + GitHub. Un asistente solo
> sirve para modificar el código.

## 1. Qué hay y dónde vive

| Pieza | Dónde | Notas |
|---|---|---|
| Código | GitHub `molinavictor-web/rac-sistema`, rama `main` | Cada cambio a `main` redespliega solo en Render |
| Servidor | Render, servicio `rac-sistema` (plan Starter, ~US$7/mes) | `render.yaml` en la raíz |
| Base de datos | Supabase (Postgres, plan gratis) | Se conecta por *Session pooler* (`DATABASE_URL`) |
| GESCOLAR | Hoja de Google Sheets (`SHEETS_GESCOLAR_ID`) | 973 planteles; NO está en Supabase a propósito |
| Coordenadas | Hoja "Coordenadas Planteles" (`SHEETS_COORDENADAS_ID`) | coordenadas + `codigo_infraestructura` |
| Archivos | Carpeta Drive "Planteles" (`DRIVE_FOLDER_PLANTELES_ID`) | una subcarpeta por código DEA |
| Bot de WhatsApp | Repo privado `whatsapp-credenciales` en Render (Free) | Servicio aparte, comandos `plantel` y `foto` |

Variables de entorno: ver tabla en el README. Los secretos (JSON de cuenta de servicio,
`JWT_SECRET`, claves OAuth) viven solo en Render ("Environment" y "Secret Files").
**Hay que guardar una copia segura de esos valores fuera de Render** (gestor de
contraseñas): si se pierde el acceso a Render no se pueden reconstruir.

## 2. Tareas de mantenimiento recurrentes

### 2.1 Reconectar Google Drive (cada 7 días)
La app de Google Cloud está en modo "Prueba": el *refresh token* de OAuth vence a los 7
días. Síntoma: falla al subir/eliminar archivos en "Consultar planteles". Solución: entrar
como admin y pulsar **"Reconectar Google Drive"**. Solución definitiva (pendiente):
pasar la app de Google Cloud a "En producción" (pantalla de consentimiento OAuth) —
verificar los requisitos actuales de Google antes de hacerlo.
Lectura de Drive/Sheets usa la cuenta de servicio y no vence.

### 2.2 Respaldos (hacer YA y repetir mensualmente)
- **Base de datos:** Supabase → Database → Backups (el plan gratis NO guarda respaldos
  descargables); alternativa: `pg_dump "$DATABASE_URL" > respaldo.sql` desde cualquier PC con
  PostgreSQL instalado. Como mínimo exportar a CSV las tablas `inspecciones`,
  `inspeccion_materiales`, `inspeccion_adicionales`, `iu_visitas`, `iu_edificio_miembros`.
- **GESCOLAR y Coordenadas:** en Google Sheets → Archivo → Descargar → Excel, mensual.
- **Código:** GitHub ya es la copia; descargar un ZIP de `main` de vez en cuando.
- **Drive:** la carpeta "Planteles" es la única copia de fotos/informes; descargarla completa de vez en cuando.

### 2.3 Costos y límites
- Render: solo `rac-sistema` cuesta (Starter). `whatsapp-credenciales` está Free (se
  "duerme"; el primer mensaje tarda).
- Supabase gratis: vigilar el espacio (no cargar GESCOLAR ahí) y el aviso de pausa por inactividad.
- Supabase → Advisors (Security): revisar tras crear tablas/vistas nuevas. Toda vista nueva
  debe ser `security_invoker` y toda tabla nueva debe tener RLS activado y permisos
  `REVOKE` a `anon`/`authenticated` (la app entra como `postgres`, por eso no se afecta).

### 2.4 Usuarios y accesos
Crear/desactivar usuarios: pantalla Usuarios (admin). El primer admin se crea por SQL
(README). Roles: ver README. Un cambio de contraseña no cierra sesiones ya abiertas
(JWT); para invalidar todo, cambiar `JWT_SECRET` en Render (cierra la sesión de todos).

## 3. Cómo se hacen los cambios (sin experiencia de programador)

1. Siempre partir de la versión **actual completa** del archivo (en GitHub, rama `main`).
   `nav.js`, `style.css` y `server.js` son compartidos por RAC, Supervisión e Inspecciones.
2. Subir con "Add file → Upload files" (carpeta correcta: `src/routes/`, `public/js/`…).
   Si Windows bloquea un `.js` descargado como "virus", abrirlo, copiar el texto y pegarlo
   en el editor de GitHub (✏️).
3. Render redespliega solo (1–3 min). No cambiar nada mientras corre una carga masiva.
4. Si algo se rompe: Render → Deploys → "Rollback" al despliegue anterior, o en GitHub
   revertir el último *commit*.
5. Los scripts SQL de Supabase se corren en el editor SQL **en un solo bloque `DO $$ … $$`**
   (el editor no conserva sesión entre sentencias).

## 4. Reglas técnicas aprendidas (no repetir errores)

- `helmet`/CSP: no hay `<script>` en línea ni `onclick`; imágenes `blob:` y fuentes
  requieren permiso explícito en `server.js`.
- Tabla que se corta en el teléfono → envolver en `.tabla-responsive`.
- PostgreSQL con parámetros (`$1`, `$2`): todo parámetro debe usarse y tener tipo claro
  (`::int`, `::text`), si no da "could not determine data type".
- Una lista que se redibuja puede disparar el "clic fuera" del documento: detener la
  propagación dentro del contenedor.
- Excel/CSV con acentos rotos = UTF-8 leído como Windows-1252; GESCOLAR trae mojibake y
  `gescolar.js` lo corrige al leer. Los nombres de GESCOLAR se respetan tal cual (caso OD06031608).
- Cantidades: hasta 3 decimales, sin redondear. Números guardados como texto en un Excel
  de origen subcuentan sumas (caso columna Udón Pérez).

## 5. Módulo Inspecciones

**Flujo:** inspección → hallazgo → rehabilitación. Menú "Inspecciones" (`public/inspecciones/`).

- **Planes de atención** (`planes_atencion`): agrupan planteles. Cada plan tiene su propia
  columna en GESCOLAR llamada `PLAN <nombre>` (se escribe con "registro-gescolar", solo admin).
- **Inspección** (`inspecciones`): pertenece al PLANTEL, no al plan. `membrete` (JSONB) es una
  copia de la fila de GESCOLAR al enlazar; las correcciones del usuario van en
  `membrete.planilla`. Desenlazar de un plan no borra nada (`plan_inspecciones`).
- **Planilla** (`planilla.html`): 163 rubros oficiales (`catalogo_materiales`, MAT-001..163) +
  adicionales fuera de lista (`adicionales_catalogo`, `adicional_alias`, `inspeccion_adicionales`).
  Hay borrador automático en el navegador; NO hay modo sin internet.
- **Consolidados:** vistas `v_consolidado_oficial` y `v_consolidado_adicionales`; descarga
  Excel con `src/services/exportarExcel.js` (exceljs).
- **Adicionales:** nombre único por material (sin importar mayúsculas/acentos); admin crea
  ACTIVOS, los demás PENDIENTES; solo admin aprueba/edita/retira/unifica (al unificar se
  suman cantidades y el nombre viejo queda de alias).
- **Roles:** `admin`, `insp_coordinador` (gestión), `insp_ingeniero` (solo sus planillas y
  visitas), `insp_consulta` y `operador_plantel` (lectura). Constantes `ROLES_*` al inicio de
  `src/routes/inspecciones.js`; el encierro por módulo está en `src/middleware/auth.js` y `nav.js`.
- **Resumen** (`dashboard.html`): atendidos, tipos, planteles por municipio y parroquias de
  Maturín con avance del Instrumento Uno. "Cargado" = plantel con ≥1 visita `ENVIADA`.
- El listado completo de endpoints está comentado al inicio de `src/routes/inspecciones.js`.

## 6. Instrumento Uno CDCE

Formulario por pasos (Datos del plantel, Director, Infraestructura, Edificio compartido,
Situación legal). Archivos: `src/routes/instrumentoUno.js`,
`src/services/instrumentoUnoEsquema.js`, `src/services/coordenadasInfra.js`,
`public/inspecciones/instrumento-uno*.html`, `public/js/instrumento-uno*.js`.

- **Una sola definición del formulario:** `instrumentoUnoEsquema.js` define campos,
  validaciones, opciones y campos condicionales (`visibleSi`). El servidor valida con él y
  las pantallas se dibujan desde `/api/inspecciones/instrumento-uno/esquema`.
  **Para agregar o cambiar una pregunta, se edita solo ese archivo** (más texto de ayuda si aplica).
- **Tablas:** `iu_visitas` (una visita por plantel/fecha/ingeniero; estados BORRADOR/ENVIADA;
  respuestas en JSONB) y `iu_edificio_miembros`.
- **Edificios compartidos:** el `codigo_infraestructura` es el código DEA del plantel
  principal. Se reutiliza el código existente entre los miembros; si hay más de uno distinto
  responde 409 (hay que unificar a mano en la hoja Coordenadas). Si la hoja no se puede leer y el
  plantel comparte, responde 502 (no se inventa un código). Si falla la escritura en la hoja, la
  visita queda guardada y se marca "pendiente". GESCOLAR **nunca** se modifica desde aquí.
- **Edificios compartidos (pantalla):** tarjeta con nombres (973), compartidos e
  infraestructuras = total_gescolar − Σ max(0, en_gescolar − 1).
- **Borradores:** en el navegador, clave `iu_borrador_<usuarioId>_<visitaId>`.
- **Eliminar:** borradores propios; enviadas solo coordinador/admin.

## 7. Módulos de consulta de planteles

- `plantelesConsulta.js`: ficha por DEA con archivos de Drive, fachada
  (`FACHADA_<código>.<ext>`), mapa, coordenadas manuales (admin y `operador_plantel`).
  Eliminar un archivo lo manda a la **papelera de Drive** (recuperable ~30 días); solo
  permite archivos que estén dentro de la carpeta de ese plantel.
- `directorioDirectores.js`: edita solo las columnas del director en GESCOLAR.
- `gescolar.js`: lee TODA la hoja GESCOLAR (caché de 15 min — un cambio hecho directo en la
  hoja puede tardar hasta 15 min en verse). Escribe solo `RESPONSABLE`, columnas `PLAN …` y las del director.

## 8. Bot de WhatsApp (repo aparte)

Meta Cloud API con número de prueba; Render Free. Comandos `plantel <DEA>` (informe .docx,
materiales .xlsx, ficha .pptx desde Drive; valida ingeniero contra `ingenieros.csv`) y
`foto <DEA>` (foto como documento; coordenadas EXIF a la hoja). Pendientes: número real,
plan de pago para evitar "sleep", comandos `Avances` e `info`. **Este repo no está
documentado aquí; ver su propio README.**

## 9. Pruebas

- `tests/sid-supervision-browser.cjs` (Playwright, GitHub Actions) solo cubre Supervisión.
- Inspecciones e Instrumento Uno se probaron durante el desarrollo con PostgreSQL 16 local,
  googleapis simulado y jsdom; **esas pruebas no están en el repo**. Nunca se probó contra
  Google real fuera de producción: ante un cambio, probar a mano en pantalla (crear visita,
  enviar, ver edificios, descargar Excel).
- Lo que no se pudo verificar: aspecto en teléfono real, impresión a PDF real.

## 10. Pendientes (a 2026-11-02)

- Exportar/consolidar las respuestas del Instrumento Uno (hoy solo se ven en pantalla).
- Pantalla para unificar edificios en conflicto (409).
- Enviar por WhatsApp los archivos de Drive desde la ficha; comandos `Avances`/`info` del bot.
- Trabajo sin internet en campo con sincronización (probable PWA): requisito prioritario, no hecho.
- Calcular pintura/espacios y catálogo de colores en base de datos (ideas, no desarrolladas;
  reglas: área bruta de pared, 1 cuñete = 80 m², redondear siempre hacia arriba).
- Decisiones abiertas: "una inspección activa en un solo plan", estadísticas por ingeniero,
  refrescar datos de GESCOLAR en planillas ya creadas.
- Mantenimiento: límite de intentos de login, límites de subida, `iconv-lite` en `package.json`, `.gitignore`.

## 11. Cómo pedirle ayuda a otro asistente de IA

Pasarle: este archivo + `README.md` + `src/db/schema.sql` + el archivo concreto a modificar
(completo y actual). Pedirle: "devuélveme el archivo completo modificado, dime en qué carpeta
subirlo y qué probar". No darle nunca claves, tokens ni el JSON de la cuenta de servicio.
