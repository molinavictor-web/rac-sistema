const express = require("express");
const { pool, conTransaccionAuditada } = require("../db/pool");
const { requireAuth, requireRol } = require("../middleware/auth");
const multer = require('multer');

const router = express.Router();

/**
 * GET /api/planteles?municipio_id=...&q=...
 * Búsqueda del catálogo maestro (para autocompletar en el frontend
 * al momento de registrar o trasladar a alguien).
 * Devuelve { planteles, total } -- total es el conteo real, ya que
 * los resultados vienen limitados a 100 filas por consulta.
 * Incluye municipio_nombre (join con municipios) para mostrarlo
 * directamente en listas/selects del frontend sin una llamada aparte.
 */
router.get("/", requireAuth, async (req, res) => {
  const condiciones = [];
  const valores = [];

  if (req.query.municipio_id) {
    valores.push(req.query.municipio_id);
    condiciones.push(`p.municipio_id = $${valores.length}`);
  }
  if (req.query.q) {
    valores.push(`%${req.query.q}%`);
    condiciones.push(`(p.nombre ILIKE $${valores.length} OR p.codigo_plantel ILIKE $${valores.length})`);
  }

  const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";

  const { rows } = await pool.query(
    `SELECT p.*, m.nombre AS municipio_nombre
     FROM planteles p
     LEFT JOIN municipios m ON m.id = p.municipio_id
     ${where}
     ORDER BY p.nombre LIMIT 100`,
    valores
  );
  const { rows: totalRows } = await pool.query(
    `SELECT COUNT(*) FROM planteles p ${where}`,
    valores
  );
  res.json({ planteles: rows, total: parseInt(totalRows[0].count, 10) });
});

// ============================================================
// Helpers compartidos de geografía (usados por carga masiva,
// alta manual y, en el futuro, por cualquier otro punto que
// necesite validar estado -> municipio -> parroquia)
// ============================================================

function normalizarTexto(valor) {
  if (valor === undefined || valor === null) return null;
  const limpio = valor.trim();
  return limpio.length === 0 ? null : limpio;
}

