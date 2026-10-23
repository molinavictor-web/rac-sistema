// inspecciones-planes.js — Inspecciones, etapa 1: planes de atención y los
// planteles de cada plan. Habla con /api/inspecciones/*.
//
// Idea central: la inspección (con sus cantidades) pertenece al PLANTEL.
// "Desenlazar" un plantel de un plan no borra nada: la inspección queda
// guardada, en espera de una futura rehabilitación.

const usuario = renderShell("inspecciones-planes", "Planes de atención");
const PUEDE_GESTIONAR = Boolean(usuario) && ["admin", "operador_plantel"].includes(usuario.rol);

let PLANES = [];
let PLAN_ABIERTO = null; // { plan, planteles }
let MODO_MODAL = "crear";
let temporizadorBusqueda = null;

if (usuario) {
  window.addEventListener("hashchange", enrutar);
  enrutar();
}

function enrutar() {
  const coincide = /^#plan-(\d+)$/.exec(window.location.hash);
  if (coincide) abrirPlan(Number(coincide[1]));
  else mostrarLista();
}

// ---------------------------------------------------------------------------
// Lista de planes
// ---------------------------------------------------------------------------

async function mostrarLista() {
  PLAN_ABIERTO = null;
  const contenido = document.getElementById("contenido");
  contenido.innerHTML = `
    <section class="planteles-hero">
      <div class="planteles-hero-copy">
        <span class="planteles-eyebrow">INSPECCIONES</span>
        <h1>Planes de atención</h1>
        <p>Los planes que definen las autoridades (PRE 2026-2027, Bricomiles…) y los planteles que atiende cada uno.</p>
      </div>
    </section>
    <div class="panel">
      <div style="padding:16px 20px 0; display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap;">
        <div id="resumenPlanes" style="color:var(--muted); font-size:.8rem;"></div>
        <button type="button" class="btn btn-primario btn-sm" id="btnNuevoPlan">+ Nuevo plan</button>
      </div>
      <div id="tablaPlanes" style="margin-top:12px;"><div class="cargando">Cargando…</div></div>
    </div>
  `;
  document.getElementById("btnNuevoPlan").addEventListener("click", () => abrirModalPlan("crear"));

  try {
    const resp = await RAC.get("/api/inspecciones/planes");
    PLANES = RAC.lista(resp, "planes");
    pintarPlanes();
  } catch (err) {
    document.getElementById("tablaPlanes").innerHTML =
      `<div class="vacio"><strong>No se pudieron cargar los planes</strong>${escapar(err.message)}</div>`;
  }
}

function pintarPlanes() {
  const cont = document.getElementById("tablaPlanes");
  const resumen = document.getElementById("resumenPlanes");
  if (!cont) return;
  resumen.textContent = `${PLANES.length} plan${PLANES.length === 1 ? "" : "es"}`;

  if (!PLANES.length) {
    cont.innerHTML = `<div class="vacio"><strong>Todavía no hay planes</strong>Crea el primero con «+ Nuevo plan».</div>`;
    return;
  }

  const filas = PLANES.map((p) => `
    <tr>
      <td><strong>${escapar(p.nombre)}</strong>${p.descripcion ? `<br><span style="color:var(--muted); font-size:.78rem;">${escapar(p.descripcion)}</span>` : ""}</td>
      <td>${escapar(p.version_catalogo)}</td>
      <td>${etiquetaEstado(p.estado)}</td>
      <td style="text-align:center;">${Number(p.planteles_activos) || 0}</td>
      <td style="text-align:center;">${Number(p.planteles_desenlazados) || 0}</td>
      <td>${fecha(p.creado_en)}</td>
      <td><button type="button" class="btn btn-fantasma btn-sm" data-abrir="${Number(p.id)}">Abrir</button></td>
    </tr>
  `).join("");

  cont.innerHTML = `
    <div class="tabla-responsive">
      <table>
        <thead><tr><th>Plan</th><th>Lista de materiales</th><th>Estado</th><th>Planteles</th><th>Desenlazados</th><th>Creado</th><th></th></tr></thead>
        <tbody>${filas}</tbody>
      </table>
    </div>
  `;
  cont.querySelectorAll("[data-abrir]").forEach((boton) => {
    boton.addEventListener("click", () => { window.location.hash = `#plan-${boton.dataset.abrir}`; });
  });
}

