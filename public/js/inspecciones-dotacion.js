// inspecciones-dotacion.js — Solicitud de dotación de UN plantel dentro de un plan.
// Cabecera editable (copia de GESCOLAR), rubros por bloque con cantidad manual o «NO»,
// guardado, y descarga del Excel en el formato «SOLICITUD DE DOTACIÓN».

const usuario = renderShell("inspecciones-planes", "Solicitud de dotación");
const ID = Number(new URLSearchParams(window.location.search).get("id"));
let S = null;
let SUCIO = false;

const CAMPOS = [
  ["institucion", "Nombre del plantel", "ancho"], ["estado", "Estado"], ["municipio", "Municipio"], ["parroquia", "Parroquia"],
  ["direccion", "Dirección", "ancho"], ["matricula", "Matrícula"], ["aulas", "N° de aulas"], ["director", "Director"], ["telefono", "Teléfono"],
];

if (usuario) {
  if (!ID) error("Falta indicar la solicitud.");
  else cargar();
}

function error(mensaje) {
  document.getElementById("contenido").innerHTML = `<div class="panel"><div class="vacio"><strong>No se pudo abrir la solicitud</strong>${escapar(mensaje)}<br><br>
    <a class="btn btn-fantasma btn-sm" href="${usuario && usuario.rol === "insp_ingeniero" ? "/inspecciones/mis-planillas.html" : "/inspecciones/planes.html"}">← Volver</a></div></div>`;
}

async function cargar() {
  document.getElementById("contenido").innerHTML = `<div class="panel"><div class="cargando">Cargando solicitud…</div></div>`;
  try { S = await RAC.get(`/api/inspecciones/dotacion/${ID}`); } catch (err) { error(err.message); return; }
  dibujar();
}

function dibujar() {
  const d = S.dotacion;
  const ed = S.puede_editar;
  const dis = ed ? "" : "disabled";
  const volver = usuario.rol === "insp_ingeniero" ? "/inspecciones/mis-planillas.html" : `/inspecciones/dotaciones.html?plan=${Number(S.plan.id)}`;
  document.getElementById("contenido").innerHTML = `
    <section class="planteles-hero"><div class="planteles-hero-copy">
      <span class="planteles-eyebrow">SOLICITUD DE DOTACIÓN · ${escapar(S.plan.nombre)}</span>
      <h1>${escapar(d.datos.institucion || d.codigo_dea)}</h1>
      <p>Código DEA ${escapar(d.codigo_dea)}${ed ? "" : " · solo lectura"}${S.plan.estado === "CERRADO" ? " · plan cerrado" : ""}</p>
    </div></section>
    <div class="panel" style="margin-bottom:16px;">
      <div style="padding:14px 20px; display:flex; gap:10px; flex-wrap:wrap;">
        <a class="btn btn-fantasma btn-sm" href="${volver}">← Volver</a>
        <button type="button" class="btn btn-primario btn-sm" id="btnExcel">Descargar Excel</button>
      </div>
      <div class="dt-cab">
        ${CAMPOS.map(([k, t, a]) => `<label class="${a || ""}">${t}<input type="text" data-dato="${k}" value="${escapar(d.datos[k] || "")}" ${dis}></label>`).join("")}
        <label>Fecha<input type="date" id="fecha" value="${escapar(d.fecha || "")}" ${dis}></label>
      </div>
    </div>
    ${S.bloques.map((b, bi) => `<div class="panel" style="margin-bottom:16px;"><div class="dt-bloque">${escapar(b.titulo)}</div>
      <div class="tabla-responsive"><table class="dt-tabla"><thead><tr><th>Descripción</th><th>Unidad</th><th class="dt-num">Cantidad</th><th>No</th></tr></thead><tbody>
      ${b.rubros.map((r, ri) => `<tr><td>${escapar(r.nombre)}${r.retirado ? ` <span class="dt-retirado">(retirado del catálogo)</span>` : ""}</td><td>${escapar(r.unidad)}</td>
        <td><input type="text" inputmode="decimal" data-b="${bi}" data-r="${ri}" value="${r.es_no || r.cantidad === null ? "" : escapar(String(r.cantidad).replace(".", ","))}" ${r.es_no ? "disabled" : dis}></td>
        <td><input type="checkbox" data-no-b="${bi}" data-no-r="${ri}" ${r.es_no ? "checked" : ""} ${dis} title="Marcar como NO (no se entrega)"></td></tr>`).join("")}
      </tbody></table></div></div>`).join("")}
    <div class="panel" style="margin-bottom:16px;"><div class="dt-cab"><label class="ancho">Observaciones<textarea id="obs" rows="3" ${dis}>${escapar(d.observaciones)}</textarea></label></div></div>
    <div class="dt-barra"><span id="estadoGuardado" style="color:var(--muted); font-size:.82rem;">${ed ? "Sin cambios por guardar." : "Solo lectura."}</span>
      ${ed ? `<button type="button" class="btn btn-primario" id="btnGuardar">Guardar</button>` : ""}</div>`;

  document.getElementById("btnExcel").addEventListener("click", descargarExcel);
  if (!ed) return;
  const marcar = () => { SUCIO = true; document.getElementById("estadoGuardado").textContent = "Hay cambios sin guardar."; };
  document.querySelectorAll("[data-dato], #fecha, #obs").forEach((el) => el.addEventListener("input", marcar));
  document.querySelectorAll("input[data-b]").forEach((el) => el.addEventListener("input", () => { S.bloques[+el.dataset.b].rubros[+el.dataset.r].cantidad = el.value.trim() === "" ? null : el.value.trim(); marcar(); }));
  document.querySelectorAll("input[data-no-b]").forEach((el) => el.addEventListener("change", () => {
    const r = S.bloques[+el.dataset.noB].rubros[+el.dataset.noR];
    r.es_no = el.checked;
    const caja = document.querySelector(`input[data-b="${el.dataset.noB}"][data-r="${el.dataset.noR}"]`);
    caja.disabled = el.checked;
    if (el.checked) { caja.value = ""; r.cantidad = null; }
    marcar();
  }));
  document.getElementById("btnGuardar").addEventListener("click", guardar);
  window.addEventListener("beforeunload", (e) => { if (SUCIO) { e.preventDefault(); e.returnValue = ""; } });
}

