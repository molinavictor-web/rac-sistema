// proyectosComunales.js — Proyectos comunales aprobados para atender planteles. Script 28.
// Montado en /api/inspecciones/proyectos-comunales (antes que /api/inspecciones).
//
//   GET    /opciones                 circuitos y consejos comunales existentes (de GESCOLAR)
//   GET    /buscar?q=                busca planteles en GESCOLAR para registrarles un proyecto
//   GET    /lista[?anio=&q=]         todos los proyectos (con datos del plantel) + resumen por año
//   GET    /plantel/:codigoDea       proyectos de un plantel + su circuito/consejo de GESCOLAR (ficha del plantel)
//   POST   /plantel/:codigoDea       registra una aprobación {anio, nombre_proyecto, circuito_nombre, consejo_nombre, observaciones}
//   PUT    /:id    DELETE /:id       corregir / quitar una aprobación
//
// Cada fila es UNA aprobación (elección). «Proyecto comunal: SÍ» = el plantel tiene al menos una; el número de
// aprobación (1, 2, 3…) se calcula por orden de año. Circuito y consejo se eligen de los que ya existen en GESCOLAR.
// Quién escribe: admin, insp_coordinador y operador_plantel. Leen además insp_consulta e insp_ingeniero.

const express = require("express");
const { pool } = require("../db/pool");
const { requireAuth, requireRol } = require("../middleware/auth");
const gescolar = require("../services/gescolar");
const { opcionesDatos } = require("./plantelesConsulta");
const { entero, texto, falloInterno, CODIGO_DEA } = require("./inspecciones").utilidades;

const router = express.Router();
const ROLES_ESCRIBE = ["admin", "insp_coordinador", "operador_plantel"];
const ROLES_LEE = [...ROLES_ESCRIBE, "insp_consulta", "insp_ingeniero"];
const SIN_TABLAS = "42P01";
const falta = (res) => res.status(503).json({ error: "Falta ejecutar el script 28 en Supabase." });
const clave = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/\s+/g, " ");
const col = (obj, nombre) => { const k = Object.keys(obj || {}).find((x) => x.toLowerCase() === nombre); return k === undefined ? "" : String(obj[k] || "").trim(); };

const NUMERADOS = `SELECT p.*, ROW_NUMBER() OVER (PARTITION BY p.codigo_dea ORDER BY p.anio, p.id)::int AS numero FROM proyectos_comunales p`;

async function planteloGescolar(codigo) {
  try { return await gescolar.obtenerPlantel(codigo); } catch (err) { const e = new Error("gescolar"); e.gescolar = true; throw e; }
}

// Revisa lo enviado; devuelve la fila lista para guardar o lanza {http400}.
async function validar(body) {
  const malo = (m) => { const e = new Error(m); e.http400 = m; return e; };
  const b = body || {};
  const anio = entero(b.anio);
  const anioMax = new Date().getFullYear() + 1;
  if (!anio || anio < 2000 || anio > anioMax) throw malo(`El año de la elección debe estar entre 2000 y ${anioMax}.`);
  const nombre = texto(b.nombre_proyecto).replace(/\s+/g, " ");
  if (!nombre) throw malo("Escribe el nombre del proyecto.");
  if (nombre.length > 200) throw malo("El nombre del proyecto es demasiado largo (máximo 200 caracteres).");
  const obs = texto(b.observaciones);
  if (obs.length > 1000) throw malo("Las observaciones son demasiado largas (máximo 1000 caracteres).");
  const op = await opcionesDatos();
  const par = (lista, nom, rotulo) => {
    const n = texto(nom);
    if (!n) return { codigo: null, nombre: null };
    const x = lista.find((y) => clave(y.nombre) === clave(n));
    if (!x) throw malo(`El ${rotulo} «${n}» no existe: elígelo de la lista.`);
    return x;
  };
  const cir = par(op.circuitos, b.circuito_nombre, "circuito comunal");
  const con = par(op.consejos, b.consejo_nombre, "consejo comunal");
  return { anio, nombre_proyecto: nombre, circuito_codigo: cir.codigo, circuito_nombre: cir.nombre, consejo_codigo: con.codigo, consejo_nombre: con.nombre, observaciones: obs || null };
}