// ---------------------------------------------------------------------------
// Un plan y sus planteles
// ---------------------------------------------------------------------------

async function abrirPlan(id) {
  const contenido = document.getElementById("contenido");
  contenido.innerHTML = `<div class="panel"><div class="cargando">Cargando plan…</div></div>`;
  try {
    PLAN_ABIERTO = await RAC.get(`/api/inspecciones/planes/${id}`);
  } catch (err) {
    contenido.innerHTML = `
      <div class="panel"><div class="vacio"><strong>No se pudo abrir el plan</strong>${escapar(err.message)}<br><br>
      <button type="button" class="btn btn-fantasma btn-sm" id="btnVolverError">← Todos los planes</button></div></div>`;
    document.getElementById("btnVolverError").addEventListener("click", volverALista);
    return;
  }
  dibujarPlan();
}

function volverALista() {
  if (window.location.hash) window.location.hash = "";
  else mostrarLista();
}

function dibujarPlan() {
  const { plan } = PLAN_ABIERTO;
  const abierto = plan.estado === "ACTIVO";
  const contenido = document.getElementById("contenido");

  contenido.innerHTML = `
    <section class="planteles-hero">
      <div class="planteles-hero-copy">
        <span class="planteles-eyebrow">PLAN DE ATENCIÓN · ${escapar(plan.version_catalogo)}</span>
        <h1>${escapar(plan.nombre)}</h1>
        <p>${plan.descripcion ? escapar(plan.descripcion) : "Sin descripción."} ${etiquetaEstado(plan.estado)}</p>
      </div>
    </section>

    <div class="panel" style="margin-bottom:16px;">
      <div style="padding:14px 20px; display:flex; gap:10px; flex-wrap:wrap;">
        <button type="button" class="btn btn-fantasma btn-sm" id="btnVolver">← Todos los planes</button>
        <button type="button" class="btn btn-fantasma btn-sm" id="btnEditarPlan">Editar nombre</button>
        <button type="button" class="btn btn-fantasma btn-sm" id="btnEstadoPlan">${abierto ? "Cerrar plan" : "Reabrir plan"}</button>
        <a class="btn btn-primario btn-sm" href="/inspecciones/consolidado.html?plan=${Number(plan.id)}">Consolidado oficial</a>
        <a class="btn btn-primario btn-sm" href="/inspecciones/adicionales-consolidado.html?plan=${Number(plan.id)}">Consolidado de adicionales</a>
      </div>
    </div>

    ${abierto ? `
    <div class="panel" style="margin-bottom:16px;">
      <div style="padding:16px 20px 0;">
        <h3 style="margin:0 0 4px;">Agregar un plantel</h3>
        <p style="margin:0 0 10px; color:var(--muted); font-size:.82rem;">Busca por nombre, código DEA, municipio o parroquia. Si el plantel ya tiene una inspección guardada en espera, se reutiliza con sus cantidades.</p>
        <div class="filtros">
          <input type="text" id="qPlantel" placeholder="Escribe al menos 2 caracteres…" style="flex:1; min-width:260px;">
        </div>
      </div>
      <div id="resultadosBusqueda" style="margin-top:10px;"></div>
    </div>` : ""}

    <div class="panel">
      <div style="padding:16px 20px 0;"><h3 style="margin:0;" id="tituloPlanteles">Planteles del plan</h3></div>
      <div id="tablaPlanteles" style="margin-top:12px;"></div>
    </div>
  `;

  document.getElementById("btnVolver").addEventListener("click", volverALista);
  document.getElementById("btnEditarPlan").addEventListener("click", () => abrirModalPlan("editar"));
  document.getElementById("btnEstadoPlan").addEventListener("click", cambiarEstadoPlan);
  if (abierto) {
    const input = document.getElementById("qPlantel");
    input.addEventListener("input", () => {
      clearTimeout(temporizadorBusqueda);
      temporizadorBusqueda = setTimeout(() => buscarPlanteles(input.value.trim()), 380);
    });
  }
  pintarPlanteles();
}

