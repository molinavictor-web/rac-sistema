// supervision-directores.js — panel de administración (rol admin/supervision)
// de directores: buscar, crear, editar y crear/resetear/eliminar su cuenta de
// acceso web (la que usan luego en /supervision/mi-plantel.html).
//
// Si se abre con ?nuevo=CODIGO (enlace "+ Director" de la pantalla Planteles),
// el formulario de nuevo director sale ya abierto con ese código de plantel.

const usuario = renderShell("supervision-directores", "Supervisión · Directores");
let directores = [];
let editando = null; // codigo_plantel en edición, o null si el formulario es "nuevo"
let textoBusqueda = ""; // se conserva al recargar la pantalla
let soloSinAcceso = false;
let formularioPreabierto = false; // ?nuevo=CODIGO se atiende una sola vez

// Lista larga con scroll interno y encabezado fijo.
(function () {
  if (document.getElementById("estiloListaScroll")) return;
  const st = document.createElement("style");
  st.id = "estiloListaScroll";
  st.textContent = ".lista-scroll{max-height:65vh;overflow:auto;}"
    + ".lista-scroll thead th{position:sticky;top:0;z-index:2;background:#eef3f9;box-shadow:0 1px 0 #d9e1ec;}";
  document.head.appendChild(st);
})();

if (usuario) cargarPantalla();

async function cargarPantalla() {
  const contenido = document.getElementById("contenido");
  contenido.innerHTML = `<div class="cargando">Cargando directores…</div>`;
  try {
    const resp = await RAC.get("/api/supervision/directores");
    directores = RAC.lista(resp, "directores");
    dibujarPantalla();
    const codigoNuevo = new URLSearchParams(window.location.search).get("nuevo");
    if (codigoNuevo && !formularioPreabierto) {
      formularioPreabierto = true;
      abrirFormulario(null, codigoNuevo.trim());
    }
  } catch (err) {
    contenido.innerHTML = `<div class="panel" style="padding:20px;"><div class="vacio"><strong>No se pudo cargar</strong>${escapar(err.message)}</div></div>`;
  }
}

