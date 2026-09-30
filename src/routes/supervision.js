const express = require("express");
const bcrypt = require("bcryptjs");
const { pool } = require("../db/pool");
const { requireAuth, requireRol, requireMismoPlantel } = require("../middleware/auth");

const router = express.Router();

// Roles que administran el módulo (ven y editan TODO): mismo criterio que
// ya usa requireMismoMunicipio/requireMismoPlantel para "oficina central".
const ROLES_SUPERVISION = ["admin", "supervision"];
// Roles que además pueden entrar a endpoints de un plantel puntual (el
// director, restringido a su propio codigo_plantel por requireMismoPlantel).
const ROLES_SUPERVISION_Y_DIRECTOR = [...ROLES_SUPERVISION, "director"];

// =========================================================
// PLANTELES (catálogo propio de Supervisión, independiente
// de `planteles`/GESCOLAR -- ver nota en el schema)
// =========================================================

router.get("/planteles", requireAuth, requireRol(...ROLES_SUPERVISION), async (req, res) => {
  const q = (req.query.q || "").trim().toLowerCase();
  try {
    const params = [];
    let condicion = "";
    if (q.length >= 2) {
      params.push(`%${q}%`);
      condicion = `WHERE LOWER(codigo_plantel) LIKE $1 OR LOWER(eponimo_actual) LIKE $1 OR LOWER(nombre_comuna) LIKE $1`;
    }
    const { rows } = await pool.query(
      `SELECT * FROM planteles_supervision ${condicion} ORDER BY eponimo_actual LIMIT 300`,
      params
    );
    res.json({ planteles: rows });
  } catch (err) {
    console.error("Error listando planteles de supervisión:", err);
    res.status(500).json({ error: "No se pudo consultar los planteles." });
  }
});

// Info breve de uno o varios planteles por código, para los modales
// "Editar" de supervisores municipales/circuitales: al escribir los
// códigos a asignar/quitar muestra nombre del plantel, municipio,
// parroquia y circuito (sale del mapa `plantel_circuito`).
// GET /plantel-info?codigos=COD1,COD2,...  (acepta comas, espacios o ;)
router.get("/plantel-info", requireAuth, requireRol(...ROLES_SUPERVISION), async (req, res) => {
  const codigos = [
    ...new Set(
      String(req.query.codigos || "")
        .split(/[\s,;]+/)
        .map((c) => c.trim().toUpperCase())
        .filter(Boolean)
    ),
  ].slice(0, 50);
  if (!codigos.length) return res.json({ planteles: [], no_encontrados: [] });
  try {
    const { rows } = await pool.query(
      `SELECT p.codigo_plantel, p.eponimo_actual,
              pc.estado, pc.municipio, pc.parroquia,
              c.codigo_circuito AS nro_circuito, c.nombre AS nombre_circuito
       FROM planteles_supervision p
       LEFT JOIN plantel_circuito pc ON pc.codigo_plantel = p.codigo_plantel
       LEFT JOIN circuitos_educativos c ON c.codigo_circuito = pc.codigo_circuito
       WHERE UPPER(p.codigo_plantel) = ANY($1::text[])
       ORDER BY p.eponimo_actual`,
      [codigos]
    );
    const encontrados = new Set(rows.map((r) => String(r.codigo_plantel).toUpperCase()));
    res.json({
      planteles: rows,
      no_encontrados: codigos.filter((c) => !encontrados.has(c)),
    });
  } catch (err) {
    console.error("Error consultando info de planteles (supervisión):", err);
    res.status(500).json({ error: "No se pudo consultar la información de los planteles." });
  }
});

// Ficha completa de un plantel: datos propios + director + supervisores
// asignados + última matrícula cargada. Accesible también para el
// director de ESE plantel puntual (requireMismoPlantel).
router.get(
  "/planteles/:codigoPlantel",
  requireAuth,
  requireRol(...ROLES_SUPERVISION_Y_DIRECTOR),
  requireMismoPlantel((req) => req.params.codigoPlantel),
  async (req, res) => {
    const codigoPlantel = req.params.codigoPlantel.trim();
    try {
      const plantel = await pool.query("SELECT * FROM planteles_supervision WHERE codigo_plantel = $1", [codigoPlantel]);
      if (!plantel.rows[0]) return res.status(404).json({ error: "No existe ese plantel en Supervisión." });

      const director = await pool.query("SELECT * FROM directores_supervision WHERE codigo_plantel = $1", [codigoPlantel]);
      const supMun = await pool.query(
        `SELECT sm.* FROM supervisores_municipales sm
         JOIN supervisor_municipal_plantel smp ON smp.supervisor_municipal_id = sm.id
         WHERE smp.codigo_plantel = $1`,
        [codigoPlantel]
      );
      const supCirc = await pool.query(
        `SELECT sc.* FROM supervisores_circuitales sc
         JOIN supervisor_circuital_plantel scp ON scp.supervisor_circuital_id = sc.id
         WHERE scp.codigo_plantel = $1`,
        [codigoPlantel]
      );
      const matricula = await pool.query(
        "SELECT * FROM matricula_planteles WHERE codigo_plantel = $1 ORDER BY periodo_escolar DESC",
        [codigoPlantel]
      );

      res.json({
        plantel: plantel.rows[0],
        director: director.rows[0] || null,
        supervisores_municipales: supMun.rows,
        supervisores_circuitales: supCirc.rows,
        matricula_historico: matricula.rows,
      });
    } catch (err) {
      console.error("Error consultando ficha de plantel (supervisión):", err);
      res.status(500).json({ error: "No se pudo consultar el plantel." });
    }
  }
);

router.post("/planteles", requireAuth, requireRol(...ROLES_SUPERVISION), async (req, res) => {
  const {
    codigo_plantel, eponimo_anterior, eponimo_actual, denominacion,
    niveles_modalidad, dependencia, turno, direccion,
    coordenadas_geo, ubicacion_geo, cod_comuna, nombre_comuna,
  } = req.body || {};
  if (!codigo_plantel || !eponimo_actual) {
    return res.status(400).json({ error: "Faltan codigo_plantel o eponimo_actual." });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO planteles_supervision
        (codigo_plantel, eponimo_anterior, eponimo_actual, denominacion, niveles_modalidad,
         dependencia, turno, direccion, coordenadas_geo, ubicacion_geo, cod_comuna, nombre_comuna)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [codigo_plantel, eponimo_anterior || null, eponimo_actual, denominacion || null, niveles_modalidad || null,
       dependencia || null, turno || null, direccion || null, coordenadas_geo || null, ubicacion_geo || null,
       cod_comuna || null, nombre_comuna || null]
    );
    res.status(201).json({ plantel: rows[0] });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "Ya existe un plantel con ese código." });
    console.error("Error creando plantel (supervisión):", err);
    res.status(500).json({ error: "No se pudo crear el plantel." });
  }
});