function pintarPlanteles() {
  const { plan, planteles } = PLAN_ABIERTO;
  const abierto = plan.estado === "ACTIVO";
  const activos = planteles.filter((p) => p.activo).length;
  const desenlazados = planteles.length - activos;
  document.getElementById("tituloPlanteles").textContent =
    `Planteles del plan · ${activos} activo${activos === 1 ? "" : "s"}` + (desenlazados ? ` · ${desenlazados} desenlazado${desenlazados === 1 ? "" : "s"}` : "");

  const cont = document.getElementById("tablaPlanteles");
  if (!planteles.length) {
    cont.innerHTML = `<div class="vacio"><strong>Este plan todavía no tiene planteles</strong>${abierto ? "Búscalos arriba y agrégalos." : ""}</div>`;
    return;
  }

  const filas = planteles.map((p) => `
    <tr${p.activo ? "" : ' style="opacity:.6;"'}>
      <td><span class="cod">${escapar(p.codigo_dea)}</span></td>
      <td>${escapar(p.nombre_plantel) || "—"}<br><span style="color:var(--muted); font-size:.78rem;">${[escapar(p.municipio), escapar(p.parroquia)].filter(Boolean).join(" · ")}</span></td>
      <td>${p.activo ? etiqueta("En el plan", "#2f855a", "#e6f4ea") : etiqueta("Desenlazado · en espera", "#718096", "#edf2f7")}</td>
      <td style="white-space:nowrap;"><a class="btn btn-primario btn-sm" href="/inspecciones/planilla.html?id=${Number(p.inspeccion_id)}&plan=${Number(plan.id)}">${p.activo ? "Planilla" : "Ver planilla"}</a></td>
      <td>${abierto ? (p.activo
        ? `<button type="button" class="btn btn-fantasma btn-sm" data-desenlazar="${Number(p.inspeccion_id)}" data-nombre="${escapar(p.nombre_plantel || p.codigo_dea)}">Desenlazar</button>`
        : `<button type="button" class="btn btn-fantasma btn-sm" data-reenlazar="${Number(p.inspeccion_id)}">Volver a enlazar</button>`) : ""}</td>
    </tr>
  `).join("");

  cont.innerHTML = `
    <div class="tabla-responsive">
      <table>
        <thead><tr><th>Código</th><th>Plantel</th><th>Estado</th><th>Materiales</th><th></th></tr></thead>
        <tbody>${filas}</tbody>
      </table>
    </div>
  `;
  cont.querySelectorAll("[data-desenlazar]").forEach((b) => {
    b.addEventListener("click", () => desenlazar(Number(b.dataset.desenlazar), b.dataset.nombre));
  });
  cont.querySelectorAll("[data-reenlazar]").forEach((b) => {
    b.addEventListener("click", () => reenlazar(Number(b.dataset.reenlazar)));
  });
}

async function recargarPlan() {
  PLAN_ABIERTO = await RAC.get(`/api/inspecciones/planes/${PLAN_ABIERTO.plan.id}`);
  pintarPlanteles();
}

// ---- Buscar y agregar planteles ----

