// exportarExcel.js — Genera los archivos de Excel del módulo Inspecciones con el
// mismo formato de los archivos oficiales que usa la oficina:
//   · consolidadoOficial(...)     → "LISTADO DE MATERIALES NUEVO <plan>" (rubros × planteles)
//   · consolidadoAdicionales(...) → materiales adicionales × planteles (para las autoridades)
//   · planilla(...)               → planilla individual con membrete, firmas y observaciones
//
// Los logos están en src/assets/ (los mismos de los archivos oficiales).
// La librería exceljs se carga solo cuando alguien descarga un Excel, para no
// gastar memoria del servidor gratuito mientras tanto.
//
// Las cantidades NO se redondean: cada celda lleva su propio formato de número
// (enteros sin decimales; con decimales, hasta 3).

const path = require("path");

const ASSETS = path.join(__dirname, "..", "assets");
const FUENTE = "Arial";
const AZUL = "FF002060";
const AMARILLO = "FFF6FF4B";
const NARANJA_CLARO = "FFFFEDD5";
const GRIS_CLARO = "FFD9D9D9";
const BORDE = {
  top: { style: "thin" },
  left: { style: "thin" },
  bottom: { style: "thin" },
  right: { style: "thin" },
};

function cargarExcelJS() {
  // eslint-disable-next-line global-require
  return require("exceljs");
}

function formatoNumero(n) {
  return Number.isInteger(n) ? "#,##0" : "#,##0.0##";
}

// Nombre de hoja válido para Excel: sin []:*?/\ y máximo 31 caracteres.
function nombreHoja(texto, respaldo) {
  const limpio = String(texto || "").replace(/[\[\]:*?\/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31);
  return limpio || respaldo;
}

function letraColumna(n) {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function logo(libro, hoja, archivo, extension, col, fila, ancho, alto) {
  const id = libro.addImage({ filename: path.join(ASSETS, archivo), extension });
  hoja.addImage(id, { tl: { col, row: fila }, ext: { width: ancho, height: alto }, editAs: "oneCell" });
}

function celda(c, valor, { fuente = FUENTE, tam = 10, negrita = false, color, relleno, h = "center", v = "middle", ajustar = true, formato, borde = true } = {}) {
  c.value = valor;
  c.font = { name: fuente, size: tam, bold: negrita, color: color ? { argb: color } : undefined };
  if (relleno) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: relleno } };
  c.alignment = { horizontal: h, vertical: v, wrapText: ajustar };
  if (borde) c.border = BORDE;
  if (formato) c.numFmt = formato;
}

