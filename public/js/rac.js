const usuario = renderShell("rac", "Consultar RAC");
let registroEnEdicion = null;

if (usuario) dibujarPanel();

function dibujarPanel() {
  document.getElementById("contenido").innerHTML = `
    <div class="panel">
      <div class="panel-cabecera">
        <h2>Buscar por cédula</h2>
        <div style="display:flex; gap:10px; align-items:center;">
          <form id="formBuscar" class="filtros">
            <input type="text" id="cedulaBusqueda" placeholder="Ej. 12345678" required>
            <button type="submit" class="btn btn-primario btn-sm">Buscar</button>
          </form>
          ${(usuario.rol === "operador" || usuario.rol === "admin")
            ? `<button type="button" class="btn btn-fantasma btn-sm" id="btnAbrirNuevo">+ Agregar registro</button>`
            : ""}
        </div>
      </div>
      <div id="tablaRac"></div>
    </div>
  `;
  document.getElementById("formBuscar").addEventListener("submit", buscarPorCedula);
  const btnNuevo = document.getElementById("btnAbrirNuevo");
  if (btnNuevo) btnNuevo.addEventListener("click", abrirNuevo);
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
  document.getElementById("edNivel").value = registro.nivel || "";
  document.getElementById("edModalidad").value = registro.modalidad || "";
  document.getElementById("edUbicacionGeografica").value = registro.ubicacion_geografica || "";
  document.getElementById("edTurnosPlantel").value = registro.turnos_plantel || "";
  document.getElementById("edCodigoEstadistico").value = registro.codigo_estadistico || "";
  document.getElementById("edFechaIngreso").value = registro.fecha_ingreso || "";
  document.getElementById("edSexo").value = registro.sexo || "";
  document.getElementById("edGradoImparte").value = registro.grado_imparte || "";
  document.getElementById("edSeccion").value = registro.seccion || "";
  document.getElementById("edEspecialidad").value = registro.especialidad || "";
  document.getElementById("edAnio").value = registro.anio || "";
  document.getElementById("edSecciones").value = registro.secciones || "";
  document.getElementById("edMateria").value = registro.materia || "";
  document.getElementById("edPeriodoGrupo").value = registro.periodo_grupo || "";
  document.getElementById("edEdad").value = registro.edad ?? "";
  document.getElementById("edComparativa").value = registro.comparativa || "";
  document.getElementById("edObservacion").value = registro.observacion || "";
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
  const edad = document.getElementById("edEdad").value;

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
    nivel: document.getElementById("edNivel").value.trim() || null,
    modalidad: document.getElementById("edModalidad").value.trim() || null,
    ubicacion_geografica: document.getElementById("edUbicacionGeografica").value.trim() || null,
    turnos_plantel: document.getElementById("edTurnosPlantel").value.trim() || null,
    codigo_estadistico: document.getElementById("edCodigoEstadistico").value.trim() || null,
    fecha_ingreso: document.getElementById("edFechaIngreso").value.trim() || null,
    sexo: document.getElementById("edSexo").value || null,
    grado_imparte: document.getElementById("edGradoImparte").value.trim() || null,
    seccion: document.getElementById("edSeccion").value.trim() || null,
    especialidad: document.getElementById("edEspecialidad").value.trim() || null,
    anio: document.getElementById("edAnio").value.trim() || null,
    secciones: document.getElementById("edSecciones").value.trim() || null,
    materia: document.getElementById("edMateria").value.trim() || null,
    periodo_grupo: document.getElementById("edPeriodoGrupo").value.trim() || null,
    edad: edad === "" ? null : Number(edad),
    comparativa: document.getElementById("edComparativa").value.trim() || null,
    observacion: document.getElementById("edObservacion").value.trim() || null,
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

// ---- Modal de alta manual (registro nuevo) ----
const modalNuevoFondo = document.getElementById("modalNuevoFondo");
const formNuevo = document.getElementById("formNuevo");
const errorModalNuevo = document.getElementById("errorModalNuevo");

function abrirNuevo() {
  errorModalNuevo.classList.remove("visible");
  formNuevo.reset();
  document.getElementById("nvPeriodoEscolar").value = "2025-2026";
  modalNuevoFondo.classList.add("visible");
}
function cerrarNuevo() { modalNuevoFondo.classList.remove("visible"); }

document.getElementById("btnCancelarNuevo").addEventListener("click", cerrarNuevo);

formNuevo.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorModalNuevo.classList.remove("visible");
  const btn = document.getElementById("btnGuardarNuevo");
  btn.disabled = true;
  btn.textContent = "Guardando…";

  const horasAcademicas = document.getElementById("nvHorasAcademicas").value;
  const horasAdm = document.getElementById("nvHorasAdm").value;
  const cedulaNueva = document.getElementById("nvCedula").value.trim();

  const datos = {
    cedula: cedulaNueva,
    periodo_escolar: document.getElementById("nvPeriodoEscolar").value.trim(),
    codigo_plantel: document.getElementById("nvCodigoPlantel").value.trim(),
    codigo_dependencia: document.getElementById("nvCodigoDependencia").value.trim() || null,
    codigo_cargo: document.getElementById("nvCodigoCargo").value.trim() || null,
    tipo_personal: document.getElementById("nvTipoPersonal").value || null,
    cargo: document.getElementById("nvCargo").value.trim() || null,
    turno: document.getElementById("nvTurno").value || null,
    horas_academicas: horasAcademicas === "" ? null : Number(horasAcademicas),
    horas_adm: horasAdm === "" ? null : Number(horasAdm),
    situacion: document.getElementById("nvSituacion").value.trim() || null,
  };

  try {
    await RAC.post("/api/rac", datos);
    mostrarToast("Registro agregado.");
    cerrarNuevo();
    document.getElementById("cedulaBusqueda").value = cedulaNueva;
    document.getElementById("formBuscar").requestSubmit();
  } catch (err) {
    errorModalNuevo.textContent = err.message;
    errorModalNuevo.classList.add("visible");
  } finally {
    btn.disabled = false;
    btn.textContent = "Agregar registro";
  }
});
