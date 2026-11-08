# Guía de mantenimiento — Planteles, Inspecciones e Instrumento Uno (FEDE)

Complementa al `README.md` (que describe todo el SID). Este documento es para quien
herede el sistema: una persona, o un asistente de IA al que se le pase este archivo
junto con el repo. Escrito el 2026-11-02 (actualizado con Infraestructuras y Excel del Instrumento Uno).

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

## 5b. Reportes (Inspecciones → Reportes)

Pantalla `public/inspecciones/reportes.html` + `public/js/inspecciones-reportes.js`; servicio `src/services/reportesInspecciones.js`; ruta
`src/routes/reportesInspecciones.js` (`/api/inspecciones/reportes`, montada antes de `/api/inspecciones`); Excel con `reportePlan` en `src/services/exportarExcel.js`.

- **Qué hace:** se elige un plan, se marcan columnas de un **catálogo cerrado** (datos del plantel, matrícula total y por nivel, edificio, inspección, director) y se ve la
  tabla o se descarga en Excel. Hay combinaciones listas (Esencial, Matrícula y edificio, Matrícula por nivel, Seguimiento). La última selección se recuerda en el navegador.
- **Seguridad:** el servidor valida cada columna pedida contra el catálogo (`COLUMNAS` en el servicio); nunca arma SQL con nombres del navegador. Las columnas del grupo
  "Director" (nombre y teléfono) solo las ven `admin` e `insp_coordinador` (el servidor responde 403 al resto). Ven el reporte: admin, insp_coordinador, insp_consulta y operador_plantel;
  no el ingeniero.
- **De dónde sale cada dato:** identificación, matrícula y director salen de la planilla de cada plantel (copia de GESCOLAR al enlazarlo + correcciones del ingeniero), igual que los
  consolidados. El edificio sale de Infraestructuras (solo / comparte / sin clasificar, código `INFRA-…`, con quién comparte, espacios separados). La **matrícula del edificio** suma todas sus
  instituciones con código DEA (las que no están en el plan se toman de GESCOLAR vigente); una institución sin DEA no suma y el reporte lo avisa. Solo cuentan los planteles **activos** del plan.
- **Planteles que yo elija:** además de un plan, se pueden **buscar y agregar planteles uno a uno** (búsqueda en GESCOLAR sin distinguir acentos; hasta 300; la lista se recuerda en el navegador).
  Rutas: `GET /seleccion/buscar?q=`, `POST /seleccion` y `POST /seleccion/excel` (cuerpo `{codigos, columnas}`). Si el plantel ya tiene una planilla se usa la más reciente (columna "Fuente de los datos" = Planilla);
  si no, sus datos salen de GESCOLAR vigente (= GESCOLAR) y las columnas de inspección quedan vacías.
- **Proyección de rehabilitación (aulas):** toma aulas total / operativas / no operativas de la **última visita ENVIADA** del Instrumento Uno (`iu_visitas.datos`). Alumnos adicionales posibles = aulas NO operativas × 25
  (mínimo) y × 30 (máximo); mesas-sillas a dotar = una por alumno adicional. Valores fijos (constantes `ALUMNOS_POR_AULA_MIN/MAX` en el servicio), un solo turno. Es una proyección de **capacidad**, no matrícula real:
  el reporte lo avisa, avisa los planteles sin visita (celdas "—", no 0) y los que ya tienen menos de 25 alumnos por aula operativa. Sin visitas ENVIADAS no hay datos de aulas.
- **Para agregar una columna:** añadirla a `COLUMNAS` (y a `PRESETS` si va en una combinación) en `reportesInspecciones.js` y calcular su valor en `armarReporte`; la pantalla y el Excel la toman del catálogo.
- **Pruebas hechas (durante el desarrollo, no están en el repo):** 56 de API y Excel (plan) y 35 de selección y proyección con PostgreSQL real y Google simulado, 31 de pantalla (jsdom), capturas en escritorio y teléfono, y revisión del Excel convertido a PDF con LibreOffice.
  No se probó contra Google real ni en un teléfono físico. Con muchas columnas, la impresión en una sola hoja queda pequeña: elegir menos columnas para imprimir.

## 6. Instrumento Uno CDCE

