// supervision-circuitales.js — panel de administración (rol admin/supervision)
// de supervisores circuitales: crear, editar, eliminar y asignar/quitar
// planteles. El backend no expone un endpoint para LISTAR los planteles ya
// asignados a un supervisor, solo para asignar/quitar uno por código puntual.
// Por eso el botón "Planteles" permite: (1) asignar o quitar un plantel por
// código (con vista previa del plantel, usando GET /api/supervision/plantel-info)
// y (2) asignar o quitar un CIRCUITO COMPLETO de una vez: se consulta el
// circuito (GET /api/supervision/circuitos/:codigo), que trae sus planteles y
// los supervisores que hoy lo cubren, y se asigna/quita plantel por plantel con
// las mismas rutas de siempre. El traspaso de un circuito a otro supervisor
// se hace con la casilla "quitar a los anteriores".
//
// El N° y el nombre del circuito de cada supervisor los calcula el backend a
// partir de los planteles que tiene asignados (si cubre 2 circuitos salen
// separados por coma).

const usuario = renderShell("supervision-circuitales", "Supervisión · Supervisores circuitales");
let supervisores = [];
let editando = null; // id en edición, o null si el formulario es "nuevo"
let busqueda = "";
let circuitos = []; // catálogo de circuitos (para "circuito completo" y para el aviso al eliminar)
let detalleCircuito = null; // circuito elegido en el panel: { codigo, nombre, planteles, supervisores }
let turnoDetalle = 0; // descarta respuestas viejas al cambiar de circuito
let ocupado = false; // hay una asignación/quita masiva en curso

if (usuario) cargarPantalla();

async function cargarPantalla() {
  const contenido = document.getElementById("contenido");
  contenido.innerHTML = `<div class="cargando">Cargando supervisores circuitales…</div>`;
  try {
    const resp = await RAC.get("/api/supervision/supervisores-circuitales");
    supervisores = RAC.lista(resp, "supervisores") || [];
    dibujarPantalla();
  } catch (err) {
    contenido.innerHTML = `<div class="panel" style="padding:20px;"><div class="vacio"><strong>No se pudo cargar</strong>${escapar(err.message)}</div></div>`;
  }
}

// Recarga la lista de supervisores SIN cerrar los paneles abiertos.
async function refrescarSupervisores() {
  try {
    const resp = await RAC.get("/api/supervision/supervisores-circuitales");
    supervisores = RAC.lista(resp, "supervisores") || [];
    const hero = document.getElementById("heroConteo");
    if (hero) hero.textContent = `${supervisores.length} supervisores cargados`;
    pintarTabla();
  } catch (_) { /* la tabla se queda como estaba */ }
}

async function cargarCircuitos() {
  const resp = await RAC.get("/api/supervision/circuitos");
  circuitos = RAC.lista(resp, "circuitos") || [];
}

