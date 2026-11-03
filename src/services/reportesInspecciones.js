// reportesInspecciones.js — "Reportes por plan" del módulo Inspecciones.
//
// Arma una tabla con los planteles ACTIVOS de un plan de atención y las columnas que la persona elija
// de un catálogo CERRADO (definido aquí, en el servidor): identificación, matrícula, edificio
// (solo / comparte), inspección y director. Nunca se arma SQL con nombres que vengan del navegador:
// las columnas pedidas se validan contra el catálogo.
//
// De dónde sale cada dato:
//   · Identificación, matrícula y director: de la planilla de cada plantel, es decir, la copia de GESCOLAR
//     hecha al enlazarlo (membrete) más lo que el ingeniero haya corregido a mano en la planilla.
//     Es el mismo criterio de los consolidados: el reporte coincide con lo que dice la planilla.
//   · Edificio: de Infraestructuras (tablas infraestructuras / infra_miembros / infra_espacios).
//     La matrícula del edificio suma la de todas sus instituciones que tengan código DEA; para las que
//     no están en este plan se usa GESCOLAR vigente (caché de 15 min). Una institución anotada solo por
//     nombre (sin DEA) no tiene matrícula y no suma: el reporte lo avisa.
//   · Inspección: estado, fecha e ingenieros de la planilla; cuántos rubros y adicionales tienen cantidad.

const { pool } = require("../db/pool");
const gescolar = require("./gescolar");
const infra = require("./infraestructuras");

// ---------------------------------------------------------------------------
// Catálogo de columnas
// ---------------------------------------------------------------------------
// tipo: "texto" | "entero" ; sumable: se suma en la fila de totales ; roles: si existe, solo esos perfiles la ven.
const ROLES_DIRECTOR = ["admin", "insp_coordinador"];

const GRUPOS = [
  { id: "plantel", etiqueta: "Datos del plantel" },
  { id: "matricula", etiqueta: "Matrícula" },
  { id: "edificio", etiqueta: "Edificio" },
  { id: "inspeccion", etiqueta: "Inspección" },
  { id: "director", etiqueta: "Director (datos de contacto)" },
];

