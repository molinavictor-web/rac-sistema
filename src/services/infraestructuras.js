// infraestructuras.js — clasificación de los planteles de GESCOLAR en edificios (infraestructuras).
//
// Cada plantel (código DEA) está "sin clasificar", "solo en su edificio" o "comparte edificio".
// Cada edificio tiene un código INFRA-000001, INFRA-000002… generado por el sistema (tabla infraestructuras)
// y una lista de instituciones (tabla infra_miembros).
//
// Hoja "Coordenadas Planteles" (la que usa el bot): se sigue completando la columna codigo_infraestructura,
// para los edificios compartidos y, en los planteles solos que ya tienen fila, solo si la celda está vacía (como hace el bot,
// que anota el código en todos). Un edificio importado de la hoja conserva
// el código que ya tenía allí (codigo_anterior) para no desordenar al bot; los edificios nuevos llevan INFRA-….
//
// Espacios separados: un plantel puede funcionar además en otros sitios físicos (caseríos); se guardan aparte (infra_espacios)
// y no cambian la clasificación ni lo que ve el bot.
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

// Completa la hoja Coordenadas Planteles. Devuelve 'ok' | 'pendiente' | 'no_aplica' | 'no_configurada'.
//   · Edificio compartido: todos sus planteles llevan el código del edificio (se agregan filas sin coordenadas si faltan).
//   · Plantel solo: si YA tiene fila y su celda está vacía, se rellena con su código (como hace el bot); nunca se agregan
//     filas ni se pisa un código que ya tenga.
//   · Plantel que sale de un edificio compartido: su celda se vacía (y, si queda solo, se rellena como arriba).
async function sincronizarHoja(resultado, ingenieroNombre) {
  if (!coordenadas.configurada()) return "no_configurada";
  try {
    if (resultado.quitar.length) await coordenadas.quitarCodigos(resultado.quitar);
    let escrito = resultado.quitar.length > 0;
    if (resultado.deas.length) {
      const r = await coordenadas.registrarEdificio(resultado.codigo_hoja, resultado.deas, ingenieroNombre || "", {
        sobrescribir: resultado.comparte,
        agregarFilas: resultado.comparte,
      });
      escrito = escrito || r.actualizadas > 0 || r.agregadas > 0;
    }
    // un plantel solo sin fila (o con su celda ya llena) no cambia nada en la hoja
    return resultado.comparte || escrito ? "ok" : "no_aplica";
  } catch (err) {
    console.error("Infraestructuras: no se pudo escribir en la hoja Coordenadas Planteles:", err.message);
    return "pendiente";
  }
}

// ---------------------------------------------------------------------------
// Espacios separados (un mismo plantel funciona en varios sitios físicos)
// ---------------------------------------------------------------------------

const MAX_ESPACIOS = 15;

function numeroOpcional(v, min, max, etiqueta) {
  if (v === undefined || v === null || String(v).trim() === "") return { valor: null };
  const n = Number(String(v).replace(",", "."));
  if (!Number.isFinite(n) || n < min || n > max) return { error: `${etiqueta} no válido (entre ${min} y ${max}).` };
  return { valor: n };
}

// Limpia y valida la lista de espacios que envía la pantalla. Devuelve { espacios } o { error }.
function validarEspacios(lista) {
  if (!Array.isArray(lista)) return { error: "Lista de espacios no válida." };
  if (lista.length > MAX_ESPACIOS) return { error: `Máximo ${MAX_ESPACIOS} espacios separados por plantel.` };
  const espacios = [];
  for (let i = 0; i < lista.length; i++) {
    const e = lista[i] || {};
    const cual = `Espacio ${i + 1}`;
    const descripcion = limpiar(e.descripcion);
    if (!descripcion) return { error: `${cual}: escribe una descripción (por ejemplo «Casa de la Sra. Rosa»).` };
    if (descripcion.length > 150) return { error: `${cual}: la descripción es demasiado larga (máximo 150 letras).` };
    const referencia = limpiar(e.referencia);
    if (referencia.length > 300) return { error: `${cual}: la referencia es demasiado larga (máximo 300 letras).` };
    const distancia = limpiar(e.distancia);
    if (distancia.length > 100) return { error: `${cual}: la distancia es demasiado larga (máximo 100 letras).` };
    const observaciones = limpiar(e.observaciones);
    if (observaciones.length > 500) return { error: `${cual}: las observaciones son demasiado largas (máximo 500 letras).` };
    let aulas = null;
    if (!(e.aulas === undefined || e.aulas === null || String(e.aulas).trim() === "")) {
      if (!/^\d{1,3}$/.test(String(e.aulas).trim()) || Number(e.aulas) > 200) return { error: `${cual}: las aulas deben ser un número entero (0 a 200).` };
      aulas = Number(e.aulas);
    }
    const lat = numeroOpcional(e.latitud, -90, 90, `${cual}: latitud`);
    const lon = numeroOpcional(e.longitud, -180, 180, `${cual}: longitud`);
    if (lat.error || lon.error) return { error: lat.error || lon.error };
    if ((lat.valor === null) !== (lon.valor === null)) return { error: `${cual}: si indicas coordenadas, escribe latitud y longitud.` };
    const id = Number.isInteger(Number(e.id)) && Number(e.id) > 0 ? Number(e.id) : null;
    espacios.push({ id, descripcion, referencia, distancia, aulas, observaciones, latitud: lat.valor, longitud: lon.valor });
  }
  return { espacios };
}

