// instrumentoUnoEsquema.js — preguntas, validaciones y precarga (desde GESCOLAR) del
// INSTRUMENTO UNO CDCE. Es la ÚNICA definición del formulario: el servidor la usa para validar
// y las pantallas la reciben por /api/inspecciones/instrumento-uno/esquema y dibujan los campos.
// Así no hay dos listas de preguntas que se puedan desfasar.

const MUNICIPIOS = [
  "Acosta", "Aguasay", "Bolívar", "Caripe", "Cedeño", "Ezequiel Zamora", "Libertador",
  "Maturín", "Piar", "Punceres", "Santa Bárbara", "Sotillo", "Uracoa",
];

const TURNOS = ["Mañana", "Tarde", "Nocturno", "Sabatino", "Otro"];

// Niveles tal como vienen en GESCOLAR (columnas total_*).
const NIVELES = [
  { clave: "maternal", etiqueta: "Maternal", gescolar: "total_maternal" },
  { clave: "preescolar", etiqueta: "Preescolar", gescolar: "total_preescolar" },
  { clave: "primaria", etiqueta: "Primaria", gescolar: "total_primaria" },
  { clave: "media", etiqueta: "Media", gescolar: "total_media" },
  { clave: "media_general", etiqueta: "Media general", gescolar: "total_media_general" },
  { clave: "tecnica", etiqueta: "Técnica", gescolar: "total_tecnica" },
  { clave: "adulto", etiqueta: "Adulto", gescolar: "total_adulto" },
  { clave: "mr", etiqueta: "MR", gescolar: "total_mr" },
  { clave: "ribas_tecnica", etiqueta: "Ribas técnica", gescolar: "total_ribas_tecnica" },
  { clave: "especial", etiqueta: "Especial", gescolar: "total_especial" },
];

// Estado de un espacio: una sola pregunta (en vez de «operativo: sí/no»), para distinguir
// «no existe» (hay que construir) de «existe pero no sirve» (hay que rehabilitar).
const ESTADO_ESPACIO = [
  { valor: "NO_EXISTE", etiqueta: "No existe" },
  { valor: "OPERATIVO", etiqueta: "Existe y está operativo" },
  { valor: "NO_OPERATIVO", etiqueta: "Existe y NO está operativo" },
];
const SI_NO = [{ valor: "SI", etiqueta: "Sí" }, { valor: "NO", etiqueta: "No" }];

const DOC_TIENE = [
  { valor: "SI", etiqueta: "Sí tiene documento" },
  { valor: "EN_TRAMITE", etiqueta: "En trámite" },
  { valor: "NO", etiqueta: "No tiene documento" },
];
const DOC_TIPO = [
  { valor: "TITULO_PROPIEDAD", etiqueta: "Título de propiedad" },
  { valor: "COMODATO", etiqueta: "Comodato" },
  { valor: "ALQUILER", etiqueta: "Alquiler" },
  { valor: "DONACION", etiqueta: "Donación" },
  { valor: "OTRO", etiqueta: "Otro" },
];
function grupoLegal(id, titulo, ayuda, prefijo) {
  const doc = `${prefijo}_documento`;
  return {
    id, titulo, ayuda,
    campos: [
      { clave: doc, etiqueta: "¿Tiene documentación legal?", tipo: "select", obligatorio: true, opciones: DOC_TIENE },
      { clave: `${prefijo}_tipo`, etiqueta: "Tipo de documento", tipo: "select", opciones: DOC_TIPO, visibleSi: { clave: doc, valores: ["SI", "EN_TRAMITE"] }, ayuda: "Obligatorio si ya tiene el documento; si está en trámite, indica cuál se tramita (opcional)." },
      { clave: `${prefijo}_detalle`, etiqueta: "Propietario / quien otorga el documento", tipo: "texto", visibleSi: { clave: doc, valores: ["SI", "EN_TRAMITE"] }, ayuda: "Opcional. Ej.: Gobernación, alcaldía, iglesia, particular, comunidad." },
    ],
  };
}

const PATRON_CEDULA = "^\\d{6,9}$";
// 11 dígitos: fijos 02xx (p. ej. 0291 de Monagas) y móviles 0412, 0414, 0416, 0424, 0426.
const PATRON_TELEFONO = "^0(2\\d{2}|4(12|14|16|24|26))\\d{7}$";
const PATRON_CODIGO = "^[A-Za-z0-9]{6,15}$";