const COLUMNAS = [
  { id: "codigo", grupo: "plantel", etiqueta: "Código DEA", tipo: "texto", ancho: 14 },
  { id: "nombre", grupo: "plantel", etiqueta: "Plantel", tipo: "texto", ancho: 46 },
  { id: "municipio", grupo: "plantel", etiqueta: "Municipio", tipo: "texto", ancho: 16 },
  { id: "parroquia", grupo: "plantel", etiqueta: "Parroquia", tipo: "texto", ancho: 20 },
  { id: "comuna", grupo: "plantel", etiqueta: "Comuna (circuito)", tipo: "texto", ancho: 26 },
  { id: "direccion", grupo: "plantel", etiqueta: "Dirección", tipo: "texto", ancho: 40 },
  { id: "nivel", grupo: "plantel", etiqueta: "Nivel principal", tipo: "texto", ancho: 18 },
  { id: "modalidad", grupo: "plantel", etiqueta: "Modalidad principal", tipo: "texto", ancho: 20 },
  { id: "zona", grupo: "plantel", etiqueta: "Zona de ubicación", tipo: "texto", ancho: 16 },

  { id: "mat_total", grupo: "matricula", etiqueta: "Matrícula total", tipo: "entero", sumable: true, ancho: 12 },
  { id: "mat_maternal", grupo: "matricula", etiqueta: "Maternal", tipo: "entero", sumable: true, ancho: 11, gescolar: "total_maternal" },
  { id: "mat_preescolar", grupo: "matricula", etiqueta: "Preescolar", tipo: "entero", sumable: true, ancho: 11, gescolar: "total_preescolar" },
  { id: "mat_primaria", grupo: "matricula", etiqueta: "Primaria", tipo: "entero", sumable: true, ancho: 11, gescolar: "total_primaria" },
  { id: "mat_media_general", grupo: "matricula", etiqueta: "Media general", tipo: "entero", sumable: true, ancho: 12, gescolar: "total_media_general" },
  { id: "mat_media", grupo: "matricula", etiqueta: "Media", tipo: "entero", sumable: true, ancho: 10, gescolar: "total_media" },
  { id: "mat_tecnica", grupo: "matricula", etiqueta: "Técnica", tipo: "entero", sumable: true, ancho: 10, gescolar: "total_tecnica" },
  { id: "mat_adulto", grupo: "matricula", etiqueta: "Adulto", tipo: "entero", sumable: true, ancho: 10, gescolar: "total_adulto" },
  { id: "mat_mr", grupo: "matricula", etiqueta: "Misión Ribas", tipo: "entero", sumable: true, ancho: 12, gescolar: "total_mr" },
  { id: "mat_ribas_tecnica", grupo: "matricula", etiqueta: "Ribas técnica", tipo: "entero", sumable: true, ancho: 12, gescolar: "total_ribas_tecnica" },
  { id: "mat_especial", grupo: "matricula", etiqueta: "Especial", tipo: "entero", sumable: true, ancho: 10, gescolar: "total_especial" },

  { id: "edificio_estado", grupo: "edificio", etiqueta: "Edificio", tipo: "texto", ancho: 20 },
  { id: "edificio_codigo", grupo: "edificio", etiqueta: "Código de infraestructura", tipo: "texto", ancho: 17 },
  { id: "edificio_instituciones", grupo: "edificio", etiqueta: "Instituciones en el edificio", tipo: "entero", ancho: 14 },
  { id: "edificio_comparte_con", grupo: "edificio", etiqueta: "Comparte con", tipo: "texto", ancho: 50 },
  { id: "edificio_matricula", grupo: "edificio", etiqueta: "Matrícula del edificio (todas sus instituciones)", tipo: "entero", ancho: 18 },
  { id: "espacios_separados", grupo: "edificio", etiqueta: "Espacios separados", tipo: "entero", sumable: true, ancho: 11 },

  { id: "insp_estado", grupo: "inspeccion", etiqueta: "Estado de la planilla", tipo: "texto", ancho: 14 },
  { id: "insp_fecha", grupo: "inspeccion", etiqueta: "Fecha de inspección", tipo: "texto", ancho: 13 },
  { id: "insp_responsable", grupo: "inspeccion", etiqueta: "Ingeniero responsable", tipo: "texto", ancho: 26 },
  { id: "insp_ingenieros", grupo: "inspeccion", etiqueta: "Ingenieros", tipo: "texto", ancho: 40 },
  { id: "insp_rubros", grupo: "inspeccion", etiqueta: "Rubros con cantidad", tipo: "entero", ancho: 11 },
  { id: "insp_adicionales", grupo: "inspeccion", etiqueta: "Adicionales con cantidad", tipo: "entero", ancho: 12 },

  { id: "director_nombre", grupo: "director", etiqueta: "Director", tipo: "texto", ancho: 30, roles: ROLES_DIRECTOR },
  { id: "director_telefono", grupo: "director", etiqueta: "Teléfono del director", tipo: "texto", ancho: 16, roles: ROLES_DIRECTOR },
];

const PRESETS = [
  { id: "esencial", etiqueta: "Esencial", columnas: ["codigo", "nombre", "municipio", "parroquia", "mat_total", "edificio_estado", "edificio_codigo"] },
  { id: "matricula_edificio", etiqueta: "Matrícula y edificio", columnas: ["codigo", "nombre", "municipio", "parroquia", "mat_total", "edificio_estado", "edificio_codigo", "edificio_instituciones", "edificio_comparte_con", "edificio_matricula", "espacios_separados"] },
  { id: "matricula_niveles", etiqueta: "Matrícula por nivel", columnas: ["codigo", "nombre", "municipio", "parroquia", "mat_total", "mat_maternal", "mat_preescolar", "mat_primaria", "mat_media_general", "mat_media", "mat_tecnica", "mat_adulto", "mat_especial"] },
  { id: "seguimiento", etiqueta: "Seguimiento de la inspección", columnas: ["codigo", "nombre", "municipio", "parroquia", "insp_estado", "insp_fecha", "insp_responsable", "insp_rubros", "insp_adicionales"] },
];