router.put("/planteles/:codigoPlantel", requireAuth, requireRol(...ROLES_SUPERVISION), async (req, res) => {
  const codigoPlantel = req.params.codigoPlantel.trim();
  const {
    eponimo_anterior, eponimo_actual, denominacion, niveles_modalidad,
    dependencia, turno, direccion, coordenadas_geo, ubicacion_geo, cod_comuna, nombre_comuna,
  } = req.body || {};
  try {
    const { rows } = await pool.query(
      `UPDATE planteles_supervision SET
        eponimo_anterior = $1, eponimo_actual = $2, denominacion = $3, niveles_modalidad = $4,
        dependencia = $5, turno = $6, direccion = $7, coordenadas_geo = $8, ubicacion_geo = $9,
        cod_comuna = $10, nombre_comuna = $11, actualizado_en = now()
       WHERE codigo_plantel = $12
       RETURNING *`,
      [eponimo_anterior || null, eponimo_actual, denominacion || null, niveles_modalidad || null,
       dependencia || null, turno || null, direccion || null, coordenadas_geo || null, ubicacion_geo || null,
       cod_comuna || null, nombre_comuna || null, codigoPlantel]
    );
    if (!rows[0]) return res.status(404).json({ error: "No existe ese plantel." });
    res.json({ plantel: rows[0] });
  } catch (err) {
    console.error("Error editando plantel (supervisión):", err);
    res.status(500).json({ error: "No se pudo editar el plantel." });
  }
});

// =========================================================
// RESUMEN -- conteos reales (COUNT) para el dashboard de
// Supervisión. Se hace aparte del listado de /planteles porque
// ese endpoint tiene un LIMIT 300 y no serviría para contar.
// =========================================================

router.get("/resumen", requireAuth, requireRol(...ROLES_SUPERVISION), async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM planteles_supervision)   AS planteles,
        (SELECT COUNT(*) FROM supervisores_municipales) AS supervisores_municipales,
        (SELECT COUNT(*) FROM supervisores_circuitales) AS supervisores_circuitales,
        (SELECT COUNT(*) FROM directores_supervision)   AS directores
    `);
    const fila = rows[0];
    res.json({
      planteles: Number(fila.planteles),
      supervisores_municipales: Number(fila.supervisores_municipales),
      supervisores_circuitales: Number(fila.supervisores_circuitales),
      directores: Number(fila.directores),
    });
  } catch (err) {
    console.error("Error calculando resumen de supervisión:", err);
    res.status(500).json({ error: "No se pudo calcular el resumen." });
  }
});

// =========================================================
// CONSOLIDADO -- vista combinada equivalente a la hoja
// CONSOLIDADO del Excel original: un plantel por fila con su
// director, supervisores asignados y última matrícula cargada.
// =========================================================

router.get("/consolidado", requireAuth, requireRol(...ROLES_SUPERVISION), async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        p.codigo_plantel, p.eponimo_actual, p.denominacion, p.niveles_modalidad,
        p.dependencia, p.turno, p.direccion, p.nombre_comuna,
        d.nombre AS director_nombre, d.cedula AS director_cedula, d.telefono AS director_telefono,
        string_agg(DISTINCT sm.nombre, ', ')                       AS supervisores_municipales,
        string_agg(DISTINCT (sc.nombres || ' ' || sc.apellidos), ', ') AS supervisores_circuitales,
        m.periodo_escolar AS matricula_periodo, m.hembras AS matricula_hembras,
        m.varones AS matricula_varones, m.total AS matricula_total
      FROM planteles_supervision p
      LEFT JOIN directores_supervision d ON d.codigo_plantel = p.codigo_plantel
      LEFT JOIN supervisor_municipal_plantel smp ON smp.codigo_plantel = p.codigo_plantel
      LEFT JOIN supervisores_municipales sm ON sm.id = smp.supervisor_municipal_id
      LEFT JOIN supervisor_circuital_plantel scp ON scp.codigo_plantel = p.codigo_plantel
      LEFT JOIN supervisores_circuitales sc ON sc.id = scp.supervisor_circuital_id
      LEFT JOIN LATERAL (
        SELECT periodo_escolar, hembras, varones, total
        FROM matricula_planteles mp
        WHERE mp.codigo_plantel = p.codigo_plantel
        ORDER BY periodo_escolar DESC
        LIMIT 1
      ) m ON true
      GROUP BY p.codigo_plantel, p.eponimo_actual, p.denominacion, p.niveles_modalidad,
               p.dependencia, p.turno, p.direccion, p.nombre_comuna,
               d.nombre, d.cedula, d.telefono,
               m.periodo_escolar, m.hembras, m.varones, m.total
      ORDER BY p.eponimo_actual
    `);
    res.json({ consolidado: rows });
  } catch (err) {
    console.error("Error generando consolidado de supervisión:", err);
    res.status(500).json({ error: "No se pudo generar el consolidado." });
  }
});

// =========================================================
// SUPERVISORES MUNICIPALES
// =========================================================

router.get("/supervisores-municipales", requireAuth, requireRol(...ROLES_SUPERVISION), async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM supervisores_municipales ORDER BY municipio");
    res.json({ supervisores: rows });
  } catch (err) {
    console.error("Error listando supervisores municipales:", err);
    res.status(500).json({ error: "No se pudo consultar los supervisores municipales." });
  }
});

