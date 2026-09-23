const usuario = renderShell("planteles", "Planteles");
let plantelEnEdicion = null;

if (usuario) dibujarPanel();

function dibujarPanel() {
  const contenido = document.getElementById("contenido");
  contenido.innerHTML = `
    <section class="planteles-hero">
      <div class="planteles-hero-copy">
        <span class="planteles-eyebrow">CATÁLOGO INSTITUCIONAL</span>
        <h1>Planteles educativos</h1>
        <p>Administra el catálogo de centros educativos registrados en el sistema RAC.</p>
      </div>
      <button class="btn btn-primario planteles-nuevo-btn" id="btnNuevoPlantel"><span>＋</span> Nuevo plantel</button>
    </section>

    <section class="planteles-toolbar panel">
      <div class="planteles-toolbar-copy"><strong>Buscar en el catálogo</strong><span>Consulta por código DEA, nombre o coincidencia.</span></div>
      <form id="formBuscar" class="planteles-search">
        <div class="planteles-search-input"><span>⌕</span><input type="search" id="qBuscar" placeholder="Código o nombre del plantel..." autocomplete="off"></div>
        <button type="submit" class="btn btn-primario">Buscar</button>
        <button type="button" class="btn btn-fantasma" id="btnLimpiarBusqueda">Limpiar</button>
      </form>
    </section>

    <section class="planteles-results panel">
      <div class="planteles-results-head"><div><h2>Resultados</h2><span id="contadorPlanteles">Consultando catálogo…</span></div><span class="planteles-live-dot"><i></i> Catálogo RAC</span></div>
      <div id="tablaPlanteles"></div>
    </section>
  `;

  document.getElementById("btnNuevoPlantel").addEventListener("click", () => abrirNuevo());
  document.getElementById("formBuscar").addEventListener("submit", (e) => { e.preventDefault(); buscarPlanteles(); });
  document.getElementById("btnLimpiarBusqueda").addEventListener("click", () => {
    document.getElementById("qBuscar").value = "";
    buscarPlanteles();
  });
  buscarPlanteles();
}

async function buscarPlanteles() {
  const q = document.getElementById("qBuscar").value.trim();
  const tabla = document.getElementById("tablaPlanteles");
  const contador = document.getElementById("contadorPlanteles");
  tabla.innerHTML = `<div class="cargando planteles-loading"><div><span class="planteles-spinner"></span><strong>Consultando planteles…</strong><small>Estamos buscando en el catálogo RAC.</small></div></div>`;
  contador.textContent = "Consultando catálogo…";
  try {
    const query = q ? `?q=${encodeURIComponent(q)}` : "";
    const resp = await RAC.get(`/api/planteles${query}`);
    const planteles = RAC.lista(resp, "planteles");
    dibujarTabla(planteles);
  } catch (err) {
    contador.textContent = "No disponible";
    tabla.innerHTML = `<div class="vacio planteles-empty"><strong>No se pudo buscar</strong><span>${esc(err.message)}</span><button class="btn btn-fantasma btn-sm" type="button" id="btnReintentar">Intentar nuevamente</button></div>`;
    document.getElementById("btnReintentar")?.addEventListener("click", buscarPlanteles);
  }
}

