// inspecciones.js — módulo de Inspecciones y listados de materiales (SID).
// Etapa 1: planes de atención y planteles de cada plan.
// Etapa 2: planilla de materiales de cada plantel (lista oficial) y consolidado del plan.
//
// Rutas montadas en /api/inspecciones:
//   GET   /ingenieros                               cuentas de ingeniero activas (para asignar)
//   GET   /planes/:id/registro-gescolar             vista previa: qué se escribiría en PLAN REHABILITACION de GESCOLAR (solo admin)
//   POST  /planes/:id/registro-gescolar             escribe el nombre del plan en PLAN REHABILITACION de sus planteles activos (solo admin)
//   GET   /responsables                             ingenieros que ya figuran como RESPONSABLE en GESCOLAR (con su conteo)
//   PUT   /inspeccion/:id/asignaciones              asignar a una planilla: responsable (se escribe en GESCOLAR) y/o cuentas con acceso
//   GET   /dashboard                                cifras de la pantalla principal (atendidos, con inspección, por tipo y municipio)
//   GET   /mis-planillas                            las planillas asignadas al ingeniero en sesión
//   GET   /resumen-ingenieros                       ingenieros (columna RESPONSABLE de GESCOLAR) y planteles inspeccionados
//   GET   /planes                                   lista de planes
//   POST  /planes                                   crear plan
//   PATCH /planes/:id                               editar nombre/descripción/estado
//   GET   /planes/:id                               un plan con sus planteles
//   GET   /planteles/buscar?q=&plan_id=             buscar plantel en GESCOLAR
//   POST  /planes/:id/planteles                     agregar plantel al plan
//   POST  /planes/:id/planteles/:inspeccionId/desenlazar
//   POST  /planes/:id/planteles/:inspeccionId/reenlazar
//   GET   /inspeccion/:id                           planilla: membrete, ingenieros y los 163 rubros con sus cantidades
//   PATCH /inspeccion/:id                           fecha, observaciones, estado, ingenieros y datos del plantel (membrete)
//   PUT   /inspeccion/:id/materiales                guardar cantidades (solo las que cambiaron)
//   GET   /planes/:id/consolidado                   consolidado oficial del plan
//   GET   /adicionales                              catálogo de adicionales (autocompletado)
//   POST  /adicionales                              proponer un material adicional nuevo
//   PATCH /adicionales/:id   y  POST .../unificar   (admin) aprobar, retirar, renombrar, unificar
//   PUT   /inspeccion/:id/adicionales               cantidades de adicionales de un plantel
//   GET   /planes/:id/consolidado-adicionales       consolidado de adicionales del plan
//   GET   /planes/:id/consolidado.xlsx              descarga Excel del consolidado oficial
//   GET   /planes/:id/consolidado-adicionales.xlsx  descarga Excel del consolidado de adicionales
//   GET   /inspeccion/:id/planilla.xlsx             descarga Excel de la planilla individual
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

// Perfiles del módulo. El middleware (middleware/auth.js) además encierra a los
// usuarios insp_* dentro de /api/inspecciones: no pueden usar el resto del sistema.
//   admin             todo, incluida la aprobación y unificación de adicionales
//   insp_coordinador  arma planes, enlaza planteles, asigna ingenieros, consolidados y Excel
//   insp_ingeniero    llena SOLO las planillas que se le asignaron
//   insp_consulta     solo ve planes y consolidados y descarga Excel
//   operador_plantel  igual que insp_consulta (solo lectura)
const ROLES_GESTION = ["admin", "insp_coordinador"];                                           // planes, planteles, asignaciones
const ROLES_ESCRIBE = ["admin", "insp_coordinador", "insp_ingeniero"];                         // guardar planillas y proponer adicionales
const ROLES_LECTURA = ["admin", "operador_plantel", "insp_coordinador", "insp_consulta"];      // ver planes y consolidados, descargar Excel
const ROLES_PLANILLA = [...ROLES_LECTURA, "insp_ingeniero"];                                   // abrir una planilla (el ingeniero, solo las suyas)
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

