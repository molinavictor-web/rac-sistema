// comunasReporte.js — datos de comuna, proyectos comunales y «atendido» para los Reportes de Inspecciones.
//
// Lo usa reportesInspecciones.js de dos maneras:
//   · columnas y filtros por plantel (grupo «Comunas, proyectos comunales y atención»);
//   · el reporte «Por comuna» (una fila por comuna / circuito comunal).
//
// De dónde sale cada dato:
//   · Comuna y consejo comunal: GESCOLAR vigente (columnas COD_CIRCUITO, NOMB_CIRCUITO, COD_CONSEJO_COM, NOM_CONSEJO_COM).
//     «Falta» = la celda está vacía o trae #N/A, 0 o guiones.
//   · Proyectos comunales: tablas comunal_proyectos y comunal_proyecto_planteles (script 29).
//   · Atendido: MISMA regla del Resumen de Inspecciones (dashboard): el plantel tiene TIPO ATENCION válido, o una marca en una
//     columna «PLAN <nombre>» (solo si ese plan NO existe en el sistema), o está enlazado a un plan del sistema (sin desenlazar),
//     o tiene una atención de otro ente. Los proyectos comunales NO cuentan como atendido (decisión del usuario).

const { pool } = require("../db/pool");
const gescolar = require("./gescolar");

