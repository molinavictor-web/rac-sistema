// inspecciones-planes.js — Inspecciones, etapa 1: planes de atención y los
// planteles de cada plan. Habla con /api/inspecciones/*.
//
// Idea central: la inspección (con sus cantidades) pertenece al PLANTEL.
// "Desenlazar" un plantel de un plan no borra nada: la inspección queda
// guardada, en espera de una futura rehabilitación.

const usuario = renderShell("inspecciones-planes", "Planes de atención");
// Perfiles: admin y coordinador gestionan (crear planes, enlazar planteles, asignar ingenieros).
// El resto (consulta, operador de plantel) ve todo en solo lectura.
const PUEDE_GESTIONAR = Boolean(usuario) && ["admin", "insp_coordinador"].includes(usuario.rol);

let PLANES = [];
let PLAN_ABIERTO = null; // { plan, planteles }
let MODO_MODAL = "crear";
let temporizadorBusqueda = null;

if (usuario && usuario.rol === "insp_ingeniero") {
  // El ingeniero no maneja planes: su pantalla es «Mis planillas».
  window.location.replace("/inspecciones/mis-planillas.html");
} else if (usuario) {
  window.addEventListener("hashchange", enrutar);
  enrutar();
}

function enrutar() {
  const coincide = /^#plan-(\d+)$/.exec(window.location.hash);
  if (coincide) abrirPlan(Number(coincide[1]));
  else mostrarLista();
}

// ---------------------------------------------------------------------------
// Lista de planes
// ---------------------------------------------------------------------------

async function mostrarLista() {
  PLAN_ABIERTO = null;
  const contenido = document.getElementById("contenido");
  contenido.innerHTML = `
    <section class="planteles-hero">
      <div class="planteles-hero-copy">
        <span class="planteles-eyebrow">INSPECCIONES</span>
        <h1>Planes de atención</h1>
        <p>Los planes que definen las autoridades (PRE 2026-2027, Bricomiles…) y los planteles que atiende cada uno.</p>
      </div>
    </section>
    <div class="panel">
      <div style="padding:16px 20px 0; display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap;">
        <div id="resumenPlanes" style="color:var(--muted); font-size:.8rem;"></div>
        ${PUEDE_GESTIONAR ? `<button type="button" class="btn btn-primario btn-sm" id="btnNuevoPlan">+ Nuevo plan</button>` : `<span style="color:var(--muted); font-size:.8rem;">Acceso de solo lectura</span>`}
      </div>
      <div id="tablaPlanes" style="margin-top:12px;"><div class="cargando">Cargando…</div></div>
    </div>
  `;
  if (PUEDE_GESTIONAR) document.getElementById("btnNuevoPlan").addEventListener("click", () => abrirModalPlan("crear"));

  try {
    const resp = await RAC.get("/api/inspecciones/planes");
    PLANES = RAC.lista(resp, "planes");
    pintarPlanes();
  } catch (err) {
    document.getElementById("tablaPlanes").innerHTML =
      `<div class="vacio"><strong>No se pudieron cargar los planes</strong>${escapar(err.message)}</div>`;
  }
}

function pintarPlanes() {
  const cont = document.getElementById("tablaPlanes");
  const resumen = document.getElementById("resumenPlanes");
  if (!cont) return;
  resumen.textContent = `${PLANES.length} plan${PLANES.length === 1 ? "" : "es"}`;

  if (!PLANES.length) {
    cont.innerHTML = `<div class="vacio"><strong>Todavía no hay planes</strong>Crea el primero con «+ Nuevo plan».</div>`;
    return;
  }

  const filas = PLANES.map((p) => `
    <tr>
      <td><strong>${escapar(p.nombre)}</strong>${p.descripcion ? `<br><span style="color:var(--muted); font-size:.78rem;">${escapar(p.descripcion)}</span>` : ""}</td>
      <td>${escapar(p.version_catalogo)}</td>
      <td>${etiquetaEstado(p.estado)}</td>
      <td style="text-align:center;">${Number(p.planteles_activos) || 0}</td>
      <td style="text-align:center;">${Number(p.planteles_desenlazados) || 0}</td>
      <td>${fecha(p.creado_en)}</td>
      <td><button type="button" class="btn btn-fantasma btn-sm" data-abrir="${Number(p.id)}">Abrir</button></td>
    </tr>
  `).join("");

  cont.innerHTML = `
    <div class="tabla-responsive">
      <table>
        <thead><tr><th>Plan</th><th>Lista de materiales</th><th>Estado</th><th>Planteles</th><th>Desenlazados</th><th>Creado</th><th></th></tr></thead>
        <tbody>${filas}</tbody>
      </table>
    </div>
  `;
  cont.querySelectorAll("[data-abrir]").forEach((boton) => {
    boton.addEventListener("click", () => { window.location.hash = `#plan-${boton.dataset.abrir}`; });
  });
}

