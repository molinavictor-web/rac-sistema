const usuario = renderShell("planteles", "Planteles");
let plantelEnEdicion = null;

if (usuario) dibujarPanel();

function dibujarPanel() {
  const contenido = document.getElementById("contenido");
  contenido.innerHTML = `
    <div class="panel">
      <div class="panel-cabecera">
        <h2>Catálogo de planteles</h2>
        <button class="btn btn-primario btn-sm" id="btnNuevoPlantel">+ Nuevo plantel</button>
      </div>
      <div style="padding: 16px 20px 0;">
        <form id="formBuscar" style="display:flex; gap:8px;">
          <input type="text" id="qBuscar" placeholder="Buscar por código o nombre...">
          <button type="submit" class="btn btn-primario">Buscar</button>
        </form>
      </div>
      <div id="tablaPlanteles" style="margin-top:16px;"></div>
    </div>
  `;
  document.getElementById("btnNuevoPlantel").addEventListener("click", abrirNuevo);
  document.getElementById("formBuscar").addEventListener("submit", (e) => {
    e.preventDefault();
    buscarPlanteles();
  });
  buscarPlanteles();
}

async function buscarPlanteles() {
  const q = document.getElementById("qBuscar").value.trim();
  const tabla = document.getElementById("tablaPlanteles");
  tabla.innerHTML = `<div class="cargando">Buscando…</div>`;
  try {
    const query = q ? `?q=${encodeURIComponent(q)}` : "";
    const resp = await RAC.get(`/api/planteles${query}`);
    const planteles = RAC.lista(resp, "planteles");
    dibujarTabla(planteles);
  } catch (err) {
    tabla.innerHTML = `<div class="vacio"><strong>No se pudo buscar</strong>${err.message}</div>`;
  }
}

function dibujarTabla(planteles) {
  const cont = document.getElementById("tablaPlanteles");
  if (!planteles.length) {
    cont.innerHTML = `<div class="vacio"><strong>Sin resultados</strong>Prueba con otro código o nombre.</div>`;
    return;
  }

  const filas = planteles.map((p) => `
    <tr>
      <td><span class="cod">${p.codigo_plantel}</span></td>
      <td>${p.nombre || "—"}</td>
      <td>${p.municipio_nombre || "—"}</td>
      <td>${p.dependencia || "—"}</td>
      <td>${badgeEstado(p.estado)}</td>
      <td>
        <button class="btn btn-fantasma btn-sm" data-editar="${p.id}">Editar</button>
        <button class="btn btn-fantasma btn-sm" data-eliminar="${p.id}">Eliminar</button>
      </td>
    </tr>
  `).join("");

  cont.innerHTML = `
    <table>
      <thead><tr><th>Código</th><th>Nombre</th><th>Municipio</th><th>Dependencia</th><th>Estado</th><th></th></tr></thead>
      <tbody>${filas}</tbody>
    </table>
  `;

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
  return `<span class="badge ${esCerrado ? "badge-descartado" : "badge-resuelto"}">${esCerrado ? "Inactivo" : "Activo"}</span>`;
}

// ---- Modal: Nuevo plantel ----
const modalNuevoFondo = document.getElementById("modalNuevoFondo");
const formNuevo = document.getElementById("formNuevo");
const errorModalNuevo = document.getElementById("errorModalNuevo");

function abrirNuevo() {
  formNuevo.reset();
  errorModalNuevo.classList.remove("visible");
  modalNuevoFondo.classList.add("visible");
}

function cerrarNuevo() {
  modalNuevoFondo.classList.remove("visible");
}

document.getElementById("btnCancelarNuevo").addEventListener("click", cerrarNuevo);

