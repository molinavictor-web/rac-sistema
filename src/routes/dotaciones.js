// dotaciones.js — Solicitudes de dotación (mobiliario y cocina, CBIT, mantenimiento) por plan y plantel.
// Montado en /api/inspecciones/dotacion (antes que /api/inspecciones). Script 26.
//
//   GET    /rubros[?todos=1]               catálogo de rubros (agrupado por bloque)
//   PUT    /rubros                         (gestión) guarda el catálogo: agregar, renombrar, ordenar, retirar
//   GET    /buscar?q=&plan_id=             (gestión) busca planteles en GESCOLAR para agregarlos al plan
//   GET    /plan/:planId                   solicitudes del plan
//   POST   /plan/:planId                   (gestión) crea la solicitud de un plantel {codigo_dea}
//   GET    /plan/:planId/consolidado       rubros × planteles con totales   (y .xlsx)
//   GET    /:id    PUT /:id    DELETE /:id  una solicitud (ver, guardar, borrar)   (GET /:id.xlsx descarga el Excel)
//
// Una solicitud pertenece a un plan y a un plantel (único por plan+plantel); el plantel NO tiene que estar
// rehabilitado. Cantidad vacía = no se pide (no sale en el Excel); «NO» = explícitamente no se da; número = cantidad.
// Quién escribe: admin y coordinador; el ingeniero de rehabilitación del plantel en ese plan solo llena la suya.
// Plan cerrado = solo lectura.

const express = require("express");
const { pool } = require("../db/pool");
const { requireAuth, requireRol } = require("../middleware/auth");
const gescolar = require("../services/gescolar");
const insp = require("./inspecciones").utilidades;

const router = express.Router();
const { entero, texto, falloInterno, estadoDelPlan, esIngenieroDeRehabilitacion, valorGescolar, datosDeGescolar, nombreArchivo, enviarExcel,
  ROLES_GESTION, ROLES_LECTURA, ROLES_PLANILLA, CODIGO_DEA } = insp;

const SIN_TABLAS = "42P01";
const BLOQUES = {
  MOBILIARIO_COCINA: "DOTACIÓN MOBILIARIO Y COCINA",
  CBIT: "DOTACIÓN CBIT",
  MANTENIMIENTO: "DOTACIÓN EQUIPOS PARA MANTENIMIENTO",
};
const CAMPOS_DATOS = { institucion: 200, estado: 60, municipio: 120, parroquia: 120, direccion: 300, matricula: 20, aulas: 20, director: 200, telefono: 60 };

const falta = (res) => res.status(503).json({ error: "Falta ejecutar el script 26 en Supabase." });
const redondear3 = (n) => Math.round(n * 1000) / 1000;

function limpiarDatos(entrada) {
  const r = {};
  Object.keys(CAMPOS_DATOS).forEach((k) => {
    if (entrada && Object.prototype.hasOwnProperty.call(entrada, k)) r[k] = texto(entrada[k]).slice(0, CAMPOS_DATOS[k]);
  });
  return r;
}

async function cargarRubros(soloActivos) {
  const { rows } = await pool.query(
    `SELECT id, bloque, nombre, unidad, orden, activo FROM dotacion_rubros ${soloActivos ? "WHERE activo" : ""}
     ORDER BY CASE bloque WHEN 'MOBILIARIO_COCINA' THEN 1 WHEN 'CBIT' THEN 2 ELSE 3 END, orden, id`
  );
  return rows;
}

function agruparPorBloque(rubros) {
  return Object.keys(BLOQUES).map((b) => ({ bloque: b, titulo: BLOQUES[b], rubros: rubros.filter((r) => r.bloque === b) }));
}

// ¿Puede esta persona ver / llenar la solicitud? (el ingeniero, solo si es el de rehabilitación de ese plantel en ese plan)
async function permisoSobre(usuario, d) {
  if (ROLES_GESTION.includes(usuario.rol)) return { ver: true, editar: true };
  if (ROLES_LECTURA.includes(usuario.rol)) return { ver: true, editar: false };
  if (usuario.rol === "insp_ingeniero") {
    const { rows } = await pool.query(
      "SELECT ingeniero_rehab FROM plan_inspecciones WHERE plan_id = $1 AND codigo_dea = $2 AND desenlazado_en IS NULL",
      [d.plan_id, d.codigo_dea]
    );
    for (const r of rows) if (await esIngenieroDeRehabilitacion(usuario.id, r.ingeniero_rehab)) return { ver: true, editar: true };
  }
  return { ver: false, editar: false };
}

