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
  const s = (situacion || "").toUpperCase();
  const mapa = {
    ACTIVO: "badge-resuelto",
    FALLECIDO: "badge-descartado",
    ABANDONO: "badge-descartado",
  };
  const clase = mapa[s] || "badge-pendiente";
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
  document.getElementById("edCodigoPlantel").value = registro.codigo_plantel || "";
  document.getElementById("edCodigoDependencia").value = registro.codigo_dependencia || "";
  document.getElementById("edCodigoCargo").value = registro.codigo_cargo || "";
  document.getElementById("edTipoPersonal").value = registro.tipo_personal || "";
  document.getElementById("edCargo").value = registro.cargo || "";
  document.getElementById("edTurno").value = registro.turno || "";
  document.getElementById("edHorasAcademicas").value = registro.horas_academicas ?? "";
  document.getElementById("edHorasAdm").value = registro.horas_adm ?? "";
  document.getElementById("edSituacion").value = registro.situacion || "";
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

  const horasAcademicas = document.getElementById("edHorasAcademicas").value;
  const horasAdm = document.getElementById("edHorasAdm").value;

  const cambios = {
    codigo_plantel: document.getElementById("edCodigoPlantel").value.trim(),
    codigo_dependencia: document.getElementById("edCodigoDependencia").value.trim() || null,
    codigo_cargo: document.getElementById("edCodigoCargo").value.trim() || null,
    tipo_personal: document.getElementById("edTipoPersonal").value || null,
    cargo: document.getElementById("edCargo").value.trim() || null,
    turno: document.getElementById("edTurno").value || null,
    horas_academicas: horasAcademicas === "" ? null : Number(horasAcademicas),
    horas_adm: horasAdm === "" ? null : Number(horasAdm),
    situacion: document.getElementById("edSituacion").value.trim() || null,
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
