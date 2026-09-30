// supervision-municipales.js — panel de administración (rol admin/supervision)
// de supervisores municipales: crear, editar, eliminar y asignar/quitar
// planteles. Nota: el backend no expone un endpoint para LISTAR los
// planteles ya asignados a un supervisor, solo para asignar/quitar uno por
// código puntual -- por eso el panel de "Planteles" no muestra un listado
// de asignados, solo permite agregar o quitar por código. Al escribir un
// código se muestra una vista previa del plantel (nombre, municipio y
// parroquia) usando GET /api/supervision/plantel-info.
//
// La tabla lista los municipios del estado ENUMERADOS (GET /municipios): el
// que todavía no tiene supervisor aparece en blanco con un botón para
// cargarlo. Si ese endpoint no responde, se cae a la lista simple de
// supervisores para que la pantalla siga funcionando.

const usuario = renderShell("supervision-municipales", "Supervisión · Supervisores municipales");
let supervisores = [];
let municipios = null; // lista enumerada de /municipios, o null si no está disponible
let editando = null; // id en edición, o null si el formulario es "nuevo"
let busqueda = "";

if (usuario) cargarPantalla();

async function cargarPantalla() {
  const contenido = document.getElementById("contenido");
  contenido.innerHTML = `<div class="cargando">Cargando supervisores municipales…</div>`;
  try {
    const resp = await RAC.get("/api/supervision/supervisores-municipales");
    supervisores = RAC.lista(resp, "supervisores");
    municipios = null;
    try {
      const respMun = await RAC.get("/api/supervision/municipios");
      municipios = Array.isArray(respMun.municipios) ? respMun.municipios : null;
    } catch (errMun) {
      municipios = null;
    }
    dibujarPantalla();
  } catch (err) {
    contenido.innerHTML = `<div class="panel" style="padding:20px;"><div class="vacio"><strong>No se pudo cargar</strong>${escapar(err.message)}</div></div>`;
  }
}

// Filas de la tabla: los municipios enumerados (con o sin supervisor) y,
// al final, cualquier supervisor cuyo municipio no coincida con la lista.
function construirFilas() {
  if (!municipios) {
    return supervisores.map((s, i) => ({ numero: i + 1, municipio: s.municipio, supervisor: s }));
  }
  const usados = new Set();
  const filas = municipios.map((m) => {
    const s = m.supervisor_id !== null && m.supervisor_id !== undefined
      ? supervisores.find((x) => String(x.id) === String(m.supervisor_id))
      : null;
    if (s) usados.add(s.id);
    return { numero: m.numero, municipio: m.municipio, supervisor: s || null };
  });
  supervisores.filter((s) => !usados.has(s.id)).forEach((s) => {
    filas.push({ numero: "•", municipio: s.municipio, supervisor: s });
  });
  return filas;
}