// Los municipios del estado ENUMERADOS (1..13, en el orden oficial del
// código de circuito), cada uno con su supervisor municipal o, si todavía
// no tiene, supervisor_id = null para que la pantalla lo muestre en blanco
// ("sin datos"). La lista de municipios sale del mapa `plantel_circuito`,
// así que un municipio aparece aunque no tenga supervisor cargado.
router.get("/municipios", requireAuth, requireRol(...ROLES_SUPERVISION), async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT ROW_NUMBER() OVER (ORDER BY m.orden, m.municipio)::int AS numero,
             m.municipio,
             m.planteles,
             s.id       AS supervisor_id,
             s.nombre   AS supervisor_nombre,
             s.cedula   AS supervisor_cedula,
             s.telefono AS supervisor_telefono,
             s.correo   AS supervisor_correo
      FROM (
        SELECT pc.municipio,
               COUNT(*)::int AS planteles,
               MIN(NULLIF(SUBSTRING(pc.codigo_circuito FROM 3 FOR 2), '')::int) AS orden
        FROM plantel_circuito pc
        WHERE pc.municipio IS NOT NULL
        GROUP BY pc.municipio
      ) m
      LEFT JOIN LATERAL (
        SELECT sm.*
        FROM supervisores_municipales sm
        WHERE UPPER(TRIM(sm.municipio)) = UPPER(TRIM(m.municipio))
        ORDER BY sm.id
        LIMIT 1
      ) s ON true
      ORDER BY m.orden, m.municipio
    `);
    res.json({
      municipios: rows,
      total: rows.length,
      sin_supervisor: rows.filter((r) => r.supervisor_id === null).length,
    });
  } catch (err) {
    console.error("Error listando municipios (supervisión):", err);
    res.status(500).json({ error: "No se pudo consultar los municipios." });
  }
});

router.post("/supervisores-municipales", requireAuth, requireRol(...ROLES_SUPERVISION), async (req, res) => {
  const {
    estado, municipio, nombre, cedula, telefono, correo, parroquia,
    nro_cuenta, fecha_ingreso, cod_dependencia, titulo_pre_pos_grado,
    cargo_nominal, fecha_ultima_credencial,
  } = req.body || {};
  if (!municipio || !nombre || !cedula) {
    return res.status(400).json({ error: "Faltan municipio, nombre o cédula." });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO supervisores_municipales
        (estado, municipio, nombre, cedula, telefono, correo, parroquia, nro_cuenta,
         fecha_ingreso, cod_dependencia, titulo_pre_pos_grado, cargo_nominal, fecha_ultima_credencial)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [estado || null, municipio, nombre, cedula, telefono || null, correo || null, parroquia || null,
       nro_cuenta || null, fecha_ingreso || null, cod_dependencia || null, titulo_pre_pos_grado || null,
       cargo_nominal || null, fecha_ultima_credencial || null]
    );
    res.status(201).json({ supervisor: rows[0] });
  } catch (err) {
    console.error("Error creando supervisor municipal:", err);
    res.status(500).json({ error: "No se pudo crear el supervisor municipal." });
  }
});

router.put("/supervisores-municipales/:id", requireAuth, requireRol(...ROLES_SUPERVISION), async (req, res) => {
  const { id } = req.params;
  const {
    estado, municipio, nombre, cedula, telefono, correo, parroquia,
    nro_cuenta, fecha_ingreso, cod_dependencia, titulo_pre_pos_grado,
    cargo_nominal, fecha_ultima_credencial,
  } = req.body || {};
  try {
    const { rows } = await pool.query(
      `UPDATE supervisores_municipales SET
        estado=$1, municipio=$2, nombre=$3, cedula=$4, telefono=$5, correo=$6, parroquia=$7,
        nro_cuenta=$8, fecha_ingreso=$9, cod_dependencia=$10, titulo_pre_pos_grado=$11,
        cargo_nominal=$12, fecha_ultima_credencial=$13, actualizado_en=now()
       WHERE id=$14
       RETURNING *`,
      [estado || null, municipio, nombre, cedula, telefono || null, correo || null, parroquia || null,
       nro_cuenta || null, fecha_ingreso || null, cod_dependencia || null, titulo_pre_pos_grado || null,
       cargo_nominal || null, fecha_ultima_credencial || null, id]
    );
    if (!rows[0]) return res.status(404).json({ error: "No existe ese supervisor municipal." });
    res.json({ supervisor: rows[0] });
  } catch (err) {
    console.error("Error editando supervisor municipal:", err);
    res.status(500).json({ error: "No se pudo editar el supervisor municipal." });
  }
});

router.delete("/supervisores-municipales/:id", requireAuth, requireRol(...ROLES_SUPERVISION), async (req, res) => {
  try {
    const { rowCount } = await pool.query("DELETE FROM supervisores_municipales WHERE id = $1", [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: "No existe ese supervisor municipal." });
    res.json({ ok: true });
  } catch (err) {
    console.error("Error eliminando supervisor municipal:", err);
    res.status(500).json({ error: "No se pudo eliminar el supervisor municipal." });
  }
});

// Asigna/desasigna planteles a un supervisor municipal.
router.post("/supervisores-municipales/:id/planteles", requireAuth, requireRol(...ROLES_SUPERVISION), async (req, res) => {
  const { codigo_plantel } = req.body || {};
  if (!codigo_plantel) return res.status(400).json({ error: "Falta codigo_plantel." });
  try {
    await pool.query(
      `INSERT INTO supervisor_municipal_plantel (supervisor_municipal_id, codigo_plantel)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [req.params.id, codigo_plantel]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("Error asignando plantel a supervisor municipal:", err);
    res.status(500).json({ error: "No se pudo asignar el plantel (¿existe ese código en Supervisión?)." });
  }
});

