// inspecciones.js — módulo de Inspecciones y listados de materiales (SID).
// Etapa 1: planes de atención y planteles de cada plan.
// Etapa 2: planilla de materiales de cada plantel (lista oficial) y consolidado del plan.
//
// Rutas montadas en /api/inspecciones:
//   GET   /ingenieros                               cuentas de ingeniero activas (para asignar)
//   GET   /planes/:id/registro-gescolar             vista previa: qué se escribiría en la columna «PLAN <nombre>» de GESCOLAR (solo admin)
//   POST  /planes/:id/registro-gescolar             escribe el nombre del plan en su columna «PLAN <nombre>» de GESCOLAR, en sus planteles activos (solo admin)
//   GET   /responsables                             ingenieros que ya figuran como RESPONSABLE en GESCOLAR (con su conteo)
//   GET   /ingenieros/buscar-plantel?q=             (gestión) buscar plantel en GESCOLAR con su responsable actual
//   POST  /ingenieros/asignar-plantel               (gestión) asignar/quitar el ingeniero responsable de cualquier plantel (con o sin plan)
//   GET/POST/PATCH/DELETE /ingenieros/catalogo      lista oficial de ingenieros (ver; agregar, renombrar, retirar y eliminar solo admin)
//   GET/PUT /ingenieros/equipo/:codigo              equipo que participa en la inspección de un plantel
//   GET/POST /ingenieros/corregir-nombres/...       (admin) unificar escrituras distintas de RESPONSABLE con la lista oficial
//   GET   /ingenieros/historial                     (gestión) últimos cambios de responsable
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
//   PUT   /planes/:id/planteles/:inspeccionId/rehabilitacion   ingeniero de rehabilitación del plantel en el plan (gestión)
//   POST  /planes/:id/planteles/:inspeccionId/cerrar-ejecucion y /reabrir-ejecucion   cierra/reabre la ejecución del plantel
//   GET   /mis-rehabilitaciones                     planteles donde el ingeniero en sesión lleva la rehabilitación
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