function dibujarPantalla() {
  const contenido = document.getElementById("contenido");
  const textoHero = municipios
    ? `${municipios.filter((m) => m.supervisor_id !== null && m.supervisor_id !== undefined).length} de ${municipios.length} municipios con supervisor`
    : `${supervisores.length} supervisores cargados`;
  contenido.innerHTML = `
    <section class="planteles-hero">
      <div class="planteles-hero-copy">
        <span class="planteles-eyebrow">SUPERVISIÓN</span>
        <h1>Supervisores municipales</h1>
        <p>${textoHero}</p>
      </div>
    </section>

    <div class="panel" style="padding:20px; margin-bottom:20px; display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap;">
      <input type="search" id="inputBuscar" placeholder="Buscar por municipio, nombre, cédula, teléfono, correo o parroquia…"
        value="${escapar(busqueda)}" style="flex:1; min-width:240px;">
      <button type="button" class="btn" id="btnNuevo">+ Nuevo supervisor municipal</button>
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
  const todas = construirFilas();
  const filas = todas.filter((f) => {
    if (!q) return true;
    const s = f.supervisor;
    const texto = [
      f.numero, f.municipio,
      s ? s.nombre : "sin supervisor",
      s && s.cedula, s && s.telefono, s && s.correo, s && s.parroquia,
    ].join(" ");
    return normalizar(texto).includes(q);
  });

  const panel = document.getElementById("panelTabla");
  if (!todas.length) {
    panel.innerHTML = `<div class="vacio"><strong>Sin supervisores municipales cargados</strong>Usa "+ Nuevo supervisor municipal" para agregar el primero.</div>`;
    return;
  }
  if (!filas.length) {
    panel.innerHTML = `<div class="vacio"><strong>Sin resultados</strong>Prueba con otra búsqueda.</div>`;
    return;
  }

  panel.innerHTML = `
    <div style="font-size:.82rem; color:var(--muted); margin-bottom:8px;">${filas.length} de ${todas.length} filas</div>
    <div class="tabla-responsive">
      <table>
        <thead><tr><th>N°</th><th>Municipio</th><th>Nombre</th><th>Cédula</th><th>Teléfono</th><th>Correo</th><th>Parroquia</th><th></th></tr></thead>
        <tbody>${filas.map((f) => {
          const s = f.supervisor;
          if (!s) {
            return `
              <tr style="background:rgba(183,121,31,.08);">
                <td>${escapar(f.numero)}</td>
                <td>${escapar(f.municipio)}</td>
                <td colspan="5" style="color:#b7791f; font-weight:600;">Sin supervisor cargado — falta cargar el supervisor de este municipio</td>
                <td style="white-space:nowrap;">
                  <button type="button" class="btn btn-sm" data-nuevo-municipio="${escapar(f.municipio)}">+ Cargar supervisor</button>
                </td>
              </tr>`;
        }
          return `
              <tr>
                <td>${escapar(f.numero)}</td>
                <td>${escapar(s.municipio)}</td>
                <td>${escapar(s.nombre)}</td>
                <td>${escapar(s.cedula)}</td>
                <td>${escapar(s.telefono || "—")}</td>
                <td>${escapar(s.correo || "—")}</td>
                <td>${escapar(s.parroquia || "—")}</td>
                <td style="white-space:nowrap; display:flex; gap:6px;">
                  <button type="button" class="btn btn-sm" data-editar="${s.id}">Editar</button>
                  <button type="button" class="btn btn-sm" data-asignar="${s.id}">Planteles</button>
                  <button type="button" class="btn btn-sm btn-peligro" data-eliminar="${s.id}">Eliminar</button>
                </td>
              </tr>`;
        }).join("")}
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
  panel.querySelectorAll("[data-nuevo-municipio]").forEach((btn) => {
    btn.addEventListener("click", () => {
      // Formulario "nuevo" con el municipio (y el estado) ya escritos.
      const estado = (supervisores[0] && supervisores[0].estado) || "";
      abrirFormulario(null, { municipio: btn.dataset.nuevoMunicipio, estado });
    });
  });
}