Formulario por pasos (Datos del plantel, Director, Infraestructura, **Servicios**, Edificio compartido,
Situación legal). Archivos: `src/routes/instrumentoUno.js`,
`src/services/instrumentoUnoEsquema.js`, `src/services/exportarInstrumentoUno.js`, `src/services/infraestructuras.js`,
`public/inspecciones/instrumento-uno*.html`, `public/js/instrumento-uno*.js`.

- **Servicios y teatro/auditorio (nov. 2026):** «Teatro o auditorio» (No existe / Operativo / No operativo) va en Infraestructura. La sección «Servicios» tiene internet (¿posee?, proveedor de lista cerrada agrupada + «Otro», tipo de conexión + «Otro») y gas con **casillas** (cilindros, a granel/tanque estacionario, directo, no tiene): kilos y cantidad de cilindros si marca cilindros; capacidad del tanque (litros) si marca granel. Los campos dependientes usan `visibleSi` (el valor puede ser una lista de casillas) y `obligatorioVisible`; el servidor descarta y no exige lo que quedó oculto. Para cambiar las listas: `PROVEEDORES_INTERNET`, `TIPOS_CONEXION`, `SUMINISTRO_GAS` en `instrumentoUnoEsquema.js`. La pantalla ya no usa posiciones fijas de pasos: busca «edificio» por su id.
- **Una sola definición del formulario:** `instrumentoUnoEsquema.js` define campos,
  validaciones, opciones y campos condicionales (`visibleSi`). El servidor valida con él y
  las pantallas se dibujan desde `/api/inspecciones/instrumento-uno/esquema`.
  **Para agregar o cambiar una pregunta, se edita solo ese archivo** (más texto de ayuda si aplica).
- **Tablas:** `iu_visitas` (una visita por plantel/fecha/ingeniero; estados BORRADOR/ENVIADA;
  respuestas en JSONB). `iu_edificio_miembros` es la tabla antigua de edificios: ya no se escribe, solo se importa una vez.
- **Edificios:** al ENVIAR una visita, el plantel queda clasificado (solo o comparte edificio) con el módulo
  de Infraestructuras (sección 6b). La visita guarda el código `INFRA-…` de su edificio. Si los
  involucrados ya están en dos edificios compartidos distintos responde 409 (la visita sigue en borrador); si Google
  no responde responde 502. Si falla la escritura en la hoja Coordenadas, la visita queda guardada y marcada
  "pendiente". GESCOLAR **nunca** se modifica desde aquí. Eliminar una visita NO deshace la clasificación.
- **Excel de respuestas:** botón "Descargar Excel" (`GET /visitas.xlsx`, por defecto solo ENVIADAS; `?estado=TODAS`
  incluye borradores). Hoja "Visitas" (una columna por pregunta del esquema, con totales) y hoja "Edificios".
  Código en `src/services/exportarInstrumentoUno.js`; el ingeniero solo descarga las suyas.
- **Borradores:** en el navegador, clave `iu_borrador_<usuarioId>_<visitaId>`.
- **Eliminar:** borradores propios; enviadas solo coordinador/admin.

## 6b. Infraestructuras (clasificación de edificios)

Pantalla "Infraestructuras" (Inspecciones). Archivos: `src/routes/infraestructuras.js`,
`src/services/infraestructuras.js`, `src/services/coordenadasInfra.js`, `public/inspecciones/infraestructuras.html`,
`public/js/infraestructuras.js`. Script SQL: `12_infraestructuras.sql` (ya ejecutado; también está al final de `schema.sql`).

- **Idea:** cada nombre de plantel de GESCOLAR queda "sin clasificar", "solo en su edificio" o "comparte edificio".
  Cada edificio tiene un código **INFRA-000001, INFRA-000002…** (generado por el sistema, tabla `infraestructuras`) y
  sus instituciones (`infra_miembros`). Una institución sin código DEA se identifica por nombre.
- **Reglas:** un plantel con DEA pertenece a UN solo edificio. Al compartir se une al edificio de varios nombres que ya
  exista; los edificios de un solo nombre se fusionan (queda el de número menor; puede haber saltos en la numeración).
  Dos edificios de varios nombres distintos → 409 (pendiente: pantalla para unificarlos). "Solo" saca al plantel del
  edificio compartido en que estuviera.
- **Hoja "Coordenadas Planteles":** la columna `codigo_infraestructura` se completa para los edificios compartidos (se agregan
  filas sin coordenadas si faltan) y, en un plantel SOLO, únicamente si ya tiene fila y su celda está vacía (el bot anota el código
  en todos los planteles, y así la hoja queda coherente); nunca se agregan filas para solos ni se pisa un código ya escrito. Los
  edificios importados de la hoja conservan allí su código antiguo (`codigo_anterior`, p. ej. EDIF9999 o un DEA) para no
  desordenar al bot; los edificios nuevos llevan `INFRA-…`.