// Reemplaza los espacios del plantel: los que traen id se actualizan (conservan su número), los nuevos reciben el
// número siguiente y los que ya no vienen se eliminan.
async function guardarEspacios(codigoDea, espacios, usuarioId = null) {
  const cliente = await pool.connect();
  try {
    await cliente.query("BEGIN");
    await cliente.query("SELECT pg_advisory_xact_lock($1)", [LOCK_ID + 1]);
    const actuales = (await cliente.query("SELECT id, numero FROM infra_espacios WHERE lower(codigo_dea) = lower($1)", [codigoDea])).rows;
    const validos = new Set(actuales.map((a) => a.id));
    const conservar = new Set(espacios.filter((e) => e.id && validos.has(e.id)).map((e) => e.id));
    for (const a of actuales) if (!conservar.has(a.id)) await cliente.query("DELETE FROM infra_espacios WHERE id = $1", [a.id]);
    let siguiente = actuales.reduce((m, a) => Math.max(m, a.numero), 0);
    for (const e of espacios) {
      const valores = [e.descripcion, e.referencia || null, e.distancia || null, e.aulas, e.observaciones || null, e.latitud, e.longitud];
      if (e.id && validos.has(e.id)) {
        await cliente.query(
          `UPDATE infra_espacios SET descripcion = $2::text, referencia = $3::text, distancia = $4::text, aulas = $5::int, observaciones = $6::text,
                  latitud = $7::float8, longitud = $8::float8, actualizado_en = NOW() WHERE id = $1`, [e.id, ...valores]);
      } else {
        siguiente += 1;
        await cliente.query(
          `INSERT INTO infra_espacios (codigo_dea, numero, descripcion, referencia, distancia, aulas, observaciones, latitud, longitud, creado_por)
           VALUES ($1::text, $2::int, $3::text, $4::text, $5::text, $6::int, $7::text, $8::float8, $9::float8, $10::int)`, [codigoDea, siguiente, ...valores, usuarioId]);
      }
    }
    await cliente.query("COMMIT");
  } catch (err) {
    await cliente.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    cliente.release();
  }
}

