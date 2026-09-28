// supervision-alertas.js — alertas de calidad de datos del módulo Supervisión.
// Nacen de la importación del Excel (datos que no cuadran). El equipo las
// revisa, las exporta a CSV para corregir en campo, las marca como resueltas
// o descartadas, y al final "limpia" las ya atendidas para que no vuelvan a salir.

const usuario = renderShell("supervision-alertas", "Alertas de Supervisión");

const ETIQUETAS_TIPO = {
  plantel_sin_codigo: "Plantel sin código",
  codigo_con_nota: "Código con nota",
  plantel_sin_director: "Plantel sin director",
  director_sin_cedula: "Director sin cédula",
  cedula_formato_dudoso: "Cédula dudosa",
  municipio_sin_supervisor: "Municipio sin supervisor",
  circuito_sin_supervisor: "Circuito sin supervisor",
  cedula_repetida_distinta_persona: "Cédula repetida",
  circuito_inconsistente: "Circuito inconsistente",
  conflicto_datos_persona: "Datos contradictorios",
  telefono_multiple: "Teléfono múltiple",
  correo_multiple: "Correo múltiple",
  correo_invalido: "Correo inválido",
};

let filtroEstado = "pendiente";
let filtroTipo = "";
let filtroTexto = "";
let temporizador = null;
let porEstado = { pendiente: 0, resuelta: 0, descartada: 0 };

if (usuario) dibujarPanel();

function etiquetaTipo(tipo) {
  return ETIQUETAS_TIPO[tipo] || tipo;
}

function dibujarPanel() {
  document.getElementById("contenido").innerHTML = `
    <section class="planteles-hero">
      <div class="planteles-hero-copy">
        <span class="planteles-eyebrow">CALIDAD DE DATOS</span>
        <h1>Alertas de Supervisión</h1>
        <p>Datos del Excel que no cuadran y hay que corregir. Exporta el listado, corrige en campo y marca cada alerta.</p>
      </div>
      <div style="position:relative; z-index:1; display:flex; gap:10px; flex-wrap:wrap;">
        <button class="btn planteles-nuevo-btn" id="btnExportar">Exportar a CSV</button>
        <button class="btn planteles-hero-btn-secundario" id="btnLimpiar">Limpiar resueltas</button>
      </div>
    </section>

    <div class="panel">
      <div style="padding:16px 20px 0;">
        <div class="filtros" style="display:flex; gap:10px; flex-wrap:wrap;">
          <select id="selEstado">
            <option value="pendiente">Pendientes</option>
            <option value="resuelta">Resueltas</option>
            <option value="descartada">Descartadas</option>
            <option value="">Todas</option>
          </select>
          <select id="selTipo"><option value="">Todos los tipos</option></select>
          <input type="text" id="qTexto" placeholder="Buscar por plantel, código, cédula o texto…" style="flex:1; min-width:240px;">
        </div>
      </div>
      <div id="resumenAlertas" style="padding:10px 20px 0; color:var(--muted); font-size:.8rem;"></div>
      <div id="tablaAlertas" style="margin-top:12px;"></div>
    </div>
  `;

  document.getElementById("selEstado").addEventListener("change", (e) => { filtroEstado = e.target.value; cargar(); });
  document.getElementById("selTipo").addEventListener("change", (e) => { filtroTipo = e.target.value; cargar(); });
  document.getElementById("qTexto").addEventListener("input", (e) => {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => { filtroTexto = e.target.value.trim(); cargar(); }, 350);
  });
  document.getElementById("btnExportar").addEventListener("click", exportarCsv);
  document.getElementById("btnLimpiar").addEventListener("click", limpiarResueltas);

  cargar();
}

function parametros() {
  const p = new URLSearchParams();
  if (filtroEstado) p.set("estado", filtroEstado);
  if (filtroTipo) p.set("tipo", filtroTipo);
  if (filtroTexto.length >= 2) p.set("q", filtroTexto);
  return p.toString();
}

async function cargar() {
  const tabla = document.getElementById("tablaAlertas");
  tabla.innerHTML = `<div class="cargando">Cargando alertas…</div>`;
  try {
    const resp = await RAC.get(`/api/supervision/alertas?${parametros()}`);
    porEstado = resp.por_estado || porEstado;
    actualizarTipos(resp.tipos || []);
    document.getElementById("resumenAlertas").textContent =
      `${resp.alertas.length} mostradas · ${porEstado.pendiente} pendientes · ${porEstado.resuelta} resueltas · ${porEstado.descartada} descartadas`;
    dibujarTabla(resp.alertas);
  } catch (err) {
    tabla.innerHTML = `<div class="vacio"><strong>No se pudo cargar</strong>${escapar(err.message)}</div>`;
  }
}

