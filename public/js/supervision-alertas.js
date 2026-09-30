// supervision-alertas.js — alertas propias del módulo de Supervisión.
// Se calculan en vivo en el backend (GET /api/supervision/alertas): cuando se
// corrige el dato, la alerta desaparece sola. Son distintas de las alertas del
// RAC (/alertas.html). Cada alerta es un bloque desplegable con su tabla de
// casos y un botón para descargarla en CSV. Aparte, un botón verifica las
// cédulas contra la nómina del Ministerio (consulta más pesada, solo a pedido).
const BASE = "/api/supervision";

const usuario = renderShell("supervision-alertas", "Supervisión · Alertas");

const SEVERIDADES = {
  alta: { etiqueta: "Alta", color: "#c53030" },
  media: { etiqueta: "Media", color: "#b7791f" },
  baja: { etiqueta: "Baja", color: "#2b6cb0" },
  info: { etiqueta: "Informativa", color: "#718096" },
};

let ALERTAS = [];
let LIMITE = 300;
let GENERADO = "";
let FILTRO = "todas";
let ALERTA_NOMINA = null;

if (usuario) cargarPantalla();

async function cargarPantalla() {
  const contenido = document.getElementById("contenido");
  contenido.innerHTML = `<div class="cargando">Calculando alertas de Supervisión…</div>`;
  try {
    const datos = await RAC.get(`${BASE}/alertas`);
    ALERTAS = datos.alertas || [];
    LIMITE = datos.limite || 300;
    GENERADO = datos.generado_en || "";
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
        <h1>Alertas</h1>
        <p>Datos pendientes o por revisar en Supervisión${GENERADO ? ` · calculado ${escapar(formatoHora(GENERADO))}` : ""}</p>
      </div>
    </section>

    <div id="al-tarjetas" style="display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:16px; margin-bottom:16px;"></div>

    <div class="panel" style="padding:16px; margin-bottom:16px; display:flex; flex-wrap:wrap; gap:8px; align-items:center;">
      <span style="font-size:.85rem; color:var(--muted); margin-right:4px;">Mostrar:</span>
      <span id="al-filtros" style="display:flex; flex-wrap:wrap; gap:8px;"></span>
      <button type="button" class="btn btn-fantasma btn-sm" id="al-recargar" style="margin-left:auto;">Actualizar</button>
    </div>

    <div id="al-lista"></div>

    <div class="panel" style="padding:18px; margin-top:16px;">
      <div style="display:flex; flex-wrap:wrap; gap:12px; align-items:center; justify-content:space-between;">
        <div>
          <strong>Verificar cédulas contra la nómina del Ministerio</strong>
          <div style="font-size:.85rem; color:var(--muted); margin-top:2px;">Busca supervisores y directores cuya cédula no aparece en la nómina. Tarda unos segundos.</div>
        </div>
        <button type="button" class="btn btn-sm" id="al-nomina">Verificar ahora</button>
      </div>
      <div id="al-nomina-resultado" style="margin-top:12px;"></div>
    </div>
  `;

  document.getElementById("al-recargar").addEventListener("click", cargarPantalla);
  document.getElementById("al-filtros").addEventListener("click", (e) => {
    const b = e.target.closest("[data-filtro]");
    if (!b) return;
    FILTRO = b.dataset.filtro;
    pintarFiltros();
    pintarLista();
  });
  document.getElementById("al-lista").addEventListener("click", (e) => {
    const b = e.target.closest("[data-csv]");
    if (!b) return;
    e.preventDefault();
    const alerta = ALERTAS.find((a) => a.clave === b.dataset.csv);
    if (alerta) descargarCsv(alerta);
  });
  document.getElementById("al-nomina").addEventListener("click", verificarNomina);
  document.getElementById("al-nomina-resultado").addEventListener("click", (e) => {
    const b = e.target.closest("[data-csv]");
    if (b && ALERTA_NOMINA) descargarCsv(ALERTA_NOMINA);
  });

  pintarTarjetas();
  pintarFiltros();
  pintarLista();
}

function pintarTarjetas() {
  const conProblemas = ALERTAS.filter((a) => a.total > 0);
  const porSev = (sev) => conProblemas.filter((a) => a.severidad === sev).length;
  const tarjeta = (titulo, valor, nota, color) => `
    <div class="panel" style="padding:16px;">
      <div style="font-size:.76rem; text-transform:uppercase; color:#718096; margin-bottom:6px;">${escapar(titulo)}</div>
      <div style="font-family:'Space Grotesk',sans-serif; font-size:1.9rem; font-weight:700; color:${color};">${valor}</div>
      <div style="font-size:.8rem; color:var(--muted);">${escapar(nota)}</div>
    </div>`;
  document.getElementById("al-tarjetas").innerHTML =
    tarjeta("Alta", porSev("alta"), "alertas por atender", SEVERIDADES.alta.color) +
    tarjeta("Media", porSev("media"), "alertas por revisar", SEVERIDADES.media.color) +
    tarjeta("Baja", porSev("baja"), "detalles menores", SEVERIDADES.baja.color) +
    tarjeta("Informativas", porSev("info"), "avisos de carga pendiente", SEVERIDADES.info.color);
}

function pintarFiltros() {
  const opciones = [["todas", "Todas"], ["alta", "Alta"], ["media", "Media"], ["baja", "Baja"], ["info", "Informativas"], ["con", "Solo con casos"]];
  document.getElementById("al-filtros").innerHTML = opciones.map(([clave, texto]) => `
    <button type="button" class="btn btn-sm ${FILTRO === clave ? "" : "btn-fantasma"}" data-filtro="${clave}">${texto}</button>`).join("");
}

function pintarLista() {
  const visibles = ALERTAS.filter((a) => {
    if (FILTRO === "todas") return true;
    if (FILTRO === "con") return a.total > 0;
    return a.severidad === FILTRO;
  });
  const cont = document.getElementById("al-lista");
  if (!visibles.length) {
    cont.innerHTML = `<div class="panel" style="padding:20px;"><div class="vacio"><strong>Sin alertas en este filtro</strong>Prueba con otro.</div></div>`;
    return;
  }
  cont.innerHTML = visibles.map(bloqueAlerta).join("");
}

function insignia(severidad) {
  const s = SEVERIDADES[severidad] || SEVERIDADES.info;
  return `<span style="display:inline-block; padding:2px 8px; border-radius:999px; font-size:.72rem; font-weight:600; color:#fff; background:${s.color};">${s.etiqueta}</span>`;
}

function tablaCasos(alerta) {
  const th = "text-align:left; padding:6px 8px; font-size:.74rem; text-transform:uppercase; color:#718096; border-bottom:1px solid rgba(0,0,0,.12);";
  const td = "padding:7px 8px; border-bottom:1px solid rgba(0,0,0,.06); vertical-align:top;";
  return `
    <div style="overflow-x:auto;">
      <table style="width:100%; border-collapse:collapse; font-size:.88rem;">
        <thead><tr><th style="${th}">Código / Tipo</th><th style="${th}">Nombre</th><th style="${th}">Detalle</th></tr></thead>
        <tbody>${alerta.items.map((i) => `
          <tr>
            <td style="${td} font-family:monospace; white-space:nowrap;">${escapar(i.codigo || "—")}</td>
            <td style="${td}">${escapar(i.nombre || "—")}</td>
            <td style="${td}">${escapar(i.detalle || "—")}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>
    ${alerta.total > alerta.items.length ? `<div style="font-size:.82rem; color:var(--muted); margin-top:8px;">Mostrando ${alerta.items.length} de ${alerta.total} casos.</div>` : ""}`;
}

function bloqueAlerta(a) {
  const s = SEVERIDADES[a.severidad] || SEVERIDADES.info;
  if (a.total === 0) {
    return `
      <div class="panel" style="padding:14px 18px; margin-bottom:10px; display:flex; align-items:center; gap:10px; border-left:4px solid #2f855a;">
        <span style="color:#2f855a; font-weight:700;">✓</span>
        <span style="flex:1;">${escapar(a.titulo)}</span>
        <span style="color:#2f855a; font-size:.85rem; font-weight:600;">Sin casos</span>
      </div>`;
  }
  return `
    <details class="panel" style="padding:0; margin-bottom:10px; border-left:4px solid ${s.color};">
      <summary style="cursor:pointer; padding:14px 18px; display:flex; align-items:center; gap:10px; list-style:none;">
        ${insignia(a.severidad)}
        <strong style="flex:1;">${escapar(a.titulo)}</strong>
        <span style="font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:1.1rem;">${a.total}</span>
      </summary>
      <div style="padding:0 18px 16px;">
        <p style="margin:0 0 10px; font-size:.88rem; color:var(--muted);">${escapar(a.descripcion)}</p>
        <div style="margin-bottom:10px;"><button type="button" class="btn btn-fantasma btn-sm" data-csv="${escapar(a.clave)}">Descargar CSV</button></div>
        ${tablaCasos(a)}
      </div>
    </details>`;
}

async function verificarNomina() {
  const boton = document.getElementById("al-nomina");
  const cont = document.getElementById("al-nomina-resultado");
  boton.disabled = true;
  cont.innerHTML = `<div class="cargando">Cruzando cédulas con la nómina…</div>`;
  try {
    const datos = await RAC.get(`${BASE}/alertas/cedulas-nomina`);
    ALERTA_NOMINA = datos.alerta;
    if (!ALERTA_NOMINA.total) {
      cont.innerHTML = `<div style="color:#2f855a; font-weight:600;">✓ Todas las cédulas de supervisores y directores están en la nómina.</div>`;
    } else {
      cont.innerHTML = `
        <div style="margin-bottom:8px;"><strong>${ALERTA_NOMINA.total}</strong> cédulas no aparecen en la nómina.
          <button type="button" class="btn btn-fantasma btn-sm" data-csv="nomina" style="margin-left:8px;">Descargar CSV</button></div>
        <p style="margin:0 0 10px; font-size:.85rem; color:var(--muted);">${escapar(ALERTA_NOMINA.descripcion)}</p>
        ${tablaCasos(ALERTA_NOMINA)}`;
    }
  } catch (err) {
    cont.innerHTML = `<div style="color:#c53030;">${escapar(err.message)}</div>`;
  } finally {
    boton.disabled = false;
  }
}

// ---------- utilidades ----------

function descargarCsv(alerta) {
  const celda = (v) => `"${String(v === undefined || v === null ? "" : v).replace(/"/g, '""')}"`;
  const filas = [["Código / Tipo", "Nombre", "Detalle"].map(celda).join(",")]
    .concat(alerta.items.map((i) => [i.codigo, i.nombre, i.detalle].map(celda).join(",")));
  const blob = new Blob(["\ufeff" + filas.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `alerta-supervision-${alerta.clave}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function formatoHora(iso) {
  try {
    return new Date(iso).toLocaleString("es-VE", { dateStyle: "short", timeStyle: "short" });
  } catch (e) {
    return "";
  }
}

function escapar(valor) {
  if (valor === undefined || valor === null) return "";
  return String(valor)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