// Espacios de un plantel con su subcódigo (<INFRA del plantel>-E<n>; sin edificio todavía queda solo E<n>).
async function espaciosDe(codigoDea, codigoInfra = "") {
  const { rows } = await pool.query(
    `SELECT id, numero, descripcion, COALESCE(referencia, '') AS referencia, COALESCE(distancia, '') AS distancia, aulas,
            COALESCE(observaciones, '') AS observaciones, latitud, longitud
     FROM infra_espacios WHERE lower(codigo_dea) = lower($1) ORDER BY numero`, [codigoDea]);
  return rows.map((r) => ({ ...r, subcodigo: `${codigoInfra ? codigoInfra + "-" : ""}E${r.numero}` }));
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
async function listarPlanteles({ q = "", estado = "", municipio = "", parroquia = "", limite = 50, pagina = 1 }) {
  const nombres = await nombresGescolar();
  if (!nombres) throw new ErrorInfra(502, "No se pudo consultar GESCOLAR. Intenta de nuevo en un momento.");
  const { rows } = await pool.query(
    `SELECT lower(m.codigo_dea) AS k, i.codigo, i.codigo_anterior,
            (SELECT COUNT(*) FROM infra_miembros x WHERE x.infraestructura_id = i.id)::int AS cantidad
     FROM infra_miembros m JOIN infraestructuras i ON i.id = m.infraestructura_id WHERE m.codigo_dea IS NOT NULL`
  );
  const clasif = new Map(rows.map((r) => [r.k, r]));
  const esp = new Map((await pool.query("SELECT lower(codigo_dea) AS k, COUNT(*)::int AS n FROM infra_espacios GROUP BY 1")).rows.map((r) => [r.k, r.n]));
  const nq = gescolar.normalizar ? gescolar.normalizar(q) : q.toUpperCase();
  const nmun = gescolar.normalizar ? gescolar.normalizar(municipio) : municipio.toUpperCase();
  const norm = gescolar.normalizar || ((x) => String(x).toUpperCase());
  let lista = [];
  nombres.forEach((p, k) => {
    const c = clasif.get(k);
    const est = !c ? "sin_clasificar" : c.cantidad > 1 ? "comparte" : "solo";
    lista.push({ codigo_dea: p.codigo, nombre_plantel: p.nombre, municipio: p.municipio, parroquia: p.parroquia, estado: est, codigo_infraestructura: c ? c.codigo : "", codigo_anterior: c && c.codigo_anterior ? c.codigo_anterior : "", cantidad: c ? c.cantidad : 0, espacios: esp.get(k) || 0 });
  });
  const conteos = { total: lista.length, sin_clasificar: 0, solo: 0, comparte: 0 };
  lista.forEach((p) => { conteos[p.estado]++; });
  if (estado) lista = lista.filter((p) => p.estado === estado);
  if (nmun) lista = lista.filter((p) => norm(p.municipio) === nmun);
  const npar = parroquia ? norm(parroquia) : "";
  if (npar) lista = lista.filter((p) => norm(p.parroquia) === npar);
  if (nq) lista = lista.filter((p) => norm(p.nombre_plantel).includes(nq) || norm(p.codigo_dea).includes(nq));
  lista.sort((a, b) => a.municipio.localeCompare(b.municipio, "es") || a.nombre_plantel.localeCompare(b.nombre_plantel, "es"));
  const total = lista.length;
  const desde = (Math.max(1, pagina) - 1) * limite;
  return { planteles: lista.slice(desde, desde + limite), total_filtrado: total, conteos, pagina: Math.max(1, pagina), limite };
}

// Posibles edificios compartidos según el CÓDIGO: dos planteles con el mismo número y la misma terminación
// (S3806D1608 diurno + S3806N1608 nocturno). Es solo una pista: una persona confirma o descarta cada pareja.
// Se omiten las parejas que ya están en el mismo edificio. Las descartadas se devuelven aparte.
const PATRON_DN = /^S(\d{4})([DN])(\d{4})$/i;
async function sugerenciasPorCodigo() {
  const { planteles } = await listarPlanteles({ limite: 100000 });
  const grupos = new Map();
  planteles.forEach((p) => {
    const m = PATRON_DN.exec(p.codigo_dea);
    if (!m) return;
    const clave = `S${m[1]}-${m[3]}`;
    if (!grupos.has(clave)) grupos.set(clave, { D: [], N: [] });
    grupos.get(clave)[m[2].toUpperCase()].push(p);
  });
  let descartadas = new Set();
  try {
    (await pool.query("SELECT clave FROM infra_sugerencias_descartadas")).rows.forEach((r) => descartadas.add(r.clave));
  } catch (err) {
    if (err.code !== "42P01") throw err; // sin el script 31 todo funciona, solo que no se puede descartar
    descartadas = null;
  }
  const out = [], quitadas = [];
  for (const [clave, g] of grupos) {
    if (g.D.length !== 1 || g.N.length !== 1) continue; // solo parejas claras
    const [a, b] = [g.D[0], g.N[0]];
    if (a.codigo_infraestructura && a.codigo_infraestructura === b.codigo_infraestructura) continue; // ya comparten
    const conflicto = Boolean(a.codigo_infraestructura && b.codigo_infraestructura && a.cantidad > 1 && b.cantidad > 1);
    const item = { clave, a, b, conflicto };
    if (descartadas && descartadas.has(clave)) quitadas.push(item); else out.push(item);
  }
  const orden = (x, y) => x.a.municipio.localeCompare(y.a.municipio, "es") || x.a.nombre_plantel.localeCompare(y.a.nombre_plantel, "es");
  return { sugerencias: out.sort(orden), descartadas: quitadas.sort(orden), puede_descartar: descartadas !== null };
}

// Parroquias de un municipio (según GESCOLAR), sin repetir aunque varíen acentos o mayúsculas.
async function parroquiasDe(municipio) {
  const nombres = await nombresGescolar();
  if (!nombres) throw new ErrorInfra(502, "No se pudo consultar GESCOLAR. Intenta de nuevo en un momento.");
  const norm = gescolar.normalizar || ((x) => String(x).toUpperCase());
  const nmun = norm(municipio);
  const por = new Map();
  nombres.forEach((p) => {
    if (!p.parroquia || norm(p.municipio) !== nmun) return;
    const k = norm(p.parroquia);
    if (!por.has(k)) por.set(k, p.parroquia);
  });
  return [...por.values()].sort((a, b) => a.localeCompare(b, "es"));
}

// Cifras de las tarjetas. Sin filtros son las globales; con municipio y/o parroquia se calculan solo para ese ámbito
// (según GESCOLAR): así se ve el avance de la carga por municipio o por parroquia.
async function resumen({ municipio = "", parroquia = "" } = {}) {
  const norm = gescolar.normalizar || ((x) => String(x).toUpperCase());
  const nmun = municipio ? norm(municipio) : "";
  const npar = parroquia ? norm(parroquia) : "";
  const { edificios, total_gescolar, gescolar_ok } = await obtenerEdificios();
  const esp = (await pool.query("SELECT COUNT(DISTINCT lower(codigo_dea))::int AS planteles, COUNT(*)::int AS espacios FROM infra_espacios")).rows[0];

  if (!nmun && !npar) {
    const compartidos = edificios.filter((e) => e.cantidad > 1);
    const enGescolar = edificios.reduce((x, e) => x + e.en_gescolar, 0);
    return {
      alcance: "",
      planteles_con_espacios: esp.planteles,
      espacios_separados: esp.espacios,
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

  // Ámbito: planteles de GESCOLAR del municipio / la parroquia elegidos
  const nombres = await nombresGescolar();
  if (!nombres) throw new ErrorInfra(502, "No se pudo consultar GESCOLAR. Intenta de nuevo en un momento.");
  const enAmbito = new Map(); // dea (minúsculas) -> true
  nombres.forEach((p, k) => {
    if (nmun && norm(p.municipio) !== nmun) return;
    if (npar && norm(p.parroquia) !== npar) return;
    enAmbito.set(k, true);
  });
  const edifDe = new Map(); // dea -> { codigo, cantidad }
  edificios.forEach((e) => e.miembros.forEach((m) => { if (m.codigo_dea) edifDe.set(m.codigo_dea.toLowerCase(), e); }));
  let clasificados = 0, solos = 0, enCompartidos = 0, restar = 0;
  const compartidosVistos = new Set();
  const porEdificio = new Map(); // codigo -> miembros dentro del ámbito
  enAmbito.forEach((_, k) => {
    const e = edifDe.get(k);
    if (!e) return;
    clasificados++;
    if (e.cantidad > 1) { enCompartidos++; compartidosVistos.add(e.codigo_infraestructura); } else solos++;
    porEdificio.set(e.codigo_infraestructura, (porEdificio.get(e.codigo_infraestructura) || 0) + 1);
  });
  porEdificio.forEach((n) => { restar += Math.max(0, n - 1); });
  const total = enAmbito.size;
  const ids = [...enAmbito.keys()];
  const espAmbito = ids.length
    ? (await pool.query("SELECT COUNT(DISTINCT lower(codigo_dea))::int AS planteles, COUNT(*)::int AS espacios FROM infra_espacios WHERE lower(codigo_dea) = ANY($1::text[])", [ids])).rows[0]
    : { planteles: 0, espacios: 0 };
  return {
    alcance: [municipio, parroquia].filter(Boolean).join(" › "),
    planteles_con_espacios: espAmbito.planteles,
    espacios_separados: espAmbito.espacios,
    gescolar_ok,
    nombres_planteles: total,
    clasificados,
    sin_clasificar: Math.max(0, total - clasificados),
    solos,
    edificios_compartidos: compartidosVistos.size,
    nombres_en_compartidos: enCompartidos,
    infraestructuras: total ? total - restar : 0,
    codigos_generados: porEdificio.size,
  };
}

module.exports = { ErrorInfra, sincronizar, clasificar, sincronizarHoja, obtenerEdificios, listarPlanteles, sugerenciasPorCodigo, parroquiasDe, resumen, validarEspacios, guardarEspacios, espaciosDe };