// ---------------------------------------------------------------------------
// Un plan y sus planteles
// ---------------------------------------------------------------------------

async function abrirPlan(id) {
  const contenido = document.getElementById("contenido");
  contenido.innerHTML = `<div class="panel"><div class="cargando">Cargando plan…</div></div>`;
  try {
    PLAN_ABIERTO = await RAC.get(`/api/inspecciones/planes/${id}`);
  } catch (err) {
    contenido.innerHTML = `
      <div class="panel"><div class="vacio"><strong>No se pudo abrir el plan</strong>${escapar(err.message)}<br><br>
      <button type="button" class="btn btn-fantasma btn-sm" id="btnVolverError">← Todos los planes</button></div></div>`;
    document.getElementById("btnVolverError").addEventListener("click", volverALista);
    return;
  }
  dibujarPlan();
}

function volverALista() {
  if (window.location.hash) window.location.hash = "";
  else mostrarLista();
}

function dibujarPlan() {
  const { plan } = PLAN_ABIERTO;
  const abierto = plan.estado === "ACTIVO";
  const contenido = document.getElementById("contenido");

  contenido.innerHTML = `
    <section class="planteles-hero">
      <div class="planteles-hero-copy">
        <span class="planteles-eyebrow">PLAN DE ATENCIÓN · ${escapar(plan.version_catalogo)}</span>
        <h1>${escapar(plan.nombre)}</h1>
        <p>${plan.descripcion ? escapar(plan.descripcion) : "Sin descripción."} ${etiquetaEstado(plan.estado)}</p>
      </div>
    </section>

    <div class="panel" style="margin-bottom:16px;">
      <div style="padding:14px 20px; display:flex; gap:10px; flex-wrap:wrap;">
        <button type="button" class="btn btn-fantasma btn-sm" id="btnVolver">← Todos los planes</button>
        ${PUEDE_GESTIONAR ? `<button type="button" class="btn btn-fantasma btn-sm" id="btnEditarPlan">Editar nombre</button>
        <button type="button" class="btn btn-fantasma btn-sm" id="btnEstadoPlan">${abierto ? "Cerrar plan" : "Reabrir plan"}</button>` : ""}
        ${usuario && usuario.rol === "admin" ? `<button type="button" class="btn btn-fantasma btn-sm" id="btnRegistrarGescolar" title="Escribe el nombre del plan en la columna propia del plan en GESCOLAR («PLAN <nombre>»)">Registrar plan en GESCOLAR</button>` : ""}
        <a class="btn btn-primario btn-sm" href="/inspecciones/consolidado.html?plan=${Number(plan.id)}">Consolidado oficial</a>
        <a class="btn btn-primario btn-sm" href="/inspecciones/adicionales-consolidado.html?plan=${Number(plan.id)}">Consolidado de adicionales</a>
      </div>
    </div>

    ${abierto && PUEDE_GESTIONAR ? `
    <div class="panel" style="margin-bottom:16px;">
      <div style="padding:16px 20px 0;">
        <h3 style="margin:0 0 4px;">Agregar un plantel</h3>
        <p style="margin:0 0 10px; color:var(--muted); font-size:.82rem;">Busca por nombre, código DEA, municipio o parroquia. Si el plantel ya tiene una inspección guardada en espera, se reutiliza con sus cantidades.</p>
        <div class="filtros">
          <input type="text" id="qPlantel" placeholder="Escribe al menos 2 caracteres…" style="flex:1; min-width:260px;">
        </div>
      </div>
      <div id="resultadosBusqueda" style="margin-top:10px;"></div>
    </div>` : ""}

    <div class="panel">
      <div style="padding:16px 20px 0;"><h3 style="margin:0;" id="tituloPlanteles">Planteles del plan</h3></div>
      <div id="tablaPlanteles" style="margin-top:12px;"></div>
    </div>
  `;

  document.getElementById("btnVolver").addEventListener("click", volverALista);
  const btnReg = document.getElementById("btnRegistrarGescolar");
  if (btnReg) btnReg.addEventListener("click", () => abrirRegistroGescolar(plan));
  if (PUEDE_GESTIONAR) {
    document.getElementById("btnEditarPlan").addEventListener("click", () => abrirModalPlan("editar"));
    document.getElementById("btnEstadoPlan").addEventListener("click", cambiarEstadoPlan);
  }
  if (abierto && PUEDE_GESTIONAR) {
    const input = document.getElementById("qPlantel");
    input.addEventListener("input", () => {
      clearTimeout(temporizadorBusqueda);
      temporizadorBusqueda = setTimeout(() => buscarPlanteles(input.value.trim()), 380);
    });
  }
  pintarPlanteles();
}

