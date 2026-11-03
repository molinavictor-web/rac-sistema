// infraestructuras.js — clasificación de los planteles de GESCOLAR en edificios (infraestructuras).
//
// Cada plantel (código DEA) está "sin clasificar", "solo en su edificio" o "comparte edificio".
// Cada edificio tiene un código INFRA-000001, INFRA-000002… generado por el sistema (tabla infraestructuras)
// y una lista de instituciones (tabla infra_miembros).
//
// Hoja "Coordenadas Planteles" (la que usa el bot): se sigue completando la columna codigo_infraestructura,
// pero SOLO para los planteles que comparten edificio (como hasta ahora). Un edificio importado de la hoja conserva
// el código que ya tenía allí (codigo_anterior) para no desordenar al bot; los edificios nuevos llevan INFRA-….
//
// Reglas:
//   · Un plantel con código DEA pertenece a UN solo edificio.
//   · Al decir "comparte con X": si X (o el plantel) ya está en un edificio con varios nombres, se une a ese;
//     los edificios de UN solo nombre se fusionan sin problema (queda el de número más bajo).
//   · Si los involucrados ya están en dos edificios distintos de varios nombres → conflicto (409): no se adivina.
//   · La base de datos es la que manda; la hoja se sincroniza hacia la base de datos (importar) y se completa después.

const { pool } = require("../db/pool");
const gescolar = require("./gescolar");
const coordenadas = require("./coordenadasInfra");

class ErrorInfra extends Error {
  constructor(status, mensaje, extra) {
    super(mensaje);
    this.status = status;
    this.extra = extra || {};
  }
}

const limpiar = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim();
const minus = (v) => limpiar(v).toLowerCase();
const LOCK_ID = 7_120_001; // candado de aplicación para que dos personas no reorganicen a la vez

// ---------------------------------------------------------------------------
// Importar lo que ya existe (hoja Coordenadas + registros del Instrumento Uno anteriores)
// ---------------------------------------------------------------------------

let ultimaSync = 0;
let ultimaSyncHojaOk = true;
const VIGENCIA_SYNC_MS = 5 * 60 * 1000;

async function nombresGescolar() {
  const mapa = new Map();
  try {
    (await gescolar.cargarGescolar()).forEach((p) => {
      const c = limpiar(p[gescolar.CAMPO_CODIGO]);
      if (c) mapa.set(c.toLowerCase(), { codigo: c, nombre: limpiar(p.nombre_plantel), municipio: limpiar(p.municipio), parroquia: limpiar(p.parroquia) });
    });
  } catch (err) {
    console.error("Infraestructuras: no se pudo leer GESCOLAR:", err.message);
    return null;
  }
  return mapa;
}

