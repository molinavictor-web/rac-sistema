// inspecciones-mis-planillas.js — Pantalla de inicio del ingeniero: las
// planillas de plantel que le asignó el coordinador. Solo ve y edita estas.

const usuario = renderShell("inspecciones-mis-planillas", "Mis planillas");
let PLANILLAS = [];

if (usuario) cargar();

async function cargar() {
  const contenido = document.getElementById("contenido");
  contenido.innerHTML = `
    <section class="planteles-hero">
      <div class="planteles-hero-copy">
        <span class="planteles-eyebrow">INSPECCIONES</span>
        <h1>Mis planillas</h1>
        <p>Los planteles que el coordinador te asignó. Abre uno para cargar sus materiales.</p>
      </div>
    </section>
    <div class="panel">
      <div style="padding:16px 20px 0; display:flex; gap:12px; flex-wrap:wrap; align-items:center; justify-content:space-between;">
        <input type="search" id="buscar" placeholder="Buscar por nombre o código DEA…" style="flex:1; min-width:240px; padding:8px 12px; border:1px solid var(--borde); border-radius:8px;">
        <span id="resumen" style="color:var(--muted); font-size:.8rem;"></span>
      </div>
      <div id="tabla" style="margin-top:12px;"><div class="cargando">Cargando…</div></div>
    </div>
    <div class="panel" id="panelRehab" style="margin-top:16px; display:none;">
      <div style="padding:16px 20px 0;"><h3 style="margin:0;">Mis rehabilitaciones</h3>
        <p style="margin:4px 0 0; color:var(--muted); font-size:.82rem;">Planteles donde llevas la rehabilitación. Cuando el trabajo esté listo, cierra la ejecución para liberar el plantel.</p></div>
      <div id="tablaRehab" style="margin-top:12px;"></div>
    </div>`;
  document.getElementById("buscar").addEventListener("input", pintar);
  cargarRehabilitaciones();
  try {
    PLANILLAS = (await RAC.get("/api/inspecciones/mis-planillas")).planillas;
    pintar();
  } catch (err) {
    document.getElementById("tabla").innerHTML = `<div class="vacio"><strong>No se pudieron cargar tus planillas</strong>${escapar(err.message)}</div>`;
  }
}

let REHABS = [];

async function cargarRehabilitaciones() {
  try {
    const { rehabilitaciones, fases } = await RAC.get("/api/inspecciones/mis-rehabilitaciones");
    REHABS = rehabilitaciones;
    const FASES = fases || [];
    if (!rehabilitaciones.length) return;
    document.getElementById("panelRehab").style.display = "block";
    const filas = rehabilitaciones.map((r) => `<tr>
      <td><span class="cod">${escapar(r.codigo_dea)}</span></td>
      <td>${escapar(r.nombre_plantel)}<br><span style="color:var(--muted); font-size:.78rem;">${[escapar(r.municipio), escapar(r.parroquia)].filter(Boolean).join(" · ")}</span></td>
      <td>${escapar(r.plan_nombre)}</td>
      <td>${r.ejecucion === "CERRADO" ? etiqueta("Ejecución cerrada", "#2f855a", "#e6f4ea") : etiqueta("En ejecución", "#2b6cb0", "#ebf4ff")}</td>
      <td>${r.avance === undefined ? "—" : AvanceFases.barra(r.avance)}${r.ejecucion === "CERRADO" || r.plan_estado === "CERRADO" || !FASES.length ? "" : `<div style="margin-top:4px;"><button type="button" class="btn btn-fantasma btn-sm" data-avance-rehab="${Number(r.inspeccion_id)}" data-plan="${Number(r.plan_id)}">Registrar avance</button></div>`}</td>
      <td><a class="btn btn-fantasma btn-sm" href="/inspecciones/dotaciones.html?plan=${Number(r.plan_id)}">Dotación</a> ${r.ejecucion === "CERRADO" || r.plan_estado === "CERRADO" ? "" : `<button type="button" class="btn btn-primario btn-sm" data-cerrar-rehab="${Number(r.inspeccion_id)}" data-plan="${Number(r.plan_id)}" data-nombre="${escapar(r.nombre_plantel)}">Cerrar ejecución</button>`}</td>
    </tr>`).join("");
    document.getElementById("tablaRehab").innerHTML = `<div class="tabla-responsive"><table>
      <thead><tr><th>Código</th><th>Plantel</th><th>Plan</th><th>Estado</th><th>Avance</th><th></th></tr></thead><tbody>${filas}</tbody></table></div>`;
    document.querySelectorAll("[data-avance-rehab]").forEach((b) => b.addEventListener("click", () => {
      const r = REHABS.find((x) => x.inspeccion_id === Number(b.dataset.avanceRehab) && x.plan_id === Number(b.dataset.plan));
      if (!r) return;
      AvanceFases.abrir({ planId: r.plan_id, inspeccionId: r.inspeccion_id, nombrePlantel: r.nombre_plantel, fases: FASES, valores: r.fases || [], onGuardado: cargarRehabilitaciones });
    }));
    document.querySelectorAll("[data-cerrar-rehab]").forEach((b) => b.addEventListener("click", async () => {
      if (!window.confirm(`¿Cerrar la ejecución de «${b.dataset.nombre}»?\n\nQuedará libre para entrar a otro plan.`)) return;
      try {
        await RAC.post(`/api/inspecciones/planes/${b.dataset.plan}/planteles/${b.dataset.cerrarRehab}/cerrar-ejecucion`, {});
        mostrarToast("Ejecución cerrada.");
        cargarRehabilitaciones();
      } catch (err) {
        mostrarToast(err.message, true);
      }
    }));
  } catch (_) { /* si falla no estorba a las planillas */ }
}