function formatoFecha(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

// ---------------------------------------------------------------------------
// Tabla "rubros/materiales × planteles" (la usan los dos consolidados)
// ---------------------------------------------------------------------------

function crearBaseConsolidado({ titulo, encabezados, anchosFijos, nPlanteles, hoja, libro, logo2Col }) {
  hoja.properties.tabColor = { argb: "FF7030A0" };
  hoja.views = [{ state: "frozen", xSplit: anchosFijos.length, ySplit: 9, zoomScale: 70 }];
  // Hoja horizontal a escala fija: con 17 planteles no cabe en una sola página legible.
  // El encabezado y las columnas de rubro se repiten en cada página.
  hoja.pageSetup = { orientation: "landscape", paperSize: 1, scale: 55, fitToPage: false, margins: { left: 0.39, right: 0.39, top: 0.39, bottom: 0.39, header: 0, footer: 0 } };
  hoja.pageSetup.printTitlesRow = "9:9";
  hoja.pageSetup.printTitlesColumn = `A:${letraColumna(anchosFijos.length)}`;

  anchosFijos.forEach((a, i) => { hoja.getColumn(i + 1).width = a.ancho; if (a.oculta) hoja.getColumn(i + 1).hidden = true; });
  const primeraPlantel = anchosFijos.length + 1;
  for (let k = 0; k < nPlanteles; k++) hoja.getColumn(primeraPlantel + k).width = 16;
  hoja.getColumn(primeraPlantel + nPlanteles).width = 14; // TOTAL

  hoja.getRow(1).height = 19.5;
  for (let r = 2; r <= 7; r++) hoja.getRow(r).height = 12.75;
  logo(libro, hoja, "logo-educacion-grande.png", "png", 0.25, 0.1, 364, 95);
  logo(libro, hoja, "logo-fede-grande.jpg", "jpeg", logo2Col, 0.1, 363, 103);

  const ultima = anchosFijos.length + nPlanteles + 1;
  hoja.mergeCells(8, 1, 8, Math.max(anchosFijos.length, Math.min(ultima, 8)));
  celda(hoja.getCell(8, 1), titulo, { tam: 16, negrita: true, borde: false });
  hoja.getRow(8).height = 22;

  hoja.getRow(9).height = 86.4;
  encabezados.forEach((t, i) => celda(hoja.getCell(9, i + 1), t, { tam: 12, negrita: true, color: "FFFFFFFF", relleno: AZUL }));
}

// ---------------------------------------------------------------------------
// 1) Consolidado oficial
// ---------------------------------------------------------------------------

async function consolidadoOficial({ plan, planteles, rubros }) {
  const ExcelJS = cargarExcelJS();
  const libro = new ExcelJS.Workbook();
  libro.creator = "SID · Inspecciones";
  const hoja = libro.addWorksheet(nombreHoja(`PLAN ${plan.nombre}`, "CONSOLIDADO"));
  const fijos = [
    { ancho: 6.6 }, { ancho: 33.8 }, { ancho: 77 }, { ancho: 16 }, { ancho: 12.7, oculta: true },
  ];
  const nombresPlanteles = planteles.map((p) => String(p.nombre_plantel || p.codigo_dea).toUpperCase());
  crearBaseConsolidado({
    titulo: `LISTADO DE MATERIALES NUEVO ${String(plan.nombre).toUpperCase()}`,
    encabezados: ["NRO", "CAPITULO", "RUBRO", "UNIDAD", "REF_VIEJA", ...nombresPlanteles, "TOTAL"],
    anchosFijos: fijos,
    nPlanteles: planteles.length,
    hoja, libro, logo2Col: 2.55,
  });

  const c1 = fijos.length + 1;
  const cN = fijos.length + planteles.length;
  const cTotal = cN + 1;
  rubros.forEach((r, k) => {
    const fila = 10 + k;
    hoja.getRow(fila).height = 20.4;
    // Amarillo = rubro nuevo (no tenía referencia en la lista anterior), como en el archivo oficial.
    const nuevo = r.ref_vieja === null || r.ref_vieja === undefined || r.ref_vieja === "";
    const relleno = nuevo ? AMARILLO : undefined;
    celda(hoja.getCell(fila, 1), r.nro, { relleno });
    celda(hoja.getCell(fila, 2), r.capitulo, { relleno });
    celda(hoja.getCell(fila, 3), r.rubro, { h: "left", relleno });
    celda(hoja.getCell(fila, 4), r.unidad, { relleno });
    celda(hoja.getCell(fila, 5), nuevo ? null : r.ref_vieja, { tam: 12, negrita: true });
    let suma = 0;
    planteles.forEach((p, j) => {
      const v = r.cantidades[p.inspeccion_id];
      const tiene = typeof v === "number" && v > 0;
      if (tiene) suma += v;
      celda(hoja.getCell(fila, c1 + j), tiene ? v : null, { tam: 12, formato: tiene ? formatoNumero(v) : undefined });
    });
    const total = Number(r.total) > 0 ? Number(r.total) : suma;
    celda(hoja.getCell(fila, cTotal), { formula: `SUM(${letraColumna(c1)}${fila}:${letraColumna(cN)}${fila})`, result: total }, { tam: 12, negrita: true, formato: formatoNumero(total) });
  });
  // Autofiltro sobre el encabezado
  hoja.autoFilter = { from: { row: 9, column: 1 }, to: { row: 9 + rubros.length, column: cTotal } };

  // Segunda hoja: qué plantel es cada columna
  const h2 = libro.addWorksheet("PLANTELES");
  h2.columns = [{ width: 6 }, { width: 16 }, { width: 58 }, { width: 18 }, { width: 22 }];
  ["N.º", "CÓDIGO DEA", "PLANTEL", "MUNICIPIO", "PARROQUIA"].forEach((t, i) => celda(h2.getCell(1, i + 1), t, { tam: 11, negrita: true, color: "FFFFFFFF", relleno: AZUL }));
  planteles.forEach((p, k) => {
    [k + 1, p.codigo_dea, p.nombre_plantel, p.municipio || "", p.parroquia || ""].forEach((v, i) => celda(h2.getCell(k + 2, i + 1), v, { tam: 10, h: i === 2 ? "left" : "center" }));
  });
  h2.views = [{ state: "frozen", ySplit: 1 }];
  return libro.xlsx.writeBuffer();
}

// ---------------------------------------------------------------------------
// 2) Consolidado de adicionales
// ---------------------------------------------------------------------------

async function consolidadoAdicionales({ plan, planteles, materiales }) {
  const ExcelJS = cargarExcelJS();
  const libro = new ExcelJS.Workbook();
  libro.creator = "SID · Inspecciones";
  const hoja = libro.addWorksheet(nombreHoja(`ADICIONALES ${plan.nombre}`, "ADICIONALES"));
  const fijos = [{ ancho: 6.6 }, { ancho: 62 }, { ancho: 12 }];
  crearBaseConsolidado({
    titulo: `MATERIALES ADICIONALES ${String(plan.nombre).toUpperCase()}`,
    encabezados: ["NRO", "MATERIAL", "UNIDAD", ...planteles.map((p) => String(p.nombre_plantel || p.codigo_dea).toUpperCase()), "TOTAL"],
    anchosFijos: fijos,
    nPlanteles: planteles.length,
    hoja, libro, logo2Col: 3.1,
  });

  const c1 = fijos.length + 1;
  const cN = fijos.length + planteles.length;
  const cTotal = cN + 1;
  let hayPendientes = false;
  materiales.forEach((m, k) => {
    const fila = 10 + k;
    hoja.getRow(fila).height = 20.4;
    const pendiente = m.estado === "PENDIENTE";
    if (pendiente) hayPendientes = true;
    const relleno = pendiente ? AMARILLO : undefined;
    celda(hoja.getCell(fila, 1), k + 1, { relleno });
    celda(hoja.getCell(fila, 2), m.nombre, { h: "left", relleno });
    celda(hoja.getCell(fila, 3), m.unidad, { relleno });
    let suma = 0;
    planteles.forEach((p, j) => {
      const v = m.cantidades[p.inspeccion_id];
      const tiene = typeof v === "number" && v > 0;
      if (tiene) suma += v;
      celda(hoja.getCell(fila, c1 + j), tiene ? v : null, { tam: 12, formato: tiene ? formatoNumero(v) : undefined });
    });
    const total = Number(m.total) > 0 ? Number(m.total) : suma;
    celda(hoja.getCell(fila, cTotal), { formula: `SUM(${letraColumna(c1)}${fila}:${letraColumna(cN)}${fila})`, result: total }, { tam: 12, negrita: true, formato: formatoNumero(total) });
  });
  if (hayPendientes) {
    const f = 10 + materiales.length + 1;
    celda(hoja.getCell(f, 2), "Filas en amarillo: materiales pendientes de aprobación.", { h: "left", borde: false, tam: 9 });
    hoja.getCell(f, 2).font = { name: FUENTE, size: 9, italic: true };
  }
  if (materiales.length) hoja.autoFilter = { from: { row: 9, column: 1 }, to: { row: 9 + materiales.length, column: cTotal } };

  const h2 = libro.addWorksheet("PLANTELES");
  h2.columns = [{ width: 6 }, { width: 16 }, { width: 58 }, { width: 18 }, { width: 22 }];
  ["N.º", "CÓDIGO DEA", "PLANTEL", "MUNICIPIO", "PARROQUIA"].forEach((t, i) => celda(h2.getCell(1, i + 1), t, { tam: 11, negrita: true, color: "FFFFFFFF", relleno: AZUL }));
  planteles.forEach((p, k) => {
    [k + 1, p.codigo_dea, p.nombre_plantel, p.municipio || "", p.parroquia || ""].forEach((v, i) => celda(h2.getCell(k + 2, i + 1), v, { tam: 10, h: i === 2 ? "left" : "center" }));
  });
  h2.views = [{ state: "frozen", ySplit: 1 }];
  return libro.xlsx.writeBuffer();
}

// ---------------------------------------------------------------------------
// 3) Planilla individual (membrete + rubros + adicionales + observaciones + firmas)
// ---------------------------------------------------------------------------

function numeroOTexto(valor) {
  const t = String(valor === undefined || valor === null ? "" : valor).trim();
  return /^\d{1,9}$/.test(t) ? Number(t) : t;
}

async function planilla({ inspeccion, rubros, adicionales }) {
  const ExcelJS = cargarExcelJS();
  const libro = new ExcelJS.Workbook();
  libro.creator = "SID · Inspecciones";
  const d = inspeccion.datos_plantel || {};
  const hoja = libro.addWorksheet(nombreHoja(d.institucion || inspeccion.codigo_dea, "PLANILLA"));
  hoja.properties.tabColor = { argb: "FFFFFF00" };
  [4.8, 36.8, 74.3, 12.4, 21.9].forEach((a, i) => { hoja.getColumn(i + 1).width = a; });
  hoja.pageSetup = { orientation: "portrait", paperSize: 1, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.24, right: 0.24, top: 0.39, bottom: 0.39, header: 0, footer: 0 } };
  hoja.pageSetup.printTitlesRow = "12:13";

  hoja.getRow(1).height = 50.4;
  logo(libro, hoja, "logo-educacion.png", "png", 0.05, 0.05, 269, 60);
  logo(libro, hoja, "logo-fede.png", "png", 3.2, 0.05, 168, 60);

  const etiquetas = [
    ["NOMBRE DE LA INSTITUCIÓN:", d.institucion],
    ["CÓDIGO DEA:", inspeccion.codigo_dea],
    ["NÚMERO DE AULAS:", numeroOTexto(d.aulas)],
    ["MATRICULA:", numeroOTexto(d.matricula)],
    ["MUNICIPIO:", d.municipio],
    ["PARROQUIA:", d.parroquia],
    ["DIRECCIÓN:", d.direccion],
    ["NOMBRE DEL DIRECTOR:", d.director],
    ["TELEFONO:", d.telefono],
  ];
  const ings = inspeccion.inspectores || [];
  const derecha = [
    "INSPECTOR (ES)",
    ...[0, 1, 2, 3, 4].map((k) => `${k + 1}-${ings[k] ? " " + String(ings[k]).toUpperCase() : ""}`),
    `COMUNA: ${(d.comuna || "").toUpperCase()}`,
    `COMUNIDAD: ${(d.comunidad || "").toUpperCase()}`,
    `FECHA: ${formatoFecha(inspeccion.fecha_inspeccion)}`,
  ];
  etiquetas.forEach(([et, val], k) => {
    const f = 2 + k;
    // Dirección o comuna largas ocupan dos líneas
    hoja.getRow(f).height = String(val || "").length > 62 || derecha[k].length > 32 ? 31 : 19.2;
    hoja.mergeCells(f, 1, f, 2);
    celda(hoja.getCell(f, 1), et, { fuente: "Calibri", tam: 10, negrita: true, h: "left" });
    hoja.getCell(f, 2).border = BORDE;
    celda(hoja.getCell(f, 3), val === undefined || val === null ? "" : val, { fuente: "Calibri", tam: 11 });
    hoja.mergeCells(f, 4, f, 5);
    celda(hoja.getCell(f, 4), derecha[k], { fuente: "Calibri", tam: 11, negrita: true });
    hoja.getCell(f, 5).border = BORDE;
  });
  hoja.getRow(11).height = 19.2;

  hoja.mergeCells(12, 1, 12, 5);
  celda(hoja.getCell(12, 1), "LISTADO DE MATERIALES 2026", { tam: 20, negrita: true, borde: false });
  hoja.getRow(12).height = 30;
  ["NRO", "CAPITULO", "RUBRO", "UNIDAD", "CANTIDAD"].forEach((t, i) => celda(hoja.getCell(13, i + 1), t, { negrita: true, relleno: GRIS_CLARO }));
  hoja.getRow(13).height = 19.2;

  let fila = 14;
  const cant = (v) => (typeof v === "number" && v > 0 ? v : null);
  rubros.forEach((r) => {
    hoja.getRow(fila).height = 19.2;
    celda(hoja.getCell(fila, 1), r.nro);
    celda(hoja.getCell(fila, 2), r.capitulo);
    celda(hoja.getCell(fila, 3), r.rubro, { h: "left" });
    celda(hoja.getCell(fila, 4), r.unidad);
    const v = cant(r.cantidad);
    celda(hoja.getCell(fila, 5), v, { formato: v === null ? undefined : formatoNumero(v) });
    fila++;
  });

  if (adicionales && adicionales.length) {
    hoja.mergeCells(fila, 1, fila, 5);
    celda(hoja.getCell(fila, 1), "MATERIALES ADICIONALES (fuera de la lista oficial)", { tam: 12, negrita: true, relleno: NARANJA_CLARO });
    hoja.getRow(fila).height = 22;
    fila++;
    ["NRO", "TIPO", "MATERIAL", "UNIDAD", "CANTIDAD"].forEach((t, i) => celda(hoja.getCell(fila, i + 1), t, { negrita: true, relleno: NARANJA_CLARO }));
    fila++;
    adicionales.forEach((a, k) => {
      hoja.getRow(fila).height = 19.2;
      celda(hoja.getCell(fila, 1), k + 1);
      celda(hoja.getCell(fila, 2), "ADICIONAL");
      celda(hoja.getCell(fila, 3), a.nombre, { h: "left" });
      celda(hoja.getCell(fila, 4), a.unidad);
      const v = cant(a.cantidad);
      celda(hoja.getCell(fila, 5), v, { formato: v === null ? undefined : formatoNumero(v) });
      fila++;
    });
  }

  // Observaciones (4 filas) y firmas (5 filas), como en la planilla oficial
  hoja.mergeCells(fila, 1, fila + 3, 5);
  const obs = String(inspeccion.observaciones || "").trim();
  celda(hoja.getCell(fila, 1), obs ? `OBSERVACIONES: ${obs}` : "OBSERVACIONES:", { fuente: "Calibri", tam: 9, negrita: true, h: "left", v: "top" });
  for (let r = fila; r <= fila + 3; r++) for (let c = 1; c <= 5; c++) hoja.getCell(r, c).border = BORDE;
  fila += 4;
  hoja.mergeCells(fila, 1, fila + 4, 5);
  celda(hoja.getCell(fila, 1), "FIRMAN CONFORMES", { fuente: "Calibri", tam: 8, v: "top" });
  for (let r = fila; r <= fila + 4; r++) for (let c = 1; c <= 5; c++) hoja.getCell(r, c).border = BORDE;

  return libro.xlsx.writeBuffer();
}

module.exports = { consolidadoOficial, consolidadoAdicionales, planilla };