// Minúsculas y sin tildes, para que "perez" encuentre "PÉREZ".
function normalizar(valor) {
  return String(valor === undefined || valor === null ? "" : valor)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function directoresFiltrados() {
  const q = normalizar(textoBusqueda);
  return directores.filter((d) => {
    if (soloSinAcceso && d.usuario_email) return false;
    if (!q) return true;
    const texto = normalizar([
      d.codigo_plantel, d.nombre, d.cedula, d.telefono, d.correo,
      d.usuario_email, d.dependencia, d.cargo_nominal,
    ].join(" "));
    return q.split(/\s+/).every((palabra) => texto.includes(palabra));
  });
}

function dibujarPantalla() {
  const contenido = document.getElementById("contenido");
  contenido.innerHTML = `
    <section class="planteles-hero">
      <div class="planteles-hero-copy">
        <span class="planteles-eyebrow">SUPERVISIÓN</span>
        <h1>Directores</h1>
        <p>${directores.length} directores cargados</p>
      </div>
    </section>

    <div class="panel" style="padding:20px; margin-bottom:20px; display:flex; gap:14px; flex-wrap:wrap; align-items:center; justify-content:space-between;">
      <div style="display:flex; gap:14px; flex-wrap:wrap; align-items:center; flex:1; min-width:260px;">
        <input type="search" id="inputBuscar" placeholder="Buscar por nombre, cédula, código de plantel, teléfono o correo…" value="${escapar(textoBusqueda)}" style="flex:1; min-width:240px;">
        <label style="display:flex; gap:6px; align-items:center; font-size:.82rem; white-space:nowrap;">
          <input type="checkbox" id="chkSinAcceso" ${soloSinAcceso ? "checked" : ""}> Solo sin acceso web
        </label>
        <button type="button" class="btn btn-fantasma btn-sm" id="btnLimpiarBusqueda">Limpiar</button>
      </div>
      <button type="button" class="btn" id="btnNuevo">+ Nuevo director</button>
    </div>

    <div class="panel" id="panelFormulario" style="padding:20px; margin-bottom:20px; display:none;"></div>
    <div class="panel" id="panelAcceso" style="padding:20px; margin-bottom:20px; display:none;"></div>

    <div class="panel" style="padding:20px;">
      <div id="resumenBusqueda" style="font-size:.8rem; color:var(--muted); margin-bottom:10px;"></div>
      <div id="tablaDirectores"></div>
    </div>
  `;

  document.getElementById("btnNuevo").addEventListener("click", () => abrirFormulario(null));

  const inputBuscar = document.getElementById("inputBuscar");
  inputBuscar.addEventListener("input", () => { textoBusqueda = inputBuscar.value; dibujarTabla(); });
  document.getElementById("chkSinAcceso").addEventListener("change", (e) => { soloSinAcceso = e.target.checked; dibujarTabla(); });
  document.getElementById("btnLimpiarBusqueda").addEventListener("click", () => {
    textoBusqueda = "";
    soloSinAcceso = false;
    inputBuscar.value = "";
    document.getElementById("chkSinAcceso").checked = false;
    dibujarTabla();
    inputBuscar.focus();
  });

  dibujarTabla();
}

// Solo redibuja la tabla (no el campo de búsqueda), para no perder el foco al escribir.
function dibujarTabla() {
  const lista = directoresFiltrados();
  const hayFiltro = normalizar(textoBusqueda) !== "" || soloSinAcceso;
  document.getElementById("resumenBusqueda").textContent = hayFiltro
    ? `Mostrando ${lista.length} de ${directores.length} directores`
    : "";

  const cont = document.getElementById("tablaDirectores");
  if (!directores.length) {
    cont.innerHTML = `<div class="vacio"><strong>Sin directores cargados</strong>Usa "+ Nuevo director" para agregar el primero.</div>`;
    return;
  }
  if (!lista.length) {
    cont.innerHTML = `<div class="vacio"><strong>Sin resultados</strong>Ningún director coincide con la búsqueda.</div>`;
    return;
  }

  cont.innerHTML = `
    <div class="tabla-responsive lista-scroll">
      <table>
        <thead><tr><th>Código plantel</th><th>Nombre</th><th>Cédula</th><th>Teléfono</th><th>Correo</th><th>Acceso web</th><th></th></tr></thead>
        <tbody>${lista.map((d) => `
          <tr>
            <td>${escapar(d.codigo_plantel)}</td>
            <td>${escapar(d.nombre)}</td>
            <td>${escapar(d.cedula)}</td>
            <td>${escapar(d.telefono || "—")}</td>
            <td>${escapar(d.correo || "—")}</td>
            <td>${d.usuario_email ? escapar(d.usuario_email) : `<span class="vacio-inline">Sin acceso</span>`}</td>
            <td><div style="display:flex; gap:6px; white-space:nowrap;">
              <button type="button" class="btn btn-sm" data-editar="${escapar(d.codigo_plantel)}">Editar</button>
              <button type="button" class="btn btn-sm" data-acceso="${escapar(d.codigo_plantel)}">${d.usuario_email ? "Resetear acceso" : "Crear acceso"}</button>
              ${d.usuario_email ? `<button type="button" class="btn btn-sm btn-peligro" data-quitar-acceso="${escapar(d.codigo_plantel)}">Eliminar acceso</button>` : ""}
            </div></td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;

  cont.querySelectorAll("[data-editar]").forEach((btn) => {
    btn.addEventListener("click", () => abrirFormulario(directores.find((d) => d.codigo_plantel === btn.dataset.editar)));
  });
  cont.querySelectorAll("[data-acceso]").forEach((btn) => {
    btn.addEventListener("click", () => abrirAcceso(directores.find((d) => d.codigo_plantel === btn.dataset.acceso)));
  });
  cont.querySelectorAll("[data-quitar-acceso]").forEach((btn) => {
    btn.addEventListener("click", () => quitarAcceso(directores.find((d) => d.codigo_plantel === btn.dataset.quitarAcceso)));
  });
}

function abrirFormulario(director, codigoPrecargado) {
  editando = director ? director.codigo_plantel : null;
  document.getElementById("panelAcceso").style.display = "none";
  const d = director || {};
  if (!director && codigoPrecargado) d.codigo_plantel = codigoPrecargado;
  const panel = document.getElementById("panelFormulario");
  panel.style.display = "block";
  panel.innerHTML = `
    <h3 style="margin-bottom:14px;">${director ? `Editar director — ${escapar(d.nombre)}` : "Nuevo director"}</h3>
    <form id="formDirector" style="display:grid; grid-template-columns:repeat(2,1fr); gap:12px;">
      <div><label>Código de plantel</label><input type="text" name="codigo_plantel" value="${escapar(d.codigo_plantel)}" ${director ? "readonly" : "required"}></div>
      <div><label>Nombre y apellido</label><input type="text" name="nombre" value="${escapar(d.nombre)}" required></div>
      <div><label>Cédula</label><input type="text" name="cedula" value="${escapar(d.cedula)}" required></div>
      <div><label>Teléfono</label><input type="text" name="telefono" value="${escapar(d.telefono)}"></div>
      <div><label>Correo</label><input type="email" name="correo" value="${escapar(d.correo)}"></div>
      <div><label>Dependencia</label><input type="text" name="dependencia" value="${escapar(d.dependencia)}"></div>
      <div><label>Cargo nominal</label><input type="text" name="cargo_nominal" value="${escapar(d.cargo_nominal)}"></div>
      <div><label>Plantel por donde cobra</label><input type="text" name="plantel_cobro" value="${escapar(d.plantel_cobro)}"></div>
      <div><label>Título de pregrado</label><input type="text" name="titulo_pregrado" value="${escapar(d.titulo_pregrado)}"></div>
      <div><label>N° de cuenta</label><input type="text" name="numero_cuenta" value="${escapar(d.numero_cuenta)}"></div>
      <div style="grid-column:1/-1;"><label>Dirección de habitación</label><input type="text" name="direccion_habitacion" value="${escapar(d.direccion_habitacion)}"></div>
      <div><label>Fecha de título</label><input type="date" name="titulo_fecha_grado" value="${formatoFecha(d.titulo_fecha_grado)}"></div>
      <div><label>Fecha de ingreso</label><input type="date" name="fecha_ingreso" value="${formatoFecha(d.fecha_ingreso)}"></div>
      <div style="grid-column:1/-1;"><label>Formación UNEM</label><input type="text" name="formacion_unem" value="${escapar(d.formacion_unem)}"></div>
      <div style="grid-column:1/-1; display:flex; gap:10px; margin-top:6px;">
        <button type="submit" class="btn" id="btnGuardarDirector">Guardar</button>
        <button type="button" class="btn btn-fantasma" id="btnCancelarDirector">Cancelar</button>
      </div>
    </form>
  `;
  panel.querySelectorAll("label").forEach((l) => { l.style.display = "block"; l.style.fontSize = ".78rem"; l.style.marginBottom = "4px"; });
  document.getElementById("btnCancelarDirector").addEventListener("click", () => { panel.style.display = "none"; panel.innerHTML = ""; });
  document.getElementById("formDirector").addEventListener("submit", guardarDirector);
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function guardarDirector(e) {
  e.preventDefault();
  const boton = document.getElementById("btnGuardarDirector");
  const datos = Object.fromEntries(new FormData(e.target).entries());
  boton.disabled = true;
  try {
    if (editando) {
      await RAC.put(`/api/supervision/directores/${encodeURIComponent(editando)}`, datos);
      mostrarToast("Director actualizado.");
    } else {
      await RAC.post("/api/supervision/directores", datos);
      mostrarToast("Director creado.");
    }
    cargarPantalla();
  } catch (err) {
    mostrarToast(err.message, true);
  } finally {
    boton.disabled = false;
  }
}

function abrirAcceso(director) {
  document.getElementById("panelFormulario").style.display = "none";
  const panel = document.getElementById("panelAcceso");
  panel.style.display = "block";
  panel.innerHTML = `
    <h3 style="margin-bottom:6px;">${director.usuario_email ? "Resetear acceso web" : "Crear acceso web"} — ${escapar(director.nombre)}</h3>
    <p style="font-size:.82rem; color:var(--muted); margin-bottom:14px;">
      ${director.usuario_email
        ? `Ya tiene una cuenta (${escapar(director.usuario_email)}). Al guardar se reemplazan el correo y la contraseña.`
        : `Este director aún no tiene cuenta para entrar por /supervision/login.html.`}
    </p>
    <form id="formAcceso" style="display:flex; gap:12px; flex-wrap:wrap; align-items:flex-end;">
      <div>
        <label style="display:block; font-size:.78rem; margin-bottom:4px;">Correo de acceso</label>
        <input type="email" id="inputAccesoCorreo" value="${escapar(director.correo || "")}" required>
      </div>
      <div>
        <label style="display:block; font-size:.78rem; margin-bottom:4px;">Contraseña (mín. 8 caracteres)</label>
        <input type="password" id="inputAccesoPassword" minlength="8" required>
      </div>
      <button type="submit" class="btn" id="btnGuardarAcceso">Guardar</button>
      <button type="button" class="btn btn-fantasma" id="btnCancelarAcceso">Cancelar</button>
    </form>
  `;
  document.getElementById("btnCancelarAcceso").addEventListener("click", () => { panel.style.display = "none"; panel.innerHTML = ""; });
  document.getElementById("formAcceso").addEventListener("submit", async (e) => {
    e.preventDefault();
    const boton = document.getElementById("btnGuardarAcceso");
    const email = document.getElementById("inputAccesoCorreo").value.trim();
    const password = document.getElementById("inputAccesoPassword").value;
    boton.disabled = true;
    try {
      await RAC.post(`/api/supervision/directores/${encodeURIComponent(director.codigo_plantel)}/usuario`, { email, password });
      mostrarToast("Acceso guardado.");
      panel.style.display = "none";
      panel.innerHTML = "";
      cargarPantalla();
    } catch (err) {
      mostrarToast(err.message, true);
    } finally {
      boton.disabled = false;
    }
  });
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

// Elimina la cuenta de acceso web del director. El director y la matrícula que
// ya cargó se conservan; se le puede dar acceso otra vez con "Crear acceso".
async function quitarAcceso(director) {
  if (!director || !director.usuario_email) return;
  const confirmado = confirm(
    `¿Eliminar el acceso web de ${director.nombre}?\n\n` +
    `Cuenta: ${director.usuario_email}\n\n` +
    `Ya no podrá entrar al sistema ni cargar la matrícula. El director y la matrícula que ya cargó se conservan, ` +
    `y podrás darle acceso otra vez con "Crear acceso".`
  );
  if (!confirmado) return;
  try {
    const resp = await RAC.del(`/api/supervision/directores/${encodeURIComponent(director.codigo_plantel)}/usuario`);
    mostrarToast(resp && resp.modo === "desactivado"
      ? "Acceso eliminado: la cuenta quedó desactivada porque ya tiene datos asociados."
      : "Acceso web eliminado.");
    const panelAcceso = document.getElementById("panelAcceso");
    if (panelAcceso) { panelAcceso.style.display = "none"; panelAcceso.innerHTML = ""; }
    cargarPantalla();
  } catch (err) {
    mostrarToast(err.message, true);
  }
}

function formatoFecha(valor) {
  if (!valor) return "";
  return String(valor).slice(0, 10);
}

function escapar(valor) {
  if (valor === undefined || valor === null) return "";
  return String(valor).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