// ---------------------------------------------------------------------------
// Catálogo de rubros
// ---------------------------------------------------------------------------

router.get("/rubros", requireAuth, requireRol(...ROLES_PLANILLA), async (req, res) => {
  try {
    const todos = req.query.todos === "1" && ROLES_GESTION.includes(req.usuario.rol);
    const rubros = await cargarRubros(!todos);
    res.json({ bloques: agruparPorBloque(rubros) });
  } catch (err) {
    if (err.code === SIN_TABLAS) return falta(res);
    falloInterno(res, err, "No se pudo cargar el catálogo de dotación.");
  }
});

router.put("/rubros", requireAuth, requireRol(...ROLES_GESTION), async (req, res) => {
  const lista = (req.body || {}).rubros;
  if (!Array.isArray(lista) || lista.length > 300) return res.status(400).json({ error: "Lista de rubros inválida." });
  const limpios = [];
  const vistos = new Set();
  for (const r of lista) {
    const bloque = String((r && r.bloque) || "");
    if (!BLOQUES[bloque]) return res.status(400).json({ error: "Bloque inválido." });
    const nombre = texto(r.nombre);
    if (nombre.length < 2 || nombre.length > 150) return res.status(400).json({ error: "Cada rubro necesita un nombre de 2 a 150 caracteres." });
    const unidad = texto(r.unidad).toUpperCase() || "UNIDAD";
    if (unidad.length > 20) return res.status(400).json({ error: `La unidad de «${nombre}» es muy larga (máximo 20).` });
    const clave = `${bloque}|${nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()}`;
    if (vistos.has(clave)) return res.status(400).json({ error: `El rubro «${nombre}» está repetido en ${BLOQUES[bloque]}.` });
    vistos.add(clave);
    const id = r.id === undefined || r.id === null || r.id === "" ? null : entero(r.id);
    if (r.id !== undefined && r.id !== null && r.id !== "" && !id) return res.status(400).json({ error: "Rubro inválido." });
    limpios.push({ id, bloque, nombre, unidad });
  }
  const cliente = await pool.connect();
  try {
    await cliente.query("BEGIN");
    const existentes = new Set((await cliente.query("SELECT id FROM dotacion_rubros")).rows.map((x) => x.id));
    const conservar = [];
    const contador = {};
    for (const r of limpios) {
      contador[r.bloque] = (contador[r.bloque] || 0) + 1;
      if (r.id) {
        if (!existentes.has(r.id)) { const e = new Error("rubro"); e.http400 = "Uno de los rubros ya no existe. Recarga la pantalla."; throw e; }
        // Primero se liberan los nombres para que dos rubros puedan intercambiarse sin chocar con el índice único.
        await cliente.query("UPDATE dotacion_rubros SET activo = FALSE WHERE id = $1", [r.id]);
      }
    }
    for (const r of limpios) {
      const orden = limpios.filter((x) => x.bloque === r.bloque).indexOf(r) + 1;
      if (r.id) {
        await cliente.query("UPDATE dotacion_rubros SET bloque = $2, nombre = $3, unidad = $4, orden = $5, activo = TRUE, actualizado_en = NOW() WHERE id = $1", [r.id, r.bloque, r.nombre, r.unidad, orden]);
        conservar.push(r.id);
      } else {
        const ins = await cliente.query("INSERT INTO dotacion_rubros (bloque, nombre, unidad, orden) VALUES ($1, $2, $3, $4) RETURNING id", [r.bloque, r.nombre, r.unidad, orden]);
        conservar.push(ins.rows[0].id);
      }
    }
    // Los que ya no están en la lista se retiran (no se borran: conservan las cantidades ya cargadas).
    await cliente.query("UPDATE dotacion_rubros SET activo = FALSE, actualizado_en = NOW() WHERE activo AND NOT (id = ANY($1::int[]))", [conservar]);
    await cliente.query("COMMIT");
  } catch (err) {
    await cliente.query("ROLLBACK").catch(() => {});
    if (err.http400) return res.status(400).json({ error: err.http400 });
    if (err.code === SIN_TABLAS) return falta(res);
    return falloInterno(res, err, "No se pudo guardar el catálogo.");
  } finally {
    cliente.release();
  }
  try {
    res.json({ ok: true, bloques: agruparPorBloque(await cargarRubros(true)) });
  } catch (err) {
    falloInterno(res, err, "Se guardó, pero no se pudo recargar el catálogo.");
  }
});

