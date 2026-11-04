// consultasExpres.js — consultas exprés del Instrumento Uno.
//
// Una consulta toma una o varias FASES (secciones) del instrumento. Quien llena escribe el código DEA, el sistema
// trae el dato vigente de esas fases (o lo que se pueda de GESCOLAR), se verifica/actualiza y se guarda.
//
// Dato vigente de un plantel = la última visita ENVIADA del Instrumento Uno, con encima los valores de iu_valores
// que sean MÁS NUEVOS que esa visita. Cada cambio queda en iu_cambios (quién, cuándo, valor anterior y nuevo, nota)
// y se puede revertir. Los reportes leen el dato vigente con datosVigentesLote().
//
// Etapa 1: la llenan usuarios del sistema (origen "personal"). El campo `origen` ya admite "director" para la etapa 2.
// La fase "Edificio compartido" NO se guarda solo como dato: al guardar usa la misma clasificación de la pantalla
// Infraestructuras (código INFRA-…, hoja «Coordenadas Planteles», mismos avisos 409/502). Esos cambios quedan en el
// historial pero NO se revierten desde «Cambios recientes»: se corrigen en Infraestructuras.

const { pool } = require("../db/pool");
const gescolar = require("./gescolar");
const infraestructuras = require("./infraestructuras");
const esquema = require("./instrumentoUnoEsquema");

class ErrorConsulta extends Error {
  constructor(estado, mensaje, extra) {
    super(mensaje);
    this.estado = estado;
    this.extra = extra || null;
  }
}

// Fases disponibles = secciones del instrumento.
const FASES = esquema.SECCIONES.map((s) => ({ id: s.id, titulo: s.titulo }));
// Claves de la fase Edificio: no se revierten desde Cambios recientes (se corrigen en Infraestructuras).
const CLAVES_EDIFICIO = ["comparte_edificio", "otras_instituciones"];
const IDS_FASES = new Set(FASES.map((f) => f.id));

function seccionesDe(fases) {
  return esquema.SECCIONES.filter((s) => fases.includes(s.id));
}

function camposDeFases(fases) {
  const r = [];
  seccionesDe(fases).forEach((s) => {
    r.push(...s.campos);
    (s.grupos || []).forEach((g) => r.push(...g.campos));
    // la lista de otras instituciones del edificio también es un dato de la fase
    if (s.lista) r.push({ clave: s.lista.clave, etiqueta: s.lista.etiqueta, tipo: "lista" });
  });
  return r;
}

const limpio = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim();

// Identidad de una institución de la lista: su código DEA o, si no tiene, su nombre (sin acentos ni mayúsculas).
function claveInstitucion(o) {
  const c = limpio(o && o.codigo_dea).toLowerCase();
  return c || "n:" + esquema.normalizar(limpio(o && o.nombre));
}
function listaIgual(a, b) {
  const f = (x) => (Array.isArray(x) ? x : []).map(claveInstitucion).sort().join("|");
  return f(a) === f(b);
}

// Cómo está hoy el plantel en el módulo Infraestructuras (la fuente que manda para el edificio).
async function estadoEdificio(codigoDea) {
  const k = limpio(codigoDea).toLowerCase();
  const { rows } = await pool.query(
    `SELECT i.codigo, m2.codigo_dea, m2.nombre
     FROM infra_miembros m
     JOIN infraestructuras i ON i.id = m.infraestructura_id
     JOIN infra_miembros m2 ON m2.infraestructura_id = i.id
     WHERE lower(m.codigo_dea) = $1 ORDER BY m2.id`, [k]);
  if (!rows.length) return { clasificado: false, comparte: false, codigo: null, otras: [], miembros: [] };
  const otras = rows
    .filter((r) => limpio(r.codigo_dea).toLowerCase() !== k)
    .map((r) => ({ codigo_dea: limpio(r.codigo_dea).toUpperCase(), nombre: limpio(r.nombre) }));
  return {
    clasificado: true, comparte: rows.length > 1, codigo: rows[0].codigo, otras,
    miembros: rows.map((r) => ({ codigo_dea: limpio(r.codigo_dea), nombre: limpio(r.nombre) })),
  };
}

function igual(a, b) {
  return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
}