- **Importación automática:** al abrir la pantalla (como mucho cada 5 min) y al clasificar, el sistema importa la hoja y las
  visitas antiguas del Instrumento Uno. Es repetible sin duplicar. Botón "Sincronizar con la hoja" (admin/coordinador).
  Si Google no responde al clasificar → 502 y no se guarda nada (para no partir un edificio en dos).
- **Espacios separados (script `13_infra_espacios.sql`, tabla `infra_espacios`):** caso rural en que un mismo plantel (un DEA) funciona
  en varios sitios físicos distintos (un aula en una casa del caserío, otra a 10 minutos…). El plantel conserva su edificio principal
  y su código `INFRA-…`; sus espacios adicionales se anotan en la misma ventana de clasificar con descripción, referencia, distancia o
  tiempo, aulas, coordenadas (opcionales) y observaciones, máximo 15. Cada uno se identifica como `<INFRA del plantel>-E1`, `-E2`…
  (el número no cambia aunque se quiten otros). No cambian el conteo de edificios ni lo que ve la hoja/bot. Sirven para saber, al
  rehabilitar, cuántos espacios hay que atender. La lista muestra "+N espacios" y una tarjeta cuenta planteles y espacios.
  `POST /clasificar` recibe `espacios` (lista completa: sin la clave no se tocan; con id se actualiza, sin id se crea, los ausentes se eliminan).
- **Roles:** clasifican admin, `insp_coordinador` e `insp_ingeniero`; el resto solo consulta.
- **Tarjeta "Infraestructuras":** = nombres de GESCOLAR − Σ (instituciones de cada edificio − 1). Baja al registrar compartidos.
- **Pendiente:** pantalla para unificar edificios en conflicto; opcionalmente migrar los códigos antiguos de la hoja a INFRA-…

## 6c. Consultas exprés y Cambios recientes

Permiten pedir solo una parte del Instrumento Uno (una o varias fases) a cualquier plantel, empezando por el código DEA.

- **Quién**: crean y cierran consultas `admin` e `insp_coordinador`; los ingenieros solo llenan las abiertas. "Cambios recientes" es solo del `admin`.
- **Fases disponibles**: Plantel, Director, Infraestructura, Servicios, Edificio compartido y Legal.
- **Fase Edificio compartido**: al abrir un plantel ya clasificado se trae lo que dice Infraestructuras (la fuente que manda). Al guardar usa la MISMA clasificación de la pantalla Infraestructuras (`infraestructuras.clasificar` + `sincronizarHoja`): código `INFRA-…`, hoja «Coordenadas Planteles», y los mismos avisos (409 si las instituciones ya están en edificios distintos; 502 si Google no responde: en ambos casos no se guarda nada). Si la hoja falla después de guardar, queda «pendiente». Los cambios quedan en «Cambios recientes» pero NO se revierten ahí: se corrigen desde Infraestructuras.
- **Dato vigente**: lo último enviado en una visita (`iu_visitas.datos`) más lo guardado después en `iu_valores` (gana lo más reciente). `valor = null` en JSON significa "se borró a propósito". Los reportes leen este dato vigente.
- **Historial**: cada cambio queda en `iu_cambios` (quién, cuándo, valor anterior y nuevo, nota). "Volver al anterior" solo funciona si el valor actual sigue siendo el que se guardó (si no, responde 409).
- **Motivo de inhabilitación de aulas** (`aulas_motivo`, `aulas_motivo_otro`): aparece solo si aulas no operativas > 0; se guarda por plantel, no por aula. Los reportes traen "Motivo..." y "Aulas inhabilitadas por fuerza mayor".
- **Validaciones**: la suma de aulas es aviso para el personal (no bloquea).
- **Eliminar una consulta**: botón «Eliminar» (admin y coordinador). Los datos ya guardados NO se borran; solo desaparece la consulta de la lista.
- **SQL**: `scripts/sql/14_consultas_expres.sql` (tablas `iu_consultas`, `iu_valores`, `iu_cambios`, con RLS). Hay que ejecutarlo en Supabase antes de usar la pantalla.
- **Archivos**: `src/routes/consultasExpres.js`, `src/services/consultasExpres.js`, `public/inspecciones/{consultas,consulta-llenar,cambios}.html`, `public/js/inspecciones-{consultas,consulta-llenar,cambios}.js`.
- **Pendiente (etapa 2)**: acceso del director con código DEA + clave única por plantel, límite de intentos y validaciones bloqueantes.

