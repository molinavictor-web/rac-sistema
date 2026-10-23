// inspecciones.js — módulo de Inspecciones y listados de materiales (SID).
// Etapa 1: planes de atención y planteles de cada plan.
// Etapa 2: planilla de materiales de cada plantel (lista oficial) y consolidado del plan.
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
//   GET   /inspeccion/:id                           planilla: membrete, ingenieros y los 163 rubros con sus cantidades
//   PATCH /inspeccion/:id                           fecha, observaciones, estado, ingenieros y datos del plantel (membrete)
//   PUT   /inspeccion/:id/materiales                guardar cantidades (solo las que cambiaron)
//   GET   /planes/:id/consolidado                   consolidado oficial del plan
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
              i.fecha_inspeccion::text AS fecha_inspeccion, i.estado, i.origen, i.membrete
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

router.get("/inspeccion/:id", requireAuth, requireRol(...ROLES_GESTION), async (req, res) => {
  const id = entero(req.params.id);
  if (!id) return res.status(400).json({ error: "Inspección inválida." });

  try {
    const cabecera = await pool.query(
      `SELECT id, codigo_dea, fecha_inspeccion::text AS fecha_inspeccion, estado, origen,
              observaciones, membrete, actualizado_en
       FROM inspecciones WHERE id = $1`,
      [id]
    );
    if (!cabecera.rows.length) return res.status(404).json({ error: "Inspección no encontrada." });
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

    res.json({
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
    });
  } catch (err) {
    falloInterno(res, err, "No se pudo cargar la planilla.");
  }
});

// Datos de cabecera: fecha, observaciones, estado e ingenieros (el primero
// es el responsable principal).
router.patch("/inspeccion/:id", requireAuth, requireRol(...ROLES_GESTION), async (req, res) => {
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
router.put("/inspeccion/:id/materiales", requireAuth, requireRol(...ROLES_GESTION), async (req, res) => {
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

router.get("/planes/:id/consolidado", requireAuth, requireRol(...ROLES_GESTION), async (req, res) => {
  const planId = entero(req.params.id);
  if (!planId) return res.status(400).json({ error: "Plan inválido." });

  try {
    const plan = await pool.query("SELECT id, nombre, descripcion, version_catalogo, estado FROM planes_atencion WHERE id = $1", [planId]);
    if (!plan.rows.length) return res.status(404).json({ error: "Plan no encontrado." });

    const planteles = await pool.query(
      `SELECT pi.inspeccion_id, pi.codigo_dea, i.membrete
       FROM plan_inspecciones pi
       JOIN inspecciones i ON i.id = pi.inspeccion_id
       WHERE pi.plan_id = $1 AND pi.desenlazado_en IS NULL`,
      [planId]
    );
    const columnas = planteles.rows
      .map((r) => ({ inspeccion_id: r.inspeccion_id, codigo_dea: r.codigo_dea, nombre_plantel: nombreEfectivo(r.membrete, r.codigo_dea) }))
      .sort((a, b) => a.nombre_plantel.localeCompare(b.nombre_plantel, "es"));

    const rubros = await pool.query(
      `SELECT id, codigo, nro_lista, capitulo, rubro, unidad
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

    res.json({
      plan: plan.rows[0],
      planteles: columnas,
      rubros: rubros.rows.map((r) => ({
        id: r.id,
        codigo: r.codigo,
        nro: r.nro_lista,
        capitulo: r.capitulo,
        rubro: r.rubro,
        unidad: r.unidad || "",
        cantidades: porRubro[r.id] || {},
        total: sumas[r.id] ? sumas[r.id].total : 0,
        planteles_con_cantidad: sumas[r.id] ? sumas[r.id].planteles : 0,
      })),
    });
  } catch (err) {
    falloInterno(res, err, "No se pudo calcular el consolidado.");
  }
});

module.exports = router;