function pintarPlanteles() {
  const { plan, planteles } = PLAN_ABIERTO;
  const abierto = plan.estado === "ACTIVO";
  const activos = planteles.filter((p) => p.activo).length;
  const desenlazados = planteles.length - activos;
  document.getElementById("tituloPlanteles").textContent =
    `Planteles del plan · ${activos} activo${activos === 1 ? "" : "s"}` + (desenlazados ? ` · ${desenlazados} desenlazado${desenlazados === 1 ? "" : "s"}` : "");

  const cont = document.getElementById("tablaPlanteles");
  if (!planteles.length) {
    cont.innerHTML = `<div class="vacio"><strong>Este plan todavía no tiene planteles</strong>${abierto && PUEDE_GESTIONAR ? "Búscalos arriba y agrégalos." : ""}</div>`;
    return;
  }

  const filas = planteles.map((p) => `
    <tr${p.activo ? "" : ' style="opacity:.6;"'}>
      <td><span class="cod">${escapar(p.codigo_dea)}</span></td>
      <td>${escapar(p.nombre_plantel) || "—"}<br><span style="color:var(--muted); font-size:.78rem;">${[escapar(p.municipio), escapar(p.parroquia)].filter(Boolean).join(" · ")}</span></td>
      <td>${p.activo ? etiqueta("En el plan", "#2f855a", "#e6f4ea") : etiqueta("Desenlazado · en espera", "#718096", "#edf2f7")}</td>
      <td style="font-size:.82rem;">${ingenierosHtml(p)}</td>
      <td style="white-space:nowrap;"><a class="btn btn-primario btn-sm" href="/inspecciones/planilla.html?id=${Number(p.inspeccion_id)}&plan=${Number(plan.id)}">${p.activo && PUEDE_GESTIONAR ? "Planilla" : "Ver planilla"}</a></td>
      <td>${abierto && PUEDE_GESTIONAR ? (p.activo
        ? `<button type="button" class="btn btn-fantasma btn-sm" data-desenlazar="${Number(p.inspeccion_id)}" data-nombre="${escapar(p.nombre_plantel || p.codigo_dea)}">Desenlazar</button>`
        : `<button type="button" class="btn btn-fantasma btn-sm" data-reenlazar="${Number(p.inspeccion_id)}">Volver a enlazar</button>`) : ""}</td>
    </tr>
  `).join("");

  cont.innerHTML = `
    <div class="tabla-responsive">
      <table>
        <thead><tr><th>Código</th><th>Plantel</th><th>Estado</th><th>Ingenieros</th><th>Materiales</th><th></th></tr></thead>
        <tbody>${filas}</tbody>
      </table>
    </div>
  `;
  cont.querySelectorAll("[data-asignar]").forEach((b) => {
    b.addEventListener("click", () => abrirAsignacion(Number(b.dataset.asignar), b.dataset.nombre));
  });
  cont.querySelectorAll("[data-desenlazar]").forEach((b) => {
    b.addEventListener("click", () => desenlazar(Number(b.dataset.desenlazar), b.dataset.nombre));
  });
  cont.querySelectorAll("[data-reenlazar]").forEach((b) => {
    b.addEventListener("click", () => reenlazar(Number(b.dataset.reenlazar)));
  });
}