function abrirFormulario(supervisor, valoresIniciales) {
  editando = supervisor ? supervisor.id : null;
  document.getElementById("panelAsignar").style.display = "none";
  const s = supervisor || valoresIniciales || {};
  const panel = document.getElementById("panelFormulario");
  panel.style.display = "block";
  panel.innerHTML = `
    <h3 style="margin-bottom:14px;">${supervisor ? `Editar supervisor — ${escapar(s.nombre)}` : "Nuevo supervisor municipal"}</h3>
    <form id="formSupervisor" style="display:grid; grid-template-columns:repeat(2,1fr); gap:12px;">
      <div><label>Estado</label><input type="text" name="estado" value="${escapar(s.estado)}"></div>
      <div><label>Municipio</label><input type="text" name="municipio" value="${escapar(s.municipio)}" required></div>
      <div><label>Nombre y apellido</label><input type="text" name="nombre" value="${escapar(s.nombre)}" required></div>
      <div><label>Cédula</label><input type="text" name="cedula" value="${escapar(s.cedula)}" required></div>
      <div><label>Teléfono</label><input type="text" name="telefono" value="${escapar(s.telefono)}"></div>
      <div><label>Correo</label><input type="email" name="correo" value="${escapar(s.correo)}"></div>
      <div><label>Parroquia</label><input type="text" name="parroquia" value="${escapar(s.parroquia)}"></div>
      <div><label>N° de cuenta</label><input type="text" name="nro_cuenta" value="${escapar(s.nro_cuenta)}"></div>
      <div><label>Fecha de ingreso</label><input type="date" name="fecha_ingreso" value="${formatoFecha(s.fecha_ingreso)}"></div>
      <div><label>Código de dependencia</label><input type="text" name="cod_dependencia" value="${escapar(s.cod_dependencia)}"></div>
      <div><label>Título pre/postgrado</label><input type="text" name="titulo_pre_pos_grado" value="${escapar(s.titulo_pre_pos_grado)}"></div>
      <div><label>Cargo nominal</label><input type="text" name="cargo_nominal" value="${escapar(s.cargo_nominal)}"></div>
      <div><label>Fecha última credencial</label><input type="date" name="fecha_ultima_credencial" value="${formatoFecha(s.fecha_ultima_credencial)}"></div>
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
      await RAC.put(`/api/supervision/supervisores-municipales/${editando}`, datos);
      mostrarToast("Supervisor actualizado.");
    } else {
      await RAC.post("/api/supervision/supervisores-municipales", datos);
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
  if (!confirm("¿Eliminar este supervisor municipal? Esta acción no se puede deshacer.")) return;
  try {
    await RAC.del(`/api/supervision/supervisores-municipales/${id}`);
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
    <h3 style="margin-bottom:6px;">Planteles asignados — ${escapar(supervisor.nombre)}${supervisor.municipio ? ` · Municipio ${escapar(supervisor.municipio)}` : ""}</h3>
    <p style="font-size:.82rem; color:var(--muted); margin-bottom:14px;">Escribe el código del plantel para asignarlo o quitarlo de este supervisor. Al escribirlo se muestra el plantel al que corresponde.</p>
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

  // Vista previa del plantel al escribir el código (avisa si es de otro municipio).
  activarVistaPrevia("inputAsignarCodigo", "previaAsignar", supervisor.municipio);
  activarVistaPrevia("inputQuitarCodigo", "previaQuitar", null);

  document.getElementById("formAsignar").addEventListener("submit", async (e) => {
    e.preventDefault();
    const codigo_plantel = document.getElementById("inputAsignarCodigo").value.trim();
    try {
      await RAC.post(`/api/supervision/supervisores-municipales/${supervisor.id}/planteles`, { codigo_plantel });
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
      await RAC.del(`/api/supervision/supervisores-municipales/${supervisor.id}/planteles/${encodeURIComponent(codigo)}`);
      mostrarToast("Plantel quitado.");
      e.target.reset();
      document.getElementById("previaQuitar").innerHTML = "";
    } catch (err) {
      mostrarToast(err.message, true);
    }
  });
}

// Al escribir en `inputId`, consulta el/los plantel(es) y pinta en `previaId`
// su nombre, municipio y parroquia. Si `municipioSupervisor` viene, avisa
// (sin bloquear) cuando el plantel pertenece a otro municipio.
function activarVistaPrevia(inputId, previaId, municipioSupervisor) {
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
          const otroMunicipio = municipioSupervisor && p.municipio
            && normalizar(p.municipio) !== normalizar(municipioSupervisor);
          return `
            <div style="padding:6px 0;">
              <strong>${escapar(p.eponimo_actual)}</strong>
              <span style="color:var(--muted);"> — Municipio ${escapar(p.municipio || "sin municipio")} · Parroquia ${escapar(p.parroquia || "sin parroquia")}</span>
              ${otroMunicipio ? `<div style="color:#b7791f;">⚠ Este plantel es del municipio ${escapar(p.municipio)}, no de ${escapar(municipioSupervisor)}.</div>` : ""}
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
