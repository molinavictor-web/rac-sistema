const usuario = renderShell("rac", "Consultar RAC");
let registroEnEdicion = null;

if (usuario) dibujarPanel();

function dibujarPanel() {
  document.getElementById("contenido").innerHTML = `
    <div class="panel">
      <div class="panel-cabecera">
        <h2>Buscar por cédula</h2>
        <form id="formBuscar" class="filtros">
          <input type="text" id="cedulaBusqueda" placeholder="Ej. 12345678" required>
          <button type="submit" class="btn btn-primario btn-sm">Buscar</button>
        </form>
      </div>
      <div id="tablaRac"></div>
    </div>
  `;
  document.getElementById("formBuscar").addEventListener("submit", buscarPorCedula);
}

async function buscarPorCedula(e) {
  e.preventDefault();
  const cedula = document.getElementById("cedulaBusqueda").value.trim();
  const cont = document.getElementById("tablaRac");
  cont.innerHTML = `<div class="cargando">Buscando…</div>`;

  try {
    const resp = await RAC.get(`/api/rac?cedula=${encodeURIComponent(cedula)}`);
    const items = RAC.lista(resp, "rac");

    if (!items.length) {
      cont.innerHTML = `<div class="vacio"><strong>Sin resultados</strong>No se encontró ningún registro con esa cédula en el RAC.</div>`;
      return;
    }

    const puedeEditar = usuario.rol === "operador" || usuario.rol === "admin";
    const puedeEliminar = usuario.rol === "admin";

    const filas = items.map((r) => `
      <tr>
        <td><span class="cod">${r.cedula}</span></td>
        <td>${r.plantel_nombre || "—"} <span class="cod">${r.codigo_plantel || ""}</span></td>
        <td>${r.cargo || "—"}</td>
        <td>${r.turno || "—"}</td>
        <td>${r.horas_academicas ?? 0} / ${r.horas_adm ?? 0}</td>
        <td>${badgeSituacion(r.situacion)}</td>
        <td>
          ${puedeEditar ? `<button class="btn btn-fantasma btn-sm" data-editar="${r.id}">Editar</button>` : ""}
          ${puedeEliminar ? `<button class="btn btn-fantasma btn-sm" data-eliminar="${r.id}">Eliminar</button>` : ""}
        </td>
      </tr>
    `).join("");

    cont.innerHTML = `
      <table>
        <thead>
          <tr><th>Cédula</th><th>Plantel</th><th>Cargo</th><th>Turno</th><th>Horas (acad/adm)</th><th>Situación</th><th></th></tr>
        </thead>
        <tbody>${filas}</tbody>
      </table>
    `;

    cont.querySelectorAll("[data-editar]").forEach((btn) => {
      const registro = items.find((r) => String(r.id) === btn.dataset.editar);
      btn.addEventListener("click", () => abrirEdicion(registro));
    });
    cont.querySelectorAll("[data-eliminar]").forEach((btn) => {
      btn.addEventListener("click", () => eliminarRegistro(btn.dataset.eliminar, cedula));
    });
  } catch (err) {
    cont.innerHTML = `<div class="vacio"><strong>No se pudo buscar</strong>${err.message}</div>`;
  }
}

function badgeSituacion(situacion) {
  const mapa = {
    activo: "badge-resuelto",
    tramite_jubilacion: "badge-pendiente",
    reposo: "badge-pendiente",
    tramite_incapacidad: "badge-pendiente",
    fallecido: "badge-descartado",
    permiso: "badge-revisado",
    abandono: "badge-descartado",
  };
  const clase = mapa[situacion] || "badge-descartado";
  return `<span class="badge ${clase}">${situacion || "—"}</span>`;
}

// ---- Modal de edición ----
const modalFondo = document.getElementById("modalFondo");
const formEditar = document.getElementById("formEditar");
const errorModal = document.getElementById("errorModal");

function abrirEdicion(registro) {
  registroEnEdicion = registro;
  errorModal.classList.remove("visible");
  document.getElementById("edCedula").value = registro.cedula;
  document.getElementById("edPlantelId").value = registro.plantel_id;
  document.getElementById("edCargo").value = registro.cargo || "";
  document.getElementById("edTurno").value = registro.turno || "";
  document.getElementById("edHorasAcademicas").value = registro.horas_academicas ?? "";
  document.getElementById("edHorasAdm").value = registro.horas_adm ?? "";
  document.getElementById("edSituacion").value = registro.situacion || "activo";
  modalFondo.classList.add("visible");
}
function cerrarEdicion() { modalFondo.classList.remove("visible"); registroEnEdicion = null; }

document.getElementById("btnCancelarEdicion").addEventListener("click", cerrarEdicion);

formEditar.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!registroEnEdicion) return;
  errorModal.classList.remove("visible");
  const btn = document.getElementById("btnGuardarEdicion");
  btn.disabled = true;
  btn.textContent = "Guardando…";

  const cambios = {
    plantel_id: Number(document.getElementById("edPlantelId").value),
    cargo: document.getElementById("edCargo").value.trim(),
    turno: document.getElementById("edTurno").value,
    horas_academicas: Number(document.getElementById("edHorasAcademicas").value) || 0,
    horas_adm: Number(document.getElementById("edHorasAdm").value) || 0,
    situacion: document.getElementById("edSituacion").value,
  };

  try {
    await RAC.patch(`/api/rac/${registroEnEdicion.id}`, cambios);
    mostrarToast("Registro actualizado.");
    cerrarEdicion();
    document.getElementById("formBuscar").requestSubmit();
  } catch (err) {
    errorModal.textContent = err.message;
    errorModal.classList.add("visible");
  } finally {
    btn.disabled = false;
    btn.textContent = "Guardar cambios";
  }
});

async function eliminarRegistro(id, cedulaActual) {
  const confirmado = confirm("¿Eliminar este registro del RAC? Esta acción no se puede deshacer.");
  if (!confirmado) return;
  try {
    await RAC.del(`/api/rac/${id}`);
    mostrarToast("Registro eliminado.");
    document.getElementById("cedulaBusqueda").value = cedulaActual;
    document.getElementById("formBuscar").requestSubmit();
  } catch (err) {
    mostrarToast(err.message, true);
  }
}