router.delete("/supervisores-municipales/:id/planteles/:codigoPlantel", requireAuth, requireRol(...ROLES_SUPERVISION), async (req, res) => {
  try {
    await pool.query(
      "DELETE FROM supervisor_municipal_plantel WHERE supervisor_municipal_id = $1 AND codigo_plantel = $2",
      [req.params.id, req.params.codigoPlantel]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("Error quitando plantel de supervisor municipal:", err);
    res.status(500).json({ error: "No se pudo quitar el plantel." });
  }
});

// =========================================================
// SUPERVISORES CIRCUITALES (mismo patrón que municipales)
// =========================================================

// El circuito de cada supervisor se DERIVA de sus planteles asignados
// (supervisor_circuital_plantel -> plantel_circuito -> circuitos_educativos),
// porque num_circuito/nombre_circuito de la propia tabla quedaron vacíos.
// Si un supervisor cubre 2 circuitos salen ambos separados por coma. Si no
// tiene planteles asignados se usa lo que tenga guardado en su fila.
router.get("/supervisores-circuitales", requireAuth, requireRol(...ROLES_SUPERVISION), async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT sc.id,
             COALESCE(circ.codigos, sc.num_circuito)     AS num_circuito,
             COALESCE(circ.nombres, sc.nombre_circuito)  AS nombre_circuito,
             sc.nombres, sc.apellidos, sc.cedula, sc.numero_cuenta, sc.codigo_nominal,
             sc.plantel_dependencia, sc.titulo_pregrado, sc.titulo_pre_pos_grado,
             sc.cargo_nominal, sc.telefono, sc.correo, sc.fecha_ingreso,
             sc.creado_en, sc.actualizado_en
      FROM supervisores_circuitales sc
      LEFT JOIN LATERAL (
        SELECT string_agg(DISTINCT c.codigo_circuito, ', ' ORDER BY c.codigo_circuito) AS codigos,
               string_agg(DISTINCT c.nombre, ', ' ORDER BY c.nombre)                   AS nombres
        FROM supervisor_circuital_plantel scp
        JOIN plantel_circuito pc ON pc.codigo_plantel = scp.codigo_plantel
        JOIN circuitos_educativos c ON c.codigo_circuito = pc.codigo_circuito
        WHERE scp.supervisor_circuital_id = sc.id
      ) circ ON true
      ORDER BY COALESCE(circ.codigos, sc.num_circuito) NULLS LAST, sc.apellidos, sc.nombres
    `);
    res.json({ supervisores: rows });
  } catch (err) {
    console.error("Error listando supervisores circuitales:", err);
    res.status(500).json({ error: "No se pudo consultar los supervisores circuitales." });
  }
});

router.post("/supervisores-circuitales", requireAuth, requireRol(...ROLES_SUPERVISION), async (req, res) => {
  const {
    num_circuito, nombre_circuito, nombres, apellidos, cedula, numero_cuenta,
    codigo_nominal, plantel_dependencia, titulo_pregrado, titulo_pre_pos_grado,
    cargo_nominal, telefono, correo, fecha_ingreso,
  } = req.body || {};
  if (!nombres || !apellidos || !cedula) {
    return res.status(400).json({ error: "Faltan nombres, apellidos o cédula." });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO supervisores_circuitales
        (num_circuito, nombre_circuito, nombres, apellidos, cedula, numero_cuenta, codigo_nominal,
         plantel_dependencia, titulo_pregrado, titulo_pre_pos_grado, cargo_nominal, telefono, correo, fecha_ingreso)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [num_circuito || null, nombre_circuito || null, nombres, apellidos, cedula, numero_cuenta || null,
       codigo_nominal || null, plantel_dependencia || null, titulo_pregrado || null, titulo_pre_pos_grado || null,
       cargo_nominal || null, telefono || null, correo || null, fecha_ingreso || null]
    );
    res.status(201).json({ supervisor: rows[0] });
  } catch (err) {
    console.error("Error creando supervisor circuital:", err);
    res.status(500).json({ error: "No se pudo crear el supervisor circuital." });
  }
});

router.put("/supervisores-circuitales/:id", requireAuth, requireRol(...ROLES_SUPERVISION), async (req, res) => {
  const { id } = req.params;
  const {
    num_circuito, nombre_circuito, nombres, apellidos, cedula, numero_cuenta,
    codigo_nominal, plantel_dependencia, titulo_pregrado, titulo_pre_pos_grado,
    cargo_nominal, telefono, correo, fecha_ingreso,
  } = req.body || {};
  try {
    const { rows } = await pool.query(
      `UPDATE supervisores_circuitales SET
        num_circuito=$1, nombre_circuito=$2, nombres=$3, apellidos=$4, cedula=$5, numero_cuenta=$6,
        codigo_nominal=$7, plantel_dependencia=$8, titulo_pregrado=$9, titulo_pre_pos_grado=$10,
        cargo_nominal=$11, telefono=$12, correo=$13, fecha_ingreso=$14, actualizado_en=now()
       WHERE id=$15
       RETURNING *`,
      [num_circuito || null, nombre_circuito || null, nombres, apellidos, cedula, numero_cuenta || null,
       codigo_nominal || null, plantel_dependencia || null, titulo_pregrado || null, titulo_pre_pos_grado || null,
       cargo_nominal || null, telefono || null, correo || null, fecha_ingreso || null, id]
    );
    if (!rows[0]) return res.status(404).json({ error: "No existe ese supervisor circuital." });
    res.json({ supervisor: rows[0] });
  } catch (err) {
    console.error("Error editando supervisor circuital:", err);
    res.status(500).json({ error: "No se pudo editar el supervisor circuital." });
  }
});

router.delete("/supervisores-circuitales/:id", requireAuth, requireRol(...ROLES_SUPERVISION), async (req, res) => {
  try {
    const { rowCount } = await pool.query("DELETE FROM supervisores_circuitales WHERE id = $1", [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: "No existe ese supervisor circuital." });
    res.json({ ok: true });
  } catch (err) {
    console.error("Error eliminando supervisor circuital:", err);
    res.status(500).json({ error: "No se pudo eliminar el supervisor circuital." });
  }
});

router.post("/supervisores-circuitales/:id/planteles", requireAuth, requireRol(...ROLES_SUPERVISION), async (req, res) => {
  const { codigo_plantel } = req.body || {};
  if (!codigo_plantel) return res.status(400).json({ error: "Falta codigo_plantel." });
  try {
    await pool.query(
      `INSERT INTO supervisor_circuital_plantel (supervisor_circuital_id, codigo_plantel)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [req.params.id, codigo_plantel]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("Error asignando plantel a supervisor circuital:", err);
    res.status(500).json({ error: "No se pudo asignar el plantel (¿existe ese código en Supervisión?)." });
  }
});