// ---- Registrar el plan en GESCOLAR (su propia columna «PLAN <nombre>») ----
// Solo administrador. Muestra qué se escribiría en cada plantel y pide confirmar. La columna TIPO ATENCION
// (historial de la atención anterior) nunca se modifica; se muestra solo como referencia.
async function abrirRegistroGescolar(plan) {
  let vista;
  try {
    vista = await RAC.get(`/api/inspecciones/planes/${plan.id}/registro-gescolar`);
  } catch (err) {
    mostrarToast(err.message, true);
    return;
  }
  const hayCambios = vista.planteles.filter((p) => p.cambia);
  const conHistorial = vista.planteles.filter((p) => p.tipo_atencion);
  const filas = vista.planteles.map((p) => `<tr>
      <td><span class="cod">${escapar(p.codigo_dea)}</span></td>
      <td>${escapar(p.nombre_plantel) || "—"}</td>
      <td>${p.tipo_atencion ? escapar(p.tipo_atencion) : `<span style="color:var(--muted);">—</span>`}</td>
      <td>${!p.en_gescolar ? `<span style="color:#b3261e;">No está en GESCOLAR</span>` : p.cambia ? `<strong>${escapar(vista.valor)}</strong>${p.actual ? ` <span style="color:var(--muted); font-size:.75rem;">(hoy: ${escapar(p.actual)})</span>` : ""}` : `<span style="color:var(--muted);">Ya lo tiene</span>`}</td>
    </tr>`).join("");
  const fondo = document.createElement("div");
  fondo.className = "modal-fondo visible";
  fondo.innerHTML = `
    <div class="modal" style="max-width:780px;">
      <h2 style="margin-bottom:4px;">Registrar plan en GESCOLAR</h2>
      <p style="margin:0 0 10px; color:var(--muted); font-size:.85rem;">Se escribirá <strong>«${escapar(vista.valor)}»</strong> en la columna <strong>${escapar(vista.columna)}</strong>, solo en estos ${vista.planteles.length} planteles del plan.${vista.columna_existe ? "" : ` <strong>Esa columna todavía no existe: se creará al final de la hoja.</strong>`}</p>
      <div style="margin-bottom:10px; padding:8px 10px; border-radius:8px; background:#eef6ff; border:1px solid #b6d4f5; font-size:.8rem;">
        La columna <strong>TIPO ATENCION</strong> no se modifica: conserva la atención anterior de cada plantel como dato histórico${conHistorial.length ? ` (${conHistorial.length} de estos planteles ya tienen un valor)` : ""}. Cada plan tiene su propia columna, así que los otros planes tampoco se tocan, y los planteles que ya tienen valor en esta columna se respetan.
      </div>
      <div class="tabla-responsive" style="max-height:340px; overflow:auto;">
        <table>
          <thead><tr><th>Código</th><th>Plantel</th><th>TIPO ATENCION (se conserva)</th><th>${escapar(vista.columna)}</th></tr></thead>
          <tbody>${filas}</tbody>
        </table>
      </div>
      <div class="error-msg" id="errorRegistro"></div>
      <div style="display:flex; gap:10px; margin-top:14px; align-items:center;">
        <button type="button" class="btn btn-primario" id="btnConfirmarRegistro" ${hayCambios.length ? "" : "disabled"}>${hayCambios.length ? `Escribir en GESCOLAR (${hayCambios.length})` : "Todo está al día"}</button>
        <button type="button" class="btn btn-fantasma" id="btnCancelarRegistro">Cancelar</button>
      </div>
    </div>`;
  document.body.appendChild(fondo);
  const cerrar = () => fondo.remove();
  fondo.querySelector("#btnCancelarRegistro").addEventListener("click", cerrar);
  fondo.addEventListener("click", (e) => { if (e.target === fondo) cerrar(); });
  fondo.querySelector("#btnConfirmarRegistro").addEventListener("click", async () => {
    const boton = fondo.querySelector("#btnConfirmarRegistro");
    boton.disabled = true;
    boton.textContent = "Escribiendo…";
    try {
      const r = await RAC.post(`/api/inspecciones/planes/${plan.id}/registro-gescolar`, { confirmar: true });
      mostrarToast(`GESCOLAR actualizado: «${r.valor}» en ${r.con_cambio} plantel${r.con_cambio === 1 ? "" : "es"}${r.columna_creada ? " (columna creada)" : ""}.`);
      cerrar();
    } catch (err) {
      const e = fondo.querySelector("#errorRegistro");
      e.textContent = err.message;
      e.classList.add("visible");
      boton.disabled = false;
      boton.textContent = `Escribir en GESCOLAR (${hayCambios.length})`;
    }
  });
}

