// inspecciones.js — módulo de Inspecciones y listados de materiales (SID).
// Etapa 1: planes de atención y planteles de cada plan.
//
// Rutas montadas en /api/inspecciones:
//   GET   /planes                                   lista de planes
//   POST  /planes                                   crear plan
//   PATCH /planes/:id                               editar nombre/descripción/estado
//   GET   /planes/:id                               un plan con sus planteles
//   GET   /planteles/buscar?q=&plan_id=             buscar plantel en GESCOLAR
//   POST  /planes/:id/planteles                     agregar plantel al plan
//   POST  /planes/:id/planteles/:inspeccionId/desenlazar
//   POST  /planes/:id/planteles/:inspeccionId/reenlazar
//
// Regla de fondo: la inspección (con sus cantidades) pertenece al PLANTEL,
// no al plan. "Desenlazar" solo marca una fecha en plan_inspecciones: no
// borra nada, y la inspección queda lista en la base de datos, en espera
// de una futura rehabilitación.

const express = require("express");
const { requireAuth, requireRol } = require("../middleware/auth");
const { pool } = require("../db/pool");
const gescolar = require("../services/gescolar");

const router = express.Router();

// Quiénes administran planes y enlazan planteles. (Más adelante se sumará
// el rol "ingeniero" para cargar cantidades.)
const ROLES_GESTION = ["admin", "operador_plantel"];
const CODIGO_DEA = /^[A-Za-z0-9]{4,20}$/;

