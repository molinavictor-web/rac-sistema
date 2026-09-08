const usuario = renderShell("rac", "Consultar RAC");
let registroEnEdicion = null;

if (usuario) dibujarPanel();

// MEJORA 6 (2026-09-07): si se llega desde el botón "Revisar" de la bandeja
// de Alertas (/rac.html?cedula=...), precarga esa cédula en el buscador y
// dispara la búsqueda sola, para no obligar al usuario a volver a escribirla.
const cedulaDesdeUrl = new URLSearchParams(window.location.search).get("cedula");
if (cedulaDesdeUrl) {
  document.getElementById("cedulaBusqueda").value = cedulaDesdeUrl;
  document.getElementById("formBuscar").requestSubmit();
}

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
        <td>${[r.nombres, r.apellidos].filter(Boolean).join(" ") || "—"}</td>
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
          <tr><th>Cédula</th><th>Nombre y apellido</th><th>Plantel</th><th>Cargo</th><th>Turno</th><th>Horas (acad/adm)</th><th>Situación</th><th></th></tr>
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

// ---- Consulta a la nómina del Ministerio (referencia para prellenar datos) ----
// planteles y personal_ministerio son solo de CONSULTA para ayudar a llenar
// el RAC -- rac es siempre la fuente de verdad editable.
async function consultarNomina(cedula) {
  if (!cedula) return null;
  try {
    return await RAC.get(`/api/rac/verificar-nomina?cedula=${encodeURIComponent(cedula)}`);
  } catch (err) {
    return null;
  }
}

function pintarAvisoNomina(contenedor, resultado) {
  if (!resultado) {
    contenedor.style.display = "none";
    contenedor.textContent = "";
    return;
  }
  contenedor.style.display = "block";
  if (resultado.existe) {
    contenedor.style.color = "";
    contenedor.textContent = `✓ Encontrado en la nómina: ${[resultado.nombres, resultado.apellidos].filter(Boolean).join(" ") || "(sin nombre registrado)"}`;
  } else {
    contenedor.style.color = "#b45309";
    contenedor.textContent = "⚠ Esta cédula no está en la nómina del Ministerio. Puedes continuar, pero el sistema generará una alerta de revisión.";
  }
}

// ---- Modal de edición ----
const modalFondo = document.getElementById("modalFondo");
const formEditar = document.getElementById("formEditar");
const errorModal = document.getElementById("errorModal");
const btnCorregirCedula = document.getElementById("btnCorregirCedula");
const edCedula = document.getElementById("edCedula");

function obtenerOaCrearAvisoCedula() {
  let aviso = document.getElementById("avisoCedulaCorregida");
  if (!aviso) {
    aviso = document.createElement("div");
    aviso.id = "avisoCedulaCorregida";
    aviso.style.marginTop = "6px";
    aviso.style.fontSize = "0.85em";
    btnCorregirCedula.insertAdjacentElement("afterend", aviso);
  }
  return aviso;
}

function limpiarAvisoCedula() {
  const aviso = document.getElementById("avisoCedulaCorregida");
  if (aviso) aviso.remove();
}

async function onBlurCedulaCorregida() {
  const cedula = edCedula.value.trim();
  const aviso = obtenerOaCrearAvisoCedula();
  if (!cedula) {
    aviso.textContent = "";
    return;
  }
  aviso.style.color = "";
  aviso.textContent = "Consultando nómina…";
  const resultado = await consultarNomina(cedula);
  if (resultado && resultado.existe) {
    document.getElementById("edNombres").value = resultado.nombres || "";
    document.getElementById("edApellidos").value = resultado.apellidos || "";
  }
  pintarAvisoNomina(aviso, resultado);
}

// Deja el bloque de cédula en su estado inicial (bloqueada, sin aviso) cada
// vez que se abre el modal, sin importar cómo haya quedado la edición previa.
function reiniciarBloqueCedula() {
  edCedula.disabled = true;
  edCedula.removeEventListener("blur", onBlurCedulaCorregida);
  btnCorregirCedula.textContent = "¿Cédula incorrecta? Corregir";
  limpiarAvisoCedula();
}

btnCorregirCedula.addEventListener("click", () => {
  if (edCedula.disabled) {
    const confirmado = confirm(
      "Vas a corregir la cédula de este registro. Esto va a ELIMINAR el registro actual y CREAR uno nuevo con la cédula corregida, conservando todos los demás datos que ya están en este formulario. ¿Deseas continuar?"
    );
    if (!confirmado) return;
    edCedula.disabled = false;
    edCedula.value = "";
    edCedula.focus();
    btnCorregirCedula.textContent = "Cancelar corrección de cédula";
    edCedula.addEventListener("blur", onBlurCedulaCorregida);
  } else {
    edCedula.value = registroEnEdicion ? registroEnEdicion.cedula : "";
    reiniciarBloqueCedula();
  }
});

