const express = require('express');
const multer = require('multer');
const iconv = require('iconv-lite');
const router = express.Router();

const { conTransaccionAuditada } = require('../db/pool');
const { requireAuth, requireRol } = require('../middleware/auth');
// CORRECCIÓN (2026-09-12): antes el archivo se partía en "líneas" con
// `contenido.split(/\r?\n/)`, un split crudo que no distingue si ese salto
// de línea está DENTRO de una celda entre comillas (ej. un nombre escrito
// en dos líneas dentro de la misma celda de Excel) o si es el fin real de
// una fila del CSV. El usuario detectó 131 celdas así en un archivo real
// (nombres, cargos, especialidades con un Enter metido adentro) -- cada una
// partía una fila legítima en dos "filas" falsas, y el resto del código las
// procesaba como registros independientes sin sentido (una mitad con
// cédula, la otra huérfana).
//
// `parsearCSV` reemplaza ese split por un parser que respeta comillas
// (RFC4180). Se movió a `src/utils/csv.js` (2026-09-12) para compartirlo
// con la nueva herramienta "Depurar archivo" (src/routes/depurarArchivo.js),
// que analiza el archivo con exactamente la misma lógica antes de la carga.
const { parsearCSV } = require('../utils/csv');

const upload = multer({ storage: multer.memoryStorage() });

function limpiar(valor) {
  if (valor === undefined || valor === null) return null;
  // CORRECCIÓN (2026-09-12): además de recortar espacios al inicio/fin,
  // ahora colapsa cualquier salto de línea u otro espacio en blanco interno
  // (el que puede quedar DENTRO del valor por una celda con Enter embebido,
  // ver nota de parsearCSV arriba) a un solo espacio. Antes solo se hacía
  // `.trim()`, que no toca espacios/saltos de línea en medio del texto.
  const v = valor.toString().replace(/\s+/g, ' ').trim();
  return v === '' ? null : v;
}

function parseNumero(valor) {
  const v = limpiar(valor);
  if (v === null) return null;
  const n = parseFloat(v.replace(',', '.'));
  return isNaN(n) ? null : n;
}

// Límites reales definidos en los CHECK constraints de la tabla rac
// (rac_horas_academicas_check: 0-53.33, rac_horas_adm_check: 0-168).
// Si el valor del archivo viene fuera de rango (ej. error de punto decimal
// del archivo fuente), no se escribe en esa columna -- se deja null y se
// genera una alerta para que se corrija a mano, en vez de adivinar la
// corrección o tumbar toda la fila.
const LIMITE_HORAS_ACADEMICAS = 53.33;
const LIMITE_HORAS_ADM = 168;

function validarRangoHoras(cedula, codigoPlantelArchivo, nuevo) {
  const alertasRango = [];

  if (nuevo.horas_academicas !== null && (nuevo.horas_academicas < 0 || nuevo.horas_academicas > LIMITE_HORAS_ACADEMICAS)) {
    alertasRango.push({
      tipo: 'valor_fuera_de_rango',
      detalle: `horas_academicas fuera de rango (valor recibido: ${nuevo.horas_academicas}, máximo permitido: ${LIMITE_HORAS_ACADEMICAS}) en el plantel ${codigoPlantelArchivo} — se guardó vacío, corregir en el archivo fuente`,
    });
    nuevo.horas_academicas = null;
  }

  if (nuevo.horas_adm !== null && (nuevo.horas_adm < 0 || nuevo.horas_adm > LIMITE_HORAS_ADM)) {
    alertasRango.push({
      tipo: 'valor_fuera_de_rango',
      detalle: `horas_adm fuera de rango (valor recibido: ${nuevo.horas_adm}, máximo permitido: ${LIMITE_HORAS_ADM}) en el plantel ${codigoPlantelArchivo} — se guardó vacío, corregir en el archivo fuente`,
    });
    nuevo.horas_adm = null;
  }

  return alertasRango;
}

// MEJORA 5: insertarAlerta ahora acepta un 5to parámetro opcional
// detalleFila (objeto JS) que se guarda como JSONB en alertas.detalle_fila.
// Todas las llamadas que no lo pasan siguen funcionando igual, guardando
// null en esa columna -- no rompe nada de lo existente.
async function insertarAlerta(client, tipo, cedula, detalle, detalleFila = null) {
  await client.query(
    `INSERT INTO alertas (tipo, cedula, detalle, detalle_fila, estado, creado_en)
     VALUES ($1, $2, $3, $4, 'pendiente', now())`,
    [tipo, cedula, detalle, detalleFila ? JSON.stringify(detalleFila) : null]
  );
}