formNuevo.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorModalNuevo.classList.remove("visible");
  const btn = document.getElementById("btnGuardarNuevo");
  btn.disabled = true;
  btn.textContent = "Guardando…";

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

  try {
    await RAC.post("/api/planteles", datos);
    mostrarToast("Plantel dado de alta.");
    cerrarNuevo();
    buscarPlanteles();
  } catch (err) {
    errorModalNuevo.textContent = err.message;
    errorModalNuevo.classList.add("visible");
  } finally {
    btn.disabled = false;
    btn.textContent = "Guardar";
  }
});

// ---- Modal: Editar plantel ----
const modalEditarFondo = document.getElementById("modalEditarFondo");
const formEditar = document.getElementById("formEditar");
const errorModalEditar = document.getElementById("errorModalEditar");
const edEstado = document.getElementById("edEstado");
const edCampoFechaCierre = document.getElementById("edCampoFechaCierre");

function abrirEditar(plantel) {
  if (!plantel) return;
  plantelEnEdicion = plantel;
  errorModalEditar.classList.remove("visible");

  document.getElementById("edContextoGeografico").innerHTML = `
    <strong>${plantel.codigo_plantel}</strong> — ${plantel.estado_geografico || "—"},
    ${plantel.municipio_nombre || "—"}, ${plantel.parroquia || "—"}
    <br><span style="font-size:0.9em;">(el código y la ubicación no se pueden editar aquí)</span>
  `;

  document.getElementById("edNombre").value = plantel.nombre || "";
  document.getElementById("edDependencia").value = plantel.dependencia || "";
  document.getElementById("edDenominacion").value = plantel.denominacion || "";
  document.getElementById("edDireccion").value = plantel.direccion || "";
  edEstado.value = plantel.estado || "activo";
  document.getElementById("edFechaCierre").value = plantel.fecha_cierre
    ? String(plantel.fecha_cierre).slice(0, 10)
    : "";
  edCampoFechaCierre.style.display = edEstado.value === "cerrado" ? "block" : "none";

  modalEditarFondo.classList.add("visible");
}

function cerrarEditar() {
  modalEditarFondo.classList.remove("visible");
  plantelEnEdicion = null;
}

document.getElementById("btnCancelarEditar").addEventListener("click", cerrarEditar);

edEstado.addEventListener("change", () => {
  edCampoFechaCierre.style.display = edEstado.value === "cerrado" ? "block" : "none";
});

formEditar.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!plantelEnEdicion) return;
  errorModalEditar.classList.remove("visible");
  const btn = document.getElementById("btnGuardarEditar");
  btn.disabled = true;
  btn.textContent = "Guardando…";

  const fechaCierre = document.getElementById("edFechaCierre").value;
  const datos = {
    nombre: document.getElementById("edNombre").value.trim(),
    dependencia: document.getElementById("edDependencia").value.trim() || null,
    denominacion: document.getElementById("edDenominacion").value.trim() || null,
    direccion: document.getElementById("edDireccion").value.trim() || null,
    estado: edEstado.value,
    fecha_cierre: edEstado.value === "cerrado" && fechaCierre ? fechaCierre : null,
  };

  try {
    await RAC.patch(`/api/planteles/${plantelEnEdicion.id}`, datos);
    mostrarToast("Plantel actualizado.");
    cerrarEditar();
    buscarPlanteles();
  } catch (err) {
    errorModalEditar.textContent = err.message;
    errorModalEditar.classList.add("visible");
  } finally {
    btn.disabled = false;
    btn.textContent = "Guardar cambios";
  }
});

// ---- Eliminar plantel ----
async function eliminarPlantel(plantel) {
  if (!plantel) return;
  const confirmado = confirm(
    `¿Eliminar el plantel ${plantel.codigo_plantel} — ${plantel.nombre || "sin nombre"}?\n\nEsto solo funciona si el plantel no tiene registros del RAC asociados. Esta acción no se puede deshacer.`
  );
  if (!confirmado) return;

  try {
    await RAC.del(`/api/planteles/${plantel.id}`);
    mostrarToast("Plantel eliminado.");
    buscarPlanteles();
  } catch (err) {
    mostrarToast(err.message, true);
  }
}