// Un ingeniero solo puede abrir y editar las planillas que se le asignaron.
// Los demás perfiles pasan (sus permisos ya los filtró requireRol).
async function accesoInspeccion(req, res, next) {
  if (req.usuario.rol !== "insp_ingeniero") return next();
  const id = entero(req.params.id);
  if (!id) return res.status(400).json({ error: "Inspección inválida." });
  try {
    const { rows } = await pool.query(
      "SELECT 1 FROM inspeccion_asignaciones WHERE inspeccion_id = $1 AND usuario_id = $2",
      [id, req.usuario.id]
    );
    if (!rows.length) return res.status(403).json({ error: "Esta planilla no está asignada a tu usuario." });
    return next();
  } catch (err) {
    return falloInterno(res, err, "No se pudo verificar el acceso a la planilla.");
  }
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

router.get("/planes", requireAuth, requireRol(...ROLES_LECTURA), async (req, res) => {
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

router.get("/planes/:id", requireAuth, requireRol(...ROLES_LECTURA), async (req, res) => {
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
              i.fecha_inspeccion::text AS fecha_inspeccion, i.estado, i.origen, i.membrete
       FROM plan_inspecciones pi
       JOIN inspecciones i ON i.id = pi.inspeccion_id
       WHERE pi.plan_id = $1`,
      [planId]
    );

    const asignados = {};
    if (rows.length) {
      const asig = await pool.query(
        `SELECT a.inspeccion_id, u.id, u.nombre
         FROM inspeccion_asignaciones a JOIN usuarios u ON u.id = a.usuario_id
         WHERE a.inspeccion_id = ANY($1::int[]) ORDER BY u.nombre`,
        [rows.map((r) => r.inspeccion_id)]
      );
      asig.rows.forEach((a) => { (asignados[a.inspeccion_id] = asignados[a.inspeccion_id] || []).push({ id: a.id, nombre: a.nombre }); });
    }

    // Responsable según GESCOLAR (dato vivo; si la hoja no responde, simplemente no se muestra).
    const responsables = {};
    try {
      (await gescolar.cargarGescolar()).forEach((p) => {
        const nombre = limpiarTexto(p.RESPONSABLE);
        if (nombre && !SIN_RESPONSABLE.test(nombre)) responsables[limpiarTexto(p[gescolar.CAMPO_CODIGO]).toLowerCase()] = nombre;
      });
    } catch (err) {
      console.error("No se pudo leer RESPONSABLE de GESCOLAR para el plan:", err.message);
    }

    const planteles = rows
      .map((r) => {
        const m = r.membrete || {};
        return {
          responsable: responsables[String(r.codigo_dea || "").trim().toLowerCase()] || null,
          ingenieros: asignados[r.inspeccion_id] || [],
          inspeccion_id: r.inspeccion_id,
          codigo_dea: r.codigo_dea,
          nombre_plantel: nombreEfectivo(m),
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

// Desenlaza el plantel del plan. No borra nada: la inspección y sus cantidades quedan en la base
// de datos, en espera. Además quita el nombre del plan de la columna PLAN REHABILITACION de GESCOLAR
// (solo si esa celda tiene justo el nombre de este plan; TIPO ATENCION no se toca). Si GESCOLAR no
// responde, NO se desenlaza (para que la hoja y el sistema no queden distintos): se puede reintentar.
router.post("/planes/:id/planteles/:inspeccionId/desenlazar", requireAuth, requireRol(...ROLES_GESTION), async (req, res) => {
  const planId = entero(req.params.id);
  const inspeccionId = entero(req.params.inspeccionId);
  if (!planId || !inspeccionId) return res.status(400).json({ error: "Datos inválidos." });

  try {
    const estado = await estadoDelPlan(planId);
    if (!estado.existe) return res.status(404).json({ error: "Plan no encontrado." });
    if (estado.cerrado) return res.status(409).json({ error: "El plan está cerrado: reábrelo para cambiar sus planteles." });

    const previo = await pool.query(
      `SELECT pi.codigo_dea, p.nombre
       FROM plan_inspecciones pi JOIN planes_atencion p ON p.id = pi.plan_id
       WHERE pi.plan_id = $1 AND pi.inspeccion_id = $2 AND pi.desenlazado_en IS NULL`,
      [planId, inspeccionId]
    );
    if (!previo.rows.length) return res.status(404).json({ error: "Ese plantel no está enlazado a este plan." });
    const { codigo_dea: codigo, nombre: nombrePlan } = previo.rows[0];

    let gs;
    try {
      gs = await gescolar.limpiarPlanSiCoincide(codigo, nombrePlan);
    } catch (err) {
      console.error("No se pudo actualizar PLAN REHABILITACION en GESCOLAR al desenlazar:", err.message);
      return res.status(502).json({ error: "No se pudo actualizar GESCOLAR (Google Sheets no respondió). El plantel NO se desenlazó; intenta de nuevo en un momento." });
    }
    if (gs.estado === "limpiado") console.log(`PLAN REHABILITACION de GESCOLAR: ${codigo} "${gs.anterior}" → (vacío) por desenlazar (usuario ${req.usuario.id}).`);

    const { rows } = await pool.query(
      `UPDATE plan_inspecciones
       SET desenlazado_en = NOW(), desenlazado_por = $3
       WHERE plan_id = $1 AND inspeccion_id = $2 AND desenlazado_en IS NULL
       RETURNING codigo_dea`,
      [planId, inspeccionId, req.usuario.id]
    );
    if (!rows.length) return res.status(404).json({ error: "Ese plantel no está enlazado a este plan." });
    res.json({ ok: true, codigo_dea: rows[0].codigo_dea, gescolar: gs.estado });
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

// ---------------------------------------------------------------------------
// Planilla de materiales de una inspección (etapa 2)
// ---------------------------------------------------------------------------

const MAX_INSPECTORES = 5;
const REGEX_CANTIDAD = /^\d{1,11}(\.\d{1,3})?$/; // hasta 3 decimales; NO se redondea nada
const REGEX_FECHA = /^\d{4}-\d{2}-\d{2}$/;

// Planes en los que la inspección está enlazada hoy (activos).
async function planesActivosDeInspeccion(inspeccionId) {
  const { rows } = await pool.query(
    `SELECT p.id, p.nombre, p.estado, p.version_catalogo
     FROM plan_inspecciones pi
     JOIN planes_atencion p ON p.id = pi.plan_id
     WHERE pi.inspeccion_id = $1 AND pi.desenlazado_en IS NULL
     ORDER BY p.id`,
    [inspeccionId]
  );
  return rows;
}

// Convierte lo que escribió la persona ("0,5", "12", "") en un texto
// canónico ("0.5", "12") o null si está vacío. Lanza Error si es inválido.
function cantidadCanonica(valor) {
  if (valor === null || valor === undefined) return null;
  const crudo = String(valor).trim().replace(",", ".");
  if (crudo === "") return null;
  if (!REGEX_CANTIDAD.test(crudo)) {
    throw new Error(`Cantidad inválida: «${String(valor).slice(0, 20)}». Usa números positivos, con coma o punto, hasta 3 decimales.`);
  }
  return String(Number(crudo));
}

// ---------------------------------------------------------------------------
// Datos del plantel en el encabezado de la planilla (membrete)
// ---------------------------------------------------------------------------
// Vienen precargados de GESCOLAR (copiados al crear la inspección) y se pueden
// corregir. Lo corregido se guarda aparte, en membrete.planilla, y NO toca la
// copia de GESCOLAR: así siempre se puede "restablecer desde GESCOLAR".

// clave del formulario → { etiqueta, candidatos de columna en GESCOLAR, largo máximo }
const CAMPOS_PLANTEL = [
  { clave: "institucion", max: 200, candidatos: ["nombre_plantel"] },
  { clave: "aulas",       max: 20,  candidatos: ["cant_aulas", "nro_aulas", "numero_aulas", "num_aulas", "cantidad_aulas", "total_aulas", "aulas"] },
  { clave: "matricula",   max: 20,  candidatos: ["total_matricula_registrada", "matricula_total", "total_matricula", "matricula"], contiene: ["matricula", "total"] },
  { clave: "director",    max: 200, candidatos: ["director_nombre"] },
  { clave: "telefono",    max: 60,  candidatos: ["telefono_movil_director", "telefono_director"], telefono: true },
  { clave: "parroquia",   max: 120, candidatos: ["parroquia"] },
  { clave: "municipio",   max: 120, candidatos: ["municipio"] },
  { clave: "direccion",   max: 300, candidatos: ["direccion", "direccion_plantel", "direccion_del_plantel"], empieza: "direccion" },
  { clave: "comuna",      max: 200, candidatos: ["nomb_circuito"] }, // la comuna equivale al circuito comunal de GESCOLAR
  { clave: "comunidad",   max: 200, candidatos: [] },
];

// GESCOLAR llega con la codificación dañada en algunas celdas (UTF-8 leído como
// Windows-1252: «PIÃ‘AS» en vez de «PIÑAS»). Esto lo devuelve a su forma correcta;
// si el texto no tiene ese daño, lo deja tal cual.
const CP1252_ESPECIALES = {
  0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88,
  0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93,
  0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B,
  0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F,
};
function arreglarCodificacion(texto) {
  if (typeof texto !== "string" || !/[\u00C3\u00C2]/.test(texto)) return texto;
  const bytes = [];
  for (const ch of texto) {
    const c = ch.codePointAt(0);
    if (c < 256) bytes.push(c);
    else if (CP1252_ESPECIALES[c] !== undefined) bytes.push(CP1252_ESPECIALES[c]);
    else return texto;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
  } catch (_) {
    return texto;
  }
}

// GESCOLAR trae los celulares sin el 0 inicial (4167285103) y algunos teléfonos
// de relleno (0, 2920000000). Devuelve 0416-7285103, o "" si es de relleno.
function formatearTelefono(valor) {
  const digitos = String(valor === undefined || valor === null ? "" : valor).replace(/\D/g, "");
  if (!digitos || /^0+$/.test(digitos) || /0000000$/.test(digitos)) return "";
  const d = digitos.length === 10 ? "0" + digitos : digitos;
  return d.length === 11 ? `${d.slice(0, 4)}-${d.slice(4)}` : String(valor).trim();
}

function normalizarClave(k) {
  return String(arreglarCodificacion(String(k))).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function valorGescolar(membrete, campo) {
  const m = membrete || {};
  const porNombre = {};
  Object.keys(m).forEach((k) => { porNombre[normalizarClave(k)] = m[k]; });
  const limpio = (v) => (v === undefined || v === null ? "" : arreglarCodificacion(String(v).trim()));
  for (const c of campo.candidatos) {
    const v = campo.telefono ? formatearTelefono(porNombre[c]) : limpio(porNombre[c]);
    if (v) return v;
  }
  if (campo.contiene) {
    const k = Object.keys(porNombre).find((n) => campo.contiene.every((t) => n.includes(t)) && limpio(porNombre[n]));
    if (k) return limpio(porNombre[k]);
  }
  if (campo.empieza) {
    const k = Object.keys(porNombre).find((n) => n.startsWith(campo.empieza) && limpio(porNombre[n]));
    if (k) return limpio(porNombre[k]);
  }
  return "";
}

// Lo que dice GESCOLAR para cada campo del formulario.
function datosDeGescolar(membrete) {
  const r = {};
  CAMPOS_PLANTEL.forEach((c) => { r[c.clave] = valorGescolar(membrete, c); });
  return r;
}

// Lo que se muestra: lo corregido a mano si existe; si no, lo de GESCOLAR.
function datosEfectivos(membrete) {
  const base = datosDeGescolar(membrete);
  const editado = (membrete && membrete.planilla) || {};
  const r = {};
  CAMPOS_PLANTEL.forEach((c) => {
    r[c.clave] = Object.prototype.hasOwnProperty.call(editado, c.clave) ? String(editado[c.clave]) : base[c.clave];
  });
  return r;
}

function nombreEfectivo(membrete, respaldo) {
  return datosEfectivos(membrete).institucion || respaldo || "";
}

// Arma la planilla completa de una inspección (la usan la pantalla y la descarga
// en Excel). Devuelve null si la inspección no existe.
async function armarPlanilla(id) {
  const cabecera = await pool.query(
    `SELECT id, codigo_dea, fecha_inspeccion::text AS fecha_inspeccion, estado, origen,
            observaciones, membrete, actualizado_en
     FROM inspecciones WHERE id = $1`,
    [id]
  );
  if (!cabecera.rows.length) return null;
  const i = cabecera.rows[0];

  const inspectores = await pool.query(
    "SELECT orden, nombre FROM inspeccion_inspectores WHERE inspeccion_id = $1 ORDER BY orden",
    [id]
  );
  const planes = await planesActivosDeInspeccion(id);
  const version = planes.length ? planes[0].version_catalogo : "LISTA2";

  const rubros = await pool.query(
    `SELECT m.id, m.codigo, m.nro_lista, m.capitulo, m.rubro, m.unidad, im.cantidad
     FROM catalogo_materiales m
     LEFT JOIN inspeccion_materiales im ON im.material_id = m.id AND im.inspeccion_id = $1
     WHERE m.lista = $2 AND m.activo = TRUE
     ORDER BY m.nro_lista`,
    [id, version]
  );

  const adic = await pool.query(
    `SELECT ia.adicional_id, ia.cantidad, COALESCE(t.nombre, a.nombre) AS nombre, COALESCE(t.unidad, a.unidad) AS unidad,
            COALESCE(t.estado, a.estado) AS estado
     FROM inspeccion_adicionales ia
     JOIN adicionales_catalogo a ON a.id = ia.adicional_id
     LEFT JOIN adicionales_catalogo t ON t.id = a.unificado_en
     WHERE ia.inspeccion_id = $1`,
    [id]
  );
  const adicionales = adic.rows
    .map((r) => ({
      adicional_id: r.adicional_id,
      nombre: r.nombre,
      unidad: r.unidad || "",
      estado: r.estado,
      cantidad: r.cantidad === null ? null : Number(r.cantidad),
    }))
    .sort((x, y) => x.nombre.localeCompare(y.nombre, "es"));

  return {
    adicionales,
    inspeccion: {
      id: i.id,
      codigo_dea: i.codigo_dea,
      fecha_inspeccion: i.fecha_inspeccion,
      estado: i.estado,
      origen: i.origen,
      observaciones: i.observaciones || "",
      membrete: i.membrete || {},
      datos_plantel: datosEfectivos(i.membrete),
      datos_gescolar: datosDeGescolar(i.membrete),
      actualizado_en: i.actualizado_en,
      inspectores: inspectores.rows.map((r) => r.nombre),
      planes: planes.map((p) => ({ id: p.id, nombre: p.nombre, estado: p.estado })),
    },
    version_catalogo: version,
    rubros: rubros.rows.map((r) => ({
      id: r.id,
      codigo: r.codigo,
      nro: r.nro_lista,
      capitulo: r.capitulo,
      rubro: r.rubro,
      unidad: r.unidad || "",
      cantidad: r.cantidad === null ? null : Number(r.cantidad),
    })),
  };
}

router.get("/inspeccion/:id", requireAuth, requireRol(...ROLES_PLANILLA), accesoInspeccion, async (req, res) => {
  const id = entero(req.params.id);
  if (!id) return res.status(400).json({ error: "Inspección inválida." });
  try {
    const planilla = await armarPlanilla(id);
    if (!planilla) return res.status(404).json({ error: "Inspección no encontrada." });
    // La pantalla usa esto para mostrar la planilla en solo lectura a quien no puede editar.
    planilla.permisos = { editar: ROLES_ESCRIBE.includes(req.usuario.rol) };
    res.json(planilla);
  } catch (err) {
    falloInterno(res, err, "No se pudo cargar la planilla.");
  }
});

// Datos de cabecera: fecha, observaciones, estado e ingenieros (el primero
// es el responsable principal).
router.patch("/inspeccion/:id", requireAuth, requireRol(...ROLES_ESCRIBE), accesoInspeccion, async (req, res) => {
  const id = entero(req.params.id);
  if (!id) return res.status(400).json({ error: "Inspección inválida." });
  const cuerpo = req.body || {};

  const cambios = [];
  const valores = [];
  let inspectores = null;

  if (cuerpo.fecha_inspeccion !== undefined) {
    const f = cuerpo.fecha_inspeccion;
    if (f === null || f === "") {
      valores.push(null);
    } else {
      const fecha = texto(f);
      const real = new Date(`${fecha}T00:00:00Z`);
      if (!REGEX_FECHA.test(fecha) || Number.isNaN(real.getTime()) || real.toISOString().slice(0, 10) !== fecha) {
        return res.status(400).json({ error: "Fecha inválida (use AAAA-MM-DD)." });
      }
      valores.push(fecha);
    }
    cambios.push(`fecha_inspeccion = $${valores.length}`);
  }
  if (cuerpo.observaciones !== undefined) {
    const obs = texto(cuerpo.observaciones) || null;
    if (obs && obs.length > 1000) return res.status(400).json({ error: "Las observaciones no pueden pasar de 1000 caracteres." });
    valores.push(obs);
    cambios.push(`observaciones = $${valores.length}`);
  }
  if (cuerpo.estado !== undefined) {
    if (!["BORRADOR", "CARGADA"].includes(cuerpo.estado)) {
      return res.status(400).json({ error: "Estado inválido (use BORRADOR o CARGADA)." });
    }
    valores.push(cuerpo.estado);
    cambios.push(`estado = $${valores.length}`);
  }
  if (cuerpo.inspectores !== undefined) {
    if (!Array.isArray(cuerpo.inspectores)) return res.status(400).json({ error: "Los ingenieros deben enviarse como una lista." });
    inspectores = cuerpo.inspectores.map(texto).filter(Boolean);
    if (inspectores.length > MAX_INSPECTORES) {
      return res.status(400).json({ error: `Máximo ${MAX_INSPECTORES} ingenieros por inspección.` });
    }
    if (inspectores.some((n) => n.length > 120)) {
      return res.status(400).json({ error: "Cada nombre puede tener hasta 120 caracteres." });
    }
  }
  let datosPlantel = null; // { clave: texto } con los campos que vienen en la solicitud
  if (cuerpo.datos_plantel !== undefined) {
    const dp = cuerpo.datos_plantel;
    if (dp !== null && (typeof dp !== "object" || Array.isArray(dp))) {
      return res.status(400).json({ error: "Los datos del plantel deben enviarse como un objeto." });
    }
    datosPlantel = {};
    for (const [clave, valor] of Object.entries(dp || {})) {
      const campo = CAMPOS_PLANTEL.find((c) => c.clave === clave);
      if (!campo) return res.status(400).json({ error: `Dato de plantel desconocido: ${String(clave).slice(0, 30)}.` });
      if (typeof valor !== "string" && typeof valor !== "number") return res.status(400).json({ error: "Los datos del plantel deben ser texto." });
      const t = String(valor).trim();
      if (t.length > campo.max) return res.status(400).json({ error: `El dato «${clave}» no puede pasar de ${campo.max} caracteres.` });
      datosPlantel[clave] = t;
    }
    datosPlantel.__restablecer = dp === null; // null = volver todo a lo de GESCOLAR
  }
  if (!cambios.length && inspectores === null && datosPlantel === null) return res.status(400).json({ error: "No hay nada que cambiar." });

  let cliente;
  try {
    const existe = await pool.query("SELECT 1 FROM inspecciones WHERE id = $1", [id]);
    if (!existe.rows.length) return res.status(404).json({ error: "Inspección no encontrada." });
    const cerrado = (await planesActivosDeInspeccion(id)).find((p) => p.estado === "CERRADO");
    if (cerrado) return res.status(409).json({ error: `El plan «${cerrado.nombre}» está cerrado: reábrelo para modificar la planilla.` });

    let membreteNuevo = null;
    if (datosPlantel !== null) {
      const actual = await pool.query("SELECT membrete FROM inspecciones WHERE id = $1", [id]);
      const membrete = Object.assign({}, actual.rows[0].membrete || {});
      const deGescolar = datosDeGescolar(membrete);
      const editado = datosPlantel.__restablecer ? {} : Object.assign({}, membrete.planilla || {});
      Object.keys(datosPlantel).forEach((clave) => {
        if (clave === "__restablecer") return;
        // Si queda igual a GESCOLAR no hace falta guardar la corrección.
        if (datosPlantel[clave] === deGescolar[clave]) delete editado[clave];
        else editado[clave] = datosPlantel[clave];
      });
      if (Object.keys(editado).length) membrete.planilla = editado; else delete membrete.planilla;
      membreteNuevo = membrete;
    }

    cliente = await pool.connect();
    await cliente.query("BEGIN");
    if (membreteNuevo !== null) {
      valores.push(JSON.stringify(membreteNuevo));
      cambios.push(`membrete = $${valores.length}::jsonb`);
    }
    valores.push(req.usuario.id);
    cambios.push(`actualizado_por = $${valores.length}`);
    cambios.push("actualizado_en = NOW()");
    valores.push(id);
    await cliente.query(`UPDATE inspecciones SET ${cambios.join(", ")} WHERE id = $${valores.length}`, valores);

    if (inspectores !== null) {
      await cliente.query("DELETE FROM inspeccion_inspectores WHERE inspeccion_id = $1", [id]);
      for (let k = 0; k < inspectores.length; k++) {
        await cliente.query(
          "INSERT INTO inspeccion_inspectores (inspeccion_id, orden, nombre) VALUES ($1, $2, $3)",
          [id, k + 1, inspectores[k]]
        );
      }
    }
    await cliente.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    if (cliente) await cliente.query("ROLLBACK").catch(() => {});
    falloInterno(res, err, "No se pudo guardar la cabecera.");
  } finally {
    if (cliente) cliente.release();
  }
});

// Guarda cantidades. Recibe SOLO las que cambiaron: { cantidades: { "<id del rubro>": "0,5" | "" } }.
// Vacío = quitar la cantidad. No se redondea nada: se guardan hasta 3 decimales.
router.put("/inspeccion/:id/materiales", requireAuth, requireRol(...ROLES_ESCRIBE), accesoInspeccion, async (req, res) => {
  const id = entero(req.params.id);
  if (!id) return res.status(400).json({ error: "Inspección inválida." });
  const entradas = Object.entries((req.body && req.body.cantidades) || {});
  if (!entradas.length) return res.status(400).json({ error: "No hay cantidades para guardar." });
  if (entradas.length > 400) return res.status(400).json({ error: "Demasiadas cantidades en una sola solicitud." });

  const guardar = []; // [materialId, textoCanonico]
  const borrar = [];  // materialId
  try {
    for (const [clave, valor] of entradas) {
      const materialId = entero(clave);
      if (!materialId) return res.status(400).json({ error: "Rubro inválido." });
      const c = cantidadCanonica(valor);
      if (c === null) borrar.push(materialId); else guardar.push([materialId, c]);
    }
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  let cliente;
  try {
    const existe = await pool.query("SELECT 1 FROM inspecciones WHERE id = $1", [id]);
    if (!existe.rows.length) return res.status(404).json({ error: "Inspección no encontrada." });
    const cerrado = (await planesActivosDeInspeccion(id)).find((p) => p.estado === "CERRADO");
    if (cerrado) return res.status(409).json({ error: `El plan «${cerrado.nombre}» está cerrado: reábrelo para modificar las cantidades.` });

    // Todos los rubros deben existir en el catálogo.
    const todos = [...guardar.map((g) => g[0]), ...borrar];
    const marcas = todos.map((_, i) => `$${i + 1}`).join(", ");
    const validos = await pool.query(`SELECT id FROM catalogo_materiales WHERE id IN (${marcas})`, todos);
    if (validos.rows.length !== new Set(todos).size) {
      return res.status(400).json({ error: "Hay rubros que no existen en el catálogo." });
    }

    cliente = await pool.connect();
    await cliente.query("BEGIN");

    if (borrar.length) {
      const m = borrar.map((_, i) => `$${i + 2}`).join(", ");
      await cliente.query(`DELETE FROM inspeccion_materiales WHERE inspeccion_id = $1 AND material_id IN (${m})`, [id, ...borrar]);
    }
    if (guardar.length) {
      const parametros = [id, req.usuario.id];
      const filas = guardar.map(([materialId, c]) => {
        parametros.push(materialId, c);
        return `($1, $${parametros.length - 1}, $${parametros.length}, $2)`;
      });
      await cliente.query(
        `INSERT INTO inspeccion_materiales (inspeccion_id, material_id, cantidad, actualizado_por)
         VALUES ${filas.join(", ")}
         ON CONFLICT (inspeccion_id, material_id)
         DO UPDATE SET cantidad = EXCLUDED.cantidad, actualizado_por = EXCLUDED.actualizado_por, actualizado_en = NOW()`,
        parametros
      );
    }
    await cliente.query("UPDATE inspecciones SET actualizado_por = $2, actualizado_en = NOW() WHERE id = $1", [id, req.usuario.id]);
    await cliente.query("COMMIT");
    res.json({ ok: true, guardadas: guardar.length, quitadas: borrar.length });
  } catch (err) {
    if (cliente) await cliente.query("ROLLBACK").catch(() => {});
    falloInterno(res, err, "No se pudieron guardar las cantidades.");
  } finally {
    if (cliente) cliente.release();
  }
});

// ---------------------------------------------------------------------------
// Consolidado oficial del plan (se calcula al momento; nunca se guarda)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Materiales adicionales (los que agregan los ingenieros fuera de la lista oficial)
// ---------------------------------------------------------------------------
// Cada material tiene un nombre ÚNICO y puede tener alias (otros nombres con los
// que lo escriben). Los nuevos nacen PENDIENTE y los aprueba o unifica el
// administrador. Un material unificado se suma junto con el oficial.

const ESTADOS_ADICIONAL = ["ACTIVO", "PENDIENTE", "RETIRADO"];

// Catálogo completo con alias (pequeño: unos cientos). Se usa para el autocompletado.
async function listarAdicionales({ todos }) {
  const { rows } = await pool.query(
    `SELECT a.id, a.nombre, a.unidad, a.estado, a.unificado_en,
            COALESCE(json_agg(al.alias ORDER BY al.alias) FILTER (WHERE al.id IS NOT NULL), '[]'::json) AS alias,
            (SELECT COUNT(*) FROM inspeccion_adicionales ia WHERE ia.adicional_id = a.id AND ia.cantidad > 0) AS usos
     FROM adicionales_catalogo a
     LEFT JOIN adicional_alias al ON al.adicional_id = a.id
     GROUP BY a.id
     ORDER BY UPPER(a.nombre)`
  );
  const lista = rows.map((r) => ({
    id: r.id,
    nombre: r.nombre,
    unidad: r.unidad || "",
    estado: r.estado,
    unificado_en: r.unificado_en,
    alias: r.alias || [],
    usos: Number(r.usos),
  }));
  return todos ? lista : lista.filter((m) => !m.unificado_en && m.estado !== "RETIRADO");
}

// ¿Ya existe un material con ese nombre (o alias), sin importar mayúsculas, acentos o signos?
function buscarDuplicado(catalogo, nombre) {
  const k = normalizarClave(nombre);
  return catalogo.find((m) => normalizarClave(m.nombre) === k || m.alias.some((a) => normalizarClave(a) === k)) || null;
}

router.get("/adicionales", requireAuth, requireRol(...ROLES_PLANILLA), async (req, res) => {
  try {
    const todos = req.query.todos === "1" && req.usuario.rol === "admin";
    res.json({ adicionales: await listarAdicionales({ todos }) });
  } catch (err) {
    falloInterno(res, err, "No se pudo cargar el catálogo de adicionales.");
  }
});

router.post("/adicionales", requireAuth, requireRol(...ROLES_ESCRIBE), async (req, res) => {
  const cuerpo = req.body || {};
  const nombre = texto(cuerpo.nombre).replace(/\s+/g, " ");
  const unidad = texto(cuerpo.unidad).replace(/\s+/g, " ").toUpperCase();
  if (nombre.length < 3 || nombre.length > 200) return res.status(400).json({ error: "El nombre del material debe tener entre 3 y 200 caracteres." });
  if (!unidad || unidad.length > 20) return res.status(400).json({ error: "Indica la unidad del material (máximo 20 caracteres)." });

  try {
    const catalogo = await listarAdicionales({ todos: true });
    const repetido = buscarDuplicado(catalogo, nombre);
    if (repetido) {
      return res.status(409).json({
        error: `Ese material ya existe: «${repetido.nombre}». Búscalo en la lista y selecciónalo.`,
        existente: { id: repetido.unificado_en || repetido.id, nombre: repetido.nombre },
      });
    }
    const estado = req.usuario.rol === "admin" ? "ACTIVO" : "PENDIENTE";
    const { rows } = await pool.query(
      `INSERT INTO adicionales_catalogo (nombre, unidad, estado, propuesto_por)
       VALUES ($1, $2, $3, $4) RETURNING id, nombre, unidad, estado`,
      [nombre, unidad, estado, req.usuario.id]
    );
    res.status(201).json({ adicional: Object.assign(rows[0], { alias: [], usos: 0 }) });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "Ya existe un material con ese nombre." });
    falloInterno(res, err, "No se pudo crear el material.");
  }
});

// Cambiar nombre, unidad o estado (solo administrador).
router.patch("/adicionales/:id", requireAuth, requireRol("admin"), async (req, res) => {
  const id = entero(req.params.id);
  if (!id) return res.status(400).json({ error: "Material inválido." });
  const cuerpo = req.body || {};
  const cambios = [];
  const valores = [];
  if (cuerpo.nombre !== undefined) {
    const nombre = texto(cuerpo.nombre).replace(/\s+/g, " ");
    if (nombre.length < 3 || nombre.length > 200) return res.status(400).json({ error: "El nombre del material debe tener entre 3 y 200 caracteres." });
    valores.push(nombre); cambios.push(`nombre = $${valores.length}`);
  }
  if (cuerpo.unidad !== undefined) {
    const unidad = texto(cuerpo.unidad).replace(/\s+/g, " ").toUpperCase();
    if (!unidad || unidad.length > 20) return res.status(400).json({ error: "La unidad no puede estar vacía (máximo 20 caracteres)." });
    valores.push(unidad); cambios.push(`unidad = $${valores.length}`);
  }
  if (cuerpo.estado !== undefined) {
    if (!ESTADOS_ADICIONAL.includes(cuerpo.estado)) return res.status(400).json({ error: "Estado inválido." });
    valores.push(cuerpo.estado); cambios.push(`estado = $${valores.length}`);
  }
  if (!cambios.length) return res.status(400).json({ error: "No hay nada que cambiar." });
  try {
    if (cuerpo.nombre !== undefined) {
      const catalogo = await listarAdicionales({ todos: true });
      const otro = buscarDuplicado(catalogo.filter((m) => m.id !== id), texto(cuerpo.nombre));
      if (otro) return res.status(409).json({ error: `Ya existe un material con ese nombre: «${otro.nombre}».` });
    }
    valores.push(id);
    const { rows } = await pool.query(`UPDATE adicionales_catalogo SET ${cambios.join(", ")} WHERE id = $${valores.length} RETURNING id`, valores);
    if (!rows.length) return res.status(404).json({ error: "Material no encontrado." });
    res.json({ ok: true });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "Ya existe un material con ese nombre." });
    falloInterno(res, err, "No se pudo actualizar el material.");
  }
});

// Unificar: «este material es el mismo que aquel». Las cantidades pasan al oficial
// (si un plantel tenía los dos, se suman) y el nombre viejo queda como alias.
router.post("/adicionales/:id/unificar", requireAuth, requireRol("admin"), async (req, res) => {
  const id = entero(req.params.id);
  const destino = entero((req.body || {}).destino_id);
  if (!id || !destino) return res.status(400).json({ error: "Indica el material con el que se unifica." });
  if (id === destino) return res.status(400).json({ error: "Un material no se puede unificar consigo mismo." });

  let cliente;
  try {
    const dos = await pool.query("SELECT id, nombre, unificado_en FROM adicionales_catalogo WHERE id IN ($1, $2)", [id, destino]);
    const origen = dos.rows.find((r) => r.id === id);
    const meta = dos.rows.find((r) => r.id === destino);
    if (!origen || !meta) return res.status(404).json({ error: "Material no encontrado." });
    if (origen.unificado_en) return res.status(409).json({ error: "Ese material ya fue unificado antes." });
    if (meta.unificado_en) return res.status(409).json({ error: "El material de destino fue unificado con otro: elige el oficial." });

    cliente = await pool.connect();
    await cliente.query("BEGIN");
    // 1) donde un plantel tenía los dos, se suman en el oficial; donde solo tenía el viejo, pasa al oficial.
    await cliente.query(
      `INSERT INTO inspeccion_adicionales (inspeccion_id, adicional_id, cantidad, actualizado_por)
       SELECT inspeccion_id, $2::int, cantidad, $3::int FROM inspeccion_adicionales WHERE adicional_id = $1
       ON CONFLICT (inspeccion_id, adicional_id) DO UPDATE
         SET cantidad = CASE WHEN inspeccion_adicionales.cantidad IS NULL AND EXCLUDED.cantidad IS NULL THEN NULL
                             ELSE COALESCE(inspeccion_adicionales.cantidad, 0) + COALESCE(EXCLUDED.cantidad, 0) END,
             actualizado_por = EXCLUDED.actualizado_por, actualizado_en = NOW()`,
      [id, destino, req.usuario.id]
    );
    await cliente.query("DELETE FROM inspeccion_adicionales WHERE adicional_id = $1", [id]);
    // 2) alias: los del viejo pasan al oficial y el nombre viejo también es alias
    await cliente.query("UPDATE adicional_alias SET adicional_id = $2 WHERE adicional_id = $1", [id, destino]);
    await cliente.query(
      `INSERT INTO adicional_alias (adicional_id, alias)
       SELECT $1::int, $2::text WHERE NOT EXISTS (SELECT 1 FROM adicional_alias WHERE UPPER(alias) = UPPER($2::text))`,
      [destino, origen.nombre]
    );
    // 3) el viejo queda retirado y apuntando al oficial
    await cliente.query("UPDATE adicionales_catalogo SET unificado_en = $2, estado = 'RETIRADO' WHERE id = $1", [id, destino]);
    await cliente.query("COMMIT");
    res.json({ ok: true });
  } catch (err) {
    if (cliente) await cliente.query("ROLLBACK").catch(() => {});
    falloInterno(res, err, "No se pudo unificar el material.");
  } finally {
    if (cliente) cliente.release();
  }
});

// Cantidades de adicionales de una inspección. { cantidades: { "<id>": "5" | "" }, quitar: [id, ...] }
// "" deja el material anotado sin cantidad (no suma). "quitar" lo saca de la planilla.
router.put("/inspeccion/:id/adicionales", requireAuth, requireRol(...ROLES_ESCRIBE), accesoInspeccion, async (req, res) => {
  const id = entero(req.params.id);
  if (!id) return res.status(400).json({ error: "Inspección inválida." });
  const cuerpo = req.body || {};
  const entradas = Object.entries(cuerpo.cantidades || {});
  const quitar = Array.isArray(cuerpo.quitar) ? cuerpo.quitar.map(entero) : [];
  if (quitar.some((x) => !x)) return res.status(400).json({ error: "Material inválido en «quitar»." });
  if (!entradas.length && !quitar.length) return res.status(400).json({ error: "No hay cambios para guardar." });
  if (entradas.length + quitar.length > 300) return res.status(400).json({ error: "Demasiados cambios en una sola solicitud." });

  const guardar = []; // [adicionalId, textoCanonico|null]
  try {
    for (const [clave, valor] of entradas) {
      const aid = entero(clave);
      if (!aid) return res.status(400).json({ error: "Material inválido." });
      guardar.push([aid, cantidadCanonica(valor)]);
    }
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  let cliente;
  try {
    const existe = await pool.query("SELECT 1 FROM inspecciones WHERE id = $1", [id]);
    if (!existe.rows.length) return res.status(404).json({ error: "Inspección no encontrada." });
    const cerrado = (await planesActivosDeInspeccion(id)).find((p) => p.estado === "CERRADO");
    if (cerrado) return res.status(409).json({ error: `El plan «${cerrado.nombre}» está cerrado: reábrelo para modificar los adicionales.` });

    // Los materiales deben existir; si alguno fue unificado, se usa el oficial; los retirados no se pueden agregar.
    let ids = [...new Set(guardar.map((g) => g[0]))];
    const destinos = {};
    if (ids.length) {
      const marcas = ids.map((_, i) => `$${i + 1}`).join(", ");
      const { rows } = await pool.query(`SELECT id, estado, unificado_en FROM adicionales_catalogo WHERE id IN (${marcas})`, ids);
      if (rows.length !== ids.length) return res.status(400).json({ error: "Hay materiales que no existen en el catálogo." });
      const retirado = rows.find((r) => r.estado === "RETIRADO" && !r.unificado_en);
      if (retirado) return res.status(400).json({ error: "Hay materiales retirados del catálogo: no se pueden agregar." });
      rows.forEach((r) => { destinos[r.id] = r.unificado_en || r.id; });
    }

    cliente = await pool.connect();
    await cliente.query("BEGIN");
    if (quitar.length) {
      const m = quitar.map((_, i) => `$${i + 2}`).join(", ");
      await cliente.query(`DELETE FROM inspeccion_adicionales WHERE inspeccion_id = $1 AND adicional_id IN (${m})`, [id, ...quitar]);
    }
    for (const [aid, c] of guardar) {
      await cliente.query(
        `INSERT INTO inspeccion_adicionales (inspeccion_id, adicional_id, cantidad, actualizado_por)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (inspeccion_id, adicional_id)
         DO UPDATE SET cantidad = EXCLUDED.cantidad, actualizado_por = EXCLUDED.actualizado_por, actualizado_en = NOW()`,
        [id, destinos[aid], c, req.usuario.id]
      );
    }
    await cliente.query("UPDATE inspecciones SET actualizado_por = $2, actualizado_en = NOW() WHERE id = $1", [id, req.usuario.id]);
    await cliente.query("COMMIT");
    res.json({ ok: true, guardados: guardar.length, quitados: quitar.length });
  } catch (err) {
    if (cliente) await cliente.query("ROLLBACK").catch(() => {});
    falloInterno(res, err, "No se pudieron guardar los adicionales.");
  } finally {
    if (cliente) cliente.release();
  }
});

// Consolidado de adicionales del plan (para presentar a las autoridades).
// Solo cuentan planteles enlazados y cantidades mayores que cero; los materiales
// unificados se suman juntos.
async function armarConsolidadoAdicionales(planId) {
  const plan = await pool.query("SELECT id, nombre, descripcion, version_catalogo, estado FROM planes_atencion WHERE id = $1", [planId]);
  if (!plan.rows.length) return null;

  const planteles = await pool.query(
    `SELECT pi.inspeccion_id, pi.codigo_dea, i.membrete
     FROM plan_inspecciones pi JOIN inspecciones i ON i.id = pi.inspeccion_id
     WHERE pi.plan_id = $1 AND pi.desenlazado_en IS NULL`,
    [planId]
  );
  const columnas = planteles.rows
    .map((r) => {
      const d = datosEfectivos(r.membrete);
      return { inspeccion_id: r.inspeccion_id, codigo_dea: r.codigo_dea, nombre_plantel: d.institucion || r.codigo_dea, municipio: d.municipio, parroquia: d.parroquia };
    })
    .sort((a, b) => a.nombre_plantel.localeCompare(b.nombre_plantel, "es"));

  const porPlantel = await pool.query(
    `SELECT COALESCE(a.unificado_en, a.id) AS adicional_id, ia.inspeccion_id, SUM(ia.cantidad) AS cantidad
     FROM plan_inspecciones pi
     JOIN inspeccion_adicionales ia ON ia.inspeccion_id = pi.inspeccion_id
     JOIN adicionales_catalogo a ON a.id = ia.adicional_id
     WHERE pi.plan_id = $1 AND pi.desenlazado_en IS NULL AND ia.cantidad > 0
     GROUP BY COALESCE(a.unificado_en, a.id), ia.inspeccion_id`,
    [planId]
  );
  const totales = await pool.query(
    `SELECT v.adicional_id, v.total, v.planteles_con_cantidad, a.nombre, a.unidad, a.estado
     FROM v_consolidado_adicionales v JOIN adicionales_catalogo a ON a.id = v.adicional_id
     WHERE v.plan_id = $1`,
    [planId]
  );
  const cantidades = {};
  porPlantel.rows.forEach((r) => { (cantidades[r.adicional_id] = cantidades[r.adicional_id] || {})[r.inspeccion_id] = Number(r.cantidad); });

  const materiales = totales.rows
    .map((t) => ({
      id: t.adicional_id,
      nombre: t.nombre,
      unidad: t.unidad || "",
      estado: t.estado,
      cantidades: cantidades[t.adicional_id] || {},
      total: Number(t.total),
      planteles_con_cantidad: Number(t.planteles_con_cantidad),
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  return { plan: plan.rows[0], planteles: columnas, materiales, pendientes: materiales.filter((m) => m.estado === "PENDIENTE").length };
}

router.get("/planes/:id/consolidado-adicionales", requireAuth, requireRol(...ROLES_LECTURA), async (req, res) => {
  const planId = entero(req.params.id);
  if (!planId) return res.status(400).json({ error: "Plan inválido." });
  try {
    const consolidado = await armarConsolidadoAdicionales(planId);
    if (!consolidado) return res.status(404).json({ error: "Plan no encontrado." });
    res.json(consolidado);
  } catch (err) {
    falloInterno(res, err, "No se pudo calcular el consolidado de adicionales.");
  }
});

// Arma el consolidado (lo usan la pantalla y la descarga en Excel).
// Devuelve null si el plan no existe.
async function armarConsolidado(planId) {
  const plan = await pool.query("SELECT id, nombre, descripcion, version_catalogo, estado FROM planes_atencion WHERE id = $1", [planId]);
  if (!plan.rows.length) return null;

  const planteles = await pool.query(
    `SELECT pi.inspeccion_id, pi.codigo_dea, i.membrete
     FROM plan_inspecciones pi
     JOIN inspecciones i ON i.id = pi.inspeccion_id
     WHERE pi.plan_id = $1 AND pi.desenlazado_en IS NULL`,
    [planId]
  );
  const columnas = planteles.rows
    .map((r) => {
      const d = datosEfectivos(r.membrete);
      return {
        inspeccion_id: r.inspeccion_id,
        codigo_dea: r.codigo_dea,
        nombre_plantel: d.institucion || r.codigo_dea,
        municipio: d.municipio,
        parroquia: d.parroquia,
      };
    })
    .sort((a, b) => a.nombre_plantel.localeCompare(b.nombre_plantel, "es"));

  const rubros = await pool.query(
    `SELECT id, codigo, nro_lista, ref_lista1, capitulo, rubro, unidad
     FROM catalogo_materiales WHERE lista = $1 AND activo = TRUE ORDER BY nro_lista`,
    [plan.rows[0].version_catalogo]
  );
  const cantidades = await pool.query(
    `SELECT im.inspeccion_id, im.material_id, im.cantidad
     FROM inspeccion_materiales im
     JOIN plan_inspecciones pi ON pi.inspeccion_id = im.inspeccion_id
     WHERE pi.plan_id = $1 AND pi.desenlazado_en IS NULL AND im.cantidad > 0`,
    [planId]
  );
  const totales = await pool.query(
    "SELECT material_id, total, planteles_con_cantidad FROM v_consolidado_oficial WHERE plan_id = $1",
    [planId]
  );

  const porRubro = {};
  cantidades.rows.forEach((c) => {
    (porRubro[c.material_id] = porRubro[c.material_id] || {})[c.inspeccion_id] = Number(c.cantidad);
  });
  const sumas = {};
  totales.rows.forEach((t) => { sumas[t.material_id] = { total: Number(t.total), planteles: Number(t.planteles_con_cantidad) }; });

  return {
    plan: plan.rows[0],
    planteles: columnas,
    rubros: rubros.rows.map((r) => ({
      id: r.id,
      codigo: r.codigo,
      nro: r.nro_lista,
      ref_vieja: r.ref_lista1,
      capitulo: r.capitulo,
      rubro: r.rubro,
      unidad: r.unidad || "",
      cantidades: porRubro[r.id] || {},
      total: sumas[r.id] ? sumas[r.id].total : 0,
      planteles_con_cantidad: sumas[r.id] ? sumas[r.id].planteles : 0,
    })),
  };
}

router.get("/planes/:id/consolidado", requireAuth, requireRol(...ROLES_LECTURA), async (req, res) => {
  const planId = entero(req.params.id);
  if (!planId) return res.status(400).json({ error: "Plan inválido." });

  try {
    const consolidado = await armarConsolidado(planId);
    if (!consolidado) return res.status(404).json({ error: "Plan no encontrado." });
    res.json(consolidado);
  } catch (err) {
    falloInterno(res, err, "No se pudo calcular el consolidado.");
  }
});

// ---------------------------------------------------------------------------
// Ingenieros y asignación de planillas
// ---------------------------------------------------------------------------

// Cuentas de ingeniero activas (para elegir a quién asignar una planilla).
router.get("/ingenieros", requireAuth, requireRol(...ROLES_GESTION), async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, nombre, email FROM usuarios WHERE rol = 'insp_ingeniero' AND activo = TRUE ORDER BY nombre"
    );
    res.json({ ingenieros: rows });
  } catch (err) {
    falloInterno(res, err, "No se pudo cargar la lista de ingenieros.");
  }
});

// ---- Registrar el plan en GESCOLAR (columna PLAN REHABILITACION) ----
// Escribe el NOMBRE del plan (p. ej. «PRE 2026-2027») en la columna PLAN REHABILITACION de los planteles
// que están activos en el plan, y solo de esos. La columna TIPO ATENCION NO se toca: es el historial de la
// atención anterior (GOTA DE AMOR, ATENCION INTEGRAL…) y es un dato estadístico. Si PLAN REHABILITACION no
// existe todavía en la hoja, se crea al final. Es una operación sobre datos oficiales, por eso solo el
// administrador; la vista previa lo muestra todo antes de confirmar.
async function plantelesActivosDelPlan(planId) {
  const plan = await pool.query("SELECT id, nombre FROM planes_atencion WHERE id = $1", [planId]);
  if (!plan.rows.length) return null;
  const { rows } = await pool.query(
    `SELECT pi.codigo_dea, i.membrete
     FROM plan_inspecciones pi JOIN inspecciones i ON i.id = pi.inspeccion_id
     WHERE pi.plan_id = $1 AND pi.desenlazado_en IS NULL
     ORDER BY pi.codigo_dea`,
    [planId]
  );
  return { plan: plan.rows[0], planteles: rows };
}

router.get("/planes/:id/registro-gescolar", requireAuth, requireRol("admin"), async (req, res) => {
  const planId = entero(req.params.id);
  if (!planId) return res.status(400).json({ error: "Plan inválido." });
  try {
    const info = await plantelesActivosDelPlan(planId);
    if (!info) return res.status(404).json({ error: "Plan no encontrado." });
    const valor = limpiarTexto(info.plan.nombre);
    const datos = await gescolar.cargarGescolar(true);
    const columnaExiste = datos.length > 0 && Object.prototype.hasOwnProperty.call(datos[0], gescolar.CAMPO_PLAN);
    const porCodigo = new Map(datos.map((p) => [limpiarTexto(p[gescolar.CAMPO_CODIGO]).toLowerCase(), p]));
    const planteles = info.planteles.map((r) => {
      const fila = porCodigo.get(String(r.codigo_dea || "").trim().toLowerCase());
      const actual = fila ? limpiarTexto(fila[gescolar.CAMPO_PLAN]) : null;
      return {
        codigo_dea: r.codigo_dea,
        nombre_plantel: nombreEfectivo(r.membrete || {}),
        en_gescolar: Boolean(fila),
        tipo_atencion: fila ? limpiarTexto(fila[gescolar.CAMPO_TIPO_ATENCION]) : null, // historial, solo informativo
        actual,                                                                          // lo que hay hoy en PLAN REHABILITACION
        cambia: Boolean(fila) && actual !== valor,
      };
    });
    res.json({ valor, columna: gescolar.CAMPO_PLAN, columna_existe: columnaExiste, planteles });
  } catch (err) {
    falloInterno(res, err, "No se pudo preparar la vista previa de GESCOLAR.");
  }
});

router.post("/planes/:id/registro-gescolar", requireAuth, requireRol("admin"), async (req, res) => {
  const planId = entero(req.params.id);
  if (!planId) return res.status(400).json({ error: "Plan inválido." });
  if (!req.body || req.body.confirmar !== true) return res.status(400).json({ error: "Falta confirmar la operación." });
  try {
    const info = await plantelesActivosDelPlan(planId);
    if (!info) return res.status(404).json({ error: "Plan no encontrado." });
    const valor = limpiarTexto(info.plan.nombre);
    if (!valor || valor.length > 80 || /^[=+\-@]/.test(valor)) return res.status(400).json({ error: "El nombre del plan no es válido para escribirlo en GESCOLAR." });
    if (!info.planteles.length) return res.status(400).json({ error: "El plan no tiene planteles activos." });
    let resultado;
    try {
      resultado = await gescolar.escribirCampoLote(
        gescolar.CAMPO_PLAN,
        info.planteles.map((r) => ({ codigo: r.codigo_dea, valor }))
      );
    } catch (err) {
      console.error("Error escribiendo PLAN REHABILITACION en GESCOLAR:", err);
      return res.status(502).json({ error: "No se pudo escribir en GESCOLAR. Verifica que la hoja esté compartida como Editor con la cuenta de servicio." });
    }
    console.log(`PLAN REHABILITACION de GESCOLAR actualizado por usuario ${req.usuario.id} con «${valor}»` +
      `${resultado.columna_creada ? " (columna creada)" : ""}:`,
      JSON.stringify(resultado.escritos.filter((e) => e.anterior !== e.valor)));
    res.json({
      ok: true,
      valor,
      columna_creada: resultado.columna_creada,
      escritos: resultado.escritos.length,
      con_cambio: resultado.escritos.filter((e) => e.anterior !== e.valor).length,
      no_encontrados: resultado.no_encontrados,
    });
  } catch (err) {
    falloInterno(res, err, "No se pudo actualizar GESCOLAR.");
  }
});

// Los ingenieros que ya figuran como RESPONSABLE en GESCOLAR, con cuántos planteles tiene cada uno.
router.get("/responsables", requireAuth, requireRol(...ROLES_GESTION), async (req, res) => {
  try {
    const { grupos } = agruparResponsables(await gescolar.cargarGescolar());
    res.json({ responsables: grupos.map((g) => ({ nombre: g.nombre, total: g.planteles.length })) });
  } catch (err) {
    falloInterno(res, err, "No se pudo leer la lista de ingenieros de GESCOLAR.");
  }
});

// Nombre permitido para el responsable: letras (con acentos), números, espacios, punto, apóstrofo y guion.
const NOMBRE_RESPONSABLE = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9][A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 .'\-]{2,79}$/;

// Asigna a una planilla:
//   responsable: "NOMBRE" | null   → se escribe en la columna RESPONSABLE de GESCOLAR (null = sin responsable).
//                                    Si el nombre ya existe en GESCOLAR se usa tal cual está escrito allá.
//   usuarios: [id, ...]            → cuentas de ingeniero con acceso a llenar la planilla (puede ir vacío).
// Cada parte es opcional, pero debe venir al menos una. Primero se escribe en GESCOLAR; si falla, no se
// cambia nada más.
router.put("/inspeccion/:id/asignaciones", requireAuth, requireRol(...ROLES_GESTION), async (req, res) => {
  const id = entero(req.params.id);
  if (!id) return res.status(400).json({ error: "Inspección inválida." });
  const cuerpo = req.body || {};
  const traeUsuarios = cuerpo.usuarios !== undefined;
  const traeResponsable = cuerpo.responsable !== undefined;
  if (!traeUsuarios && !traeResponsable) return res.status(400).json({ error: "No se indicó qué asignar." });

  let ids = [];
  if (traeUsuarios) {
    const lista = cuerpo.usuarios;
    if (!Array.isArray(lista) || lista.length > 20) return res.status(400).json({ error: "Indica la lista de ingenieros (máximo 20)." });
    ids = [...new Set(lista.map(entero))];
    if (ids.some((x) => !x)) return res.status(400).json({ error: "Hay ingenieros inválidos en la lista." });
  }
  let nombreResp = null;
  if (traeResponsable && cuerpo.responsable !== null && String(cuerpo.responsable).trim() !== "") {
    nombreResp = limpiarTexto(cuerpo.responsable);
    if (!NOMBRE_RESPONSABLE.test(nombreResp)) {
      return res.status(400).json({ error: "El nombre del responsable debe tener entre 3 y 80 caracteres (letras, números, espacios, punto, apóstrofo o guion)." });
    }
  }

  let cliente;
  try {
    const existe = await pool.query("SELECT codigo_dea FROM inspecciones WHERE id = $1", [id]);
    if (!existe.rows.length) return res.status(404).json({ error: "Inspección no encontrada." });
    if (ids.length) {
      const validos = await pool.query(
        "SELECT id FROM usuarios WHERE rol = 'insp_ingeniero' AND activo = TRUE AND id = ANY($1::int[])",
        [ids]
      );
      if (validos.rows.length !== ids.length) return res.status(400).json({ error: "Solo se pueden asignar cuentas de ingeniero activas." });
    }

    let responsable;
    if (traeResponsable) {
      if (nombreResp) {
        // Si ya existe en GESCOLAR con otra escritura (mayúsculas, acentos, espacios), se respeta la de allá.
        const { grupos } = agruparResponsables(await gescolar.cargarGescolar());
        const igual = grupos.find((g) => claveNombre(g.nombre) === claveNombre(nombreResp));
        nombreResp = igual ? igual.nombre : nombreResp.toUpperCase();
      }
      try {
        await gescolar.asignarResponsable(existe.rows[0].codigo_dea, nombreResp || "");
      } catch (err) {
        console.error("Error escribiendo RESPONSABLE en GESCOLAR:", err);
        return res.status(err.noEncontrado ? 404 : 502).json({
          error: err.noEncontrado
            ? err.message
            : "No se pudo escribir en GESCOLAR. Verifica que la hoja esté compartida como Editor con la cuenta de servicio. No se cambió nada.",
        });
      }
      responsable = nombreResp;
    }

    if (traeUsuarios) {
      cliente = await pool.connect();
      await cliente.query("BEGIN");
      await cliente.query("DELETE FROM inspeccion_asignaciones WHERE inspeccion_id = $1", [id]);
      for (const uid of ids) {
        await cliente.query(
          "INSERT INTO inspeccion_asignaciones (inspeccion_id, usuario_id, asignado_por) VALUES ($1, $2, $3)",
          [id, uid, req.usuario.id]
        );
      }
      await cliente.query("COMMIT");
    }
    res.json({ ok: true, asignados: ids.length, ...(traeResponsable ? { responsable } : {}) });
  } catch (err) {
    if (cliente) await cliente.query("ROLLBACK").catch(() => {});
    falloInterno(res, err, "No se pudo guardar la asignación.");
  } finally {
    if (cliente) cliente.release();
  }
});

// Resumen de ingenieros: lee la columna RESPONSABLE de GESCOLAR y cuenta los planteles
// inspeccionados por cada uno. Los valores vacíos o "#N/A" significan "sin responsable".
// Lo pueden ver todos los perfiles del módulo.
const SIN_RESPONSABLE = /^(#?N\/?A|#REF!?|#VALUE!?|-+|\.+|NO|SI|SIN .*|NINGUNO)$/i;

function limpiarTexto(valor) {
  let t = String(valor == null ? "" : valor);
  if (/[ÃÂ]/.test(t)) { try { t = Buffer.from(t, "latin1").toString("utf8"); } catch (_) { /* se deja igual */ } }
  return t.replace(/\s+/g, " ").trim();
}

function claveNombre(t) {
  return t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
}

// Agrupa los planteles de GESCOLAR por ingeniero (columna RESPONSABLE), unificando variantes de
// mayúsculas, acentos y espacios. Ignora vacíos y "#N/A".
function agruparResponsables(datos) {
  const grupos = new Map();
  let conResponsable = 0;
  for (const p of datos) {
    const nombre = limpiarTexto(p.RESPONSABLE);
    if (!nombre || SIN_RESPONSABLE.test(nombre)) continue;
    conResponsable++;
    const clave = claveNombre(nombre);
    if (!grupos.has(clave)) grupos.set(clave, { nombre, planteles: [] });
    grupos.get(clave).planteles.push({
      codigo_dea: limpiarTexto(p[gescolar.CAMPO_CODIGO]),
      nombre_plantel: limpiarTexto(p[gescolar.CAMPO_NOMBRE]),
      municipio: limpiarTexto(p.municipio),
      parroquia: limpiarTexto(p.parroquia),
      tarea: limpiarTexto(p.GRUPO_TAREA),
    });
  }
  const lista = [...grupos.values()]
    .map((g) => ({
      nombre: g.nombre,
      total: g.planteles.length,
      planteles: g.planteles.sort((x, y) =>
        (x.municipio + x.parroquia + x.nombre_plantel).localeCompare(y.municipio + y.parroquia + y.nombre_plantel, "es")),
    }))
    .sort((x, y) => y.total - x.total || x.nombre.localeCompare(y.nombre, "es"));
  return { grupos: lista, conResponsable };
}

router.get("/resumen-ingenieros", requireAuth, requireRol(...ROLES_PLANILLA), async (req, res) => {
  try {
    const datos = await gescolar.cargarGescolar();
    const { grupos, conResponsable } = agruparResponsables(datos);
    res.json({ total_planteles_gescolar: datos.length, planteles_con_responsable: conResponsable, ingenieros: grupos });
  } catch (err) {
    console.error("Error armando el resumen de ingenieros:", err);
    res.status(500).json({ error: "No se pudo leer la hoja de GESCOLAR para armar el resumen." });
  }
});

// Pantalla principal: cifras de todo GESCOLAR (atendidos, con inspección) y del módulo.
//  - Atendido  = tiene TIPO ATENCION (GOTA DE AMOR, ATENCION INTEGRAL, BRICOMILES…) o PLAN REHABILITACION.
//  - Con inspección = tiene un RESPONSABLE válido en GESCOLAR (ni vacío ni #N/A).
const SIN_VALOR = /^(#?N\/?A|#REF!?|#VALUE!?|-+|\.+|NO|SI|NINGUNO|SIN .*)$/i;
function valorUtil(v) {
  const t = limpiarTexto(v);
  return t && !SIN_VALOR.test(t) ? t : "";
}
function porcentaje(parte, total) {
  return total ? Math.round((parte / total) * 1000) / 10 : 0;
}

router.get("/dashboard", requireAuth, requireRol(...ROLES_PLANILLA), async (req, res) => {
  try {
    let datos;
    try {
      datos = await gescolar.cargarGescolar();
    } catch (err) {
      console.error("Dashboard: no se pudo leer GESCOLAR:", err.message);
      return res.status(502).json({ error: "No se pudo leer GESCOLAR (Google Sheets no respondió). Intenta de nuevo en un momento." });
    }

    const total = datos.length;
    let atendidos = 0, conInspeccion = 0, atendidosConInspeccion = 0;
    const tipos = new Map();
    const planes = new Map();
    const municipios = new Map();
    let columnaPlan = false;

    for (const p of datos) {
      if (Object.prototype.hasOwnProperty.call(p, gescolar.CAMPO_PLAN)) columnaPlan = true;
      const tipo = valorUtil(p[gescolar.CAMPO_TIPO_ATENCION]);
      const plan = valorUtil(p[gescolar.CAMPO_PLAN]);
      const insp = !!valorUtil(p[gescolar.CAMPO_RESPONSABLE]);
      const atendido = !!(tipo || plan);
      if (atendido) atendidos++;
      if (insp) conInspeccion++;
      if (atendido && insp) atendidosConInspeccion++;
      if (tipo) { const k = claveNombre(tipo); const o = tipos.get(k) || { nombre: tipo, cantidad: 0 }; o.cantidad++; tipos.set(k, o); }
      if (plan) { const k = claveNombre(plan); const o = planes.get(k) || { nombre: plan, cantidad: 0 }; o.cantidad++; planes.set(k, o); }
      const mun = limpiarTexto(p.municipio) || "Sin municipio";
      const m = municipios.get(mun) || { municipio: mun, total: 0, atendidos: 0, con_inspeccion: 0 };
      m.total++; if (atendido) m.atendidos++; if (insp) m.con_inspeccion++;
      municipios.set(mun, m);
    }

    const porTipo = [
      ...[...tipos.values()].map((o) => ({ ...o, origen: "tipo" })),
      ...[...planes.values()].map((o) => ({ ...o, origen: "plan" })),
    ]
      .map((o) => ({ ...o, porcentaje: porcentaje(o.cantidad, total) }))
      .sort((a, b) => b.cantidad - a.cantidad || a.nombre.localeCompare(b.nombre, "es"));

    const modulo = (await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM planes_atencion)::int AS planes,
         (SELECT COUNT(*) FROM inspecciones)::int AS planillas,
         (SELECT COUNT(*) FROM inspecciones WHERE estado = 'CARGADA')::int AS cargadas,
         (SELECT COUNT(*) FROM inspecciones WHERE estado = 'BORRADOR')::int AS borradores,
         (SELECT COUNT(*) FROM plan_inspecciones WHERE desenlazado_en IS NULL)::int AS en_planes`
    )).rows[0];

    res.json({
      total,
      atendidos: { cantidad: atendidos, faltan: total - atendidos, porcentaje: porcentaje(atendidos, total) },
      con_inspeccion: { cantidad: conInspeccion, faltan: total - conInspeccion, porcentaje: porcentaje(conInspeccion, total) },
      atendidos_con_inspeccion: atendidosConInspeccion,
      atendidos_sin_inspeccion: atendidos - atendidosConInspeccion,
      por_tipo: porTipo,
      por_municipio: [...municipios.values()].sort((a, b) => a.municipio.localeCompare(b.municipio, "es")),
      columna_plan_existe: columnaPlan,
      modulo,
    });
  } catch (err) {
    falloInterno(res, err, "No se pudo armar el dashboard.");
  }
});