function dibujarTabla(planteles) {
  const cont = document.getElementById("tablaPlanteles");
  const contador = document.getElementById("contadorPlanteles");
  contador.textContent = `${planteles.length} ${planteles.length === 1 ? "plantel encontrado" : "planteles encontrados"}`;

  if (!planteles.length) {
    cont.innerHTML = `<div class="vacio planteles-empty"><div class="planteles-empty-icon">⌕</div><strong>Sin resultados</strong><span>Prueba con otro código o nombre.</span></div>`;
    return;
  }

  const filas = planteles.map((p) => `
    <tr>
      <td data-label="Código"><span class="cod">${esc(p.codigo_plantel)}</span></td>
      <td data-label="Nombre"><strong class="plantel-nombre">${esc(p.nombre || "—")}</strong></td>
      <td data-label="Municipio"><span class="plantel-location">${esc(p.municipio_nombre || "—")}</span></td>
      <td data-label="Dependencia">${esc(p.dependencia || "—")}</td>
      <td data-label="Estado">${badgeEstado(p.estado)}</td>
      <td data-label="Acciones" class="plantel-acciones"><button class="btn btn-fantasma btn-sm" data-editar="${p.id}">Editar</button><button class="btn btn-peligro btn-sm plantel-delete" data-eliminar="${p.id}">Eliminar</button></td>
    </tr>`).join("");

  cont.innerHTML = `
    <div class="planteles-table-wrap">
      <table class="planteles-table">
        <thead><tr><th>Código</th><th>Nombre</th><th>Municipio</th><th>Dependencia</th><th>Estado</th><th>Acciones</th></tr></thead>
        <tbody>${filas}</tbody>
      </table>
    </div>`;

  cont.querySelectorAll("[data-editar]").forEach((btn) => {
    const plantel = planteles.find((p) => String(p.id) === btn.dataset.editar);
    btn.addEventListener("click", () => abrirEditar(plantel));
  });
  cont.querySelectorAll("[data-eliminar]").forEach((btn) => {
    const plantel = planteles.find((p) => String(p.id) === btn.dataset.eliminar);
    btn.addEventListener("click", () => eliminarPlantel(plantel));
  });
}

function badgeEstado(estado) {
  const esCerrado = estado === "cerrado";
  return `<span class="badge ${esCerrado ? "badge-descartado" : "badge-resuelto"}"><span class="plantel-status-dot"></span>${esCerrado ? "Inactivo" : "Activo"}</span>`;
}

function esc(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
}

const modalNuevoFondo = document.getElementById("modalNuevoFondo");
const formNuevo = document.getElementById("formNuevo");
const errorModalNuevo = document.getElementById("errorModalNuevo");

function abrirNuevo(codigoPrefill) {
  formNuevo.reset();
  errorModalNuevo.classList.remove("visible");
  if (codigoPrefill) document.getElementById("nvCodigoPlantel").value = codigoPrefill;
  modalNuevoFondo.classList.add("visible");
  setTimeout(() => document.getElementById("nvCodigoPlantel")?.focus(), 50);
}
function cerrarNuevo() { modalNuevoFondo.classList.remove("visible"); }
document.getElementById("btnCancelarNuevo").addEventListener("click", cerrarNuevo);
document.getElementById("btnCerrarNuevoX").addEventListener("click", cerrarNuevo);

formNuevo.addEventListener("submit", async (e) => {
  e.preventDefault(); errorModalNuevo.classList.remove("visible");
  const btn = document.getElementById("btnGuardarNuevo"); btn.disabled = true; btn.textContent = "Guardando…";
  const datos = {
    codigo_plantel: document.getElementById("nvCodigoPlantel").value.trim(),
    nombre: document.getElementById("nvNombre").value.trim(),
    estado_geografico: document.getElementById("nvEstadoGeografico").value.trim(),
    municipio: document.getElementById("nvMunicipio").value.trim(),
    parroquia: document.getElementById("nvParroquia").value.trim(),
    dependencia: document.getElementById("nvDependencia").value.trim() || null,
    denominacion: document.getElementById("nvDenominacion").value.trim() || null,
    direccion: document.getElementById("nvDireccion").value.trim() || null,
  };
  try { await RAC.post("/api/planteles", datos); mostrarToast("Plantel dado de alta."); cerrarNuevo(); buscarPlanteles(); }
  catch (err) { errorModalNuevo.textContent = err.message; errorModalNuevo.classList.add("visible"); }
  finally { btn.disabled = false; btn.textContent = "Guardar plantel"; }
});

