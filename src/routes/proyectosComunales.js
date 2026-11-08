// proyectosComunales.js — Proyectos comunales por COMUNA / CIRCUITO COMUNAL. Script 29.
// Montado en /api/inspecciones/proyectos-comunales (antes que /api/inspecciones).
//
// El proyecto pertenece a una comuna (código y nombre, obligatorios; se eligen de los circuitos comunales de GESCOLAR),
// lleva año, fecha de la consulta (elección) y nombre; el número (1.ª, 2.ª, 3.ª) se calcula por comuna según la fecha.
// Debajo va la lista de planteles que atiende, cada uno POR_ATENDER o ATENDIDO.
//
//   GET    /opciones                 circuitos comunales existentes (de GESCOLAR)
//   GET    /buscar?q=                busca planteles en GESCOLAR
//   GET    /circuito/:codigo         planteles que GESCOLAR vincula a ese circuito (sugerencias)
//   GET    /lista[?anio=&q=&estado=] proyectos con sus planteles + resumen
//   GET    /plantel/:codigoDea       proyectos donde aparece el plantel + su circuito/consejo (ficha del plantel)
//   POST   /                         crea {circuito, anio, fecha_consulta, nombre_proyecto, observaciones, planteles:[{codigo_dea, estado}]}
//   PUT    /:id                      corrige (si trae `planteles`, reemplaza la lista completa)
//   DELETE /:id
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
const ESTADOS = ["POR_ATENDER", "ATENDIDO"];
const MAX_PLANTELES = 300;
const SIN_TABLAS = "42P01";
const falta = (res) => res.status(503).json({ error: "Falta ejecutar el script 29 en Supabase." });
const clave = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/\s+/g, " ");
const col = (obj, nombre) => { const k = Object.keys(obj || {}).find((x) => x.toLowerCase() === nombre); return k === undefined ? "" : String(obj[k] || "").trim(); };
const malo = (m) => { const e = new Error(m); e.http400 = m; return e; };

// Proyectos con su número por comuna (1.ª = la consulta más antigua de esa comuna).
const NUMERADOS = `SELECT p.*, ROW_NUMBER() OVER (PARTITION BY p.circuito_codigo ORDER BY p.anio, p.fecha_consulta NULLS LAST, p.id)::int AS numero FROM comunal_proyectos p`;
const fechaTxt = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : "");

async function mapaGescolar() {
  const m = new Map();
  (await gescolar.cargarGescolar()).forEach((p) => m.set(String(p[gescolar.CAMPO_CODIGO] || "").trim().toUpperCase(), p));
  return m;
}