router.get("/opciones", requireAuth, requireRol(...ROLES_LEE), async (req, res) => {
  try {
    const op = await opcionesDatos();
    res.json({ circuitos: op.circuitos, consejos: op.consejos });
  } catch (err) { falloInterno(res, err, "No se pudieron cargar las listas."); }
});

router.get("/buscar", requireAuth, requireRol(...ROLES_ESCRIBE), async (req, res) => {
  const q = texto(req.query.q);
  if (q.length < 2) return res.status(400).json({ error: "Escribe al menos 2 caracteres para buscar." });
  try {
    const r = await gescolar.buscarPlanteles(q);
    res.json({ limitado: r.limitado, planteles: r.planteles.map((p) => ({ cod_plantel: String(p.cod_plantel || "").trim(), nombre_plantel: p.nombre_plantel || "", municipio: p.municipio || "", parroquia: p.parroquia || "" })) });
  } catch (err) {
    console.error("Error consultando GESCOLAR:", err);
    res.status(502).json({ error: "No se pudo consultar la hoja de GESCOLAR." });
  }
});

router.get("/lista", requireAuth, requireRol(...ROLES_LEE), async (req, res) => {
  const anio = req.query.anio ? entero(req.query.anio) : null;
  const q = clave(req.query.q);
  try {
    const { rows } = await pool.query(`SELECT * FROM (${NUMERADOS}) t ORDER BY t.anio DESC, t.codigo_dea, t.id`);
    let mapa = new Map();
    try { (await gescolar.cargarGescolar()).forEach((p) => mapa.set(String(p[gescolar.CAMPO_CODIGO] || "").trim(), p)); } catch (_) { mapa = new Map(); }
    const todos = rows.map((r) => {
      const p = mapa.get(r.codigo_dea) || {};
      return { id: r.id, codigo_dea: r.codigo_dea, nombre_plantel: String(p[gescolar.CAMPO_NOMBRE] || r.codigo_dea), municipio: col(p, "municipio"), parroquia: col(p, "parroquia"),
        anio: r.anio, numero: r.numero, nombre_proyecto: r.nombre_proyecto, circuito_nombre: r.circuito_nombre || "", consejo_nombre: r.consejo_nombre || "", observaciones: r.observaciones || "" };
    });
    const filtrados = todos.filter((r) => (!anio || r.anio === anio) && (!q || [r.nombre_plantel, r.codigo_dea, r.nombre_proyecto, r.circuito_nombre, r.consejo_nombre, r.municipio].some((x) => clave(x).includes(q))));
    const porAnio = new Map();
    filtrados.forEach((r) => { if (!porAnio.has(r.anio)) porAnio.set(r.anio, { anio: r.anio, proyectos: 0, planteles: new Set() }); const a = porAnio.get(r.anio); a.proyectos += 1; a.planteles.add(r.codigo_dea); });
    res.json({
      proyectos: filtrados,
      anios: [...new Set(todos.map((r) => r.anio))].sort((a, b) => b - a),
      resumen: { proyectos: filtrados.length, planteles: new Set(filtrados.map((r) => r.codigo_dea)).size, por_anio: [...porAnio.values()].sort((a, b) => b.anio - a.anio).map((a) => ({ anio: a.anio, proyectos: a.proyectos, planteles: a.planteles.size })) },
      puede_editar: ROLES_ESCRIBE.includes(req.usuario.rol),
    });
  } catch (err) {
    if (err.code === SIN_TABLAS) return falta(res);
    falloInterno(res, err, "No se pudo cargar el listado de proyectos comunales.");
  }
});