// Las planillas asignadas al ingeniero que tiene la sesión abierta.
router.get("/mis-planillas", requireAuth, requireRol("insp_ingeniero"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT i.id, i.codigo_dea, i.estado, i.fecha_inspeccion::text AS fecha_inspeccion, i.membrete,
              p.id AS plan_id, p.nombre AS plan_nombre, p.estado AS plan_estado,
              (SELECT COUNT(*) FROM inspeccion_materiales im WHERE im.inspeccion_id = i.id AND im.cantidad > 0) AS rubros_con_cantidad,
              (SELECT COUNT(*) FROM inspeccion_adicionales ia WHERE ia.inspeccion_id = i.id AND ia.cantidad > 0) AS adicionales_con_cantidad
       FROM inspeccion_asignaciones a
       JOIN inspecciones i ON i.id = a.inspeccion_id
       LEFT JOIN plan_inspecciones pi ON pi.inspeccion_id = i.id AND pi.desenlazado_en IS NULL
       LEFT JOIN planes_atencion p ON p.id = pi.plan_id
       WHERE a.usuario_id = $1`,
      [req.usuario.id]
    );
    const planillas = rows
      .map((r) => {
        const d = datosEfectivos(r.membrete);
        return {
          inspeccion_id: r.id,
          codigo_dea: r.codigo_dea,
          nombre_plantel: d.institucion || r.codigo_dea,
          municipio: d.municipio,
          parroquia: d.parroquia,
          estado: r.estado,
          fecha_inspeccion: r.fecha_inspeccion,
          plan_id: r.plan_id,
          plan_nombre: r.plan_nombre,
          plan_estado: r.plan_estado,
          rubros_con_cantidad: Number(r.rubros_con_cantidad),
          adicionales_con_cantidad: Number(r.adicionales_con_cantidad),
        };
      })
      .sort((a, b) => a.nombre_plantel.localeCompare(b.nombre_plantel, "es"));
    res.json({ planillas });
  } catch (err) {
    falloInterno(res, err, "No se pudieron cargar tus planillas.");
  }
});

// ---------------------------------------------------------------------------
// Descargas en Excel (mismo formato de los archivos oficiales de la oficina)
// ---------------------------------------------------------------------------

function nombreArchivo(...partes) {
  return partes
    .join("_")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 120);
}

function enviarExcel(res, buffer, nombre) {
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${nombre}.xlsx"`);
  res.setHeader("Cache-Control", "no-store");
  res.send(Buffer.from(buffer));
}