// Revisa lo enviado; devuelve {proyecto, planteles|null} o lanza {http400}.
async function validar(body, exigirPlanteles) {
  const b = body || {};
  const cir = texto(b.circuito_nombre) || texto(b.circuito_codigo);
  if (!cir) throw malo("Elige la comuna o circuito comunal: es un dato obligatorio.");
  const op = await opcionesDatos();
  const c = op.circuitos.find((y) => clave(y.nombre) === clave(cir) || (y.codigo && clave(y.codigo) === clave(cir)));
  if (!c) throw malo(`La comuna «${cir}» no existe: elígela de la lista.`);
  let fecha = null;
  if (texto(b.fecha_consulta)) {
    const f = texto(b.fecha_consulta);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f) || Number.isNaN(Date.parse(f)) || new Date(f).toISOString().slice(0, 10) !== f) throw malo("La fecha de la consulta no es válida.");
    fecha = f;
  }
  let anio = entero(b.anio);
  if (!anio && fecha) anio = Number(fecha.slice(0, 4));
  const anioMax = new Date().getFullYear() + 1;
  if (!anio || anio < 2000 || anio > anioMax) throw malo(`El año debe estar entre 2000 y ${anioMax}.`);
  if (fecha && Number(fecha.slice(0, 4)) !== anio) throw malo("El año no coincide con la fecha de la consulta.");
  const nombre = texto(b.nombre_proyecto).replace(/\s+/g, " ");
  if (!nombre) throw malo("Escribe el nombre del proyecto.");
  if (nombre.length > 200) throw malo("El nombre del proyecto es demasiado largo (máximo 200 caracteres).");
  const obs = texto(b.observaciones);
  if (obs.length > 1000) throw malo("Las observaciones son demasiado largas (máximo 1000 caracteres).");
  let planteles = null;
  if (b.planteles !== undefined || exigirPlanteles) {
    const lista = Array.isArray(b.planteles) ? b.planteles : [];
    if (lista.length > MAX_PLANTELES) throw malo(`Máximo ${MAX_PLANTELES} planteles por proyecto.`);
    let mapa;
    try { mapa = await mapaGescolar(); } catch (_) { const e = new Error("gescolar"); e.gescolar = true; throw e; }
    const vistos = new Set();
    planteles = lista.map((x) => {
      const cod = texto(x && x.codigo_dea).toUpperCase();
      if (!CODIGO_DEA.test(cod)) throw malo(`Código DEA inválido: «${cod}».`);
      if (!mapa.has(cod)) throw malo(`El código ${cod} no está en GESCOLAR.`);
      if (vistos.has(cod)) throw malo(`El plantel ${cod} está repetido en la lista.`);
      vistos.add(cod);
      const estado = texto(x.estado) || "POR_ATENDER";
      if (!ESTADOS.includes(estado)) throw malo("El estado del plantel debe ser POR_ATENDER o ATENDIDO.");
      return { codigo_dea: cod, estado };
    });
  }
  return { proyecto: { circuito_codigo: c.codigo || c.nombre, circuito_nombre: c.nombre, anio, fecha_consulta: fecha, nombre_proyecto: nombre, observaciones: obs || null }, planteles };
}

async function guardarPlanteles(cliente, id, planteles) {
  await cliente.query("DELETE FROM comunal_proyecto_planteles WHERE proyecto_id = $1", [id]);
  for (const p of planteles) await cliente.query("INSERT INTO comunal_proyecto_planteles (proyecto_id, codigo_dea, estado) VALUES ($1::int, $2::text, $3::text)", [id, p.codigo_dea, p.estado]);
}

