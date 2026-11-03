// exportarInstrumentoUno.js — Excel con las respuestas del Instrumento Uno CDCE.
//
// Hoja "Visitas": una fila por visita, una columna por pregunta (en el orden del formulario,
// con las secciones marcadas en la fila de arriba). Las columnas salen de instrumentoUnoEsquema.js:
// si se agrega una pregunta al formulario, aparece sola en el Excel.
// Hoja "Edificios": instituciones que comparten edificio, por código de infraestructura.
//
// Los números van como números (se pueden sumar y filtrar). exceljs se carga solo al descargar.

const esquema = require("./instrumentoUnoEsquema");

const FUENTE = "Arial";
const AZUL = "FF002060";
const COLORES_SECCION = ["FFDCE6F2", "FFE2EFDA", "FFFFF2CC", "FFFCE4D6", "FFE4DFEC", "FFD9D9D9"];
const BORDE = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };

// Columnas de control (no son preguntas del formulario).
const COLUMNAS_CONTROL_INICIO = [
  { titulo: "Código DEA", ancho: 16, valor: (v) => v.codigo_dea },
  { titulo: "Estado", ancho: 11, valor: (v) => (v.estado === "ENVIADA" ? "Enviada" : "Borrador") },
  { titulo: "Fecha de visita", ancho: 13, valor: (v) => fechaExcel(v.fecha_visita), formato: "dd/mm/yyyy" },
  { titulo: "Ingeniero", ancho: 24, valor: (v) => v.ingeniero || "" },
  { titulo: "Código de infraestructura", ancho: 20, valor: (v) => v.codigo_infraestructura || "" },
];

function fechaExcel(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : "";
}

function etiquetaOpcion(campo, valor) {
  const op = (campo.opciones || []).find((o) => o.valor === valor);
  return op ? op.etiqueta : valor;
}

// Valor de una pregunta para una visita (número, texto o vacío).
function valorCampo(campo, datos) {
  const v = datos[campo.clave];
  if (v === undefined || v === null || v === "") return "";
  if (campo.tipo === "entero") return Number(v);
  if (campo.tipo === "select") return etiquetaOpcion(campo, v);
  if (campo.tipo === "multi") return (Array.isArray(v) ? v : []).map((x) => etiquetaOpcion(campo, x)).join(", ");
  return String(v);
}

function textoOtras(datos) {
  const lista = Array.isArray(datos.otras_instituciones) ? datos.otras_instituciones : [];
  return lista.map((o) => (o.codigo_dea ? `${o.nombre || "(sin nombre)"} [${o.codigo_dea}]` : o.nombre)).join("; ");
}

// Arma la lista de columnas: control + preguntas por sección (+ otras instituciones).
function armarColumnas() {
  const cols = COLUMNAS_CONTROL_INICIO.map((c) => ({ ...c, seccion: "Visita", nivelSeccion: 0 }));
  esquema.SECCIONES.forEach((s, i) => {
    const campos = [...s.campos];
    (s.grupos || []).forEach((g) => campos.push(...g.campos.map((c) => ({ ...c, _grupo: g.titulo }))));
    campos.forEach((c) => {
      const prefijo = c._grupo && /por nivel/i.test(c._grupo) ? `${c._grupo.replace(/ por nivel$/i, "")}: ` : "";
      cols.push({
        titulo: `${prefijo}${c.etiqueta}`,
        ancho: c.tipo === "parrafo" ? 40 : c.tipo === "entero" ? 13 : 22,
        seccion: s.titulo,
        nivelSeccion: i + 1,
        numerico: c.tipo === "entero",
        valor: (v) => valorCampo(c, v.datos || {}),
      });
    });
    if (s.lista) {
      cols.push({ titulo: s.lista.etiqueta, ancho: 45, seccion: s.titulo, nivelSeccion: i + 1, valor: (v) => textoOtras(v.datos || {}) });
    }
  });
  return cols;
}