// ---------------------------------------------------------------------------
// Búsqueda de planteles (para agregarlos a la dotación de un plan)
// ---------------------------------------------------------------------------

router.get("/buscar", requireAuth, requireRol(...ROLES_GESTION), async (req, res) => {
  const q = texto(req.query.q);
  if (q.length < 2) return res.status(400).json({ error: "Escribe al menos 2 caracteres para buscar." });
  const planId = req.query.plan_id ? entero(req.query.plan_id) : null;
  let encontrados;
  try {
    encontrados = await gescolar.buscarPlanteles(q);
  } catch (err) {
    console.error("Error consultando GESCOLAR:", err);
    return res.status(502).json({ error: "No se pudo consultar la hoja de GESCOLAR." });
  }
  try {
    const enElPlan = new Set();
    if (planId) {
      const { rows } = await pool.query("SELECT codigo_dea FROM dotaciones WHERE plan_id = $1", [planId]);
      rows.forEach((r) => enElPlan.add(r.codigo_dea));
    }
    res.json({
      limitado: encontrados.limitado,
      planteles: encontrados.planteles.map((p) => {
        const codigo = String(p.cod_plantel || "").trim();
        return { cod_plantel: codigo, nombre_plantel: p.nombre_plantel || "", municipio: p.municipio || "", parroquia: p.parroquia || "", en_el_plan: enElPlan.has(codigo) };
      }),
    });
  } catch (err) {
    if (err.code === SIN_TABLAS) return falta(res);
    falloInterno(res, err, "No se pudo completar la búsqueda.");
  }
});

// ---------------------------------------------------------------------------
// Solicitudes de un plan
// ---------------------------------------------------------------------------

router.get("/plan/:planId", requireAuth, requireRol(...ROLES_PLANILLA), async (req, res) => {
  const planId = entero(req.params.planId);
  if (!planId) return res.status(400).json({ error: "Plan inválido." });
  try {
    const plan = await pool.query("SELECT id, nombre, estado, tipo FROM planes_atencion WHERE id = $1", [planId]);
    if (!plan.rows.length) return res.status(404).json({ error: "Plan no encontrado." });
    const { rows } = await pool.query(
      `SELECT d.id, d.codigo_dea, d.fecha::text AS fecha, d.datos, d.actualizado_en,
              (SELECT COUNT(*)::int FROM dotacion_items i WHERE i.dotacion_id = d.id AND (i.cantidad > 0)) AS rubros_con_cantidad,
              EXISTS (SELECT 1 FROM plan_inspecciones pi WHERE pi.plan_id = d.plan_id AND pi.codigo_dea = d.codigo_dea AND pi.desenlazado_en IS NULL) AS en_rehabilitacion
         FROM dotaciones d WHERE d.plan_id = $1 ORDER BY d.datos->>'municipio', d.datos->>'parroquia', d.datos->>'institucion', d.codigo_dea`,
      [planId]
    );
    let dotaciones = rows.map((d) => ({
      id: d.id, codigo_dea: d.codigo_dea, fecha: d.fecha, nombre_plantel: (d.datos && d.datos.institucion) || d.codigo_dea,
      municipio: (d.datos && d.datos.municipio) || "", parroquia: (d.datos && d.datos.parroquia) || "",
      rubros_con_cantidad: d.rubros_con_cantidad, en_rehabilitacion: d.en_rehabilitacion, plan_id: planId,
    }));
    if (req.usuario.rol === "insp_ingeniero") {
      const permitidas = [];
      for (const d of dotaciones) if ((await permisoSobre(req.usuario, d)).ver) permitidas.push(d);
      dotaciones = permitidas;
    }
    res.json({ plan: plan.rows[0], dotaciones, puede_gestionar: ROLES_GESTION.includes(req.usuario.rol) });
  } catch (err) {
    if (err.code === SIN_TABLAS) return falta(res);
    falloInterno(res, err, "No se pudieron cargar las solicitudes de dotación.");
  }
});