// Tipos de plan de atención (cada uno se cuenta por separado en las estadísticas).
const TIPOS_PLAN = {
  BRICOMILES: "Bricomiles",
  GOTAS_DE_AMOR: "Gotas de Amor",
  ESCUELAS_VANDALIZADAS: "Escuelas vandalizadas",
  ATENCION_ESPECIAL: "Atención especial",
};

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
      SELECT p.id, p.nombre, p.descripcion, p.version_catalogo, p.estado, p.tipo, p.creado_en,
             COALESCE(SUM(CASE WHEN pi.inspeccion_id IS NOT NULL AND pi.desenlazado_en IS NULL THEN 1 ELSE 0 END), 0)::int AS planteles_activos,
             COALESCE(SUM(CASE WHEN pi.desenlazado_en IS NOT NULL THEN 1 ELSE 0 END), 0)::int AS planteles_desenlazados
      FROM planes_atencion p
      LEFT JOIN plan_inspecciones pi ON pi.plan_id = p.id
      GROUP BY p.id, p.nombre, p.descripcion, p.version_catalogo, p.estado, p.tipo, p.creado_en
      ORDER BY p.creado_en DESC, p.id DESC
    `);
    res.json({ planes: rows, tipos: TIPOS_PLAN });
  } catch (err) {
    falloInterno(res, err, "No se pudieron cargar los planes.");
  }
});

router.post("/planes", requireAuth, requireRol(...ROLES_GESTION), async (req, res) => {
  const cuerpo = req.body || {};
  const nombre = texto(cuerpo.nombre);
  const descripcion = texto(cuerpo.descripcion) || null;
  const version = texto(cuerpo.version_catalogo) || "LISTA2";
  const tipo = texto(cuerpo.tipo) || "BRICOMILES";
  if (!TIPOS_PLAN[tipo]) return res.status(400).json({ error: "Tipo de plan inválido." });

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
      `INSERT INTO planes_atencion (nombre, descripcion, version_catalogo, tipo, creado_por)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, nombre, descripcion, version_catalogo, estado, tipo, creado_en`,
      [nombre, descripcion, version, tipo, req.usuario.id]
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
  if (cuerpo.tipo !== undefined) {
    const tipo = texto(cuerpo.tipo);
    if (!TIPOS_PLAN[tipo]) return res.status(400).json({ error: "Tipo de plan inválido." });
    valores.push(tipo);
    cambios.push(`tipo = $${valores.length}`);
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
       RETURNING id, nombre, descripcion, version_catalogo, estado, tipo, creado_en`,
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
      "SELECT id, nombre, descripcion, version_catalogo, estado, tipo, creado_en FROM planes_atencion WHERE id = $1",
      [planId]
    );
    if (!plan.rows.length) return res.status(404).json({ error: "Plan no encontrado." });

    const { rows } = await pool.query(
      `SELECT pi.inspeccion_id, pi.codigo_dea, pi.enlazado_en, pi.desenlazado_en,
              pi.ejecucion, pi.cerrado_en, pi.ingeniero_rehab, pi.avance_historico, uc.nombre AS cerrado_por_nombre,
              i.fecha_inspeccion::text AS fecha_inspeccion, i.estado, i.origen, i.membrete
       FROM plan_inspecciones pi
       JOIN inspecciones i ON i.id = pi.inspeccion_id
       LEFT JOIN usuarios uc ON uc.id = pi.cerrado_por
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
          ejecucion: r.ejecucion,
          cerrado_en: r.cerrado_en,
          cerrado_por: r.cerrado_por_nombre || null,
          ingeniero_rehab: r.ingeniero_rehab || null,
          avance_historico: r.avance_historico === null || r.avance_historico === undefined ? null : Number(r.avance_historico),
        };
      })
      .sort((a, b) => Number(b.activo) - Number(a.activo) || a.nombre_plantel.localeCompare(b.nombre_plantel, "es"));

    res.json({ plan: { ...plan.rows[0], tipo_nombre: TIPOS_PLAN[plan.rows[0].tipo] || plan.rows[0].tipo }, planteles, tipos: TIPOS_PLAN });
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

    // Un plantel que sigue EN EJECUCIÓN en otro plan no puede entrar a este: primero se cierra allá.
    const abiertoEnOtro = await cliente.query(
      `SELECT p.nombre FROM plan_inspecciones pi JOIN planes_atencion p ON p.id = pi.plan_id
       WHERE pi.codigo_dea = $1 AND pi.desenlazado_en IS NULL AND pi.ejecucion = 'EN_EJECUCION' AND pi.plan_id <> $2`,
      [codigo, planId]
    );
    if (abiertoEnOtro.rows.length) {
      await cliente.query("ROLLBACK");
      return res.status(409).json({ error: `Ese plantel sigue en ejecución en el plan "${abiertoEnOtro.rows[0].nombre}". Ciérralo allá (o desenlázalo) antes de agregarlo a otro plan.` });
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
// de datos, en espera. Además quita al plantel de la columna «PLAN <nombre>» de GESCOLAR
// (solo la celda de la columna «PLAN <nombre>» de este plan; TIPO ATENCION y los otros planes no se tocan). Si GESCOLAR no
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
      gs = await gescolar.quitarPlanDePlantel(codigo, nombrePlan);
    } catch (err) {
      console.error("No se pudo actualizar la columna del plan en GESCOLAR al desenlazar:", err.message);
      return res.status(502).json({ error: "No se pudo actualizar GESCOLAR (Google Sheets no respondió). El plantel NO se desenlazó; intenta de nuevo en un momento." });
    }
    if (gs.estado === "limpiado") console.log(`${gs.columna} de GESCOLAR: ${codigo} "${gs.anterior}" → (vacío) por desenlazar (usuario ${req.usuario.id}).`);

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

    const abiertoEnOtro = await pool.query(
      `SELECT p.nombre FROM plan_inspecciones pi JOIN planes_atencion p ON p.id = pi.plan_id
       WHERE pi.codigo_dea = (SELECT codigo_dea FROM plan_inspecciones WHERE plan_id = $1 AND inspeccion_id = $2)
         AND pi.desenlazado_en IS NULL AND pi.ejecucion = 'EN_EJECUCION' AND pi.plan_id <> $1`,
      [planId, inspeccionId]
    );
    if (abiertoEnOtro.rows.length) {
      return res.status(409).json({ error: `Ese plantel sigue en ejecución en el plan "${abiertoEnOtro.rows[0].nombre}". Ciérralo allá (o desenlázalo) antes.` });
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
// Ejecución (rehabilitación) de cada plantel dentro del plan
// ---------------------------------------------------------------------------
// - ingeniero_rehab: quien lleva la rehabilitación en ese plan (puede ser distinto del responsable de la inspección,
//   que es el RESPONSABLE de GESCOLAR y no cambia). Se elige de la lista oficial de ingenieros.
// - ejecucion: EN_EJECUCION o CERRADO. Cierran: admin, coordinador y el ingeniero de rehabilitación asignado.
//   Reabren: admin y coordinador. Un plantel CERRADO sigue sumando en el consolidado de su plan.

async function filaDeEjecucion(planId, inspeccionId) {
  const { rows } = await pool.query(
    `SELECT pi.codigo_dea, pi.ejecucion, pi.ingeniero_rehab, p.nombre AS plan_nombre, p.estado AS plan_estado
     FROM plan_inspecciones pi JOIN planes_atencion p ON p.id = pi.plan_id
     WHERE pi.plan_id = $1 AND pi.inspeccion_id = $2 AND pi.desenlazado_en IS NULL`,
    [planId, inspeccionId]
  );
  return rows[0] || null;
}

router.put("/planes/:id/planteles/:inspeccionId/rehabilitacion", requireAuth, requireRol(...ROLES_GESTION), async (req, res) => {
  const planId = entero(req.params.id);
  const inspeccionId = entero(req.params.inspeccionId);
  if (!planId || !inspeccionId) return res.status(400).json({ error: "Datos inválidos." });
  const crudo = (req.body || {}).ingeniero;
  try {
    const fila = await filaDeEjecucion(planId, inspeccionId);
    if (!fila) return res.status(404).json({ error: "Ese plantel no está enlazado a este plan." });
    if (fila.plan_estado === "CERRADO") return res.status(409).json({ error: "El plan está cerrado: reábrelo para cambiar sus planteles." });
    if (fila.ejecucion === "CERRADO") return res.status(409).json({ error: "La ejecución de este plantel ya está cerrada. Reábrela para cambiar el ingeniero." });
    let nombre = null;
    if (crudo !== null && crudo !== undefined && String(crudo).trim() !== "") {
      nombre = limpiarTexto(crudo);
      if (!NOMBRE_RESPONSABLE.test(nombre)) return res.status(400).json({ error: "Nombre de ingeniero inválido." });
      const r = resolverEnCatalogo(nombre, await cargarCatalogo(), true);
      if (r.error) return res.status(400).json({ error: r.error });
      nombre = r.nombre;
    }
    await pool.query("UPDATE plan_inspecciones SET ingeniero_rehab = $3 WHERE plan_id = $1 AND inspeccion_id = $2 AND desenlazado_en IS NULL", [planId, inspeccionId, nombre]);
    res.json({ ok: true, ingeniero_rehab: nombre });
  } catch (err) {
    falloInterno(res, err, "No se pudo asignar el ingeniero de rehabilitación.");
  }
});

// ¿Este usuario es el ingeniero de rehabilitación asignado? (por coincidencia de su nombre de cuenta con el de la lista)
async function esIngenieroDeRehabilitacion(usuarioId, ingenieroRehab) {
  if (!ingenieroRehab) return false;
  const { rows } = await pool.query("SELECT nombre FROM usuarios WHERE id = $1", [usuarioId]);
  return rows.length > 0 && claveNombre(limpiarTexto(rows[0].nombre)) === claveNombre(ingenieroRehab);
}

router.post("/planes/:id/planteles/:inspeccionId/cerrar-ejecucion", requireAuth, requireRol(...ROLES_GESTION, "insp_ingeniero"), async (req, res) => {
  const planId = entero(req.params.id);
  const inspeccionId = entero(req.params.inspeccionId);
  if (!planId || !inspeccionId) return res.status(400).json({ error: "Datos inválidos." });
  try {
    const fila = await filaDeEjecucion(planId, inspeccionId);
    if (!fila) return res.status(404).json({ error: "Ese plantel no está enlazado a este plan." });
    if (req.usuario.rol === "insp_ingeniero" && !(await esIngenieroDeRehabilitacion(req.usuario.id, fila.ingeniero_rehab))) {
      return res.status(403).json({ error: "Solo el ingeniero de rehabilitación asignado, el coordinador o el administrador pueden cerrar la ejecución." });
    }
    if (fila.plan_estado === "CERRADO") return res.status(409).json({ error: "El plan está cerrado: reábrelo para cambiar sus planteles." });
    if (fila.ejecucion === "CERRADO") return res.status(409).json({ error: "La ejecución de este plantel ya estaba cerrada." });
    await pool.query(
      "UPDATE plan_inspecciones SET ejecucion = 'CERRADO', cerrado_en = NOW(), cerrado_por = $3 WHERE plan_id = $1 AND inspeccion_id = $2 AND desenlazado_en IS NULL",
      [planId, inspeccionId, req.usuario.id]
    );
    res.json({ ok: true, codigo_dea: fila.codigo_dea });
  } catch (err) {
    falloInterno(res, err, "No se pudo cerrar la ejecución del plantel.");
  }
});

router.post("/planes/:id/planteles/:inspeccionId/reabrir-ejecucion", requireAuth, requireRol(...ROLES_GESTION), async (req, res) => {
  const planId = entero(req.params.id);
  const inspeccionId = entero(req.params.inspeccionId);
  if (!planId || !inspeccionId) return res.status(400).json({ error: "Datos inválidos." });
  try {
    const fila = await filaDeEjecucion(planId, inspeccionId);
    if (!fila) return res.status(404).json({ error: "Ese plantel no está enlazado a este plan." });
    if (fila.plan_estado === "CERRADO") return res.status(409).json({ error: "El plan está cerrado: reábrelo para cambiar sus planteles." });
    if (fila.ejecucion !== "CERRADO") return res.status(409).json({ error: "La ejecución de este plantel no está cerrada." });
    // Reabrir no puede dejar al plantel EN EJECUCIÓN en dos planes a la vez.
    const otro = await pool.query(
      `SELECT p.nombre FROM plan_inspecciones pi JOIN planes_atencion p ON p.id = pi.plan_id
       WHERE pi.codigo_dea = $1 AND pi.desenlazado_en IS NULL AND pi.ejecucion = 'EN_EJECUCION' AND pi.plan_id <> $2`,
      [fila.codigo_dea, planId]
    );
    if (otro.rows.length) return res.status(409).json({ error: `Ese plantel está en ejecución en el plan "${otro.rows[0].nombre}": no se puede reabrir aquí a la vez.` });
    await pool.query(
      "UPDATE plan_inspecciones SET ejecucion = 'EN_EJECUCION', reabierto_en = NOW(), reabierto_por = $3 WHERE plan_id = $1 AND inspeccion_id = $2 AND desenlazado_en IS NULL",
      [planId, inspeccionId, req.usuario.id]
    );
    res.json({ ok: true, codigo_dea: fila.codigo_dea });
  } catch (err) {
    falloInterno(res, err, "No se pudo reabrir la ejecución del plantel.");
  }
});

// Para el ingeniero: los planteles donde él es el ingeniero de rehabilitación (por el nombre de su cuenta).
router.get("/mis-rehabilitaciones", requireAuth, requireRol("insp_ingeniero"), async (req, res) => {
  try {
    const u = await pool.query("SELECT nombre FROM usuarios WHERE id = $1", [req.usuario.id]);
    const clave = u.rows.length ? claveNombre(limpiarTexto(u.rows[0].nombre)) : "";
    const { rows } = await pool.query(
      `SELECT pi.plan_id, pi.inspeccion_id, pi.codigo_dea, pi.ejecucion, pi.cerrado_en, pi.ingeniero_rehab,
              p.nombre AS plan_nombre, p.estado AS plan_estado, i.membrete
       FROM plan_inspecciones pi
       JOIN planes_atencion p ON p.id = pi.plan_id
       JOIN inspecciones i ON i.id = pi.inspeccion_id
       WHERE pi.desenlazado_en IS NULL AND pi.ingeniero_rehab IS NOT NULL`
    );
    const rehabilitaciones = rows
      .filter((r) => claveNombre(r.ingeniero_rehab) === clave)
      .map((r) => {
        const d = datosEfectivos(r.membrete);
        return {
          plan_id: r.plan_id, plan_nombre: r.plan_nombre, plan_estado: r.plan_estado,
          inspeccion_id: r.inspeccion_id, codigo_dea: r.codigo_dea,
          nombre_plantel: d.institucion || r.codigo_dea, municipio: d.municipio, parroquia: d.parroquia,
          ejecucion: r.ejecucion, cerrado_en: r.cerrado_en,
        };
      })
      .sort((a, b) => (a.ejecucion === b.ejecucion ? 0 : a.ejecucion === "EN_EJECUCION" ? -1 : 1) || a.nombre_plantel.localeCompare(b.nombre_plantel, "es"));
    res.json({ rehabilitaciones });
  } catch (err) {
    falloInterno(res, err, "No se pudieron cargar tus rehabilitaciones.");
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

// ---- Registrar el plan en GESCOLAR (columna «PLAN <nombre>») ----
// Cada plan tiene su PROPIA columna en GESCOLAR («PLAN PRE 2026-2027», «PLAN BRICOMILES 2026»…) y en ella
// los planteles activos del plan llevan el nombre del plan, y solo esos. Así un plantel puede estar en varios
// planes sin que uno pise al otro. La columna TIPO ATENCION NO se toca: es el historial de la atención anterior
// (GOTA DE AMOR, ATENCION INTEGRAL…) y es un dato estadístico. Si la columna del plan no existe todavía, se crea
// al final. Es una operación sobre datos oficiales, por eso solo el administrador; la vista previa lo muestra
// todo antes de confirmar.
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
    const columna = gescolar.nombreColumnaPlan(valor);
    const datos = await gescolar.cargarGescolar(true);
    const encabezadoReal = datos.length ? Object.keys(datos[0]).find((h) => gescolar.normalizar(h) === gescolar.normalizar(columna)) : undefined;
    const porCodigo = new Map(datos.map((p) => [limpiarTexto(p[gescolar.CAMPO_CODIGO]).toLowerCase(), p]));
    const planteles = info.planteles.map((r) => {
      const fila = porCodigo.get(String(r.codigo_dea || "").trim().toLowerCase());
      const actual = fila && encabezadoReal ? limpiarTexto(fila[encabezadoReal]) : "";
      return {
        codigo_dea: r.codigo_dea,
        nombre_plantel: nombreEfectivo(r.membrete || {}),
        en_gescolar: Boolean(fila),
        tipo_atencion: fila ? limpiarTexto(fila[gescolar.CAMPO_TIPO_ATENCION]) : null, // historial, solo informativo
        actual,                                                                          // lo que hay hoy en la columna del plan
        cambia: Boolean(fila) && !gescolar.tieneMarcaPlan(actual),                       // si ya tiene valor, no se toca
      };
    });
    // Marcas que la hoja tiene en la columna de este plan para planteles que YA NO están en el plan (desenlazados o quitados).
    const delPlan = new Set(info.planteles.map((r) => String(r.codigo_dea || "").trim().toLowerCase()));
    const sobran = encabezadoReal
      ? datos
          .filter((p) => gescolar.tieneMarcaPlan(p[encabezadoReal]) && !delPlan.has(limpiarTexto(p[gescolar.CAMPO_CODIGO]).toLowerCase()))
          .map((p) => ({ codigo_dea: limpiarTexto(p[gescolar.CAMPO_CODIGO]), nombre_plantel: limpiarTexto(p[gescolar.CAMPO_NOMBRE]), actual: limpiarTexto(p[encabezadoReal]) }))
      : [];
    res.json({ valor, columna: encabezadoReal || columna, columna_existe: Boolean(encabezadoReal), planteles, sobran });
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
    const columna = gescolar.nombreColumnaPlan(valor);
    let resultado;
    try {
      // Solo se escriben los planteles que todavía no tienen valor en la columna (los que ya lo tienen se respetan).
      const datos = await gescolar.cargarGescolar(true);
      const encabezadoReal = datos.length ? Object.keys(datos[0]).find((h) => gescolar.normalizar(h) === gescolar.normalizar(columna)) : undefined;
      const porCodigo = new Map(datos.map((p) => [limpiarTexto(p[gescolar.CAMPO_CODIGO]).toLowerCase(), p]));
      const pendientes = info.planteles.filter((r) => {
        const fila = porCodigo.get(String(r.codigo_dea || "").trim().toLowerCase());
        if (!fila) return true; // no está en GESCOLAR: sale como «no encontrado»
        return !(encabezadoReal && gescolar.tieneMarcaPlan(fila[encabezadoReal]));
      });
      // Además se vacían las marcas de planteles que ya no están en el plan (así la hoja queda igual que el plan).
      const delPlan = new Set(info.planteles.map((r) => String(r.codigo_dea || "").trim().toLowerCase()));
      const sobran = encabezadoReal
        ? datos.filter((p) => gescolar.tieneMarcaPlan(p[encabezadoReal]) && !delPlan.has(limpiarTexto(p[gescolar.CAMPO_CODIGO]).toLowerCase()))
            .map((p) => limpiarTexto(p[gescolar.CAMPO_CODIGO]))
        : [];
      const cambios = pendientes.map((r) => ({ codigo: r.codigo_dea, valor })).concat(sobran.map((c) => ({ codigo: c, valor: "" })));
      resultado = cambios.length
        ? await gescolar.escribirCampoLote(columna, cambios)
        : { escritos: [], no_encontrados: [], columna_creada: false };
      resultado.quitados = sobran.length;
    } catch (err) {
      console.error("Error escribiendo la columna del plan en GESCOLAR:", err);
      return res.status(502).json({ error: "No se pudo escribir en GESCOLAR. Verifica que la hoja esté compartida como Editor con la cuenta de servicio." });
    }
    console.log(`${columna} de GESCOLAR actualizado por usuario ${req.usuario.id} con «${valor}»` +
      `${resultado.columna_creada ? " (columna creada)" : ""}:`,
      JSON.stringify(resultado.escritos.filter((e) => e.anterior !== e.valor)));
    res.json({
      ok: true,
      valor,
      columna,
      columna_creada: resultado.columna_creada,
      escritos: resultado.escritos.length,
      con_cambio: resultado.escritos.filter((e) => e.valor !== "" && e.anterior !== e.valor).length,
      quitados: resultado.quitados || 0,
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
    const todosActivos = (await cargarCatalogo()).filter((c) => c.activo);
    const activos = todosActivos.filter((c) => c.tipo !== "APOYO");
    if (todosActivos.length) {
      const total = new Map(grupos.map((g) => [claveNombre(g.nombre), g.planteles.length]));
      return res.json({ catalogo: true, responsables: activos.map((c) => ({ nombre: c.nombre, total: total.get(claveNombre(c.nombre)) || 0 })) });
    }
    res.json({ catalogo: false, responsables: grupos.map((g) => ({ nombre: g.nombre, total: g.planteles.length })) });
  } catch (err) {
    falloInterno(res, err, "No se pudo leer la lista de ingenieros de GESCOLAR.");
  }
});

// Nombre permitido para el responsable: letras (con acentos), números, espacios, punto, apóstrofo y guion.
const NOMBRE_RESPONSABLE = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9][A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 .'\-]{2,79}$/;

// ---- Lista oficial de ingenieros (tabla ingenieros_catalogo) ----
// Cuando la lista tiene ingenieros activos, el responsable y el equipo SOLO pueden ser de esa lista
// (se elige, no se teclea): así cada nombre se escribe una sola vez y la estadística no se parte.
// Si la tabla no existe o está vacía, se comporta como antes (nombres libres).
async function cargarCatalogo() {
  try {
    const { rows } = await pool.query("SELECT id, nombre, activo, tipo FROM ingenieros_catalogo ORDER BY nombre");
    return rows;
  } catch (err) {
    if (err.code === "42P01") return [];
    if (err.code === "42703") { // todavía no se ejecutó el script 18: todos cuentan como INGENIERO
      const { rows } = await pool.query("SELECT id, nombre, activo FROM ingenieros_catalogo ORDER BY nombre");
      return rows.map((r) => ({ ...r, tipo: "INGENIERO" }));
    }
    throw err;
  }
}
// Devuelve { nombre } (escritura oficial) o { error }.
// paraResponsable: el personal de APOYO no puede quedar a cargo de un plantel (solo en equipos).
function resolverEnCatalogo(nombre, catalogo, paraResponsable = false) {
  const activos = catalogo.filter((c) => c.activo);
  if (!activos.length) return { nombre };
  const hallado = activos.find((c) => claveNombre(c.nombre) === claveNombre(nombre));
  if (!hallado) return { error: "Elige un ingeniero de la lista oficial. Si falta alguien, el administrador lo agrega en Ingenieros → Lista de ingenieros." };
  if (paraResponsable && hallado.tipo === "APOYO") return { error: `${hallado.nombre} es personal de apoyo: puede ir en el equipo, pero no a cargo de un plantel.` };
  return { nombre: hallado.nombre };
}
function distancia(a, b) {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

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
        const catalogo = await cargarCatalogo();
        if (catalogo.some((c) => c.activo)) {
          const r = resolverEnCatalogo(nombreResp, catalogo, true);
          if (r.error) return res.status(400).json({ error: r.error });
          nombreResp = r.nombre;
        } else {
          // Sin lista oficial: si ya existe en GESCOLAR con otra escritura (mayúsculas, acentos, espacios), se respeta la de allá.
          const { grupos } = agruparResponsables(await gescolar.cargarGescolar());
          const igual = grupos.find((g) => claveNombre(g.nombre) === claveNombre(nombreResp));
          nombreResp = igual ? igual.nombre : nombreResp.toUpperCase();
        }
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

// ---- Asignar el ingeniero responsable a CUALQUIER plantel (con o sin plan) ----
// Un plantel tiene UN solo ingeniero a cargo: la columna RESPONSABLE de GESCOLAR. De ahí sale la estadística
// de la pantalla Ingenieros. Aquí no hace falta que el plantel esté en un plan ni que tenga inspección.
// Cada cambio queda en responsable_cambios (quién, cuándo, valor anterior y nuevo).
router.get("/ingenieros/buscar-plantel", requireAuth, requireRol(...ROLES_GESTION), async (req, res) => {
  const q = texto(req.query.q);
  if (q.length < 2) return res.status(400).json({ error: "Escribe al menos 2 caracteres para buscar." });
  try {
    const r = await gescolar.buscarPlanteles(q);
    res.json({
      total: r.total,
      limitado: r.limitado,
      planteles: r.planteles.map((p) => {
        const nombre = limpiarTexto(p.RESPONSABLE);
        return {
          cod_plantel: limpiarTexto(p[gescolar.CAMPO_CODIGO]),
          nombre_plantel: limpiarTexto(p[gescolar.CAMPO_NOMBRE]),
          municipio: limpiarTexto(p.municipio),
          parroquia: limpiarTexto(p.parroquia),
          responsable: nombre && !SIN_RESPONSABLE.test(nombre) ? nombre : "",
        };
      }),
    });
  } catch (err) {
    console.error("Error consultando GESCOLAR:", err);
    res.status(502).json({ error: "No se pudo consultar la hoja de GESCOLAR. Verifica que esté compartida con la cuenta de servicio." });
  }
});

router.post("/ingenieros/asignar-plantel", requireAuth, requireRol(...ROLES_GESTION), async (req, res) => {
  const cuerpo = req.body || {};
  const codigo = limpiarTexto(cuerpo.codigo_dea);
  if (!codigo) return res.status(400).json({ error: "Indica el plantel." });
  let nombre = null;
  if (cuerpo.responsable !== null && cuerpo.responsable !== undefined && String(cuerpo.responsable).trim() !== "") {
    nombre = limpiarTexto(cuerpo.responsable);
    if (!NOMBRE_RESPONSABLE.test(nombre) || SIN_RESPONSABLE.test(nombre)) {
      return res.status(400).json({ error: "El nombre del ingeniero debe tener entre 3 y 80 caracteres (letras, números, espacios, punto, apóstrofo o guion)." });
    }
  }
  try {
    const plantel = await gescolar.obtenerPlantel(codigo);
    if (!plantel) return res.status(404).json({ error: `El plantel ${codigo} no está en GESCOLAR.` });
    const previo = limpiarTexto(plantel.RESPONSABLE);
    const anterior = previo && !SIN_RESPONSABLE.test(previo) ? previo : "";

    if (nombre) {
      const catalogo = await cargarCatalogo();
      if (catalogo.some((c) => c.activo)) {
        const r = resolverEnCatalogo(nombre, catalogo, true);
        if (r.error) return res.status(400).json({ error: r.error });
        nombre = r.nombre;
      } else {
        // Sin lista oficial: si ya existe en GESCOLAR con otra escritura (mayúsculas, acentos, espacios), se respeta la de allá.
        const { grupos } = agruparResponsables(await gescolar.cargarGescolar());
        const igual = grupos.find((g) => claveNombre(g.nombre) === claveNombre(nombre));
        nombre = igual ? igual.nombre : nombre.toUpperCase();
      }
    }
    const nuevo = nombre || "";
    if (claveNombre(nuevo) === claveNombre(anterior)) {
      return res.json({ ok: true, sin_cambio: true, anterior, responsable: anterior });
    }
    try {
      await gescolar.asignarResponsable(codigo, nuevo);
    } catch (err) {
      console.error("Error escribiendo RESPONSABLE en GESCOLAR:", err);
      return res.status(err.noEncontrado ? 404 : 502).json({
        error: err.noEncontrado
          ? err.message
          : "No se pudo escribir en GESCOLAR. Verifica que la hoja esté compartida como Editor con la cuenta de servicio. No se cambió nada.",
      });
    }
    try {
      await pool.query(
        "INSERT INTO responsable_cambios (codigo_dea, plantel, anterior, nuevo, usuario_id) VALUES ($1, $2, $3, $4, $5)",
        [codigo, limpiarTexto(plantel[gescolar.CAMPO_NOMBRE]), anterior, nuevo, req.usuario.id]
      );
    } catch (err) {
      // El cambio en GESCOLAR ya se hizo; si falla el registro se avisa en el servidor y no se deshace.
      console.error("No se pudo guardar el historial de responsables:", err.message);
    }
    res.json({ ok: true, anterior, responsable: nuevo });
  } catch (err) {
    falloInterno(res, err, "No se pudo asignar el ingeniero.");
  }
});

router.get("/ingenieros/historial", requireAuth, requireRol(...ROLES_GESTION), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.codigo_dea, c.plantel, c.anterior, c.nuevo, c.creado_en, u.nombre AS usuario
       FROM responsable_cambios c LEFT JOIN usuarios u ON u.id = c.usuario_id
       ORDER BY c.creado_en DESC, c.id DESC LIMIT 100`
    );
    res.json({ cambios: rows });
  } catch (err) {
    falloInterno(res, err, "No se pudo cargar el historial de asignaciones.");
  }
});