const modalEditarFondo = document.getElementById("modalEditarFondo");
const formEditar = document.getElementById("formEditar");
const errorModalEditar = document.getElementById("errorModalEditar");
const edEstado = document.getElementById("edEstado");
const edCampoFechaCierre = document.getElementById("edCampoFechaCierre");

function abrirEditar(plantel) {
  if (!plantel) return;
  plantelEnEdicion = plantel; errorModalEditar.classList.remove("visible");
  document.getElementById("edContextoGeografico").innerHTML = `<strong>${esc(plantel.codigo_plantel)}</strong><span>${esc(plantel.estado_geografico || "—")} · ${esc(plantel.municipio_nombre || "—")} · ${esc(plantel.parroquia || "—")}</span><small>El código y la ubicación no se pueden editar aquí.</small>`;
  document.getElementById("edNombre").value = plantel.nombre || "";
  document.getElementById("edDependencia").value = plantel.dependencia || "";
  document.getElementById("edDenominacion").value = plantel.denominacion || "";
  document.getElementById("edDireccion").value = plantel.direccion || "";
  edEstado.value = plantel.estado || "activo";
  document.getElementById("edFechaCierre").value = plantel.fecha_cierre ? String(plantel.fecha_cierre).slice(0, 10) : "";
  edCampoFechaCierre.style.display = edEstado.value === "cerrado" ? "block" : "none";
  modalEditarFondo.classList.add("visible");
  setTimeout(() => document.getElementById("edNombre")?.focus(), 50);
}
function cerrarEditar() { modalEditarFondo.classList.remove("visible"); plantelEnEdicion = null; }
document.getElementById("btnCancelarEditar").addEventListener("click", cerrarEditar);
document.getElementById("btnCerrarEditarX").addEventListener("click", cerrarEditar);
edEstado.addEventListener("change", () => { edCampoFechaCierre.style.display = edEstado.value === "cerrado" ? "block" : "none"; });

formEditar.addEventListener("submit", async (e) => {
  e.preventDefault(); if (!plantelEnEdicion) return;
  errorModalEditar.classList.remove("visible");
  const btn = document.getElementById("btnGuardarEditar"); btn.disabled = true; btn.textContent = "Guardando…";
  const fechaCierre = document.getElementById("edFechaCierre").value;
  const datos = { nombre: document.getElementById("edNombre").value.trim(), dependencia: document.getElementById("edDependencia").value.trim() || null, denominacion: document.getElementById("edDenominacion").value.trim() || null, direccion: document.getElementById("edDireccion").value.trim() || null, estado: edEstado.value, fecha_cierre: edEstado.value === "cerrado" && fechaCierre ? fechaCierre : null };
  try { await RAC.patch(`/api/planteles/${plantelEnEdicion.id}`, datos); mostrarToast("Plantel actualizado."); cerrarEditar(); buscarPlanteles(); }
  catch (err) { errorModalEditar.textContent = err.message; errorModalEditar.classList.add("visible"); }
  finally { btn.disabled = false; btn.textContent = "Guardar cambios"; }
});

async function eliminarPlantel(plantel) {
  if (!plantel) return;
  const confirmado = confirm(`¿Eliminar el plantel ${plantel.codigo_plantel} — ${plantel.nombre || "sin nombre"}?\n\nEsto solo funciona si el plantel no tiene registros del RAC asociados. Esta acción no se puede deshacer.`);
  if (!confirmado) return;
  try { await RAC.del(`/api/planteles/${plantel.id}`); mostrarToast("Plantel eliminado."); buscarPlanteles(); }
  catch (err) { mostrarToast(err.message, true); }
}

[modalNuevoFondo, modalEditarFondo].forEach((modal) => modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.remove("visible"); }));
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { cerrarNuevo(); cerrarEditar(); } });

(function precargarDesdeUrl() {
  const params = new URLSearchParams(window.location.search);
  const codigo = params.get("codigo_plantel");
  if (codigo) { abrirNuevo(codigo); window.history.replaceState({}, "", window.location.pathname); }
})();