// POST /api/rac/cargar-completo  (solo admin)
// Recibe el archivo CSV completo del RAC (mismas columnas que envía la oficina
// central) y sincroniza contra la tabla rac:
//  - cedula + plantel_id existe y hay cambios  -> UPDATE + alerta "registro_actualizado"
//  - cedula + plantel_id existe sin cambios    -> no hace nada
//  - cedula + plantel_id no existe             -> INSERT (valida cédula contra
//                                                  personal_ministerio; si no
//                                                  existe, alerta "cedula_no_existe_nomina")
//
// NOTA: la validación de "registros que estaban en rac pero no aparecieron en
// esta carga" YA NO corre aquí -- se movió al endpoint separado y manual
// POST /verificar-obsoletos, porque si el archivo completo se sube partido en
// varios pedazos, cada pedazo solo trae una fracción de las cédulas y esta
// carga por sí sola no puede saber qué registros son realmente obsoletos.
//
// OPTIMIZACIÓN: en vez de consultar la BD fila por fila (buscar plantel,
// buscar si ya existe, validar nómina = ~4 consultas x fila), se precargan
// UNA sola vez en memoria: el catálogo de planteles (código -> id), el set
// de cédulas de personal_ministerio, y el estado actual completo de la tabla
// rac (clave cedula|plantel_id -> registro). Así el bucle por fila ya no
// consulta la BD salvo para el INSERT/UPDATE final.
//
// MEJORA (2026-09-10): se agrega la tabla mapeo_codigos_plantel, precargada
// en memoria igual que el catálogo de planteles. Antes de darse por vencido
// con un código que no matchea, se revisa si ese código exacto tiene un
// mapeo conocido (típicamente typos de un carácter en el código de plantel
// del archivo fuente); si lo tiene, se usa el código correcto de forma
// transparente y la fila se procesa normal, SIN generar la alerta
// plantel_no_existe. El código real usado (ya corregido) es el que se
// guarda en `rac.plantel_id` -- el archivo fuente sigue trayendo el código
// viejo, pero eso ya no importa para futuras cargas del mismo archivo.
//
// COLUMNAS ADICIONALES (agregadas para soportar la exportación completa del
// RAC en el mismo formato de carga): el archivo trae varias columnas que
// antes se leían y se descartaban (NIVEL, MODALIDAD, UBICACION GEOGRAFICA,
// TURNOS QUE ATIENDE EL PLANTEL, CODIGO ESTADISTICO, FECHA DE INGRESO, SEXO,
// GRADO QUE IMPARTE EL DOCENTE, SECCION, ESPECIALIDAD QUE IMPARTE EL DOCENTE,
// AÑO, SECCIONES, MATERIA QUE IMPARTE O ESPECIALIDAD, PERIODO O GRUPO,
// OBSERVACION, EDAD, COMPARATIVA). Por decisión del usuario (simplicidad),
// todas se guardan directo en `rac` como texto libre, aunque algunas
// (NIVEL/MODALIDAD/UBICACION GEOGRAFICA/TURNOS QUE ATIENDE EL PLANTEL) se
// repitan idénticas en cada fila del mismo plantel.
router.post(
  '/cargar-completo',
  requireAuth,
  requireRol('admin'),
  upload.single('archivo'),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No se envió ningún archivo' });
    }

    try {
      const contenido = iconv.decode(req.file.buffer, 'latin1');
      // CORRECCIÓN (2026-09-12): `filas` ahora es un arreglo de arreglos de
      // columnas (ya parseado respetando comillas), no un arreglo de líneas
      // de texto crudo -- ver parsearCSV arriba. Se descartan filas
      // completamente vacías (una sola columna vacía) que puede dejar el
      // parser al final del archivo.
      const filas = parsearCSV(contenido, ';').filter(
        (cols) => !(cols.length === 1 && (cols[0] === undefined || cols[0].trim() === ''))
      );
      if (filas.length < 2) {
        return res.status(400).json({ error: 'El archivo está vacío o no tiene filas de datos' });
      }

      const encabezados = filas[0].map((h) => h.trim().toUpperCase());

      const idx = {
        cedula: encabezados.indexOf('CEDULA'),
        codigoPlantel: encabezados.indexOf('CODIGO DEL PLANTEL'),
        codigoDependencia: encabezados.indexOf('CODIGO DEPENDENCIA'),
        codigoRac: encabezados.indexOf('CODIGO RAC'),
        cargo: encabezados.indexOf('CARGO'),
        tipoPersonal: encabezados.indexOf('TIPO DE PERSONAL'),
        turno: encabezados.indexOf('TURNO QUE ATIENDE'),
        horasAcademicas: encabezados.indexOf('HORAS ACADEMICAS'),
        horasAdm: encabezados.indexOf('HORAS ADM'),
        situacion: encabezados.indexOf('SITUACION DEL TRABAJADOR'),
        // Columnas adicionales (antes se descartaban)
        nivel: encabezados.indexOf('NIVEL'),
        modalidad: encabezados.indexOf('MODALIDAD'),
        ubicacionGeografica: encabezados.indexOf('UBICACION GEOGRAFICA'),
        turnosPlantel: encabezados.indexOf('TURNOS QUE ATIENDE EL PLANTEL'),
        codigoEstadistico: encabezados.indexOf('CODIGO ESTADISTICO'),
        fechaIngreso: encabezados.indexOf('FECHA DE INGRESO'),
        sexo: encabezados.indexOf('SEXO'),
        gradoImparte: encabezados.indexOf('GRADO QUE IMPARTE EL DOCENTE'),
        seccion: encabezados.indexOf('SECCION'),
        especialidad: encabezados.indexOf('ESPECIALIDAD QUE IMPARTE EL DOCENTE'),
        anio: encabezados.indexOf('AÑO'),
        secciones: encabezados.indexOf('SECCIONES'),
        materia: encabezados.indexOf('MATERIA QUE IMPARTE O ESPECIALIDAD'),
        periodoGrupo: encabezados.indexOf('PERIODO O GRUPO'),
        observacion: encabezados.indexOf('OBSERVACION'),
        edad: encabezados.indexOf('EDAD'),
        comparativa: encabezados.indexOf('COMPARATIVA'),
      };

      for (const [campo, columna] of Object.entries(idx)) {
        if (columna === -1) {
          return res.status(400).json({
            error: `No se encontró en el archivo la columna requerida para "${campo}"`,
          });
        }
      }

      // MEJORA 8b (2026-09-09): el archivo real del RAC trae una columna
      // "NOMBRE Y APELLIDO" que hasta ahora nunca se leía -- todo el nombre
      // dependía solo del cruce contra la nómina del Ministerio, así que
      // una cédula que no estuviera ahí se quedaba SIEMPRE sin nombre,
      // aunque el archivo del RAC sí lo trajera escrito. Se lee aparte de
      // `idx` (NO es obligatoria) para no romper cargas de archivos que no
      // la traigan -- si no está, idxNombreApellido queda en -1 y
      // simplemente no se usa.
      const idxNombreApellido = encabezados.indexOf('NOMBRE Y APELLIDO');

      const camposComparables = [
        'codigo_dependencia',
        'codigo_cargo',
        'cargo',
        'tipo_personal',
        'turno',
        'horas_academicas',
        'horas_adm',
        'situacion',
        'nivel',
        'modalidad',
        'ubicacion_geografica',
        'turnos_plantel',
        'codigo_estadistico',
        'fecha_ingreso',
        'sexo',
        'grado_imparte',
        'seccion',
        'especialidad',
        'anio',
        'secciones',
        'materia',
        'periodo_grupo',
        'observacion',
        'edad',
        'comparativa',
      ];

      // horas_academicas/horas_adm son NUMERIC en Postgres y vuelven como
      // texto con decimales fijos (ej. "40.00"), mientras que el valor
      // parseado del archivo es un número simple (40). Comparar con
      // toString() los marcaría como "cambiados" aunque sean el mismo valor
      // -- por eso estos dos campos se comparan numéricamente, no como texto.
      const camposNumericos = new Set(['horas_academicas', 'horas_adm']);

      function huboCambioEnCampo(campo, valorActual, valorPropuesto) {
        if (camposNumericos.has(campo)) {
          const actualNum =
            valorActual === null || valorActual === undefined || valorActual === ''
              ? null
              : parseFloat(valorActual);
          const propuestoNum =
            valorPropuesto === null || valorPropuesto === undefined || valorPropuesto === ''
              ? null
              : parseFloat(valorPropuesto);
          if (actualNum === null && propuestoNum === null) return false;
          if (actualNum === null || propuestoNum === null) return true;
          return Math.abs(actualNum - propuestoNum) > 0.001;
        }

        const actualStr =
          valorActual === null || valorActual === undefined ? null : valorActual.toString();
        const propuestoStr =
          valorPropuesto === null || valorPropuesto === undefined ? null : valorPropuesto.toString();
        return actualStr !== propuestoStr;
      }

      const resultado = await conTransaccionAuditada(req.usuario.id, async (client) => {
        // --- Precarga en memoria (una sola consulta cada una) ---
        // IMPORTANTE: estas consultas van SECUENCIALES (await una por una),
        // no en paralelo con Promise.all -- el driver "pg" no permite correr
        // varias queries a la vez sobre el mismo cliente/conexión (eso genera
        // "client.query() when the client is already executing a query",
        // y puede tumbar el proceso). Al ir secuenciales cada una tarda lo
        // mismo, pero solo son unas pocas consultas en total, así que el
        // costo extra es mínimo frente al riesgo de correrlas en paralelo.
        const plantelesRes = await client.query('SELECT id, codigo_plantel FROM planteles');
        // MEJORA (2026-09-10): tabla de mapeo de códigos de plantel con
        // errores conocidos (típicamente typos de un carácter), curada a
        // mano por el usuario tras auditar las alertas plantel_no_existe.
        const mapeoRes = await client.query(
          'SELECT codigo_incorrecto, codigo_correcto FROM mapeo_codigos_plantel'
        );
        // FIX (2026-09-09): esta consulta antes traía TODA `personal_ministerio`
        // (~789.559 filas) con cedula+nombres+apellidos, para poder sincronizar
        // nombres/apellidos (Mejora 8). Eso reventó la memoria del proceso en
        // Render ("JavaScript heap out of memory", 502) -- antes solo se traía
        // la columna `cedula` (liviana), y agregar nombres/apellidos para las
        // 789 mil filas multiplicó el uso de memoria varias veces.
        // Se corrige acotando la consulta SOLO a las cédulas que vienen en
        // ESTE pedazo del archivo (unas pocas miles, no 789 mil) -- es lo
        // único que este pedazo puede llegar a necesitar.
        const cedulasEnEstePedazo = [...new Set(
          filas.slice(1)
            .map((cols) => limpiar(cols[idx.cedula]))
            .filter(Boolean)
        )];
        const personalRes = cedulasEnEstePedazo.length
          ? await client.query(
              'SELECT cedula, nombres, apellidos FROM personal_ministerio WHERE cedula = ANY($1)',
              [cedulasEnEstePedazo]
            )
          : { rows: [] };
        const racRes = await client.query('SELECT * FROM rac');

        const mapaPlanteles = new Map(
          plantelesRes.rows.map((p) => [p.codigo_plantel, p.id])
        );
        const mapaMapeoCodigos = new Map(
          mapeoRes.rows.map((m) => [m.codigo_incorrecto, m.codigo_correcto])
        );
        // MEJORA 8 (2026-09-09): antes era un Set (solo existencia). Ahora
        // guarda también nombres/apellidos, porque la nómina del Ministerio
        // es la fuente confiable (se exporta directo de su sistema) frente
        // al RAC (armado a mano en Excel, más propenso a errores de dedo en
        // la cédula) -- ver razonamiento completo más abajo, donde se usa.
        const mapaNomina = new Map(
          personalRes.rows.map((p) => [p.cedula, { nombres: p.nombres, apellidos: p.apellidos }])
        );
        const mapaRac = new Map(
          racRes.rows.map((r) => [`${r.cedula}|${r.plantel_id}`, r])
        );

        let insertados = 0;
        let actualizados = 0;
        let sinCambios = 0;
        let filasConError = 0;
        let lineasVaciasIgnoradas = 0;
        let alertasGeneradas = 0;

        for (let i = 1; i < filas.length; i++) {
          const cols = filas[i];

          // Excel suele arrastrar formato mucho más allá de la última fila
          // con datos reales al exportar a CSV, dejando miles de líneas que
          // son solo separadores ";;;;;;" sin ningún valor. Esas se saltan
          // en silencio -- no son un error del archivo, son ruido inofensivo
          // de la exportación.
          const lineaCompletamenteVacia = cols.every((c) => limpiar(c) === null);
          if (lineaCompletamenteVacia) {
            lineasVaciasIgnoradas++;
            continue;
          }

          const cedula = limpiar(cols[idx.cedula]);
          const codigoPlantelArchivo = limpiar(cols[idx.codigoPlantel]);
          // MEJORA 8b: valor crudo de "NOMBRE Y APELLIDO" tal como viene en
          // esta fila del archivo (null si la columna no existe en este
          // archivo, o si la celda viene vacía).
          const nombreApellidoArchivo =
            idxNombreApellido !== -1 ? limpiar(cols[idxNombreApellido]) : null;

          // MEJORA 6 (2026-09-07): `nuevo` se arma AQUÍ, antes de chequear si
          // falta cédula/plantel (antes se armaba después), para que la
          // alerta "fila_incompleta" también pueda guardar la fila completa
          // y editable en detalle_fila -- igual que ya hace "plantel_no_existe" --
          // en vez de solo la línea cruda del CSV.
          const nuevo = {
            codigo_dependencia: limpiar(cols[idx.codigoDependencia]),
            codigo_cargo: limpiar(cols[idx.codigoRac]),
            cargo: limpiar(cols[idx.cargo]),
            tipo_personal: limpiar(cols[idx.tipoPersonal]),
            turno: limpiar(cols[idx.turno]),
            horas_academicas: parseNumero(cols[idx.horasAcademicas]),
            horas_adm: parseNumero(cols[idx.horasAdm]),
            situacion: limpiar(cols[idx.situacion]),
            nivel: limpiar(cols[idx.nivel]),
            modalidad: limpiar(cols[idx.modalidad]),
            ubicacion_geografica: limpiar(cols[idx.ubicacionGeografica]),
            turnos_plantel: limpiar(cols[idx.turnosPlantel]),
            codigo_estadistico: limpiar(cols[idx.codigoEstadistico]),
            fecha_ingreso: limpiar(cols[idx.fechaIngreso]),
            sexo: limpiar(cols[idx.sexo]),
            grado_imparte: limpiar(cols[idx.gradoImparte]),
            seccion: limpiar(cols[idx.seccion]),
            especialidad: limpiar(cols[idx.especialidad]),
            anio: limpiar(cols[idx.anio]),
            secciones: limpiar(cols[idx.secciones]),
            materia: limpiar(cols[idx.materia]),
            periodo_grupo: limpiar(cols[idx.periodoGrupo]),
            observacion: limpiar(cols[idx.observacion]),
            edad: limpiar(cols[idx.edad]),
            comparativa: limpiar(cols[idx.comparativa]),
            // MEJORA 8 (2026-09-09): si la cédula está en la nómina del
            // Ministerio, se traen sus nombres/apellidos aquí mismo (fuente
            // más confiable, siempre manda si hay match).
            // MEJORA 8b: si NO está en la nómina, se usa como respaldo la
            // columna "NOMBRE Y APELLIDO" del propio archivo del RAC (menos
            // confiable -- se escribe a mano -- pero mejor que dejarlo
            // vacío). Se guarda todo en `nombres` (un solo campo de texto
            // libre en el archivo, sin separar apellidos). Si tampoco hay
            // nada ahí, queda en null -- el INSERT/UPDATE más abajo decide
            // qué hacer con ese null (nunca sobrescribe con null lo que ya
            // tuviera `rac` cuando no hay ningún match).
            nombres: mapaNomina.get(cedula)?.nombres ?? nombreApellidoArchivo ?? null,
            apellidos: mapaNomina.get(cedula)?.apellidos ?? null,
          };

          if (!cedula || !codigoPlantelArchivo) {
            // MEJORA 6 (2026-09-07): antes esta fila se descartaba en
            // silencio (solo sumaba a filasConError, sin dejar rastro de
            // cuál era ni por qué). Ahora se genera una alerta trazable,
            // con la fila ya parseada (editable desde el modal de alta) y
            // la línea cruda como respaldo.
            const camposFaltantes = [];
            if (!cedula) camposFaltantes.push('CEDULA');
            if (!codigoPlantelArchivo) camposFaltantes.push('CODIGO DEL PLANTEL');
            await insertarAlerta(
              client,
              'fila_incompleta',
              cedula || '(sin cédula)',
              `Fila del archivo sin ${camposFaltantes.join(' y ')} — no se pudo procesar`,
              { ...nuevo, codigo_plantel_intentado: codigoPlantelArchivo, camposFaltantes, filaCruda: cols.join(';') }
            );
            alertasGeneradas++;
            filasConError++;
            continue;
          }

          // MEJORA (2026-09-10): si el código tal como viene en el archivo
          // no matchea directo contra el catálogo, se revisa si existe un
          // mapeo conocido para ese código exacto (typo curado a mano) antes
          // de darse por vencido. Si lo hay, se usa el código correcto de
          // forma transparente -- la fila se procesa como si el archivo
          // hubiera traído el código bueno desde el principio.
          let codigoPlantelUsado = codigoPlantelArchivo;
          if (!mapaPlanteles.has(codigoPlantelUsado) && mapaMapeoCodigos.has(codigoPlantelUsado)) {
            codigoPlantelUsado = mapaMapeoCodigos.get(codigoPlantelUsado);
          }

          const plantelId = mapaPlanteles.get(codigoPlantelUsado);

          if (plantelId === undefined) {
            // MEJORA 5: se guarda la fila completa (más el código de plantel
            // que vino en el archivo, como referencia) en detalle_fila, para
            // que el botón "Revisar" de la bandeja de alertas pueda abrir un
            // formulario de alta manual precargado con todos estos datos.
            await insertarAlerta(
              client,
              'plantel_no_existe',
              cedula,
              `Código de plantel "${codigoPlantelArchivo}" no existe en el catálogo maestro`,
              { ...nuevo, codigo_plantel_intentado: codigoPlantelArchivo }
            );
            alertasGeneradas++;
            filasConError++;
            continue;
          }

          const alertasRango = validarRangoHoras(cedula, codigoPlantelArchivo, nuevo);

          const claveExistente = `${cedula}|${plantelId}`;
          const existente = mapaRac.get(claveExistente);

          if (existente) {
            const huboCambio = camposComparables.some((campo) =>
              huboCambioEnCampo(campo, existente[campo], nuevo[campo])
            );

            // MEJORA 8 (2026-09-09): nombres/apellidos se sincronizan
            // SIEMPRE que la cédula esté en la nómina (fuente confiable,
            // autocorrige con el tiempo nombres que hayan quedado mal por
            // errores de dedo en cargas anteriores), INDEPENDIENTE de si
            // hubo cambios en camposComparables -- si no fuera así, una
            // fila sin ningún otro cambio ese día nunca llegaría a
            // corregir su nombre. Si la cédula NO está en la nómina, se
            // deja tal cual lo que ya tenía `rac` (nunca se pisa con null
            // ni se inventa nada) -- la alerta cedula_no_existe_nomina es
            // la que avisa que hace falta revisar esa cédula a mano.
            // MEJORA 8b: si la cédula está en la nómina, esa manda siempre
            // (igual que antes). Si NO está, se usa el respaldo del propio
            // archivo del RAC SOLO si el registro todavía no tenía nombre
            // guardado -- así no se pisa una corrección manual hecha desde
            // "Consultar RAC" con un valor menos confiable del archivo.
            const nombresFinal = mapaNomina.has(cedula)
              ? nuevo.nombres
              : nombreApellidoArchivo && !existente.nombres
              ? nombreApellidoArchivo
              : existente.nombres;
            const apellidosFinal = mapaNomina.has(cedula) ? nuevo.apellidos : existente.apellidos;

            if (huboCambio) {
              await client.query(
                `UPDATE rac SET
                  codigo_dependencia = $1,
                  codigo_cargo = $2,
                  cargo = $3,
                  tipo_personal = $4,
                  turno = $5,
                  horas_academicas = $6,
                  horas_adm = $7,
                  situacion = $8,
                  nivel = $9,
                  modalidad = $10,
                  ubicacion_geografica = $11,
                  turnos_plantel = $12,
                  codigo_estadistico = $13,
                  fecha_ingreso = $14,
                  sexo = $15,
                  grado_imparte = $16,
                  seccion = $17,
                  especialidad = $18,
                  anio = $19,
                  secciones = $20,
                  materia = $21,
                  periodo_grupo = $22,
                  observacion = $23,
                  edad = $24,
                  comparativa = $25,
                  nombres = $26,
                  apellidos = $27,
                  actualizado_en = now(),
                  visto_en = now()
                 WHERE id = $28`,
                [
                  nuevo.codigo_dependencia,
                  nuevo.codigo_cargo,
                  nuevo.cargo,
                  nuevo.tipo_personal,
                  nuevo.turno,
                  nuevo.horas_academicas,
                  nuevo.horas_adm,
                  nuevo.situacion,
                  nuevo.nivel,
                  nuevo.modalidad,
                  nuevo.ubicacion_geografica,
                  nuevo.turnos_plantel,
                  nuevo.codigo_estadistico,
                  nuevo.fecha_ingreso,
                  nuevo.sexo,
                  nuevo.grado_imparte,
                  nuevo.seccion,
                  nuevo.especialidad,
                  nuevo.anio,
                  nuevo.secciones,
                  nuevo.materia,
                  nuevo.periodo_grupo,
                  nuevo.observacion,
                  nuevo.edad,
                  nuevo.comparativa,
                  nombresFinal,
                  apellidosFinal,
                  existente.id,
                ]
              );

              await insertarAlerta(
                client,
                'registro_actualizado',
                cedula,
                `Se detectaron cambios en el registro del plantel ${codigoPlantelUsado} para esta cédula (rac.id=${existente.id})`
              );
              actualizados++;
              alertasGeneradas++;

              // Mantiene la copia en memoria al día por si la misma clave
              // vuelve a aparecer más adelante en el mismo archivo.
              mapaRac.set(claveExistente, { ...existente, ...nuevo, nombres: nombresFinal, apellidos: apellidosFinal });
            } else if (nombresFinal !== existente.nombres || apellidosFinal !== existente.apellidos) {
              // MEJORA 8: no hubo cambios en los campos "normales", pero sí
              // hace falta sincronizar nombres/apellidos desde la nómina
              // (ver comentario arriba). Se aprovecha la misma consulta
              // para marcar visto_en, igual que el caso sin cambios de
              // abajo.
              await client.query(
                'UPDATE rac SET nombres = $1, apellidos = $2, visto_en = now() WHERE id = $3',
                [nombresFinal, apellidosFinal, existente.id]
              );
              mapaRac.set(claveExistente, { ...existente, nombres: nombresFinal, apellidos: apellidosFinal });
              sinCambios++;
            } else {
              // Aunque no hubo cambios en los datos, esta fila SÍ apareció en
              // la carga -- se marca visto_en para que /verificar-obsoletos
              // no confunda "sin cambios" (sigue vigente) con "no visto"
              // (candidato real a baja). No se toca actualizado_en porque el
              // dato en sí no cambió.
              await client.query('UPDATE rac SET visto_en = now() WHERE id = $1', [existente.id]);
              sinCambios++;
            }
          } else {
            // FIX: el INSERT tiene 29 columnas (cedula...comparativa +
            // actualizado_en + visto_en) pero antes la lista de VALUES solo
            // llegaba a $26 y saltaba directo a now(), now() -- le faltaba
            // el placeholder $27 para "comparativa". Eso hacía que Postgres
            // rechazara SIEMPRE este INSERT con "INSERT has more target
            // columns than expressions" (código 42601), sin importar el
            // contenido del archivo ni el tamaño del pedazo subido.
            const insertRes = await client.query(
              `INSERT INTO rac
                (cedula, plantel_id, codigo_dependencia, codigo_cargo, cargo, tipo_personal, turno,
                 horas_academicas, horas_adm, situacion, nivel, modalidad, ubicacion_geografica,
                 turnos_plantel, codigo_estadistico, fecha_ingreso, sexo, grado_imparte, seccion,
                 especialidad, anio, secciones, materia, periodo_grupo, observacion, edad, comparativa,
                 nombres, apellidos, actualizado_en, visto_en)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
                       $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, now(), now())
               RETURNING id`,
              [
                cedula,
                plantelId,
                nuevo.codigo_dependencia,
                nuevo.codigo_cargo,
                nuevo.cargo,
                nuevo.tipo_personal,
                nuevo.turno,
                nuevo.horas_academicas,
                nuevo.horas_adm,
                nuevo.situacion,
                nuevo.nivel,
                nuevo.modalidad,
                nuevo.ubicacion_geografica,
                nuevo.turnos_plantel,
                nuevo.codigo_estadistico,
                nuevo.fecha_ingreso,
                nuevo.sexo,
                nuevo.grado_imparte,
                nuevo.seccion,
                nuevo.especialidad,
                nuevo.anio,
                nuevo.secciones,
                nuevo.materia,
                nuevo.periodo_grupo,
                nuevo.observacion,
                nuevo.edad,
                nuevo.comparativa,
                nuevo.nombres,
                nuevo.apellidos,
              ]
            );
            insertados++;

            mapaRac.set(claveExistente, {
              id: insertRes.rows[0].id,
              cedula,
              plantel_id: plantelId,
              ...nuevo,
            });

            if (!mapaNomina.has(cedula)) {
              await insertarAlerta(
                client,
                'cedula_no_existe_nomina',
                cedula,
                'La cédula no existe en la nómina del Ministerio de Educación'
              );
              alertasGeneradas++;
            }
          }

          for (const alerta of alertasRango) {
            await insertarAlerta(client, alerta.tipo, cedula, alerta.detalle);
            alertasGeneradas++;
          }
        }

        // Alerta de incongruencia: una cédula solo debería repetirse en el RAC
        // si todos sus registros son de tipo_personal = D (docente, con
        // distintos horarios/planteles). Se revisa la tabla completa cada vez
        // porque es una validación barata (una sola consulta agrupada) y
        // segura de repetir aunque el archivo se suba por pedazos -- pero
        // antes de insertar se verifica que no exista ya una alerta pendiente
        // para esa misma cédula, para no duplicarla en cada pedazo subido.
        const incongruenciaRes = await client.query(`
          SELECT cedula, array_agg(DISTINCT tipo_personal) AS tipos
          FROM rac
          GROUP BY cedula
          HAVING count(*) > 1
        `);

        const alertasIncongruenciaExistentesRes = await client.query(
          `SELECT DISTINCT cedula FROM alertas WHERE tipo = 'incongruencia_tipo_personal' AND estado = 'pendiente'`
        );
        const cedulasConAlertaIncongruencia = new Set(
          alertasIncongruenciaExistentesRes.rows.map((f) => f.cedula)
        );

        for (const fila of incongruenciaRes.rows) {
          const tipos = fila.tipos.filter(Boolean);
          const todosDocentes = tipos.length > 0 && tipos.every((t) => t === 'D');
          if (!todosDocentes && !cedulasConAlertaIncongruencia.has(fila.cedula)) {
            await insertarAlerta(
              client,
              'incongruencia_tipo_personal',
              fila.cedula,
              `La cédula tiene múltiples registros en el RAC con tipo(s) de personal distinto(s) a docente (${tipos.join(', ')}) — solo se espera repetición para tipo_personal D`
            );
            alertasGeneradas++;
            cedulasConAlertaIncongruencia.add(fila.cedula);
          }
        }

        return {
          insertados,
          actualizados,
          sinCambios,
          filasConError,
          lineasVaciasIgnoradas,
          alertasGeneradas,
        };
      });

      res.json({
        mensaje: 'Carga completa del RAC procesada correctamente',
        ...resultado,
      });
    } catch (err) {
      console.error('Error en carga completa del RAC:', err);
      res.status(500).json({ error: 'Error procesando la carga completa del RAC' });
    }
  }
);