// ---- Lista oficial de ingenieros ----
router.get("/ingenieros/catalogo", requireAuth, requireRol(...ROLES_GESTION), async (req, res) => {
  try {
    res.json({ ingenieros: await cargarCatalogo() });
  } catch (err) {
    falloInterno(res, err, "No se pudo cargar la lista de ingenieros.");
  }
});

router.post("/ingenieros/catalogo", requireAuth, requireRol("admin"), async (req, res) => {
  const nombre = limpiarTexto((req.body || {}).nombre).toUpperCase();
  if (!NOMBRE_RESPONSABLE.test(nombre) || SIN_RESPONSABLE.test(nombre)) {
    return res.status(400).json({ error: "El nombre debe tener entre 3 y 80 caracteres (letras, números, espacios, punto, apóstrofo o guion)." });
  }
  try {
    const catalogo = await cargarCatalogo();
    if (catalogo.some((c) => claveNombre(c.nombre) === claveNombre(nombre))) {
      return res.status(409).json({ error: "Ese ingeniero ya está en la lista." });
    }
    const tipo = (req.body || {}).tipo === "APOYO" ? "APOYO" : "INGENIERO";
    let rows;
    try {
      ({ rows } = await pool.query("INSERT INTO ingenieros_catalogo (nombre, tipo) VALUES ($1, $2) RETURNING id, nombre, activo, tipo", [nombre, tipo]));
    } catch (err) {
      if (err.code !== "42703") throw err;
      ({ rows } = await pool.query("INSERT INTO ingenieros_catalogo (nombre) VALUES ($1) RETURNING id, nombre, activo", [nombre]));
    }
    res.status(201).json(rows[0]);
  } catch (err) {
    falloInterno(res, err, "No se pudo agregar el ingeniero a la lista.");
  }
});

