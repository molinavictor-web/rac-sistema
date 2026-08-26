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

// POST /api/rac/cargar-completo  (solo admin)
// Recibe el archivo CSV completo del RAC (mismas columnas que envía la oficina
// central) y sincroniza contra la tabla rac:
//  - cedula + plantel_id existe y hay cambios  -> UPDATE + alerta "registro_actualizado"
//  - cedula + plantel_id existe sin cambios    -> no hace nada
//  - cedula + plantel_id no existe             -> INSERT (valida cédula contra
//                                                  personal_ministerio; si no
//                                                  existe, alerta "cedula_no_existe_nomina")
//  - registro que estaba en rac pero no aparece en el archivo nuevo
//                                               -> alerta "registro_no_encontrado_en_carga"
//                                                  (NO se borra automáticamente)
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

      const resultado = await conTransaccionAuditada(req.usuario.id, async (client) => {
        const vistos = new Set(); // claves "cedula|plantel_id" que aparecen en el archivo nuevo
        let insertados = 0;
        let actualizados = 0;
        let sinCambios = 0;
        let filasConError = 0;
        let alertasGeneradas = 0;

        for (let i = 1; i < lineas.length; i++) {
          const cols = lineas[i].split(';');

          const cedula = limpiar(cols[idx.cedula]);
          const codigoPlantelArchivo = limpiar(cols[idx.codigoPlantel]);

          if (!cedula || !codigoPlantelArchivo) {
            filasConError++;
            continue;
          }

          const plantelRes = await client.query(
            'SELECT id FROM planteles WHERE cod_plantel = $1',
            [codigoPlantelArchivo]
          );

          if (plantelRes.rows.length === 0) {
            await client.query(
              `INSERT INTO alertas (tipo, cedula, detalle, estado, creado_en)
               VALUES ($1, $2, $3, 'pendiente', now())`,
              [
                'plantel_no_existe',
                cedula,
                `Código de plantel "${codigoPlantelArchivo}" no existe en el catálogo maestro`,
              ]
            );
            alertasGeneradas++;
            filasConError++;
            continue;
          }

          const plantelId = plantelRes.rows[0].id;
          vistos.add(`${cedula}|${plantelId}`);

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

          const existenteRes = await client.query(
            'SELECT * FROM rac WHERE cedula = $1 AND plantel_id = $2',
            [cedula, plantelId]
          );

          if (existenteRes.rows.length > 0) {
            const existente = existenteRes.rows[0];
            const huboCambio = camposComparables.some((campo) => {
              const actual =
                existente[campo] === null || existente[campo] === undefined
                  ? null
                  : existente[campo].toString();
              const propuesto =
                nuevo[campo] === null || nuevo[campo] === undefined ? null : nuevo[campo].toString();
              return actual !== propuesto;
            });

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

              await client.query(
                `INSERT INTO alertas (tipo, cedula, detalle, estado, creado_en)
                 VALUES ($1, $2, $3, 'pendiente', now())`,
                [
                  'registro_actualizado',
                  cedula,
                  `Se detectaron cambios en el registro del plantel ${codigoPlantelArchivo} para esta cédula (rac.id=${existente.id})`,
                ]
              );
              actualizados++;
              alertasGeneradas++;
            } else {
              sinCambios++;
            }
          } else {
            await client.query(
              `INSERT INTO rac
                (cedula, plantel_id, codigo_dependencia, codigo_cargo, cargo, tipo_personal, turno, horas_academicas, horas_adm, situacion, actualizado_en)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())`,
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

            const nominaRes = await client.query(
              'SELECT 1 FROM personal_ministerio WHERE cedula = $1 LIMIT 1',
              [cedula]
            );

            if (nominaRes.rows.length === 0) {
              await client.query(
                `INSERT INTO alertas (tipo, cedula, detalle, estado, creado_en)
                 VALUES ($1, $2, $3, 'pendiente', now())`,
                ['cedula_no_existe_nomina', cedula, 'La cédula no existe en la nómina del Ministerio de Educación']
              );
              alertasGeneradas++;
            }
          }
        }

        // Registros que ya estaban en rac pero NO aparecieron en este archivo -> alerta, sin borrar
        const existentesRes = await client.query('SELECT id, cedula, plantel_id FROM rac');
        let noEncontradosEnCarga = 0;

        for (const fila of existentesRes.rows) {
          const clave = `${fila.cedula}|${fila.plantel_id}`;
          if (!vistos.has(clave)) {
            await client.query(
              `INSERT INTO alertas (tipo, cedula, detalle, estado, creado_en)
               VALUES ($1, $2, $3, 'pendiente', now())`,
              [
                'registro_no_encontrado_en_carga',
                fila.cedula,
                `El registro (rac.id=${fila.id}) no apareció en la última carga completa del RAC — revisar si el trabajador debe eliminarse`,
              ]
            );
            noEncontradosEnCarga++;
            alertasGeneradas++;
          }
        }

        return {
          insertados,
          actualizados,
          sinCambios,
          filasConError,
          noEncontradosEnCarga,
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

module.exports = router;
