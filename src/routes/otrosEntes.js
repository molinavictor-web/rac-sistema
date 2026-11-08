// otrosEntes.js — Atenciones de OTROS ENTES (Gobernación, alcaldías, ministerios, SENIAT, FANB…). Script 30.
// Montado en /api/inspecciones/otros-entes (antes que /api/inspecciones).
//
// Cada atención = plantel + ente + año (+ mes opcional) + qué se hizo. Un plantel atendido por varios entes (o por FEDE y
// otro ente) conserva TODAS sus atenciones en el historial, pero cuenta UNA sola vez en el total de «Planteles atendidos».
//
//   GET    /catalogo                  entes (activos; con ?todos=1 también los inactivos)
//   POST   /catalogo   PUT /catalogo/:id     alta / edición / activar-desactivar de un ente (admin e insp_coordinador)
//   GET    /buscar?q=                 busca planteles en GESCOLAR
//   GET    /lista[?anio=&ente=&categoria=&q=]   atenciones con datos del plantel + resumen
//   GET    /historial/:codigoDea      línea de tiempo del plantel: FEDE + otros entes + proyecto comunal (ficha)
//   POST   /plantel/:codigoDea        registra una atención
//   PUT    /:id   DELETE /:id         corrige / quita una atención
// Quién registra: admin, insp_coordinador y operador_plantel. Leen además insp_consulta e insp_ingeniero.

const express = require("express");
const { pool } = require("../db/pool");
const { requireAuth, requireRol } = require("../middleware/auth");
const gescolar = require("../services/gescolar");
const { entero, texto, falloInterno, CODIGO_DEA, programaDe, aniosDe } = require("./inspecciones").utilidades;

const router = express.Router();
const ROLES_ESCRIBE = ["admin", "insp_coordinador", "operador_plantel"];
const ROLES_CATALOGO = ["admin", "insp_coordinador"];
const ROLES_LEE = [...ROLES_ESCRIBE, "insp_consulta", "insp_ingeniero"];
const CATEGORIAS = { GOBERNACION: "Gobernación", ALCALDIA: "Alcaldía", MINISTERIO: "Ministerio", INSTITUTO: "Instituto / otro organismo", FANB: "FANB", OTRO: "Otro" };
const SIN_TABLAS = "42P01";
const falta = (res) => res.status(503).json({ error: "Falta ejecutar el script 30 en Supabase." });
const clave = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/\s+/g, " ");
const col = (obj, nombre) => { const k = Object.keys(obj || {}).find((x) => x.toLowerCase() === nombre); return k === undefined ? "" : String(obj[k] || "").trim(); };
const malo = (m) => { const e = new Error(m); e.http400 = m; return e; };

router.get("/catalogo", requireAuth, requireRol(...ROLES_LEE), async (req, res) => {
  try {
    const todos = req.query.todos === "1" && ROLES_CATALOGO.includes(req.usuario.rol);
    const { rows } = await pool.query(
      `SELECT e.id, e.categoria, e.nombre, e.municipio, e.activo, (SELECT COUNT(*)::int FROM atenciones_otros_entes a WHERE a.ente_id = e.id) AS atenciones
         FROM entes_atencion e ${todos ? "" : "WHERE e.activo"} ORDER BY e.categoria, e.nombre`);
    res.json({ entes: rows.map((r) => ({ ...r, categoria_texto: CATEGORIAS[r.categoria] })), categorias: Object.entries(CATEGORIAS).map(([codigo, nombre]) => ({ codigo, nombre })), puede_editar: ROLES_CATALOGO.includes(req.usuario.rol) });
  } catch (err) {
    if (err.code === SIN_TABLAS) return falta(res);
    falloInterno(res, err, "No se pudo cargar el catálogo de entes.");
  }
});

function validarEnte(b) {
  const categoria = texto(b && b.categoria);
  if (!CATEGORIAS[categoria]) throw malo("Elige la categoría del ente.");
  const nombre = texto(b && b.nombre).replace(/\s+/g, " ");
  if (!nombre) throw malo("Escribe el nombre del ente.");
  if (nombre.length > 120) throw malo("El nombre del ente es demasiado largo (máximo 120 caracteres).");
  let municipio = texto(b && b.municipio).replace(/\s+/g, " ") || null;
  if (categoria !== "ALCALDIA") municipio = null;
  else if (!municipio) throw malo("Indica el municipio de la alcaldía.");
  return { categoria, nombre, municipio };
}
async function nombreRepetido(nombre, exceptoId) {
  const { rows } = await pool.query("SELECT id, nombre FROM entes_atencion");
  return rows.find((r) => r.id !== exceptoId && clave(r.nombre) === clave(nombre));
}