// POST /api/rac/verificar-obsoletos  (solo admin)
// Paso manual, a correr UNA vez después de terminar de subir TODOS los
// pedazos de una carga completa del RAC (si se subió partida en varios
// archivos). Recibe { desde: fechaISO } -- la hora justo antes de empezar a
// subir el primer pedazo -- y genera alerta "registro_no_encontrado_en_carga"
// para todo registro de rac cuyo visto_en sea anterior a esa fecha (o nulo,
// para filas de antes de que existiera esta columna), es decir, que ningún
// pedazo subido lo tocó -- haya cambiado su dato o no. Se usa visto_en y NO
// actualizado_en a propósito: actualizado_en solo se mueve cuando el dato
// realmente cambia, así que una fila "sin cambios" (vigente, solo que igual
// a como ya estaba) tendría actualizado_en viejo y se marcaría como falsa
// baja si se comparara contra esa columna. No se borra nada automáticamente.
router.post('/verificar-obsoletos', requireAuth, requireRol('admin'), async (req, res) => {
  const { desde } = req.body;

  if (!desde) {
    return res.status(400).json({
      error: 'Falta el parámetro "desde" (fecha ISO de justo antes de empezar a subir el primer pedazo)',
    });
  }

  try {
    const resultado = await conTransaccionAuditada(req.usuario.id, async (client) => {
      const obsoletosRes = await client.query(
        'SELECT id, cedula FROM rac WHERE visto_en IS NULL OR visto_en < $1',
        [desde]
      );

      for (const fila of obsoletosRes.rows) {
        await insertarAlerta(
          client,
          'registro_no_encontrado_en_carga',
          fila.cedula,
          `El registro (rac.id=${fila.id}) no fue tocado por ninguna de las cargas realizadas desde ${desde} — revisar si el trabajador debe eliminarse`
        );
      }

      return { alertasGeneradas: obsoletosRes.rows.length };
    });

    res.json({
      mensaje: 'Verificación de registros obsoletos completada',
      ...resultado,
    });
  } catch (err) {
    console.error('Error verificando obsoletos:', err);
    res.status(500).json({ error: 'Error verificando registros obsoletos' });
  }
});

module.exports = router;
