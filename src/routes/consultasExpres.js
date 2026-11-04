// consultasExpres.js — Consultas exprés del Instrumento Uno (montado en /api/inspecciones/consultas).
//
//   GET   /                       consultas (el ingeniero solo ve las abiertas)
//   GET   /fases                  fases que se pueden elegir
//   POST  /                       crea una consulta {nombre, descripcion, fases[]}        (admin, coordinador)
//   PATCH /:id                    cambia nombre o la abre/cierra {nombre?, estado?}       (admin, coordinador)
//   GET   /:id/plantel/:codigo    formulario de las fases de la consulta con el dato vigente del plantel
//   PUT   /:id/plantel/:codigo    guarda {datos, nota, verificado}
//   GET   /cambios                cambios recientes con filtros ?municipio=&q=&limite=    (solo admin)
//   POST  /cambios/:id/revertir   vuelve al dato anterior                                 (solo admin)
//
// Las rutas fijas (/fases, /cambios) van antes que /:id.

const express = require("express");
const { requireAuth, requireRol } = require("../middleware/auth");
const consultas = require("../services/consultasExpres");

const router = express.Router();
const ROLES_VER = ["admin", "insp_coordinador", "insp_ingeniero", "insp_consulta"];
const ROLES_LLENAN = ["admin", "insp_coordinador", "insp_ingeniero"];
const ROLES_CREAN = ["admin", "insp_coordinador"];

function entero(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function responder(res, err, mensaje) {
  if (err && err.estado) return res.status(err.estado).json({ error: err.message, ...(err.extra || {}) });
  console.error("Consultas exprés:", err);
  return res.status(500).json({ error: mensaje });
}

router.get("/fases", requireAuth, requireRol(...ROLES_VER), (req, res) => res.json({ fases: consultas.FASES }));

router.get("/cambios", requireAuth, requireRol("admin"), async (req, res) => {
  try {
    res.json({ cambios: await consultas.cambiosRecientes({ municipio: req.query.municipio, q: req.query.q, limite: req.query.limite }) });
  } catch (err) {
    responder(res, err, "No se pudieron cargar los cambios.");
  }
});

router.post("/cambios/:id/revertir", requireAuth, requireRol("admin"), async (req, res) => {
  const id = entero(req.params.id);
  if (!id) return res.status(400).json({ error: "Cambio inválido." });
  try {
    await consultas.revertirCambio(id, req.usuario.id);
    res.json({ ok: true });
  } catch (err) {
    responder(res, err, "No se pudo revertir el cambio.");
  }
});

router.get("/", requireAuth, requireRol(...ROLES_VER), async (req, res) => {
  try {
    res.json({ consultas: await consultas.listarConsultas({ soloAbiertas: req.usuario.rol === "insp_ingeniero" }), puede_crear: ROLES_CREAN.includes(req.usuario.rol), puede_llenar: ROLES_LLENAN.includes(req.usuario.rol) });
  } catch (err) {
    responder(res, err, "No se pudieron cargar las consultas.");
  }
});

router.post("/", requireAuth, requireRol(...ROLES_CREAN), async (req, res) => {
  try {
    const id = await consultas.crearConsulta({ nombre: req.body.nombre, descripcion: req.body.descripcion, fases: req.body.fases, usuarioId: req.usuario.id });
    res.status(201).json({ ok: true, id });
  } catch (err) {
    responder(res, err, "No se pudo crear la consulta.");
  }
});

router.patch("/:id", requireAuth, requireRol(...ROLES_CREAN), async (req, res) => {
  const id = entero(req.params.id);
  if (!id) return res.status(400).json({ error: "Consulta inválida." });
  try {
    await consultas.cambiarConsulta(id, { nombre: req.body.nombre, estado: req.body.estado });
    res.json({ ok: true });
  } catch (err) {
    responder(res, err, "No se pudo cambiar la consulta.");
  }
});

router.get("/:id/plantel/:codigo", requireAuth, requireRol(...ROLES_LLENAN), async (req, res) => {
  const id = entero(req.params.id);
  if (!id) return res.status(400).json({ error: "Consulta inválida." });
  try {
    const consulta = await consultas.obtenerConsulta(id);
    if (consulta.estado !== "ABIERTA" && req.usuario.rol === "insp_ingeniero") return res.status(403).json({ error: "Esta consulta está cerrada." });
    const abierto = await consultas.abrirPlantel(consulta, req.params.codigo);
    res.json({ consulta: { id: consulta.id, nombre: consulta.nombre, estado: consulta.estado, fases: consulta.fases }, ...abierto, puede_guardar: consulta.estado === "ABIERTA" });
  } catch (err) {
    responder(res, err, "No se pudo abrir el plantel.");
  }
});

router.put("/:id/plantel/:codigo", requireAuth, requireRol(...ROLES_LLENAN), async (req, res) => {
  const id = entero(req.params.id);
  if (!id) return res.status(400).json({ error: "Consulta inválida." });
  try {
    const consulta = await consultas.obtenerConsulta(id);
    const r = await consultas.guardarPlantel({ consulta, codigoPedido: req.params.codigo, datos: req.body.datos, nota: req.body.nota, verificado: req.body.verificado === true, usuario: req.usuario });
    res.json({ ok: true, ...r });
  } catch (err) {
    responder(res, err, "No se pudo guardar.");
  }
});

module.exports = router;