router.post("/catalogo", requireAuth, requireRol(...ROLES_CATALOGO), async (req, res) => {
  try {
    const d = validarEnte(req.body);
    if (await nombreRepetido(d.nombre, 0)) return res.status(409).json({ error: "Ya existe un ente con ese nombre." });
    const r = await pool.query("INSERT INTO entes_atencion (categoria, nombre, municipio, creado_por) VALUES ($1::text, $2::text, $3::text, $4::int) RETURNING id", [d.categoria, d.nombre, d.municipio, req.usuario.id]);
    res.status(201).json({ ok: true, id: r.rows[0].id });
  } catch (err) {
    if (err.http400) return res.status(400).json({ error: err.http400 });
    if (err.code === SIN_TABLAS) return falta(res);
    falloInterno(res, err, "No se pudo crear el ente.");
  }
});

router.put("/catalogo/:id", requireAuth, requireRol(...ROLES_CATALOGO), async (req, res) => {
  const id = entero(req.params.id);
  if (!id) return res.status(400).json({ error: "Ente no válido." });
  try {
    const d = validarEnte(req.body);
    if (await nombreRepetido(d.nombre, id)) return res.status(409).json({ error: "Ya existe un ente con ese nombre." });
    const activo = req.body.activo === undefined ? null : Boolean(req.body.activo);
    const r = await pool.query("UPDATE entes_atencion SET categoria = $2::text, nombre = $3::text, municipio = $4::text, activo = COALESCE($5::boolean, activo) WHERE id = $1 RETURNING id", [id, d.categoria, d.nombre, d.municipio, activo]);
    if (!r.rows.length) return res.status(404).json({ error: "No existe ese ente." });
    res.json({ ok: true });
  } catch (err) {
    if (err.http400) return res.status(400).json({ error: err.http400 });
    if (err.code === SIN_TABLAS) return falta(res);
    falloInterno(res, err, "No se pudo guardar el ente.");
  }
});

router.get("/buscar", requireAuth, requireRol(...ROLES_ESCRIBE), async (req, res) => {
  const q = texto(req.query.q);
  if (q.length < 2) return res.status(400).json({ error: "Escribe al menos 2 caracteres para buscar." });
  try {
    const r = await gescolar.buscarPlanteles(q);
    res.json({ limitado: r.limitado, planteles: r.planteles.map((p) => ({ cod_plantel: String(p.cod_plantel || "").trim(), nombre_plantel: p.nombre_plantel || "", municipio: col(p, "municipio"), parroquia: col(p, "parroquia") })) });
  } catch (err) {
    console.error("Error consultando GESCOLAR:", err);
    res.status(502).json({ error: "No se pudo consultar la hoja de GESCOLAR." });
  }
});

async function mapaGescolar() {
  const m = new Map();
  (await gescolar.cargarGescolar()).forEach((p) => m.set(String(p[gescolar.CAMPO_CODIGO] || "").trim().toUpperCase(), p));
  return m;
}

const SELECT_ATENCIONES = `SELECT a.id, a.codigo_dea, a.anio, a.mes, a.descripcion, a.ente_id, e.nombre AS ente, e.categoria, e.municipio AS ente_municipio
  FROM atenciones_otros_entes a JOIN entes_atencion e ON e.id = a.ente_id`;

router.get("/lista", requireAuth, requireRol(...ROLES_LEE), async (req, res) => {
  const anio = req.query.anio ? entero(req.query.anio) : null;
  const enteId = req.query.ente ? entero(req.query.ente) : null;
  const categoria = CATEGORIAS[req.query.categoria] ? req.query.categoria : null;
  const q = clave(req.query.q);
  try {
    const { rows } = await pool.query(`${SELECT_ATENCIONES} ORDER BY a.anio DESC, a.mes DESC NULLS LAST, a.id DESC`);
    let mapa = new Map();
    try { mapa = await mapaGescolar(); } catch (_) { mapa = new Map(); }
    const todas = rows.map((r) => {
      const g = mapa.get(r.codigo_dea) || {};
      return { id: r.id, codigo_dea: r.codigo_dea, nombre_plantel: String(g[gescolar.CAMPO_NOMBRE] || r.codigo_dea), municipio: col(g, "municipio"), anio: r.anio, mes: r.mes,
        descripcion: r.descripcion || "", ente_id: r.ente_id, ente: r.ente, categoria: r.categoria, categoria_texto: CATEGORIAS[r.categoria] };
    });
    const f = todas.filter((r) => (!anio || r.anio === anio) && (!enteId || r.ente_id === enteId) && (!categoria || r.categoria === categoria)
      && (!q || [r.nombre_plantel, r.codigo_dea, r.ente, r.descripcion, r.municipio].some((x) => clave(x).includes(q))));
    const porEnte = new Map();
    f.forEach((r) => { if (!porEnte.has(r.ente_id)) porEnte.set(r.ente_id, { ente: r.ente, categoria: r.categoria, atenciones: 0, planteles: new Set() }); const o = porEnte.get(r.ente_id); o.atenciones += 1; o.planteles.add(r.codigo_dea); });
    res.json({
      atenciones: f,
      anios: [...new Set(todas.map((r) => r.anio))].sort((a, b) => b - a),
      resumen: { atenciones: f.length, planteles: new Set(f.map((r) => r.codigo_dea)).size,
        por_ente: [...porEnte.values()].map((o) => ({ ente: o.ente, categoria: o.categoria, atenciones: o.atenciones, planteles: o.planteles.size })).sort((a, b) => b.atenciones - a.atenciones || a.ente.localeCompare(b.ente, "es")) },
      puede_editar: ROLES_ESCRIBE.includes(req.usuario.rol),
    });
  } catch (err) {
    if (err.code === SIN_TABLAS) return falta(res);
    falloInterno(res, err, "No se pudo cargar el listado de atenciones.");
  }
});