async function guardar() {
  const boton = document.getElementById("btnGuardar");
  const datos = {};
  document.querySelectorAll("[data-dato]").forEach((el) => { datos[el.dataset.dato] = el.value; });
  const items = [];
  S.bloques.forEach((b) => b.rubros.forEach((r) => {
    if (r.es_no) items.push({ rubro_id: r.rubro_id, es_no: true });
    else if (r.cantidad !== null && String(r.cantidad).trim() !== "") items.push({ rubro_id: r.rubro_id, cantidad: String(r.cantidad) });
  }));
  boton.disabled = true;
  try {
    await RAC.put(`/api/inspecciones/dotacion/${ID}`, { fecha: document.getElementById("fecha").value || null, datos, observaciones: document.getElementById("obs").value, items });
    SUCIO = false;
    document.getElementById("estadoGuardado").textContent = "Guardado.";
    mostrarToast("Solicitud guardada.");
  } catch (err) { mostrarToast(err.message, true); }
  finally { boton.disabled = false; }
}

async function descargarExcel(e) {
  const boton = e.currentTarget;
  const original = boton.textContent;
  if (SUCIO && !window.confirm("Hay cambios sin guardar; el Excel no los incluirá. ¿Descargar de todos modos?")) return;
  boton.disabled = true; boton.textContent = "Generando Excel…";
  try {
    const resp = await fetch(`/api/inspecciones/dotacion/${ID}.xlsx`, { headers: { Authorization: "Bearer " + RAC.getToken() } });
    if (resp.status === 401) { RAC.cerrarSesion(); return; }
    if (!resp.ok) { let m = `Error ${resp.status}`; try { m = (await resp.json()).error || m; } catch (_) { /* sin cuerpo */ } throw new Error(m); }
    const blob = await resp.blob();
    const m = /filename="([^"]+)"/.exec(resp.headers.get("Content-Disposition") || "");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = m ? m[1] : "DOTACION.xlsx";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  } catch (err) { mostrarToast(err.message, true); }
  finally { boton.disabled = false; boton.textContent = original; }
}

function escapar(valor) {
  if (valor === undefined || valor === null) return "";
  return String(valor).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