async function buscarPlanteles(q) {
  const cont = document.getElementById("resultadosBusqueda");
  if (!cont) return;
  if (!q) { cont.innerHTML = ""; return; }
  if (q.length < 2) {
    cont.innerHTML = `<div class="vacio"><strong>Escribe al menos 2 caracteres</strong></div>`;
    return;
  }
  cont.innerHTML = `<div class="cargando">Buscando…</div>`;
  try {
    const resp = await RAC.get(`/api/inspecciones/planteles/buscar?q=${encodeURIComponent(q)}&plan_id=${PLAN_ABIERTO.plan.id}`);
    const lista = RAC.lista(resp, "planteles");
    if (!lista.length) {
      cont.innerHTML = `<div class="vacio"><strong>Sin resultados</strong>Prueba con otro nombre o código.</div>`;
      return;
    }
    const filas = lista.map((p) => `
      <tr>
        <td><span class="cod">${escapar(p.cod_plantel)}</span></td>
        <td>${escapar(p.nombre_plantel) || "—"}<br><span style="color:var(--muted); font-size:.78rem;">${[escapar(p.municipio), escapar(p.parroquia)].filter(Boolean).join(" · ")}</span></td>
        <td style="font-size:.8rem; color:var(--muted);">${p.inspecciones ? `${Number(p.inspecciones)} inspección${p.inspecciones === 1 ? "" : "es"} guardada${p.inspecciones === 1 ? "" : "s"}` : "Sin inspecciones"}</td>
        <td>${p.en_el_plan
          ? etiqueta("Ya en el plan", "#2f855a", "#e6f4ea")
          : `<button type="button" class="btn btn-primario btn-sm" data-agregar="${escapar(p.cod_plantel)}">Agregar</button>`}</td>
      </tr>
    `).join("");
    cont.innerHTML = `
      <div style="padding:0 20px; color:var(--muted); font-size:.78rem;">${resp.total} resultado${resp.total === 1 ? "" : "s"}${resp.limitado ? " · mostrando los primeros 30" : ""}</div>
      <div class="tabla-responsive"><table>
        <thead><tr><th>Código</th><th>Plantel</th><th>Inspecciones</th><th></th></tr></thead>
        <tbody>${filas}</tbody>
      </table></div>`;
    cont.querySelectorAll("[data-agregar]").forEach((b) => {
      b.addEventListener("click", () => agregarPlantel(b.dataset.agregar, q));
    });
  } catch (err) {
    cont.innerHTML = `<div class="vacio"><strong>No se pudo buscar</strong>${escapar(err.message)}</div>`;
  }
}

async function agregarPlantel(codigo, qActual) {
  try {
    const resp = await RAC.post(`/api/inspecciones/planes/${PLAN_ABIERTO.plan.id}/planteles`, { codigo_dea: codigo });
    mostrarToast(resp.accion === "reutilizada"
      ? "Plantel agregado: se reutilizó su inspección guardada."
      : "Plantel agregado con una inspección nueva.");
    await recargarPlan();
    buscarPlanteles(qActual);
  } catch (err) {
    mostrarToast(err.message, true);
  }
}

async function desenlazar(inspeccionId, nombre) {
  const seguro = window.confirm(
    `¿Desenlazar «${nombre}» de este plan?\n\nNo se borra nada: sus cantidades quedan guardadas, en espera de una futura rehabilitación.`
  );
  if (!seguro) return;
  try {
    await RAC.post(`/api/inspecciones/planes/${PLAN_ABIERTO.plan.id}/planteles/${inspeccionId}/desenlazar`, {});
    mostrarToast("Plantel desenlazado. Su inspección quedó en espera.");
    await recargarPlan();
    const q = document.getElementById("qPlantel");
    if (q && q.value.trim().length >= 2) buscarPlanteles(q.value.trim());
  } catch (err) {
    mostrarToast(err.message, true);
  }
}

async function reenlazar(inspeccionId) {
  try {
    await RAC.post(`/api/inspecciones/planes/${PLAN_ABIERTO.plan.id}/planteles/${inspeccionId}/reenlazar`, {});
    mostrarToast("Plantel enlazado de nuevo.");
    await recargarPlan();
    const q = document.getElementById("qPlantel");
    if (q && q.value.trim().length >= 2) buscarPlanteles(q.value.trim());
  } catch (err) {
    mostrarToast(err.message, true);
  }
}