## 6d. Ingenieros: responsable, equipo y lista oficial
- Pantalla **Inspecciones → Ingenieros**. Por ingeniero: **a cargo** (columna RESPONSABLE de GESCOLAR; un solo ingeniero por plantel),
  **en equipo** (otros planteles donde participó) y **participación** = a cargo + en equipo. Insignias 1.º/2.º/3.º para los 3 valores
  más altos de «a cargo» (los empatados comparten insignia). Cada fila muestra la diferencia contra el promedio.
- **Equipo** = tabla `plantel_equipo` (se llena desde esta pantalla) **más** los ingenieros anotados en las planillas del plantel
  (`inspeccion_inspectores`). Si el equipo incluye al responsable no se cuenta dos veces.
- **Lista oficial** (`ingenieros_catalogo`, `scripts/sql/17_ingenieros_lista_equipo.sql`): con ingenieros activos en la lista, el
  responsable y el equipo solo se eligen de ella (también en Planes de atención). Si la lista queda vacía, vuelve a aceptar nombres libres.
  Solo `admin`: **Agregar**, **Editar** (cambia el nombre en la lista, en la columna RESPONSABLE de GESCOLAR, en equipos y en planillas;
  si GESCOLAR falla no se cambia nada), **Retirar/Reactivar** (conserva historial) y **Eliminar** (solo si no tiene nada registrado).
- **Dos grupos** (`ingenieros_catalogo.tipo`, `scripts/sql/18_ingenieros_tipo.sql`): **INGENIERO** (puede quedar a cargo de un plantel) y
  **APOYO** (personal en formación, administrativo o de sistemas: solo participa en equipos; el servidor no deja asignarlo como responsable).
  La pantalla muestra cada grupo por separado y lo compara contra su propio promedio: los ingenieros por planteles a cargo, el apoyo por
  planteles en equipo; cada grupo lleva sus insignias 1.º/2.º/3.º. El admin cambia el tipo en «Lista de ingenieros»
  (a APOYO solo si no tiene planteles a cargo). Sin el script 18 todos cuentan como INGENIERO.
- `admin` e `insp_coordinador`: «Asignar plantel» (con o sin plan), «Editar» y «Quitar» por plantel, «Historial de asignaciones»
  (`responsable_cambios`, `scripts/sql/16_responsable_cambios.sql`). Solo `admin`: «Corregir nombres» (valores de RESPONSABLE
  escritos distinto a la lista oficial, con sugerencia y sin escribir hasta aplicar).
- Backend en `src/routes/inspecciones.js` bajo `/ingenieros/...` (buscar-plantel, asignar-plantel, historial, catalogo, equipo,
  corregir-nombres) y `GET /resumen-ingenieros`. Orden de scripts SQL: 16, 17, 18, 19, 20 y 21.

## 6e. Ejecución (rehabilitación) por plantel dentro del plan
- Dos responsables distintos sobre un mismo plantel: el **responsable de la inspección** (RESPONSABLE de GESCOLAR; informe, materiales,
  archivos; no cambia) y el **ingeniero de rehabilitación** (por plantel y por plan, `plan_inspecciones.ingeniero_rehab`; se elige de la lista
  oficial y el personal de APOYO no puede serlo). Se asigna en **Planes de atención** (columna «Rehabilitación»).
- Cada plantel de un plan está **EN_EJECUCION** o **CERRADO** (`plan_inspecciones.ejecucion`, con `cerrado_en/cerrado_por`; reabrir deja
  `reabierto_en/reabierto_por`). Cierran: `admin`, `insp_coordinador` y el ingeniero de rehabilitación asignado (se reconoce porque el
  nombre de su cuenta coincide con el de la lista; lo hace desde **Mis planillas → Mis rehabilitaciones**). Reabren: `admin` e `insp_coordinador`.
- **Regla:** un plantel EN_EJECUCION en un plan no se puede agregar (ni volver a enlazar) a otro plan. Al cerrarlo queda libre; al agregarlo
  al plan nuevo se crea una planilla nueva y la anterior queda archivada. **Cerrado sigue sumando** en el consolidado de su plan
  (los consolidados solo excluyen los desenlazados). Con la ejecución cerrada no se cambia el ingeniero de rehabilitación.