// ---- Línea de tiempo del plantel (FEDE + otros entes + proyecto comunal) ----
router.get("/historial/:codigoDea", requireAuth, requireRol(...ROLES_LEE), async (req, res) => {
  const codigo = texto(req.params.codigoDea).toUpperCase();
  if (!CODIGO_DEA.test(codigo)) return res.status(400).json({ error: "Código DEA inválido." });
  try {
    const items = [];
    // FEDE: tipo de atención de GESCOLAR (con su año) y planes (del sistema y de la hoja)
    let p = null;
    try { p = await gescolar.obtenerPlantel(codigo); } catch (_) { p = null; }
    const nombresPlanSistema = new Set();
    const planesSistema = [];
    try {
      (await pool.query("SELECT nombre FROM planes_atencion")).rows.forEach((x) => nombresPlanSistema.add(gescolar.normalizar(x.nombre)));
      (await pool.query(`SELECT p.nombre FROM plan_inspecciones pi JOIN planes_atencion p ON p.id = pi.plan_id WHERE pi.desenlazado_en IS NULL AND lower(pi.codigo_dea) = lower($1)`, [codigo])).rows.forEach((x) => planesSistema.push(x.nombre));
    } catch (_) { /* sin planes */ }
    const fede = new Map(); // clave programa+año → item
    const sumarFede = (nombre, tipoPlan, anioHoja, original) => {
      const pr = programaDe(nombre, tipoPlan, anioHoja);
      const anios = pr.anios || aniosDe(original || nombre);
      anios.forEach((a) => {
        const anio = /^\d{4}$/.test(a) ? Number(a) : null;
        const k = `${pr.clave}|${anio}`;
        if (!fede.has(k)) fede.set(k, { tipo: "FEDE", ente: "FEDE", titulo: pr.nombre || nombre, anio, mes: null });
      });
    };
    if (p) {
      const tipo = String(p[gescolar.CAMPO_TIPO_ATENCION] || "").trim();
      const hdrAnio = Object.keys(p).find((h) => gescolar.normalizar(h) === "ANO");
      if (gescolar.tieneMarcaPlan(tipo)) sumarFede(tipo, null, hdrAnio ? p[hdrAnio] : "", tipo);
      Object.keys(p).filter((h) => gescolar.esColumnaPlan(h) && gescolar.tieneMarcaPlan(p[h])).forEach((h) => {
        const nombre = gescolar.planDeColumna(h);
        if (nombresPlanSistema.has(gescolar.normalizar(nombre))) return;
        sumarFede(nombre, null, "", nombre);
      });
    }
    planesSistema.forEach((nombre) => sumarFede(nombre, null, "", nombre));
    items.push(...fede.values());
    // Otros entes
    const o = await pool.query(`${SELECT_ATENCIONES} WHERE a.codigo_dea = $1 ORDER BY a.anio, a.mes NULLS LAST, a.id`, [codigo]);
    o.rows.forEach((r) => items.push({ tipo: "OTRO", id: r.id, ente: r.ente, categoria: r.categoria, titulo: r.descripcion || "", anio: r.anio, mes: r.mes }));
    // Proyecto comunal
    try {
      const c = await pool.query(
        `SELECT p.nombre_proyecto, p.circuito_nombre, p.anio, EXTRACT(MONTH FROM p.fecha_consulta)::int AS mes, x.estado
           FROM comunal_proyectos p JOIN comunal_proyecto_planteles x ON x.proyecto_id = p.id WHERE x.codigo_dea = $1`, [codigo]);
      c.rows.forEach((r) => items.push({ tipo: "COMUNAL", ente: `Proyecto comunal · ${r.circuito_nombre}`, titulo: r.nombre_proyecto, anio: r.anio, mes: r.mes, estado: r.estado }));
    } catch (err) { if (err.code !== SIN_TABLAS) throw err; }
    items.sort((a, b) => (b.anio || 0) - (a.anio || 0) || (b.mes || 0) - (a.mes || 0));
    res.json({ codigo_dea: codigo, historial: items, puede_editar: ROLES_ESCRIBE.includes(req.usuario.rol) });
  } catch (err) {
    if (err.code === SIN_TABLAS) return falta(res);
    falloInterno(res, err, "No se pudo armar el historial del plantel.");
  }
});

