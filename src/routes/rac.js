const express = require("express");
const { pool, conTransaccionAuditada } = require("../db/pool");
const { requireAuth, requireRol } = require("../middleware/auth");

const router = express.Router();

/**
 * GET /api/rac?cedula=...&plantel_id=...&municipio_id=...
 * Consulta general con filtros opcionales. Todos los roles autenticados
 * pueden consultar (el encargado de municipio solo ve resultados que
 * incluyan su municipio, filtrado en el frontend/consulta según convenga).
 * Devuelve { rac, total } -- total es el conteo real (los resultados
 * vienen limitados a 200 filas), para que el frontend pueda mostrar
 * la cifra completa (ej. en el dashboard) sin traer todas las filas.
 */
router.get("/", requireAuth, async (req, res) => {
  const { cedula, plantel_id, periodo_escolar } = req.query;
  const condiciones = [];
  const valores = [];

  if (cedula) {
    valores.push(cedula.trim().replace(/^0+/, ""));
    condiciones.push(`r.cedula = $${valores.length}`);
  }
  if (plantel_id) {
    valores.push(plantel_id);
    condiciones.push(`r.plantel_id = $${valores.length}`);
  }
  if (periodo_escolar) {
    valores.push(periodo_escolar);
    condiciones.push(`r.periodo_escolar = $${valores.length}`);
  }

  const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";
  const { rows } = await pool.query(
    `SELECT r.*, p.nombre AS plantel_nombre, p.codigo_plantel
     FROM rac r
     JOIN planteles p ON p.id = r.plantel_id
     ${where}
     ORDER BY r.actualizado_en DESC
     LIMIT 200`,
    valores
  );
  const { rows: totalRows } = await pool.query(
    `SELECT COUNT(*) FROM rac r ${where}`,
    valores
  );
  res.json({ rac: rows, total: parseInt(totalRows[0].count, 10) });
});

/**
 * GET /api/rac/exportar-general
 * Exporta TODO el RAC en el mismo formato del CSV de carga (33 columnas,
 * delimitador ";", codificación latin1, saltos de línea CRLF) para que la
 * sede central pueda reabrir el archivo con la misma estructura del CSV
 * de carga. Descarga bajo demanda (sin automatización). Disponible para
 * admin y operador (no solo admin, a diferencia de otras pantallas de
 * carga/administración del sistema).
 *
 * Mapeo de columnas confirmado:
 * - Directo desde `rac`: CODIGO DEPENDENCIA, CODIGO RAC(=codigo_cargo),
 *   CARGO, TIPO DE PERSONAL, CEDULA, HORAS ACADEMICAS, HORAS ADM,
 *   TURNO QUE ATIENDE(=turno), SITUACION DEL TRABAJADOR(=situacion),
 *   CODIGO ESTADISTICO, NIVEL, MODALIDAD, UBICACION GEOGRAFICA, TURNOS
 *   QUE ATIENDE EL PLANTEL(=turnos_plantel), FECHA DE INGRESO, SEXO,
 *   GRADO QUE IMPARTE EL DOCENTE(=grado_imparte), SECCION, ESPECIALIDAD
 *   QUE IMPARTE EL DOCENTE(=especialidad), AÑO(=anio), SECCIONES,
 *   MATERIA QUE IMPARTE O ESPECIALIDAD(=materia), PERIODO O
 *   GRUPO(=periodo_grupo), OBSERVACION, EDAD, COMPARATIVA -- estas 17
 *   columnas se agregaron al schema de `rac` y se llenan desde
 *   racCompleto.js (antes se leían del CSV y se descartaban)
 * - Vía rac.plantel_id -> planteles: CODIGO DEL PLANTEL, NOMBRE DEL
 *   PLANTEL EN NOMINA
 * - Vía la jerarquía geográfica (planteles.municipio_id/parroquia_id ->
 *   municipios/parroquias/estados): ESTADO, MUNICIPIO, PARROQUIA
 * - Vía cruce por cédula contra personal_ministerio.nombres: NOMBRE Y
 *   APELLIDO (solo `nombres`, que ya viene completo; NO se concatena
 *   `apellidos`, que siempre queda NULL en la carga de nómina)
 * - Sin fuente en ninguna tabla hoy, se exporta vacía: COD_EDO (siempre
 *   "MONAGAS" a nivel de estado, no se guarda por fila)
 */