function letra(n) {
  let s = "";
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/**
 * @param {{visitas: object[], miembros: object[], filtroTexto: string}} datos
 *   visitas: filas de iu_visitas (+ ingeniero); miembros: filas de iu_edificio_miembros.
 */
async function visitas({ visitas: lista, miembros, filtroTexto }) {
  const ExcelJS = require("exceljs"); // eslint-disable-line global-require
  const libro = new ExcelJS.Workbook();
  libro.creator = "SID — Zona Educativa Monagas";
  libro.created = new Date();

  const cols = armarColumnas();
  const hoja = libro.addWorksheet("Visitas", { views: [{ state: "frozen", xSplit: 3, ySplit: 4 }] });
  hoja.properties.tabColor = { argb: AZUL };

  // Fila 1: título; fila 2: subtítulo; fila 3: secciones; fila 4: encabezados.
  hoja.mergeCells(1, 1, 1, 8);
  const t = hoja.getCell(1, 1);
  t.value = "INSTRUMENTO UNO CDCE — RESPUESTAS DE LAS VISITAS";
  t.font = { name: FUENTE, size: 14, bold: true, color: { argb: AZUL } };
  hoja.mergeCells(2, 1, 2, 8);
  const hoy = new Date().toLocaleDateString("es-VE");
  hoja.getCell(2, 1).value = `Generado el ${hoy} · ${lista.length} visita(s)${filtroTexto ? " · " + filtroTexto : ""}`;
  hoja.getCell(2, 1).font = { name: FUENTE, size: 9, italic: true };

  // Secciones: se combinan las celdas contiguas con la misma sección.
  let ini = 1;
  for (let i = 1; i <= cols.length; i++) {
    if (i === cols.length || cols[i].seccion !== cols[ini - 1].seccion) {
      if (i > ini) hoja.mergeCells(3, ini, 3, i);
      const c = hoja.getCell(3, ini);
      c.value = cols[ini - 1].seccion.toUpperCase();
      c.font = { name: FUENTE, size: 9, bold: true };
      c.alignment = { horizontal: "center", vertical: "middle" };
      for (let k = ini; k <= i; k++) {
        const cc = hoja.getCell(3, k);
        cc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORES_SECCION[cols[ini - 1].nivelSeccion % COLORES_SECCION.length] } };
        cc.border = BORDE;
      }
      ini = i + 1;
    }
  }
  cols.forEach((c, i) => {
    const cell = hoja.getCell(4, i + 1);
    cell.value = c.titulo;
    cell.font = { name: FUENTE, size: 9, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = BORDE;
    hoja.getColumn(i + 1).width = c.ancho;
  });
  hoja.getRow(4).height = 42;

  lista.forEach((v, r) => {
    const fila = 5 + r;
    cols.forEach((c, i) => {
      const cell = hoja.getCell(fila, i + 1);
      cell.value = c.valor(v);
      cell.font = { name: FUENTE, size: 9 };
      cell.border = BORDE;
      cell.alignment = { vertical: "top", wrapText: !c.numerico, horizontal: c.numerico ? "right" : "left" };
      if (c.formato) cell.numFmt = c.formato;
      else if (c.numerico) cell.numFmt = "#,##0";
    });
  });

  // Totales de las columnas numéricas (matrícula, aulas, etc.)
  if (lista.length) {
    const fTot = 5 + lista.length;
    const ctot = hoja.getCell(fTot, 1);
    ctot.value = "TOTAL";
    cols.forEach((c, i) => {
      const cell = hoja.getCell(fTot, i + 1);
      cell.font = { name: FUENTE, size: 9, bold: true };
      cell.border = BORDE;
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } };
      if (c.numerico) {
        cell.value = { formula: `SUM(${letra(i + 1)}5:${letra(i + 1)}${fTot - 1})` };
        cell.numFmt = "#,##0";
        cell.alignment = { horizontal: "right" };
      }
    });
  }
  hoja.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: cols.length } };
  hoja.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  // Hoja de edificios compartidos
  const he = libro.addWorksheet("Edificios");
  he.properties.tabColor = { argb: "FF7030A0" };
  const encab = ["Código de infraestructura", "Código DEA", "Institución", "Registrada en la visita de"];
  const nombrePorVisita = new Map(lista.map((v) => [v.id, `${(v.datos && v.datos.nombre_plantel) || ""} [${v.codigo_dea}]`]));
  encab.forEach((e, i) => {
    const cell = he.getCell(1, i + 1);
    cell.value = e;
    cell.font = { name: FUENTE, size: 9, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = BORDE;
  });
  [24, 16, 50, 50].forEach((w, i) => { he.getColumn(i + 1).width = w; });
  const ordenados = [...miembros].sort((a, b) => String(a.codigo_infraestructura).localeCompare(String(b.codigo_infraestructura)) || a.id - b.id);
  ordenados.forEach((m, r) => {
    [m.codigo_infraestructura, m.codigo_dea || "", m.nombre, nombrePorVisita.get(m.visita_id) || ""].forEach((val, i) => {
      const cell = he.getCell(2 + r, i + 1);
      cell.value = val;
      cell.font = { name: FUENTE, size: 9 };
      cell.border = BORDE;
    });
  });
  he.views = [{ state: "frozen", ySplit: 1 }];
  if (ordenados.length) he.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 4 } };

  return libro.xlsx.writeBuffer();
}

module.exports = { visitas, armarColumnas };