router.get("/plantel/:codigoDea", requireAuth, requireRol(...ROLES_LEE), async (req, res) => {
  const codigo = texto(req.params.codigoDea).toUpperCase();
  if (!CODIGO_DEA.test(codigo)) return res.status(400).json({ error: "Código DEA inválido." });
  try {
    let p = null;
    try { p = await planteloGescolar(codigo); } catch (_) { p = null; }
    const { rows } = await pool.query(`SELECT * FROM (${NUMERADOS}) t WHERE t.codigo_dea = $1 ORDER BY t.anio, t.id`, [codigo]);
    res.json({
      codigo_dea: codigo,
      plantel: p ? { nombre_plantel: String(p[gescolar.CAMPO_NOMBRE] || ""), circuito_codigo: col(p, "cod_circuito"), circuito_nombre: col(p, "nomb_circuito"), consejo_codigo: col(p, "cod_consejo_com"), consejo_nombre: col(p, "nom_consejo_com") } : null,
      tiene_proyecto: rows.length > 0,
      total: rows.length,
      proyectos: rows.map((r) => ({ id: r.id, numero: r.numero, anio: r.anio, nombre_proyecto: r.nombre_proyecto, circuito_nombre: r.circuito_nombre || "", consejo_nombre: r.consejo_nombre || "", observaciones: r.observaciones || "" })),
      puede_editar: ROLES_ESCRIBE.includes(req.usuario.rol),
    });
  } catch (err) {
    if (err.code === SIN_TABLAS) return falta(res);
    falloInterno(res, err, "No se pudieron cargar los proyectos comunales del plantel.");
  }
});

router.post("/plantel/:codigoDea", requireAuth, requireRol(...ROLES_ESCRIBE), async (req, res) => {
  const codigo = texto(req.params.codigoDea).toUpperCase();
  if (!CODIGO_DEA.test(codigo)) return res.status(400).json({ error: "Código DEA inválido." });
  try {
    const datos = await validar(req.body);
    let p;
    try { p = await planteloGescolar(codigo); } catch (_) { return res.status(502).json({ error: "No se pudo consultar la hoja de GESCOLAR." }); }
    if (!p) return res.status(404).json({ error: "Ese código DEA no está en GESCOLAR." });
    const r = await pool.query(
      `INSERT INTO proyectos_comunales (codigo_dea, anio, nombre_proyecto, circuito_codigo, circuito_nombre, consejo_codigo, consejo_nombre, observaciones, creado_por, actualizado_por)
       VALUES ($1::text, $2::int, $3::text, $4::text, $5::text, $6::text, $7::text, $8::text, $9::int, $9::int) RETURNING id`,
      [codigo, datos.anio, datos.nombre_proyecto, datos.circuito_codigo, datos.circuito_nombre, datos.consejo_codigo, datos.consejo_nombre, datos.observaciones, req.usuario.id]
    );
    res.status(201).json({ ok: true, id: r.rows[0].id });
  } catch (err) {
    if (err.http400) return res.status(400).json({ error: err.http400 });
    if (err.code === SIN_TABLAS) return falta(res);
    falloInterno(res, err, "No se pudo registrar el proyecto comunal.");
  }
});

router.put("/:id", requireAuth, requireRol(...ROLES_ESCRIBE), async (req, res) => {
  const id = entero(req.params.id);
  if (!id) return res.status(400).json({ error: "Registro no válido." });
  try {
    const datos = await validar(req.body);
    const r = await pool.query(
      `UPDATE proyectos_comunales SET anio = $2::int, nombre_proyecto = $3::text, circuito_codigo = $4::text, circuito_nombre = $5::text, consejo_codigo = $6::text,
              consejo_nombre = $7::text, observaciones = $8::text, actualizado_por = $9::int, actualizado_en = NOW() WHERE id = $1 RETURNING id`,
      [id, datos.anio, datos.nombre_proyecto, datos.circuito_codigo, datos.circuito_nombre, datos.consejo_codigo, datos.consejo_nombre, datos.observaciones, req.usuario.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: "No existe ese proyecto." });
    res.json({ ok: true });
  } catch (err) {
    if (err.http400) return res.status(400).json({ error: err.http400 });
    if (err.code === SIN_TABLAS) return falta(res);
    falloInterno(res, err, "No se pudo guardar el proyecto comunal.");
  }
});

router.delete("/:id", requireAuth, requireRol(...ROLES_ESCRIBE), async (req, res) => {
  const id = entero(req.params.id);
  if (!id) return res.status(400).json({ error: "Registro no válido." });
  try {
    const r = await pool.query("DELETE FROM proyectos_comunales WHERE id = $1 RETURNING id", [id]);
    if (!r.rows.length) return res.status(404).json({ error: "No existe ese proyecto." });
    res.json({ ok: true });
  } catch (err) {
    if (err.code === SIN_TABLAS) return falta(res);
    falloInterno(res, err, "No se pudo quitar el proyecto comunal.");
  }
});

module.exports = router;