// Clave de comparación contra el catálogo: mayúsculas + espacios
// colapsados, para no fallar por diferencias triviales de formato
// (doble espacio, minúsculas, espacios al borde).
function claveCatalogo(valor) {
  return (valor || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

// Valida la cadena completa estado -> municipio -> parroquia contra
// el catálogo maestro real (mismo criterio "Opción B" que ya usa la
// carga masiva: si algún nivel no calza, se rechaza -- nunca se
// auto-crea nada en estados/municipios/parroquias desde aquí).
// Lanza un Error con status=400 y un mensaje específico de en qué
// nivel falló la validación.
async function resolverGeografia(client, estadoTexto, municipioTexto, parroquiaTexto) {
  const claveEstado = claveCatalogo(estadoTexto);
  const claveMunicipio = claveCatalogo(municipioTexto);
  const claveParroquia = claveCatalogo(parroquiaTexto);

  const { rows } = await client.query(
    `SELECT e.nombre AS estado, m.id AS municipio_id, m.nombre AS municipio,
            pr.id AS parroquia_id, pr.nombre AS parroquia
     FROM parroquias pr
     JOIN municipios m ON m.id = pr.municipio_id
     JOIN estados e ON e.id = m.estado_id`
  );

  const existeEstado = rows.some((r) => claveCatalogo(r.estado) === claveEstado);
  if (!existeEstado) {
    const error = new Error(`El estado no existe en el catálogo: "${estadoTexto}"`);
    error.status = 400;
    throw error;
  }

  const filaMunicipio = rows.find(
    (r) => claveCatalogo(r.estado) === claveEstado && claveCatalogo(r.municipio) === claveMunicipio
  );
  if (!filaMunicipio) {
    const error = new Error(`El municipio no existe en el catálogo para el estado "${estadoTexto}": "${municipioTexto}"`);
    error.status = 400;
    throw error;
  }

  const filaParroquia = rows.find(
    (r) => r.municipio_id === filaMunicipio.municipio_id && claveCatalogo(r.parroquia) === claveParroquia
  );
  if (!filaParroquia) {
    const error = new Error(`La parroquia no existe en el catálogo para el municipio "${municipioTexto}": "${parroquiaTexto}"`);
    error.status = 400;
    throw error;
  }

  return { municipioId: filaMunicipio.municipio_id, parroquiaId: filaParroquia.parroquia_id };
}

/**
 * POST /api/planteles
 * Alta manual de UN plantel (a diferencia de la carga masiva por CSV).
 * Solo admin. Pensado para dos casos: (1) plantel nuevo real que aún
 * no está en el catálogo, (2) el catálogo estaba desactualizado y le
 * faltaba ese plantel que sí existe físicamente.
 *
 * Los datos geográficos (estado_geografico, municipio, parroquia) y el
 * codigo_plantel son parte de la identidad del plantel y NO se pueden
 * modificar después de esta alta (ver PATCH más abajo) -- existen
 * planteles con el mismo nombre/epónimo en municipios o parroquias
 * distintas, y el dato geográfico es lo único que los diferencia.
 */
router.post("/", requireAuth, requireRol("admin"), async (req, res) => {
  const codigoPlantel = normalizarTexto(req.body.codigo_plantel);
  const nombre = normalizarTexto(req.body.nombre);
  const estadoGeografico = normalizarTexto(req.body.estado_geografico);
  const municipioTexto = normalizarTexto(req.body.municipio);
  const parroquiaTexto = normalizarTexto(req.body.parroquia);
  const dependencia = normalizarTexto(req.body.dependencia);
  const denominacion = normalizarTexto(req.body.denominacion);
  const direccion = normalizarTexto(req.body.direccion);

  if (!codigoPlantel || !nombre || !estadoGeografico || !municipioTexto || !parroquiaTexto) {
    return res.status(400).json({
      error: "Faltan campos obligatorios: código, nombre, estado, municipio y parroquia.",
    });
  }

  try {
    const resultado = await conTransaccionAuditada(req.usuario.id, async (client) => {
      const { rows: existentes } = await client.query(
        "SELECT id FROM planteles WHERE codigo_plantel = $1",
        [codigoPlantel]
      );
      if (existentes.length > 0) {
        const error = new Error("Ya existe un plantel con ese código.");
        error.status = 409;
        throw error;
      }

      const { municipioId, parroquiaId } = await resolverGeografia(
        client,
        estadoGeografico,
        municipioTexto,
        parroquiaTexto
      );

      const { rows } = await client.query(
        `INSERT INTO planteles
          (codigo_plantel, nombre, municipio_id, dependencia, parroquia, parroquia_id, denominacion, direccion, estado_geografico, actualizado_en)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
         RETURNING *`,
        [codigoPlantel, nombre, municipioId, dependencia, parroquiaTexto, parroquiaId, denominacion, direccion, estadoGeografico]
      );
      return rows[0];
    });

    res.status(201).json(resultado);
  } catch (error) {
    const status = error.status || 500;
    if (status === 500) console.error("Error al dar de alta plantel:", error);
    res.status(status).json({ error: error.message || "Error al dar de alta el plantel." });
  }
});

/**
 * PATCH /api/planteles/:id
 * Solo admin -- para reflejar cambios reales (cambio de epónimo,
 * cierre, cambio de dependencia, etc.), ya que los planteles también
 * cambian con el tiempo.
 *
 * IMPORTANTE: los campos geográficos (municipio_id, parroquia,
 * parroquia_id, estado_geografico) y codigo_plantel NO están en esta
 * lista a propósito -- son parte de la identidad territorial del
 * plantel y no deben cambiar después del alta (ver nota en el POST).
 * Si algún día hace falta corregir un dato geográfico mal cargado,
 * ese es un caso distinto (fusionar/recrear el plantel), no una edición.
 */
router.patch("/:id", requireAuth, requireRol("admin"), async (req, res) => {
  const camposPermitidos = ["nombre", "dependencia", "denominacion", "direccion", "estado", "fecha_cierre"];
  const sets = [];
  const valores = [];

  for (const campo of camposPermitidos) {
    if (req.body[campo] !== undefined) {
      valores.push(req.body[campo]);
      sets.push(`${campo} = $${valores.length}`);
    }
  }
  if (sets.length === 0) {
    return res.status(400).json({ error: "No se envió ningún campo para actualizar." });
  }
  valores.push(req.params.id);

  const resultado = await conTransaccionAuditada(req.usuario.id, async (client) => {
    const { rows } = await client.query(
      `UPDATE planteles SET ${sets.join(", ")}, actualizado_en = now()
       WHERE id = $${valores.length} RETURNING *`,
      valores
    );
    return rows[0];
  });

  if (!resultado) {
    return res.status(404).json({ error: "Plantel no encontrado." });
  }
  res.json(resultado);
});

/**
 * DELETE /api/planteles/:id
 * Solo admin -- pensado ÚNICAMENTE para corregir un error de dedo al
 * dar de alta un plantel a mano (por eso solo se ofrece desde la
 * pantalla de gestión, nunca desde la carga masiva). Si el plantel ya
 * tiene registros del RAC apuntándole, el borrado se BLOQUEA -- ahí lo
 * correcto es marcarlo Inactivo/Cerrado (PATCH estado), no eliminarlo,
 * porque hay historial real de personal asignado a ese plantel.
 */
router.delete("/:id", requireAuth, requireRol("admin"), async (req, res) => {
  try {
    const resultado = await conTransaccionAuditada(req.usuario.id, async (client) => {
      const { rows: usados } = await client.query(
        "SELECT COUNT(*) FROM rac WHERE plantel_id = $1",
        [req.params.id]
      );
      const totalUsados = parseInt(usados[0].count, 10);
      if (totalUsados > 0) {
        const error = new Error(
          `Este plantel tiene ${totalUsados} registro(s) del RAC asociados y no se puede eliminar. Márcalo como Inactivo/Cerrado en su lugar.`
        );
        error.status = 409;
        throw error;
      }

      const { rows } = await client.query(
        "DELETE FROM planteles WHERE id = $1 RETURNING id",
        [req.params.id]
      );
      if (rows.length === 0) {
        const error = new Error("Plantel no encontrado.");
        error.status = 404;
        throw error;
      }
      return rows[0];
    });

    res.json({ ok: true, id: resultado.id });
  } catch (error) {
    const status = error.status || 500;
    if (status === 500) console.error("Error al eliminar plantel:", error);
    res.status(status).json({ error: error.message || "Error al eliminar el plantel." });
  }
});

// ============================================================
// Carga masiva de planteles (upsert por codigo_plantel)
// ============================================================
//
// Desde la Mejora 3 (jerarquía geográfica normalizada), la validación
// de estado/municipio/parroquia ya NO se hace contra un mapa plano de
// municipios por nombre: se valida la cadena completa
// estado -> municipio -> parroquia contra el catálogo maestro real
// (tablas estados/municipios/parroquias), poblado a partir del
// catálogo nacional de planteles. Política "Opción B" (decidida por
// el usuario): si el estado, el municipio dentro de ese estado, o la
// parroquia dentro de ese municipio no existen en el catálogo, la fila
// se RECHAZA como error -- nunca se auto-crea nada en estados/
// municipios/parroquias desde esta carga.

const MAX_UPLOAD_PLANTELES_MB = parseInt(process.env.MAX_UPLOAD_PLANTELES_MB || '20', 10);

const uploadPlanteles = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_PLANTELES_MB * 1024 * 1024 }
});

