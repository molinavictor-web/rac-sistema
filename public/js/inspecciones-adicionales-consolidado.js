// inspecciones-adicionales-consolidado.js — Inspecciones: consolidado de
// MATERIALES ADICIONALES de un plan (el que se presenta a las autoridades).
// Se calcula al momento con las planillas de los planteles enlazados.
// Solo suman cantidades mayores que cero; los materiales unificados se suman juntos.

const usuario = renderShell("inspecciones-planes", "Consolidado de adicionales");
const PLAN_ID = Number(new URLSearchParams(window.location.search).get("plan"));
let CONS = null;

if (usuario) {
  if (!PLAN_ID) error("Falta indicar el plan. Entra desde un plan de atención.");
  else cargar();
}

function error(mensaje) {
  document.getElementById("contenido").innerHTML = `
    <div class="panel"><div class="vacio"><strong>No se pudo abrir el consolidado</strong>${escapar(mensaje)}<br><br>
    <a class="btn btn-fantasma btn-sm" href="/inspecciones/planes.html">← Volver a los planes</a></div></div>`;
}

async function cargar() {
  document.getElementById("contenido").innerHTML = `<div class="panel"><div class="cargando">Calculando consolidado…</div></div>`;
  try {
    CONS = await RAC.get(`/api/inspecciones/planes/${PLAN_ID}/consolidado-adicionales`);
  } catch (err) {
    error(err.message);
    return;
  }
  dibujar();
}

function formato(n) {
  return Number(n).toLocaleString("es-VE", { maximumFractionDigits: 3 });
}

function dibujar() {
  const { plan, planteles, materiales, pendientes } = CONS;
  document.getElementById("contenido").innerHTML = `
    <section class="planteles-hero">
      <div class="planteles-hero-copy">
        <span class="planteles-eyebrow">MATERIALES ADICIONALES</span>
        <h1>${escapar(plan.nombre)}</h1>
        <p>${planteles.length} plantel${planteles.length === 1 ? "" : "es"} en el plan · ${materiales.length} material${materiales.length === 1 ? "" : "es"} adicional${materiales.length === 1 ? "" : "es"} con cantidad.</p>
      </div>
    </section>
    <div class="panel">
      <div class="no-imprimir" style="padding:14px 20px; display:flex; gap:10px; flex-wrap:wrap; align-items:center; justify-content:space-between;">
        <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
          <a class="btn btn-fantasma btn-sm" href="/inspecciones/planes.html#plan-${Number(plan.id)}">← Volver al plan</a>
          <a class="btn btn-fantasma btn-sm" href="/inspecciones/consolidado.html?plan=${Number(plan.id)}">Ver consolidado oficial</a>
          <input type="search" id="buscar" placeholder="Buscar un material…" style="padding:7px 10px; border:1px solid var(--borde); border-radius:8px; min-width:200px;">
        </div>
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <button type="button" class="btn btn-primario btn-sm" id="btnExcel">Descargar Excel</button>
          <button type="button" class="btn btn-fantasma btn-sm" id="btnImprimir">Imprimir / guardar PDF</button>
        </div>
      </div>
      ${pendientes ? `<div class="co-aviso no-imprimir"><strong>${pendientes}</strong> material${pendientes === 1 ? "" : "es"} de esta lista ${pendientes === 1 ? "está" : "están"} pendiente${pendientes === 1 ? "" : "s"} de aprobación (marcado${pendientes === 1 ? "" : "s"} en amarillo). Se suman igual; apruébalos o únelos con otro en el catálogo de adicionales para dejar la lista limpia antes de presentarla.</div>` : ""}
      <div id="zonaTabla"></div>
    </div>`;
  document.getElementById("buscar").addEventListener("input", pintarTabla);
  document.getElementById("btnImprimir").addEventListener("click", () => window.print());
  document.getElementById("btnExcel").addEventListener("click", (e) =>
    descargarExcel(`/api/inspecciones/planes/${PLAN_ID}/consolidado-adicionales.xlsx`, "ADICIONALES.xlsx", e.currentTarget));
  pintarTabla();
}

function pintarTabla() {
  const { planteles, materiales } = CONS;
  const q = document.getElementById("buscar").value.trim().toLowerCase();
  const zona = document.getElementById("zonaTabla");
  if (!planteles.length) {
    zona.innerHTML = `<div class="vacio"><strong>Este plan todavía no tiene planteles</strong>Agrégalos desde el plan y carga sus planillas.</div>`;
    return;
  }
  const visibles = materiales.filter((m) => !q || m.nombre.toLowerCase().includes(q));
  if (!visibles.length) {
    zona.innerHTML = `<div class="vacio"><strong>${q ? "Sin resultados" : "Aún no hay adicionales con cantidad"}</strong>${q ? "Prueba con otro texto." : "Agrega materiales adicionales en las planillas y vuelve aquí."}</div>`;
    return;
  }
  const cabeceras = planteles.map((p) =>
    `<th class="plantel num"><a href="/inspecciones/planilla.html?id=${Number(p.inspeccion_id)}&plan=${Number(CONS.plan.id)}" title="Abrir la planilla">${escapar(p.nombre_plantel)}</a></th>`).join("");
  const filas = visibles.map((m, n) => {
    const celdas = planteles.map((p) => {
      const v = m.cantidades[p.inspeccion_id];
      return v > 0 ? `<td class="num">${formato(v)}</td>` : `<td class="num cero">·</td>`;
    }).join("");
    return `<tr>
      <td class="rubro"><span style="color:var(--rac-muted,#718198); font-size:.72rem;">${n + 1}.</span> ${escapar(m.nombre)}${m.estado === "PENDIENTE" ? `<span class="co-pend">pendiente</span>` : ""}</td>
      <td class="uni">${escapar(m.unidad)}</td>
      ${celdas}
      <td class="num">${m.planteles_con_cantidad}</td>
      <td class="num total">${formato(m.total)}</td>
    </tr>`;
  });
  zona.innerHTML = `<div class="co-scroll"><table class="co-tabla">
    <thead><tr><th class="rubro">Material</th><th>Unidad</th>${cabeceras}<th class="num">N.º planteles</th><th class="num total">TOTAL</th></tr></thead>
    <tbody>${filas.join("")}</tbody></table></div>`;
}

// Descarga un Excel generado por el servidor (hace falta enviar el token, por eso no es un simple enlace).
async function descargarExcel(ruta, nombreRespaldo, boton) {
  const textoOriginal = boton.textContent;
  boton.disabled = true;
  boton.textContent = "Generando Excel…";
  try {
    const resp = await fetch(ruta, { headers: { Authorization: "Bearer " + RAC.getToken() } });
    if (resp.status === 401) { RAC.cerrarSesion(); return; }
    if (!resp.ok) {
      let mensaje = `Error ${resp.status}`;
      try { mensaje = (await resp.json()).error || mensaje; } catch (_) { /* sin cuerpo */ }
      throw new Error(mensaje);
    }
    const blob = await resp.blob();
    const m = /filename="([^"]+)"/.exec(resp.headers.get("Content-Disposition") || "");
    const enlace = document.createElement("a");
    enlace.href = URL.createObjectURL(blob);
    enlace.download = m ? m[1] : nombreRespaldo;
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    setTimeout(() => URL.revokeObjectURL(enlace.href), 4000);
  } catch (err) {
    mostrarToast(err.message, true);
  } finally {
    boton.disabled = false;
    boton.textContent = textoOriginal;
  }
}

function escapar(valor) {
  if (valor === undefined || valor === null) return "";
  return String(valor).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