// Editar un ingeniero de la lista: retirar/reactivar ({ activo }) o cambiar el nombre ({ nombre }).
// Cambiar el nombre lo corrige TAMBIÉN en todos los sitios donde ya figura: columna RESPONSABLE de GESCOLAR,
// equipos de plantel y planillas, para que su historial y su estadística no se partan. Primero se escribe en
// GESCOLAR; si falla, no se cambia nada.
router.patch("/ingenieros/catalogo/:id", requireAuth, requireRol("admin"), async (req, res) => {
  const id = entero(req.params.id);
  const cuerpo = req.body || {};
  const traeActivo = typeof cuerpo.activo === "boolean";
  const traeNombre = cuerpo.nombre !== undefined;
  const traeTipo = cuerpo.tipo !== undefined;
  if (traeTipo && !["INGENIERO", "APOYO"].includes(cuerpo.tipo)) return res.status(400).json({ error: "Tipo inválido." });
  if (!id || (!traeActivo && !traeNombre && !traeTipo)) return res.status(400).json({ error: "Datos inválidos." });
  let nuevoNombre = null;
  if (traeNombre) {
    nuevoNombre = limpiarTexto(cuerpo.nombre).toUpperCase();
    if (!NOMBRE_RESPONSABLE.test(nuevoNombre) || SIN_RESPONSABLE.test(nuevoNombre)) {
      return res.status(400).json({ error: "El nombre debe tener entre 3 y 80 caracteres (letras, números, espacios, punto, apóstrofo o guion)." });
    }
  }
  let cliente;
  try {
    const catalogo = await cargarCatalogo();
    const actual = catalogo.find((c) => c.id === id);
    if (!actual) return res.status(404).json({ error: "Ingeniero no encontrado." });
    if (traeNombre && nuevoNombre !== actual.nombre) {
      if (catalogo.some((c) => c.id !== id && claveNombre(c.nombre) === claveNombre(nuevoNombre))) {
        return res.status(409).json({ error: "Ya hay otro ingeniero con ese nombre en la lista." });
      }
      // 1) GESCOLAR: todas las celdas RESPONSABLE que tengan el nombre viejo (sin importar mayúsculas ni acentos).
      const datos = await gescolar.cargarGescolar(true);
      const clave = claveNombre(actual.nombre);
      const cambios = [];
      const plantelNombre = {};
      for (const pl of datos) {
        const v = limpiarTexto(pl.RESPONSABLE);
        if (v && claveNombre(v) === clave) {
          const codigo = limpiarTexto(pl[gescolar.CAMPO_CODIGO]);
          cambios.push({ codigo, valor: nuevoNombre });
          plantelNombre[codigo] = limpiarTexto(pl[gescolar.CAMPO_NOMBRE]);
        }
      }
      let escritos = [];
      if (cambios.length) {
        try {
          escritos = (await gescolar.escribirCampoLote(gescolar.CAMPO_RESPONSABLE, cambios)).escritos;
        } catch (err) {
          console.error("Error escribiendo RESPONSABLE en GESCOLAR:", err);
          return res.status(502).json({ error: "No se pudo escribir en GESCOLAR. No se cambió nada." });
        }
      }
      // 2) Base de datos: lista, equipos y planillas, en una sola transacción.
      cliente = await pool.connect();
      await cliente.query("BEGIN");
      await cliente.query("UPDATE ingenieros_catalogo SET nombre = $2 WHERE id = $1", [id, nuevoNombre]);
      try {
        await cliente.query("SAVEPOINT eq");
        await cliente.query("UPDATE plantel_equipo SET nombre = $2 WHERE UPPER(nombre) = UPPER($1)", [actual.nombre, nuevoNombre]);
      } catch (err) {
        if (err.code !== "42P01") throw err;
        await cliente.query("ROLLBACK TO SAVEPOINT eq");
      }
      await cliente.query("UPDATE inspeccion_inspectores SET nombre = $2 WHERE UPPER(nombre) = UPPER($1)", [actual.nombre, nuevoNombre]);
      for (const e of escritos) {
        await cliente.query(
          "INSERT INTO responsable_cambios (codigo_dea, plantel, anterior, nuevo, usuario_id) VALUES ($1, $2, $3, $4, $5)",
          [e.codigo, plantelNombre[e.codigo] || "", e.anterior, e.valor, req.usuario.id]
        );
      }
      await cliente.query("COMMIT");
    }
    if (traeTipo && cuerpo.tipo !== actual.tipo) {
      if (cuerpo.tipo === "APOYO") {
        const clave = claveNombre(traeNombre && nuevoNombre ? nuevoNombre : actual.nombre);
        const aCargo = (await gescolar.cargarGescolar()).filter((p) => { const v = limpiarTexto(p.RESPONSABLE); return v && claveNombre(v) === clave; }).length;
        if (aCargo) {
          return res.status(409).json({ error: `${actual.nombre} tiene ${aCargo} plantel${aCargo === 1 ? "" : "es"} a cargo. Primero reasígnalos a otro ingeniero y luego pásalo a personal de apoyo.` });
        }
      }
      await pool.query("UPDATE ingenieros_catalogo SET tipo = $2 WHERE id = $1", [id, cuerpo.tipo]);
    }
    if (traeActivo) await pool.query("UPDATE ingenieros_catalogo SET activo = $2 WHERE id = $1", [id, cuerpo.activo]);
    res.json((await cargarCatalogo()).find((c) => c.id === id));
  } catch (err) {
    if (cliente) await cliente.query("ROLLBACK").catch(() => {});
    falloInterno(res, err, "No se pudo actualizar al ingeniero.");
  } finally {
    if (cliente) cliente.release();
  }
});

