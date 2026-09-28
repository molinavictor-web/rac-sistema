// supervision-directores.js — panel de administración (rol admin/supervision)
// de directores: crear, editar y crear/resetear su cuenta de acceso web
// (la que usan luego en /supervision/mi-plantel.html).

const usuario = renderShell("supervision-directores", "Supervisión · Directores");
let directores = [];
let editando = null; // codigo_plantel en edición, o null si el formulario es "nuevo"

if (usuario) cargarPantalla();

async function cargarPantalla() {
  const contenido = document.getElementById("contenido");
  contenido.innerHTML = `<div class="cargando">Cargando directores…</div>`;
  try {
    const resp = await RAC.get("/api/supervision/directores");
    directores = RAC.lista(resp, "directores");
    dibujarPantalla();
  } catch (err) {
    contenido.innerHTML = `<div class="panel" style="padding:20px;"><div class="vacio"><strong>No se pudo cargar</strong>${escapar(err.message)}</div></div>`;
  }
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

    <div class="panel" style="padding:20px; margin-bottom:20px; display:flex; justify-content:flex-end;">
      <button type="button" class="btn" id="btnNuevo">+ Nuevo director</button>
    </div>

    <div class="panel" id="panelFormulario" style="padding:20px; margin-bottom:20px; display:none;"></div>
    <div class="panel" id="panelAcceso" style="padding:20px; margin-bottom:20px; display:none;"></div>

    <div class="panel" style="padding:20px;">
      ${directores.length ? `
        <div class="tabla-responsive">
          <table>
            <thead><tr><th>Código plantel</th><th>Nombre</th><th>Cédula</th><th>Teléfono</th><th>Correo</th><th>Acceso web</th><th></th></tr></thead>
            <tbody>${directores.map((d) => `
              <tr>
                <td>${escapar(d.codigo_plantel)}</td>
                <td>${escapar(d.nombre)}</td>
                <td>${escapar(d.cedula)}</td>
                <td>${escapar(d.telefono || "—")}</td>
                <td>${escapar(d.correo || "—")}</td>
                <td>${d.usuario_email ? escapar(d.usuario_email) : `<span class="vacio-inline">Sin acceso</span>`}</td>
                <td style="white-space:nowrap; display:flex; gap:6px;">
                  <button type="button" class="btn btn-sm" data-editar="${escapar(d.codigo_plantel)}">Editar</button>
                  <button type="button" class="btn btn-sm" data-acceso="${escapar(d.codigo_plantel)}">${d.usuario_email ? "Resetear acceso" : "Crear acceso"}</button>
                </td>
              </tr>`).join("")}
            </tbody>
          </table>
        </div>
      ` : `<div class="vacio"><strong>Sin directores cargados</strong>Usa "+ Nuevo director" para agregar el primero.</div>`}
    </div>
  `;

  document.getElementById("btnNuevo").addEventListener("click", () => abrirFormulario(null));
  document.querySelectorAll("[data-editar]").forEach((btn) => {
    btn.addEventListener("click", () => abrirFormulario(directores.find((d) => d.codigo_plantel === btn.dataset.editar)));
  });
  document.querySelectorAll("[data-acceso]").forEach((btn) => {
    btn.addEventListener("click", () => abrirAcceso(directores.find((d) => d.codigo_plantel === btn.dataset.acceso)));
  });
}

function abrirFormulario(director) {
  editando = director ? director.codigo_plantel : null;
  document.getElementById("panelAcceso").style.display = "none";
  const d = director || {};
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
}

function formatoFecha(valor) {
  if (!valor) return "";
  return String(valor).slice(0, 10);
}

function escapar(valor) {
  if (valor === undefined || valor === null) return "";
  return String(valor).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