router.delete("/supervisores-circuitales/:id/planteles/:codigoPlantel", requireAuth, requireRol(...ROLES_SUPERVISION), async (req, res) => {
  try {
    await pool.query(
      "DELETE FROM supervisor_circuital_plantel WHERE supervisor_circuital_id = $1 AND codigo_plantel = $2",
      [req.params.id, req.params.codigoPlantel]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("Error quitando plantel de supervisor circuital:", err);
    res.status(500).json({ error: "No se pudo quitar el plantel." });
  }
});

// =========================================================
// CIRCUITOS EDUCATIVOS (catálogo + mapa por plantel)
// Tablas: circuitos_educativos (codigo_circuito, nombre, activo)
//         plantel_circuito (codigo_plantel -> codigo_circuito,
//                           estado, municipio, parroquia)
// El NOMBRE del circuito se repite entre municipios; la clave es el
// CÓDIGO (9 dígitos, los 4 primeros = municipio).
// =========================================================

// Catálogo completo con cantidad de planteles y su supervisor circuital
// (derivado de los planteles asignados). supervisor = null => circuito
// SIN supervisor cargado (para marcarlo en la pantalla).
router.get("/circuitos", requireAuth, requireRol(...ROLES_SUPERVISION), async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.codigo_circuito, c.nombre, c.activo,
             (SELECT COUNT(*) FROM plantel_circuito pc
               WHERE pc.codigo_circuito = c.codigo_circuito)::int AS planteles,
             (SELECT MIN(pc.municipio) FROM plantel_circuito pc
               WHERE pc.codigo_circuito = c.codigo_circuito)      AS municipio,
             s.supervisor, s.supervisor_id
      FROM circuitos_educativos c
      LEFT JOIN LATERAL (
        SELECT string_agg(DISTINCT (sc.nombres || ' ' || sc.apellidos),
                          ', ' ORDER BY (sc.nombres || ' ' || sc.apellidos)) AS supervisor,
               MIN(sc.id) AS supervisor_id
        FROM plantel_circuito pc2
        JOIN supervisor_circuital_plantel scp ON scp.codigo_plantel = pc2.codigo_plantel
        JOIN supervisores_circuitales sc ON sc.id = scp.supervisor_circuital_id
        WHERE pc2.codigo_circuito = c.codigo_circuito
      ) s ON true
      ORDER BY c.codigo_circuito
    `);
    res.json({
      circuitos: rows,
      total: rows.length,
      sin_supervisor: rows.filter((r) => !r.supervisor).length,
    });
  } catch (err) {
    console.error("Error listando circuitos (supervisión):", err);
    res.status(500).json({ error: "No se pudo consultar los circuitos." });
  }
});

// Detalle de un circuito: sus planteles (con municipio y parroquia) y
// su(s) supervisor(es) circuital(es).
router.get("/circuitos/:codigoCircuito", requireAuth, requireRol(...ROLES_SUPERVISION), async (req, res) => {
  const codigo = req.params.codigoCircuito.trim();
  try {
    const circuito = await pool.query("SELECT * FROM circuitos_educativos WHERE codigo_circuito = $1", [codigo]);
    if (!circuito.rows[0]) return res.status(404).json({ error: "No existe ese circuito." });

    const planteles = await pool.query(
      `SELECT p.codigo_plantel, p.eponimo_actual, pc.municipio, pc.parroquia
       FROM plantel_circuito pc
       JOIN planteles_supervision p ON p.codigo_plantel = pc.codigo_plantel
       WHERE pc.codigo_circuito = $1
       ORDER BY p.eponimo_actual`,
      [codigo]
    );
    const supervisores = await pool.query(
      `SELECT DISTINCT sc.id, sc.nombres, sc.apellidos, sc.cedula, sc.telefono, sc.correo
       FROM plantel_circuito pc
       JOIN supervisor_circuital_plantel scp ON scp.codigo_plantel = pc.codigo_plantel
       JOIN supervisores_circuitales sc ON sc.id = scp.supervisor_circuital_id
       WHERE pc.codigo_circuito = $1
       ORDER BY sc.apellidos, sc.nombres`,
      [codigo]
    );
    res.json({
      circuito: circuito.rows[0],
      planteles: planteles.rows,
      supervisores: supervisores.rows,
    });
  } catch (err) {
    console.error("Error consultando circuito (supervisión):", err);
    res.status(500).json({ error: "No se pudo consultar el circuito." });
  }
});

// Crea un circuito nuevo (por si nace uno).
router.post("/circuitos", requireAuth, requireRol(...ROLES_SUPERVISION), async (req, res) => {
  const codigo = String((req.body || {}).codigo_circuito || "").trim();
  const nombre = String((req.body || {}).nombre || "").trim().toUpperCase();
  if (!/^\d{9}$/.test(codigo)) {
    return res.status(400).json({ error: "El código de circuito debe tener 9 dígitos (ej. 160101001)." });
  }
  if (!nombre) return res.status(400).json({ error: "Falta el nombre del circuito." });
  try {
    const { rows } = await pool.query(
      "INSERT INTO circuitos_educativos (codigo_circuito, nombre) VALUES ($1, $2) RETURNING *",
      [codigo, nombre]
    );
    res.status(201).json({ circuito: rows[0] });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "Ya existe un circuito con ese código." });
    console.error("Error creando circuito (supervisión):", err);
    res.status(500).json({ error: "No se pudo crear el circuito." });
  }
});

// Cambia el nombre o activa/desactiva un circuito (el código no se cambia).
const editarCircuito = async (req, res) => {
  const codigo = req.params.codigoCircuito.trim();
  const nombre = String((req.body || {}).nombre || "").trim().toUpperCase();
  const activo = (req.body || {}).activo;
  if (!nombre) return res.status(400).json({ error: "Falta el nombre del circuito." });
  try {
    const { rows } = await pool.query(
      `UPDATE circuitos_educativos
          SET nombre = $1, activo = COALESCE($2, activo), actualizado_en = now()
        WHERE codigo_circuito = $3
        RETURNING *`,
      [nombre, typeof activo === "boolean" ? activo : null, codigo]
    );
    if (!rows[0]) return res.status(404).json({ error: "No existe ese circuito." });
    res.json({ circuito: rows[0] });
  } catch (err) {
    console.error("Error editando circuito (supervisión):", err);
    res.status(500).json({ error: "No se pudo editar el circuito." });
  }
};
router.put("/circuitos/:codigoCircuito", requireAuth, requireRol(...ROLES_SUPERVISION), editarCircuito);
router.patch("/circuitos/:codigoCircuito", requireAuth, requireRol(...ROLES_SUPERVISION), editarCircuito);

// Asigna un plantel a un circuito (lo mueve si ya estaba en otro).
router.post("/circuitos/:codigoCircuito/planteles", requireAuth, requireRol(...ROLES_SUPERVISION), async (req, res) => {
  const codigo = req.params.codigoCircuito.trim();
  const codigoPlantel = String((req.body || {}).codigo_plantel || "").trim();
  if (!codigoPlantel) return res.status(400).json({ error: "Falta codigo_plantel." });
  try {
    const circuito = await pool.query("SELECT 1 FROM circuitos_educativos WHERE codigo_circuito = $1", [codigo]);
    if (!circuito.rows[0]) return res.status(404).json({ error: "No existe ese circuito." });
    const plantel = await pool.query("SELECT 1 FROM planteles_supervision WHERE codigo_plantel = $1", [codigoPlantel]);
    if (!plantel.rows[0]) return res.status(404).json({ error: "No existe ese plantel en Supervisión." });

    await pool.query(
      `INSERT INTO plantel_circuito (codigo_plantel, codigo_circuito)
       VALUES ($1, $2)
       ON CONFLICT (codigo_plantel)
       DO UPDATE SET codigo_circuito = EXCLUDED.codigo_circuito, actualizado_en = now()`,
      [codigoPlantel, codigo]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("Error asignando plantel a circuito (supervisión):", err);
    res.status(500).json({ error: "No se pudo asignar el plantel al circuito." });
  }
});

// Quita un plantel de un circuito (queda sin circuito).
router.delete("/circuitos/:codigoCircuito/planteles/:codigoPlantel", requireAuth, requireRol(...ROLES_SUPERVISION), async (req, res) => {
  try {
    await pool.query(
      `UPDATE plantel_circuito SET codigo_circuito = NULL, actualizado_en = now()
        WHERE codigo_plantel = $1 AND codigo_circuito = $2`,
      [req.params.codigoPlantel.trim(), req.params.codigoCircuito.trim()]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("Error quitando plantel de circuito (supervisión):", err);
    res.status(500).json({ error: "No se pudo quitar el plantel del circuito." });
  }
});

// =========================================================
// ALERTAS DE SUPERVISIÓN -- se calculan EN VIVO sobre las tablas del
// módulo (no se guardan): cuando se corrige el dato, la alerta
// desaparece sola. Cada alerta devuelve su total real y hasta
// LIMITE_ALERTAS filas de ejemplo con el mismo formato
// {codigo, nombre, detalle}. Son distintas de las alertas del RAC
// (/api/alertas), que siguen en su propia pantalla.
// =========================================================

const LIMITE_ALERTAS = 300;

// Todas las personas del módulo (supervisores y directores) con su cédula
// limpia (solo dígitos) y su nombre normalizado, para cruzar duplicados.
const PERSONAS_CTE = `
  personas AS (
    SELECT 'Municipal' AS origen,
           UPPER(REGEXP_REPLACE(TRIM(COALESCE(sm.nombre, '')), '\\s+', ' ', 'g')) AS persona,
           REGEXP_REPLACE(COALESCE(sm.cedula::text, ''), '\\D', '', 'g') AS ced
    FROM supervisores_municipales sm
    UNION ALL
    SELECT 'Circuital',
           UPPER(REGEXP_REPLACE(TRIM(COALESCE(sc.nombres, '') || ' ' || COALESCE(sc.apellidos, '')), '\\s+', ' ', 'g')),
           REGEXP_REPLACE(COALESCE(sc.cedula::text, ''), '\\D', '', 'g')
    FROM supervisores_circuitales sc
    UNION ALL
    SELECT 'Director',
           UPPER(REGEXP_REPLACE(TRIM(COALESCE(d.nombre, '')), '\\s+', ' ', 'g')),
           REGEXP_REPLACE(COALESCE(d.cedula::text, ''), '\\D', '', 'g')
    FROM directores_supervision d
  )`;

const PLANTEL_BASE = `
  FROM planteles_supervision p
  LEFT JOIN plantel_circuito pc ON pc.codigo_plantel = p.codigo_plantel`;

const ALERTAS_SUPERVISION = [
  {
    clave: "circuitos_sin_supervisor",
    titulo: "Circuitos sin supervisor circuital",
    severidad: "alta",
    descripcion: "Circuitos activos cuyos planteles no tienen ningún supervisor circuital asignado.",
    sql: `
      SELECT c.codigo_circuito AS codigo, c.nombre AS nombre,
             COALESCE((SELECT MIN(x.municipio) FROM plantel_circuito x WHERE x.codigo_circuito = c.codigo_circuito), 'sin municipio')
               || ' · ' || (SELECT COUNT(*) FROM plantel_circuito x WHERE x.codigo_circuito = c.codigo_circuito) || ' planteles' AS detalle
      FROM circuitos_educativos c
      WHERE c.activo
        AND NOT EXISTS (
          SELECT 1 FROM plantel_circuito x
          JOIN supervisor_circuital_plantel scp ON scp.codigo_plantel = x.codigo_plantel
          WHERE x.codigo_circuito = c.codigo_circuito)
      ORDER BY c.codigo_circuito`,
  },
  {
    clave: "municipios_sin_supervisor",
    titulo: "Municipios sin supervisor municipal",
    severidad: "alta",
    descripcion: "Municipios con planteles cargados que todavía no tienen supervisor municipal.",
    sql: `
      SELECT '' AS codigo, m.municipio AS nombre, m.planteles || ' planteles' AS detalle
      FROM (SELECT municipio, COUNT(*) AS planteles FROM plantel_circuito
            WHERE municipio IS NOT NULL GROUP BY municipio) m
      WHERE NOT EXISTS (
        SELECT 1 FROM supervisores_municipales sm
        WHERE UPPER(TRIM(sm.municipio)) = UPPER(TRIM(m.municipio)))
      ORDER BY m.municipio`,
  },
  {
    clave: "planteles_sin_director",
    titulo: "Planteles sin director",
    severidad: "alta",
    descripcion: "Planteles que no tienen director cargado.",
    sql: `
      SELECT p.codigo_plantel AS codigo, p.eponimo_actual AS nombre, COALESCE(pc.municipio, 'sin municipio') AS detalle
      ${PLANTEL_BASE}
      WHERE NOT EXISTS (SELECT 1 FROM directores_supervision d WHERE d.codigo_plantel = p.codigo_plantel)
      ORDER BY p.eponimo_actual`,
  },
  {
    clave: "personas_varias_cedulas",
    titulo: "Misma persona con varias cédulas",
    severidad: "media",
    descripcion: "El mismo nombre aparece con cédulas distintas (típico error de arrastre en Excel o de digitación; también puede ser un homónimo).",
    sql: `
      WITH ${PERSONAS_CTE}
      SELECT '' AS codigo, persona AS nombre,
             COUNT(DISTINCT ced) || ' cédulas: ' || STRING_AGG(DISTINCT ced, ', ') AS detalle
      FROM personas WHERE persona <> '' AND ced <> ''
      GROUP BY persona HAVING COUNT(DISTINCT ced) > 1
      ORDER BY persona`,
  },
  {
    clave: "cedulas_varios_nombres",
    titulo: "Misma cédula con nombres distintos",
    severidad: "media",
    descripcion: "Una misma cédula está cargada a nombres diferentes (error de digitación, o el mismo nombre escrito distinto).",
    sql: `
      WITH ${PERSONAS_CTE}
      SELECT ced AS codigo, STRING_AGG(DISTINCT persona, ' / ') AS nombre,
             COUNT(DISTINCT persona) || ' nombres distintos' AS detalle
      FROM personas WHERE persona <> '' AND ced <> ''
      GROUP BY ced HAVING COUNT(DISTINCT persona) > 1
      ORDER BY ced`,
  },
  {
    clave: "planteles_sin_supervisor_municipal",
    titulo: "Planteles sin supervisor municipal asignado",
    severidad: "media",
    descripcion: "Planteles que no figuran en la lista de planteles de ningún supervisor municipal.",
    sql: `
      SELECT p.codigo_plantel AS codigo, p.eponimo_actual AS nombre, COALESCE(pc.municipio, 'sin municipio') AS detalle
      ${PLANTEL_BASE}
      WHERE NOT EXISTS (SELECT 1 FROM supervisor_municipal_plantel x WHERE x.codigo_plantel = p.codigo_plantel)
      ORDER BY p.eponimo_actual`,
  },
  {
    clave: "planteles_sin_supervisor_circuital",
    titulo: "Planteles sin supervisor circuital asignado",
    severidad: "media",
    descripcion: "Planteles que no figuran en la lista de planteles de ningún supervisor circuital.",
    sql: `
      SELECT p.codigo_plantel AS codigo, p.eponimo_actual AS nombre,
             COALESCE(pc.municipio, 'sin municipio') || COALESCE(' · circuito ' || pc.codigo_circuito, '') AS detalle
      ${PLANTEL_BASE}
      WHERE NOT EXISTS (SELECT 1 FROM supervisor_circuital_plantel x WHERE x.codigo_plantel = p.codigo_plantel)
      ORDER BY p.eponimo_actual`,
  },
  {
    clave: "planteles_sin_circuito",
    titulo: "Planteles sin circuito",
    severidad: "media",
    descripcion: "Planteles que no pertenecen a ningún circuito educativo.",
    sql: `
      SELECT p.codigo_plantel AS codigo, p.eponimo_actual AS nombre, COALESCE(pc.municipio, 'sin municipio') AS detalle
      ${PLANTEL_BASE}
      WHERE pc.codigo_circuito IS NULL
      ORDER BY p.eponimo_actual`,
  },
  {
    clave: "supervisores_sin_contacto",
    titulo: "Supervisores sin teléfono o sin correo",
    severidad: "baja",
    descripcion: "Supervisores municipales o circuitales a los que les falta el teléfono, el correo o ambos.",
    sql: `
      SELECT 'Municipal' AS codigo, sm.nombre AS nombre,
             CONCAT_WS(', ',
               CASE WHEN COALESCE(TRIM(sm.telefono), '') = '' THEN 'sin teléfono' END,
               CASE WHEN COALESCE(TRIM(sm.correo), '') = '' THEN 'sin correo' END) AS detalle
      FROM supervisores_municipales sm
      WHERE COALESCE(TRIM(sm.telefono), '') = '' OR COALESCE(TRIM(sm.correo), '') = ''
      UNION ALL
      SELECT 'Circuital', sc.nombres || ' ' || sc.apellidos,
             CONCAT_WS(', ',
               CASE WHEN COALESCE(TRIM(sc.telefono), '') = '' THEN 'sin teléfono' END,
               CASE WHEN COALESCE(TRIM(sc.correo), '') = '' THEN 'sin correo' END)
      FROM supervisores_circuitales sc
      WHERE COALESCE(TRIM(sc.telefono), '') = '' OR COALESCE(TRIM(sc.correo), '') = ''
      ORDER BY 1, 2`,
  },
  {
    clave: "planteles_sin_parroquia",
    titulo: "Planteles sin parroquia",
    severidad: "baja",
    descripcion: "Planteles cuya parroquia no viene en el archivo de supervisores municipales.",
    sql: `
      SELECT p.codigo_plantel AS codigo, p.eponimo_actual AS nombre, COALESCE(pc.municipio, 'sin municipio') AS detalle
      ${PLANTEL_BASE}
      WHERE pc.codigo_plantel IS NOT NULL AND COALESCE(TRIM(pc.parroquia), '') = ''
      ORDER BY p.eponimo_actual`,
  },
  {
    clave: "planteles_sin_matricula",
    titulo: "Planteles sin matrícula cargada",
    severidad: "info",
    descripcion: "Planteles que todavía no tienen ninguna matrícula (hembras y varones) cargada por el director o por Supervisión.",
    sql: `
      SELECT p.codigo_plantel AS codigo, p.eponimo_actual AS nombre, COALESCE(pc.municipio, 'sin municipio') AS detalle
      ${PLANTEL_BASE}
      WHERE NOT EXISTS (SELECT 1 FROM matricula_planteles m WHERE m.codigo_plantel = p.codigo_plantel)
      ORDER BY p.eponimo_actual`,
  },
  {
    clave: "directores_sin_usuario",
    titulo: "Directores sin cuenta de acceso",
    severidad: "info",
    descripcion: "Directores que todavía no tienen usuario y contraseña para cargar la matrícula de su plantel.",
    sql: `
      SELECT d.codigo_plantel AS codigo, d.nombre AS nombre, COALESCE(p.eponimo_actual, 'plantel no encontrado') AS detalle
      FROM directores_supervision d
      LEFT JOIN planteles_supervision p ON p.codigo_plantel = d.codigo_plantel
      WHERE d.usuario_id IS NULL
      ORDER BY d.nombre`,
  },
];

async function ejecutarAlerta(alerta) {
  const { rows } = await pool.query(
    `SELECT x.codigo, x.nombre, x.detalle, COUNT(*) OVER() AS total_real
     FROM (${alerta.sql}) x
     LIMIT ${LIMITE_ALERTAS}`
  );
  return {
    clave: alerta.clave,
    titulo: alerta.titulo,
    severidad: alerta.severidad,
    descripcion: alerta.descripcion,
    total: rows.length ? Number(rows[0].total_real) : 0,
    items: rows.map((r) => ({ codigo: r.codigo, nombre: r.nombre, detalle: r.detalle })),
  };
}

router.get("/alertas", requireAuth, requireRol(...ROLES_SUPERVISION), async (req, res) => {
  try {
    const alertas = await Promise.all(ALERTAS_SUPERVISION.map(ejecutarAlerta));
    res.json({ alertas, limite: LIMITE_ALERTAS, generado_en: new Date().toISOString() });
  } catch (err) {
    console.error("Error calculando alertas de supervisión:", err);
    res.status(500).json({ error: "No se pudieron calcular las alertas de Supervisión." });
  }
});

// Cédulas de supervisores y directores que NO aparecen en la nómina del
// Ministerio (tabla personal_ministerio del RAC). Va aparte porque cruza
// contra ~790 mil filas: la pantalla lo pide solo cuando se pulsa el botón.
router.get("/alertas/cedulas-nomina", requireAuth, requireRol(...ROLES_SUPERVISION), async (req, res) => {
  try {
    const alerta = await ejecutarAlerta({
      clave: "cedulas_no_en_nomina",
      titulo: "Cédulas que no están en la nómina del Ministerio",
      severidad: "media",
      descripcion: "Supervisores y directores cuya cédula no se encuentra en personal_ministerio (puede ser un error de digitación o que la persona no esté en nómina).",
      sql: `
        WITH ${PERSONAS_CTE},
        unicas AS (
          SELECT ced, MIN(persona) AS persona, STRING_AGG(DISTINCT origen, ' / ') AS origen
          FROM personas WHERE ced <> '' GROUP BY ced
        )
        SELECT u.ced AS codigo, u.persona AS nombre, u.origen AS detalle
        FROM unicas u
        WHERE NOT EXISTS (
          SELECT 1 FROM personal_ministerio pm
          WHERE REGEXP_REPLACE(COALESCE(pm.cedula::text, ''), '\\D', '', 'g') = u.ced)
        ORDER BY u.persona`,
    });
    res.json({ alerta });
  } catch (err) {
    console.error("Error verificando cédulas contra la nómina:", err);
    res.status(500).json({ error: "No se pudo verificar las cédulas contra la nómina." });
  }
});

// =========================================================
// DIRECTORES
// =========================================================

router.get("/directores", requireAuth, requireRol(...ROLES_SUPERVISION), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT d.*, u.email AS usuario_email
       FROM directores_supervision d
       LEFT JOIN usuarios u ON u.id = d.usuario_id
       ORDER BY d.nombre`
    );
    res.json({ directores: rows });
  } catch (err) {
    console.error("Error listando directores:", err);
    res.status(500).json({ error: "No se pudo consultar los directores." });
  }
});