router.post("/plan/:planId", requireAuth, requireRol(...ROLES_GESTION), async (req, res) => {
  const planId = entero(req.params.planId);
  const codigoPedido = texto((req.body || {}).codigo_dea);
  if (!planId) return res.status(400).json({ error: "Plan inválido." });
  if (!CODIGO_DEA.test(codigoPedido)) return res.status(400).json({ error: "Código DEA inválido." });
  try {
    const estado = await estadoDelPlan(planId);
    if (!estado.existe) return res.status(404).json({ error: "Plan no encontrado." });
    if (estado.cerrado) return res.status(409).json({ error: "El plan está cerrado: reábrelo para agregar planteles." });
  } catch (err) {
    return falloInterno(res, err, "No se pudo verificar el plan.");
  }
  let fila;
  try {
    fila = await gescolar.obtenerPlantel(codigoPedido);
  } catch (err) {
    console.error("Error consultando GESCOLAR:", err);
    return res.status(502).json({ error: "No se pudo consultar la hoja de GESCOLAR." });
  }
  if (!fila) return res.status(404).json({ error: `El código ${codigoPedido} no existe en GESCOLAR.` });
  const codigo = String(fila[gescolar.CAMPO_CODIGO]).trim();
  const base = datosDeGescolar(fila);
  const datos = limpiarDatos({
    institucion: base.institucion, estado: valorGescolar(fila, { candidatos: ["estado", "entidad_federal"] }) || "MONAGAS",
    municipio: base.municipio, parroquia: base.parroquia, direccion: base.direccion, matricula: base.matricula,
    aulas: base.aulas, director: base.director, telefono: base.telefono,
  });
  try {
    const activa = await pool.query(
      "SELECT inspeccion_id FROM plan_inspecciones WHERE plan_id = $1 AND codigo_dea = $2 AND desenlazado_en IS NULL LIMIT 1",
      [planId, codigo]
    );
    const ins = await pool.query(
      `INSERT INTO dotaciones (plan_id, codigo_dea, inspeccion_id, datos, creado_por, actualizado_por)
       VALUES ($1::int, $2::text, $3::int, $4::jsonb, $5::int, $5::int)
       ON CONFLICT (plan_id, codigo_dea) DO NOTHING RETURNING id`,
      [planId, codigo, activa.rows.length ? activa.rows[0].inspeccion_id : null, JSON.stringify(datos), req.usuario.id]
    );
    if (!ins.rows.length) {
      const ya = await pool.query("SELECT id FROM dotaciones WHERE plan_id = $1 AND codigo_dea = $2", [planId, codigo]);
      return res.status(409).json({ error: "Ese plantel ya tiene su solicitud de dotación en este plan.", id: ya.rows[0] && ya.rows[0].id });
    }
    res.status(201).json({ ok: true, id: ins.rows[0].id });
  } catch (err) {
    if (err.code === SIN_TABLAS) return falta(res);
    falloInterno(res, err, "No se pudo crear la solicitud de dotación.");
  }
});

// ---------------------------------------------------------------------------
// Consolidado del plan (rubros × planteles)
// ---------------------------------------------------------------------------

async function armarConsolidado(planId) {
  const plan = await pool.query("SELECT id, nombre FROM planes_atencion WHERE id = $1", [planId]);
  if (!plan.rows.length) return null;
  const dots = (await pool.query(
    "SELECT id, codigo_dea, datos FROM dotaciones WHERE plan_id = $1 ORDER BY datos->>'municipio', datos->>'parroquia', datos->>'institucion', codigo_dea", [planId]
  )).rows;
  const items = (await pool.query(
    `SELECT i.dotacion_id, i.rubro_id, i.cantidad::float AS cantidad, i.es_no
       FROM dotacion_items i JOIN dotaciones d ON d.id = i.dotacion_id WHERE d.plan_id = $1 AND i.cantidad > 0`, [planId]
  )).rows;
  const usados = new Set(items.map((i) => i.rubro_id));
  const rubros = (await cargarRubros(false)).filter((r) => r.activo || usados.has(r.id));
  const celda = new Map(items.map((i) => [`${i.dotacion_id}:${i.rubro_id}`, i.cantidad]));
  const filas = rubros.map((r) => {
    const cantidades = dots.map((d) => celda.get(`${d.id}:${r.id}`) || 0);
    return { rubro_id: r.id, bloque: r.bloque, nombre: r.nombre, unidad: r.unidad, retirado: !r.activo, cantidades, total: redondear3(cantidades.reduce((a, n) => a + n, 0)) };
  }).filter((f) => f.total > 0);
  return {
    plan: plan.rows[0],
    planteles: dots.map((d) => ({ id: d.id, codigo_dea: d.codigo_dea, nombre_plantel: (d.datos && d.datos.institucion) || d.codigo_dea, municipio: (d.datos && d.datos.municipio) || "" })),
    bloques: Object.keys(BLOQUES).map((b) => ({ bloque: b, titulo: BLOQUES[b], filas: filas.filter((f) => f.bloque === b) })),
  };
}