const anioActual = () => new Date().getFullYear();

function entero(clave, etiqueta, min, max, extra = {}) {
  return { clave, etiqueta, tipo: "entero", min, max, ...extra };
}

const SECCIONES = [
  {
    id: "plantel",
    titulo: "Datos del plantel",
    ayuda: "Estos datos vienen de GESCOLAR. Confírmalos o corrígelos; lo corregido solo queda en este instrumento.",
    campos: [
      { clave: "nombre_plantel", etiqueta: "Nombre del plantel", tipo: "texto", obligatorio: true, gescolar: ["nombre_plantel"] },
      { clave: "municipio", etiqueta: "Municipio", tipo: "select", obligatorio: true, opciones: MUNICIPIOS.map((m) => ({ valor: m, etiqueta: m })), gescolar: ["municipio"] },
      { clave: "parroquia", etiqueta: "Parroquia", tipo: "texto", obligatorio: true, gescolar: ["parroquia"] },
      { clave: "comuna", etiqueta: "Comuna", tipo: "texto", gescolar: ["nomb_circuito"] },
      { clave: "consejo_comunal", etiqueta: "Consejo comunal", tipo: "texto", gescolar: ["nom_consejo_com"] },
      { clave: "comunidad_sector", etiqueta: "Comunidad / Sector", tipo: "texto", obligatorio: true },
      { clave: "direccion", etiqueta: "Dirección con referencia", tipo: "parrafo", obligatorio: true, gescolar: ["direccion"] },
      { clave: "anio_fundacion", etiqueta: "Año de fundación", tipo: "entero", min: 1800, max: anioActual(), ayuda: "Número de 4 dígitos, entre 1800 y el año actual." },
      { clave: "turno", etiqueta: "Turno", tipo: "multi", obligatorio: true, opciones: TURNOS.map((t) => ({ valor: t, etiqueta: t })), ayuda: "Marca todos los que apliquen." },
    ],
    grupos: [
      {
        id: "matricula",
        titulo: "Matrícula estudiantil por nivel",
        ayuda: "Número de estudiantes por nivel. Escribe 0 si no hay.",
        campos: NIVELES.map((n) => entero(`matricula_${n.clave}`, n.etiqueta, 0, 20000, { obligatorio: true, gescolar: [n.gescolar] })),
      },
      {
        id: "secciones",
        titulo: "Número de secciones por nivel",
        ayuda: "Cantidad de secciones (grados o años) que funcionan en cada nivel. Escribe 0 si no hay.",
        campos: NIVELES.map((n) => entero(`secciones_${n.clave}`, n.etiqueta, 0, 200, { obligatorio: true, dependeDe: `matricula_${n.clave}` })),
      },
    ],
  },
  {
    id: "director",
    titulo: "Datos del director(a)",
    ayuda: "Datos de contacto de quien dirige el plantel. Se usan solo para comunicarse con el plantel; no se publican.",
    campos: [
      { clave: "director_nombre", etiqueta: "Nombres y apellidos", tipo: "texto", obligatorio: true, gescolar: ["director_nombre"] },
      { clave: "director_tipo_documento", etiqueta: "Tipo de documento", tipo: "select", obligatorio: true, opciones: [{ valor: "V", etiqueta: "V" }, { valor: "E", etiqueta: "E" }], gescolar: ["tipo_documento"] },
      { clave: "director_documento", etiqueta: "Número de cédula", tipo: "texto", obligatorio: true, patron: PATRON_CEDULA, mensaje: "Solo dígitos (6 a 9), sin puntos ni guiones.", ayuda: "Solo números, sin puntos ni guiones.", gescolar: ["documento_identidad"] },
      { clave: "director_telefono", etiqueta: "Teléfono", tipo: "texto", patron: PATRON_TELEFONO, mensaje: "11 dígitos, sin espacios ni guiones (ej. 02911234567).", ayuda: "11 dígitos, sin espacios ni guiones. Ej. 02911234567.", telefono: true, gescolar: ["telefono_director"] },
      { clave: "director_telefono_movil", etiqueta: "Teléfono móvil", tipo: "texto", patron: PATRON_TELEFONO, mensaje: "11 dígitos, sin espacios ni guiones (ej. 04141234567).", ayuda: "11 dígitos, sin espacios ni guiones. Ej. 04141234567.", telefono: true, gescolar: ["telefono_movil_director"] },
      { clave: "director_correo", etiqueta: "Correo", tipo: "correo", gescolar: ["correo"] },
      { clave: "atendio_nombre", etiqueta: "Persona que atendió la visita (si no fue el director)", tipo: "texto" },
      { clave: "atendio_cargo", etiqueta: "Cargo de quien atendió", tipo: "texto" },
    ],
    reglas: ["telefono_alguno"],
  },
  {
    id: "infraestructura",
    titulo: "Infraestructura",
    ayuda: "Escribe 0 cuando no haya. Para cocina, comedor, biblioteca y CBIT indica si existen y en qué estado están.",
    campos: [
      entero("pisos", "Número de pisos", 1, 10, { obligatorio: true }),
      entero("aulas_total", "Número de aulas (total)", 0, 200, { obligatorio: true, gescolar: ["cant_aulas"] }),
      entero("aulas_operativas", "Aulas operativas", 0, 200, { obligatorio: true }),
      entero("aulas_no_operativas", "Aulas NO operativas", 0, 200, { obligatorio: true }),
      entero("canchas_operativas", "Canchas operativas", 0, 20, { obligatorio: true }),
      entero("canchas_no_operativas", "Canchas NO operativas", 0, 20, { obligatorio: true }),
      { clave: "cancha_techada", etiqueta: "¿Hay cancha techada?", tipo: "select", opciones: SI_NO, ayuda: "Obligatoria si hay alguna cancha.", dependeDe: "canchas" },
      entero("laboratorios_operativos", "Laboratorios operativos", 0, 20, { obligatorio: true }),
      entero("laboratorios_no_operativos", "Laboratorios NO operativos", 0, 20, { obligatorio: true }),
      entero("salas_bano_operativas", "Salas de baño operativas", 0, 100, { obligatorio: true }),
      entero("salas_bano_no_operativas", "Salas de baño NO operativas", 0, 100, { obligatorio: true }),
      { clave: "biblioteca", etiqueta: "Biblioteca", tipo: "select", obligatorio: true, opciones: ESTADO_ESPACIO },
      { clave: "cocina", etiqueta: "Cocina", tipo: "select", obligatorio: true, opciones: ESTADO_ESPACIO },
      { clave: "comedor", etiqueta: "Comedor", tipo: "select", obligatorio: true, opciones: ESTADO_ESPACIO },
      { clave: "cbit", etiqueta: "CBIT", tipo: "select", obligatorio: true, opciones: ESTADO_ESPACIO },
      { clave: "huerto_escolar", etiqueta: "¿Tiene huerto escolar?", tipo: "select", opciones: SI_NO },
      { clave: "observaciones_infra", etiqueta: "Observaciones", tipo: "parrafo" },
    ],
  },
  {
    id: "edificio",
    titulo: "Edificio compartido",
    ayuda: "Si en este mismo edificio funciona otra institución (otro plantel), se le asigna un código de infraestructura común.",
    campos: [
      { clave: "comparte_edificio", etiqueta: "¿Funciona otra institución en este edificio?", tipo: "select", obligatorio: true, opciones: SI_NO },
    ],
    lista: { clave: "otras_instituciones", etiqueta: "Otras instituciones del edificio", max: 10 },
  },
  {
    id: "legal",
    titulo: "Situación legal",
    ayuda: "Documentación que respalda el edificio y el terreno (título de propiedad, comodato, alquiler o donación). Si en el edificio funcionan varias instituciones, es la del edificio.",
    campos: [],
    grupos: [
      grupoLegal("legal_edificio", "Edificio", "", "legal_edificio"),
      grupoLegal("legal_terreno", "Terreno", "", "legal_terreno"),
    ],
  },
];
SECCIONES[SECCIONES.length - 1].grupos.push({
  id: "legal_obs", titulo: "Observaciones", ayuda: "",
  campos: [{ clave: "legal_observaciones", etiqueta: "Observaciones sobre la situación legal", tipo: "parrafo" }],
});