// ---- Registrar / corregir / quitar ----
async function validarAtencion(b) {
  const enteId = entero(b && b.ente_id);
  if (!enteId) throw malo("Elige el ente que atendió.");
  const ente = (await pool.query("SELECT id, activo FROM entes_atencion WHERE id = $1", [enteId])).rows[0];
  if (!ente) throw malo("Ese ente no existe.");
  const anioMax = new Date().getFullYear() + 1;
  const anio = entero(b.anio);
  if (!anio || anio < 2000 || anio > anioMax) throw malo(`El año debe estar entre 2000 y ${anioMax}.`);
  let mes = null;
  if (b.mes !== undefined && b.mes !== null && String(b.mes).trim() !== "") {
    mes = entero(b.mes);
    if (!mes || mes < 1 || mes > 12) throw malo("El mes debe estar entre 1 y 12 (o déjalo vacío).");
  }
  const desc = texto(b.descripcion);
  if (desc.length > 500) throw malo("La descripción es demasiado larga (máximo 500 caracteres).");
  return { ente_id: enteId, activo: ente.activo, anio, mes, descripcion: desc || null };
}

router.post("/plantel/:codigoDea", requireAuth, requireRol(...ROLES_ESCRIBE), async (req, res) => {
  const codigo = texto(req.params.codigoDea).toUpperCase();
  if (!CODIGO_DEA.test(codigo)) return res.status(400).json({ error: "Código DEA inválido." });
  try {
    const d = await validarAtencion(req.body);
    if (!d.activo) return res.status(400).json({ error: "Ese ente está desactivado." });
    let p;
    try { p = await gescolar.obtenerPlantel(codigo); } catch (_) { return res.status(502).json({ error: "No se pudo consultar la hoja de GESCOLAR." }); }
    if (!p) return res.status(404).json({ error: "Ese código DEA no está en GESCOLAR." });
    const r = await pool.query(
      `INSERT INTO atenciones_otros_entes (codigo_dea, ente_id, anio, mes, descripcion, creado_por, actualizado_por) VALUES ($1::text, $2::int, $3::int, $4::int, $5::text, $6::int, $6::int) RETURNING id`,
      [codigo, d.ente_id, d.anio, d.mes, d.descripcion, req.usuario.id]);
    res.status(201).json({ ok: true, id: r.rows[0].id });
  } catch (err) {
    if (err.http400) return res.status(400).json({ error: err.http400 });
    if (err.code === SIN_TABLAS) return falta(res);
    falloInterno(res, err, "No se pudo registrar la atención.");
  }
});

router.put("/:id", requireAuth, requireRol(...ROLES_ESCRIBE), async (req, res) => {
  const id = entero(req.params.id);
  if (!id) return res.status(400).json({ error: "Registro no válido." });
  try {
    const d = await validarAtencion(req.body);
    const r = await pool.query(
      `UPDATE atenciones_otros_entes SET ente_id = $2::int, anio = $3::int, mes = $4::int, descripcion = $5::text, actualizado_por = $6::int, actualizado_en = NOW() WHERE id = $1 RETURNING id`,
      [id, d.ente_id, d.anio, d.mes, d.descripcion, req.usuario.id]);
    if (!r.rows.length) return res.status(404).json({ error: "No existe esa atención." });
    res.json({ ok: true });
  } catch (err) {
    if (err.http400) return res.status(400).json({ error: err.http400 });
    if (err.code === SIN_TABLAS) return falta(res);
    falloInterno(res, err, "No se pudo guardar la atención.");
  }
});

router.delete("/:id", requireAuth, requireRol(...ROLES_ESCRIBE), async (req, res) => {
  const id = entero(req.params.id);
  if (!id) return res.status(400).json({ error: "Registro no válido." });
  try {
    const r = await pool.query("DELETE FROM atenciones_otros_entes WHERE id = $1 RETURNING id", [id]);
    if (!r.rows.length) return res.status(404).json({ error: "No existe esa atención." });
    res.json({ ok: true });
  } catch (err) {
    if (err.code === SIN_TABLAS) return falta(res);
    falloInterno(res, err, "No se pudo quitar la atención.");
  }
});

module.exports = router;