const POR_ID = new Map(COLUMNAS.map((c) => [c.id, c]));

function visibles(rol) {
  return COLUMNAS.filter((c) => !c.roles || c.roles.includes(rol));
}

// Catálogo que ve cada perfil (sin las columnas que no le corresponden).
function catalogoPara(rol) {
  const cols = visibles(rol);
  const ok = new Set(cols.map((c) => c.id));
  return {
    grupos: GRUPOS.filter((g) => cols.some((c) => c.grupo === g.id)),
    columnas: cols.map(({ id, grupo, etiqueta, tipo }) => ({ id, grupo, etiqueta, tipo })),
    presets: PRESETS.map((p) => ({ ...p, columnas: p.columnas.filter((id) => ok.has(id)) })),
  };
}

class ErrorReporte extends Error {
  constructor(estado, mensaje) { super(mensaje); this.estado = estado; }
}

// Valida lo que pidió el navegador. Orden = el orden del catálogo (no el que lleguen), sin repetidas.
function validarColumnas(pedidas, rol) {
  const lista = String(pedidas || "").split(",").map((x) => x.trim()).filter(Boolean);
  if (!lista.length) throw new ErrorReporte(400, "Elige al menos una columna.");
  if (lista.length > COLUMNAS.length) throw new ErrorReporte(400, "Demasiadas columnas.");
  const permitidas = new Set(visibles(rol).map((c) => c.id));
  for (const id of lista) {
    if (!POR_ID.has(id)) throw new ErrorReporte(400, `Columna desconocida: ${id.slice(0, 40)}.`);
    if (!permitidas.has(id)) throw new ErrorReporte(403, "No tienes permiso para una de las columnas pedidas.");
  }
  const set = new Set(lista);
  return COLUMNAS.filter((c) => set.has(c.id));
}

// ---------------------------------------------------------------------------
// Lectura de los datos de GESCOLAR guardados en la planilla (membrete)
// ---------------------------------------------------------------------------
// GESCOLAR llega a veces con la codificación dañada (UTF-8 leído como Windows-1252). Misma corrección que
// usa la planilla en routes/inspecciones.js (se repite aquí para no tocar ese archivo, que es muy grande).
const CP1252 = {
  0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88,
  0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93,
  0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B,
  0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F,
};
function arreglarCodificacion(texto) {
  if (typeof texto !== "string" || !/[ÃÂ]/.test(texto)) return texto;
  const bytes = [];
  for (const ch of texto) {
    const c = ch.codePointAt(0);
    if (c < 256) bytes.push(c);
    else if (CP1252[c] !== undefined) bytes.push(CP1252[c]);
    else return texto;
  }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes)); } catch (_) { return texto; }
}