function dibujarPantalla() {
  const contenido = document.getElementById("contenido");
  contenido.innerHTML = `
    <section class="planteles-hero">
      <div class="planteles-hero-copy">
        <span class="planteles-eyebrow">SUPERVISIÓN</span>
        <h1>Supervisores circuitales</h1>
        <p id="heroConteo">${supervisores.length} supervisores cargados</p>
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

// ---------- Utilidades de trabajo masivo ----------

// Corre `tarea(item)` para cada elemento, de a `tamano` a la vez, y devuelve
// los que fallaron. `alAvanzar(hechos, total)` sirve para mostrar el progreso.
async function ejecutarEnLotes(items, tarea, alAvanzar, tamano = 5) {
  const fallos = [];
  let hechos = 0;
  for (let i = 0; i < items.length; i += tamano) {
    await Promise.all(items.slice(i, i + tamano).map(async (item) => {
      try {
        await tarea(item);
      } catch (err) {
        fallos.push({ item, mensaje: err.message });
      }
      hechos += 1;
      if (alAvanzar) alAvanzar(hechos, items.length);
    }));
  }
  return fallos;
}

function codigosDeCircuito(supervisor) {
  return String((supervisor && supervisor.num_circuito) || "")
    .split(",").map((c) => c.trim()).filter(Boolean);
}

// ---------- Eliminar ----------

async function eliminarSupervisor(id) {
  const s = supervisores.find((x) => String(x.id) === String(id));
  const nombre = s ? `${s.nombres} ${s.apellidos}` : "este supervisor";
  const codigos = codigosDeCircuito(s);

  let aviso = "";
  if (codigos.length) {
    try { if (!circuitos.length) await cargarCircuitos(); } catch (_) { /* se avisa sin el conteo */ }
    const filas = codigos.map((c) => circuitos.find((x) => x.codigo_circuito === c)).filter(Boolean);
    const total = filas.reduce((suma, c) => suma + (Number(c.planteles) || 0), 0);
    aviso = `\n\nCubre ${codigos.length === 1 ? "el circuito" : "los circuitos"} ${codigos.join(", ")}${filas.length ? ` (${total} planteles)` : ""}. ` +
      `Si lo eliminas, ${codigos.length === 1 ? "ese circuito puede quedar" : "esos circuitos pueden quedar"} sin supervisor circuital.\n\n` +
      `Para traspasarlos a otro supervisor, cancela y usa primero "Planteles" → "Circuito completo" con el nuevo supervisor, marcando "quitar a los anteriores".`;
  }

  if (!confirm(`¿Eliminar a ${nombre}? Esta acción no se puede deshacer.${aviso}`)) return;
  try {
    await RAC.del(`/api/supervision/supervisores-circuitales/${id}`);
    mostrarToast("Supervisor eliminado.");
    cargarPantalla();
    return;
  } catch (err) {
    // Si falla, lo más probable es que aún tenga planteles asignados.
    if (!codigos.length) { mostrarToast(err.message, true); return; }
    const reintentar = confirm(
      `No se pudo eliminar: ${err.message}\n\nPuede ser porque todavía tiene planteles asignados. ` +
      `¿Quieres quitarle primero los planteles de sus circuitos (${codigos.join(", ")}) y volver a intentar?`
    );
    if (!reintentar) return;
  }

  // Reintento: quitarle los planteles de sus circuitos y borrar de nuevo.
  try {
    mostrarToast("Quitando los planteles asignados…");
    for (const codigo of codigos) {
      const resp = await RAC.get(`/api/supervision/circuitos/${encodeURIComponent(codigo)}`);
      const codigosPlantel = (resp.planteles || []).map((p) => p.codigo_plantel);
      await ejecutarEnLotes(codigosPlantel, (cp) =>
        RAC.del(`/api/supervision/supervisores-circuitales/${id}/planteles/${encodeURIComponent(cp)}`));
    }
    await RAC.del(`/api/supervision/supervisores-circuitales/${id}`);
    mostrarToast("Supervisor eliminado.");
    cargarPantalla();
  } catch (err) {
    mostrarToast(`No se pudo eliminar: ${err.message}`, true);
    refrescarSupervisores();
  }
}

// ---------- Panel "Planteles" ----------

function abrirAsignar(supervisor) {
  document.getElementById("panelFormulario").style.display = "none";
  const panel = document.getElementById("panelAsignar");
  panel.style.display = "block";
  detalleCircuito = null;
  const circuito = supervisor.nombre_circuito
    ? ` · Circuito ${escapar(supervisor.nombre_circuito)}${supervisor.num_circuito ? ` (${escapar(supervisor.num_circuito)})` : ""}`
    : "";
  panel.innerHTML = `
    <h3 style="margin-bottom:6px;">Planteles asignados — ${escapar(supervisor.nombres)} ${escapar(supervisor.apellidos)}${circuito}</h3>
    <p style="font-size:.82rem; color:var(--muted); margin-bottom:14px;">Escribe el código del plantel para asignarlo o quitarlo de este supervisor. Al escribirlo se muestra el plantel al que corresponde y su circuito. Más abajo puedes asignar un circuito completo de una vez.</p>
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

    <div id="bloqueCircuito" style="border-top:1px solid var(--rac-border, #dfe7f0); margin-top:18px; padding-top:16px;"></div>

    <button type="button" class="btn btn-fantasma" id="btnCerrarAsignar" style="margin-top:14px;">Cerrar</button>
  `;
  document.getElementById("btnCerrarAsignar").addEventListener("click", () => {
    if (ocupado && !confirm("Hay una asignación en curso. Si cierras, termina igual en segundo plano. ¿Cerrar de todos modos?")) return;
    panel.style.display = "none";
    panel.innerHTML = "";
  });

  // Vista previa del plantel al escribir el código (avisa si es de otro circuito).
  const circuitosDelSupervisor = codigosDeCircuito(supervisor);
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
      refrescarSupervisores();
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
      refrescarSupervisores();
    } catch (err) {
      mostrarToast(err.message, true);
    }
  });

  iniciarCircuitoCompleto(supervisor);
  if (panel.scrollIntoView) panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------- Circuito completo ----------

async function iniciarCircuitoCompleto(supervisor) {
  const cont = document.getElementById("bloqueCircuito");
  cont.innerHTML = `<div class="cargando" style="padding:12px;">Cargando circuitos…</div>`;
  try {
    await cargarCircuitos();
  } catch (err) {
    cont.innerHTML = `<p style="font-size:.85rem; color:#c53030;">No se pudo cargar la lista de circuitos: ${escapar(err.message)}</p>`;
    return;
  }
  dibujarBloqueCircuito(supervisor);
}

function opcionesCircuito(filtro, soloSinSupervisor, seleccionado) {
  const q = normalizar(filtro);
  const lista = circuitos.filter((c) => {
    if (soloSinSupervisor && c.supervisor) return false;
    if (!q) return true;
    return normalizar([c.codigo_circuito, c.nombre, c.municipio, c.supervisor].join(" ")).includes(q);
  });
  return `<option value="">— Elige un circuito (${lista.length}) —</option>` + lista.map((c) => `
    <option value="${escapar(c.codigo_circuito)}" ${c.codigo_circuito === seleccionado ? "selected" : ""}>
      ${escapar(c.codigo_circuito)} · ${escapar(c.nombre)} · ${escapar(c.municipio || "sin municipio")} · ${Number(c.planteles) || 0} planteles${c.supervisor ? "" : " · SIN SUPERVISOR"}
    </option>`).join("");
}

function dibujarBloqueCircuito(supervisor) {
  const cont = document.getElementById("bloqueCircuito");
  cont.innerHTML = `
    <h3 style="margin-bottom:4px;">Circuito completo</h3>
    <p style="font-size:.82rem; color:var(--muted); margin-bottom:12px;">
      Asigna de una vez todos los planteles de un circuito a este supervisor, o quítaselos. Si el circuito ya tenía otro supervisor, puedes pasarlo (traspaso) marcando la casilla que aparece al elegirlo.
    </p>
    <div style="display:flex; gap:12px; flex-wrap:wrap; align-items:flex-end; margin-bottom:10px;">
      <div style="min-width:200px; flex:1;">
        <label style="display:block; font-size:.78rem; margin-bottom:4px;">Buscar circuito</label>
        <input type="search" id="inputFiltroCircuito" placeholder="Código, nombre, municipio o supervisor…" autocomplete="off">
      </div>
      <label style="display:flex; gap:6px; align-items:center; font-size:.82rem; padding-bottom:10px;">
        <input type="checkbox" id="chkSoloSinSupervisor"> Solo circuitos sin supervisor
      </label>
    </div>
    <div style="margin-bottom:10px;">
      <label style="display:block; font-size:.78rem; margin-bottom:4px;">Circuito</label>
      <select id="selectCircuito" style="width:100%;">${opcionesCircuito("", false, "")}</select>
    </div>
    <div id="previaCircuito" style="font-size:.85rem;"></div>
    <div id="estadoCircuito" style="font-size:.85rem; margin-top:10px;"></div>
  `;

  const filtro = document.getElementById("inputFiltroCircuito");
  const chk = document.getElementById("chkSoloSinSupervisor");
  const select = document.getElementById("selectCircuito");
  const reconstruir = () => {
    const actual = select.value;
    select.innerHTML = opcionesCircuito(filtro.value, chk.checked, actual);
    if (select.value !== actual) cargarDetalleCircuito(supervisor.id, select.value);
  };
  filtro.addEventListener("input", reconstruir);
  chk.addEventListener("change", reconstruir);
  select.addEventListener("change", () => cargarDetalleCircuito(supervisor.id, select.value));
}

async function cargarDetalleCircuito(idSupervisor, codigo) {
  const previa = document.getElementById("previaCircuito");
  if (!previa) return;
  const miTurno = ++turnoDetalle;
  if (!codigo) {
    detalleCircuito = null;
    previa.innerHTML = "";
    return;
  }
  previa.innerHTML = `<div style="color:var(--muted);">Consultando circuito…</div>`;
  try {
    const resp = await RAC.get(`/api/supervision/circuitos/${encodeURIComponent(codigo)}`);
    if (miTurno !== turnoDetalle) return; // llegó tarde: ya se eligió otro circuito
    detalleCircuito = {
      codigo,
      nombre: resp.circuito ? resp.circuito.nombre : "",
      planteles: resp.planteles || [],
      supervisores: resp.supervisores || [],
    };
    pintarPreviaCircuito(idSupervisor);
  } catch (err) {
    if (miTurno !== turnoDetalle) return;
    detalleCircuito = null;
    previa.innerHTML = `<div style="color:#c53030;">No se pudo consultar el circuito: ${escapar(err.message)}</div>`;
  }
}

function nombreSupervisor(s) {
  return `${s.nombres || ""} ${s.apellidos || ""}`.trim();
}

function pintarPreviaCircuito(idSupervisor) {
  const previa = document.getElementById("previaCircuito");
  const d = detalleCircuito;
  if (!previa || !d) return;
  const cantidad = d.planteles.length;
  const otros = d.supervisores.filter((s) => String(s.id) !== String(idSupervisor));
  const cubre = d.supervisores.some((s) => String(s.id) === String(idSupervisor));

  const lineaSupervisores = d.supervisores.length
    ? d.supervisores.map((s) => `${escapar(nombreSupervisor(s))}${String(s.id) === String(idSupervisor) ? " (este supervisor)" : ""}`).join(", ")
    : "Ninguno todavía";

  previa.innerHTML = `
    <div style="padding:10px 12px; border:1px solid var(--rac-border, #dfe7f0); border-radius:10px; background:#f8fafc;">
      <div><strong>${escapar(d.codigo)} · ${escapar(d.nombre)}</strong> — ${cantidad} plantel${cantidad === 1 ? "" : "es"}</div>
      <div style="color:var(--muted); margin-top:4px;">Supervisor(es) circuital(es) actual(es): ${lineaSupervisores}</div>
      ${cantidad ? `
        <details style="margin-top:6px;">
          <summary style="cursor:pointer;">Ver los planteles del circuito</summary>
          <ul style="margin:6px 0 0 18px; padding:0;">${d.planteles.map((p) => `<li>${escapar(p.codigo_plantel)} — ${escapar(p.eponimo_actual)}${p.parroquia ? ` <span style="color:var(--muted);">(${escapar(p.parroquia)})</span>` : ""}</li>`).join("")}</ul>
        </details>` : `<div style="color:#b7791f; margin-top:6px;">Este circuito no tiene planteles cargados, no hay nada que asignar.</div>`}
    </div>
    ${otros.length ? `
      <label style="display:flex; gap:8px; align-items:flex-start; margin-top:10px; font-size:.85rem;">
        <input type="checkbox" id="chkQuitarOtros" style="margin-top:3px;">
        <span>Quitar de este circuito a: <strong>${otros.map((s) => escapar(nombreSupervisor(s))).join(", ")}</strong> (traspaso). Solo se les quitan los planteles de este circuito; conservan los de otros circuitos.</span>
      </label>` : ""}
    <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:12px;">
      <button type="button" class="btn" id="btnAsignarCircuito" ${cantidad ? "" : "disabled"}>Asignar circuito completo</button>
      ${cubre ? `<button type="button" class="btn btn-fantasma" id="btnQuitarCircuito">Quitar circuito de este supervisor</button>` : ""}
    </div>
  `;

  const btnAsignar = document.getElementById("btnAsignarCircuito");
  if (btnAsignar) btnAsignar.addEventListener("click", () => asignarCircuitoCompleto(idSupervisor));
  const btnQuitar = document.getElementById("btnQuitarCircuito");
  if (btnQuitar) btnQuitar.addEventListener("click", () => quitarCircuitoCompleto(idSupervisor));
}

function bloquearBotonesCircuito(bloquear) {
  ["btnAsignarCircuito", "btnQuitarCircuito", "chkQuitarOtros", "selectCircuito", "inputFiltroCircuito", "chkSoloSinSupervisor"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = bloquear;
  });
}

function mostrarEstado(html) {
  const el = document.getElementById("estadoCircuito");
  if (el) el.innerHTML = html;
}

function resumenFallos(fallos) {
  if (!fallos.length) return "";
  const lista = fallos.slice(0, 8).map((f) => `${escapar(f.item.codigo || f.item)}: ${escapar(f.mensaje)}`).join("<br>");
  return `<div style="color:#c53030; margin-top:6px;">No se pudieron procesar ${fallos.length}:<br>${lista}${fallos.length > 8 ? "<br>…" : ""}</div>`;
}

async function asignarCircuitoCompleto(idSupervisor) {
  const d = detalleCircuito;
  if (!d || ocupado || !d.planteles.length) return;
  const s = supervisores.find((x) => String(x.id) === String(idSupervisor));
  const nombre = s ? nombreSupervisor(s) : "este supervisor";
  const otros = d.supervisores.filter((x) => String(x.id) !== String(idSupervisor));
  const chk = document.getElementById("chkQuitarOtros");
  const quitarOtros = Boolean(chk && chk.checked && otros.length);

  let mensaje = `¿Asignar los ${d.planteles.length} planteles del circuito ${d.codigo} (${d.nombre}) a ${nombre}?`;
  if (quitarOtros) mensaje += `\n\nSe les quitará este circuito a: ${otros.map(nombreSupervisor).join(", ")}.`;
  else if (otros.length) mensaje += `\n\nOJO: ${otros.map(nombreSupervisor).join(", ")} seguirá(n) asignado(s) también a este circuito.`;
  if (!confirm(mensaje)) return;

  ocupado = true;
  bloquearBotonesCircuito(true);
  try {
    const planteles = d.planteles.map((p) => ({ codigo: p.codigo_plantel }));
    const fallosAsignar = await ejecutarEnLotes(
      planteles,
      (p) => RAC.post(`/api/supervision/supervisores-circuitales/${idSupervisor}/planteles`, { codigo_plantel: p.codigo }),
      (hechos, total) => mostrarEstado(`Asignando planteles… ${hechos} de ${total}`)
    );
    const asignados = planteles.length - fallosAsignar.length;
    let html = `<div style="color:#2f855a;"><strong>${asignados}</strong> de ${planteles.length} planteles asignados a ${escapar(nombre)}.</div>${resumenFallos(fallosAsignar)}`;

    if (quitarOtros) {
      if (fallosAsignar.length) {
        html += `<div style="color:#b7791f; margin-top:6px;">No se quitó a los supervisores anteriores porque la asignación no terminó completa. Corrige y vuelve a intentar.</div>`;
      } else {
        const tareas = [];
        otros.forEach((o) => planteles.forEach((p) => tareas.push({ idOtro: o.id, codigo: p.codigo })));
        const fallosQuitar = await ejecutarEnLotes(
          tareas,
          (t) => RAC.del(`/api/supervision/supervisores-circuitales/${t.idOtro}/planteles/${encodeURIComponent(t.codigo)}`),
          (hechos, total) => mostrarEstado(`Quitando a los supervisores anteriores… ${hechos} de ${total}`)
        );
        html += `<div style="color:#2f855a; margin-top:6px;">Se quitó el circuito a ${otros.length} supervisor${otros.length === 1 ? "" : "es"} anterior${otros.length === 1 ? "" : "es"}.</div>${resumenFallos(fallosQuitar)}`;
      }
    }
    mostrarEstado(html);
    mostrarToast(fallosAsignar.length ? "Asignación terminada con errores." : "Circuito asignado.", Boolean(fallosAsignar.length));
  } catch (err) {
    mostrarEstado(`<div style="color:#c53030;">${escapar(err.message)}</div>`);
    mostrarToast(err.message, true);
  } finally {
    ocupado = false;
    await refrescarTrasCambio(idSupervisor);
  }
}

async function quitarCircuitoCompleto(idSupervisor) {
  const d = detalleCircuito;
  if (!d || ocupado) return;
  const s = supervisores.find((x) => String(x.id) === String(idSupervisor));
  const nombre = s ? nombreSupervisor(s) : "este supervisor";
  if (!confirm(`¿Quitarle a ${nombre} los ${d.planteles.length} planteles del circuito ${d.codigo} (${d.nombre})?\n\nEl circuito puede quedar sin supervisor circuital.`)) return;

  ocupado = true;
  bloquearBotonesCircuito(true);
  try {
    const planteles = d.planteles.map((p) => ({ codigo: p.codigo_plantel }));
    const fallos = await ejecutarEnLotes(
      planteles,
      (p) => RAC.del(`/api/supervision/supervisores-circuitales/${idSupervisor}/planteles/${encodeURIComponent(p.codigo)}`),
      (hechos, total) => mostrarEstado(`Quitando planteles… ${hechos} de ${total}`)
    );
    mostrarEstado(`<div style="color:#2f855a;"><strong>${planteles.length - fallos.length}</strong> de ${planteles.length} planteles quitados a ${escapar(nombre)}.</div>${resumenFallos(fallos)}`);
    mostrarToast(fallos.length ? "Terminó con errores." : "Circuito quitado.", Boolean(fallos.length));
  } catch (err) {
    mostrarEstado(`<div style="color:#c53030;">${escapar(err.message)}</div>`);
    mostrarToast(err.message, true);
  } finally {
    ocupado = false;
    await refrescarTrasCambio(idSupervisor);
  }
}

// Después de asignar/quitar: actualiza la tabla, la lista de circuitos (para
// que "SIN SUPERVISOR" esté al día) y la vista previa, sin borrar el mensaje
// de resultado.
async function refrescarTrasCambio(idSupervisor) {
  const codigo = detalleCircuito ? detalleCircuito.codigo : "";
  await refrescarSupervisores();
  try { await cargarCircuitos(); } catch (_) { /* se queda la lista anterior */ }
  const select = document.getElementById("selectCircuito");
  if (select) {
    const filtro = document.getElementById("inputFiltroCircuito");
    const chk = document.getElementById("chkSoloSinSupervisor");
    select.innerHTML = opcionesCircuito(filtro ? filtro.value : "", chk ? chk.checked : false, codigo);
  }
  bloquearBotonesCircuito(false);
  if (codigo) {
    const estado = document.getElementById("estadoCircuito");
    const guardado = estado ? estado.innerHTML : "";
    await cargarDetalleCircuito(idSupervisor, codigo);
    mostrarEstado(guardado);
  }
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
