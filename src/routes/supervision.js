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

router.get("/supervisores-circuitales", requireAuth, requireRol(...ROLES_SUPERVISION), async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM supervisores_circuitales ORDER BY num_circuito");
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