const BATCH_SIZE = 1000;

// Detecta el delimitador real de la línea de encabezado del CSV.
// Excel, en configuración regional en español, exporta la opción
// "CSV (delimitado por comas)" usando en realidad punto y coma (;),
// porque la coma queda reservada como separador decimal. Por eso no
// asumimos un delimitador fijo: contamos comas vs. punto y coma en
// la primera línea y usamos el que más aparece.
function detectarDelimitador(primeraLinea) {
  const comas = (primeraLinea.match(/,/g) || []).length;
  const puntoYComa = (primeraLinea.match(/;/g) || []).length;
  return puntoYComa > comas ? ';' : ',';
}

// Parser simple de una línea CSV delimitada por el delimitador detectado.
// Si en el futuro aparecen campos con comas/punto y coma internos entre
// comillas, hay que cambiar esto por una librería (ej. csv-parse). Por
// ahora el archivo real de planteles no trae comillas ni el delimitador
// dentro de un campo.
function parsearLineaCSV(linea, delimitador) {
  return linea.split(delimitador).map(campo => campo.trim());
}

// POST /api/planteles/cargar-masiva
// Solo admin. Carga el CSV completo de planteles (delimitado por coma
// o punto y coma -- se detecta automáticamente, ver detectarDelimitador
// arriba -- codificación latin1/ANSI, tal como lo exporta Excel con
// "CSV (delimitado por comas) (*.csv)").
// Columnas esperadas en el archivo, en este orden:
// estado (geográfico, ej. "MONAGAS"), municipio, parroquia, cod_plantel,
// nombre_plantel, tipo_dependencia, denominacion, direccion
//
// La columna "estado" geográfica del CSV se sigue guardando también en
// planteles.estado_geografico (texto) por compatibilidad con la
// exportación pendiente -- NO confundir con planteles.estado, que es
// el estado OPERATIVO del plantel (activo/cerrado), un campo totalmente
// distinto que no viene del CSV.
//
// Estado/municipio/parroquia se validan contra el catálogo maestro
// (estados/municipios/parroquias). Si la fila no calza en algún nivel
// de esa cadena, se rechaza como error (Opción B) y NO se inserta ni
// actualiza el plantel.
//
// Comportamiento: UPSERT por codigo_plantel (no TRUNCATE), porque
// planteles.id es referenciado por rac.plantel_id.
router.post('/cargar-masiva', requireAuth, requireRol('admin'), uploadPlanteles.single('archivo'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No se recibió ningún archivo' });
  }

  const client = await pool.connect();

  try {
    // Decodificar el buffer como latin1 (ANSI), igual que personalMinisterio.js
    const contenido = req.file.buffer.toString('latin1');
    const lineas = contenido.split(/\r?\n/);

    if (lineas.length < 2) {
      return res.status(400).json({ error: 'El archivo no tiene datos' });
    }

    const delimitador = detectarDelimitador(lineas[0]);

    // Descartar encabezado
    const filasDatos = lineas.slice(1);

    // Precargar el catálogo geográfico completo en memoria, en una
    // sola consulta con los tres niveles ya unidos, para no consultar
    // la BD por cada fila del archivo.
    const { rows: catalogoRows } = await client.query(
      `SELECT e.nombre AS estado, m.id AS municipio_id, m.nombre AS municipio,
              pr.id AS parroquia_id, pr.nombre AS parroquia
       FROM parroquias pr
       JOIN municipios m ON m.id = pr.municipio_id
       JOIN estados e ON e.id = m.estado_id`
    );

    // mapaEstados: clave estado -> true (solo para dar un mensaje de
    // error específico si el estado ni siquiera existe)
    const mapaEstados = new Set();
    // mapaMunicipios: clave "ESTADO||MUNICIPIO" -> municipio_id
    const mapaMunicipios = new Map();
    // mapaParroquias: clave "MUNICIPIO_ID||PARROQUIA" -> parroquia_id
    const mapaParroquias = new Map();

    for (const fila of catalogoRows) {
      const claveEstado = claveCatalogo(fila.estado);
      mapaEstados.add(claveEstado);
      mapaMunicipios.set(`${claveEstado}||${claveCatalogo(fila.municipio)}`, fila.municipio_id);
      mapaParroquias.set(`${fila.municipio_id}||${claveCatalogo(fila.parroquia)}`, fila.parroquia_id);
    }

    let insertados = 0;
    let actualizados = 0;
    let filasConError = 0;
    let lineasVaciasIgnoradas = 0;
    const errores = [];

    // Desactivar auditoría alrededor de la carga masiva (mismo patrón que personalMinisterio.js)
    await client.query('BEGIN');
    await client.query(`ALTER TABLE planteles DISABLE TRIGGER trg_auditoria_planteles`);

    let lote = [];

    async function procesarLote(lote) {
      if (lote.length === 0) return;

      const columnas = [
        'codigo_plantel', 'nombre', 'municipio_id', 'dependencia',
        'parroquia', 'parroquia_id', 'denominacion', 'direccion',
        'estado_geografico', 'actualizado_en'
      ];

      const valores = [];
      const placeholders = lote.map((fila, i) => {
        const base = i * columnas.length;
        valores.push(
          fila.codigo_plantel, fila.nombre, fila.municipio_id, fila.dependencia,
          fila.parroquia, fila.parroquia_id, fila.denominacion, fila.direccion,
          fila.estado_geografico, new Date()
        );
        const nums = columnas.map((_, j) => `$${base + j + 1}`);
        return `(${nums.join(', ')})`;
      }).join(', ');

      const sql = `
        INSERT INTO planteles (${columnas.join(', ')})
        VALUES ${placeholders}
        ON CONFLICT (codigo_plantel) DO UPDATE SET
          nombre = EXCLUDED.nombre,
          municipio_id = EXCLUDED.municipio_id,
          dependencia = EXCLUDED.dependencia,
          parroquia = EXCLUDED.parroquia,
          parroquia_id = EXCLUDED.parroquia_id,
          denominacion = EXCLUDED.denominacion,
          direccion = EXCLUDED.direccion,
          estado_geografico = EXCLUDED.estado_geografico,
          actualizado_en = EXCLUDED.actualizado_en
        RETURNING (xmax = 0) AS es_insert
      `;

      const { rows } = await client.query(sql, valores);
      for (const r of rows) {
        if (r.es_insert) insertados++;
        else actualizados++;
      }
    }

    for (let i = 0; i < filasDatos.length; i++) {
      const linea = filasDatos[i];

      // Línea vacía o solo separadores (mismo problema que ya se vio en rac completo)
      if (!linea || linea.split(delimitador).join('').trim().length === 0) {
        lineasVaciasIgnoradas++;
        continue;
      }

      const campos = parsearLineaCSV(linea, delimitador);
      const [estadoGeografico, municipioTexto, parroquiaTexto, codPlantel, nombrePlantel, tipoDependencia, denominacion, direccion] = campos;

      const codigoPlantelLimpio = normalizarTexto(codPlantel);
      if (!codigoPlantelLimpio) {
        filasConError++;
        errores.push({ linea: i + 2, motivo: 'cod_plantel vacío' });
        continue;
      }

      // Validación en cadena contra el catálogo maestro (Opción B):
      // estado -> municipio dentro de ese estado -> parroquia dentro
      // de ese municipio. Si algún nivel no existe, se rechaza la fila
      // completa con un motivo específico de en qué nivel falló.
      const claveEstado = claveCatalogo(estadoGeografico);
      if (!mapaEstados.has(claveEstado)) {
        filasConError++;
        errores.push({ linea: i + 2, codigo_plantel: codigoPlantelLimpio, motivo: `estado no existe en el catálogo: "${estadoGeografico}"` });
        continue;
      }

      const municipioId = mapaMunicipios.get(`${claveEstado}||${claveCatalogo(municipioTexto)}`);
      if (!municipioId) {
        filasConError++;
        errores.push({ linea: i + 2, codigo_plantel: codigoPlantelLimpio, motivo: `municipio no existe en el catálogo para el estado "${estadoGeografico}": "${municipioTexto}"` });
        continue;
      }

      const parroquiaId = mapaParroquias.get(`${municipioId}||${claveCatalogo(parroquiaTexto)}`);
      if (!parroquiaId) {
        filasConError++;
        errores.push({ linea: i + 2, codigo_plantel: codigoPlantelLimpio, motivo: `parroquia no existe en el catálogo para el municipio "${municipioTexto}": "${parroquiaTexto}"` });
        continue;
      }

      lote.push({
        codigo_plantel: codigoPlantelLimpio,
        nombre: normalizarTexto(nombrePlantel),
        municipio_id: municipioId,
        dependencia: normalizarTexto(tipoDependencia),
        parroquia: normalizarTexto(parroquiaTexto),
        parroquia_id: parroquiaId,
        denominacion: normalizarTexto(denominacion),
        direccion: normalizarTexto(direccion),
        estado_geografico: normalizarTexto(estadoGeografico)
      });

      if (lote.length >= BATCH_SIZE) {
        await procesarLote(lote);
        lote = [];
      }
    }

    // Procesar el último lote incompleto
    await procesarLote(lote);

    await client.query(`ALTER TABLE planteles ENABLE TRIGGER trg_auditoria_planteles`);
    await client.query('COMMIT');

    res.json({
      mensaje: 'Carga de planteles completada',
      delimitadorDetectado: delimitador,
      insertados,
      actualizados,
      filasConError,
      lineasVaciasIgnoradas,
      errores: errores.slice(0, 50) // no devolver miles de errores si algo sale mal
    });

  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error en carga masiva de planteles:', error);
    res.status(500).json({ error: 'Error al procesar el archivo', detalle: error.message });
  } finally {
    client.release();
  }
});

module.exports = router;
