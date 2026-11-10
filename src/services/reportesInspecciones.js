// reportesInspecciones.js — "Reportes por plan" del módulo Inspecciones.
//
// Arma una tabla con los planteles ACTIVOS de un plan de atención —o con los planteles que la persona elija
// uno a uno— y las columnas que la persona elija
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
//   · Planteles elegidos que no están en un plan: si ya tienen una planilla (inspección) se usa; si no, sus datos
//     salen de GESCOLAR vigente (la columna "Fuente de los datos" lo dice) y las columnas de inspección quedan vacías.
//   · Proyección de aulas: aulas total / operativas / no operativas de la última visita ENVIADA del Instrumento Uno.
//     Es una proyección de CAPACIDAD: supone rehabilitar todas las aulas no operativas, entre 25 y 30 alumnos por aula
//     (valores fijos, decididos por el usuario), un solo turno y una mesa-silla por alumno adicional.

const { pool } = require("../db/pool");
const gescolar = require("./gescolar");
const consultasExpres = require("./consultasExpres");
const esquemaIU = require("./instrumentoUnoEsquema");
const infra = require("./infraestructuras");
const comunas = require("./comunasReporte");

// ---------------------------------------------------------------------------
// Catálogo de columnas
// ---------------------------------------------------------------------------
// tipo: "texto" | "entero" | "decimal" ; sumable: se suma en la fila de totales ; roles: si existe, solo esos perfiles la ven.
const ROLES_DIRECTOR = ["admin", "insp_coordinador"];

const GRUPOS = [
  { id: "plantel", etiqueta: "Datos del plantel" },
  { id: "matricula", etiqueta: "Matrícula" },
  { id: "proyeccion", etiqueta: "Proyección de rehabilitación (aulas)" },
  { id: "edificio", etiqueta: "Edificio" },
  { id: "inspeccion", etiqueta: "Inspección" },
  { id: "comunas", etiqueta: "Comunas, proyectos comunales y atención" },
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
  { id: "fuente", grupo: "plantel", etiqueta: "Fuente de los datos", tipo: "texto", ancho: 14 },

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

  { id: "aulas_total", grupo: "proyeccion", etiqueta: "Aulas (total)", tipo: "entero", sumable: true, ancho: 10 },
  { id: "aulas_operativas", grupo: "proyeccion", etiqueta: "Aulas operativas", tipo: "entero", sumable: true, ancho: 11 },
  { id: "aulas_no_operativas", grupo: "proyeccion", etiqueta: "Aulas NO operativas", tipo: "entero", sumable: true, ancho: 11 },
  { id: "aulas_motivo", grupo: "proyeccion", etiqueta: "Motivo de inhabilitación de las aulas", tipo: "texto", ancho: 34 },
  { id: "aulas_fuerza_mayor", grupo: "proyeccion", etiqueta: "¿Por causa de fuerza mayor?", tipo: "texto", ancho: 14 },
  { id: "alumnos_por_aula", grupo: "proyeccion", etiqueta: "Alumnos por aula operativa (hoy)", tipo: "decimal", ancho: 14 },
  { id: "proy_alumnos_min", grupo: "proyeccion", etiqueta: "Alumnos adicionales posibles (25 por aula)", tipo: "entero", sumable: true, ancho: 16 },
  { id: "proy_alumnos_max", grupo: "proyeccion", etiqueta: "Alumnos adicionales posibles (30 por aula)", tipo: "entero", sumable: true, ancho: 16 },
  { id: "proy_mesas_min", grupo: "proyeccion", etiqueta: "Mesas-sillas a dotar (mínimo)", tipo: "entero", sumable: true, ancho: 14 },
  { id: "proy_mesas_max", grupo: "proyeccion", etiqueta: "Mesas-sillas a dotar (máximo)", tipo: "entero", sumable: true, ancho: 14 },

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

  // Comunas y atención: salen de GESCOLAR VIGENTE (no de la copia de la planilla) y de los proyectos comunales.
  { id: "com_codigo", grupo: "comunas", etiqueta: "Código de la comuna (circuito)", tipo: "texto", ancho: 15 },
  { id: "com_nombre", grupo: "comunas", etiqueta: "Comuna (GESCOLAR vigente)", tipo: "texto", ancho: 30 },
  { id: "com_consejo_codigo", grupo: "comunas", etiqueta: "Código del consejo comunal", tipo: "texto", ancho: 15 },
  { id: "com_consejo", grupo: "comunas", etiqueta: "Consejo comunal", tipo: "texto", ancho: 30 },
  { id: "com_datos", grupo: "comunas", etiqueta: "Datos de comuna", tipo: "texto", ancho: 22 },
  { id: "com_proyectos", grupo: "comunas", etiqueta: "Proyectos comunales (cantidad)", tipo: "entero", sumable: true, ancho: 12 },
  { id: "com_proy_estado", grupo: "comunas", etiqueta: "Estado del proyecto comunal", tipo: "texto", ancho: 18 },
  { id: "com_proy_detalle", grupo: "comunas", etiqueta: "Detalle de los proyectos comunales", tipo: "texto", ancho: 50 },
  { id: "atendido", grupo: "comunas", etiqueta: "Atendido (FEDE u otro ente)", tipo: "texto", ancho: 13 },
  { id: "atendido_por", grupo: "comunas", etiqueta: "Atendido por", tipo: "texto", ancho: 17 },
  { id: "director_nombre", grupo: "director", etiqueta: "Director", tipo: "texto", ancho: 30, roles: ROLES_DIRECTOR },
  { id: "director_telefono", grupo: "director", etiqueta: "Teléfono del director", tipo: "texto", ancho: 16, roles: ROLES_DIRECTOR },
];