router.get("/plan/:planId/consolidado", requireAuth, requireRol(...ROLES_LECTURA), async (req, res) => {
  const planId = entero(req.params.planId);
  if (!planId) return res.status(400).json({ error: "Plan inválido." });
  try {
    const c = await armarConsolidado(planId);
    if (!c) return res.status(404).json({ error: "Plan no encontrado." });
    res.json(c);
  } catch (err) {
    if (err.code === SIN_TABLAS) return falta(res);
    falloInterno(res, err, "No se pudo armar el consolidado de dotación.");
  }
});

router.get("/plan/:planId/consolidado.xlsx", requireAuth, requireRol(...ROLES_LECTURA), async (req, res) => {
  const planId = entero(req.params.planId);
  if (!planId) return res.status(400).json({ error: "Plan inválido." });
  try {
    const c = await armarConsolidado(planId);
    if (!c) return res.status(404).json({ error: "Plan no encontrado." });
    const buffer = await require("../services/exportarExcel").dotacionConsolidado(c);
    enviarExcel(res, buffer, nombreArchivo("DOTACION_CONSOLIDADO", c.plan.nombre));
  } catch (err) {
    if (err.code === SIN_TABLAS) return falta(res);
    falloInterno(res, err, "No se pudo generar el Excel del consolidado de dotación.");
  }
});

// ---------------------------------------------------------------------------
// Una solicitud
// ---------------------------------------------------------------------------

async function armarSolicitud(id) {
  const c = await pool.query(
    `SELECT d.id, d.plan_id, d.codigo_dea, d.fecha::text AS fecha, d.datos, d.observaciones, d.actualizado_en,
            p.nombre AS plan_nombre, p.estado AS plan_estado
       FROM dotaciones d JOIN planes_atencion p ON p.id = d.plan_id WHERE d.id = $1`, [id]
  );
  if (!c.rows.length) return null;
  const d = c.rows[0];
  const items = (await pool.query("SELECT rubro_id, cantidad::float AS cantidad, es_no FROM dotacion_items WHERE dotacion_id = $1", [id])).rows;
  const porRubro = new Map(items.map((i) => [i.rubro_id, i]));
  const rubros = (await cargarRubros(false)).filter((r) => r.activo || porRubro.has(r.id));
  const bloques = agruparPorBloque(rubros).map((b) => ({
    ...b,
    rubros: b.rubros.map((r) => {
      const i = porRubro.get(r.id);
      return { rubro_id: r.id, nombre: r.nombre, unidad: r.unidad, retirado: !r.activo, cantidad: i && i.cantidad !== null ? i.cantidad : null, es_no: Boolean(i && i.es_no) };
    }),
  }));
  return {
    dotacion: { id: d.id, plan_id: d.plan_id, codigo_dea: d.codigo_dea, fecha: d.fecha, datos: d.datos || {}, observaciones: d.observaciones || "", actualizado_en: d.actualizado_en },
    plan: { id: d.plan_id, nombre: d.plan_nombre, estado: d.plan_estado },
    bloques,
  };
}

async function cargarConPermiso(req, res) {
  const id = entero(req.params.id);
  if (!id) { res.status(400).json({ error: "Solicitud inválida." }); return null; }
  const s = await armarSolicitud(id);
  if (!s) { res.status(404).json({ error: "Solicitud no encontrada." }); return null; }
  const permiso = await permisoSobre(req.usuario, s.dotacion);
  if (!permiso.ver) { res.status(403).json({ error: "Esta solicitud de dotación no te corresponde." }); return null; }
  return { s, permiso };
}

router.get("/:id.xlsx", requireAuth, requireRol(...ROLES_PLANILLA), async (req, res) => {
  try {
    const r = await cargarConPermiso(req, res);
    if (!r) return;
    const buffer = await require("../services/exportarExcel").dotacionIndividual(r.s);
    enviarExcel(res, buffer, nombreArchivo("DOTACION", r.s.dotacion.codigo_dea, r.s.dotacion.datos.institucion || ""));
  } catch (err) {
    if (err.code === SIN_TABLAS) return falta(res);
    falloInterno(res, err, "No se pudo generar el Excel de la dotación.");
  }
});

router.get("/:id", requireAuth, requireRol(...ROLES_PLANILLA), async (req, res) => {
  try {
    const r = await cargarConPermiso(req, res);
    if (!r) return;
    res.json({ ...r.s, puede_editar: r.permiso.editar && r.s.plan.estado !== "CERRADO" });
  } catch (err) {
    if (err.code === SIN_TABLAS) return falta(res);
    falloInterno(res, err, "No se pudo cargar la solicitud de dotación.");
  }
});