router.post("/directores", requireAuth, requireRol(...ROLES_SUPERVISION), async (req, res) => {
  const {
    codigo_plantel, cedula, nombre, telefono, correo, dependencia, cargo_nominal,
    plantel_cobro, titulo_pregrado, numero_cuenta, direccion_habitacion,
    titulo_fecha_grado, fecha_ingreso, formacion_unem,
  } = req.body || {};
  if (!codigo_plantel || !cedula || !nombre) {
    return res.status(400).json({ error: "Faltan codigo_plantel, cédula o nombre." });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO directores_supervision
        (codigo_plantel, cedula, nombre, telefono, correo, dependencia, cargo_nominal,
         plantel_cobro, titulo_pregrado, numero_cuenta, direccion_habitacion,
         titulo_fecha_grado, fecha_ingreso, formacion_unem)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [codigo_plantel, cedula, nombre, telefono || null, correo || null, dependencia || null,
       cargo_nominal || null, plantel_cobro || null, titulo_pregrado || null, numero_cuenta || null,
       direccion_habitacion || null, titulo_fecha_grado || null, fecha_ingreso || null, formacion_unem || null]
    );
    res.status(201).json({ director: rows[0] });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "Ese plantel ya tiene un director cargado." });
    console.error("Error creando director:", err);
    res.status(500).json({ error: "No se pudo crear el director (¿existe ese código de plantel en Supervisión?)." });
  }
});