- Script: `scripts/sql/19_ejecucion_plantel.sql` (ejecutar ANTES de publicar). Pendiente: avance en % por fase de rehabilitación.
- **Estadística por ingeniero** (pantalla Ingenieros, `GET /resumen-ingenieros`): cada ingeniero muestra inspecciones a cargo (GESCOLAR), rehabilitaciones en
  ejecución, rehabilitaciones cerradas, en equipo y participación (inspecciones a cargo + equipo; las rehabilitaciones no entran en ese total). Las rehabilitaciones salen de
  `plan_inspecciones.ingeniero_rehab` (los desenlazados no cuentan; un plantel en dos planes son dos rehabilitaciones) y se listan en el detalle con su plan y estado.

## 6f. Tipo de plan y planes históricos
- Cada plan tiene un **tipo** (`planes_atencion.tipo`): `BRICOMILES`, `GOTAS_DE_AMOR`, `ESCUELAS_VANDALIZADAS` o `ATENCION_ESPECIAL`
  (se elige al crear el plan y se cambia con «Editar nombre»). Los planes anteriores quedan como BRICOMILES.
- `plan_inspecciones.avance_historico` guarda el % de avance que tenía un plantel al cerrarse en un plan histórico (se muestra como
  «Avance al cerrar»). Es solo informativo.
- `scripts/sql/20_tipo_plan_y_avance_historico.sql` (columnas) y `21_carga_planes_2024.sql` (carga de BRICOMILES 2024, ESCUELAS VANDALIZADAS 2024 y
  GOTAS DE AMOR 2024: planteles con ejecución CERRADA, planilla vacía `origen = 'HISTORICA'` e ingeniero de rehabilitación del Plan Maestro).
  El script 21 se puede repetir sin duplicar. `23_bricomiles_2025_lista_oficial.sql` dejó BRICOMILES 2025 con una lista de 25 que luego resultó haber sido reducida; `24_bricomiles_2025_lista_dotacion.sql` lo corrige: el plan son los 17 planteles del archivo DOTACION_2025-2026 (vuelve a enlazar los que se habían sacado y desenlaza los 14 agregados si no tienen datos; sin borrar nada). `22_gotas_2024_siete_planteles.sql` agrega al plan GOTAS DE AMOR 2024 otros 7 planteles que GESCOLAR marca como Gota de Amor 2024 (plan con 20; cerrados, sin ingeniero ni porcentaje). Un plantel cerrado en un plan histórico puede entrar a un plan nuevo (se crea planilla nueva).
- Para que cuenten como atendidos con su año en el dashboard, el admin usa **Registrar plan en GESCOLAR** en cada plan.

## 6g. Dashboard: atendidos por programa
- **Atendido** = plantel con TIPO ATENCION, con una columna «PLAN …» marcada en la hoja, o enlazado a un plan del sistema (no desenlazado). Cuenta una sola vez
  aunque esté en varios programas, y no depende de haber pulsado «Registrar plan en GESCOLAR».
- Las barras son **programas** (`GET /dashboard` → `por_programa` y `cuadre`): **Gota de Amor** (la hoja «GOTA DE AMOR» y los planes de tipo Gotas de Amor, con el año dentro:
  el año sale de la columna AÑO de la hoja o del nombre del plan; «2023 - 2024» cuenta en ambos años), **PLAN MAESTRO 2024** (= «PLAN MAESTRO 2024» de la hoja y el plan «BRICOMILES 2024»),
  **Escuelas vandalizadas**, **BRICOMILES 2025**, **PRE 2026-2027** y cualquier otro plan por su nombre. Las fuentes se unen por nombre (`programaDe` en `inspecciones.js`).
- Línea de cuadre: suma de las barras − planteles repetidos entre programas = atendidos únicos.
- **El sistema manda:** si un plan existe en el sistema, el dashboard ignora su columna «PLAN …» de la hoja (puede traer marcas viejas de planteles que ya salieron del plan).
  Además, **Registrar plan en GESCOLAR** ahora vacía en esa columna las marcas de planteles que ya no están en el plan (la vista previa las lista antes de confirmar),
  así la hoja queda igual que el plan. Solo se toca la columna de ese plan.