// Crea (si no existen) los edificios que figuran en la hoja y en el Instrumento Uno, y clasifica como "solo"
// a los planteles que ya enviaron su Instrumento diciendo que no comparten. Es seguro repetirlo.
// Devuelve { hoja_ok }.
async function sincronizar({ forzar = false } = {}) {
  if (!forzar && Date.now() - ultimaSync < VIGENCIA_SYNC_MS) return { hoja_ok: ultimaSyncHojaOk };
  const nombres = await nombresGescolar();
  let hojaOk = true;
  const grupos = new Map(); // código viejo (minúsculas) -> { codigo, miembros: Map(dea minúscula -> dea) }
  if (coordenadas.configurada()) {
    try {
      (await coordenadas.leerFilas()).forEach((f) => {
        if (!f.codigo_infraestructura) return;
        const k = f.codigo_infraestructura.toLowerCase();
        if (!grupos.has(k)) grupos.set(k, { codigo: f.codigo_infraestructura, miembros: new Map() });
        grupos.get(k).miembros.set(f.codigo_dea.toLowerCase(), f.codigo_dea);
      });
    } catch (err) {
      hojaOk = false;
      console.error("Infraestructuras: no se pudo leer la hoja Coordenadas Planteles:", err.message);
    }
  }
  const cliente = await pool.connect();
  try {
    await cliente.query("BEGIN");
    await cliente.query("SELECT pg_advisory_xact_lock($1)", [LOCK_ID]);

    // 1) Edificios de la hoja
    for (const g of grupos.values()) {
      let infra = (await cliente.query("SELECT id FROM infraestructuras WHERE lower(codigo_anterior) = lower($1)", [g.codigo])).rows[0];
      for (const [kdea, dea] of g.miembros) {
        const ya = (await cliente.query("SELECT infraestructura_id FROM infra_miembros WHERE lower(codigo_dea) = $1", [kdea])).rows[0];
        if (ya) continue; // ya está en algún edificio: la base de datos manda
        if (!infra) infra = (await cliente.query("INSERT INTO infraestructuras (codigo_anterior) VALUES ($1) RETURNING id", [g.codigo])).rows[0];
        const info = nombres && nombres.get(kdea);
        await cliente.query("INSERT INTO infra_miembros (infraestructura_id, codigo_dea, nombre) VALUES ($1, $2::text, $3::text) ON CONFLICT DO NOTHING", [infra.id, info ? info.codigo : dea, (info && info.nombre) || dea]);
      }
    }
    // 2) Edificios compartidos registrados por el Instrumento Uno antes de existir esta pantalla
    const viejos = (await cliente.query("SELECT codigo_infraestructura, codigo_dea, nombre FROM iu_edificio_miembros ORDER BY id")).rows;
    const porViejo = new Map();
    viejos.forEach((r) => { const k = r.codigo_infraestructura.toLowerCase(); if (!porViejo.has(k)) porViejo.set(k, { codigo: r.codigo_infraestructura, filas: [] }); porViejo.get(k).filas.push(r); });
    for (const g of porViejo.values()) {
      let infra = (await cliente.query("SELECT id FROM infraestructuras WHERE lower(codigo_anterior) = lower($1)", [g.codigo])).rows[0];
      for (const r of g.filas) {
        if (r.codigo_dea) {
          const ya = (await cliente.query("SELECT 1 FROM infra_miembros WHERE lower(codigo_dea) = lower($1)", [r.codigo_dea])).rows[0];
          if (ya) continue;
        }
        if (!infra) infra = (await cliente.query("INSERT INTO infraestructuras (codigo_anterior) VALUES ($1) RETURNING id", [g.codigo])).rows[0];
        const info = r.codigo_dea && nombres && nombres.get(r.codigo_dea.toLowerCase());
        await cliente.query("INSERT INTO infra_miembros (infraestructura_id, codigo_dea, nombre) VALUES ($1, NULLIF($2::text, ''), $3::text) ON CONFLICT DO NOTHING", [infra.id, r.codigo_dea || "", (info && info.nombre) || r.nombre || r.codigo_dea]);
      }
    }
    // 3) Planteles cuya visita ENVIADA dijo "no comparte": quedan clasificados como solos
    const solos = (await cliente.query(
      `SELECT DISTINCT ON (lower(v.codigo_dea)) v.codigo_dea, COALESCE(v.datos->>'nombre_plantel', v.gescolar->>'nombre_plantel', v.codigo_dea) AS nombre
       FROM iu_visitas v
       WHERE v.estado = 'ENVIADA' AND v.datos->>'comparte_edificio' = 'NO'
         AND NOT EXISTS (SELECT 1 FROM infra_miembros m WHERE lower(m.codigo_dea) = lower(v.codigo_dea))
       ORDER BY lower(v.codigo_dea), v.enviado_en`
    )).rows;
    for (const s of solos) {
      const infra = (await cliente.query("INSERT INTO infraestructuras DEFAULT VALUES RETURNING id")).rows[0];
      const info = nombres && nombres.get(s.codigo_dea.toLowerCase());
      await cliente.query("INSERT INTO infra_miembros (infraestructura_id, codigo_dea, nombre) VALUES ($1, $2::text, $3::text) ON CONFLICT DO NOTHING", [infra.id, info ? info.codigo : s.codigo_dea, (info && info.nombre) || s.nombre]);
    }
    // 4) Las visitas enviadas muestran el código vigente de su edificio
    await cliente.query(
      `UPDATE iu_visitas v SET codigo_infraestructura = i.codigo
       FROM infra_miembros m JOIN infraestructuras i ON i.id = m.infraestructura_id
       WHERE lower(m.codigo_dea) = lower(v.codigo_dea) AND v.estado = 'ENVIADA' AND v.codigo_infraestructura IS DISTINCT FROM i.codigo`
    );
    await cliente.query("COMMIT");
  } catch (err) {
    await cliente.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    cliente.release();
  }
  ultimaSync = Date.now();
  ultimaSyncHojaOk = hojaOk;
  return { hoja_ok: hojaOk };
}