router.put("/directores/:codigoPlantel", requireAuth, requireRol(...ROLES_SUPERVISION), async (req, res) => {
  const codigoPlantel = req.params.codigoPlantel.trim();
  const {
    cedula, nombre, telefono, correo, dependencia, cargo_nominal,
    plantel_cobro, titulo_pregrado, numero_cuenta, direccion_habitacion,
    titulo_fecha_grado, fecha_ingreso, formacion_unem,
  } = req.body || {};
  try {
    const { rows } = await pool.query(
      `UPDATE directores_supervision SET
        cedula=$1, nombre=$2, telefono=$3, correo=$4, dependencia=$5, cargo_nominal=$6,
        plantel_cobro=$7, titulo_pregrado=$8, numero_cuenta=$9, direccion_habitacion=$10,
        titulo_fecha_grado=$11, fecha_ingreso=$12, formacion_unem=$13, actualizado_en=now()
       WHERE codigo_plantel=$14
       RETURNING *`,
      [cedula, nombre, telefono || null, correo || null, dependencia || null, cargo_nominal || null,
       plantel_cobro || null, titulo_pregrado || null, numero_cuenta || null, direccion_habitacion || null,
       titulo_fecha_grado || null, fecha_ingreso || null, formacion_unem || null, codigoPlantel]
    );
    if (!rows[0]) return res.status(404).json({ error: "No existe ese director." });
    res.json({ director: rows[0] });
  } catch (err) {
    console.error("Error editando director:", err);
    res.status(500).json({ error: "No se pudo editar el director." });
  }
});