## 6h. Avance de la rehabilitación por fases
- **Script `25_avance_fases_rehabilitacion.sql`** (ejecutar una vez en Supabase; debe responder «Success. No rows returned»): crea `fases_rehabilitacion` (fases con su peso; arranca con
  Cubierta de techo 30 %, Instalaciones eléctricas 20 %, Instalaciones sanitarias 20 %, Pintura interna/externa 20 %, Albañilería/herrería 10 %) y `avance_fases` (% de cada fase por plantel y plan).
  Sin el script la pantalla funciona igual que antes (simplemente no aparece el avance).
- **Fases y pesos** (botón en la pantalla de un plan; admin y coordinador): se pueden renombrar, cambiar el peso, agregar (hasta 12) y quitar. **Los pesos deben sumar exactamente 100 %**
  (si no, no deja guardar). Cambiar un peso recalcula el avance de todos los planteles; una fase quitada queda inactiva (no se borra lo registrado) y deja de contar.
- **Registrar avance** (botón por plantel; admin, coordinador y el ingeniero de rehabilitación asignado, también desde «Mis planillas»): % de 0 a 100 por fase, o «No aplica».
  Se bloquea si la ejecución del plantel o el plan están cerrados (hay que reabrirlos).
- **Cálculo:** avance del plantel = Σ(% de la fase × peso) / Σ(peso de las fases que aplican); una fase «No aplica» reparte su peso entre las demás; una fase sin registrar cuenta 0 %.
  Si el plantel no tiene nada registrado, se muestra su avance histórico (planes viejos) o 0 %. **Avance del plan = promedio de sus planteles activos** (cada plantel pesa igual).
- API: `GET/PUT /api/inspecciones/fases-rehabilitacion`, `PUT /api/inspecciones/planes/:id/planteles/:inspeccionId/avance`; `GET /planes/:id` y `GET /mis-rehabilitaciones` devuelven `avance`, `fases` y (planes) `plan.avance`.
- Archivos: `src/routes/inspecciones.js`, `public/js/inspecciones-avance.js` (ventanas compartidas), `inspecciones-planes.js`, `inspecciones-mis-planillas.js`.
- Pruebas: `test33` (58 comprobaciones con PostgreSQL real y pantallas simuladas).
- **Exportar avance (Excel):** botón en la pantalla del plan (`GET /planes/:id/avance.xlsx`; lo descargan admin, coordinador, consulta y operador de plantel). Una fila por plantel activo (estado, municipio, parroquia, código DEA, nombre), el % de cada fase y el avance general, con los logos oficiales; sin iniciar = 0 %, «N/A» si la fase no aplica, «—» en planes históricos (solo tienen el avance al cerrar). Última fila: avance del plan. Servicio `avancePlan` en `src/services/exportarExcel.js`; prueba `test34` (16 comprobaciones).

## 6i. Respaldo de los datos de Supabase
- Menú **Administración → Respaldo de datos** (solo admin; `public/respaldo.html`, `src/routes/respaldo.js`, `GET /api/respaldo/resumen` y `/descargar`). Un clic descarga `RESPALDO_SID_<fecha>.zip` con **todas las tablas** del esquema `public` salvo `personal_ministerio` (nómina, 137 MB; decisión del usuario).
- Contenido del ZIP: `LEEME.txt`, `manifiesto.csv` (filas por tabla, para comprobar), `restaurar.psql` y `tablas/<tabla>.csv` (UTF-8, coma, encabezado; NULL = vacío, texto vacío = `""`). Incluye `usuarios` (contraseñas cifradas) y `rac`. Las columnas generadas (p. ej. `infraestructuras.codigo`) no se exportan: Postgres las recalcula.
- Se lee todo en una sola transacción de solo lectura (foto consistente) y se comprime al vuelo (poca memoria en Render).
- **Restaurar:** (1) crear las tablas vacías con `schema.sql` y los scripts de `scripts/sql/` (en orden); (2) en la carpeta del ZIP descomprimido: `psql "<conexión de Supabase>" -f restaurar.psql` (carga en el orden de las claves foráneas, dentro de una transacción, y ajusta los contadores de ids); (3) comparar con `manifiesto.csv`. Sin psql: Table Editor de Supabase → Import data from CSV, en el orden de `restaurar.psql`.
- **Qué NO cubre:** nada de Google Drive/Sheets (GESCOLAR, Coordenadas Planteles, archivos de planteles) — eso se respalda desde Drive; ni `personal_ministerio`.
- **Cuidado:** el ZIP trae contraseñas cifradas, cédulas y teléfonos: guardarlo en un lugar privado. Recomendación: uno al mes, conservar los últimos tres.
- Dependencia nueva declarada: `archiver`. Prueba `test35` (26 comprobaciones; incluye restaurar en una base vacía y comprobar que todas las tablas quedan idénticas).