router.get("/planes/:id/consolidado.xlsx", requireAuth, requireRol(...ROLES_LECTURA), async (req, res) => {
  const planId = entero(req.params.id);
  if (!planId) return res.status(400).json({ error: "Plan inválido." });
  try {
    const consolidado = await armarConsolidado(planId);
    if (!consolidado) return res.status(404).json({ error: "Plan no encontrado." });
    const buffer = await require("../services/exportarExcel").consolidadoOficial(consolidado);
    enviarExcel(res, buffer, nombreArchivo("CONSOLIDADO", consolidado.plan.nombre));
  } catch (err) {
    falloInterno(res, err, "No se pudo generar el Excel del consolidado.");
  }
});

router.get("/planes/:id/consolidado-adicionales.xlsx", requireAuth, requireRol(...ROLES_LECTURA), async (req, res) => {
  const planId = entero(req.params.id);
  if (!planId) return res.status(400).json({ error: "Plan inválido." });
  try {
    const consolidado = await armarConsolidadoAdicionales(planId);
    if (!consolidado) return res.status(404).json({ error: "Plan no encontrado." });
    const buffer = await require("../services/exportarExcel").consolidadoAdicionales(consolidado);
    enviarExcel(res, buffer, nombreArchivo("ADICIONALES", consolidado.plan.nombre));
  } catch (err) {
    falloInterno(res, err, "No se pudo generar el Excel de adicionales.");
  }
});

router.get("/inspeccion/:id/planilla.xlsx", requireAuth, requireRol(...ROLES_PLANILLA), accesoInspeccion, async (req, res) => {
  const id = entero(req.params.id);
  if (!id) return res.status(400).json({ error: "Inspección inválida." });
  try {
    const planilla = await armarPlanilla(id);
    if (!planilla) return res.status(404).json({ error: "Inspección no encontrada." });
    const buffer = await require("../services/exportarExcel").planilla(planilla);
    const i = planilla.inspeccion;
    enviarExcel(res, buffer, nombreArchivo("PLANILLA", i.codigo_dea, i.datos_plantel.institucion));
  } catch (err) {
    falloInterno(res, err, "No se pudo generar el Excel de la planilla.");
  }
});

module.exports = router;
