// instrumentoUno.js — INSTRUMENTO UNO CDCE: visitas exprés a planteles.
//
// Se escribe el código DEA, se traen los datos de GESCOLAR para confirmarlos o corregirlos y se sigue
// con director, infraestructura y edificio compartido. Lo corregido queda SOLO en el instrumento
// (GESCOLAR no se modifica). Al enviar, el plantel queda clasificado (solo o comparte edificio) en el módulo
// de Infraestructuras (services/infraestructuras.js): cada edificio lleva un código INFRA-000001… y, si es
// compartido, se completa la columna codigo_infraestructura de la hoja "Coordenadas Planteles".
//
// Montado en /api/inspecciones/instrumento-uno (dentro de /api/inspecciones, así que los perfiles insp_*
// ya pueden usarlo sin tocar el resto del sistema).
//   GET  /esquema            preguntas y validaciones (las pantallas dibujan el formulario con esto)
//   GET  /plantel/:codigo    datos básicos de un plantel de GESCOLAR + su edificio, si comparte
//   GET  /visitas            lista de visitas (el ingeniero ve solo las suyas)
//   POST /visitas            inicia una visita por código DEA (si ya tiene un borrador suyo, lo retoma)
//   GET  /visitas/:id        una visita con sus respuestas y los datos originales de GESCOLAR
//   PUT  /visitas/:id        guarda borrador, o envía (enviar:true)
//   GET  /edificios          edificios con varios nombres (código de infraestructura y sus instituciones)

const express = require("express");
const { requireAuth, requireRol } = require("../middleware/auth");
const { pool } = require("../db/pool");
const gescolar = require("../services/gescolar");
const coordenadas = require("../services/coordenadasInfra");
const infraestructuras = require("../services/infraestructuras");
const esquema = require("../services/instrumentoUnoEsquema");

const router = express.Router();

const ROLES_ESCRIBE = ["admin", "insp_coordinador", "insp_ingeniero"];
const ROLES_LECTURA = [...ROLES_ESCRIBE, "insp_consulta", "operador_plantel"];
const ROLES_EDITAN_TODO = ["admin", "insp_coordinador"]; // el ingeniero solo edita sus borradores