// Eliminar de la lista: solo si no tiene NADA registrado (ni planteles a cargo, ni equipos, ni planillas).
// Si ya tiene historial, lo correcto es retirarlo (queda guardado y deja de poder elegirse).
router.delete("/ingenieros/catalogo/:id", requireAuth, requireRol("admin"), async (req, res) => {
  const id = entero(req.params.id);
  if (!id) return res.status(400).json({ error: "Ingeniero inválido." });
  try {
    const actual = (await cargarCatalogo()).find((c) => c.id === id);
    if (!actual) return res.status(404).json({ error: "Ingeniero no encontrado." });
    const clave = claveNombre(actual.nombre);
    const datos = await gescolar.cargarGescolar();
    const aCargo = datos.filter((p) => { const v = limpiarTexto(p.RESPONSABLE); return v && claveNombre(v) === clave; }).length;
    let enEquipos = 0;
    try {
      enEquipos = (await pool.query("SELECT COUNT(*)::int n FROM plantel_equipo WHERE UPPER(nombre) = UPPER($1)", [actual.nombre])).rows[0].n;
    } catch (err) { if (err.code !== "42P01") throw err; }
    const enPlanillas = (await pool.query("SELECT COUNT(*)::int n FROM inspeccion_inspectores WHERE UPPER(nombre) = UPPER($1)", [actual.nombre])).rows[0].n;
    if (aCargo || enEquipos || enPlanillas) {
      return res.status(409).json({
        error: `${actual.nombre} ya tiene registros (${aCargo} plantel${aCargo === 1 ? "" : "es"} a cargo, ${enEquipos} en equipos, ${enPlanillas} en planillas), por eso no se puede eliminar. Puedes retirarlo de la lista: conserva su historial y deja de poder elegirse.`,
      });
    }
    await pool.query("DELETE FROM ingenieros_catalogo WHERE id = $1", [id]);
    res.json({ ok: true });
  } catch (err) {
    falloInterno(res, err, "No se pudo eliminar al ingeniero.");
  }
});

// ---- Equipo de cada plantel ----
// Quienes participan en la inspección además del responsable. Se cuentan los de plantel_equipo y los
// ingenieros anotados en las planillas del plantel (inspeccion_inspectores); la participación de cada uno
// sale de la unión de ambas fuentes.
async function equipoDelPlantel(codigo) {
  let propios = [];
  try {
    propios = (await pool.query("SELECT nombre FROM plantel_equipo WHERE LOWER(codigo_dea) = LOWER($1) ORDER BY nombre", [codigo])).rows.map((r) => r.nombre);
  } catch (err) {
    if (err.code !== "42P01") throw err;
  }
  const planilla = (await pool.query(
    `SELECT DISTINCT ii.nombre FROM inspeccion_inspectores ii JOIN inspecciones i ON i.id = ii.inspeccion_id
     WHERE LOWER(i.codigo_dea) = LOWER($1) ORDER BY ii.nombre`, [codigo])).rows.map((r) => r.nombre);
  return { propios, planilla };
}