router.get(
  "/exportar-general",
  requireAuth,
  requireRol("operador", "admin"),
  async (req, res) => {
    try {
      // Precarga en memoria de todo lo necesario para el cruce (mismo
      // patrón que ya resolvió el 502 por volumen en la carga completa):
      // una sola consulta por tabla, nada de consultas dentro del bucle.
      const [
        racRows,
        plantelesRows,
        municipiosRows,
        parroquiasRows,
        estadosRows,
        nominaRows,
      ] = await Promise.all([
        pool.query(`
          SELECT cedula, plantel_id, codigo_dependencia, codigo_cargo, cargo,
                 tipo_personal, horas_academicas, horas_adm, turno, situacion,
                 nivel, modalidad, ubicacion_geografica, turnos_plantel,
                 codigo_estadistico, fecha_ingreso, sexo, grado_imparte,
                 seccion, especialidad, anio, secciones, materia,
                 periodo_grupo, observacion, edad, comparativa
          FROM rac
        `),
        pool.query(`
          SELECT id, codigo_plantel, nombre, municipio_id, parroquia_id
          FROM planteles
        `),
        pool.query(`SELECT id, nombre, estado_id FROM municipios`),
        pool.query(`SELECT id, nombre, municipio_id FROM parroquias`),
        pool.query(`SELECT id, nombre FROM estados`),
        pool.query(`SELECT cedula, nombres FROM personal_ministerio`),
      ]);

      const mapaEstados = new Map(estadosRows.rows.map((e) => [e.id, e.nombre]));
      const mapaMunicipios = new Map(
        municipiosRows.rows.map((m) => [m.id, { nombre: m.nombre, estado_id: m.estado_id }])
      );
      const mapaParroquias = new Map(
        parroquiasRows.rows.map((p) => [p.id, { nombre: p.nombre, municipio_id: p.municipio_id }])
      );
      const mapaPlanteles = new Map(plantelesRows.rows.map((p) => [p.id, p]));
      const mapaNomina = new Map(nominaRows.rows.map((n) => [n.cedula, n.nombres]));

      // Encabezado exacto, mismo orden que trae el CSV de carga real
      // (01-RAC_MONAGAS_.csv, 33 columnas).
      const encabezado = [
        "COD_EDO", "ESTADO", "MUNICIPIO", "PARROQUIA", "CODIGO DEPENDENCIA",
        "CODIGO ESTADISTICO", "CODIGO DEL PLANTEL", "NOMBRE DEL PLANTEL EN NOMINA",
        "NIVEL", "MODALIDAD", "UBICACION GEOGRAFICA", "TURNOS QUE ATIENDE EL PLANTEL",
        "CODIGO RAC", "CARGO", "TIPO DE PERSONAL", "CEDULA", "NOMBRE Y APELLIDO",
        "FECHA DE INGRESO", "SEXO", "HORAS ACADEMICAS", "HORAS ADM", "TURNO QUE ATIENDE",
        "GRADO QUE IMPARTE EL DOCENTE", "SECCION", "ESPECIALIDAD QUE IMPARTE EL DOCENTE",
        "AÑO", "SECCIONES", "MATERIA QUE IMPARTE O ESPECIALIDAD", "PERIODO O GRUPO",
        "SITUACION DEL TRABAJADOR", "OBSERVACION", "EDAD", "COMPARATIVA",
      ];

      // Escapa un valor para CSV delimitado por ";" (comillas si el valor
      // trae ";", comillas dobles, o saltos de línea).
      const esc = (val) => {
        if (val === null || val === undefined) return "";
        const s = String(val);
        if (s.includes(";") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
          return `"${s.replace(/"/g, '""')}"`;
        }
        return s;
      };

      const filas = [encabezado.map(esc).join(";")];

      for (const r of racRows.rows) {
        const plantel = mapaPlanteles.get(r.plantel_id) || {};
        const municipio = mapaMunicipios.get(plantel.municipio_id) || {};
        const parroquia = mapaParroquias.get(plantel.parroquia_id) || {};
        const estadoNombre = mapaEstados.get(municipio.estado_id) || "";
        const nombreCompleto = mapaNomina.get(r.cedula) || "";

        const fila = [
          "",                              // COD_EDO
          estadoNombre,                    // ESTADO
          municipio.nombre || "",          // MUNICIPIO
          parroquia.nombre || "",          // PARROQUIA
          r.codigo_dependencia,            // CODIGO DEPENDENCIA
          r.codigo_estadistico,            // CODIGO ESTADISTICO
          plantel.codigo_plantel || "",    // CODIGO DEL PLANTEL
          plantel.nombre || "",            // NOMBRE DEL PLANTEL EN NOMINA
          r.nivel, r.modalidad, r.ubicacion_geografica, r.turnos_plantel, // NIVEL, MODALIDAD, UBICACION GEOGRAFICA, TURNOS QUE ATIENDE EL PLANTEL
          r.codigo_cargo,                  // CODIGO RAC
          r.cargo,                         // CARGO
          r.tipo_personal,                 // TIPO DE PERSONAL
          r.cedula,                        // CEDULA
          nombreCompleto,                  // NOMBRE Y APELLIDO
          r.fecha_ingreso, r.sexo,         // FECHA DE INGRESO, SEXO
          r.horas_academicas,              // HORAS ACADEMICAS
          r.horas_adm,                     // HORAS ADM
          r.turno,                         // TURNO QUE ATIENDE
          r.grado_imparte, r.seccion, r.especialidad, // GRADO QUE IMPARTE, SECCION, ESPECIALIDAD
          r.anio, r.secciones, r.materia,  // AÑO, SECCIONES, MATERIA QUE IMPARTE
          r.periodo_grupo,                 // PERIODO O GRUPO
          r.situacion,                     // SITUACION DEL TRABAJADOR
          r.observacion, r.edad, r.comparativa, // OBSERVACION, EDAD, COMPARATIVA
        ];

        filas.push(fila.map(esc).join(";"));
      }

      const csv = filas.join("\r\n") + "\r\n";
      const buffer = Buffer.from(csv, "latin1");

      res.setHeader("Content-Type", "text/csv; charset=ISO-8859-1");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="RAC_GENERAL_${new Date().toISOString().slice(0, 10)}.csv"`
      );
      res.send(buffer);
    } catch (error) {
      console.error("Error en /exportar-general:", error);
      res.status(500).json({ error: "Error al generar la exportación general del RAC" });
    }
  }
);

/**
 * PATCH /api/rac/:id
 * Edición completa de un registro existente -- cubre traslados (cambio de
 * plantel), correcciones de cargo/turno/horas/situación, y ajustes a los
 * códigos que trae la carga completa del RAC (codigo_dependencia,
 * codigo_cargo, tipo_personal). La cédula NO es editable aquí a propósito
 * (identifica al trabajador, no al registro de asignación).
 *
 * Para cambiar de plantel, el body debe traer `codigo_plantel` (el código
 * real del plantel, ej. "OD14231608"), NO el id interno -- se busca en la
 * tabla planteles y, si no existe, se rechaza el guardado con 400 (no se
 * guarda con alerta, para no dejar el registro apuntando a nada).
 *
 * El trigger de auditoría deja registrado el antes/después automáticamente
 * (ver schema.sql). Solo operador/admin.
 */
router.patch("/:id", requireAuth, requireRol("operador", "admin"), async (req, res) => {
  const { id } = req.params;
  const camposDirectos = [
    "cargo",
    "turno",
    "horas_academicas",
    "horas_adm",
    "situacion",
    "codigo_dependencia",
    "codigo_cargo",
    "tipo_personal",
  ];
  const sets = [];
  const valores = [];

  // Si viene codigo_plantel, se resuelve primero contra el catálogo maestro
  if (req.body.codigo_plantel !== undefined) {
    const codigoPlantel = String(req.body.codigo_plantel).trim();
    const plantelRes = await pool.query(
      "SELECT id FROM planteles WHERE codigo_plantel = $1",
      [codigoPlantel]
    );
    if (plantelRes.rows.length === 0) {
      return res.status(400).json({
        error: `El código de plantel "${codigoPlantel}" no existe en el catálogo maestro. Verifica el código antes de guardar.`,
      });
    }
    valores.push(plantelRes.rows[0].id);
    sets.push(`plantel_id = $${valores.length}`);
  }

  for (const campo of camposDirectos) {
    if (req.body[campo] !== undefined) {
      valores.push(req.body[campo]);
      sets.push(`${campo} = $${valores.length}`);
    }
  }
  if (sets.length === 0) {
    return res.status(400).json({ error: "No se envió ningún campo para actualizar." });
  }
  valores.push(id);

  try {
    const resultado = await conTransaccionAuditada(req.usuario.id, async (client) => {
      const { rows } = await client.query(
        `UPDATE rac SET ${sets.join(", ")}, actualizado_en = now()
         WHERE id = $${valores.length} RETURNING *`,
        valores
      );
      const actualizado = rows[0];
      if (!actualizado) return actualizado;

      // Incongruencia de tipo de personal: la única razón válida para que una
      // cédula tenga más de un registro en el RAC es que sea docente
      // (distintos horarios/planteles). Se revisa tras cada edición porque
      // un cambio manual de tipo_personal o de cédula-plantel puede crearla.
      const repetidosRes = await client.query(
        `SELECT tipo_personal, COUNT(*) OVER () AS total
         FROM rac WHERE cedula = $1`,
        [actualizado.cedula]
      );
      if (repetidosRes.rows.length > 1) {
        const tiposDistintos = [...new Set(repetidosRes.rows.map((r) => r.tipo_personal))];
        const soloDocente = tiposDistintos.length === 1 && tiposDistintos[0] === "D";
        if (!soloDocente) {
          await client.query(
            `INSERT INTO alertas (tipo, cedula, detalle, estado, creado_en)
             VALUES ($1, $2, $3, 'pendiente', now())`,
            [
              "incongruencia_tipo_personal",
              actualizado.cedula,
              `La cédula tiene ${repetidosRes.rows.length} registros en el RAC con tipo(s) de personal [${tiposDistintos.join(", ")}]. Solo un docente puede tener varios registros (distintos horarios/planteles) — revisar.`,
            ]
          );
        }
      }

      return actualizado;
    });

    if (!resultado) {
      return res.status(404).json({ error: "Registro no encontrado." });
    }
    res.json(resultado);
  } catch (err) {
    res.status(500).json({ error: "No se pudo actualizar el registro.", detalle: err.message });
  }
});

/**
 * DELETE /api/rac/:id
 * Solo admin. Queda registrado en auditoria (fila completa antes de borrar).
 */
router.delete("/:id", requireAuth, requireRol("admin"), async (req, res) => {
  const { id } = req.params;
  await conTransaccionAuditada(req.usuario.id, async (client) => {
    await client.query("DELETE FROM rac WHERE id = $1", [id]);
  });
  res.status(204).send();
});

/**
 * POST /api/rac
 * Alta manual de un registro (fuera del flujo de carga masiva de Excel).
 * Útil para correcciones puntuales de un operador.
 */
router.post("/", requireAuth, requireRol("operador", "admin"), async (req, res) => {
  const { cedula, plantel_id, cargo, turno, horas_academicas, horas_adm, periodo_escolar } = req.body;
  if (!cedula || !plantel_id || !periodo_escolar) {
    return res.status(400).json({ error: "Faltan campos obligatorios: cedula, plantel_id, periodo_escolar." });
  }

  try {
    const resultado = await conTransaccionAuditada(req.usuario.id, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO rac (cedula, plantel_id, cargo, turno, horas_academicas, horas_adm, periodo_escolar)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [
          cedula.trim().replace(/^0+/, ""),
          plantel_id,
          cargo || null,
          turno || null,
          horas_academicas || 0,
          horas_adm || 0,
          periodo_escolar,
        ]
      );
      return rows[0];
    });
    res.status(201).json(resultado);
  } catch (err) {
    res.status(500).json({ error: "No se pudo crear el registro.", detalle: err.message });
  }
});

/**
 * POST /api/rac/resolver-alta/:alertaId
 * MEJORA 5: resuelve una alerta "plantel_no_existe" haciendo el INSERT real
 * en `rac` que nunca llegó a ocurrir durante la carga (esas filas se
 * rechazan sin insertarse, solo queda la alerta con el detalle completo de
 * la fila en `alertas.detalle_fila`).
 *
 * Body esperado: { codigo_plantel, ...camposEditados } -- el frontend
 * precarga el formulario con `detalle_fila` y el usuario corrige el código
 * de plantel (con el autocomplete de /api/planteles) más lo que haga falta;
 * solo hay que enviar los campos que el usuario efectivamente tocó, el resto
 * se completa con lo que ya traía `detalle_fila`.
 *
 * La cédula NUNCA se toma del body -- siempre la de la alerta original, por
 * la misma razón que en el PATCH normal (identifica al trabajador, no es
 * editable aquí).
 *
 * Al completar el alta:
 *  1. Se valida el código de plantel corregido contra el catálogo maestro.
 *  2. Se hace el INSERT en `rac` combinando detalle_fila + lo enviado en el
 *     body (el body gana si un campo viene en ambos).
 *  3. Si la cédula no existe en personal_ministerio, se genera la alerta
 *     "cedula_no_existe_nomina" (mismo comportamiento que la carga normal).
 *  4. La alerta original se marca 'resuelta' automáticamente (decisión del
 *     usuario), todo dentro de la misma transacción.
 */
const CAMPOS_RAC_EDITABLES = [
  "codigo_dependencia",
  "codigo_cargo",
  "cargo",
  "tipo_personal",
  "turno",
  "horas_academicas",
  "horas_adm",
  "situacion",
  "nivel",
  "modalidad",
  "ubicacion_geografica",
  "turnos_plantel",
  "codigo_estadistico",
  "fecha_ingreso",
  "sexo",
  "grado_imparte",
  "seccion",
  "especialidad",
  "anio",
  "secciones",
  "materia",
  "periodo_grupo",
  "observacion",
  "edad",
  "comparativa",
];

router.post(
  "/resolver-alta/:alertaId",
  requireAuth,
  requireRol("operador", "admin"),
  async (req, res) => {
    const { alertaId } = req.params;
    const { codigo_plantel } = req.body;

    if (!codigo_plantel) {
      return res.status(400).json({ error: "Falta el código de plantel corregido." });
    }

    try {
      const resultado = await conTransaccionAuditada(req.usuario.id, async (client) => {
        const alertaRes = await client.query(
          `SELECT * FROM alertas WHERE id = $1 AND tipo = 'plantel_no_existe' AND estado = 'pendiente'`,
          [alertaId]
        );
        const alerta = alertaRes.rows[0];
        if (!alerta) {
          return { error: "No se encontró una alerta pendiente de tipo plantel_no_existe con ese id." };
        }

        const plantelRes = await client.query(
          "SELECT id FROM planteles WHERE codigo_plantel = $1",
          [String(codigo_plantel).trim()]
        );
        if (plantelRes.rows.length === 0) {
          return { error: `El código de plantel "${codigo_plantel}" tampoco existe en el catálogo maestro. Verifica el código.` };
        }
        const plantelId = plantelRes.rows[0].id;
        const cedula = alerta.cedula;

        // Ya existe en rac esta cédula+plantel corregido? (caso borde: otra
        // carga o alta manual ya cubrió este registro mientras tanto)
        const existeRes = await client.query(
          "SELECT id FROM rac WHERE cedula = $1 AND plantel_id = $2",
          [cedula, plantelId]
        );
        if (existeRes.rows.length > 0) {
          return { error: `Ya existe un registro en el RAC para esta cédula en el plantel ${codigo_plantel} (rac.id=${existeRes.rows[0].id}). Resuelve la alerta manualmente en vez de dar de alta.` };
        }

        // detalle_fila trae todos los datos de la fila original rechazada;
        // el body puede traer correcciones puntuales que el usuario haya
        // hecho en el formulario -- el body gana si el campo viene en ambos.
        const detalleFila = alerta.detalle_fila || {};
        const datos = {};
        for (const campo of CAMPOS_RAC_EDITABLES) {
          datos[campo] =
            req.body[campo] !== undefined ? req.body[campo] : detalleFila[campo] !== undefined ? detalleFila[campo] : null;
        }

        const insertRes = await client.query(
          `INSERT INTO rac
            (cedula, plantel_id, codigo_dependencia, codigo_cargo, cargo, tipo_personal, turno,
             horas_academicas, horas_adm, situacion, nivel, modalidad, ubicacion_geografica,
             turnos_plantel, codigo_estadistico, fecha_ingreso, sexo, grado_imparte, seccion,
             especialidad, anio, secciones, materia, periodo_grupo, observacion, edad, comparativa,
             actualizado_en, visto_en)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
                   $19, $20, $21, $22, $23, $24, $25, $26, $27, now(), now())
           RETURNING *`,
          [
            cedula,
            plantelId,
            datos.codigo_dependencia,
            datos.codigo_cargo,
            datos.cargo,
            datos.tipo_personal,
            datos.turno,
            datos.horas_academicas,
            datos.horas_adm,
            datos.situacion,
            datos.nivel,
            datos.modalidad,
            datos.ubicacion_geografica,
            datos.turnos_plantel,
            datos.codigo_estadistico,
            datos.fecha_ingreso,
            datos.sexo,
            datos.grado_imparte,
            datos.seccion,
            datos.especialidad,
            datos.anio,
            datos.secciones,
            datos.materia,
            datos.periodo_grupo,
            datos.observacion,
            datos.edad,
            datos.comparativa,
          ]
        );
        const nuevoRegistro = insertRes.rows[0];

        const nominaRes = await client.query(
          "SELECT 1 FROM personal_ministerio WHERE cedula = $1",
          [cedula]
        );
        if (nominaRes.rows.length === 0) {
          await client.query(
            `INSERT INTO alertas (tipo, cedula, detalle, estado, creado_en)
             VALUES ($1, $2, $3, 'pendiente', now())`,
            ["cedula_no_existe_nomina", cedula, "La cédula no existe en la nómina del Ministerio de Educación"]
          );
        }

        await client.query(
          `UPDATE alertas SET estado = 'resuelta' WHERE id = $1`,
          [alertaId]
        );

        return { registro: nuevoRegistro };
      });

      if (resultado.error) {
        return res.status(400).json({ error: resultado.error });
      }
      res.status(201).json(resultado.registro);
    } catch (err) {
      console.error("Error en /resolver-alta:", err);
      res.status(500).json({ error: "No se pudo resolver la alerta con alta manual.", detalle: err.message });
    }
  }
);

module.exports = router;