// ---- Ingenieros asignados a cada planilla ----

function ingenierosHtml(p) {
  const resp = p.responsable
    ? `<strong>${escapar(p.responsable)}</strong>`
    : `<span style="color:var(--muted);">Sin responsable</span>`;
  const cuentas = (p.ingenieros || []).length
    ? `<div style="color:var(--muted); font-size:.74rem; margin-top:2px;">Acceso: ${(p.ingenieros || []).map((i) => escapar(i.nombre)).join(", ")}</div>`
    : "";
  const boton = PUEDE_GESTIONAR
    ? `<div style="margin-top:4px;"><button type="button" class="btn btn-fantasma btn-sm" data-asignar="${Number(p.inspeccion_id)}" data-nombre="${escapar(p.nombre_plantel || p.codigo_dea)}">${p.responsable || (p.ingenieros || []).length ? "Cambiar" : "Asignar"}</button></div>`
    : "";
  return resp + cuentas + boton;
}

// Modal de asignación. Dos partes:
//  1) Responsable de la inspección: se escoge entre los ingenieros que ya figuran en GESCOLAR (o se
//     escribe uno nuevo). Al guardar se escribe en la columna RESPONSABLE de GESCOLAR y suma a su
//     número de inspecciones en el resumen de Ingenieros.
//  2) Cuentas con acceso (opcional): qué usuarios «Inspecciones · Ingeniero» pueden abrir y llenar la planilla.
async function abrirAsignacion(inspeccionId, nombrePlantel) {
  let responsables = [];
  let cuentas = [];
  try {
    responsables = (await RAC.get("/api/inspecciones/responsables")).responsables || [];
  } catch (err) {
    mostrarToast(err.message, true);
    return;
  }
  try {
    cuentas = (await RAC.get("/api/inspecciones/ingenieros")).ingenieros || [];
  } catch (_) { /* las cuentas son opcionales */ }

  const plantel = PLAN_ABIERTO.planteles.find((p) => p.inspeccion_id === inspeccionId) || {};
  const actual = plantel.responsable || "";
  const marcados = new Set((plantel.ingenieros || []).map((i) => i.id));
  const opciones = [`<option value="">— Sin responsable —</option>`]
    .concat(responsables.map((r) => `<option value="${escapar(r.nombre)}" ${r.nombre === actual ? "selected" : ""}>${escapar(r.nombre)} (${Number(r.total)})</option>`));
  // Si el responsable actual no está en la lista (no debería pasar), se agrega para no perderlo.
  if (actual && !responsables.some((r) => r.nombre === actual)) {
    opciones.push(`<option value="${escapar(actual)}" selected>${escapar(actual)}</option>`);
  }
  opciones.push(`<option value="__otro__">Otro nombre…</option>`);

  const filasCuentas = cuentas.length
    ? cuentas.map((g) => `
        <label style="display:flex; gap:10px; align-items:center; padding:6px 4px; border-bottom:1px solid var(--borde); cursor:pointer;">
          <input type="checkbox" value="${Number(g.id)}" ${marcados.has(g.id) ? "checked" : ""}>
          <span>${escapar(g.nombre)}<br><small style="color:var(--muted);">${escapar(g.email)}</small></span>
        </label>`).join("")
    : `<p style="margin:0; color:var(--muted); font-size:.82rem;">Todavía no hay cuentas de ingeniero. No es necesario para registrar al responsable; solo hacen falta si el ingeniero va a entrar al sistema a llenar la planilla (se crean en Usuarios con el rol «Inspecciones · Ingeniero»).</p>`;

  const fondo = document.createElement("div");
  fondo.className = "modal-fondo visible";
  fondo.innerHTML = `
    <div class="modal" style="max-width:480px;">
      <h2 style="margin-bottom:4px;">Asignar ingeniero</h2>
      <p style="margin:0 0 12px; color:var(--muted); font-size:.85rem;">${escapar(nombrePlantel)}</p>

      <label for="selResp" style="font-weight:600; font-size:.85rem;">Responsable de la inspección</label>
      <select id="selResp" style="width:100%; margin-top:4px;">${opciones.join("")}</select>
      <input type="text" id="inpOtro" maxlength="80" placeholder="Nombre y apellido" style="width:100%; margin-top:6px; display:none;">
      <p style="margin:6px 0 0; color:var(--muted); font-size:.76rem;">Se guarda en GESCOLAR (columna RESPONSABLE) y se suma a las inspecciones de ese ingeniero.</p>
      <div id="avisoReemplazo" style="display:none; margin-top:8px; padding:8px 10px; border-radius:8px; background:#fff7ed; border:1px solid #f6ad55; font-size:.8rem;"></div>

      <div style="margin-top:16px; font-weight:600; font-size:.85rem;">Cuentas con acceso a la planilla <span style="font-weight:400; color:var(--muted);">(opcional)</span></div>
      <div style="max-height:200px; overflow:auto; margin-top:4px;">${filasCuentas}</div>

      <div class="error-msg" id="errorAsignar"></div>
      <div style="display:flex; gap:10px; margin-top:14px;">
        <button type="button" class="btn btn-primario" id="btnGuardarAsignar">Guardar</button>
        <button type="button" class="btn btn-fantasma" id="btnCancelarAsignar">Cancelar</button>
      </div>
    </div>`;
  document.body.appendChild(fondo);
  const cerrar = () => fondo.remove();
  const sel = fondo.querySelector("#selResp");
  const otro = fondo.querySelector("#inpOtro");
  const aviso = fondo.querySelector("#avisoReemplazo");

  const valorElegido = () => (sel.value === "__otro__" ? otro.value.replace(/\s+/g, " ").trim() : sel.value);
  function refrescarAviso() {
    otro.style.display = sel.value === "__otro__" ? "block" : "none";
    const v = valorElegido();
    if (actual && v !== actual) {
      aviso.style.display = "block";
      aviso.innerHTML = v
        ? `Este plantel ya figura con <strong>${escapar(actual)}</strong> en GESCOLAR. Al guardar se reemplazará por <strong>${escapar(v)}</strong> (a ${escapar(actual)} se le resta esta inspección).`
        : `Este plantel figura con <strong>${escapar(actual)}</strong>. Al guardar quedará sin responsable.`;
    } else {
      aviso.style.display = "none";
    }
  }
  sel.addEventListener("change", () => { refrescarAviso(); if (sel.value === "__otro__") otro.focus(); });
  otro.addEventListener("input", refrescarAviso);

  fondo.querySelector("#btnCancelarAsignar").addEventListener("click", cerrar);
  fondo.addEventListener("click", (e) => { if (e.target === fondo) cerrar(); });
  fondo.querySelector("#btnGuardarAsignar").addEventListener("click", async () => {
    const errorEl = fondo.querySelector("#errorAsignar");
    errorEl.classList.remove("visible");
    const cuerpo = {};
    const elegido = valorElegido();
    if (sel.value === "__otro__" && !elegido) {
      errorEl.textContent = "Escribe el nombre del ingeniero o elige uno de la lista.";
      errorEl.classList.add("visible");
      return;
    }
    if (elegido !== actual) cuerpo.responsable = elegido || null;
    const ids = Array.from(fondo.querySelectorAll("input[type=checkbox]:checked")).map((c) => Number(c.value));
    const previos = Array.from(marcados).sort((a, b) => a - b);
    if (cuentas.length && JSON.stringify(ids.slice().sort((a, b) => a - b)) !== JSON.stringify(previos)) cuerpo.usuarios = ids;
    if (cuerpo.responsable === undefined && cuerpo.usuarios === undefined) { cerrar(); return; }

    const boton = fondo.querySelector("#btnGuardarAsignar");
    boton.disabled = true;
    boton.textContent = "Guardando…";
    try {
      await RAC.put(`/api/inspecciones/inspeccion/${inspeccionId}/asignaciones`, cuerpo);
      mostrarToast("Asignación guardada.");
      cerrar();
      await recargarPlan();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.add("visible");
      boton.disabled = false;
      boton.textContent = "Guardar";
    }
  });
}