router.get("/ingenieros/equipo/:codigo", requireAuth, requireRol(...ROLES_GESTION), async (req, res) => {
  const codigo = limpiarTexto(req.params.codigo);
  if (!codigo) return res.status(400).json({ error: "Indica el plantel." });
  try {
    res.json(await equipoDelPlantel(codigo));
  } catch (err) {
    falloInterno(res, err, "No se pudo cargar el equipo del plantel.");
  }
});

router.put("/ingenieros/equipo/:codigo", requireAuth, requireRol(...ROLES_GESTION), async (req, res) => {
  const codigo = limpiarTexto(req.params.codigo);
  const lista = (req.body || {}).nombres;
  if (!codigo || !Array.isArray(lista) || lista.length > 20) return res.status(400).json({ error: "Indica el plantel y la lista del equipo (máximo 20)." });
  let cliente;
  try {
    const plantel = await gescolar.obtenerPlantel(codigo);
    if (!plantel) return res.status(404).json({ error: `El plantel ${codigo} no está en GESCOLAR.` });
    const catalogo = await cargarCatalogo();
    const nombres = [];
    for (const n of lista) {
      const limpio = limpiarTexto(n);
      const r = resolverEnCatalogo(limpio, catalogo);
      if (r.error) return res.status(400).json({ error: r.error });
      if (!NOMBRE_RESPONSABLE.test(r.nombre)) return res.status(400).json({ error: "Hay un nombre inválido en el equipo." });
      if (!nombres.some((x) => claveNombre(x) === claveNombre(r.nombre))) nombres.push(r.nombre);
    }
    const codigoReal = limpiarTexto(plantel[gescolar.CAMPO_CODIGO]);
    cliente = await pool.connect();
    await cliente.query("BEGIN");
    await cliente.query("DELETE FROM plantel_equipo WHERE LOWER(codigo_dea) = LOWER($1)", [codigoReal]);
    for (const n of nombres) {
      await cliente.query("INSERT INTO plantel_equipo (codigo_dea, nombre, creado_por) VALUES ($1, $2, $3)", [codigoReal, n, req.usuario.id]);
    }
    await cliente.query("COMMIT");
    res.json({ ok: true, equipo: nombres });
  } catch (err) {
    if (cliente) await cliente.query("ROLLBACK").catch(() => {});
    falloInterno(res, err, "No se pudo guardar el equipo del plantel.");
  } finally {
    if (cliente) cliente.release();
  }
});

// ---- Corregir escrituras distintas de RESPONSABLE en GESCOLAR (solo admin) ----
// Busca los valores de la columna que no coinciden EXACTAMENTE con un nombre de la lista oficial y propone
// el nombre oficial (misma escritura sin acentos/mayúsculas, o muy parecida). Nada se escribe hasta aplicar.
router.get("/ingenieros/corregir-nombres/vista-previa", requireAuth, requireRol("admin"), async (req, res) => {
  try {
    const activos = (await cargarCatalogo()).filter((c) => c.activo && c.tipo !== "APOYO");
    if (!activos.length) return res.json({ lista_vacia: true, valores: [] });
    const datos = await gescolar.cargarGescolar(true);
    const por = new Map();
    for (const p of datos) {
      const crudo = String(p.RESPONSABLE == null ? "" : p.RESPONSABLE).replace(/\s+/g, " ").trim();
      const util = limpiarTexto(crudo);
      if (!util || SIN_RESPONSABLE.test(util)) continue;
      if (activos.some((c) => c.nombre === crudo)) continue; // ya está igual que la lista oficial
      if (!por.has(crudo)) por.set(crudo, []);
      por.get(crudo).push({ codigo_dea: limpiarTexto(p[gescolar.CAMPO_CODIGO]), nombre_plantel: limpiarTexto(p[gescolar.CAMPO_NOMBRE]) });
    }
    const valores = [...por.entries()].map(([actual, planteles]) => {
      const k = claveNombre(actual);
      let sugerido = (activos.find((c) => claveNombre(c.nombre) === k) || {}).nombre || null;
      let motivo = sugerido ? "misma escritura (mayúsculas o acentos)" : "";
      if (!sugerido) {
        const cercanos = activos.map((c) => ({ c, d: distancia(k, claveNombre(c.nombre)) })).filter((x) => x.d <= 2).sort((a, b) => a.d - b.d);
        if (cercanos.length && (cercanos.length === 1 || cercanos[0].d < cercanos[1].d)) { sugerido = cercanos[0].c.nombre; motivo = "muy parecido"; }
      }
      return { actual, sugerido, motivo, planteles };
    }).sort((a, b) => b.planteles.length - a.planteles.length || a.actual.localeCompare(b.actual, "es"));
    res.json({ valores, lista: activos.map((c) => c.nombre) });
  } catch (err) {
    console.error("Error armando la corrección de nombres:", err);
    res.status(502).json({ error: "No se pudo leer la hoja de GESCOLAR." });
  }
});

