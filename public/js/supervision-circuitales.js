// supervision-circuitales.js — panel de administración (rol admin/supervision)
// de supervisores circuitales: crear, editar, eliminar y asignar/quitar
// planteles. Nota: el backend no expone un endpoint para LISTAR los
// planteles ya asignados a un supervisor, solo para asignar/quitar uno por
// código puntual -- por eso el panel de "Planteles" no muestra un listado
// de asignados, solo permite agregar o quitar por código. Al escribir un
// código se muestra una vista previa del plantel (nombre, municipio,
// parroquia y circuito) usando GET /api/supervision/plantel-info.
//
// El N° y el nombre del circuito de cada supervisor los calcula el backend a
// partir de los planteles que tiene asignados (si cubre 2 circuitos salen
// separados por coma).

const usuario = renderShell("supervision-circuitales", "Supervisión · Supervisores circuitales");
let supervisores = [];
let editando = null; // id en edición, o null si el formulario es "nuevo"
let busqueda = "";

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

    <div class="panel" style="padding:20px; margin-bottom:20px; display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap;">
      <input type="search" id="inputBuscar" placeholder="Buscar por circuito, nombre, apellido, cédula, teléfono o correo…"
        value="${escapar(busqueda)}" style="flex:1; min-width:240px;">
      <button type="button" class="btn" id="btnNuevo">+ Nuevo supervisor circuital</button>
    </div>

    <div class="panel" id="panelFormulario" style="padding:20px; margin-bottom:20px; display:none;"></div>
    <div class="panel" id="panelAsignar" style="padding:20px; margin-bottom:20px; display:none;"></div>

    <div class="panel" style="padding:20px;" id="panelTabla"></div>
  `;

  document.getElementById("btnNuevo").addEventListener("click", () => abrirFormulario(null));
  document.getElementById("inputBuscar").addEventListener("input", (e) => {
    busqueda = e.target.value;
    pintarTabla();
  });
  pintarTabla();
}

function pintarTabla() {
  const q = normalizar(busqueda);
  const filas = supervisores.filter((s) => {
    if (!q) return true;
    const texto = [s.num_circuito, s.nombre_circuito, s.nombres, s.apellidos, s.cedula, s.telefono, s.correo].join(" ");
    return normalizar(texto).includes(q);
  });

  const panel = document.getElementById("panelTabla");
  if (!supervisores.length) {
    panel.innerHTML = `<div class="vacio"><strong>Sin supervisores circuitales cargados</strong>Usa "+ Nuevo supervisor circuital" para agregar el primero.</div>`;
    return;
  }
  if (!filas.length) {
    panel.innerHTML = `<div class="vacio"><strong>Sin resultados</strong>Prueba con otra búsqueda.</div>`;
    return;
  }

  panel.innerHTML = `
    <div style="font-size:.82rem; color:var(--muted); margin-bottom:8px;">${filas.length} de ${supervisores.length} supervisores</div>
    <div class="tabla-responsive">
      <table>
        <thead><tr><th>N° Circuito</th><th>Circuito</th><th>Nombres</th><th>Apellidos</th><th>Cédula</th><th>Teléfono</th><th>Correo</th><th></th></tr></thead>
        <tbody>${filas.map((s) => `
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
  `;

  panel.querySelectorAll("[data-editar]").forEach((btn) => {
    btn.addEventListener("click", () => abrirFormulario(supervisores.find((s) => String(s.id) === btn.dataset.editar)));
  });
  panel.querySelectorAll("[data-asignar]").forEach((btn) => {
    btn.addEventListener("click", () => abrirAsignar(supervisores.find((s) => String(s.id) === btn.dataset.asignar)));
  });
  panel.querySelectorAll("[data-eliminar]").forEach((btn) => {
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
  if (panel.scrollIntoView) panel.scrollIntoView({ behavior: "smooth", block: "start" });
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
  const circuito = supervisor.nombre_circuito
    ? ` · Circuito ${escapar(supervisor.nombre_circuito)}${supervisor.num_circuito ? ` (${escapar(supervisor.num_circuito)})` : ""}`
    : "";
  panel.innerHTML = `
    <h3 style="margin-bottom:6px;">Planteles asignados — ${escapar(supervisor.nombres)} ${escapar(supervisor.apellidos)}${circuito}</h3>
    <p style="font-size:.82rem; color:var(--muted); margin-bottom:14px;">Escribe el código del plantel para asignarlo o quitarlo de este supervisor. Al escribirlo se muestra el plantel al que corresponde y su circuito.</p>
    <div style="display:flex; gap:24px; flex-wrap:wrap;">
      <div style="min-width:280px; flex:1;">
        <form id="formAsignar" style="display:flex; gap:8px; align-items:flex-end;">
          <div><label style="display:block; font-size:.78rem; margin-bottom:4px;">Código de plantel a asignar</label><input type="text" id="inputAsignarCodigo" required autocomplete="off"></div>
          <button type="submit" class="btn">Asignar</button>
        </form>
        <div id="previaAsignar" style="margin-top:8px; font-size:.85rem;"></div>
      </div>
      <div style="min-width:280px; flex:1;">
        <form id="formQuitar" style="display:flex; gap:8px; align-items:flex-end;">
          <div><label style="display:block; font-size:.78rem; margin-bottom:4px;">Código de plantel a quitar</label><input type="text" id="inputQuitarCodigo" required autocomplete="off"></div>
          <button type="submit" class="btn btn-fantasma">Quitar</button>
        </form>
        <div id="previaQuitar" style="margin-top:8px; font-size:.85rem;"></div>
      </div>
    </div>
    <button type="button" class="btn btn-fantasma" id="btnCerrarAsignar" style="margin-top:14px;">Cerrar</button>
  `;
  document.getElementById("btnCerrarAsignar").addEventListener("click", () => { panel.style.display = "none"; panel.innerHTML = ""; });

  // Vista previa del plantel al escribir el código (avisa si es de otro circuito).
  const circuitosDelSupervisor = String(supervisor.num_circuito || "")
    .split(",").map((c) => c.trim()).filter(Boolean);
  activarVistaPrevia("inputAsignarCodigo", "previaAsignar", circuitosDelSupervisor);
  activarVistaPrevia("inputQuitarCodigo", "previaQuitar", []);

  document.getElementById("formAsignar").addEventListener("submit", async (e) => {
    e.preventDefault();
    const codigo_plantel = document.getElementById("inputAsignarCodigo").value.trim();
    try {
      await RAC.post(`/api/supervision/supervisores-circuitales/${supervisor.id}/planteles`, { codigo_plantel });
      mostrarToast("Plantel asignado.");
      e.target.reset();
      document.getElementById("previaAsignar").innerHTML = "";
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
      document.getElementById("previaQuitar").innerHTML = "";
    } catch (err) {
      mostrarToast(err.message, true);
    }
  });
}

// Al escribir en `inputId`, consulta el/los plantel(es) y pinta en `previaId`
// su nombre, municipio, parroquia y circuito. Si `circuitosSupervisor` trae
// códigos, avisa (sin bloquear) cuando el plantel pertenece a otro circuito.
function activarVistaPrevia(inputId, previaId, circuitosSupervisor) {
  const input = document.getElementById(inputId);
  const previa = document.getElementById(previaId);
  let temporizador = null;
  let turno = 0;
  input.addEventListener("input", () => {
    clearTimeout(temporizador);
    const valor = input.value.trim();
    if (!valor) {
      previa.innerHTML = "";
      return;
    }
    temporizador = setTimeout(async () => {
      const miTurno = ++turno;
      try {
        const resp = await RAC.get(`/api/supervision/plantel-info?codigos=${encodeURIComponent(valor)}`);
        if (miTurno !== turno) return; // llegó tarde, ya se escribió otra cosa
        const lineas = (resp.planteles || []).map((p) => {
          const otroCircuito = circuitosSupervisor.length && p.nro_circuito
            && !circuitosSupervisor.includes(p.nro_circuito);
          const textoCircuito = p.nombre_circuito
            ? `Circuito ${escapar(p.nombre_circuito)} (${escapar(p.nro_circuito)})`
            : "sin circuito";
          return `
            <div style="padding:6px 0;">
              <strong>${escapar(p.eponimo_actual)}</strong>
              <span style="color:var(--muted);"> — Municipio ${escapar(p.municipio || "sin municipio")} · Parroquia ${escapar(p.parroquia || "sin parroquia")} · ${textoCircuito}</span>
              ${otroCircuito ? `<div style="color:#b7791f;">⚠ Este plantel pertenece al circuito ${escapar(p.nombre_circuito)}, distinto al de este supervisor.</div>` : ""}
            </div>`;
        });
        const faltan = (resp.no_encontrados || []).map((c) =>
          `<div style="padding:6px 0; color:#c53030;">⚠ No existe el código ${escapar(c)} en Supervisión.</div>`);
        previa.innerHTML = lineas.join("") + faltan.join("");
      } catch (err) {
        if (miTurno === turno) previa.innerHTML = "";
      }
    }, 350);
  });
}

function normalizar(valor) {
  return String(valor === undefined || valor === null ? "" : valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function formatoFecha(valor) {
  if (!valor) return "";
  return String(valor).slice(0, 10);
}

function escapar(valor) {
  if (valor === undefined || valor === null) return "";
  return String(valor).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