router.put("/:id", requireAuth, requireRol(...ROLES_PLANILLA), async (req, res) => {
  const cuerpo = req.body || {};
  const cliente = await pool.connect();
  try {
    const r = await cargarConPermiso(req, res);
    if (!r) return;
    if (!r.permiso.editar) return res.status(403).json({ error: "No tienes permiso para cambiar esta solicitud." });
    if (r.s.plan.estado === "CERRADO") return res.status(409).json({ error: "El plan está cerrado: reábrelo para cambiar la dotación." });
    const id = r.s.dotacion.id;

    let fecha = null;
    if (cuerpo.fecha !== undefined && cuerpo.fecha !== null && cuerpo.fecha !== "") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(cuerpo.fecha)) || Number.isNaN(Date.parse(cuerpo.fecha))) return res.status(400).json({ error: "Fecha inválida." });
      fecha = String(cuerpo.fecha);
    }
    const datos = { ...r.s.dotacion.datos, ...limpiarDatos(cuerpo.datos || {}) };
    const observaciones = texto(cuerpo.observaciones).slice(0, 2000);

    const validos = new Set((await cargarRubros(false)).map((x) => x.id));
    const lista = Array.isArray(cuerpo.items) ? cuerpo.items : [];
    if (lista.length > 400) return res.status(400).json({ error: "Demasiados rubros." });
    const items = [];
    const repetidos = new Set();
    for (const it of lista) {
      const rubroId = entero(it && it.rubro_id);
      if (!rubroId || !validos.has(rubroId)) return res.status(400).json({ error: "Uno de los rubros no existe. Recarga la pantalla." });
      if (repetidos.has(rubroId)) return res.status(400).json({ error: "Un rubro viene repetido." });
      repetidos.add(rubroId);
      const esNo = it.es_no === true;
      let cantidad = null;
      if (!esNo && it.cantidad !== undefined && it.cantidad !== null && String(it.cantidad).trim() !== "") {
        const n = Number(String(it.cantidad).trim().replace(",", "."));
        if (!Number.isFinite(n) || n < 0 || n > 1e9) return res.status(400).json({ error: "Las cantidades deben ser números de 0 en adelante." });
        cantidad = redondear3(n);
      }
      if (esNo || cantidad !== null) items.push({ rubroId, cantidad, esNo });
    }

    await cliente.query("BEGIN");
    await cliente.query(
      "UPDATE dotaciones SET fecha = $2::date, datos = $3::jsonb, observaciones = $4::text, actualizado_por = $5::int, actualizado_en = NOW() WHERE id = $1",
      [id, fecha, JSON.stringify(datos), observaciones, req.usuario.id]
    );
    await cliente.query("DELETE FROM dotacion_items WHERE dotacion_id = $1", [id]);
    for (const it of items) {
      await cliente.query("INSERT INTO dotacion_items (dotacion_id, rubro_id, cantidad, es_no) VALUES ($1::int, $2::int, $3::numeric, $4::boolean)", [id, it.rubroId, it.cantidad, it.esNo]);
    }
    await cliente.query("COMMIT");
    res.json({ ok: true, items: items.length });
  } catch (err) {
    await cliente.query("ROLLBACK").catch(() => {});
    if (err.code === SIN_TABLAS) return falta(res);
    falloInterno(res, err, "No se pudo guardar la solicitud de dotación.");
  } finally {
    cliente.release();
  }
});

router.delete("/:id", requireAuth, requireRol(...ROLES_GESTION), async (req, res) => {
  const id = entero(req.params.id);
  if (!id) return res.status(400).json({ error: "Solicitud inválida." });
  try {
    const { rows } = await pool.query(
      "SELECT d.id, p.estado FROM dotaciones d JOIN planes_atencion p ON p.id = d.plan_id WHERE d.id = $1", [id]
    );
    if (!rows.length) return res.status(404).json({ error: "Solicitud no encontrada." });
    if (rows[0].estado === "CERRADO") return res.status(409).json({ error: "El plan está cerrado: reábrelo para quitar planteles." });
    await pool.query("DELETE FROM dotaciones WHERE id = $1", [id]);
    res.json({ ok: true });
  } catch (err) {
    if (err.code === SIN_TABLAS) return falta(res);
    falloInterno(res, err, "No se pudo quitar la solicitud.");
  }
});

module.exports = router;