function entero(valor) {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function texto(valor) {
  return typeof valor === "string" ? valor.trim() : "";
}

function falloInterno(res, err, mensaje) {
  console.error(mensaje, err);
  return res.status(500).json({ error: mensaje });
}

// Devuelve { existe, cerrado } para el plan.
async function estadoDelPlan(planId) {
  const { rows } = await pool.query("SELECT estado FROM planes_atencion WHERE id = $1", [planId]);
  if (!rows.length) return { existe: false, cerrado: false };
  return { existe: true, cerrado: rows[0].estado === "CERRADO" };
}

// ---------------------------------------------------------------------------
// Planes
// ---------------------------------------------------------------------------

router.get("/planes", requireAuth, requireRol(...ROLES_GESTION), async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.id, p.nombre, p.descripcion, p.version_catalogo, p.estado, p.creado_en,
             COALESCE(SUM(CASE WHEN pi.inspeccion_id IS NOT NULL AND pi.desenlazado_en IS NULL THEN 1 ELSE 0 END), 0)::int AS planteles_activos,
             COALESCE(SUM(CASE WHEN pi.desenlazado_en IS NOT NULL THEN 1 ELSE 0 END), 0)::int AS planteles_desenlazados
      FROM planes_atencion p
      LEFT JOIN plan_inspecciones pi ON pi.plan_id = p.id
      GROUP BY p.id, p.nombre, p.descripcion, p.version_catalogo, p.estado, p.creado_en
      ORDER BY p.creado_en DESC, p.id DESC
    `);
    res.json({ planes: rows });
  } catch (err) {
    falloInterno(res, err, "No se pudieron cargar los planes.");
  }
});

router.post("/planes", requireAuth, requireRol(...ROLES_GESTION), async (req, res) => {
  const cuerpo = req.body || {};
  const nombre = texto(cuerpo.nombre);
  const descripcion = texto(cuerpo.descripcion) || null;
  const version = texto(cuerpo.version_catalogo) || "LISTA2";

  if (nombre.length < 3 || nombre.length > 120) {
    return res.status(400).json({ error: "El nombre del plan debe tener entre 3 y 120 caracteres." });
  }
  if (descripcion && descripcion.length > 500) {
    return res.status(400).json({ error: "La descripción no puede pasar de 500 caracteres." });
  }

  try {
    const lista = await pool.query("SELECT 1 FROM catalogo_materiales WHERE lista = $1 AND activo = TRUE LIMIT 1", [version]);
    if (!lista.rows.length) {
      return res.status(400).json({ error: `La lista de materiales "${version}" no existe en el catálogo.` });
    }
    const { rows } = await pool.query(
      `INSERT INTO planes_atencion (nombre, descripcion, version_catalogo, creado_por)
       VALUES ($1, $2, $3, $4)
       RETURNING id, nombre, descripcion, version_catalogo, estado, creado_en`,
      [nombre, descripcion, version, req.usuario.id]
    );
    res.status(201).json({ plan: rows[0] });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Ya existe un plan con ese nombre." });
    }
    falloInterno(res, err, "No se pudo crear el plan.");
  }
});

router.patch("/planes/:id", requireAuth, requireRol(...ROLES_GESTION), async (req, res) => {
  const planId = entero(req.params.id);
  if (!planId) return res.status(400).json({ error: "Plan inválido." });

  const cuerpo = req.body || {};
  const cambios = [];
  const valores = [];

  if (cuerpo.nombre !== undefined) {
    const nombre = texto(cuerpo.nombre);
    if (nombre.length < 3 || nombre.length > 120) {
      return res.status(400).json({ error: "El nombre del plan debe tener entre 3 y 120 caracteres." });
    }
    valores.push(nombre);
    cambios.push(`nombre = $${valores.length}`);
  }
  if (cuerpo.descripcion !== undefined) {
    const descripcion = texto(cuerpo.descripcion) || null;
    if (descripcion && descripcion.length > 500) {
      return res.status(400).json({ error: "La descripción no puede pasar de 500 caracteres." });
    }
    valores.push(descripcion);
    cambios.push(`descripcion = $${valores.length}`);
  }
  if (cuerpo.estado !== undefined) {
    if (!["ACTIVO", "CERRADO"].includes(cuerpo.estado)) {
      return res.status(400).json({ error: "Estado inválido (use ACTIVO o CERRADO)." });
    }
    valores.push(cuerpo.estado);
    cambios.push(`estado = $${valores.length}`);
  }
  if (!cambios.length) return res.status(400).json({ error: "No hay nada que cambiar." });

  valores.push(planId);
  try {
    const { rows } = await pool.query(
      `UPDATE planes_atencion SET ${cambios.join(", ")} WHERE id = $${valores.length}
       RETURNING id, nombre, descripcion, version_catalogo, estado, creado_en`,
      valores
    );
    if (!rows.length) return res.status(404).json({ error: "Plan no encontrado." });
    res.json({ plan: rows[0] });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Ya existe un plan con ese nombre." });
    }
    falloInterno(res, err, "No se pudo actualizar el plan.");
  }
});

router.get("/planes/:id", requireAuth, requireRol(...ROLES_GESTION), async (req, res) => {
  const planId = entero(req.params.id);
  if (!planId) return res.status(400).json({ error: "Plan inválido." });

  try {
    const plan = await pool.query(
      "SELECT id, nombre, descripcion, version_catalogo, estado, creado_en FROM planes_atencion WHERE id = $1",
      [planId]
    );
    if (!plan.rows.length) return res.status(404).json({ error: "Plan no encontrado." });

    const { rows } = await pool.query(
      `SELECT pi.inspeccion_id, pi.codigo_dea, pi.enlazado_en, pi.desenlazado_en,
              i.fecha_inspeccion, i.estado, i.origen, i.membrete
       FROM plan_inspecciones pi
       JOIN inspecciones i ON i.id = pi.inspeccion_id
       WHERE pi.plan_id = $1`,
      [planId]
    );

    const planteles = rows
      .map((r) => {
        const m = r.membrete || {};
        return {
          inspeccion_id: r.inspeccion_id,
          codigo_dea: r.codigo_dea,
          nombre_plantel: m.nombre_plantel || "",
          municipio: m.municipio || "",
          parroquia: m.parroquia || "",
          fecha_inspeccion: r.fecha_inspeccion,
          estado: r.estado,
          origen: r.origen,
          enlazado_en: r.enlazado_en,
          desenlazado_en: r.desenlazado_en,
          activo: !r.desenlazado_en,
        };
      })
      .sort((a, b) => Number(b.activo) - Number(a.activo) || a.nombre_plantel.localeCompare(b.nombre_plantel, "es"));

    res.json({ plan: plan.rows[0], planteles });
  } catch (err) {
    falloInterno(res, err, "No se pudo cargar el plan.");
  }
});

// ---------------------------------------------------------------------------
// Búsqueda de planteles (GESCOLAR) para agregarlos a un plan
// ---------------------------------------------------------------------------

router.get("/planteles/buscar", requireAuth, requireRol(...ROLES_GESTION), async (req, res) => {
  const q = texto(req.query.q);
  if (q.length < 2) {
    return res.status(400).json({ error: "Escribe al menos 2 caracteres para buscar." });
  }
  const planId = req.query.plan_id ? entero(req.query.plan_id) : null;

  let encontrados;
  try {
    encontrados = await gescolar.buscarPlanteles(q);
  } catch (err) {
    console.error("Error consultando GESCOLAR:", err);
    return res.status(502).json({ error: "No se pudo consultar la hoja de GESCOLAR. Verifica que esté compartida con la cuenta de servicio." });
  }

  try {
    const codigos = encontrados.planteles.map((p) => String(p.cod_plantel || "").trim()).filter(Boolean);
    const conteo = {};
    const enElPlan = new Set();

    if (codigos.length) {
      const marcas = codigos.map((_, i) => `$${i + 1}`).join(", ");
      const inspecciones = await pool.query(
        `SELECT codigo_dea, COUNT(*)::int AS n FROM inspecciones WHERE codigo_dea IN (${marcas}) GROUP BY codigo_dea`,
        codigos
      );
      inspecciones.rows.forEach((r) => { conteo[r.codigo_dea] = r.n; });

      if (planId) {
        const activos = await pool.query(
          "SELECT codigo_dea FROM plan_inspecciones WHERE plan_id = $1 AND desenlazado_en IS NULL",
          [planId]
        );
        activos.rows.forEach((r) => enElPlan.add(r.codigo_dea));
      }
    }

    res.json({
      total: encontrados.total,
      limitado: encontrados.limitado,
      planteles: encontrados.planteles.map((p) => {
        const codigo = String(p.cod_plantel || "").trim();
        return {
          cod_plantel: codigo,
          nombre_plantel: p.nombre_plantel || "",
          municipio: p.municipio || "",
          parroquia: p.parroquia || "",
          inspecciones: conteo[codigo] || 0,
          en_el_plan: enElPlan.has(codigo),
        };
      }),
    });
  } catch (err) {
    falloInterno(res, err, "No se pudo completar la búsqueda.");
  }
});

// ---------------------------------------------------------------------------
// Planteles del plan
// ---------------------------------------------------------------------------

// Agrega un plantel al plan. Si el plantel ya tiene una inspección "en
// espera" (sin enlace activo en ningún plan), se reutiliza con todas sus
// cantidades; si no, se crea una nueva con el membrete copiado de GESCOLAR.
// Con { nueva: true } se fuerza una inspección nueva.
router.post("/planes/:id/planteles", requireAuth, requireRol(...ROLES_GESTION), async (req, res) => {
  const planId = entero(req.params.id);
  const cuerpo = req.body || {};
  const codigoPedido = texto(cuerpo.codigo_dea);
  const forzarNueva = cuerpo.nueva === true;

  if (!planId) return res.status(400).json({ error: "Plan inválido." });
  if (!CODIGO_DEA.test(codigoPedido)) {
    return res.status(400).json({ error: "Código DEA inválido." });
  }

  try {
    const estado = await estadoDelPlan(planId);
    if (!estado.existe) return res.status(404).json({ error: "Plan no encontrado." });
    if (estado.cerrado) return res.status(409).json({ error: "El plan está cerrado: reábrelo para cambiar sus planteles." });
  } catch (err) {
    return falloInterno(res, err, "No se pudo verificar el plan.");
  }

  let fila;
  try {
    fila = await gescolar.obtenerPlantel(codigoPedido);
  } catch (err) {
    console.error("Error consultando GESCOLAR:", err);
    return res.status(502).json({ error: "No se pudo consultar la hoja de GESCOLAR. Verifica que esté compartida con la cuenta de servicio." });
  }
  if (!fila) {
    return res.status(404).json({ error: `El código ${codigoPedido} no existe en GESCOLAR.` });
  }
  const codigo = String(fila[gescolar.CAMPO_CODIGO]).trim();

  const cliente = await pool.connect();
  try {
    await cliente.query("BEGIN");

    const yaActivo = await cliente.query(
      "SELECT 1 FROM plan_inspecciones WHERE plan_id = $1 AND codigo_dea = $2 AND desenlazado_en IS NULL",
      [planId, codigo]
    );
    if (yaActivo.rows.length) {
      await cliente.query("ROLLBACK");
      return res.status(409).json({ error: "Ese plantel ya está en este plan." });
    }

    let inspeccionId = null;
    let accion = "creada";

    if (!forzarNueva) {
      // Inspecciones de este plantel, de la más reciente a la más vieja...
      const delPlantel = await cliente.query(
        "SELECT id FROM inspecciones WHERE codigo_dea = $1 ORDER BY creado_en DESC, id DESC",
        [codigo]
      );
      if (delPlantel.rows.length) {
        const ids = delPlantel.rows.map((r) => r.id);
        const marcas = ids.map((_, i) => `$${i + 1}`).join(", ");
        // ...y cuáles de ellas están hoy enlazadas (activas) a algún plan.
        const ocupadas = await cliente.query(
          `SELECT DISTINCT inspeccion_id FROM plan_inspecciones
           WHERE desenlazado_en IS NULL AND inspeccion_id IN (${marcas})`,
          ids
        );
        const usadas = new Set(ocupadas.rows.map((r) => r.inspeccion_id));
        // "En espera" = la más reciente que no está activa en ningún plan.
        const libre = ids.find((id) => !usadas.has(id));
        if (libre) {
          inspeccionId = libre;
          accion = "reutilizada";
        }
      }
    }

    if (!inspeccionId) {
      const nueva = await cliente.query(
        `INSERT INTO inspecciones (codigo_dea, membrete, creado_por, actualizado_por)
         VALUES ($1, $2::jsonb, $3, $3)
         RETURNING id`,
        [codigo, JSON.stringify(fila), req.usuario.id]
      );
      inspeccionId = nueva.rows[0].id;
    }

    const previo = await cliente.query(
      "SELECT 1 FROM plan_inspecciones WHERE plan_id = $1 AND inspeccion_id = $2",
      [planId, inspeccionId]
    );
    if (previo.rows.length) {
      await cliente.query(
        `UPDATE plan_inspecciones
         SET desenlazado_en = NULL, desenlazado_por = NULL, enlazado_en = NOW(), enlazado_por = $3
         WHERE plan_id = $1 AND inspeccion_id = $2`,
        [planId, inspeccionId, req.usuario.id]
      );
    } else {
      await cliente.query(
        `INSERT INTO plan_inspecciones (plan_id, inspeccion_id, codigo_dea, enlazado_por)
         VALUES ($1, $2, $3, $4)`,
        [planId, inspeccionId, codigo, req.usuario.id]
      );
    }

    await cliente.query("COMMIT");
    res.status(201).json({ ok: true, accion, inspeccion_id: inspeccionId, codigo_dea: codigo });
  } catch (err) {
    await cliente.query("ROLLBACK").catch(() => {});
    if (err.code === "23505") {
      return res.status(409).json({ error: "Ese plantel ya está en este plan." });
    }
    falloInterno(res, err, "No se pudo agregar el plantel al plan.");
  } finally {
    cliente.release();
  }
});

// Desenlaza el plantel del plan. No borra nada: la inspección y sus
// cantidades quedan en la base de datos, en espera.
router.post("/planes/:id/planteles/:inspeccionId/desenlazar", requireAuth, requireRol(...ROLES_GESTION), async (req, res) => {
  const planId = entero(req.params.id);
  const inspeccionId = entero(req.params.inspeccionId);
  if (!planId || !inspeccionId) return res.status(400).json({ error: "Datos inválidos." });

  try {
    const estado = await estadoDelPlan(planId);
    if (!estado.existe) return res.status(404).json({ error: "Plan no encontrado." });
    if (estado.cerrado) return res.status(409).json({ error: "El plan está cerrado: reábrelo para cambiar sus planteles." });

    const { rows } = await pool.query(
      `UPDATE plan_inspecciones
       SET desenlazado_en = NOW(), desenlazado_por = $3
       WHERE plan_id = $1 AND inspeccion_id = $2 AND desenlazado_en IS NULL
       RETURNING codigo_dea`,
      [planId, inspeccionId, req.usuario.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Ese plantel no está enlazado a este plan." });
    res.json({ ok: true, codigo_dea: rows[0].codigo_dea });
  } catch (err) {
    falloInterno(res, err, "No se pudo desenlazar el plantel.");
  }
});

// Vuelve a enlazar un plantel que se había desenlazado de este plan.
router.post("/planes/:id/planteles/:inspeccionId/reenlazar", requireAuth, requireRol(...ROLES_GESTION), async (req, res) => {
  const planId = entero(req.params.id);
  const inspeccionId = entero(req.params.inspeccionId);
  if (!planId || !inspeccionId) return res.status(400).json({ error: "Datos inválidos." });

  try {
    const estado = await estadoDelPlan(planId);
    if (!estado.existe) return res.status(404).json({ error: "Plan no encontrado." });
    if (estado.cerrado) return res.status(409).json({ error: "El plan está cerrado: reábrelo para cambiar sus planteles." });

    // Una inspección solo puede estar activa en UN plan a la vez; si no, al
    // cambiar sus cantidades se moverían los consolidados de dos planes.
    const enOtroPlan = await pool.query(
      `SELECT p.nombre FROM plan_inspecciones pi
       JOIN planes_atencion p ON p.id = pi.plan_id
       WHERE pi.inspeccion_id = $1 AND pi.desenlazado_en IS NULL AND pi.plan_id <> $2`,
      [inspeccionId, planId]
    );
    if (enOtroPlan.rows.length) {
      return res.status(409).json({ error: `Esa inspección está activa en el plan "${enOtroPlan.rows[0].nombre}": desenlázala de allí primero.` });
    }

    const { rows } = await pool.query(
      `UPDATE plan_inspecciones
       SET desenlazado_en = NULL, desenlazado_por = NULL, enlazado_en = NOW(), enlazado_por = $3
       WHERE plan_id = $1 AND inspeccion_id = $2 AND desenlazado_en IS NOT NULL
       RETURNING codigo_dea`,
      [planId, inspeccionId, req.usuario.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Ese plantel no estaba desenlazado de este plan." });
    res.json({ ok: true, codigo_dea: rows[0].codigo_dea });
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "Ese plantel ya está en este plan con otra inspección." });
    }
    falloInterno(res, err, "No se pudo volver a enlazar el plantel.");
  }
});

module.exports = router;