async function recargarPlan() {
  PLAN_ABIERTO = await RAC.get(`/api/inspecciones/planes/${PLAN_ABIERTO.plan.id}`);
  pintarPlanteles();
}

// ---- Buscar y agregar planteles ----

async function buscarPlanteles(q) {
  const cont = document.getElementById("resultadosBusqueda");
  if (!cont) return;
  if (!q) { cont.innerHTML = ""; return; }
  if (q.length < 2) {
    cont.innerHTML = `<div class="vacio"><strong>Escribe al menos 2 caracteres</strong></div>`;
    return;
  }
  cont.innerHTML = `<div class="cargando">Buscando…</div>`;
  try {
    const resp = await RAC.get(`/api/inspecciones/planteles/buscar?q=${encodeURIComponent(q)}&plan_id=${PLAN_ABIERTO.plan.id}`);
    const lista = RAC.lista(resp, "planteles");
    if (!lista.length) {
      cont.innerHTML = `<div class="vacio"><strong>Sin resultados</strong>Prueba con otro nombre o código.</div>`;
      return;
    }
    const filas = lista.map((p) => `
      <tr>
        <td><span class="cod">${escapar(p.cod_plantel)}</span></td>
        <td>${escapar(p.nombre_plantel) || "—"}<br><span style="color:var(--muted); font-size:.78rem;">${[escapar(p.municipio), escapar(p.parroquia)].filter(Boolean).join(" · ")}</span></td>
        <td style="font-size:.8rem; color:var(--muted);">${p.inspecciones ? `${Number(p.inspecciones)} inspección${p.inspecciones === 1 ? "" : "es"} guardada${p.inspecciones === 1 ? "" : "s"}` : "Sin inspecciones"}</td>
        <td>${p.en_el_plan
          ? etiqueta("Ya en el plan", "#2f855a", "#e6f4ea")
          : `<button type="button" class="btn btn-primario btn-sm" data-agregar="${escapar(p.cod_plantel)}">Agregar</button>`}</td>
      </tr>
    `).join("");
    cont.innerHTML = `
      <div style="padding:0 20px; color:var(--muted); font-size:.78rem;">${resp.total} resultado${resp.total === 1 ? "" : "s"}${resp.limitado ? " · mostrando los primeros 30" : ""}</div>
      <div class="tabla-responsive"><table>
        <thead><tr><th>Código</th><th>Plantel</th><th>Inspecciones</th><th></th></tr></thead>
        <tbody>${filas}</tbody>
      </table></div>`;
    cont.querySelectorAll("[data-agregar]").forEach((b) => {
      b.addEventListener("click", () => agregarPlantel(b.dataset.agregar, q));
    });
  } catch (err) {
    cont.innerHTML = `<div class="vacio"><strong>No se pudo buscar</strong>${escapar(err.message)}</div>`;
  }
}