router.get("/opciones", requireAuth, requireRol(...ROLES_LEE), async (req, res) => {
  try {
    const op = await opcionesDatos();
    res.json({ circuitos: op.circuitos });
  } catch (err) { falloInterno(res, err, "No se pudieron cargar las listas."); }
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

router.get("/circuito/:codigo", requireAuth, requireRol(...ROLES_ESCRIBE), async (req, res) => {
  const cod = clave(req.params.codigo);
  if (!cod) return res.status(400).json({ error: "Falta el circuito." });
  try {
    const todos = [...(await mapaGescolar()).values()];
    const planteles = todos.filter((p) => clave(col(p, "cod_circuito")) === cod || clave(col(p, "nomb_circuito")) === cod)
      .map((p) => ({ cod_plantel: String(p[gescolar.CAMPO_CODIGO] || "").trim(), nombre_plantel: String(p[gescolar.CAMPO_NOMBRE] || ""), municipio: col(p, "municipio"), parroquia: col(p, "parroquia") }));
    res.json({ planteles });
  } catch (err) {
    console.error("Error consultando GESCOLAR:", err);
    res.status(502).json({ error: "No se pudo consultar la hoja de GESCOLAR." });
  }
});

router.get("/lista", requireAuth, requireRol(...ROLES_LEE), async (req, res) => {
  const anio = req.query.anio ? entero(req.query.anio) : null;
  const q = clave(req.query.q);
  const estado = ESTADOS.includes(req.query.estado) ? req.query.estado : null;
  try {
    const { rows } = await pool.query(`SELECT * FROM (${NUMERADOS}) t ORDER BY t.anio DESC, t.fecha_consulta DESC NULLS LAST, t.id DESC`);
    const pl = await pool.query("SELECT proyecto_id, codigo_dea, estado FROM comunal_proyecto_planteles ORDER BY codigo_dea");
    let mapa = new Map();
    try { mapa = await mapaGescolar(); } catch (_) { mapa = new Map(); }
    const porProyecto = new Map();
    pl.rows.forEach((x) => {
      const g = mapa.get(x.codigo_dea) || {};
      if (!porProyecto.has(x.proyecto_id)) porProyecto.set(x.proyecto_id, []);
      porProyecto.get(x.proyecto_id).push({ codigo_dea: x.codigo_dea, nombre_plantel: String(g[gescolar.CAMPO_NOMBRE] || x.codigo_dea), municipio: col(g, "municipio"), estado: x.estado });
    });
    const todos = rows.map((r) => {
      const planteles = porProyecto.get(r.id) || [];
      return { id: r.id, circuito_codigo: r.circuito_codigo, circuito_nombre: r.circuito_nombre, anio: r.anio, fecha_consulta: fechaTxt(r.fecha_consulta), numero: r.numero,
        nombre_proyecto: r.nombre_proyecto, observaciones: r.observaciones || "", planteles, atendidos: planteles.filter((x) => x.estado === "ATENDIDO").length, sin_planteles: planteles.length === 0 };
    });
    const filtrados = todos.filter((r) => (!anio || r.anio === anio) && (!estado || r.planteles.some((x) => x.estado === estado))
      && (!q || [r.nombre_proyecto, r.circuito_nombre, r.circuito_codigo, ...r.planteles.flatMap((x) => [x.nombre_plantel, x.codigo_dea])].some((x) => clave(x).includes(q))));
    const unicos = new Set(), atendidos = new Set();
    filtrados.forEach((r) => r.planteles.forEach((x) => { unicos.add(x.codigo_dea); if (x.estado === "ATENDIDO") atendidos.add(x.codigo_dea); }));
    const porAnio = new Map();
    filtrados.forEach((r) => { if (!porAnio.has(r.anio)) porAnio.set(r.anio, { anio: r.anio, proyectos: 0 }); porAnio.get(r.anio).proyectos += 1; });
    res.json({
      proyectos: filtrados,
      anios: [...new Set(todos.map((r) => r.anio))].sort((a, b) => b - a),
      resumen: { proyectos: filtrados.length, planteles: unicos.size, planteles_atendidos: atendidos.size, sin_planteles: filtrados.filter((r) => r.sin_planteles).length, por_anio: [...porAnio.values()].sort((a, b) => b.anio - a.anio) },
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
    try { p = await gescolar.obtenerPlantel(codigo); } catch (_) { p = null; }
    const cirCod = p ? col(p, "cod_circuito") : "";
    const cirNom = p ? col(p, "nomb_circuito") : "";
    const { rows } = await pool.query(
      `SELECT t.*, x.estado FROM (${NUMERADOS}) t JOIN comunal_proyecto_planteles x ON x.proyecto_id = t.id WHERE x.codigo_dea = $1 ORDER BY t.anio, t.fecha_consulta NULLS LAST, t.id`, [codigo]);
    let pendientes = 0;
    if (cirCod || cirNom) {
      const r2 = await pool.query(
        `SELECT count(*)::int AS n FROM comunal_proyectos c WHERE (c.circuito_codigo = $1::text OR lower(c.circuito_nombre) = lower($2::text))
           AND NOT EXISTS (SELECT 1 FROM comunal_proyecto_planteles x WHERE x.proyecto_id = c.id)`, [cirCod, cirNom]);
      pendientes = r2.rows[0].n;
    }
    res.json({
      codigo_dea: codigo,
      plantel: p ? { nombre_plantel: String(p[gescolar.CAMPO_NOMBRE] || ""), circuito_codigo: cirCod, circuito_nombre: cirNom, consejo_codigo: col(p, "cod_consejo_com"), consejo_nombre: col(p, "nom_consejo_com") } : null,
      tiene_proyecto: rows.length > 0,
      total: rows.length,
      proyectos: rows.map((r) => ({ id: r.id, numero: r.numero, anio: r.anio, fecha_consulta: fechaTxt(r.fecha_consulta), nombre_proyecto: r.nombre_proyecto, circuito_nombre: r.circuito_nombre, estado: r.estado })),
      proyectos_comuna_sin_definir: pendientes,
      puede_editar: ROLES_ESCRIBE.includes(req.usuario.rol),
    });
  } catch (err) {
    if (err.code === SIN_TABLAS) return falta(res);
    falloInterno(res, err, "No se pudieron cargar los proyectos comunales del plantel.");
  }
});

router.post("/", requireAuth, requireRol(...ROLES_ESCRIBE), async (req, res) => {
  const cliente = await pool.connect();
  try {
    const { proyecto: d, planteles } = await validar(req.body, true);
    await cliente.query("BEGIN");
    const r = await cliente.query(
      `INSERT INTO comunal_proyectos (circuito_codigo, circuito_nombre, anio, fecha_consulta, nombre_proyecto, observaciones, creado_por, actualizado_por)
       VALUES ($1::text, $2::text, $3::int, $4::date, $5::text, $6::text, $7::int, $7::int) RETURNING id`,
      [d.circuito_codigo, d.circuito_nombre, d.anio, d.fecha_consulta, d.nombre_proyecto, d.observaciones, req.usuario.id]);
    await guardarPlanteles(cliente, r.rows[0].id, planteles);
    await cliente.query("COMMIT");
    res.status(201).json({ ok: true, id: r.rows[0].id });
  } catch (err) {
    await cliente.query("ROLLBACK").catch(() => {});
    if (err.http400) return res.status(400).json({ error: err.http400 });
    if (err.gescolar) return res.status(502).json({ error: "No se pudo consultar la hoja de GESCOLAR." });
    if (err.code === SIN_TABLAS) return falta(res);
    falloInterno(res, err, "No se pudo registrar el proyecto comunal.");
  } finally { cliente.release(); }
});

router.put("/:id", requireAuth, requireRol(...ROLES_ESCRIBE), async (req, res) => {
  const id = entero(req.params.id);
  if (!id) return res.status(400).json({ error: "Registro no válido." });
  const cliente = await pool.connect();
  try {
    const { proyecto: d, planteles } = await validar(req.body, false);
    await cliente.query("BEGIN");
    const r = await cliente.query(
      `UPDATE comunal_proyectos SET circuito_codigo = $2::text, circuito_nombre = $3::text, anio = $4::int, fecha_consulta = $5::date, nombre_proyecto = $6::text,
              observaciones = $7::text, actualizado_por = $8::int, actualizado_en = NOW() WHERE id = $1 RETURNING id`,
      [id, d.circuito_codigo, d.circuito_nombre, d.anio, d.fecha_consulta, d.nombre_proyecto, d.observaciones, req.usuario.id]);
    if (!r.rows.length) { await cliente.query("ROLLBACK"); return res.status(404).json({ error: "No existe ese proyecto." }); }
    if (planteles) await guardarPlanteles(cliente, id, planteles);
    await cliente.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    await cliente.query("ROLLBACK").catch(() => {});
    if (err.http400) return res.status(400).json({ error: err.http400 });
    if (err.gescolar) return res.status(502).json({ error: "No se pudo consultar la hoja de GESCOLAR." });
    if (err.code === SIN_TABLAS) return falta(res);
    falloInterno(res, err, "No se pudo guardar el proyecto comunal.");
  } finally { cliente.release(); }
});

router.delete("/:id", requireAuth, requireRol(...ROLES_ESCRIBE), async (req, res) => {
  const id = entero(req.params.id);
  if (!id) return res.status(400).json({ error: "Registro no válido." });
  try {
    const r = await pool.query("DELETE FROM comunal_proyectos WHERE id = $1 RETURNING id", [id]);
    if (!r.rows.length) return res.status(404).json({ error: "No existe ese proyecto." });
    res.json({ ok: true });
  } catch (err) {
    if (err.code === SIN_TABLAS) return falta(res);
    falloInterno(res, err, "No se pudo quitar el proyecto comunal.");
  }
});

module.exports = router;