// ---------------------------------------------------------------------------
// Clasificar
// ---------------------------------------------------------------------------

const codigoEnHoja = (infra) => infra.codigo_anterior || infra.codigo;

/**
 * Clasifica un plantel.
 *   comparte=false → queda solo en su edificio (si estaba en uno compartido, sale de él).
 *   comparte=true  → comparte con `otras` [{codigo_dea, nombre}] (código DEA o solo nombre).
 * Devuelve { infra: {id, codigo, codigo_anterior}, deas: [...], quitar: [...], codigo_hoja, comparte }.
 * Lo que toca la hoja se hace después con sincronizarHoja(), para que un fallo de Google no pierda lo guardado.
 */
async function clasificar({ codigo_dea, nombre, comparte, otras = [], usuarioId = null }) {
  const principal = limpiar(codigo_dea);
  if (!principal) throw new ErrorInfra(400, "Falta el código DEA del plantel.");
  if (comparte && !otras.length) throw new ErrorInfra(400, "Indica con qué institución comparte el edificio.");
  if (coordenadas.configurada()) {
    // Antes de decidir, se trae lo que ya haya en la hoja; si Google no responde, no se arriesga a partir un edificio.
    const s = await sincronizar({ forzar: true });
    if (!s.hoja_ok) throw new ErrorInfra(502, "No se pudo leer la hoja «Coordenadas Planteles» (Google no respondió). No se guardó nada; intenta de nuevo en un momento.");
  } else {
    await sincronizar({ forzar: true });
  }

  const miembros = [{ codigo_dea: principal, nombre: limpiar(nombre) || principal }];
  if (comparte) {
    const vistos = new Set([principal.toLowerCase()]);
    otras.forEach((o) => {
      const c = limpiar(o.codigo_dea);
      const n = limpiar(o.nombre);
      const k = c ? c.toLowerCase() : "n:" + n.toLowerCase();
      if ((!c && !n) || vistos.has(k)) return;
      vistos.add(k);
      miembros.push({ codigo_dea: c, nombre: n || c });
    });
    if (miembros.length < 2) throw new ErrorInfra(400, "Indica con qué otra institución comparte el edificio.");
  }

  const cliente = await pool.connect();
  try {
    await cliente.query("BEGIN");
    await cliente.query("SELECT pg_advisory_xact_lock($1)", [LOCK_ID]);
    const quitar = [];

    const infraDe = async (dea) => (await cliente.query(
      `SELECT i.id, i.codigo, i.codigo_anterior, i.numero, (SELECT COUNT(*) FROM infra_miembros x WHERE x.infraestructura_id = i.id)::int AS cantidad
       FROM infra_miembros m JOIN infraestructuras i ON i.id = m.infraestructura_id WHERE lower(m.codigo_dea) = lower($1)`, [dea])).rows[0] || null;
    const nueva = async (anterior) => (await cliente.query("INSERT INTO infraestructuras (codigo_anterior, creado_por) VALUES ($1, $2) RETURNING id, codigo, codigo_anterior, numero", [anterior || null, usuarioId])).rows[0];
    const agregar = (infraId, m) => cliente.query(
      "INSERT INTO infra_miembros (infraestructura_id, codigo_dea, nombre, creado_por) VALUES ($1, NULLIF($2::text, ''), $3::text, $4) ON CONFLICT DO NOTHING", [infraId, m.codigo_dea, m.nombre, usuarioId]);

    let destino;
    if (!comparte) {
      const actual = await infraDe(principal);
      if (actual && actual.cantidad === 1) {
        destino = actual;
      } else {
        if (actual) {
          await cliente.query("DELETE FROM infra_miembros WHERE lower(codigo_dea) = lower($1)", [principal]);
          quitar.push(principal);
        }
        destino = await nueva(null);
        await agregar(destino.id, miembros[0]);
      }
    } else {
      // edificios involucrados (por los que tengan código DEA)
      const encontrados = new Map();
      for (const m of miembros) {
        if (!m.codigo_dea) continue;
        const e = await infraDe(m.codigo_dea);
        if (e) encontrados.set(e.id, e);
      }
      // los que ya están en un edificio de varios nombres no se pueden fusionar solos
      const varios = [...encontrados.values()].filter((e) => e.cantidad > 1);
      if (varios.length > 1) {
        await cliente.query("ROLLBACK");
        throw new ErrorInfra(409, `Estas instituciones ya pertenecen a edificios distintos (${varios.map((e) => e.codigo).join(", ")}). Un coordinador debe unificarlos antes.`, { edificios: varios.map((e) => e.codigo) });
      }
      const todos = [...encontrados.values()].sort((a, b) => a.numero - b.numero);
      destino = varios[0] || todos[0] || (await nueva(null));
      // los edificios de un solo nombre se absorben (queda el de número más bajo / el compartido)
      for (const e of todos) {
        if (e.id === destino.id) continue;
        await cliente.query("UPDATE infra_miembros SET infraestructura_id = $1 WHERE infraestructura_id = $2 AND codigo_dea IS NOT NULL", [destino.id, e.id]);
        await cliente.query("DELETE FROM infraestructuras WHERE id = $1", [e.id]);
      }
      for (const m of miembros) await agregar(destino.id, m);
    }
    await cliente.query("COMMIT");
    const deas = (await pool.query("SELECT codigo_dea FROM infra_miembros WHERE infraestructura_id = $1 AND codigo_dea IS NOT NULL ORDER BY id", [destino.id])).rows.map((r) => r.codigo_dea);
    const total = (await pool.query("SELECT COUNT(*)::int AS n FROM infra_miembros WHERE infraestructura_id = $1", [destino.id])).rows[0].n;
    return { infra: { id: destino.id, codigo: destino.codigo, codigo_anterior: destino.codigo_anterior }, deas, quitar, codigo_hoja: codigoEnHoja(destino), comparte: total > 1 };
  } catch (err) {
    await cliente.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    cliente.release();
  }
}