function todosLosCampos() {
  const r = [];
  SECCIONES.forEach((s) => {
    r.push(...s.campos);
    (s.grupos || []).forEach((g) => r.push(...g.campos));
  });
  return r;
}

// ---------------------------------------------------------------------------
// Precarga desde GESCOLAR
// ---------------------------------------------------------------------------

function normalizar(texto) {
  return String(texto == null ? "" : texto).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
}

function normalizarClave(k) {
  return normalizar(k).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

// Algunos valores de GESCOLAR llegan con UTF-8 leído como Windows-1252 («EDUCACIÃ“N»).
function arreglarCodificacion(texto) {
  if (typeof texto !== "string" || !/[ÃÂ]/.test(texto)) return texto;
  try {
    const arreglado = Buffer.from(texto, "latin1").toString("utf8");
    return arreglado.includes("�") ? texto : arreglado;
  } catch (_) {
    return texto;
  }
}

function limpiar(valor) {
  return arreglarCodificacion(String(valor == null ? "" : valor)).replace(/\s+/g, " ").trim();
}

// GESCOLAR trae los celulares sin el 0 inicial (4167285103) y algunos teléfonos de relleno (0, 2920000000).
function telefonoDeGescolar(valor) {
  const d = String(valor == null ? "" : valor).replace(/\D/g, "");
  if (!d || /^0+$/.test(d) || /0000000$/.test(d)) return "";
  return d.length === 10 ? "0" + d : d;
}

// Lo que dice GESCOLAR para cada campo del esquema, como texto (solo los que tienen valor).
function valoresDeGescolar(fila) {
  const porClave = {};
  Object.keys(fila || {}).forEach((k) => { porClave[normalizarClave(k)] = fila[k]; });
  const salida = {};
  todosLosCampos().forEach((c) => {
    if (!c.gescolar) return;
    for (const cand of c.gescolar) {
      let v = porClave[normalizarClave(cand)];
      if (v === undefined || v === null) continue;
      v = c.telefono ? telefonoDeGescolar(v) : limpiar(v);
      if (/^#N\/?A$/i.test(v)) v = "";
      if (v === "") continue;
      if (c.tipo === "entero") {
        const n = Number(v.replace(",", "."));
        if (!Number.isInteger(n) || n < 0) continue;
        // cant_aulas viene vacía casi siempre; un 0 de relleno no es un dato real
        if (c.clave === "aulas_total" && n === 0) continue;
        v = String(n);
      }
      if (c.tipo === "select") {
        const op = (c.opciones || []).find((o) => normalizar(o.valor) === normalizar(v));
        if (!op) continue;
        v = op.valor;
      }
      salida[c.clave] = v;
      break;
    }
  });
  return salida;
}

// ---------------------------------------------------------------------------
// Validación
// ---------------------------------------------------------------------------

const MAX_TEXTO = 200;
const MAX_PARRAFO = 1000;

function aTexto(v) {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : typeof v === "number" ? String(v) : "";
}

// Limpia y valida las respuestas. Con enviar=false (borrador) solo se exige que lo escrito sea válido;
// con enviar=true además se exigen los campos obligatorios y las reglas cruzadas.
// Devuelve { datos, errores } (errores: clave → mensaje).
function validar(entrada, { enviar = false } = {}) {
  const e = entrada && typeof entrada === "object" ? entrada : {};
  const datos = {};
  const errores = {};

  todosLosCampos().forEach((c) => {
    const bruto = e[c.clave];
    if (c.tipo === "multi") {
      const lista = Array.isArray(bruto) ? bruto : [];
      const validas = c.opciones.map((o) => o.valor);
      const limpias = [...new Set(lista.map(aTexto).filter(Boolean))];
      if (limpias.some((x) => !validas.includes(x))) { errores[c.clave] = "Opción no válida."; return; }
      if (limpias.length) datos[c.clave] = limpias;
      return;
    }
    let v = c.tipo === "parrafo" ? String(bruto == null ? "" : bruto).replace(/[ \t]+/g, " ").trim() : aTexto(bruto);
    if (v === "") return;
    if (c.tipo === "texto" || c.tipo === "parrafo" || c.tipo === "correo") {
      const tope = c.tipo === "parrafo" ? MAX_PARRAFO : MAX_TEXTO;
      if (v.length > tope) { errores[c.clave] = `Máximo ${tope} caracteres.`; return; }
    }
    if (c.tipo === "entero") {
      if (!/^\d+$/.test(v)) { errores[c.clave] = "Escribe un número entero (sin decimales)."; return; }
      const n = Number(v);
      if (c.min !== undefined && n < c.min) { errores[c.clave] = `El mínimo es ${c.min}.`; return; }
      if (c.max !== undefined && n > c.max) { errores[c.clave] = `El máximo es ${c.max}.`; return; }
      datos[c.clave] = String(n);
      return;
    }
    if (c.tipo === "select") {
      const op = (c.opciones || []).find((o) => o.valor === v || normalizar(o.valor) === normalizar(v));
      if (!op) { errores[c.clave] = "Opción no válida."; return; }
      datos[c.clave] = op.valor;
      return;
    }
    if (c.tipo === "correo" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { errores[c.clave] = "Correo no válido."; return; }
    if (c.patron && !new RegExp(c.patron).test(v)) { errores[c.clave] = c.mensaje || "Formato no válido."; return; }
    datos[c.clave] = v;
  });

  // Otras instituciones del edificio
  let otras = [];
  const lista = Array.isArray(e.otras_instituciones) ? e.otras_instituciones : [];
  if (lista.length > 10) errores.otras_instituciones = "Máximo 10 instituciones.";
  const vistos = new Set();
  lista.slice(0, 10).forEach((o, i) => {
    const codigo = aTexto(o && o.codigo_dea).toUpperCase();
    const nombre = aTexto(o && o.nombre);
    if (!codigo && !nombre) return;
    if (codigo && !new RegExp(PATRON_CODIGO).test(codigo)) { errores[`otras_instituciones.${i}`] = "Código no válido (letras y números, sin espacios)."; return; }
    if (nombre.length > 150) { errores[`otras_instituciones.${i}`] = "Nombre demasiado largo."; return; }
    const clave = codigo || `N:${normalizar(nombre)}`;
    if (vistos.has(clave)) { errores[`otras_instituciones.${i}`] = "Esa institución está repetida."; return; }
    vistos.add(clave);
    otras.push({ codigo_dea: codigo, nombre });
  });
  if (datos.comparte_edificio === "NO") otras = [];
  // sin documento no hay tipo ni propietario que guardar
  ["legal_edificio", "legal_terreno"].forEach((p) => {
    if (datos[`${p}_documento`] !== "SI" && datos[`${p}_documento`] !== "EN_TRAMITE") { delete datos[`${p}_tipo`]; delete datos[`${p}_detalle`]; }
  });
  datos.otras_instituciones = otras;

  if (enviar) {
    todosLosCampos().forEach((c) => {
      if (!c.obligatorio || errores[c.clave]) return;
      // las secciones por nivel solo se exigen si el nivel tiene matrícula
      if (c.dependeDe && c.dependeDe.startsWith("matricula_") && !(Number(datos[c.dependeDe]) > 0)) return;
      const v = datos[c.clave];
      if (v === undefined || (Array.isArray(v) && !v.length)) errores[c.clave] = "Obligatorio.";
    });
    if (!datos.director_telefono && !datos.director_telefono_movil && !errores.director_telefono && !errores.director_telefono_movil) {
      errores.director_telefono_movil = "Indica al menos un teléfono (fijo o móvil).";
    }
    if ((Number(datos.canchas_operativas) || 0) + (Number(datos.canchas_no_operativas) || 0) > 0 && !datos.cancha_techada && !errores.cancha_techada) {
      errores.cancha_techada = "Indica si la cancha es techada.";
    }
    ["legal_edificio", "legal_terreno"].forEach((p) => {
      if (datos[`${p}_documento`] === "SI" && !datos[`${p}_tipo`] && !errores[`${p}_tipo`]) errores[`${p}_tipo`] = "Indica qué tipo de documento tiene.";
    });
    if (datos.comparte_edificio === "SI" && !otras.length && !errores.otras_instituciones) {
      errores.otras_instituciones = "Agrega la otra institución que funciona en el edificio (con su código DEA, o solo el nombre si no tiene).";
    }
  }
  return { datos, errores };
}

// Avisos (no bloquean): cosas que probablemente son un error de digitación.
function avisos(datos) {
  const r = [];
  const t = Number(datos.aulas_total), o = Number(datos.aulas_operativas), n = Number(datos.aulas_no_operativas);
  if ([t, o, n].every(Number.isFinite) && o + n !== t) r.push("Las aulas operativas y NO operativas no suman el total de aulas.");
  return r;
}

module.exports = {
  SECCIONES, MUNICIPIOS, NIVELES, ESTADO_ESPACIO, PATRON_CODIGO,
  todosLosCampos, valoresDeGescolar, validar, avisos, normalizar,
};
