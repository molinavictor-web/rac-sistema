const express = require('express');
const multer = require('multer');
const iconv = require('iconv-lite');
const router = express.Router();

const { conTransaccionAuditada } = require('../db/pool');
const { requireAuth, requireRol } = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage() });

function limpiar(valor) {
  if (valor === undefined || valor === null) return null;
  const v = valor.toString().trim();
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

async function insertarAlerta(client, tipo, cedula, detalle) {
  await client.query(
    `INSERT INTO alertas (tipo, cedula, detalle, estado, creado_en)
     VALUES ($1, $2, $3, 'pendiente', now())`,
    [tipo, cedula, detalle]
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
      const lineas = contenido.split(/\r?\n/).filter((l) => l.trim() !== '');
      if (lineas.length < 2) {
        return res.status(400).json({ error: 'El archivo está vacío o no tiene filas de datos' });
      }

      const encabezados = lineas[0].split(';').map((h) => h.trim().toUpperCase());

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
      };

      for (const [campo, columna] of Object.entries(idx)) {
        if (columna === -1) {
          return res.status(400).json({
            error: `No se encontró en el archivo la columna requerida para "${campo}"`,
          });
        }
      }

      const camposComparables = [
        'codigo_dependencia',
        'codigo_cargo',
        'cargo',
        'tipo_personal',
        'turno',
        'horas_academicas',
        'horas_adm',
        'situacion',
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
        const [plantelesRes, personalRes, racRes] = await Promise.all([
          client.query('SELECT id, codigo_plantel FROM planteles'),
          client.query('SELECT cedula FROM personal_ministerio'),
          client.query('SELECT * FROM rac'),
        ]);

        const mapaPlanteles = new Map(
          plantelesRes.rows.map((p) => [p.codigo_plantel, p.id])
        );
        const cedulasNomina = new Set(personalRes.rows.map((p) => p.cedula));
        const mapaRac = new Map(
          racRes.rows.map((r) => [`${r.cedula}|${r.plantel_id}`, r])
        );

        let insertados = 0;
        let actualizados = 0;
        let sinCambios = 0;
        let filasConError = 0;
        let lineasVaciasIgnoradas = 0;
        let alertasGeneradas = 0;

        for (let i = 1; i < lineas.length; i++) {
          const cols = lineas[i].split(';');

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

          if (!cedula || !codigoPlantelArchivo) {
            filasConError++;
            continue;
          }

          const plantelId = mapaPlanteles.get(codigoPlantelArchivo);

          if (plantelId === undefined) {
            await insertarAlerta(
              client,
              'plantel_no_existe',
              cedula,
              `Código de plantel "${codigoPlantelArchivo}" no existe en el catálogo maestro`
            );
            alertasGeneradas++;
            filasConError++;
            continue;
          }

          const nuevo = {
            codigo_dependencia: limpiar(cols[idx.codigoDependencia]),
            codigo_cargo: limpiar(cols[idx.codigoRac]),
            cargo: limpiar(cols[idx.cargo]),
            tipo_personal: limpiar(cols[idx.tipoPersonal]),
            turno: limpiar(cols[idx.turno]),
            horas_academicas: parseNumero(cols[idx.horasAcademicas]),
            horas_adm: parseNumero(cols[idx.horasAdm]),
            situacion: limpiar(cols[idx.situacion]),
          };

          const alertasRango = validarRangoHoras(cedula, codigoPlantelArchivo, nuevo);

          const claveExistente = `${cedula}|${plantelId}`;
          const existente = mapaRac.get(claveExistente);

          if (existente) {
            const huboCambio = camposComparables.some((campo) =>
              huboCambioEnCampo(campo, existente[campo], nuevo[campo])
            );

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
                  actualizado_en = now()
                 WHERE id = $9`,
                [
                  nuevo.codigo_dependencia,
                  nuevo.codigo_cargo,
                  nuevo.cargo,
                  nuevo.tipo_personal,
                  nuevo.turno,
                  nuevo.horas_academicas,
                  nuevo.horas_adm,
                  nuevo.situacion,
                  existente.id,
                ]
              );

              await insertarAlerta(
                client,
                'registro_actualizado',
                cedula,
                `Se detectaron cambios en el registro del plantel ${codigoPlantelArchivo} para esta cédula (rac.id=${existente.id})`
              );
              actualizados++;
              alertasGeneradas++;

              // Mantiene la copia en memoria al día por si la misma clave
              // vuelve a aparecer más adelante en el mismo archivo.
              mapaRac.set(claveExistente, { ...existente, ...nuevo });
            } else {
              sinCambios++;
            }
          } else {
            const insertRes = await client.query(
              `INSERT INTO rac
                (cedula, plantel_id, codigo_dependencia, codigo_cargo, cargo, tipo_personal, turno, horas_academicas, horas_adm, situacion, actualizado_en)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
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
              ]
            );
            insertados++;

            mapaRac.set(claveExistente, {
              id: insertRes.rows[0].id,
              cedula,
              plantel_id: plantelId,
              ...nuevo,
            });

            if (!cedulasNomina.has(cedula)) {
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
        // segura de repetir aunque el archivo se suba por pedazos.
        const incongruenciaRes = await client.query(`
          SELECT cedula, array_agg(DISTINCT tipo_personal) AS tipos
          FROM rac
          GROUP BY cedula
          HAVING count(*) > 1
        `);

        for (const fila of incongruenciaRes.rows) {
          const tipos = fila.tipos.filter(Boolean);
          const todosDocentes = tipos.length > 0 && tipos.every((t) => t === 'D');
          if (!todosDocentes) {
            await insertarAlerta(
              client,
              'incongruencia_tipo_personal',
              fila.cedula,
              `La cédula tiene múltiples registros en el RAC con tipo(s) de personal distinto(s) a docente (${tipos.join(', ')}) — solo se espera repetición para tipo_personal D`
            );
            alertasGeneradas++;
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
// para todo registro de rac cuyo actualizado_en sea anterior a esa fecha,
// es decir, que ningún pedazo subido lo tocó. No borra nada automáticamente.
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
        'SELECT id, cedula FROM rac WHERE actualizado_en < $1',
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
