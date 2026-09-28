// supervision-circuitales.js — panel de administración (rol admin/supervision)
// de supervisores circuitales: crear, editar, eliminar y asignar/quitar
// planteles. Nota: el backend no expone un endpoint para LISTAR los
// planteles ya asignados a un supervisor, solo para asignar/quitar uno por
// código puntual -- por eso el panel de "Planteles" no muestra un listado
// de asignados, solo permite agregar o quitar por código.

const usuario = renderShell("supervision-circuitales", "Supervisión · Supervisores circuitales");
let supervisores = [];
let editando = null; // id en edición, o null si el formulario es "nuevo"

if (usuario) cargarPantalla();

async function cargarPantalla() {
  const contenido = document.getElementById("contenido");
  contenido.innerHTML = `<div class="cargando">Cargando supervisores circuitales…</div>`;
  try {
    const resp = await RAC.get("/api/supervision/supervisores-circuitales");
    supervisores = RAC.lista(resp, "supervisores");
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
        <h1>Supervisores circuitales</h1>
        <p>${supervisores.length} supervisores cargados</p>
      </div>
    </section>

    <div class="panel" style="padding:20px; margin-bottom:20px; display:flex; justify-content:flex-end;">
      <button type="button" class="btn" id="btnNuevo">+ Nuevo supervisor circuital</button>
    </div>

    <div class="panel" id="panelFormulario" style="padding:20px; margin-bottom:20px; display:none;"></div>
    <div class="panel" id="panelAsignar" style="padding:20px; margin-bottom:20px; display:none;"></div>

    <div class="panel" style="padding:20px;">
      ${supervisores.length ? `
        <div class="tabla-responsive">
          <table>
            <thead><tr><th>N° Circuito</th><th>Circuito</th><th>Nombres</th><th>Apellidos</th><th>Cédula</th><th>Teléfono</th><th>Correo</th><th></th></tr></thead>
            <tbody>${supervisores.map((s) => `
              <tr>
                <td>${escapar(s.num_circuito || "—")}</td>
                <td>${escapar(s.nombre_circuito || "—")}</td>
                <td>${escapar(s.nombres)}</td>
                <td>${escapar(s.apellidos)}</td>
                <td>${escapar(s.cedula)}</td>
                <td>${escapar(s.telefono || "—")}</td>
                <td>${escapar(s.correo || "—")}</td>
                <td style="white-space:nowrap; display:flex; gap:6px;">
                  <button type="button" class="btn btn-sm" data-editar="${s.id}">Editar</button>
                  <button type="button" class="btn btn-sm" data-asignar="${s.id}">Planteles</button>
                  <button type="button" class="btn btn-sm btn-peligro" data-eliminar="${s.id}">Eliminar</button>
                </td>
              </tr>`).join("")}
            </tbody>
          </table>
        </div>
      ` : `<div class="vacio"><strong>Sin supervisores circuitales cargados</strong>Usa "+ Nuevo supervisor circuital" para agregar el primero.</div>`}
    </div>
  `;

  document.getElementById("btnNuevo").addEventListener("click", () => abrirFormulario(null));
  document.querySelectorAll("[data-editar]").forEach((btn) => {
    btn.addEventListener("click", () => abrirFormulario(supervisores.find((s) => String(s.id) === btn.dataset.editar)));
  });
  document.querySelectorAll("[data-asignar]").forEach((btn) => {
    btn.addEventListener("click", () => abrirAsignar(supervisores.find((s) => String(s.id) === btn.dataset.asignar)));
  });
  document.querySelectorAll("[data-eliminar]").forEach((btn) => {
    btn.addEventListener("click", () => eliminarSupervisor(btn.dataset.eliminar));
  });
}

function abrirFormulario(supervisor) {
  editando = supervisor ? supervisor.id : null;
  document.getElementById("panelAsignar").style.display = "none";
  const s = supervisor || {};
  const panel = document.getElementById("panelFormulario");
  panel.style.display = "block";
  panel.innerHTML = `
    <h3 style="margin-bottom:14px;">${supervisor ? `Editar supervisor — ${escapar(s.nombres)} ${escapar(s.apellidos)}` : "Nuevo supervisor circuital"}</h3>
    <form id="formSupervisor" style="display:grid; grid-template-columns:repeat(2,1fr); gap:12px;">
      <div><label>N° de circuito</label><input type="text" name="num_circuito" value="${escapar(s.num_circuito)}"></div>
      <div><label>Nombre del circuito educativo</label><input type="text" name="nombre_circuito" value="${escapar(s.nombre_circuito)}"></div>
      <div><label>Nombres</label><input type="text" name="nombres" value="${escapar(s.nombres)}" required></div>
      <div><label>Apellidos</label><input type="text" name="apellidos" value="${escapar(s.apellidos)}" required></div>
      <div><label>Cédula</label><input type="text" name="cedula" value="${escapar(s.cedula)}" required></div>
      <div><label>N° de cuenta</label><input type="text" name="numero_cuenta" value="${escapar(s.numero_cuenta)}"></div>
      <div><label>Código nominal</label><input type="text" name="codigo_nominal" value="${escapar(s.codigo_nominal)}"></div>
      <div><label>Plantel de dependencia</label><input type="text" name="plantel_dependencia" value="${escapar(s.plantel_dependencia)}"></div>
      <div><label>Título de pregrado</label><input type="text" name="titulo_pregrado" value="${escapar(s.titulo_pregrado)}"></div>
      <div><label>Título pre/postgrado</label><input type="text" name="titulo_pre_pos_grado" value="${escapar(s.titulo_pre_pos_grado)}"></div>
      <div><label>Cargo nominal</label><input type="text" name="cargo_nominal" value="${escapar(s.cargo_nominal)}"></div>
      <div><label>Teléfono</label><input type="text" name="telefono" value="${escapar(s.telefono)}"></div>
      <div><label>Correo</label><input type="email" name="correo" value="${escapar(s.correo)}"></div>
      <div><label>Fecha de ingreso</label><input type="date" name="fecha_ingreso" value="${formatoFecha(s.fecha_ingreso)}"></div>
      <div style="grid-column:1/-1; display:flex; gap:10px; margin-top:6px;">
        <button type="submit" class="btn" id="btnGuardarSupervisor">Guardar</button>
        <button type="button" class="btn btn-fantasma" id="btnCancelarSupervisor">Cancelar</button>
      </div>
    </form>
  `;
  panel.querySelectorAll("label").forEach((l) => { l.style.display = "block"; l.style.fontSize = ".78rem"; l.style.marginBottom = "4px"; });
  document.getElementById("btnCancelarSupervisor").addEventListener("click", () => { panel.style.display = "none"; panel.innerHTML = ""; });
  document.getElementById("formSupervisor").addEventListener("submit", guardarSupervisor);
}

async function guardarSupervisor(e) {
  e.preventDefault();
  const boton = document.getElementById("btnGuardarSupervisor");
  const datos = Object.fromEntries(new FormData(e.target).entries());
  boton.disabled = true;
  try {
    if (editando) {
      await RAC.put(`/api/supervision/supervisores-circuitales/${editando}`, datos);
      mostrarToast("Supervisor actualizado.");
    } else {
      await RAC.post("/api/supervision/supervisores-circuitales", datos);
      mostrarToast("Supervisor creado.");
    }
    cargarPantalla();
  } catch (err) {
    mostrarToast(err.message, true);
  } finally {
    boton.disabled = false;
  }
}

async function eliminarSupervisor(id) {
  if (!confirm("¿Eliminar este supervisor circuital? Esta acción no se puede deshacer.")) return;
  try {
    await RAC.del(`/api/supervision/supervisores-circuitales/${id}`);
    mostrarToast("Supervisor eliminado.");
    cargarPantalla();
  } catch (err) {
    mostrarToast(err.message, true);
  }
}

function abrirAsignar(supervisor) {
  document.getElementById("panelFormulario").style.display = "none";
  const panel = document.getElementById("panelAsignar");
  panel.style.display = "block";
  panel.innerHTML = `
    <h3 style="margin-bottom:6px;">Planteles asignados — ${escapar(supervisor.nombres)} ${escapar(supervisor.apellidos)}</h3>
    <p style="font-size:.82rem; color:var(--muted); margin-bottom:14px;">Escribe el código del plantel para asignarlo o quitarlo de este supervisor.</p>
    <div style="display:flex; gap:24px; flex-wrap:wrap;">
      <form id="formAsignar" style="display:flex; gap:8px; align-items:flex-end;">
        <div><label style="display:block; font-size:.78rem; margin-bottom:4px;">Código de plantel a asignar</label><input type="text" id="inputAsignarCodigo" required></div>
        <button type="submit" class="btn">Asignar</button>
      </form>
      <form id="formQuitar" style="display:flex; gap:8px; align-items:flex-end;">
        <div><label style="display:block; font-size:.78rem; margin-bottom:4px;">Código de plantel a quitar</label><input type="text" id="inputQuitarCodigo" required></div>
        <button type="submit" class="btn btn-fantasma">Quitar</button>
      </form>
    </div>
    <button type="button" class="btn btn-fantasma" id="btnCerrarAsignar" style="margin-top:14px;">Cerrar</button>
  `;
  document.getElementById("btnCerrarAsignar").addEventListener("click", () => { panel.style.display = "none"; panel.innerHTML = ""; });
  document.getElementById("formAsignar").addEventListener("submit", async (e) => {
    e.preventDefault();
    const codigo_plantel = document.getElementById("inputAsignarCodigo").value.trim();
    try {
      await RAC.post(`/api/supervision/supervisores-circuitales/${supervisor.id}/planteles`, { codigo_plantel });
      mostrarToast("Plantel asignado.");
      e.target.reset();
    } catch (err) {
      mostrarToast(err.message, true);
    }
  });
  document.getElementById("formQuitar").addEventListener("submit", async (e) => {
    e.preventDefault();
    const codigo = document.getElementById("inputQuitarCodigo").value.trim();
    try {
      await RAC.del(`/api/supervision/supervisores-circuitales/${supervisor.id}/planteles/${encodeURIComponent(codigo)}`);
      mostrarToast("Plantel quitado.");
      e.target.reset();
    } catch (err) {
      mostrarToast(err.message, true);
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