// Crea (o resetea) la cuenta de acceso web del director -- el director
// entra por /supervision/login.html usando el MISMO /api/auth/login de
// siempre, con rol 'director' y codigo_plantel amarrado en el token.
router.post("/directores/:codigoPlantel/usuario", requireAuth, requireRol(...ROLES_SUPERVISION), async (req, res) => {
  const codigoPlantel = req.params.codigoPlantel.trim();
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Faltan email o password." });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "La contraseña debe tener al menos 8 caracteres." });
  }

  const cliente = await pool.connect();
  try {
    await cliente.query("BEGIN");

    const director = await cliente.query(
      "SELECT * FROM directores_supervision WHERE codigo_plantel = $1 FOR UPDATE",
      [codigoPlantel]
    );
    if (!director.rows[0]) {
      await cliente.query("ROLLBACK");
      return res.status(404).json({ error: "No existe un director cargado para ese plantel." });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    let usuarioId = director.rows[0].usuario_id;

    if (usuarioId) {
      // Ya tenía cuenta -- resetea email/password sobre la misma fila.
      await cliente.query(
        "UPDATE usuarios SET email=$1, password_hash=$2, activo=true WHERE id=$3",
        [email, passwordHash, usuarioId]
      );
    } else {
      const nuevoUsuario = await cliente.query(
        `INSERT INTO usuarios (nombre, email, password_hash, rol, codigo_plantel, activo)
         VALUES ($1, $2, $3, 'director', $4, true)
         RETURNING id`,
        [director.rows[0].nombre, email, passwordHash, codigoPlantel]
      );
      usuarioId = nuevoUsuario.rows[0].id;
      await cliente.query(
        "UPDATE directores_supervision SET usuario_id=$1 WHERE codigo_plantel=$2",
        [usuarioId, codigoPlantel]
      );
    }

    await cliente.query("COMMIT");
    res.json({ ok: true, usuario_id: usuarioId });
  } catch (err) {
    await cliente.query("ROLLBACK");
    if (err.code === "23505") return res.status(409).json({ error: "Ese correo ya está en uso por otro usuario." });
    console.error("Error creando/reseteando cuenta de director:", err);
    res.status(500).json({ error: "No se pudo crear la cuenta del director." });
  } finally {
    cliente.release();
  }
});

// =========================================================
// MATRÍCULA (histórico por período escolar)
// =========================================================

// Historial completo de un plantel -- accesible para el director de ESE
// plantel (requireMismoPlantel) y para supervision/admin sobre cualquiera.
router.get(
  "/matricula/:codigoPlantel",
  requireAuth,
  requireRol(...ROLES_SUPERVISION_Y_DIRECTOR),
  requireMismoPlantel((req) => req.params.codigoPlantel),
  async (req, res) => {
    try {
      const { rows } = await pool.query(
        "SELECT * FROM matricula_planteles WHERE codigo_plantel = $1 ORDER BY periodo_escolar DESC",
        [req.params.codigoPlantel.trim()]
      );
      res.json({ matricula: rows });
    } catch (err) {
      console.error("Error consultando matrícula:", err);
      res.status(500).json({ error: "No se pudo consultar la matrícula." });
    }
  }
);

// Carga la matrícula de un período -- si ya existe una fila para ese
// plantel+período la actualiza (UPSERT), si no la crea. NO pisa períodos
// anteriores -- ese es el histórico.
router.post(
  "/matricula/:codigoPlantel",
  requireAuth,
  requireRol(...ROLES_SUPERVISION_Y_DIRECTOR),
  requireMismoPlantel((req) => req.params.codigoPlantel),
  async (req, res) => {
    const codigoPlantel = req.params.codigoPlantel.trim();
    const { periodo_escolar, hembras, varones } = req.body || {};
    const h = Number(hembras);
    const v = Number(varones);
    if (!periodo_escolar || !Number.isFinite(h) || !Number.isFinite(v) || h < 0 || v < 0) {
      return res.status(400).json({ error: "Faltan periodo_escolar, hembras o varones válidos (>= 0)." });
    }
    try {
      const { rows } = await pool.query(
        `INSERT INTO matricula_planteles (codigo_plantel, periodo_escolar, hembras, varones, actualizado_por)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (codigo_plantel, periodo_escolar)
         DO UPDATE SET hembras = EXCLUDED.hembras, varones = EXCLUDED.varones,
                       actualizado_por = EXCLUDED.actualizado_por, actualizado_en = now()
         RETURNING *`,
        [codigoPlantel, periodo_escolar, h, v, req.usuario.id]
      );
      res.json({ matricula: rows[0] });
    } catch (err) {
      console.error("Error guardando matrícula:", err);
      res.status(500).json({ error: "No se pudo guardar la matrícula." });
    }
  }
);

module.exports = router;