const PRESETS = [
  { id: "esencial", etiqueta: "Esencial", columnas: ["codigo", "nombre", "municipio", "parroquia", "mat_total", "edificio_estado", "edificio_codigo"] },
  { id: "matricula_edificio", etiqueta: "Matrícula y edificio", columnas: ["codigo", "nombre", "municipio", "parroquia", "mat_total", "edificio_estado", "edificio_codigo", "edificio_instituciones", "edificio_comparte_con", "edificio_matricula", "espacios_separados"] },
  { id: "matricula_niveles", etiqueta: "Matrícula por nivel", columnas: ["codigo", "nombre", "municipio", "parroquia", "mat_total", "mat_maternal", "mat_preescolar", "mat_primaria", "mat_media_general", "mat_media", "mat_tecnica", "mat_adulto", "mat_especial"] },
  { id: "proyeccion_aulas", etiqueta: "Proyección de aulas", columnas: ["codigo", "nombre", "municipio", "parroquia", "mat_total", "aulas_total", "aulas_operativas", "aulas_no_operativas", "aulas_motivo", "aulas_fuerza_mayor", "alumnos_por_aula", "proy_alumnos_min", "proy_alumnos_max", "proy_mesas_min", "proy_mesas_max"] },
  { id: "comunas_atencion", etiqueta: "Comunas y atención", columnas: ["codigo", "nombre", "municipio", "parroquia", "com_codigo", "com_nombre", "com_consejo", "com_datos", "com_proyectos", "com_proy_estado", "atendido", "atendido_por"] },
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
    filtros: comunas.FILTROS,
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

const ALUMNOS_POR_AULA_MIN = 25;
const ALUMNOS_POR_AULA_MAX = 30;
const MAX_PLANTELES_ELEGIDOS = 300;
const CODIGO_DEA = /^[A-Za-z0-9]{4,20}$/;

function fechaISO(valor) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(valor || ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

const etiquetaMotivo = (m) => { const o = esquemaIU.MOTIVOS_AULAS.find((x) => x.valor === m); return o ? o.etiqueta : m; };
const ETIQUETA_EDIFICIO = { solo: "Solo en su edificio", comparte: "Comparte edificio", sin_clasificar: "Sin clasificar" };

// Núcleo: arma el reporte a partir de una lista de "entradas" ya resueltas.
//   entrada = { inspeccion_id (o null), codigo, fecha, estado, membrete (copia de GESCOLAR + correcciones, o la fila de GESCOLAR), fuente }
async function armarReporte({ titulo, planId, entradas, columnas, avisosIniciales = [], filtros = null }) {
  const ids = entradas.map((r) => r.inspeccion_id).filter(Boolean);
  const deas = entradas.map((r) => String(r.codigo || "").toLowerCase());

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

  // Aulas: dato vigente del plantel = última visita ENVIADA del Instrumento Uno + lo cargado después por consultas exprés.
  const pideProyeccion = columnas.some((c) => c.grupo === "proyeccion");
  const aulas = new Map();
  if (pideProyeccion && deas.length) {
    (await consultasExpres.datosVigentesLote(deas)).forEach((d, k) => {
      aulas.set(k, {
        total: aEntero(d.aulas_total), operativas: aEntero(d.aulas_operativas), no_operativas: aEntero(d.aulas_no_operativas),
        motivos: Array.isArray(d.aulas_motivo) ? d.aulas_motivo : [], motivo_otro: texto(d.aulas_motivo_otro),
      });
    });
  }

  const pideEdificio = columnas.some((c) => c.grupo === "edificio");
  const pideMatEdificio = columnas.some((c) => c.id === "edificio_matricula");
  const edifDe = new Map(); // dea (minúsculas) -> edificio
  const espacios = new Map();
  let gescolarVigente = new Map(); // dea -> matrícula total vigente en GESCOLAR
  const avisos = [...avisosIniciales];
  if (pideEdificio) {
    const { edificios } = await infra.obtenerEdificios();
    edificios.forEach((e) => e.miembros.forEach((m) => { if (m.codigo_dea) edifDe.set(m.codigo_dea.toLowerCase(), e); }));
    (await pool.query("SELECT lower(codigo_dea) AS k, COUNT(*)::int AS n FROM infra_espacios GROUP BY 1")).rows.forEach((r) => espacios.set(r.k, r.n));
    if (pideMatEdificio) {
      try {
        (await gescolar.cargarGescolar()).forEach((p) => {
          const dea = texto(p[gescolar.CAMPO_CODIGO]).toLowerCase();
          if (dea) gescolarVigente.set(dea, matriculaTotalDe(mapaNormalizado(p)));
        });
      } catch (err) {
        console.error("Reportes: no se pudo leer GESCOLAR para la matrícula del edificio:", err.message);
        gescolarVigente = null;
        avisos.push("No se pudo consultar GESCOLAR: la matrícula del edificio solo suma las instituciones que están en este reporte.");
      }
    }
  }

  // Comunas, proyectos comunales y «atendido»: solo se calculan si el reporte los pide (columnas o filtros).
  const filtrosOk = filtros || comunas.validarFiltros({});
  const pideComunas = columnas.some((c) => c.grupo === "comunas") || comunas.hayFiltros(filtrosOk);
  const comunaDeCodigo = new Map(); // dea (minúsculas) -> { comuna, proyectos, atencion }
  let comunasDisponibles = false;
  if (pideComunas) {
    try {
      const datosGescolar = await gescolar.cargarGescolar();
      const filaDe = new Map();
      datosGescolar.forEach((p) => { const k = texto(p[gescolar.CAMPO_CODIGO]).toLowerCase(); if (k) filaDe.set(k, p); });
      const ctxAt = await comunas.contextoAtencion(datosGescolar);
      const ctxProy = await comunas.cargarProyectos();
      avisos.push(...ctxAt.avisos);
      if (ctxProy.aviso) avisos.push(ctxProy.aviso);
      let sinFila = 0;
      entradas.forEach((r) => {
        const k = String(r.codigo || "").toLowerCase();
        const fila = filaDe.get(k);
        if (!fila) sinFila += 1;
        const base = fila || r.membrete || {};
        comunaDeCodigo.set(k, { comuna: comunas.comunaDe(base), proyectos: comunas.proyectosDe(k, ctxProy), atencion: comunas.atencionDe(base, ctxAt) });
      });
      if (sinFila) avisos.push(`${sinFila} plantel(es) ya no aparecen en GESCOLAR vigente: sus datos de comuna y atención salen de la copia de la planilla.`);
      comunasDisponibles = true;
    } catch (err) {
      console.error("Reportes: no se pudo leer GESCOLAR para comunas:", err.message);
      throw new ErrorReporte(502, "No se pudo consultar GESCOLAR para los datos de comuna. Intenta de nuevo en un momento.");
    }
  }

  // Datos efectivos de cada plantel (también sirven para la matrícula de su edificio).
  const planillas = new Map(entradas.map((r) => [r.codigo, datosDePlanilla(r.membrete)]));
  const matriculaEnReporte = new Map();
  entradas.forEach((r) => { matriculaEnReporte.set(String(r.codigo || "").toLowerCase(), planillas.get(r.codigo).matricula); });

  const edificioSinDatos = new Set();
  let sinAulas = 0; let subocupados = 0;
  let filas = entradas.map((r) => {
    const d = planillas.get(r.codigo);
    const dea = String(r.codigo || "").toLowerCase();
    const e = edifDe.get(dea);
    const estado = !e ? "sin_clasificar" : e.cantidad > 1 ? "comparte" : "solo";
    const otras = e ? e.miembros.filter((m) => !m.codigo_dea || m.codigo_dea.toLowerCase() !== dea) : [];
    let matEdificio = null;
    if (e && pideMatEdificio) {
      let suma = 0; let faltan = 0;
      e.miembros.forEach((m) => {
        const k = (m.codigo_dea || "").toLowerCase();
        let v = null;
        if (k) v = matriculaEnReporte.has(k) && matriculaEnReporte.get(k) !== null ? matriculaEnReporte.get(k) : (gescolarVigente ? gescolarVigente.get(k) : null);
        if (v === null || v === undefined) faltan += 1; else suma += v;
      });
      // Si de ninguna institución del edificio se conoce la matrícula, es "sin dato" (no 0).
      matEdificio = faltan === e.miembros.length ? null : suma;
      if (faltan) edificioSinDatos.add(e.codigo_infraestructura);
    }
    const au = aulas.get(dea) || null;
    const noOper = au && au.no_operativas !== null ? au.no_operativas : null;
    const oper = au ? au.operativas : null;
    if (pideProyeccion && !au) sinAulas += 1;
    const porAula = oper && d.matricula !== null ? Math.round((d.matricula / oper) * 10) / 10 : null;
    if (porAula !== null && porAula < ALUMNOS_POR_AULA_MIN) subocupados += 1;
    const valores = {
      codigo: r.codigo,
      nombre: d.nombre,
      municipio: d.municipio,
      parroquia: d.parroquia,
      comuna: d.comuna,
      direccion: d.direccion,
      nivel: primero(d.mapa, ["nivel_principal"]),
      modalidad: primero(d.mapa, ["modalidad_principal"]),
      zona: primero(d.mapa, ["zona_ubicacion"]),
      fuente: r.fuente,
      mat_total: d.matricula,
      aulas_total: au ? au.total : null,
      aulas_operativas: oper,
      aulas_no_operativas: noOper,
      aulas_motivo: au && au.motivos.length ? au.motivos.map((m) => (m === "OTRO" && au.motivo_otro ? `Otro: ${au.motivo_otro}` : etiquetaMotivo(m))).join(", ") : "",
      aulas_fuerza_mayor: !au || noOper === null ? "" : au.motivos.some((m) => esquemaIU.MOTIVOS_FUERZA_MAYOR.includes(m)) ? "Sí" : noOper > 0 ? (au.motivos.length ? "No" : "Sin motivo") : "",
      alumnos_por_aula: porAula,
      proy_alumnos_min: noOper === null ? null : noOper * ALUMNOS_POR_AULA_MIN,
      proy_alumnos_max: noOper === null ? null : noOper * ALUMNOS_POR_AULA_MAX,
      // una mesa-silla por alumno adicional
      proy_mesas_min: noOper === null ? null : noOper * ALUMNOS_POR_AULA_MIN,
      proy_mesas_max: noOper === null ? null : noOper * ALUMNOS_POR_AULA_MAX,
      edificio_estado: ETIQUETA_EDIFICIO[estado],
      edificio_codigo: e ? e.codigo_infraestructura : "",
      edificio_instituciones: e ? e.cantidad : null,
      edificio_comparte_con: otras.map((m) => (m.codigo_dea ? `${m.nombre} (${m.codigo_dea})` : m.nombre)).join("; "),
      edificio_matricula: matEdificio,
      espacios_separados: pideEdificio ? (espacios.get(dea) || 0) : null,
      insp_estado: r.inspeccion_id ? r.estado : "Sin planilla",
      insp_fecha: fechaISO(r.fecha),
      insp_responsable: (ing.get(r.inspeccion_id) || [])[0] || "",
      insp_ingenieros: (ing.get(r.inspeccion_id) || []).join("; "),
      insp_rubros: r.inspeccion_id ? (rubros.get(r.inspeccion_id) || 0) : null,
      insp_adicionales: r.inspeccion_id ? (adic.get(r.inspeccion_id) || 0) : null,
      com_codigo: pideComunas ? comunaDeCodigo.get(dea).comuna.comuna_codigo : null,
      com_nombre: pideComunas ? comunaDeCodigo.get(dea).comuna.comuna_nombre : null,
      com_consejo_codigo: pideComunas ? comunaDeCodigo.get(dea).comuna.consejo_codigo : null,
      com_consejo: pideComunas ? comunaDeCodigo.get(dea).comuna.consejo_nombre : null,
      com_datos: pideComunas ? comunaDeCodigo.get(dea).comuna.datos : null,
      com_proyectos: pideComunas ? comunaDeCodigo.get(dea).proyectos.cantidad : null,
      com_proy_estado: pideComunas ? comunaDeCodigo.get(dea).proyectos.estado : null,
      com_proy_detalle: pideComunas ? comunaDeCodigo.get(dea).proyectos.detalle : null,
      atendido: pideComunas ? (comunaDeCodigo.get(dea).atencion.atendido ? "Sí" : "No") : null,
      atendido_por: pideComunas ? (({ fede, otro }) => (fede && otro ? "FEDE y otro ente" : fede ? "FEDE" : otro ? "Otro ente" : ""))(comunaDeCodigo.get(dea).atencion) : null,
      director_nombre: d.director,
      director_telefono: d.telefono,
      _estado: estado,
      _com: pideComunas ? comunaDeCodigo.get(dea) : null,
      _edificio: e ? e.codigo_infraestructura : "",
    };
    COLUMNAS.filter((c) => c.gescolar).forEach((c) => { valores[c.id] = aEntero(d.mapa[c.gescolar]); });
    return valores;
  });

  filas.sort((a, b) =>
    String(a.municipio || "").localeCompare(String(b.municipio || ""), "es") ||
    String(a.parroquia || "").localeCompare(String(b.parroquia || ""), "es") ||
    String(a.nombre || "").localeCompare(String(b.nombre || ""), "es"));

  // Filtros rápidos (datos de comuna, proyecto comunal, atención). Se aplican antes de totales y cifras.
  if (comunas.hayFiltros(filtrosOk)) {
    const antes = filas.length;
    filas = filas.filter((f) => comunas.pasaFiltros(f._com, filtrosOk));
    avisos.push(`Filtros aplicados: ${comunas.describirFiltros(filtrosOk)}. Se muestran ${filas.length} de ${antes} planteles.`);
  }

  const totales = {};
  columnas.filter((c) => c.sumable).forEach((c) => {
    totales[c.id] = filas.reduce((x, f) => x + (typeof f[c.id] === "number" ? f[c.id] : 0), 0);
  });

  const edificiosDistintos = new Set(filas.filter((f) => f._edificio).map((f) => f._edificio));
  const matTotal = filas.reduce((x, f) => x + (typeof f.mat_total === "number" ? f.mat_total : 0), 0);
  if (edificioSinDatos.size) avisos.push(`En ${edificioSinDatos.size} edificio(s) hay instituciones sin matrícula conocida (sin código DEA o sin dato en GESCOLAR): la matrícula del edificio no las incluye.`);
  const sinMat = filas.filter((f) => f.mat_total === null).length;
  if (sinMat) avisos.push(`${sinMat} plantel(es) no tienen matrícula registrada.`);
  if (pideProyeccion) {
    avisos.push(`Proyección de capacidad: supone rehabilitar todas las aulas no operativas, entre ${ALUMNOS_POR_AULA_MIN} y ${ALUMNOS_POR_AULA_MAX} alumnos por aula (un solo turno) y una mesa-silla por alumno adicional. No es matrícula real: depende de que haya niños sin cupo. El dato de aulas es el más reciente entre la última visita enviada y las consultas exprés.`);
    const fm = filas.filter((f) => f.aulas_fuerza_mayor === "Sí").length;
    if (fm) avisos.push(`${fm} plantel(es) tienen aulas inhabilitadas por causas de fuerza mayor (incendio, inundación, deslizamiento, terreno cedido u otra catástrofe). El motivo se registra por plantel, no por aula.`);
    if (sinAulas) avisos.push(`${sinAulas} plantel(es) no tienen una visita ENVIADA del Instrumento Uno: sin datos de aulas.`);
    if (subocupados) avisos.push(`${subocupados} plantel(es) ya tienen menos de ${ALUMNOS_POR_AULA_MIN} alumnos por aula operativa: rehabilitar más aulas probablemente no genere matrícula adicional (conviene revisar la demanda).`);
  }

  return {
    plan: { id: planId || null, nombre: titulo },
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
      // Comunas y atención (solo si el reporte los usa)
      comunas_completos: pideComunas ? filas.filter((f) => f._com.comuna.tieneComuna && f._com.comuna.tieneConsejo).length : null,
      comunas_faltan: pideComunas ? filas.filter((f) => !(f._com.comuna.tieneComuna && f._com.comuna.tieneConsejo)).length : null,
      con_proyecto_comunal: pideComunas ? filas.filter((f) => f._com.proyectos.cantidad > 0).length : null,
      atendidos: pideComunas ? filas.filter((f) => f._com.atencion.atendido).length : null,
      // Proyección de aulas (solo si el reporte la incluye)
      con_datos_de_aulas: pideProyeccion ? filas.filter((f) => f.aulas_total !== null || f.aulas_no_operativas !== null).length : null,
      aulas_no_operativas: pideProyeccion ? filas.reduce((x, f) => x + (typeof f.aulas_no_operativas === "number" ? f.aulas_no_operativas : 0), 0) : null,
      planteles_fuerza_mayor: pideProyeccion ? filas.filter((f) => f.aulas_fuerza_mayor === "Sí").length : null,
      aulas_no_operativas_fuerza_mayor: pideProyeccion ? filas.filter((f) => f.aulas_fuerza_mayor === "Sí").reduce((x, f) => x + (typeof f.aulas_no_operativas === "number" ? f.aulas_no_operativas : 0), 0) : null,
      alumnos_adicionales_min: pideProyeccion ? filas.reduce((x, f) => x + (typeof f.proy_alumnos_min === "number" ? f.proy_alumnos_min : 0), 0) : null,
      alumnos_adicionales_max: pideProyeccion ? filas.reduce((x, f) => x + (typeof f.proy_alumnos_max === "number" ? f.proy_alumnos_max : 0), 0) : null,
    },
    avisos,
    generado_en: new Date().toISOString(),
  };
}

// Reporte de los planteles ACTIVOS de un plan.
async function armarReportePlan(planId, columnas, filtros = null) {
  const plan = (await pool.query("SELECT id, nombre FROM planes_atencion WHERE id = $1", [planId])).rows[0];
  if (!plan) return null;
  const { rows } = await pool.query(
    `SELECT pi.inspeccion_id, pi.codigo_dea, i.fecha_inspeccion::text AS fecha, i.estado, i.membrete
     FROM plan_inspecciones pi JOIN inspecciones i ON i.id = pi.inspeccion_id
     WHERE pi.plan_id = $1 AND pi.desenlazado_en IS NULL`,
    [planId]
  );
  const entradas = rows.map((r) => ({ inspeccion_id: r.inspeccion_id, codigo: r.codigo_dea, fecha: r.fecha, estado: r.estado, membrete: r.membrete || {}, fuente: "Planilla" }));
  return armarReporte({ titulo: plan.nombre, planId: plan.id, entradas, columnas, filtros });
}

// Valida y limpia la lista de códigos elegidos (sin repetir, formato correcto, máximo permitido).
function validarCodigos(lista) {
  if (!Array.isArray(lista)) throw new ErrorReporte(400, "Elige al menos un plantel.");
  const vistos = new Set(); const codigos = [];
  for (const c of lista) {
    const t = String(c === undefined || c === null ? "" : c).trim();
    if (!CODIGO_DEA.test(t)) throw new ErrorReporte(400, `Código de plantel no válido: ${t.slice(0, 25)}.`);
    if (!vistos.has(t.toLowerCase())) { vistos.add(t.toLowerCase()); codigos.push(t); }
  }
  if (!codigos.length) throw new ErrorReporte(400, "Elige al menos un plantel.");
  if (codigos.length > MAX_PLANTELES_ELEGIDOS) throw new ErrorReporte(400, `Máximo ${MAX_PLANTELES_ELEGIDOS} planteles por reporte.`);
  return codigos;
}

// Reporte de los planteles elegidos uno a uno (estén o no en un plan).
async function armarReporteSeleccion(codigos, columnas, filtros = null) {
  let filasGescolar;
  try {
    filasGescolar = await gescolar.cargarGescolar();
  } catch (err) {
    console.error("Reportes: no se pudo leer GESCOLAR:", err.message);
    throw new ErrorReporte(502, "No se pudo consultar GESCOLAR. Intenta de nuevo en un momento.");
  }
  const porCodigo = new Map();
  filasGescolar.forEach((p) => { const c = texto(p[gescolar.CAMPO_CODIGO]); if (c) porCodigo.set(c.toLowerCase(), p); });

  const noEncontrados = codigos.filter((c) => !porCodigo.has(c.toLowerCase()));
  const hallados = codigos.filter((c) => porCodigo.has(c.toLowerCase()));

  // Si el plantel ya tiene una planilla (de cualquier plan), se usa la más reciente.
  const insp = new Map();
  if (hallados.length) {
    (await pool.query(
      `SELECT DISTINCT ON (lower(codigo_dea)) id, lower(codigo_dea) AS k, fecha_inspeccion::text AS fecha, estado, membrete
       FROM inspecciones WHERE lower(codigo_dea) = ANY($1::text[])
       ORDER BY lower(codigo_dea), actualizado_en DESC, id DESC`,
      [hallados.map((c) => c.toLowerCase())]
    )).rows.forEach((r) => insp.set(r.k, r));
  }
  const entradas = hallados.map((c) => {
    const fila = porCodigo.get(c.toLowerCase());
    const codigo = texto(fila[gescolar.CAMPO_CODIGO]);
    const i = insp.get(c.toLowerCase());
    return i
      ? { inspeccion_id: i.id, codigo, fecha: i.fecha, estado: i.estado, membrete: i.membrete || {}, fuente: "Planilla" }
      : { inspeccion_id: null, codigo, fecha: null, estado: "", membrete: fila, fuente: "GESCOLAR" };
  });
  const avisos = [];
  if (noEncontrados.length) avisos.push(`No se encontraron en GESCOLAR: ${noEncontrados.slice(0, 10).join(", ")}${noEncontrados.length > 10 ? "…" : ""}.`);
  const deGescolar = entradas.filter((e) => e.fuente === "GESCOLAR").length;
  if (deGescolar) avisos.push(`${deGescolar} plantel(es) no tienen planilla de inspección: sus datos salen de GESCOLAR vigente y las columnas de inspección quedan vacías.`);
  return armarReporte({ titulo: `Planteles seleccionados (${entradas.length})`, planId: null, entradas, columnas, avisosIniciales: avisos, filtros });
}

// Búsqueda de planteles para agregarlos a la selección (por nombre, código, municipio o parroquia).
async function buscarParaSeleccion(entrada) {
  const t = String(entrada || "").trim();
  if (t.length < 2) throw new ErrorReporte(400, "Escribe al menos 2 caracteres para buscar.");
  let datos;
  try {
    datos = await gescolar.cargarGescolar();
  } catch (err) {
    console.error("Reportes: búsqueda en GESCOLAR:", err.message);
    throw new ErrorReporte(502, "No se pudo consultar GESCOLAR. Intenta de nuevo en un momento.");
  }
  // Sin distinguir mayúsculas ni acentos (y con la codificación dañada corregida), por nombre, código, municipio o parroquia.
  const plano = (v) => arreglarCodificacion(String(v === undefined || v === null ? "" : v)).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const q = plano(t);
  const LIMITE = 12;
  const hallados = [];
  let total = 0;
  for (const p of datos) {
    const m = mapaNormalizado(p);
    const campos = [p[gescolar.CAMPO_NOMBRE], p[gescolar.CAMPO_CODIGO], primero(m, ["municipio"]), primero(m, ["parroquia"])];
    if (!campos.some((c) => plano(c).includes(q))) continue;
    total += 1;
    if (hallados.length < LIMITE) {
      hallados.push({ codigo_dea: texto(p[gescolar.CAMPO_CODIGO]), nombre: texto(p[gescolar.CAMPO_NOMBRE]), municipio: primero(m, ["municipio"]), parroquia: primero(m, ["parroquia"]) });
    }
  }
  return { total, limitado: total > LIMITE, planteles: hallados };
}

module.exports = { ErrorReporte, catalogoPara, validarColumnas, validarCodigos, armarReportePlan, armarReporteSeleccion, buscarParaSeleccion, COLUMNAS, validarFiltros: comunas.validarFiltros, armarReporteComunas: comunas.armarReporteComunas, listarMunicipios: comunas.listarMunicipios };