function abrirEdicion(registro) {
  registroEnEdicion = registro;
  errorModal.classList.remove("visible");
  reiniciarBloqueCedula();
  edCedula.value = registro.cedula;
  document.getElementById("edPeriodoEscolar").value = registro.periodo_escolar || "";
  document.getElementById("edNombres").value = registro.nombres || "";
  document.getElementById("edApellidos").value = registro.apellidos || "";
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
function cerrarEdicion() {
  modalFondo.classList.remove("visible");
  registroEnEdicion = null;
  reiniciarBloqueCedula();
}

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
  const cedulaFormulario = edCedula.value.trim();
  const cedulaCambio = !edCedula.disabled && cedulaFormulario !== registroEnEdicion.cedula;

  const camposComunes = {
    codigo_plantel: document.getElementById("edCodigoPlantel").value.trim(),
    codigo_dependencia: document.getElementById("edCodigoDependencia").value.trim() || null,
    codigo_cargo: document.getElementById("edCodigoCargo").value.trim() || null,
    tipo_personal: document.getElementById("edTipoPersonal").value || null,
    cargo: document.getElementById("edCargo").value.trim() || null,
    turno: document.getElementById("edTurno").value || null,
    horas_academicas: horasAcademicas === "" ? null : Number(horasAcademicas),
    horas_adm: horasAdm === "" ? null : Number(horasAdm),
    situacion: document.getElementById("edSituacion").value.trim() || null,
    nombres: document.getElementById("edNombres").value.trim() || null,
    apellidos: document.getElementById("edApellidos").value.trim() || null,
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
    if (cedulaCambio) {
      if (!cedulaFormulario) {
        throw new Error("Debes escribir la cédula corregida.");
      }
      const periodoEscolar = document.getElementById("edPeriodoEscolar").value.trim();
      if (!periodoEscolar) {
        throw new Error("Falta el período escolar del registro original -- no se puede recrear. Contacta soporte.");
      }
      const confirmado = confirm(
        `Vas a ELIMINAR el registro con cédula ${registroEnEdicion.cedula} y crear uno nuevo con la cédula ${cedulaFormulario}, conservando el resto de los datos. ¿Confirmas?`
      );
      if (!confirmado) {
        btn.disabled = false;
        btn.textContent = "Guardar cambios";
        return;
      }
      // 1. Se crea primero el registro nuevo -- si falla (ej. ya existe esa
      //    cédula+plantel, o el plantel no existe), el registro viejo NO se
      //    toca y no se pierde ningún dato.
      await RAC.post("/api/rac", {
        cedula: cedulaFormulario,
        periodo_escolar: periodoEscolar,
        ...camposComunes,
      });
      // 2. Solo si el alta fue exitosa, se elimina el registro viejo.
      await RAC.del(`/api/rac/${registroEnEdicion.id}`);
      mostrarToast("Cédula corregida: registro recreado correctamente.");
      cerrarEdicion();
      document.getElementById("cedulaBusqueda").value = cedulaFormulario;
      document.getElementById("formBuscar").requestSubmit();
    } else {
      await RAC.patch(`/api/rac/${registroEnEdicion.id}`, camposComunes);
      mostrarToast("Registro actualizado.");
      cerrarEdicion();
      document.getElementById("formBuscar").requestSubmit();
    }
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
const avisoNomina = document.getElementById("avisoNomina");

document.getElementById("nvCedula").addEventListener("blur", async () => {
  const cedula = document.getElementById("nvCedula").value.trim();
  if (!cedula) {
    avisoNomina.style.display = "none";
    return;
  }
  avisoNomina.style.display = "block";
  avisoNomina.style.color = "";
  avisoNomina.textContent = "Consultando nómina…";
  const resultado = await consultarNomina(cedula);
  if (resultado && resultado.existe) {
    document.getElementById("nvNombres").value = resultado.nombres || "";
    document.getElementById("nvApellidos").value = resultado.apellidos || "";
  }
  pintarAvisoNomina(avisoNomina, resultado);
});

function abrirNuevo() {
  errorModalNuevo.classList.remove("visible");
  formNuevo.reset();
  document.getElementById("nvPeriodoEscolar").value = "2025-2026";
  avisoNomina.style.display = "none";
  avisoNomina.textContent = "";
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
  const edad = document.getElementById("nvEdad").value;
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
    nombres: document.getElementById("nvNombres").value.trim() || null,
    apellidos: document.getElementById("nvApellidos").value.trim() || null,
    nivel: document.getElementById("nvNivel").value.trim() || null,
    modalidad: document.getElementById("nvModalidad").value.trim() || null,
    ubicacion_geografica: document.getElementById("nvUbicacionGeografica").value.trim() || null,
    turnos_plantel: document.getElementById("nvTurnosPlantel").value.trim() || null,
    codigo_estadistico: document.getElementById("nvCodigoEstadistico").value.trim() || null,
    fecha_ingreso: document.getElementById("nvFechaIngreso").value.trim() || null,
    sexo: document.getElementById("nvSexo").value || null,
    grado_imparte: document.getElementById("nvGradoImparte").value.trim() || null,
    seccion: document.getElementById("nvSeccion").value.trim() || null,
    especialidad: document.getElementById("nvEspecialidad").value.trim() || null,
    anio: document.getElementById("nvAnio").value.trim() || null,
    secciones: document.getElementById("nvSecciones").value.trim() || null,
    materia: document.getElementById("nvMateria").value.trim() || null,
    periodo_grupo: document.getElementById("nvPeriodoGrupo").value.trim() || null,
    edad: edad === "" ? null : Number(edad),
    comparativa: document.getElementById("nvComparativa").value.trim() || null,
    observacion: document.getElementById("nvObservacion").value.trim() || null,
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