const SIN_VALOR = /^(#?N\/?A|#REF!?|#VALUE!?|-+|\.+|NO|SI|NINGUNO|SIN .*)$/i;

function limpiar(valor) {
  let t = String(valor == null ? "" : valor);
  if (/[ÃÂ]/.test(t)) { try { t = Buffer.from(t, "latin1").toString("utf8"); } catch (_) { /* se deja igual */ } }
  return t.replace(/\s+/g, " ").trim();
}
// Texto útil de una celda de seguimiento (igual que el dashboard).
function valorUtil(v) {
  const t = limpiar(v);
  return t && !SIN_VALOR.test(t) ? t : "";
}
// Dato de comuna/consejo: vacío, #N/A, 0 y guiones cuentan como «falta».
function datoComuna(v) {
  const t = limpiar(v);
  return t && !/^(#?N\/?A|#REF!?|#VALUE!?|0+|-+|\.+)$/i.test(t) ? t : "";
}

// Clave de una columna de GESCOLAR sin importar mayúsculas/acentos/espacios.
const claveColumna = (k) => limpiar(k).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
function valorColumna(fila, nombre) {
  for (const k of Object.keys(fila || {})) if (claveColumna(k) === nombre) return fila[k];
  return "";
}

// Comuna y consejo comunal de una fila de GESCOLAR (o de un membrete con la misma forma).
function comunaDe(fila) {
  const cod = datoComuna(valorColumna(fila, "cod_circuito"));
  const nom = datoComuna(valorColumna(fila, "nomb_circuito"));
  const conCod = datoComuna(valorColumna(fila, "cod_consejo_com"));
  const conNom = datoComuna(valorColumna(fila, "nom_consejo_com"));
  const tieneComuna = Boolean(cod || nom);
  const tieneConsejo = Boolean(conCod || conNom);
  return {
    comuna_codigo: cod, comuna_nombre: nom, consejo_codigo: conCod, consejo_nombre: conNom,
    tieneComuna, tieneConsejo,
    datos: tieneComuna && tieneConsejo ? "Completos" : !tieneComuna && !tieneConsejo ? "Faltan comuna y consejo comunal" : !tieneComuna ? "Falta comuna" : "Falta consejo comunal",
  };
}

// ---------------------------------------------------------------------------
// Atendido (misma regla del Resumen)
// ---------------------------------------------------------------------------
async function contextoAtencion(datos) {
  const columnasPlan = datos.length ? Object.keys(datos[0]).filter((h) => gescolar.esColumnaPlan(h)) : [];
  const planesDeCodigo = new Set();
  const nombresPlanSistema = new Set();
  const otros = new Set();
  const avisos = [];
  try {
    (await pool.query("SELECT DISTINCT lower(codigo_dea) AS c FROM plan_inspecciones WHERE desenlazado_en IS NULL")).rows
      .forEach((f) => planesDeCodigo.add(String(f.c || "").trim()));
    (await pool.query("SELECT nombre FROM planes_atencion")).rows.forEach((x) => nombresPlanSistema.add(gescolar.normalizar(x.nombre)));
  } catch (err) {
    console.error("Reportes (comunas): no se pudieron leer los planes del sistema:", err.message);
    avisos.push("No se pudieron leer los planes del sistema: «Atendido» puede estar incompleto.");
  }
  try {
    (await pool.query("SELECT DISTINCT lower(codigo_dea) AS c FROM atenciones_otros_entes")).rows.forEach((f) => otros.add(f.c));
  } catch (err) {
    if (err.code !== "42P01") { console.error("Reportes (comunas): atenciones de otros entes:", err.message); avisos.push("No se pudieron leer las atenciones de otros entes: «Atendido» puede estar incompleto."); }
  }
  return { columnasPlan, planesDeCodigo, nombresPlanSistema, otros, avisos };
}

// → { fede, otro, atendido } de una fila de GESCOLAR.
function atencionDe(fila, ctx) {
  const codigo = limpiar(fila[gescolar.CAMPO_CODIGO]).toLowerCase();
  const tipo = valorUtil(fila[gescolar.CAMPO_TIPO_ATENCION]);
  let enPlan = false;
  ctx.columnasPlan.forEach((col) => {
    if (!gescolar.tieneMarcaPlan(fila[col])) return;
    if (ctx.nombresPlanSistema.has(gescolar.normalizar(gescolar.planDeColumna(col)))) return; // lo gobierna el sistema
    enPlan = true;
  });
  if (ctx.planesDeCodigo.has(codigo)) enPlan = true;
  const fede = Boolean(tipo || enPlan);
  const otro = ctx.otros.has(codigo);
  return { fede, otro, atendido: fede || otro };
}

// ---------------------------------------------------------------------------
// Proyectos comunales
// ---------------------------------------------------------------------------
const NUMERADOS = `SELECT p.*, ROW_NUMBER() OVER (PARTITION BY p.circuito_codigo ORDER BY p.anio, p.fecha_consulta NULLS LAST, p.id)::int AS numero FROM comunal_proyectos p`;

// → { proyectos: [{id, comuna_codigo, comuna_nombre, anio, numero, nombre}], porPlantel: Map(codigo minúsculas → [{proyecto, estado}]), aviso }
async function cargarProyectos() {
  try {
    const { rows } = await pool.query(`SELECT * FROM (${NUMERADOS}) t ORDER BY t.circuito_codigo, t.numero`);
    const proyectos = rows.map((r) => ({
      id: r.id, comuna_codigo: limpiar(r.circuito_codigo), comuna_nombre: limpiar(r.circuito_nombre), anio: r.anio, numero: r.numero, nombre: limpiar(r.nombre_proyecto),
    }));
    const porId = new Map(proyectos.map((p) => [p.id, p]));
    const porPlantel = new Map();
    const enlaces = (await pool.query("SELECT proyecto_id, lower(codigo_dea) AS c, estado FROM comunal_proyecto_planteles")).rows;
    enlaces.forEach((e) => {
      const p = porId.get(e.proyecto_id);
      if (!p) return;
      if (!porPlantel.has(e.c)) porPlantel.set(e.c, []);
      porPlantel.get(e.c).push({ proyecto: p, estado: e.estado });
    });
    return { proyectos, enlaces: enlaces.filter((e) => porId.has(e.proyecto_id)), porPlantel, aviso: null };
  } catch (err) {
    if (err.code === "42P01") return { proyectos: [], enlaces: [], porPlantel: new Map(), aviso: "Todavía no existen las tablas de proyectos comunales (falta ejecutar el script 29 en Supabase): las columnas de proyectos salen vacías." };
    throw err;
  }
}

const ordinal = (n) => `${n}.ª`;
const ETQ_ESTADO = { ATENDIDO: "Atendido", POR_ATENDER: "Por atender" };

// Resumen de los proyectos de UN plantel.
function proyectosDe(codigoMin, ctxProy) {
  const lista = ctxProy.porPlantel.get(codigoMin) || [];
  const hayAt = lista.some((x) => x.estado === "ATENDIDO");
  const hayPor = lista.some((x) => x.estado !== "ATENDIDO");
  return {
    cantidad: lista.length,
    estado: !lista.length ? "" : hayAt && hayPor ? "Atendido y por atender" : hayAt ? "Atendido" : "Por atender",
    detalle: lista.map((x) => `${ordinal(x.proyecto.numero)} consulta ${x.proyecto.anio} · ${x.proyecto.comuna_nombre || x.proyecto.comuna_codigo}: ${x.proyecto.nombre} (${ETQ_ESTADO[x.estado] || x.estado})`).join("; "),
  };
}

// ---------------------------------------------------------------------------
// Filtros rápidos por plantel
// ---------------------------------------------------------------------------
const FILTROS = {
  datos: ["todos", "completos", "faltan", "sin_comuna", "sin_consejo"],
  proyecto: ["todos", "con", "sin"],
  atencion: ["todos", "atendidos", "sin_atender"],
  edificio: ["todos", "comparte", "solo", "sin_clasificar"],
};
const ETQ_FILTRO = {
  datos: { completos: "datos de comuna completos", faltan: "les falta algún dato de comuna", sin_comuna: "sin comuna", sin_consejo: "sin consejo comunal" },
  proyecto: { con: "con proyecto comunal", sin: "sin proyecto comunal" },
  atencion: { atendidos: "atendidos", sin_atender: "sin atender" },
  edificio: { comparte: "comparten edificio", solo: "solos en su edificio", sin_clasificar: "edificio sin clasificar" },
};

class ErrorFiltro extends Error { constructor(m) { super(m); this.estado = 400; } }

// Acepta { datos, proyecto, atencion }; lo que no venga es «todos». Rechaza valores desconocidos.
function validarFiltros(entrada) {
  const f = { datos: "todos", proyecto: "todos", atencion: "todos", edificio: "todos" };
  const e = entrada && typeof entrada === "object" ? entrada : {};
  for (const k of Object.keys(FILTROS)) {
    const v = e[k] === undefined || e[k] === null || e[k] === "" ? "todos" : String(e[k]);
    if (!FILTROS[k].includes(v)) throw new ErrorFiltro(`Filtro no válido: ${k}.`);
    f[k] = v;
  }
  return f;
}
const hayFiltros = (f) => Object.keys(FILTROS).some((k) => f[k] !== "todos");
// Los filtros de comuna / proyecto / atención necesitan leer GESCOLAR; el de edificio no.
const hayFiltrosComuna = (f) => ["datos", "proyecto", "atencion"].some((k) => f[k] !== "todos");

function pasaFiltros(h, f, estadoEdificio) {
  if (f.edificio && f.edificio !== "todos" && estadoEdificio !== f.edificio) return false;
  if (f.datos === "completos" && !(h.comuna.tieneComuna && h.comuna.tieneConsejo)) return false;
  if (f.datos === "faltan" && h.comuna.tieneComuna && h.comuna.tieneConsejo) return false;
  if (f.datos === "sin_comuna" && h.comuna.tieneComuna) return false;
  if (f.datos === "sin_consejo" && h.comuna.tieneConsejo) return false;
  if (f.proyecto === "con" && !h.proyectos.cantidad) return false;
  if (f.proyecto === "sin" && h.proyectos.cantidad) return false;
  if (f.atencion === "atendidos" && !h.atencion.atendido) return false;
  if (f.atencion === "sin_atender" && h.atencion.atendido) return false;
  return true;
}
function describirFiltros(f) {
  return Object.keys(FILTROS).filter((k) => f[k] !== "todos").map((k) => ETQ_FILTRO[k][f[k]]).join(" · ");
}

// ---------------------------------------------------------------------------
// Reporte «Por comuna»: una fila por comuna / circuito comunal
// ---------------------------------------------------------------------------
const COLUMNAS_COMUNA = [
  { id: "c_codigo", etiqueta: "Código de la comuna (circuito)", tipo: "texto", ancho: 16 },
  { id: "c_nombre", etiqueta: "Comuna (circuito comunal)", tipo: "texto", ancho: 38 },
  { id: "c_municipios", etiqueta: "Municipio(s)", tipo: "texto", ancho: 24 },
  { id: "c_planteles", etiqueta: "Planteles de la comuna", tipo: "entero", sumable: true, ancho: 12 },
  { id: "c_con_consejo", etiqueta: "Con consejo comunal cargado", tipo: "entero", sumable: true, ancho: 13 },
  { id: "c_sin_consejo", etiqueta: "Sin consejo comunal", tipo: "entero", sumable: true, ancho: 12 },
  { id: "c_proyectos", etiqueta: "Proyectos comunales", tipo: "entero", sumable: true, ancho: 12 },
  { id: "c_planteles_proy", etiqueta: "Planteles en sus proyectos", tipo: "entero", sumable: true, ancho: 13 },
  { id: "c_proy_atendidos", etiqueta: "De esos, atendidos", tipo: "entero", sumable: true, ancho: 11 },
  { id: "c_proy_por_atender", etiqueta: "De esos, por atender", tipo: "entero", sumable: true, ancho: 11 },
  { id: "c_atendidos", etiqueta: "Planteles de la comuna atendidos (FEDE u otro ente)", tipo: "entero", sumable: true, ancho: 17 },
  { id: "c_sin_atender", etiqueta: "Planteles de la comuna sin atender", tipo: "entero", sumable: true, ancho: 14 },
];
const SOLO_COMUNA = ["todas", "con_proyecto", "sin_proyecto"];
const SIN_COMUNA = "(Sin comuna cargada)";

const plano = (t) => limpiar(t).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

async function armarReporteComunas({ municipio, solo }) {
  const modo = !solo ? "todas" : String(solo);
  if (!SOLO_COMUNA.includes(modo)) throw new ErrorFiltro("Opción no válida.");
  let datos;
  try {
    datos = await gescolar.cargarGescolar();
  } catch (err) {
    console.error("Reportes (comunas): no se pudo leer GESCOLAR:", err.message);
    const e = new Error("No se pudo consultar GESCOLAR. Intenta de nuevo en un momento."); e.estado = 502; throw e;
  }
  const ctxAt = await contextoAtencion(datos);
  const ctxProy = await cargarProyectos();
  const avisos = [...ctxAt.avisos];
  if (ctxProy.aviso) avisos.push(ctxProy.aviso);

  // Municipios disponibles (de todo GESCOLAR, para el selector) y filtro opcional por municipio.
  const todosMun = new Map();
  datos.forEach((p) => { const m = limpiar(valorColumna(p, "municipio")); if (m && !todosMun.has(plano(m))) todosMun.set(plano(m), m); });
  const municipios = [...todosMun.values()].sort((a, b) => a.localeCompare(b, "es"));
  const munFiltro = municipio ? plano(municipio) : "";
  if (munFiltro && !todosMun.has(munFiltro)) throw new ErrorFiltro("Municipio no válido.");

  // Planteles por comuna.
  const grupos = new Map(); // clave → {codigo, nombre, municipios:Set, planteles:Set(codigos), conConsejo, sinConsejo, atendidos}
  const porPlantel = new Map(); // codigo minúsculas → comuna clave
  datos.forEach((p) => {
    const codigo = limpiar(p[gescolar.CAMPO_CODIGO]).toLowerCase();
    if (!codigo) return;
    const mun = limpiar(valorColumna(p, "municipio"));
    if (munFiltro && plano(mun) !== munFiltro) return;
    const c = comunaDe(p);
    const clave = c.comuna_codigo || (c.comuna_nombre ? "n:" + plano(c.comuna_nombre) : "");
    const k = clave || "sin";
    if (!grupos.has(k)) grupos.set(k, { codigo: clave ? c.comuna_codigo : "", nombre: clave ? (c.comuna_nombre || c.comuna_codigo) : SIN_COMUNA, municipios: new Set(), planteles: new Set(), conConsejo: 0, sinConsejo: 0, atendidos: 0 });
    const g = grupos.get(k);
    if (!g.nombre || g.nombre === g.codigo) g.nombre = c.comuna_nombre || g.nombre;
    if (mun) g.municipios.add(mun);
    g.planteles.add(codigo);
    if (c.tieneConsejo) g.conConsejo += 1; else g.sinConsejo += 1;
    if (atencionDe(p, ctxAt).atendido) g.atendidos += 1;
    porPlantel.set(codigo, k);
  });

  // Proyectos por comuna (por el código de circuito del proyecto; si no coincide por código, por nombre).
  const claveDeProyecto = (pr) => {
    if (pr.comuna_codigo && grupos.has(pr.comuna_codigo)) return pr.comuna_codigo;
    const kn = "n:" + plano(pr.comuna_nombre);
    return grupos.has(kn) ? kn : (pr.comuna_codigo || kn);
  };
  const proyDeGrupo = new Map(); // clave → { proyectos:Set(id), enlaces:Map(codigo → estado ATENDIDO gana) }
  ctxProy.proyectos.forEach((pr) => {
    const k = claveDeProyecto(pr);
    if (!proyDeGrupo.has(k)) proyDeGrupo.set(k, { proyectos: new Set(), planteles: new Map(), nombre: pr.comuna_nombre, codigo: pr.comuna_codigo });
    proyDeGrupo.get(k).proyectos.add(pr.id);
  });
  const proyPorId = new Map(ctxProy.proyectos.map((p) => [p.id, p]));
  ctxProy.enlaces.forEach((e) => {
    const k = claveDeProyecto(proyPorId.get(e.proyecto_id));
    const g = proyDeGrupo.get(k);
    const cod = String(e.c !== undefined ? e.c : e.codigo_dea || "").toLowerCase();
    if (!g) return;
    if (g.planteles.get(cod) !== "ATENDIDO") g.planteles.set(cod, e.estado === "ATENDIDO" ? "ATENDIDO" : "POR_ATENDER");
  });
  // Comunas con proyectos que no tienen ningún plantel propio en el alcance: se agregan para no perder el proyecto.
  proyDeGrupo.forEach((pg, k) => {
    if (grupos.has(k) || munFiltro) return;
    grupos.set(k, { codigo: pg.codigo, nombre: pg.nombre || pg.codigo, municipios: new Set(), planteles: new Set(), conConsejo: 0, sinConsejo: 0, atendidos: 0 });
  });

  let filas = [...grupos.entries()].map(([k, g]) => {
    const pg = proyDeGrupo.get(k);
    const enlaces = pg ? [...pg.planteles.values()] : [];
    const at = enlaces.filter((x) => x === "ATENDIDO").length;
    return {
      c_codigo: g.codigo, c_nombre: g.nombre, c_municipios: [...g.municipios].sort((a, b) => a.localeCompare(b, "es")).join(", "),
      c_planteles: g.planteles.size, c_con_consejo: g.conConsejo, c_sin_consejo: g.sinConsejo,
      c_proyectos: pg ? pg.proyectos.size : 0, c_planteles_proy: enlaces.length, c_proy_atendidos: at, c_proy_por_atender: enlaces.length - at,
      c_atendidos: g.atendidos, c_sin_atender: g.planteles.size - g.atendidos,
      _sin: k === "sin",
    };
  });
  const totalComunas = filas.filter((f) => !f._sin).length;
  const conProy = filas.filter((f) => !f._sin && f.c_proyectos > 0).length;
  if (modo === "con_proyecto") filas = filas.filter((f) => f.c_proyectos > 0);
  if (modo === "sin_proyecto") filas = filas.filter((f) => f.c_proyectos === 0);
  filas.sort((a, b) => (a._sin ? 1 : 0) - (b._sin ? 1 : 0) || a.c_nombre.localeCompare(b.c_nombre, "es"));

  const sinComuna = grupos.get("sin");
  if (sinComuna && sinComuna.planteles.size) avisos.push(`${sinComuna.planteles.size} plantel(es) no tienen comuna cargada: aparecen en la fila «${SIN_COMUNA}». Se completan desde «Consultar planteles» → Editar datos del plantel.`);
  avisos.push("«Planteles en sus proyectos» cuenta los planteles que atienden los proyectos de esa comuna (pueden ser de otras comunas). Los proyectos comunales no suman en «atendidos»: esa columna usa la misma regla del Resumen (FEDE u otro ente).");
  if (munFiltro) avisos.push("Con un municipio elegido, las cifras de planteles cuentan solo los de ese municipio; los proyectos se muestran por comuna.");

  const totales = {};
  COLUMNAS_COMUNA.filter((c) => c.sumable).forEach((c) => { totales[c.id] = filas.reduce((x, f) => x + (typeof f[c.id] === "number" ? f[c.id] : 0), 0); });
  const planteles = [...grupos.values()].reduce((x, g) => x + g.planteles.size, 0);
  return {
    plan: { id: null, nombre: "Por comuna" },
    modo: "comunas",
    columnas: COLUMNAS_COMUNA.map(({ id, etiqueta, tipo, ancho, sumable }) => ({ id, etiqueta, tipo, grupo: "comunas", ancho, sumable: Boolean(sumable) })),
    filas: filas.map((f) => { const o = {}; COLUMNAS_COMUNA.forEach((c) => { o[c.id] = f[c.id]; }); return o; }),
    totales,
    municipios,
    resumen: {
      planteles,
      matricula_total: null,
      tarjetas: [
        { num: totalComunas, txt: "Comunas con planteles" },
        { num: conProy, txt: "Comunas con proyecto comunal" },
        { num: totalComunas - conProy, txt: "Comunas sin proyecto comunal" },
        { num: sinComuna ? sinComuna.planteles.size : 0, txt: "Planteles sin comuna cargada" },
        { num: planteles, txt: "Planteles contados" },
      ],
      lineas: [`Comunas con planteles: ${totalComunas} · Con proyecto comunal: ${conProy} · Sin proyecto: ${totalComunas - conProy}`, `Planteles contados: ${planteles}${munFiltro ? ` (municipio: ${[...todosMun.values()].find((m) => plano(m) === munFiltro)})` : ""}${modo !== "todas" ? ` · Mostrando: ${modo === "con_proyecto" ? "solo comunas con proyecto" : "solo comunas sin proyecto"}` : ""}`],
    },
    avisos,
    generado_en: new Date().toISOString(),
  };
}

// Municipios de GESCOLAR (para el selector del reporte «Por comuna»).
async function listarMunicipios() {
  let datos;
  try { datos = await gescolar.cargarGescolar(); } catch (err) {
    console.error("Reportes (comunas): municipios:", err.message);
    const e = new Error("No se pudo consultar GESCOLAR. Intenta de nuevo en un momento."); e.estado = 502; throw e;
  }
  const m = new Map();
  datos.forEach((p) => { const t = limpiar(valorColumna(p, "municipio")); if (t && !m.has(plano(t))) m.set(plano(t), t); });
  return [...m.values()].sort((a, b) => a.localeCompare(b, "es"));
}

module.exports = {
  listarMunicipios,
  ErrorFiltro, limpiar, datoComuna, comunaDe, contextoAtencion, atencionDe, cargarProyectos, proyectosDe,
  FILTROS, validarFiltros, hayFiltros, hayFiltrosComuna, pasaFiltros, describirFiltros, armarReporteComunas, SOLO_COMUNA,
};
