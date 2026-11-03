// reportesInspecciones.js — Reportes por plan del módulo Inspecciones.
//
// Rutas montadas en /api/inspecciones/reportes (se montan ANTES que /api/inspecciones):
//   GET /catalogo                          columnas disponibles para el perfil en sesión, agrupadas, y combinaciones sugeridas
//   GET /plan/:id?columnas=a,b,c           el reporte en JSON (vista previa en pantalla)
//   GET /plan/:id/excel?columnas=a,b,c     el mismo reporte en Excel
//   GET /planes                            planes que se pueden elegir (con su cantidad de planteles activos)
//
// Solo lectura. Perfiles: admin, insp_coordinador, insp_consulta y operador_plantel. Las columnas con datos de
// contacto del director solo las ven admin e insp_coordinador (el servidor las rechaza al resto, no solo las oculta).
// El ingeniero (insp_ingeniero) no entra aquí.

const express = require("express");
const { requireAuth, requireRol } = require("../middleware/auth");
const { pool } = require("../db/pool");
const infra = require("../services/infraestructuras");
const reportes = require("../services/reportesInspecciones");

const router = express.Router();
const ROLES_LECTURA = ["admin", "operador_plantel", "insp_coordinador", "insp_consulta"];

function entero(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function responderError(res, err, mensaje) {
  if (err && err.estado) return res.status(err.estado).json({ error: err.message });
  console.error("Reportes:", err);
  return res.status(500).json({ error: mensaje });
}

// Para que el reporte vea los edificios que ya están en la hoja de Coordenadas (como mucho cada 5 min; si falla, se usa lo guardado).
async function asegurarSync() {
  try { await infra.sincronizar(); } catch (e) { console.error("Reportes: sincronizar infraestructuras:", e.message); }
}

function nombreArchivo(...partes) {
  return partes.join("_").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").slice(0, 120);
}

router.get("/catalogo", requireAuth, requireRol(...ROLES_LECTURA), (req, res) => {
  res.json(reportes.catalogoPara(req.usuario.rol));
});

router.get("/planes", requireAuth, requireRol(...ROLES_LECTURA), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.nombre, p.estado,
              (SELECT COUNT(*) FROM plan_inspecciones pi WHERE pi.plan_id = p.id AND pi.desenlazado_en IS NULL)::int AS planteles
       FROM planes_atencion p ORDER BY p.estado, p.nombre`
    );
    res.json({ planes: rows });
  } catch (err) {
    responderError(res, err, "No se pudo cargar la lista de planes.");
  }
});

router.get("/plan/:id", requireAuth, requireRol(...ROLES_LECTURA), async (req, res) => {
  const planId = entero(req.params.id);
  if (!planId) return res.status(400).json({ error: "Plan inválido." });
  try {
    const columnas = reportes.validarColumnas(req.query.columnas, req.usuario.rol);
    if (columnas.some((c) => c.grupo === "edificio")) await asegurarSync();
    const reporte = await reportes.armarReportePlan(planId, columnas);
    if (!reporte) return res.status(404).json({ error: "Plan no encontrado." });
    res.json(reporte);
  } catch (err) {
    responderError(res, err, "No se pudo armar el reporte.");
  }
});

router.get("/plan/:id/excel", requireAuth, requireRol(...ROLES_LECTURA), async (req, res) => {
  const planId = entero(req.params.id);
  if (!planId) return res.status(400).json({ error: "Plan inválido." });
  try {
    const columnas = reportes.validarColumnas(req.query.columnas, req.usuario.rol);
    if (columnas.some((c) => c.grupo === "edificio")) await asegurarSync();
    const reporte = await reportes.armarReportePlan(planId, columnas);
    if (!reporte) return res.status(404).json({ error: "Plan no encontrado." });
    const buffer = await require("../services/exportarExcel").reportePlan(reporte);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${nombreArchivo("REPORTE", reporte.plan.nombre)}.xlsx"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(Buffer.from(buffer));
  } catch (err) {
    responderError(res, err, "No se pudo generar el Excel del reporte.");
  }
});

module.exports = router;