function validarFases(fases) {
  if (!Array.isArray(fases)) throw new ErrorConsulta(400, "Elige al menos una fase.");
  const unicas = [...new Set(fases.map((f) => String(f)))];
  if (!unicas.length) throw new ErrorConsulta(400, "Elige al menos una fase.");
  if (unicas.some((f) => !IDS_FASES.has(f))) throw new ErrorConsulta(400, "Alguna fase no es válida.");
  // en el orden del instrumento
  return esquema.SECCIONES.filter((s) => unicas.includes(s.id)).map((s) => s.id);
}

// ---------------------------------------------------------------------------
// Dato vigente
// ---------------------------------------------------------------------------

// Aplica los valores de iu_valores (los más nuevos que la visita) encima de los datos de la visita.
function superponer(datosVisita, enviadoEn, valores) {
  const datos = { ...(datosVisita || {}) };
  const meta = {};
  Object.keys(datos).forEach((k) => { meta[k] = { fuente: "visita", en: enviadoEn || null }; });
  (valores || []).forEach((v) => {
    if (enviadoEn && new Date(v.actualizado_en) <= new Date(enviadoEn)) return; // la visita es más nueva
    if (v.valor === null) { delete datos[v.clave]; delete meta[v.clave]; return; }
    datos[v.clave] = v.valor;
    meta[v.clave] = { fuente: "consulta", origen: v.origen, verificado_campo: v.verificado_campo, en: v.actualizado_en, usuario: v.usuario_nombre || null };
  });
  return { datos, meta };
}

// Dato vigente de muchos planteles a la vez (para los reportes). Devuelve Map(codigo en minúsculas → datos).
async function datosVigentesLote(codigos) {
  const claves = [...new Set((codigos || []).map((c) => String(c || "").toLowerCase()).filter(Boolean))];
  const salida = new Map();
  if (!claves.length) return salida;
  const visitas = (await pool.query(
    `SELECT DISTINCT ON (lower(codigo_dea)) lower(codigo_dea) AS k, datos, enviado_en
     FROM iu_visitas WHERE estado = 'ENVIADA' AND lower(codigo_dea) = ANY($1::text[])
     ORDER BY lower(codigo_dea), enviado_en DESC NULLS LAST, id DESC`, [claves])).rows;
  const valores = (await pool.query(
    `SELECT lower(codigo_dea) AS k, clave, valor, origen, verificado_campo, actualizado_en
     FROM iu_valores WHERE lower(codigo_dea) = ANY($1::text[])`, [claves])).rows;
  const porVisita = new Map(visitas.map((v) => [v.k, v]));
  const porValores = new Map();
  valores.forEach((v) => { (porValores.get(v.k) || porValores.set(v.k, []).get(v.k)).push(v); });
  claves.forEach((k) => {
    const v = porVisita.get(k);
    const vals = porValores.get(k);
    if (!v && !vals) return;
    salida.set(k, superponer(v ? v.datos : {}, v ? v.enviado_en : null, vals).datos);
  });
  return salida;
}