// ---------------------------------------------------------------------------
// Modal: crear / editar plan y cerrar / reabrir
// ---------------------------------------------------------------------------

const modalPlanFondo = document.getElementById("modalPlanFondo");
const formPlan = document.getElementById("formPlan");
const errorModalPlan = document.getElementById("errorModalPlan");

function abrirModalPlan(modo) {
  MODO_MODAL = modo;
  errorModalPlan.classList.remove("visible");
  formPlan.reset();
  document.getElementById("modalPlanTitulo").textContent = modo === "crear" ? "Nuevo plan de atención" : "Editar plan";
  document.getElementById("modalPlanSubtitulo").style.display = modo === "crear" ? "" : "none";
  document.getElementById("btnGuardarPlan").textContent = modo === "crear" ? "Crear plan" : "Guardar cambios";
  if (modo === "editar" && PLAN_ABIERTO) {
    document.getElementById("planNombre").value = PLAN_ABIERTO.plan.nombre || "";
    document.getElementById("planDescripcion").value = PLAN_ABIERTO.plan.descripcion || "";
  }
  modalPlanFondo.classList.add("visible");
  document.getElementById("planNombre").focus();
}

function cerrarModalPlan() {
  modalPlanFondo.classList.remove("visible");
}

document.getElementById("btnCancelarPlan").addEventListener("click", cerrarModalPlan);
modalPlanFondo.addEventListener("click", (e) => {
  if (e.target === modalPlanFondo) cerrarModalPlan();
});

formPlan.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorModalPlan.classList.remove("visible");
  const boton = document.getElementById("btnGuardarPlan");
  const textoBoton = boton.textContent;
  boton.disabled = true;
  boton.textContent = "Guardando…";

  const datos = {
    nombre: document.getElementById("planNombre").value.trim(),
    descripcion: document.getElementById("planDescripcion").value.trim(),
  };
  try {
    if (MODO_MODAL === "crear") {
      const resp = await RAC.post("/api/inspecciones/planes", datos);
      mostrarToast("Plan creado.");
      cerrarModalPlan();
      window.location.hash = `#plan-${resp.plan.id}`;
    } else {
      await RAC.patch(`/api/inspecciones/planes/${PLAN_ABIERTO.plan.id}`, datos);
      mostrarToast("Plan actualizado.");
      cerrarModalPlan();
      await abrirPlan(PLAN_ABIERTO.plan.id);
    }
  } catch (err) {
    errorModalPlan.textContent = err.message;
    errorModalPlan.classList.add("visible");
  } finally {
    boton.disabled = false;
    boton.textContent = textoBoton;
  }
});

async function cambiarEstadoPlan() {
  const { plan } = PLAN_ABIERTO;
  const nuevo = plan.estado === "ACTIVO" ? "CERRADO" : "ACTIVO";
  if (nuevo === "CERRADO" && !window.confirm("¿Cerrar este plan? No se podrán agregar ni quitar planteles hasta reabrirlo.")) return;
  try {
    await RAC.patch(`/api/inspecciones/planes/${plan.id}`, { estado: nuevo });
    mostrarToast(nuevo === "CERRADO" ? "Plan cerrado." : "Plan reabierto.");
    await abrirPlan(plan.id);
  } catch (err) {
    mostrarToast(err.message, true);
  }
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function etiqueta(texto, color, fondo) {
  return `<span style="display:inline-block; padding:2px 9px; border-radius:999px; font-size:.72rem; font-weight:600; color:${color}; background:${fondo};">${escapar(texto)}</span>`;
}

function etiquetaEstado(estado) {
  return estado === "ACTIVO" ? etiqueta("Activo", "#2f855a", "#e6f4ea") : etiqueta("Cerrado", "#b7791f", "#fefcbf");
}

function fecha(valor) {
  if (!valor) return "—";
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("es-VE");
}

function escapar(valor) {
  if (valor === undefined || valor === null) return "";
  return String(valor)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