## 6j. Dotaciones (solicitud de dotación por plantel)
- **Script `26_dotaciones.sql`** (ejecutar una vez en Supabase; debe responder «Success. No rows returned»): crea `dotacion_rubros` (catálogo editable, sembrado con 33 rubros de mobiliario/cocina, 9 de CBIT y 1 de mantenimiento), `dotaciones` (una por plantel y plan) y `dotacion_items` (cantidad o «NO»).
- Sirve para planes de rehabilitación y para planes «solo dotación» (se usa el tipo ATENCION_ESPECIAL): un plantel puede pedir dotación sin haber sido rehabilitado.
- Pantallas (`public/inspecciones/`): cada plantel del plan tiene su botón «Dotación» (abre la planilla de dotación y, si no existe, la crea sola); el botón «Crear dotación de todos» (arriba, en el plan) crea de golpe una planilla vacía por cada plantel activo, sin tocar las existentes. `dotaciones.html` (botón «Dotación» arriba en el plan: lista de solicitudes, agregar plantel desde GESCOLAR, consolidado rubros × planteles, catálogo de rubros) y `dotacion.html` (la solicitud: cabecera editable, cantidades a mano o «NO», fecha, observaciones). Todas las cantidades son manuales.
- Excel: individual en el formato «SOLICITUD DE DOTACIÓN» (con logos; solo imprime rubros con cantidad o «NO») y consolidado del plan. Código: `src/routes/dotaciones.js`, `src/services/exportarExcel.js` (`dotacionIndividual`, `dotacionConsolidado`).
- Permisos: admin y coordinador gestionan (agregar/quitar planteles, catálogo); el ingeniero de inspección (el de la planilla asignada) crea y llena la dotación de una vez desde «Mis planillas», y el ingeniero de rehabilitación del plantel puede modificar cualquier rubro; consulta y operador de plantel solo ven. Con el plan cerrado nada se modifica.
- Un rubro retirado del catálogo sigue apareciendo en las solicitudes y consolidados que ya lo usaban.

## 7. Módulos de consulta de planteles

- `plantelesConsulta.js`: ficha por DEA con archivos de Drive, fachada
  (`FACHADA_<código>.<ext>`), mapa, coordenadas manuales (admin y `operador_plantel`).
  Eliminar un archivo lo manda a la **papelera de Drive** (recuperable ~30 días); solo
  permite archivos que estén dentro de la carpeta de ese plantel.
- `directorioDirectores.js`: edita solo las columnas del director en GESCOLAR.
  **«Actualizar con los datos de Supervisión»** (solo admin, en la pantalla de RAC): compara GESCOLAR con la tabla
  `directores_supervision` y, tras una vista previa, escribe en la hoja. Reglas (`src/services/directoresSupervision.js`):
  cédula DISTINTA → se reemplaza todo (nombre, cédula, teléfonos y correo; lo que Supervisión no tenga queda vacío);
  cédula igual → solo se completan vacíos (nombre incompleto, teléfono vacío); lo demás no se toca. Teléfonos en formato
  de la hoja (10 dígitos sin el 0 inicial; móvil y fijo). Cada aplicación queda en `directorio_sincronizaciones`
  (`scripts/sql/15_directorio_sincronizaciones.sql`, con valores anteriores) y se puede **Restaurar** (respeta lo que
  alguien haya editado después). Aplicar dos veces no repite cambios.
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
- Inspecciones, Instrumento Uno e Infraestructuras se probaron durante el desarrollo con PostgreSQL 16 local,
  googleapis simulado y jsdom; **esas pruebas no están en el repo**. Nunca se probó contra
  Google real fuera de producción: ante un cambio, probar a mano en pantalla (crear visita,
  enviar, ver edificios, descargar Excel).
- Lo que no se pudo verificar: aspecto en teléfono real, impresión a PDF real.

## 10. Pendientes (a 2026-11-02)

- Pantalla para unificar edificios en conflicto (409) y, opcional, migrar los códigos antiguos de la hoja a INFRA-….
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
