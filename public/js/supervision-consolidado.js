// supervision-consolidado.js — vista combinada equivalente a la hoja
// CONSOLIDADO del Excel original: un plantel por fila con su director,
// supervisores asignados y última matrícula. Incluye botón para exportar
// a CSV (se genera en el navegador, no depende de ninguna librería externa).

const COLUMNAS = [
  { clave: "codigo_plantel", titulo: "Código" },
  { clave: "eponimo_actual", titulo: "Epónimo actual" },
  { clave: "denominacion", titulo: "Denominación" },
  { clave: "dependencia", titulo: "Dependencia" },
  { clave: "turno", titulo: "Turno" },
  { clave: "nombre_comuna", titulo: "Comuna" },
  { clave: "director_nombre", titulo: "Director" },
  { clave: "director_cedula", titulo: "Cédula director" },
  { clave: "supervisores_municipales", titulo: "Supervisor(es) municipal(es)" },
  { clave: "supervisores_circuitales", titulo: "Supervisor(es) circuital(es)" },
  { clave: "matricula_periodo", titulo: "Período matrícula" },
  { clave: "matricula_hembras", titulo: "Hembras" },
  { clave: "matricula_varones", titulo: "Varones" },
  { clave: "matricula_total", titulo: "Total matrícula" },
];

const usuario = renderShell("supervision-consolidado", "Supervisión · Consolidado");
let filas = [];

if (usuario) cargarPantalla();

async function cargarPantalla() {
  const contenido = document.getElementById("contenido");
  contenido.innerHTML = `<div class="cargando">Generando consolidado…</div>`;
  try {
    const resp = await RAC.get("/api/supervision/consolidado");
    filas = RAC.lista(resp, "consolidado");
    dibujarPantalla();
  } catch (err) {
    contenido.innerHTML = `<div class="panel" style="padding:20px;"><div class="vacio"><strong>No se pudo cargar</strong>${escapar(err.message)}</div></div>`;
  }
}

function dibujarPantalla() {
  const contenido = document.getElementById("contenido");
  contenido.innerHTML = `
    <section class="planteles-hero">
      <div class="planteles-hero-copy">
        <span class="planteles-eyebrow">SUPERVISIÓN</span>
        <h1>Consolidado</h1>
        <p>Vista combinada de planteles, directores y supervisores · ${filas.length} filas</p>
      </div>
    </section>

    <div class="panel" style="padding:20px; margin-bottom:20px; display:flex; justify-content:flex-end;">
      <button type="button" class="btn" id="btnExportar">Exportar a CSV</button>
    </div>

    <div class="panel" style="padding:20px;">
      ${filas.length ? `
        <div class="tabla-responsive">
          <table>
            <thead><tr>${COLUMNAS.map((c) => `<th>${escapar(c.titulo)}</th>`).join("")}</tr></thead>
            <tbody>${filas.map((fila) => `
              <tr>${COLUMNAS.map((c) => `<td>${escapar(fila[c.clave] ?? "—")}</td>`).join("")}</tr>`).join("")}
            </tbody>
          </table>
        </div>
      ` : `<div class="vacio"><strong>Sin datos todavía</strong>Carga planteles, directores y supervisores para ver el consolidado.</div>`}
    </div>
  `;

  document.getElementById("btnExportar").addEventListener("click", exportarCsv);
}

function exportarCsv() {
  if (!filas.length) {
    mostrarToast("No hay datos para exportar.", true);
    return;
  }
  const encabezado = COLUMNAS.map((c) => escaparCsv(c.titulo)).join(",");
  const cuerpo = filas.map((fila) => COLUMNAS.map((c) => escaparCsv(fila[c.clave])).join(",")).join("\n");
  // BOM al inicio para que Excel detecte UTF-8 y no dañe tildes/ñ.
  const contenido = "\uFEFF" + encabezado + "\n" + cuerpo;
  const blob = new Blob([contenido], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = `consolidado-supervision-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(enlace);
  enlace.click();
  document.body.removeChild(enlace);
  URL.revokeObjectURL(url);
}

function escaparCsv(valor) {
  if (valor === undefined || valor === null) return "";
  const texto = String(valor);
  if (/[",\n]/.test(texto)) return `"${texto.replace(/"/g, '""')}"`;
  return texto;
}

function escapar(valor) {
  if (valor === undefined || valor === null) return "";
  return String(valor).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