async function agregarPlantel(codigo, qActual) {
  try {
    const resp = await RAC.post(`/api/inspecciones/planes/${PLAN_ABIERTO.plan.id}/planteles`, { codigo_dea: codigo });
    mostrarToast(resp.accion === "reutilizada"
      ? "Plantel agregado: se reutilizó su inspección guardada."
      : "Plantel agregado con una inspección nueva.");
    await recargarPlan();
    buscarPlanteles(qActual);
  } catch (err) {
    mostrarToast(err.message, true);
  }
}

async function desenlazar(inspeccionId, nombre) {
  const seguro = window.confirm(
    `¿Desenlazar «${nombre}» de este plan?\n\nNo se borra nada: sus cantidades quedan guardadas, en espera de una futura rehabilitación.\n\nSi el plantel tiene este plan escrito en su columna de GESCOLAR («PLAN <nombre del plan>»), se quitará de ahí también (TIPO ATENCION y los otros planes no se tocan).`
  );
  if (!seguro) return;
  try {
    const r = await RAC.post(`/api/inspecciones/planes/${PLAN_ABIERTO.plan.id}/planteles/${inspeccionId}/desenlazar`, {});
    mostrarToast(r && r.gescolar === "limpiado"
      ? "Plantel desenlazado y quitado de la columna del plan en GESCOLAR. Su inspección quedó en espera."
      : "Plantel desenlazado. Su inspección quedó en espera.");
    await recargarPlan();
    const q = document.getElementById("qPlantel");
    if (q && q.value.trim().length >= 2) buscarPlanteles(q.value.trim());
  } catch (err) {
    mostrarToast(err.message, true);
  }
}

