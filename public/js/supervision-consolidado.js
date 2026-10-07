// supervision-consolidado.js — vista combinada equivalente a la hoja
// CONSOLIDADO del Excel original: un plantel por fila con su director,
// supervisores asignados y última matrícula. Incluye botón para exportar
// a CSV (se genera en el navegador, no depende de ninguna librería externa).
//
// Teléfono (pantallas de hasta 700 px): en vez de una tabla de 14 columnas que
// obliga a deslizar de lado, cada plantel se muestra como una tarjeta. En
// pantallas grandes se sigue viendo la tabla de siempre. El CSV exporta lo
// mismo en ambos casos.

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

// Estilos de las tarjetas (solo se usan en pantallas pequeñas).
(function () {
  if (document.getElementById("estiloConsolidado")) return;
  const st = document.createElement("style");
  st.id = "estiloConsolidado";
  st.textContent = ".cons-tarjetas{display:grid;gap:10px;}"
    + ".cons-tarjeta{border:1px solid #dfe7f0;border-radius:10px;padding:12px;background:#fff;min-width:0;}"
    + ".cons-tarjeta-cab{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:4px;}"
    + ".cons-tarjeta-cab strong{overflow-wrap:anywhere;font-size:.9rem;}"
    + ".cons-tarjeta-cab .cod{flex:0 0 auto;font-size:.7rem;}"
    + ".cons-tarjeta-sub{font-size:.75rem;color:#718096;margin-bottom:10px;overflow-wrap:anywhere;}"
    + ".cons-dato{margin-bottom:8px;min-width:0;}"
    + ".cons-dato small,.cons-nums small{display:block;font-size:.66rem;text-transform:uppercase;letter-spacing:.05em;color:#718096;margin-bottom:1px;}"
    + ".cons-dato span{font-size:.84rem;overflow-wrap:anywhere;}"
    + ".cons-mat{margin-top:10px;padding-top:10px;border-top:1px solid #edf1f5;}"
    + ".cons-nums{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;text-align:center;margin-top:6px;}";
  document.head.appendChild(st);
})();

const usuario = renderShell("supervision-consolidado", "Supervisión · Consolidado");
let filas = [];

// ¿Pantalla pequeña? Se redibuja si cambia (por ejemplo al girar el teléfono).
const consultaMovil = window.matchMedia ? window.matchMedia("(max-width:700px)") : null;
const esMovil = () => !!(consultaMovil && consultaMovil.matches);
if (consultaMovil) {
  const alCambiar = () => { if (filas.length) dibujarPantalla(); };
  if (consultaMovil.addEventListener) consultaMovil.addEventListener("change", alCambiar);
  else if (consultaMovil.addListener) consultaMovil.addListener(alCambiar);
}

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

function valor(fila, clave) {
  const v = fila[clave];
  return v === undefined || v === null || v === "" ? "—" : v;
}

function dato(titulo, texto) {
  return `<div class="cons-dato"><small>${escapar(titulo)}</small><span>${escapar(texto)}</span></div>`;
}

function htmlTabla() {
  return `
    <div class="tabla-responsive">
      <table>
        <thead><tr>${COLUMNAS.map((c) => `<th>${escapar(c.titulo)}</th>`).join("")}</tr></thead>
        <tbody>${filas.map((fila) => `
          <tr>${COLUMNAS.map((c) => `<td>${escapar(fila[c.clave] ?? "—")}</td>`).join("")}</tr>`).join("")}
        </tbody>
      </table>
    </div>`;
}

function htmlTarjetas() {
  return `
    <div class="cons-tarjetas">
      ${filas.map((f) => `
        <div class="cons-tarjeta">
          <div class="cons-tarjeta-cab">
            <strong>${escapar(valor(f, "eponimo_actual"))}</strong>
            <span class="cod">${escapar(valor(f, "codigo_plantel"))}</span>
          </div>
          <div class="cons-tarjeta-sub">${escapar(valor(f, "denominacion"))} · ${escapar(valor(f, "dependencia"))} · ${escapar(valor(f, "turno"))}</div>
          ${dato("Comuna", valor(f, "nombre_comuna"))}
          ${dato("Director", valor(f, "director_nombre"))}
          ${dato("Cédula director", valor(f, "director_cedula"))}
          ${dato("Supervisor(es) municipal(es)", valor(f, "supervisores_municipales"))}
          ${dato("Supervisor(es) circuital(es)", valor(f, "supervisores_circuitales"))}
          <div class="cons-mat">
            ${dato("Período matrícula", valor(f, "matricula_periodo"))}
            <div class="cons-nums">
              <div><small>Hembras</small>${escapar(valor(f, "matricula_hembras"))}</div>
              <div><small>Varones</small>${escapar(valor(f, "matricula_varones"))}</div>
              <div><small>Total</small><strong>${escapar(valor(f, "matricula_total"))}</strong></div>
            </div>
          </div>
        </div>`).join("")}
    </div>`;
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
      ${filas.length
        ? (esMovil() ? htmlTarjetas() : htmlTabla())
        : `<div class="vacio"><strong>Sin datos todavía</strong>Carga planteles, directores y supervisores para ver el consolidado.</div>`}
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