// Completa la hoja Coordenadas Planteles (solo edificios compartidos). Devuelve 'ok' | 'pendiente' | 'no_aplica' | 'no_configurada'.
async function sincronizarHoja(resultado, ingenieroNombre) {
  if (!coordenadas.configurada()) return resultado.comparte || resultado.quitar.length ? "no_configurada" : "no_aplica";
  if (!resultado.comparte && !resultado.quitar.length) return "no_aplica";
  try {
    if (resultado.quitar.length) await coordenadas.quitarCodigos(resultado.quitar);
    if (resultado.comparte && resultado.deas.length) await coordenadas.registrarEdificio(resultado.codigo_hoja, resultado.deas, ingenieroNombre || "", { sobrescribir: true });
    return "ok";
  } catch (err) {
    console.error("Infraestructuras: no se pudo escribir en la hoja Coordenadas Planteles:", err.message);
    return "pendiente";
  }
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

// Todos los edificios con sus instituciones y cuántas de ellas están en GESCOLAR.
async function obtenerEdificios() {
  const nombres = await nombresGescolar();
  const { rows } = await pool.query(
    `SELECT i.id, i.codigo, i.codigo_anterior, i.numero, m.codigo_dea, m.nombre
     FROM infraestructuras i JOIN infra_miembros m ON m.infraestructura_id = i.id
     ORDER BY i.numero, m.id`
  );
  const por = new Map();
  rows.forEach((r) => {
    if (!por.has(r.id)) por.set(r.id, { codigo_infraestructura: r.codigo, codigo_anterior: r.codigo_anterior, numero: r.numero, miembros: [] });
    const info = r.codigo_dea && nombres && nombres.get(r.codigo_dea.toLowerCase());
    por.get(r.id).miembros.push({ codigo_dea: r.codigo_dea || "", nombre: (info && info.nombre) || r.nombre || "" });
  });
  const edificios = [...por.values()].map((e) => ({
    ...e,
    cantidad: e.miembros.length,
    en_gescolar: e.miembros.filter((m) => m.codigo_dea && nombres && nombres.has(m.codigo_dea.toLowerCase())).length,
  }));
  return { edificios, total_gescolar: nombres ? nombres.size : 0, gescolar_ok: Boolean(nombres) };
}

// Planteles de GESCOLAR con su clasificación. estado: sin_clasificar | solo | comparte | (vacío = todos)
async function listarPlanteles({ q = "", estado = "", municipio = "", limite = 50, pagina = 1 }) {
  const nombres = await nombresGescolar();
  if (!nombres) throw new ErrorInfra(502, "No se pudo consultar GESCOLAR. Intenta de nuevo en un momento.");
  const { rows } = await pool.query(
    `SELECT lower(m.codigo_dea) AS k, i.codigo, i.codigo_anterior,
            (SELECT COUNT(*) FROM infra_miembros x WHERE x.infraestructura_id = i.id)::int AS cantidad
     FROM infra_miembros m JOIN infraestructuras i ON i.id = m.infraestructura_id WHERE m.codigo_dea IS NOT NULL`
  );
  const clasif = new Map(rows.map((r) => [r.k, r]));
  const nq = gescolar.normalizar ? gescolar.normalizar(q) : q.toUpperCase();
  const nmun = gescolar.normalizar ? gescolar.normalizar(municipio) : municipio.toUpperCase();
  const norm = gescolar.normalizar || ((x) => String(x).toUpperCase());
  let lista = [];
  nombres.forEach((p, k) => {
    const c = clasif.get(k);
    const est = !c ? "sin_clasificar" : c.cantidad > 1 ? "comparte" : "solo";
    lista.push({ codigo_dea: p.codigo, nombre_plantel: p.nombre, municipio: p.municipio, parroquia: p.parroquia, estado: est, codigo_infraestructura: c ? c.codigo : "", codigo_anterior: c && c.codigo_anterior ? c.codigo_anterior : "", cantidad: c ? c.cantidad : 0 });
  });
  const conteos = { total: lista.length, sin_clasificar: 0, solo: 0, comparte: 0 };
  lista.forEach((p) => { conteos[p.estado]++; });
  if (estado) lista = lista.filter((p) => p.estado === estado);
  if (nmun) lista = lista.filter((p) => norm(p.municipio) === nmun);
  if (nq) lista = lista.filter((p) => norm(p.nombre_plantel).includes(nq) || norm(p.codigo_dea).includes(nq));
  lista.sort((a, b) => a.municipio.localeCompare(b.municipio, "es") || a.nombre_plantel.localeCompare(b.nombre_plantel, "es"));
  const total = lista.length;
  const desde = (Math.max(1, pagina) - 1) * limite;
  return { planteles: lista.slice(desde, desde + limite), total_filtrado: total, conteos, pagina: Math.max(1, pagina), limite };
}

async function resumen() {
  const { edificios, total_gescolar, gescolar_ok } = await obtenerEdificios();
  const compartidos = edificios.filter((e) => e.cantidad > 1);
  const enGescolar = edificios.reduce((x, e) => x + e.en_gescolar, 0);
  return {
    gescolar_ok,
    nombres_planteles: total_gescolar,
    clasificados: enGescolar,
    sin_clasificar: Math.max(0, total_gescolar - enGescolar),
    solos: edificios.filter((e) => e.cantidad === 1).length,
    edificios_compartidos: compartidos.length,
    nombres_en_compartidos: compartidos.reduce((x, e) => x + e.cantidad, 0),
    // Edificios si todo plantel sin clasificar estuviera solo (baja a medida que se registran compartidos).
    infraestructuras: total_gescolar ? total_gescolar - edificios.reduce((x, e) => x + Math.max(0, e.en_gescolar - 1), 0) : null,
    codigos_generados: edificios.length,
  };
}

module.exports = { ErrorInfra, sincronizar, clasificar, sincronizarHoja, obtenerEdificios, listarPlanteles, resumen };