async function reenlazar(inspeccionId) {
  try {
    await RAC.post(`/api/inspecciones/planes/${PLAN_ABIERTO.plan.id}/planteles/${inspeccionId}/reenlazar`, {});
    mostrarToast("Plantel enlazado de nuevo.");
    await recargarPlan();
    const q = document.getElementById("qPlantel");
    if (q && q.value.trim().length >= 2) buscarPlanteles(q.value.trim());
  } catch (err) {
    mostrarToast(err.message, true);
  }
}

// ---------------------------------------------------------------------------
// Modal: crear / editar plan y cerrar / reabrir
// ---------------------------------------------------------------------------

const modalPlanFondo = document.getElementById("modalPlanFondo");
const formPlan = document.getElementById("formPlan");
const errorModalPlan = document.getElementById("errorModalPlan");

function abrirModalPlan(modo) {
  MODO_MODAL = modo;
  errorModalPlan.classList.remove("visible");
  formPlan.reset();
  document.getElementById("modalPlanTitulo").textContent = modo === "crear" ? "Nuevo plan de atención" : "Editar plan";
  document.getElementById("modalPlanSubtitulo").style.display = modo === "crear" ? "" : "none";
  document.getElementById("btnGuardarPlan").textContent = modo === "crear" ? "Crear plan" : "Guardar cambios";
  if (modo === "editar" && PLAN_ABIERTO) {
    document.getElementById("planNombre").value = PLAN_ABIERTO.plan.nombre || "";
    document.getElementById("planDescripcion").value = PLAN_ABIERTO.plan.descripcion || "";
  }
  modalPlanFondo.classList.add("visible");
  document.getElementById("planNombre").focus();
}

function cerrarModalPlan() {
  modalPlanFondo.classList.remove("visible");
}

document.getElementById("btnCancelarPlan").addEventListener("click", cerrarModalPlan);
modalPlanFondo.addEventListener("click", (e) => {
  if (e.target === modalPlanFondo) cerrarModalPlan();
});

formPlan.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorModalPlan.classList.remove("visible");
  const boton = document.getElementById("btnGuardarPlan");
  const textoBoton = boton.textContent;
  boton.disabled = true;
  boton.textContent = "Guardando…";

  const datos = {
    nombre: document.getElementById("planNombre").value.trim(),
    descripcion: document.getElementById("planDescripcion").value.trim(),
  };
  try {
    if (MODO_MODAL === "crear") {
      const resp = await RAC.post("/api/inspecciones/planes", datos);
      mostrarToast("Plan creado.");
      cerrarModalPlan();
      window.location.hash = `#plan-${resp.plan.id}`;
    } else {
      await RAC.patch(`/api/inspecciones/planes/${PLAN_ABIERTO.plan.id}`, datos);
      mostrarToast("Plan actualizado.");
      cerrarModalPlan();
      await abrirPlan(PLAN_ABIERTO.plan.id);
    }
  } catch (err) {
    errorModalPlan.textContent = err.message;
    errorModalPlan.classList.add("visible");
  } finally {
    boton.disabled = false;
    boton.textContent = textoBoton;
  }
});

async function cambiarEstadoPlan() {
  const { plan } = PLAN_ABIERTO;
  const nuevo = plan.estado === "ACTIVO" ? "CERRADO" : "ACTIVO";
  if (nuevo === "CERRADO" && !window.confirm("¿Cerrar este plan? No se podrán agregar ni quitar planteles hasta reabrirlo.")) return;
  try {
    await RAC.patch(`/api/inspecciones/planes/${plan.id}`, { estado: nuevo });
    mostrarToast(nuevo === "CERRADO" ? "Plan cerrado." : "Plan reabierto.");
    await abrirPlan(plan.id);
  } catch (err) {
    mostrarToast(err.message, true);
  }
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function etiqueta(texto, color, fondo) {
  return `<span style="display:inline-block; padding:2px 9px; border-radius:999px; font-size:.72rem; font-weight:600; color:${color}; background:${fondo};">${escapar(texto)}</span>`;
}

function etiquetaEstado(estado) {
  return estado === "ACTIVO" ? etiqueta("Activo", "#2f855a", "#e6f4ea") : etiqueta("Cerrado", "#b7791f", "#fefcbf");
}

function fecha(valor) {
  if (!valor) return "—";
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("es-VE");
}

function escapar(valor) {
  if (valor === undefined || valor === null) return "";
  return String(valor)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