function normalizarClave(k) {
  return String(arreglarCodificacion(String(k))).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

// Teléfonos: GESCOLAR trae los celulares sin el 0 inicial y algunos de relleno (0, 2920000000).
function formatearTelefono(valor) {
  const digitos = String(valor === undefined || valor === null ? "" : valor).replace(/\D/g, "");
  if (!digitos || /^0+$/.test(digitos) || /0000000$/.test(digitos)) return "";
  const d = digitos.length === 10 ? "0" + digitos : digitos;
  return d.length === 11 ? `${d.slice(0, 4)}-${d.slice(4)}` : String(valor).trim();
}

// Número entero de una celda de GESCOLAR ("125", "1.234", "125,0"); null si está vacía o no es número.
function aEntero(valor) {
  if (valor === undefined || valor === null) return null;
  let t = String(valor).trim();
  if (!t) return null;
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  t = t.replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = Math.round(Number(t));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// Mapa { clave normalizada → valor } de una fila de GESCOLAR / de un membrete.
function mapaNormalizado(fila) {
  const m = {};
  Object.keys(fila || {}).forEach((k) => { m[normalizarClave(k)] = fila[k]; });
  return m;
}

const texto = (v) => (v === undefined || v === null ? "" : arreglarCodificacion(String(v).trim()));

function primero(mapa, candidatos) {
  for (const c of candidatos) { const v = texto(mapa[c]); if (v) return v; }
  return "";
}

// Matrícula total de una fila (acepta los nombres que ha tenido la columna).
function matriculaTotalDe(mapa) {
  for (const c of ["total_matricula_registrada", "matricula_total", "total_matricula", "matricula"]) {
    const n = aEntero(mapa[c]);
    if (n !== null) return n;
  }
  return null;
}

// Lo que se muestra en la planilla de un plantel: lo corregido a mano si existe; si no, lo de la copia de GESCOLAR.
function datosDePlanilla(membrete) {
  const mapa = mapaNormalizado(membrete);
  const editado = (membrete && membrete.planilla) || {};
  const efectivo = (clave, base) => (Object.prototype.hasOwnProperty.call(editado, clave) ? texto(editado[clave]) : base);
  const matBase = matriculaTotalDe(mapa);
  const matEditada = Object.prototype.hasOwnProperty.call(editado, "matricula") ? aEntero(editado.matricula) : undefined;
  return {
    mapa,
    nombre: efectivo("institucion", primero(mapa, ["nombre_plantel"])),
    municipio: efectivo("municipio", primero(mapa, ["municipio"])),
    parroquia: efectivo("parroquia", primero(mapa, ["parroquia"])),
    comuna: efectivo("comuna", primero(mapa, ["nomb_circuito"])),
    direccion: efectivo("direccion", primero(mapa, ["direccion", "direccion_plantel", "direccion_del_plantel"])),
    director: efectivo("director", primero(mapa, ["director_nombre"])),
    telefono: Object.prototype.hasOwnProperty.call(editado, "telefono")
      ? texto(editado.telefono)
      : formatearTelefono(mapa.telefono_movil_director) || formatearTelefono(mapa.telefono_director),
    matricula: matEditada !== undefined ? matEditada : matBase,
  };
}

// ---------------------------------------------------------------------------
// Armado del reporte
// ---------------------------------------------------------------------------

function fechaISO(valor) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(valor || ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

const ETIQUETA_EDIFICIO = { solo: "Solo en su edificio", comparte: "Comparte edificio", sin_clasificar: "Sin clasificar" };

async function armarReportePlan(planId, columnas) {
  const plan = (await pool.query("SELECT id, nombre, descripcion, estado FROM planes_atencion WHERE id = $1", [planId])).rows[0];
  if (!plan) return null;

  const { rows } = await pool.query(
    `SELECT pi.inspeccion_id, pi.codigo_dea, i.fecha_inspeccion::text AS fecha, i.estado, i.membrete
     FROM plan_inspecciones pi JOIN inspecciones i ON i.id = pi.inspeccion_id
     WHERE pi.plan_id = $1 AND pi.desenlazado_en IS NULL`,
    [planId]
  );
  const ids = rows.map((r) => r.inspeccion_id);

  const ing = new Map(); // inspeccion_id -> [nombres en orden]
  const rubros = new Map();
  const adic = new Map();
  if (ids.length) {
    (await pool.query("SELECT inspeccion_id, nombre FROM inspeccion_inspectores WHERE inspeccion_id = ANY($1::int[]) ORDER BY inspeccion_id, orden", [ids]))
      .rows.forEach((r) => { (ing.get(r.inspeccion_id) || ing.set(r.inspeccion_id, []).get(r.inspeccion_id)).push(r.nombre); });
    (await pool.query("SELECT inspeccion_id, COUNT(*)::int AS n FROM inspeccion_materiales WHERE inspeccion_id = ANY($1::int[]) AND cantidad > 0 GROUP BY 1", [ids]))
      .rows.forEach((r) => rubros.set(r.inspeccion_id, r.n));
    (await pool.query("SELECT inspeccion_id, COUNT(*)::int AS n FROM inspeccion_adicionales WHERE inspeccion_id = ANY($1::int[]) AND cantidad > 0 GROUP BY 1", [ids]))
      .rows.forEach((r) => adic.set(r.inspeccion_id, r.n));
  }

  const pideEdificio = columnas.some((c) => c.grupo === "edificio");
  const edifDe = new Map(); // dea (minúsculas) -> edificio
  const espacios = new Map();
  let gescolarVigente = new Map(); // dea -> matrícula total vigente en GESCOLAR
  let avisoMatricula = "";
  if (pideEdificio) {
    const { edificios } = await infra.obtenerEdificios();
    edificios.forEach((e) => e.miembros.forEach((m) => { if (m.codigo_dea) edifDe.set(m.codigo_dea.toLowerCase(), e); }));
    (await pool.query("SELECT lower(codigo_dea) AS k, COUNT(*)::int AS n FROM infra_espacios GROUP BY 1")).rows.forEach((r) => espacios.set(r.k, r.n));
    if (columnas.some((c) => c.id === "edificio_matricula")) {
      try {
        (await gescolar.cargarGescolar()).forEach((p) => {
          const dea = texto(p[gescolar.CAMPO_CODIGO]).toLowerCase();
          if (dea) gescolarVigente.set(dea, matriculaTotalDe(mapaNormalizado(p)));
        });
      } catch (err) {
        console.error("Reportes: no se pudo leer GESCOLAR para la matrícula del edificio:", err.message);
        gescolarVigente = null;
        avisoMatricula = "No se pudo consultar GESCOLAR: la matrícula del edificio solo suma las instituciones que están en este plan.";
      }
    }
  }

  // Datos efectivos de cada plantel del plan (también sirven para la matrícula de su edificio).
  const planillas = new Map(rows.map((r) => [r.inspeccion_id, datosDePlanilla(r.membrete)]));
  const matriculaEnPlan = new Map();
  rows.forEach((r) => { const d = planillas.get(r.inspeccion_id); matriculaEnPlan.set(String(r.codigo_dea || "").toLowerCase(), d.matricula); });

  const edificioSinDatos = new Set();
  const filas = rows.map((r) => {
    const d = planillas.get(r.inspeccion_id);
    const dea = String(r.codigo_dea || "").toLowerCase();
    const e = edifDe.get(dea);
    const estado = !e ? "sin_clasificar" : e.cantidad > 1 ? "comparte" : "solo";
    const otras = e ? e.miembros.filter((m) => !m.codigo_dea || m.codigo_dea.toLowerCase() !== dea) : [];
    let matEdificio = null;
    if (e && columnas.some((c) => c.id === "edificio_matricula")) {
      let suma = 0; let faltan = 0;
      e.miembros.forEach((m) => {
        const k = (m.codigo_dea || "").toLowerCase();
        let v = null;
        if (k) v = matriculaEnPlan.has(k) && matriculaEnPlan.get(k) !== null ? matriculaEnPlan.get(k) : (gescolarVigente ? gescolarVigente.get(k) : null);
        if (v === null || v === undefined) faltan += 1; else suma += v;
      });
      // Si de ninguna institución del edificio se conoce la matrícula, es "sin dato" (no 0).
      matEdificio = faltan === e.miembros.length ? null : suma;
      if (faltan) edificioSinDatos.add(e.codigo_infraestructura);
    }
    const valores = {
      codigo: r.codigo_dea,
      nombre: d.nombre,
      municipio: d.municipio,
      parroquia: d.parroquia,
      comuna: d.comuna,
      direccion: d.direccion,
      nivel: primero(d.mapa, ["nivel_principal"]),
      modalidad: primero(d.mapa, ["modalidad_principal"]),
      zona: primero(d.mapa, ["zona_ubicacion"]),
      mat_total: d.matricula,
      edificio_estado: ETIQUETA_EDIFICIO[estado],
      edificio_codigo: e ? e.codigo_infraestructura : "",
      edificio_instituciones: e ? e.cantidad : null,
      edificio_comparte_con: otras.map((m) => (m.codigo_dea ? `${m.nombre} (${m.codigo_dea})` : m.nombre)).join("; "),
      edificio_matricula: matEdificio,
      espacios_separados: pideEdificio ? (espacios.get(dea) || 0) : null,
      insp_estado: r.estado,
      insp_fecha: fechaISO(r.fecha),
      insp_responsable: (ing.get(r.inspeccion_id) || [])[0] || "",
      insp_ingenieros: (ing.get(r.inspeccion_id) || []).join("; "),
      insp_rubros: rubros.get(r.inspeccion_id) || 0,
      insp_adicionales: adic.get(r.inspeccion_id) || 0,
      director_nombre: d.director,
      director_telefono: d.telefono,
      _estado: estado,
      _edificio: e ? e.codigo_infraestructura : "",
    };
    COLUMNAS.filter((c) => c.gescolar).forEach((c) => { valores[c.id] = aEntero(d.mapa[c.gescolar]); });
    return valores;
  });

  filas.sort((a, b) =>
    String(a.municipio || "").localeCompare(String(b.municipio || ""), "es") ||
    String(a.parroquia || "").localeCompare(String(b.parroquia || ""), "es") ||
    String(a.nombre || "").localeCompare(String(b.nombre || ""), "es"));

  const totales = {};
  columnas.filter((c) => c.sumable).forEach((c) => {
    totales[c.id] = filas.reduce((x, f) => x + (typeof f[c.id] === "number" ? f[c.id] : 0), 0);
  });

  const edificiosDistintos = new Set(filas.filter((f) => f._edificio).map((f) => f._edificio));
  const matTotal = filas.reduce((x, f) => x + (typeof f.mat_total === "number" ? f.mat_total : 0), 0);
  const avisos = [];
  if (avisoMatricula) avisos.push(avisoMatricula);
  if (edificioSinDatos.size) avisos.push(`En ${edificioSinDatos.size} edificio(s) hay instituciones sin matrícula conocida (sin código DEA o sin dato en GESCOLAR): la matrícula del edificio no las incluye.`);
  const sinMat = filas.filter((f) => f.mat_total === null).length;
  if (sinMat) avisos.push(`${sinMat} plantel(es) no tienen matrícula registrada.`);

  return {
    plan,
    columnas: columnas.map(({ id, etiqueta, tipo, grupo, ancho, sumable }) => ({ id, etiqueta, tipo, grupo, ancho, sumable: Boolean(sumable) })),
    filas: filas.map((f) => { const o = {}; columnas.forEach((c) => { o[c.id] = f[c.id] === undefined ? null : f[c.id]; }); return o; }),
    totales,
    resumen: {
      planteles: filas.length,
      matricula_total: matTotal,
      // Solo tienen sentido si el reporte incluye alguna columna de edificio (si no, no se consultó Infraestructuras).
      edificios_distintos: pideEdificio ? edificiosDistintos.size : null,
      planteles_solos: pideEdificio ? filas.filter((f) => f._estado === "solo").length : null,
      planteles_comparten: pideEdificio ? filas.filter((f) => f._estado === "comparte").length : null,
      sin_clasificar: pideEdificio ? filas.filter((f) => f._estado === "sin_clasificar").length : null,
    },
    avisos,
    generado_en: new Date().toISOString(),
  };
}

module.exports = { ErrorReporte, catalogoPara, validarColumnas, armarReportePlan, COLUMNAS };