function pintar() {
  const q = document.getElementById("buscar").value.trim().toLowerCase();
  const visibles = PLANILLAS.filter((p) => !q || `${p.nombre_plantel} ${p.codigo_dea} ${p.municipio} ${p.parroquia}`.toLowerCase().includes(q));
  document.getElementById("resumen").textContent = `${PLANILLAS.length} planilla${PLANILLAS.length === 1 ? "" : "s"} asignada${PLANILLAS.length === 1 ? "" : "s"}`;
  const cont = document.getElementById("tabla");
  if (!PLANILLAS.length) {
    cont.innerHTML = `<div class="vacio"><strong>Todavía no tienes planillas asignadas</strong>Cuando el coordinador te asigne un plantel, aparecerá aquí.</div>`;
    return;
  }
  if (!visibles.length) {
    cont.innerHTML = `<div class="vacio"><strong>Sin resultados</strong>Prueba con otro texto.</div>`;
    return;
  }
  const filas = visibles.map((p) => {
    const cerrado = p.plan_estado === "CERRADO";
    const accion = cerrado ? "Ver planilla" : "Abrir planilla";
    const planHtml = p.plan_nombre
      ? `${escapar(p.plan_nombre)}${cerrado ? " " + etiqueta("Plan cerrado", "#b7791f", "#fefcbf") : ""}`
      : `<span style="color:var(--muted);">Sin plan (en espera)</span>`;
    return `<tr>
      <td><span class="cod">${escapar(p.codigo_dea)}</span></td>
      <td>${escapar(p.nombre_plantel)}<br><span style="color:var(--muted); font-size:.78rem;">${[escapar(p.municipio), escapar(p.parroquia)].filter(Boolean).join(" · ")}</span></td>
      <td>${planHtml}</td>
      <td>${p.estado === "CARGADA" ? etiqueta("Cargada", "#2f855a", "#e6f4ea") : etiqueta("Borrador", "#b7791f", "#fefcbf")}</td>
      <td style="text-align:center;">${p.rubros_con_cantidad}${p.adicionales_con_cantidad ? ` <span style="color:#9a3d00; font-size:.75rem;">+${p.adicionales_con_cantidad} adic.</span>` : ""}</td>
      <td><a class="btn btn-primario btn-sm" href="/inspecciones/planilla.html?id=${Number(p.inspeccion_id)}${p.plan_id ? "&plan=" + Number(p.plan_id) : ""}">${accion}</a></td>
    </tr>`;
  }).join("");
  cont.innerHTML = `<div class="tabla-responsive"><table>
    <thead><tr><th>Código</th><th>Plantel</th><th>Plan</th><th>Estado</th><th>Rubros con cantidad</th><th></th></tr></thead>
    <tbody>${filas}</tbody></table></div>`;
}

function etiqueta(texto, color, fondo) {
  return `<span style="display:inline-block; padding:2px 9px; border-radius:999px; font-size:.72rem; font-weight:600; color:${color}; background:${fondo};">${escapar(texto)}</span>`;
}

function escapar(valor) {
  if (valor === undefined || valor === null) return "";
  return String(valor).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