router.post("/ingenieros/corregir-nombres/aplicar", requireAuth, requireRol("admin"), async (req, res) => {
  const cuerpo = req.body || {};
  if (cuerpo.confirmar !== true || !Array.isArray(cuerpo.correcciones) || !cuerpo.correcciones.length) {
    return res.status(400).json({ error: "Confirma las correcciones que quieres aplicar." });
  }
  try {
    const activos = (await cargarCatalogo()).filter((c) => c.activo && c.tipo !== "APOYO");
    const mapa = new Map();
    for (const c of cuerpo.correcciones) {
      const actual = String((c && c.actual) || "").replace(/\s+/g, " ").trim();
      const oficial = activos.find((a) => a.nombre === String((c && c.nuevo) || ""));
      if (!actual || !oficial) return res.status(400).json({ error: "Cada corrección debe terminar en un nombre de la lista oficial." });
      mapa.set(actual, oficial.nombre);
    }
    const datos = await gescolar.cargarGescolar(true);
    const cambios = [];
    const nombres = {};
    for (const p of datos) {
      const crudo = String(p.RESPONSABLE == null ? "" : p.RESPONSABLE).replace(/\s+/g, " ").trim();
      if (mapa.has(crudo)) {
        const codigo = limpiarTexto(p[gescolar.CAMPO_CODIGO]);
        cambios.push({ codigo, valor: mapa.get(crudo) });
        nombres[codigo] = limpiarTexto(p[gescolar.CAMPO_NOMBRE]);
      }
    }
    if (!cambios.length) return res.json({ ok: true, aplicados: 0 });
    let r;
    try {
      r = await gescolar.escribirCampoLote(gescolar.CAMPO_RESPONSABLE, cambios);
    } catch (err) {
      console.error("Error escribiendo RESPONSABLE en GESCOLAR:", err);
      return res.status(502).json({ error: "No se pudo escribir en GESCOLAR. No se cambió nada." });
    }
    try {
      for (const e of r.escritos) {
        await pool.query(
          "INSERT INTO responsable_cambios (codigo_dea, plantel, anterior, nuevo, usuario_id) VALUES ($1, $2, $3, $4, $5)",
          [e.codigo, nombres[e.codigo] || "", e.anterior, e.valor, req.usuario.id]
        );
      }
    } catch (err) {
      console.error("No se pudo guardar el historial de correcciones:", err.message);
    }
    res.json({ ok: true, aplicados: r.escritos.length });
  } catch (err) {
    falloInterno(res, err, "No se pudieron aplicar las correcciones.");
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

// Una fila por ingeniero de la lista oficial (aunque no tenga planteles) y por cualquier otro nombre que
// aparezca en GESCOLAR o en los equipos. Para cada uno:
//   total / planteles   = planteles a su cargo (RESPONSABLE de GESCOLAR)
//   en_equipo           = otros planteles donde participó en el equipo (plantel_equipo + planillas)
//   participacion       = total + en_equipo
router.get("/resumen-ingenieros", requireAuth, requireRol(...ROLES_PLANILLA), async (req, res) => {
  try {
    const datos = await gescolar.cargarGescolar();
    const { grupos, conResponsable } = agruparResponsables(datos);
    const catalogo = await cargarCatalogo();
    const activos = catalogo.filter((c) => c.activo);

    const personas = new Map(); // clave → { nombre, en_lista, planteles[], equipo: Map(codigo → info) }
    const persona = (nombre) => {
      const k = claveNombre(nombre);
      if (!personas.has(k)) {
        const oficial = activos.find((c) => claveNombre(c.nombre) === k);
        personas.set(k, { nombre: oficial ? oficial.nombre : nombre, en_lista: !!oficial, tipo: oficial ? oficial.tipo : "INGENIERO", planteles: [], equipo: new Map() });
      }
      return personas.get(k);
    };
    activos.forEach((c) => persona(c.nombre));
    grupos.forEach((g) => { persona(g.nombre).planteles = g.planteles; });

    const infoPlantel = new Map(datos.map((p) => [limpiarTexto(p[gescolar.CAMPO_CODIGO]).toLowerCase(), p]));
    let filasEquipo = [];
    try {
      filasEquipo = (await pool.query("SELECT codigo_dea, nombre FROM plantel_equipo")).rows;
    } catch (err) {
      if (err.code !== "42P01") throw err;
    }
    filasEquipo = filasEquipo.concat((await pool.query(
      "SELECT i.codigo_dea, ii.nombre FROM inspeccion_inspectores ii JOIN inspecciones i ON i.id = ii.inspeccion_id")).rows);
    for (const f of filasEquipo) {
      const nombre = limpiarTexto(f.nombre);
      if (!nombre || SIN_RESPONSABLE.test(nombre)) continue;
      const pe = persona(nombre);
      const cod = String(f.codigo_dea || "").trim();
      if (pe.planteles.some((x) => x.codigo_dea.toLowerCase() === cod.toLowerCase())) continue; // ya es el responsable: no se cuenta dos veces
      const p = infoPlantel.get(cod.toLowerCase());
      pe.equipo.set(cod.toLowerCase(), {
        codigo_dea: cod,
        nombre_plantel: p ? limpiarTexto(p[gescolar.CAMPO_NOMBRE]) : "",
        municipio: p ? limpiarTexto(p.municipio) : "",
        parroquia: p ? limpiarTexto(p.parroquia) : "",
      });
    }
    // Rehabilitaciones: el ingeniero de rehabilitación de cada plantel en cada plan (plan_inspecciones.ingeniero_rehab).
    // Un mismo plantel en dos planes son dos rehabilitaciones. Los desenlazados no cuentan.
    const rehabs = new Map(); // clave → [{ codigo_dea, plan, ejecucion, ... }]
    try {
      const rr = (await pool.query(
        `SELECT pi.codigo_dea, pi.ingeniero_rehab, pi.ejecucion, pi.avance_historico, p.nombre AS plan
         FROM plan_inspecciones pi JOIN planes_atencion p ON p.id = pi.plan_id
         WHERE pi.desenlazado_en IS NULL AND pi.ingeniero_rehab IS NOT NULL AND pi.ingeniero_rehab <> ''
         ORDER BY p.creado_en DESC, p.id DESC`)).rows;
      for (const f of rr) {
        const pe = persona(f.ingeniero_rehab);
        const k = claveNombre(pe.nombre);
        const cod = String(f.codigo_dea || "").trim();
        const p = infoPlantel.get(cod.toLowerCase());
        if (!rehabs.has(k)) rehabs.set(k, []);
        rehabs.get(k).push({
          codigo_dea: cod,
          nombre_plantel: p ? limpiarTexto(p[gescolar.CAMPO_NOMBRE]) : "",
          municipio: p ? limpiarTexto(p.municipio) : "",
          parroquia: p ? limpiarTexto(p.parroquia) : "",
          plan: f.plan,
          ejecucion: f.ejecucion,
          avance_historico: f.avance_historico === null || f.avance_historico === undefined ? null : Number(f.avance_historico),
        });
      }
    } catch (err) {
      if (err.code !== "42703") throw err; // todavía sin la columna ingeniero_rehab (script 19 sin ejecutar)
    }
    const ingenieros = [...personas.values()].map((pe) => ({
      nombre: pe.nombre,
      rehabilitaciones: (rehabs.get(claveNombre(pe.nombre)) || []),
      rehab_en_ejecucion: (rehabs.get(claveNombre(pe.nombre)) || []).filter((x) => x.ejecucion !== "CERRADO").length,
      rehab_cerradas: (rehabs.get(claveNombre(pe.nombre)) || []).filter((x) => x.ejecucion === "CERRADO").length,
      en_lista: pe.en_lista,
      tipo: pe.tipo,
      total: pe.planteles.length,
      planteles: pe.planteles,
      en_equipo: pe.equipo.size,
      planteles_equipo: [...pe.equipo.values()].sort((x, y) => x.nombre_plantel.localeCompare(y.nombre_plantel, "es")),
      participacion: pe.planteles.length + pe.equipo.size,
    })).sort((x, y) => y.total - x.total || y.participacion - x.participacion || x.nombre.localeCompare(y.nombre, "es"));
    res.json({
      total_planteles_gescolar: datos.length,
      planteles_con_responsable: conResponsable,
      lista_oficial: activos.length > 0,
      ingenieros,
    });
  } catch (err) {
    console.error("Error armando el resumen de ingenieros:", err);
    res.status(500).json({ error: "No se pudo leer la hoja de GESCOLAR para armar el resumen." });
  }
});

// Pantalla principal: cifras de todo GESCOLAR (atendidos, con inspección) y del módulo.
//  - Atendido  = tiene TIPO ATENCION (GOTA DE AMOR, ATENCION INTEGRAL, BRICOMILES…) o valor en alguna columna «PLAN <nombre>».
//  - Con inspección = tiene un RESPONSABLE válido en GESCOLAR (ni vacío ni #N/A).
const SIN_VALOR = /^(#?N\/?A|#REF!?|#VALUE!?|-+|\.+|NO|SI|NINGUNO|SIN .*)$/i;
function valorUtil(v) {
  const t = limpiarTexto(v);
  return t && !SIN_VALOR.test(t) ? t : "";
}
function porcentaje(parte, total) {
  return total ? Math.round((parte / total) * 1000) / 10 : 0;
}

// ---- Programas de atención del dashboard ----
// Cada plantel atendido cuenta UNA sola vez en el total, y puede aparecer en más de una barra (programa).
// Las barras salen de DOS fuentes que se unen por nombre: la hoja (TIPO ATENCION y las columnas «PLAN <nombre>»)
// y los planes del sistema (plan_inspecciones). «GOTA DE AMOR» y «GOTAS DE AMOR 2024» son el mismo programa
// (con el año dentro); «PLAN MAESTRO 2024» y «BRICOMILES 2024» son la misma atención.
const ORDEN_PROGRAMAS = ["GOTA", "PM2024", "VAND", "BRICOMILES 2025", "PRE 2026-2027"];
function aniosDe(...textos) {
  const v = new Set();
  for (const t of textos) for (const m of String(t == null ? "" : t).matchAll(/\b(20\d\d)\b/g)) v.add(m[1]);
  return v.size ? [...v] : ["Sin año"];
}
function programaDe(nombre, tipoPlan, anioHoja) {
  const original = String(nombre || "").replace(/\s+/g, " ").trim();
  const n = gescolar.normalizar(original);
  if (tipoPlan === "GOTAS_DE_AMOR" || /^GOTAS? DE AMOR\b/.test(n)) {
    return { clave: "GOTA", nombre: "Gota de Amor", anios: aniosDe(anioHoja, original) };
  }
  if (n === "PLAN MAESTRO 2024" || n === "BRICOMILES 2024") {
    return { clave: "PM2024", nombre: "PLAN MAESTRO 2024", nota: "Bricomiles 2024" };
  }
  if (tipoPlan === "ESCUELAS_VANDALIZADAS" || /VANDALIZAD/.test(n)) {
    return { clave: "VAND", nombre: original || "ESCUELAS VANDALIZADAS" };
  }
  return { clave: n, nombre: original };
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

    // Planteles cargados por el Instrumento Uno CDCE: los que tienen al menos una visita ENVIADA.
    let conInstrumento = new Set();
    try {
      const r = await pool.query("SELECT DISTINCT LOWER(codigo_dea) AS c FROM iu_visitas WHERE estado = 'ENVIADA'");
      conInstrumento = new Set(r.rows.map((x) => x.c));
    } catch (err) {
      console.error("Dashboard: no se pudieron leer las visitas del Instrumento Uno:", err.message);
    }
    const parroquiasMaturin = new Map();
    let instrumentoTotal = 0;

    const total = datos.length;
    let atendidos = 0, conInspeccion = 0, atendidosConInspeccion = 0;
    const tipos = new Map();
    const municipios = new Map();
    // Un plan = una columna «PLAN <nombre>» de GESCOLAR (p. ej. «PLAN PRE 2026-2027»).
    const columnasPlan = datos.length ? Object.keys(datos[0]).filter((h) => gescolar.esColumnaPlan(h)) : [];
    const planes = columnasPlan.map((h) => ({ columna: h, nombre: gescolar.planDeColumna(h), cantidad: 0 }));

    // Planes del sistema (los desenlazados no cuentan): todo plantel en un plan cuenta como atendido aunque
    // todavía no se haya registrado en GESCOLAR.
    const planesDeCodigo = new Map(); // código en minúsculas → [{ nombre, tipo }]
    try {
      let rp;
      try {
        rp = await pool.query(
          `SELECT pi.codigo_dea, p.nombre, p.tipo FROM plan_inspecciones pi JOIN planes_atencion p ON p.id = pi.plan_id WHERE pi.desenlazado_en IS NULL`);
      } catch (err) {
        if (err.code !== "42703") throw err; // sin la columna «tipo» (script 20 sin ejecutar)
        rp = await pool.query(
          `SELECT pi.codigo_dea, p.nombre, NULL::text AS tipo FROM plan_inspecciones pi JOIN planes_atencion p ON p.id = pi.plan_id WHERE pi.desenlazado_en IS NULL`);
      }
      for (const f of rp.rows) {
        const k = String(f.codigo_dea || "").trim().toLowerCase();
        if (!planesDeCodigo.has(k)) planesDeCodigo.set(k, []);
        planesDeCodigo.get(k).push({ nombre: f.nombre, tipo: f.tipo });
      }
    } catch (err) {
      console.error("Dashboard: no se pudieron leer los planes del sistema:", err.message);
    }
    // Si el plan existe en el sistema, el sistema manda: se ignora su columna «PLAN …» de la hoja (puede traer marcas viejas
    // de planteles que ya salieron del plan).
    const nombresPlanSistema = new Set();
    try {
      (await pool.query("SELECT nombre FROM planes_atencion")).rows.forEach((x) => nombresPlanSistema.add(gescolar.normalizar(x.nombre)));
    } catch (err) {
      console.error("Dashboard: no se pudieron leer los nombres de los planes:", err.message);
    }
    const claveAnio = datos.length ? Object.keys(datos[0]).find((h) => gescolar.normalizar(h) === "ANO") : null;
    const programas = new Map(); // clave → { nombre, nota, planteles:Set, anios: Map(anio → Set) }
    const sumaBarras = { n: 0 };

    for (const p of datos) {
      const tipo = valorUtil(p[gescolar.CAMPO_TIPO_ATENCION]);
      let enAlgunPlan = false;
      const codigoMin = limpiarTexto(p[gescolar.CAMPO_CODIGO]).toLowerCase();
      const fuentes = []; // { nombre, tipo } de todo lo que tiene este plantel
      if (tipo) fuentes.push({ nombre: tipo, tipo: null, esTipoAtencion: true });
      planes.forEach((pl) => {
        if (!gescolar.tieneMarcaPlan(p[pl.columna])) return;
        pl.cantidad++;
        if (nombresPlanSistema.has(gescolar.normalizar(pl.nombre))) return; // este plan lo gobierna el sistema
        enAlgunPlan = true; fuentes.push({ nombre: pl.nombre, tipo: null });
      });
      (planesDeCodigo.get(codigoMin) || []).forEach((x) => { enAlgunPlan = true; fuentes.push({ nombre: x.nombre, tipo: x.tipo }); });
      const propios = new Map(); // programas de ESTE plantel (una vez cada uno) → años
      for (const f of fuentes) {
        const pr = programaDe(f.nombre, f.tipo, f.esTipoAtencion && claveAnio ? p[claveAnio] : "");
        if (!propios.has(pr.clave)) propios.set(pr.clave, { pr, anios: new Set() });
        (pr.anios || []).forEach((a) => propios.get(pr.clave).anios.add(a));
      }
      for (const [clave, { pr, anios }] of propios) {
        if (!programas.has(clave)) programas.set(clave, { clave, nombre: pr.nombre, nota: pr.nota || null, planteles: new Set(), anios: new Map(), conAnios: !!pr.anios });
        const g = programas.get(clave);
        g.planteles.add(codigoMin);
        anios.forEach((a) => { if (!g.anios.has(a)) g.anios.set(a, new Set()); g.anios.get(a).add(codigoMin); });
        sumaBarras.n++;
      }
      const insp = !!valorUtil(p[gescolar.CAMPO_RESPONSABLE]);
      const atendido = !!(tipo || enAlgunPlan);
      if (atendido) atendidos++;
      if (insp) conInspeccion++;
      if (atendido && insp) atendidosConInspeccion++;
      if (tipo) { const k = claveNombre(tipo); const o = tipos.get(k) || { nombre: tipo, cantidad: 0 }; o.cantidad++; tipos.set(k, o); }
      const mun = limpiarTexto(p.municipio) || "Sin municipio";
      // se agrupa sin importar acentos ni mayúsculas (MATURIN = Maturín); se muestra el nombre tal como aparece primero
      const m = municipios.get(claveNombre(mun)) || { municipio: mun, total: 0, atendidos: 0, con_inspeccion: 0, instrumento: 0 };
      const conIU = conInstrumento.has(limpiarTexto(p[gescolar.CAMPO_CODIGO]).toLowerCase());
      m.total++; if (atendido) m.atendidos++; if (insp) m.con_inspeccion++; if (conIU) m.instrumento++;
      municipios.set(claveNombre(mun), m);
      if (conIU) instrumentoTotal++;
      if (claveNombre(mun) === claveNombre("Maturín")) {
        const par = limpiarTexto(p.parroquia) || "Sin parroquia";
        const o = parroquiasMaturin.get(claveNombre(par)) || { parroquia: par, total: 0, instrumento: 0 };
        o.total++; if (conIU) o.instrumento++;
        parroquiasMaturin.set(claveNombre(par), o);
      }
    }

    const porTipo = [
      ...[...tipos.values()].map((o) => ({ ...o, origen: "tipo" })),
      ...planes.filter((pl) => pl.cantidad > 0).map((pl) => ({ nombre: pl.nombre, cantidad: pl.cantidad, origen: "plan" })),
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

    const posicion = (k) => { const i = ORDEN_PROGRAMAS.findIndex((x) => gescolar.normalizar(x) === gescolar.normalizar(k)); return i === -1 ? 99 : i; };
    const porPrograma = [...programas.values()]
      .map((g) => ({
        clave: g.clave,
        nombre: g.nombre,
        nota: g.nota,
        cantidad: g.planteles.size,
        porcentaje: porcentaje(g.planteles.size, total),
        anios: g.conAnios
          ? [...g.anios.entries()].map(([anio, set]) => ({ anio, cantidad: set.size })).sort((a, b) => String(a.anio).localeCompare(String(b.anio)))
          : null,
        // planteles con atención en dos años distintos: se cuentan en cada año pero una sola vez en la barra
        repetidos_anios: g.conAnios ? [...g.anios.values()].reduce((x, set) => x + set.size, 0) - g.planteles.size : 0,
      }))
      .sort((a, b) => posicion(a.clave) - posicion(b.clave) || b.cantidad - a.cantidad || a.nombre.localeCompare(b.nombre, "es"));
    const cuadre = { suma_barras: sumaBarras.n, repetidos: sumaBarras.n - atendidos, atendidos };

    res.json({
      total,
      por_programa: porPrograma,
      cuadre,
      atendidos: { cantidad: atendidos, faltan: total - atendidos, porcentaje: porcentaje(atendidos, total) },
      con_inspeccion: { cantidad: conInspeccion, faltan: total - conInspeccion, porcentaje: porcentaje(conInspeccion, total) },
      atendidos_con_inspeccion: atendidosConInspeccion,
      atendidos_sin_inspeccion: atendidos - atendidosConInspeccion,
      por_tipo: porTipo,
      por_municipio: [...municipios.values()].sort((a, b) => a.municipio.localeCompare(b.municipio, "es")),
      instrumento: { cantidad: instrumentoTotal, faltan: total - instrumentoTotal, porcentaje: porcentaje(instrumentoTotal, total) },
      parroquias_maturin: [...parroquiasMaturin.values()]
        .map((o) => ({ ...o, faltan: o.total - o.instrumento, porcentaje: porcentaje(o.instrumento, o.total) }))
        .sort((a, b) => a.parroquia.localeCompare(b.parroquia, "es")),
      columnas_plan: columnasPlan.length,
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