// Dato vigente de un plantel para llenar una consulta: si una pregunta no tiene dato, se ofrece lo de GESCOLAR.
async function datosParaLlenar(codigo, fila, fases) {
  const k = String(codigo).toLowerCase();
  const v = (await pool.query(
    `SELECT datos, enviado_en FROM iu_visitas WHERE estado = 'ENVIADA' AND lower(codigo_dea) = $1
     ORDER BY enviado_en DESC NULLS LAST, id DESC LIMIT 1`, [k])).rows[0];
  const valores = (await pool.query(
    `SELECT v.clave, v.valor, v.origen, v.verificado_campo, v.actualizado_en, u.nombre AS usuario_nombre
     FROM iu_valores v LEFT JOIN usuarios u ON u.id = v.usuario_id WHERE lower(v.codigo_dea) = $1`, [k])).rows;
  const { datos, meta } = superponer(v ? v.datos : {}, v ? v.enviado_en : null, valores);
  const deGescolar = esquema.valoresDeGescolar(fila);
  const claves = new Set(camposDeFases(fases).map((c) => c.clave));
  const salida = {}; const metaSalida = {};
  claves.forEach((c) => {
    if (datos[c] !== undefined) { salida[c] = datos[c]; metaSalida[c] = meta[c]; }
    else if (deGescolar[c] !== undefined) { salida[c] = deGescolar[c]; metaSalida[c] = { fuente: "gescolar" }; }
  });
  let edificio = null;
  if (fases.includes("edificio")) {
    const est = await estadoEdificio(codigo);
    if (est.clasificado) {
      salida.comparte_edificio = est.comparte ? "SI" : "NO";
      salida.otras_instituciones = est.comparte ? est.otras : [];
      metaSalida.comparte_edificio = { fuente: "infraestructuras" };
      metaSalida.otras_instituciones = { fuente: "infraestructuras" };
      if (est.comparte) edificio = { codigo_infraestructura: est.codigo, cantidad: est.miembros.length, miembros: est.miembros };
    }
    if (!Array.isArray(salida.otras_instituciones)) salida.otras_instituciones = [];
  }
  return { datos: salida, meta: metaSalida, gescolar: deGescolar, edificio };
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

async function listarConsultas({ soloAbiertas }) {
  const { rows } = await pool.query(
    `SELECT c.id, c.nombre, c.descripcion, c.fases, c.estado, c.creado_en, c.cerrada_en, u.nombre AS creado_por_nombre,
            (SELECT COUNT(DISTINCT lower(x.codigo_dea)) FROM iu_cambios x WHERE x.consulta_id = c.id AND x.revertido_en IS NULL)::int AS planteles_actualizados,
            (SELECT COUNT(*) FROM iu_cambios x WHERE x.consulta_id = c.id AND x.revertido_en IS NULL)::int AS cambios
     FROM iu_consultas c LEFT JOIN usuarios u ON u.id = c.creado_por
     ${soloAbiertas ? "WHERE c.estado = 'ABIERTA'" : ""} ORDER BY (c.estado = 'ABIERTA') DESC, c.id DESC`);
  return rows.map((c) => ({ ...c, titulos_fases: c.fases.map((f) => (FASES.find((x) => x.id === f) || { titulo: f }).titulo) }));
}

async function crearConsulta({ nombre, descripcion, fases, usuarioId }) {
  const n = String(nombre || "").replace(/\s+/g, " ").trim();
  if (!n) throw new ErrorConsulta(400, "Ponle un nombre a la consulta.");
  if (n.length > 120) throw new ErrorConsulta(400, "El nombre es muy largo (máximo 120 caracteres).");
  const d = String(descripcion || "").replace(/\s+/g, " ").trim().slice(0, 500) || null;
  const f = validarFases(fases);
  const { rows } = await pool.query(
    "INSERT INTO iu_consultas (nombre, descripcion, fases, creado_por) VALUES ($1, $2, $3::text[], $4) RETURNING id",
    [n, d, f, usuarioId]);
  return rows[0].id;
}

async function cambiarConsulta(id, { nombre, estado }) {
  const sets = []; const params = [id];
  if (nombre !== undefined) {
    const n = String(nombre).replace(/\s+/g, " ").trim();
    if (!n || n.length > 120) throw new ErrorConsulta(400, "Nombre no válido.");
    params.push(n); sets.push(`nombre = $${params.length}`);
  }
  if (estado !== undefined) {
    if (estado !== "ABIERTA" && estado !== "CERRADA") throw new ErrorConsulta(400, "Estado no válido.");
    params.push(estado); sets.push(`estado = $${params.length}::text`);
    sets.push(estado === "CERRADA" ? "cerrada_en = NOW()" : "cerrada_en = NULL");
  }
  if (!sets.length) throw new ErrorConsulta(400, "Nada que cambiar.");
  const r = await pool.query(`UPDATE iu_consultas SET ${sets.join(", ")} WHERE id = $1`, params);
  if (!r.rowCount) throw new ErrorConsulta(404, "Consulta no encontrada.");
}

// Elimina la consulta. Los datos que ya se guardaron con ella NO se pierden:
// los valores y el historial quedan (la columna consulta_id pasa a NULL).
async function eliminarConsulta(id) {
  const r = await pool.query("DELETE FROM iu_consultas WHERE id = $1", [id]);
  if (!r.rowCount) throw new ErrorConsulta(404, "Consulta no encontrada.");
}

async function obtenerConsulta(id) {
  const c = (await pool.query("SELECT * FROM iu_consultas WHERE id = $1", [id])).rows[0];
  if (!c) throw new ErrorConsulta(404, "Consulta no encontrada.");
  return c;
}

// Cuerpo de la pantalla de llenado: las secciones de las fases de la consulta y los datos vigentes del plantel.
async function abrirPlantel(consulta, codigoPedido) {
  const codigo = String(codigoPedido || "").trim();
  if (!codigo) throw new ErrorConsulta(400, "Escribe el código DEA.");
  let fila;
  try {
    fila = await gescolar.obtenerPlantel(codigo);
  } catch (err) {
    console.error("Consultas exprés: GESCOLAR:", err.message);
    throw new ErrorConsulta(502, "No se pudo consultar GESCOLAR (Google Sheets no respondió). Intenta de nuevo en un momento.");
  }
  if (!fila) throw new ErrorConsulta(404, `El código ${codigo} no existe en GESCOLAR.`);
  const dea = String(fila[gescolar.CAMPO_CODIGO] || "").trim();
  const { datos, meta, edificio } = await datosParaLlenar(dea, fila, consulta.fases);
  return {
    plantel: { codigo_dea: dea, nombre_plantel: String(fila.nombre_plantel || "").replace(/\s+/g, " ").trim(), municipio: String(fila.municipio || "").trim(), parroquia: String(fila.parroquia || "").trim() },
    secciones: seccionesDe(consulta.fases),
    datos, meta, edificio,
    avisos: esquema.avisos(datos),
  };
}

// Guarda lo que se verificó o cambió. Devuelve { cambios, avisos }.
async function guardarPlantel({ consulta, codigoPedido, datos: entrada, nota, verificado, usuario }) {
  if (consulta.estado !== "ABIERTA") throw new ErrorConsulta(409, "Esta consulta está cerrada.");
  const abierto = await abrirPlantel(consulta, codigoPedido); // valida el código y trae lo vigente
  const dea = abierto.plantel.codigo_dea;
  const campos = camposDeFases(consulta.fases);
  const claves = new Set(campos.map((c) => c.clave));
  const enviado = entrada && typeof entrada === "object" ? entrada : {};
  // lo vigente de estas fases, con lo que llegó encima ("" vacía la pregunta)
  const mezcla = { ...abierto.datos };
  Object.keys(enviado).forEach((k) => { if (claves.has(k)) mezcla[k] = enviado[k]; });
  const { datos, errores } = esquema.validar(mezcla, { enviar: true, claves });
  if (Object.keys(errores).length) throw new ErrorConsulta(400, "Revisa los campos marcados.", { errores });

  // ---- Fase Edificio: se clasifica en Infraestructuras ANTES de guardar; si falla (409/502) no se guarda nada ----
  let clasif = null;
  let hoja = null;
  const conEdificio = consulta.fases.includes("edificio");
  if (conEdificio) {
    const comparte = datos.comparte_edificio === "SI" && datos.otras_instituciones.length > 0;
    if (comparte) {
      const errs = {};
      try {
        for (let i = 0; i < datos.otras_instituciones.length; i++) {
          const o = datos.otras_instituciones[i];
          if (!o.codigo_dea) continue;
          if (o.codigo_dea.toLowerCase() === dea.toLowerCase()) { errs[`otras_instituciones.${i}`] = "Ese es el mismo plantel."; continue; }
          const f = await gescolar.obtenerPlantel(o.codigo_dea);
          if (!f) { errs[`otras_instituciones.${i}`] = `El código ${o.codigo_dea} no existe en GESCOLAR. Si no tiene código, déjalo vacío y escribe solo el nombre.`; continue; }
          o.codigo_dea = limpio(f[gescolar.CAMPO_CODIGO]);
          o.nombre = limpio(f.nombre_plantel) || o.nombre;
        }
      } catch (err) {
        console.error("Consultas exprés: GESCOLAR:", err.message);
        throw new ErrorConsulta(502, "No se pudo consultar GESCOLAR para verificar las otras instituciones. Intenta de nuevo en un momento.");
      }
      if (Object.keys(errs).length) throw new ErrorConsulta(400, "Revisa los campos marcados.", { errores: errs });
    }
    const est = await estadoEdificio(dea);
    const hayQueClasificar = !est.clasificado || est.comparte !== comparte || (comparte && !listaIgual(datos.otras_instituciones, est.otras));
    if (hayQueClasificar) {
      try {
        clasif = await infraestructuras.clasificar({
          codigo_dea: dea, nombre: abierto.plantel.nombre_plantel, comparte, otras: datos.otras_instituciones, usuarioId: usuario.id,
        });
      } catch (err) {
        if (err instanceof infraestructuras.ErrorInfra) throw new ErrorConsulta(err.status, err.message, err.extra);
        throw err;
      }
    }
  }

  const anterior = abierto.datos;
  const marcaCampo = Boolean(verificado);
  const textoNota = String(nota || "").replace(/\s+/g, " ").trim().slice(0, 500) || null;
  const cliente = await pool.connect();
  let cambios = 0;
  try {
    await cliente.query("BEGIN");
    for (const c of campos) {
      const k = c.clave;
      const nuevo = datos[k] === undefined ? null : datos[k];
      const viejo = anterior[k] === undefined ? null : anterior[k];
      const cambio = k === "otras_instituciones" ? !listaIgual(nuevo, viejo) : !igual(nuevo, viejo);
      if (cambio) {
        cambios += 1;
        await cliente.query(
          `INSERT INTO iu_cambios (codigo_dea, clave, valor_anterior, valor_nuevo, origen, usuario_id, consulta_id, nota)
           VALUES ($1, $2, $3::jsonb, $4::jsonb, 'personal', $5, $6, $7)`,
          [dea, k, JSON.stringify(viejo), JSON.stringify(nuevo), usuario.id, consulta.id, textoNota]);
      }
      if (cambio || (marcaCampo && nuevo !== null)) {
        await cliente.query(
          `INSERT INTO iu_valores (codigo_dea, clave, valor, origen, verificado_campo, usuario_id, consulta_id, actualizado_en)
           VALUES ($1, $2, $3::jsonb, 'personal', $4, $5, $6, NOW())
           ON CONFLICT (codigo_dea, clave) DO UPDATE
             SET valor = EXCLUDED.valor, origen = 'personal', verificado_campo = EXCLUDED.verificado_campo,
                 usuario_id = EXCLUDED.usuario_id, consulta_id = EXCLUDED.consulta_id, actualizado_en = NOW()`,
          [dea, k, JSON.stringify(nuevo), marcaCampo, usuario.id, consulta.id]);
      }
    }
    await cliente.query("COMMIT");
  } catch (err) {
    await cliente.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    cliente.release();
  }
  // La hoja se completa DESPUÉS de guardar: si Google falla, lo guardado no se pierde (queda «pendiente»).
  let edificio = null;
  if (clasif) {
    const u = (await pool.query("SELECT nombre FROM usuarios WHERE id = $1", [usuario.id])).rows[0];
    hoja = await infraestructuras.sincronizarHoja(clasif, (u && u.nombre) || "");
    edificio = { codigo_infraestructura: clasif.infra.codigo, comparte: clasif.comparte, hoja_coordenadas: hoja };
  }
  return { cambios, avisos: esquema.avisos(datos), plantel: abierto.plantel, edificio };
}

// ---------------------------------------------------------------------------
// Cambios recientes (admin)
// ---------------------------------------------------------------------------

async function cambiosRecientes({ municipio, q, limite }) {
  const { rows } = await pool.query(
    `SELECT c.id, c.codigo_dea, c.clave, c.valor_anterior, c.valor_nuevo, c.origen, c.nota, c.creado_en, c.revertido_en,
            c.consulta_id, k.nombre AS consulta, u.nombre AS usuario
     FROM iu_cambios c LEFT JOIN iu_consultas k ON k.id = c.consulta_id LEFT JOIN usuarios u ON u.id = c.usuario_id
     ORDER BY c.creado_en DESC, c.id DESC LIMIT 1000`);
  let plantel = new Map();
  try {
    (await gescolar.cargarGescolar()).forEach((p) => {
      const cod = String(p[gescolar.CAMPO_CODIGO] || "").trim().toLowerCase();
      if (cod) plantel.set(cod, { nombre: String(p.nombre_plantel || "").replace(/\s+/g, " ").trim(), municipio: String(p.municipio || "").trim() });
    });
  } catch (err) {
    console.error("Cambios recientes: GESCOLAR:", err.message);
  }
  const etiquetas = new Map(esquema.todosLosCampos().map((c) => [c.clave, c]));
  etiquetas.set("otras_instituciones", { clave: "otras_instituciones", etiqueta: "Otras instituciones del edificio" });
  const mun = String(municipio || "").trim().toLowerCase();
  const texto = esquema.normalizar(q || "");
  const lista = rows.map((r) => {
    const p = plantel.get(String(r.codigo_dea).toLowerCase()) || { nombre: "", municipio: "" };
    const c = etiquetas.get(r.clave);
    return { ...r, plantel: p.nombre, municipio: p.municipio, pregunta: c ? c.etiqueta : r.clave, no_reversible: CLAVES_EDIFICIO.includes(r.clave), anterior: legible(c, r.valor_anterior), nuevo: legible(c, r.valor_nuevo) };
  }).filter((r) => (!mun || r.municipio.toLowerCase() === mun)
    && (!texto || esquema.normalizar(`${r.plantel} ${r.codigo_dea}`).includes(texto)));
  return lista.slice(0, Math.min(Math.max(Number(limite) || 200, 1), 500));
}

function legible(campo, v) {
  if (v === null || v === undefined) return "—";
  if (campo && campo.clave === "otras_instituciones") {
    return Array.isArray(v) && v.length ? v.map((o) => (o.codigo_dea ? `${o.nombre || ""} (${o.codigo_dea})` : o.nombre || "")).join("; ") : "—";
  }
  const una = (x) => {
    const op = campo && campo.opciones ? campo.opciones.find((o) => o.valor === x) : null;
    return op ? op.etiqueta : String(x);
  };
  return Array.isArray(v) ? (v.length ? v.map(una).join(", ") : "—") : una(v);
}

// Vuelve al dato anterior, solo si el dato todavía vale lo que dejó ese cambio (si no, alguien lo cambió después).
async function revertirCambio(id, usuarioId) {
  const c = (await pool.query("SELECT * FROM iu_cambios WHERE id = $1", [id])).rows[0];
  if (!c) throw new ErrorConsulta(404, "Cambio no encontrado.");
  if (c.revertido_en) throw new ErrorConsulta(409, "Este cambio ya se revirtió.");
  if (CLAVES_EDIFICIO.includes(c.clave)) {
    throw new ErrorConsulta(409, "Los cambios de edificio compartido no se revierten aquí: se corrigen desde la pantalla Infraestructuras.");
  }
  const actual = (await pool.query("SELECT valor FROM iu_valores WHERE codigo_dea = $1 AND clave = $2", [c.codigo_dea, c.clave])).rows[0];
  if (!actual || !igual(actual.valor, c.valor_nuevo)) {
    throw new ErrorConsulta(409, "Ese dato ya cambió después. Revierte primero el cambio más reciente de esa pregunta.");
  }
  const cliente = await pool.connect();
  try {
    await cliente.query("BEGIN");
    await cliente.query(
      `UPDATE iu_valores SET valor = $3::jsonb, verificado_campo = FALSE, usuario_id = $4, actualizado_en = NOW()
       WHERE codigo_dea = $1 AND clave = $2`, [c.codigo_dea, c.clave, JSON.stringify(c.valor_anterior === undefined ? null : c.valor_anterior), usuarioId]);
    await cliente.query("UPDATE iu_cambios SET revertido_en = NOW(), revertido_por = $2 WHERE id = $1", [id, usuarioId]);
    await cliente.query("COMMIT");
  } catch (err) {
    await cliente.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    cliente.release();
  }
}

module.exports = {
  ErrorConsulta, FASES, camposDeFases, datosVigentesLote, listarConsultas, crearConsulta, cambiarConsulta, eliminarConsulta,
  obtenerConsulta, abrirPlantel, guardarPlantel, cambiosRecientes, revertirCambio,
};