function entero(valor) {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function falloInterno(res, err, mensaje) {
  console.error(mensaje, err);
  return res.status(500).json({ error: mensaje });
}

function esquemaLimpiar(valor) {
  return String(valor == null ? "" : valor).replace(/\s+/g, " ").trim();
}

function nombreDeFila(fila) {
  return fila ? esquemaLimpiar(fila.nombre_plantel) : "";
}

// ---------------------------------------------------------------------------
// Edificios: salen del módulo de Infraestructuras (base de datos), que ya importó lo que había en la hoja
// "Coordenadas Planteles".
// ---------------------------------------------------------------------------

async function leerEdificios() {
  let hojaOk = true;
  try {
    hojaOk = (await infraestructuras.sincronizar()).hoja_ok;
  } catch (err) {
    hojaOk = false;
    console.error("Instrumento Uno: no se pudo sincronizar los edificios:", err.message);
  }
  const { edificios, total_gescolar } = await infraestructuras.obtenerEdificios();
  return { edificios, hoja_ok: hojaOk, total_gescolar };
}

function edificioDe(edificios, codigoDea) {
  const c = String(codigoDea || "").toLowerCase();
  return edificios.find((e) => e.miembros.some((m) => m.codigo_dea && m.codigo_dea.toLowerCase() === c)) || null;
}

// ---------------------------------------------------------------------------
// Acceso a visitas
// ---------------------------------------------------------------------------

async function cargarVisita(req, res, next) {
  const id = entero(req.params.id);
  if (!id) return res.status(400).json({ error: "Visita inválida." });
  try {
    const { rows } = await pool.query(
      `SELECT v.*, v.fecha_visita::text AS fecha_texto, u.nombre AS ingeniero
       FROM iu_visitas v LEFT JOIN usuarios u ON u.id = v.creado_por WHERE v.id = $1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: "Visita no encontrada." });
    const v = rows[0];
    // el ingeniero solo abre sus propias visitas
    if (req.usuario.rol === "insp_ingeniero" && v.creado_por !== req.usuario.id) {
      return res.status(403).json({ error: "Esta visita la creó otro ingeniero." });
    }
    req.visita = v;
    next();
  } catch (err) {
    falloInterno(res, err, "No se pudo abrir la visita.");
  }
}

function puedeEditar(rol, usuarioId, v) {
  if (ROLES_EDITAN_TODO.includes(rol)) return true;
  return rol === "insp_ingeniero" && v.creado_por === usuarioId && v.estado === "BORRADOR";
}

// Eliminar: el ingeniero borra sus propios borradores; el coordinador y el admin, cualquier visita.
const puedeEliminar = puedeEditar;

// ---------------------------------------------------------------------------
// Esquema y consulta de plantel
// ---------------------------------------------------------------------------

router.get("/esquema", requireAuth, requireRol(...ROLES_LECTURA), (req, res) => {
  res.json({ secciones: esquema.SECCIONES, niveles: esquema.NIVELES });
});

// Búsqueda por nombre o código (sin acentos ni mayúsculas) para elegir otra institución del edificio.
router.get("/buscar", requireAuth, requireRol(...ROLES_LECTURA), async (req, res) => {
  const q = esquema.normalizar(req.query.q || "");
  if (q.length < 3) return res.json({ planteles: [] });
  const excluir = esquemaLimpiar(req.query.excluir).toLowerCase();
  try {
    const datos = await gescolar.cargarGescolar();
    const out = [];
    for (const p of datos) {
      const codigo = esquemaLimpiar(p[gescolar.CAMPO_CODIGO]);
      if (!codigo || codigo.toLowerCase() === excluir) continue;
      const nombre = nombreDeFila(p);
      if (esquema.normalizar(nombre).includes(q) || esquema.normalizar(codigo).includes(q)) {
        out.push({ codigo_dea: codigo, nombre_plantel: nombre, municipio: esquemaLimpiar(p.municipio), parroquia: esquemaLimpiar(p.parroquia) });
        if (out.length >= 8) break;
      }
    }
    res.json({ planteles: out });
  } catch (err) {
    console.error("Instrumento Uno: error buscando en GESCOLAR:", err);
    res.status(502).json({ error: "No se pudo consultar GESCOLAR. Intenta de nuevo en un momento." });
  }
});

router.get("/plantel/:codigo", requireAuth, requireRol(...ROLES_LECTURA), async (req, res) => {
  const codigo = esquemaLimpiar(req.params.codigo);
  if (!codigo) return res.status(400).json({ error: "Falta el código DEA." });
  let fila;
  try {
    fila = await gescolar.obtenerPlantel(codigo);
  } catch (err) {
    console.error("Instrumento Uno: error consultando GESCOLAR:", err);
    return res.status(502).json({ error: "No se pudo consultar GESCOLAR (Google Sheets no respondió). Intenta de nuevo en un momento." });
  }
  if (!fila) return res.status(404).json({ error: `El código ${codigo} no existe en GESCOLAR.` });
  try {
    const { edificios } = await leerEdificios();
    res.json({
      codigo_dea: esquemaLimpiar(fila[gescolar.CAMPO_CODIGO]),
      nombre_plantel: nombreDeFila(fila),
      municipio: esquemaLimpiar(fila.municipio),
      parroquia: esquemaLimpiar(fila.parroquia),
      // solo se informa si YA comparte edificio (un edificio de un solo nombre no es noticia para el ingeniero)
      edificio: (() => { const e = edificioDe(edificios, fila[gescolar.CAMPO_CODIGO]); return e && e.cantidad >= 2 ? e : null; })(),
    });
  } catch (err) {
    falloInterno(res, err, "No se pudo consultar el plantel.");
  }
});

// ---------------------------------------------------------------------------
// Visitas
// ---------------------------------------------------------------------------

router.get("/visitas", requireAuth, requireRol(...ROLES_LECTURA), async (req, res) => {
  try {
    const params = [];
    const filtros = [];
    if (req.usuario.rol === "insp_ingeniero") { params.push(req.usuario.id); filtros.push(`v.creado_por = $${params.length}`); }
    const estado = String(req.query.estado || "").toUpperCase();
    if (estado === "BORRADOR" || estado === "ENVIADA") { params.push(estado); filtros.push(`v.estado = $${params.length}`); }
    const q = String(req.query.q || "").trim();
    if (q) {
      params.push(`%${q.toLowerCase()}%`);
      filtros.push(`(LOWER(v.codigo_dea) LIKE $${params.length} OR LOWER(COALESCE(v.datos->>'nombre_plantel', v.gescolar->>'nombre_plantel', '')) LIKE $${params.length})`);
    }
    const { rows } = await pool.query(
      `SELECT v.id, v.codigo_dea, v.estado, v.fecha_visita::text AS fecha_visita, v.codigo_infraestructura,
              v.infra_sincronizada, v.actualizado_en, v.enviado_en, v.creado_por, u.nombre AS ingeniero,
              COALESCE(v.datos->>'nombre_plantel', v.gescolar->>'nombre_plantel', '') AS nombre_plantel,
              COALESCE(v.datos->>'municipio', v.gescolar->>'municipio', '') AS municipio
       FROM iu_visitas v LEFT JOIN usuarios u ON u.id = v.creado_por
       ${filtros.length ? "WHERE " + filtros.join(" AND ") : ""}
       ORDER BY v.actualizado_en DESC, v.id DESC LIMIT 300`,
      params
    );
    res.json({
      visitas: rows.map((v) => ({ ...v, puede_eliminar: puedeEliminar(req.usuario.rol, req.usuario.id, v) })),
    });
  } catch (err) {
    falloInterno(res, err, "No se pudo cargar la lista de visitas.");
  }
});

// Excel con las respuestas. Por defecto solo las ENVIADAS (?estado=TODAS incluye borradores).
// El ingeniero descarga solo las suyas. Va antes de /visitas/:id.
router.get("/visitas.xlsx", requireAuth, requireRol(...ROLES_LECTURA), async (req, res) => {
  try {
    const params = [];
    const filtros = [];
    const textoFiltro = [];
    if (req.usuario.rol === "insp_ingeniero") { params.push(req.usuario.id); filtros.push(`v.creado_por = $${params.length}`); textoFiltro.push("solo mis visitas"); }
    const estado = String(req.query.estado || "ENVIADA").toUpperCase();
    if (estado === "BORRADOR" || estado === "ENVIADA") { params.push(estado); filtros.push(`v.estado = $${params.length}`); textoFiltro.push(estado === "ENVIADA" ? "solo enviadas" : "solo borradores"); }
    else textoFiltro.push("enviadas y borradores");
    const { rows } = await pool.query(
      `SELECT v.id, v.codigo_dea, v.estado, v.fecha_visita::text AS fecha_visita, v.datos, v.gescolar,
              v.codigo_infraestructura, u.nombre AS ingeniero
       FROM iu_visitas v LEFT JOIN usuarios u ON u.id = v.creado_por
       ${filtros.length ? "WHERE " + filtros.join(" AND ") : ""}
       ORDER BY COALESCE(v.datos->>'municipio', v.gescolar->>'municipio', ''), COALESCE(v.datos->>'nombre_plantel', v.gescolar->>'nombre_plantel', ''), v.id`,
      params
    );
    // si el plantel no tiene el nombre/municipio en lo respondido, usar lo de GESCOLAR
    rows.forEach((v) => {
      v.datos = v.datos || {};
      ["nombre_plantel", "municipio", "parroquia"].forEach((k) => { if (!v.datos[k] && v.gescolar && v.gescolar[k]) v.datos[k] = v.gescolar[k]; });
    });
    // Edificios compartidos de las visitas exportadas (código INFRA-… vigente de cada plantel)
    const codigos = [...new Set(rows.map((v) => v.codigo_infraestructura).filter(Boolean))];
    const visitaDe = new Map();
    rows.forEach((v) => { if (v.codigo_infraestructura && !visitaDe.has(v.codigo_infraestructura)) visitaDe.set(v.codigo_infraestructura, v.id); });
    let miembros = [];
    if (codigos.length) {
      const q = await pool.query(
        `SELECT i.codigo AS codigo_infraestructura, m.id, m.codigo_dea, m.nombre
         FROM infra_miembros m JOIN infraestructuras i ON i.id = m.infraestructura_id
         WHERE i.codigo = ANY($1::text[]) ORDER BY i.numero, m.id`, [codigos]);
      const cuenta = new Map();
      q.rows.forEach((r) => cuenta.set(r.codigo_infraestructura, (cuenta.get(r.codigo_infraestructura) || 0) + 1));
      miembros = q.rows.filter((r) => cuenta.get(r.codigo_infraestructura) > 1).map((r) => ({ ...r, visita_id: visitaDe.get(r.codigo_infraestructura) }));
    }
    const buffer = await require("../services/exportarInstrumentoUno").visitas({ visitas: rows, miembros, filtroTexto: textoFiltro.join(", ") });
    const fecha = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="INSTRUMENTO_UNO_${fecha}.xlsx"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(Buffer.from(buffer));
  } catch (err) {
    falloInterno(res, err, "No se pudo generar el Excel del Instrumento Uno.");
  }
});

router.post("/visitas", requireAuth, requireRol(...ROLES_ESCRIBE), async (req, res) => {
  const codigoPedido = esquemaLimpiar(req.body && req.body.codigo_dea);
  if (!codigoPedido) return res.status(400).json({ error: "Escribe el código DEA del plantel." });
  let fila;
  try {
    fila = await gescolar.obtenerPlantel(codigoPedido);
  } catch (err) {
    console.error("Instrumento Uno: error consultando GESCOLAR:", err);
    return res.status(502).json({ error: "No se pudo consultar GESCOLAR (Google Sheets no respondió). Intenta de nuevo en un momento." });
  }
  if (!fila) return res.status(404).json({ error: `El código ${codigoPedido} no existe en GESCOLAR.` });
  const codigo = esquemaLimpiar(fila[gescolar.CAMPO_CODIGO]);
  try {
    // Si este usuario ya tiene una visita en borrador de ese plantel, se retoma (no se duplica).
    const previa = await pool.query(
      "SELECT id FROM iu_visitas WHERE codigo_dea = $1 AND creado_por = $2 AND estado = 'BORRADOR' ORDER BY id DESC LIMIT 1",
      [codigo, req.usuario.id]
    );
    if (previa.rows.length) return res.json({ ok: true, id: previa.rows[0].id, reanudada: true });
    const original = esquema.valoresDeGescolar(fila);
    const { rows } = await pool.query(
      `INSERT INTO iu_visitas (codigo_dea, gescolar, datos, creado_por, actualizado_por)
       VALUES ($1, $2::jsonb, $2::jsonb, $3, $3) RETURNING id`,
      [codigo, JSON.stringify(original), req.usuario.id]
    );
    res.status(201).json({ ok: true, id: rows[0].id, reanudada: false });
  } catch (err) {
    falloInterno(res, err, "No se pudo iniciar la visita.");
  }
});

router.get("/visitas/:id", requireAuth, requireRol(...ROLES_LECTURA), cargarVisita, async (req, res) => {
  const v = req.visita;
  try {
    let edificio = null;
    let hojaOk = true;
    if (v.codigo_infraestructura) {
      const r = await leerEdificios();
      hojaOk = r.hoja_ok;
      edificio = r.edificios.find((e) => e.codigo_infraestructura === v.codigo_infraestructura) || null;
    }
    res.json({
      visita: {
        id: v.id, codigo_dea: v.codigo_dea, estado: v.estado, fecha_visita: v.fecha_texto,
        datos: v.datos, gescolar: v.gescolar, codigo_infraestructura: v.codigo_infraestructura,
        infra_sincronizada: v.infra_sincronizada, enviado_en: v.enviado_en, actualizado_en: v.actualizado_en,
        ingeniero: v.ingeniero, puede_editar: puedeEditar(req.usuario.rol, req.usuario.id, v),
        puede_eliminar: puedeEliminar(req.usuario.rol, req.usuario.id, v),
      },
      edificio,
      hoja_ok: hojaOk,
      avisos: esquema.avisos(v.datos || {}),
    });
  } catch (err) {
    falloInterno(res, err, "No se pudo abrir la visita.");
  }
});

router.put("/visitas/:id", requireAuth, requireRol(...ROLES_ESCRIBE), cargarVisita, async (req, res) => {
  const v = req.visita;
  if (!puedeEditar(req.usuario.rol, req.usuario.id, v)) {
    return res.status(403).json({ error: v.estado === "ENVIADA" ? "Esta visita ya fue enviada; solo el coordinador puede modificarla." : "No puedes modificar esta visita." });
  }
  const enviar = req.body && req.body.enviar === true;
  if (v.estado === "ENVIADA" && !enviar) return res.status(409).json({ error: "La visita ya fue enviada: para guardar cambios usa Enviar." });

  const { datos, errores } = esquema.validar(req.body && req.body.datos, { enviar });
  let fecha = v.fecha_texto;
  if (req.body && req.body.fecha_visita) {
    const f = String(req.body.fecha_visita);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f) || Number.isNaN(Date.parse(f))) errores.fecha_visita = "Fecha no válida.";
    else fecha = f;
  }

  // Otras instituciones: cada código DEA debe existir en GESCOLAR (el nombre oficial se toma de allá).
  if (enviar && datos.comparte_edificio === "SI" && !Object.keys(errores).some((k) => k.startsWith("otras_instituciones"))) {
    try {
      for (let i = 0; i < datos.otras_instituciones.length; i++) {
        const o = datos.otras_instituciones[i];
        if (!o.codigo_dea) continue;
        if (o.codigo_dea.toLowerCase() === String(v.codigo_dea).toLowerCase()) { errores[`otras_instituciones.${i}`] = "Ese es el mismo plantel de la visita."; continue; }
        const fila = await gescolar.obtenerPlantel(o.codigo_dea);
        if (!fila) { errores[`otras_instituciones.${i}`] = `El código ${o.codigo_dea} no existe en GESCOLAR. Si no tiene código, déjalo vacío y escribe solo el nombre.`; continue; }
        o.codigo_dea = esquemaLimpiar(fila[gescolar.CAMPO_CODIGO]);
        o.nombre = nombreDeFila(fila) || o.nombre;
      }
    } catch (err) {
      console.error("Instrumento Uno: error consultando GESCOLAR:", err);
      return res.status(502).json({ error: "No se pudo consultar GESCOLAR para verificar las otras instituciones. Intenta de nuevo en un momento." });
    }
  }
  if (Object.keys(errores).length) return res.status(400).json({ error: "Revisa los campos marcados.", errores });

  try {
    if (!enviar) {
      await pool.query(
        "UPDATE iu_visitas SET datos = $2::jsonb, fecha_visita = $3::date, actualizado_por = $4, actualizado_en = NOW() WHERE id = $1",
        [v.id, JSON.stringify(datos), fecha, req.usuario.id]
      );
      return res.json({ ok: true, estado: v.estado, avisos: esquema.avisos(datos) });
    }

    // ---- ENVIAR: el plantel queda clasificado (solo / comparte) y su edificio recibe código INFRA-… ----
    const comparte = datos.comparte_edificio === "SI" && datos.otras_instituciones.length > 0;
    let clasif;
    try {
      clasif = await infraestructuras.clasificar({
        codigo_dea: v.codigo_dea, nombre: datos.nombre_plantel || "", comparte, otras: datos.otras_instituciones, usuarioId: req.usuario.id,
      });
    } catch (err) {
      // 409: ya están en edificios distintos; 502: Google no respondió. En ambos casos la visita sigue como borrador.
      if (err instanceof infraestructuras.ErrorInfra) return res.status(err.status).json({ error: err.message });
      throw err;
    }
    const infra = clasif.infra.codigo;
    const necesitaHoja = clasif.comparte || clasif.quitar.length > 0;
    await pool.query(
      `UPDATE iu_visitas SET datos = $2::jsonb, fecha_visita = $3::date, estado = 'ENVIADA', enviado_en = COALESCE(enviado_en, NOW()),
              codigo_infraestructura = $4, infra_sincronizada = $5, actualizado_por = $6, actualizado_en = NOW()
       WHERE id = $1`,
      [v.id, JSON.stringify(datos), fecha, infra, !necesitaHoja, req.usuario.id]
    );

    // La hoja se completa DESPUÉS de guardar: si Google falla, la visita no se pierde (queda «pendiente»).
    const u = await pool.query("SELECT nombre FROM usuarios WHERE id = $1", [req.usuario.id]);
    const hoja = await infraestructuras.sincronizarHoja(clasif, (u.rows[0] && u.rows[0].nombre) || "");
    if (hoja === "ok") await pool.query("UPDATE iu_visitas SET infra_sincronizada = TRUE WHERE id = $1", [v.id]);
    const hojaLeida = true;
    const final = await leerEdificios();
    res.json({
      ok: true,
      estado: "ENVIADA",
      codigo_infraestructura: infra,
      comparte: clasif.comparte,
      edificio: final.edificios.find((e) => e.codigo_infraestructura === infra) || null,
      hoja_coordenadas: hoja,
      avisos: esquema.avisos(datos),
      hoja_leida: hojaLeida,
    });
  } catch (err) {
    falloInterno(res, err, "No se pudo guardar la visita.");
  }
});

router.delete("/visitas/:id", requireAuth, requireRol(...ROLES_ESCRIBE), cargarVisita, async (req, res) => {
  const v = req.visita;
  if (!puedeEliminar(req.usuario.rol, req.usuario.id, v)) {
    return res.status(403).json({ error: v.estado === "ENVIADA" ? "Una visita enviada solo la puede eliminar el coordinador o el administrador." : "No puedes eliminar esta visita." });
  }
  const cliente = await pool.connect();
  try {
    await cliente.query("BEGIN");
    // Los nombres que esta visita aportó al edificio se quitan junto con ella.
    await cliente.query("DELETE FROM iu_edificio_miembros WHERE visita_id = $1", [v.id]);
    await cliente.query("DELETE FROM iu_visitas WHERE id = $1", [v.id]);
    await cliente.query("COMMIT");
    console.log(`Instrumento Uno: visita ${v.id} (${v.codigo_dea}, ${v.estado}) eliminada por usuario ${req.usuario.id}.`);
    res.json({ ok: true });
  } catch (err) {
    await cliente.query("ROLLBACK").catch(() => {});
    falloInterno(res, err, "No se pudo eliminar la visita.");
  } finally {
    cliente.release();
  }
});

// ---------------------------------------------------------------------------
// Edificios
// ---------------------------------------------------------------------------

router.get("/edificios", requireAuth, requireRol(...ROLES_LECTURA), async (req, res) => {
  try {
    const { edificios, hoja_ok, total_gescolar } = await leerEdificios();
    const todos = req.query.todos === "1";
    const lista = edificios
      .filter((e) => todos || e.cantidad >= 2)
      .sort((a, b) => b.cantidad - a.cantidad || a.codigo_infraestructura.localeCompare(b.codigo_infraestructura));
    res.json({
      edificios: lista,
      total_edificios: edificios.length,
      // Resumen general: cada plantel de GESCOLAR es un nombre; los que comparten edificio se cuentan como UNA infraestructura.
      resumen: {
        nombres_planteles: total_gescolar,
        edificios_compartidos: edificios.filter((e) => e.cantidad >= 2).length,
        nombres_en_compartidos: edificios.filter((e) => e.cantidad >= 2).reduce((x, e) => x + e.cantidad, 0),
        infraestructuras: total_gescolar ? total_gescolar - edificios.reduce((x, e) => x + Math.max(0, e.en_gescolar - 1), 0) : null,
      },
      compartidos: edificios.filter((e) => e.cantidad >= 2).length,
      instituciones_en_compartidos: edificios.filter((e) => e.cantidad >= 2).reduce((s, e) => s + e.cantidad, 0),
      hoja_ok,
    });
  } catch (err) {
    falloInterno(res, err, "No se pudo cargar los edificios.");
  }
});

module.exports = router;