// Rellena el desplegable de tipos con los que existan, conservando la selección.
function actualizarTipos(tipos) {
  const sel = document.getElementById("selTipo");
  const actual = filtroTipo;
  sel.innerHTML = `<option value="">Todos los tipos</option>` +
    tipos.map((t) => `<option value="${escapar(t)}">${escapar(etiquetaTipo(t))}</option>`).join("");
  sel.value = tipos.includes(actual) ? actual : "";
  if (sel.value !== actual) filtroTipo = "";
}

function dibujarTabla(alertas) {
  const cont = document.getElementById("tablaAlertas");
  if (!alertas.length) {
    cont.innerHTML = `<div class="vacio"><strong>Sin alertas</strong>No hay alertas con estos filtros.</div>`;
    return;
  }

  const filas = alertas.map((a) => {
    const ids = [a.codigo_plantel, a.cedula ? `C.I. ${a.cedula}` : null].filter(Boolean).map(escapar).join(" · ");
    const badgeEstado = a.estado === "resuelta" ? "badge-resuelto" : a.estado === "descartada" ? "badge-descartado" : "badge-pendiente";
    const acciones = a.estado === "pendiente"
      ? `<button class="btn btn-fantasma btn-sm" data-estado="resuelta" data-id="${a.id}">Resuelta</button>
         <button class="btn btn-fantasma btn-sm" data-estado="descartada" data-id="${a.id}">Descartar</button>`
      : `<button class="btn btn-fantasma btn-sm" data-estado="pendiente" data-id="${a.id}">Reabrir</button>`;
    return `
      <tr>
        <td style="white-space:nowrap;"><span class="badge badge-pendiente" style="background:#eef2f8; color:#1a2b4c;">${escapar(etiquetaTipo(a.tipo))}</span></td>
        <td style="min-width:200px;"><strong>${escapar(a.referencia || "—")}</strong>${ids ? `<div style="font-size:.72rem; color:var(--muted);">${ids}</div>` : ""}</td>
        <td style="min-width:320px; font-size:.84rem;">${escapar(a.detalle)}</td>
        <td style="text-align:center;">${a.fila_excel ?? "—"}</td>
        <td style="white-space:nowrap;"><span class="badge ${badgeEstado}">${escapar(a.estado)}</span></td>
        <td style="white-space:nowrap;">${acciones}</td>
      </tr>`;
  }).join("");

  cont.innerHTML = `
    <div class="tabla-responsive">
      <table>
        <thead><tr><th>Tipo</th><th>Referencia</th><th>Detalle</th><th>Fila Excel</th><th>Estado</th><th></th></tr></thead>
        <tbody>${filas}</tbody>
      </table>
    </div>`;

  cont.querySelectorAll("[data-estado]").forEach((btn) => {
    btn.addEventListener("click", () => cambiarEstado(btn.dataset.id, btn.dataset.estado, btn));
  });
}

async function cambiarEstado(id, estado, boton) {
  boton.disabled = true;
  try {
    await RAC.patch(`/api/supervision/alertas/${encodeURIComponent(id)}`, { estado });
    cargar();
  } catch (err) {
    boton.disabled = false;
    mostrarToast(err.message, true);
  }
}

// Descarga el CSV con los mismos filtros que se están viendo. La sesión va por
// header Authorization (no por cookie), así que no sirve un <a href> simple:
// se trae como blob y se fuerza la descarga (mismo patrón que credenciales.js).
async function exportarCsv() {
  const boton = document.getElementById("btnExportar");
  const textoOriginal = boton.textContent;
  boton.disabled = true;
  boton.textContent = "Exportando…";
  try {
    const resp = await fetch(`/api/supervision/alertas/exportar?${parametros()}`, {
      headers: { Authorization: "Bearer " + RAC.getToken() },
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => null);
      throw new Error((data && data.error) || `Error ${resp.status}`);
    }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `alertas_supervision_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    mostrarToast(err.message, true);
  } finally {
    boton.disabled = false;
    boton.textContent = textoOriginal;
  }
}

// Borra de verdad las alertas ya atendidas (resueltas y descartadas). Las
// pendientes nunca se tocan.
async function limpiarResueltas() {
  const total = (porEstado.resuelta || 0) + (porEstado.descartada || 0);
  if (!total) {
    mostrarToast("No hay alertas resueltas ni descartadas para limpiar.");
    return;
  }
  if (!confirm(`Se borrarán ${total} alertas (resueltas y descartadas). Las pendientes no se tocan. ¿Continuar?`)) return;
  try {
    const resp = await RAC.del("/api/supervision/alertas/limpiar");
    mostrarToast(`Se limpiaron ${resp.borradas} alertas.`);
    cargar();
  } catch (err) {
    mostrarToast(err.message, true);
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
