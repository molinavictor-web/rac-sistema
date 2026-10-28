// inspecciones-planilla.js — Inspecciones, etapa 2: planilla de materiales de
// UN plantel (los rubros de la lista oficial agrupados por capítulo).
// Habla con /api/inspecciones/inspeccion/:id
//
// - Las cantidades NO se redondean: se guardan tal cual (hasta 3 decimales,
//   con coma o punto). 0,5 es medio metro cúbico de arena.
// - Borrador automático: lo que escribes se guarda en este equipo mientras
//   trabajas; si se cierra la pestaña o se va la señal, al volver se recupera.
//   Solo se manda al servidor cuando pulsas «Guardar».

const usuario = renderShell("inspecciones-planes", "Planilla de materiales");
const params = new URLSearchParams(window.location.search);
const INSPECCION_ID = Number(params.get("id"));
const PLAN_VOLVER = Number(params.get("plan")) || null;
const MAX_INSPECTORES = 5;
const REGEX_CANTIDAD = /^\d{1,11}([.,]\d{1,3})?$/;
// Datos del encabezado oficial de la planilla. Vienen de GESCOLAR y se pueden corregir.
const CAMPOS_PLANTEL = [
  { clave: "institucion", etiqueta: "Nombre de la institución", ancho: true },
  { clave: "codigo", etiqueta: "Código DEA", fijo: true },
  { clave: "aulas", etiqueta: "Número de aulas", corto: true },
  { clave: "matricula", etiqueta: "Matrícula", corto: true },
  { clave: "director", etiqueta: "Nombre del director" },
  { clave: "telefono", etiqueta: "Teléfono" },
  { clave: "parroquia", etiqueta: "Parroquia" },
  { clave: "municipio", etiqueta: "Municipio" },
  { clave: "direccion", etiqueta: "Dirección", ancho: true },
  { clave: "comuna", etiqueta: "Comuna (si aplica)" },
  { clave: "comunidad", etiqueta: "Comunidad (si aplica)" },
];
const CLAVES_EDITABLES = CAMPOS_PLANTEL.filter((c) => !c.fijo).map((c) => c.clave);

let DATA = null;          // respuesta del servidor
let BASE = {};            // id de rubro -> cantidad guardada en el servidor (número o null)
let ACTUAL = {};          // id de rubro -> texto que hay en pantalla (solo los editados)
let CAB_BASE = null;      // cabecera tal como está en el servidor
let GESCOLAR = {};        // datos del plantel tal como están en GESCOLAR (para restablecer)
let CATALOGO = [];        // catálogo de materiales adicionales (para el autocompletado)
let ADIC_BASE = {};       // id de adicional -> cantidad guardada (número o null)
let ADIC = [];            // filas de adicionales que hay en pantalla: {id, nombre, unidad, estado, texto}
let SOLO_LECTURA = false;
let SIN_PERMISO = false;   // el perfil del usuario no permite editar (consulta, operador de plantel)
const ES_INGENIERO = Boolean(usuario) && usuario.rol === "insp_ingeniero";
let temporizadorBorrador = null;
let guardando = false;

if (usuario) {
  if (!INSPECCION_ID) mostrarError("Falta indicar qué planilla abrir. Entra desde un plan de atención.");
  else cargar();
}

// ---------------------------------------------------------------------------
// Carga
// ---------------------------------------------------------------------------

async function cargar() {
  const contenido = document.getElementById("contenido");
  contenido.innerHTML = `<div class="panel"><div class="cargando">Cargando planilla…</div></div>`;
  try {
    DATA = await RAC.get(`/api/inspecciones/inspeccion/${INSPECCION_ID}`);
  } catch (err) {
    mostrarError(err.message);
    return;
  }
  try {
    CATALOGO = (await RAC.get("/api/inspecciones/adicionales")).adicionales;
  } catch (_) {
    CATALOGO = []; // sin catálogo no hay autocompletado, pero la planilla se puede usar
  }
  BASE = {};
  DATA.rubros.forEach((r) => { BASE[r.id] = r.cantidad; });
  iniciarAdic();
  ACTUAL = {};
  const i = DATA.inspeccion;
  CAB_BASE = {
    fecha: i.fecha_inspeccion || "",
    observaciones: i.observaciones || "",
    estado: i.estado,
    inspectores: i.inspectores.slice(),
    datos: Object.fromEntries(CLAVES_EDITABLES.map((k) => [k, String((i.datos_plantel || {})[k] || "").trim()])),
  };
  GESCOLAR = i.datos_gescolar || {};
  SIN_PERMISO = Boolean(DATA.permisos) && DATA.permisos.editar === false;
  SOLO_LECTURA = SIN_PERMISO || i.planes.some((p) => p.estado === "CERRADO");
  dibujar();
  recuperarBorrador();
  actualizarBarra();
}

function mostrarError(mensaje) {
  const volver = ES_INGENIERO ? "/inspecciones/mis-planillas.html" : PLAN_VOLVER ? `/inspecciones/planes.html#plan-${PLAN_VOLVER}` : "/inspecciones/planes.html";
  document.getElementById("contenido").innerHTML = `
    <div class="panel"><div class="vacio"><strong>No se pudo abrir la planilla</strong>${escapar(mensaje)}<br><br>
    <a class="btn btn-fantasma btn-sm" href="${volver}">${ES_INGENIERO ? "← Mis planillas" : "← Volver a los planes"}</a></div></div>`;
}

// ---------------------------------------------------------------------------
// Dibujo
// ---------------------------------------------------------------------------

function dibujar() {
  const i = DATA.inspeccion;
  const m = i.membrete || {};
  const nombre = (i.datos_plantel && i.datos_plantel.institucion) || m.nombre_plantel || i.codigo_dea;
  const planes = i.planes.map((p) => p.nombre);
  const planId = PLAN_VOLVER || (i.planes[0] && i.planes[0].id) || null;
  const volver = ES_INGENIERO ? "/inspecciones/mis-planillas.html" : planId ? `/inspecciones/planes.html#plan-${planId}` : "/inspecciones/planes.html";
  const lugar = [CAB_BASE.datos.municipio, CAB_BASE.datos.parroquia].filter(Boolean).join(" · ");

  const filasIng = [];
  for (let k = 0; k < MAX_INSPECTORES; k++) {
    filasIng.push(`
      <div class="pl-ing-fila">
        <span class="orden">${k === 0 ? "RESPONSABLE" : "Ingeniero " + (k + 1)}</span>
        <input type="text" data-ing="${k}" maxlength="120" placeholder="${k === 0 ? "Nombre del ingeniero responsable" : "Opcional"}" value="${escapar(CAB_BASE.inspectores[k] || "")}" ${SOLO_LECTURA ? "disabled" : ""}>
      </div>`);
  }

  const otrosDatos = Object.entries(m)
    .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "")
    .map(([k, v]) => `<div><dt>${escapar(k.replace(/_/g, " "))}</dt><dd>${escapar(v)}</dd></div>`)
    .join("");

  const capitulos = [];
  DATA.rubros.forEach((r) => {
    let cap = capitulos.find((c) => c.nombre === r.capitulo);
    if (!cap) { cap = { nombre: r.capitulo, rubros: [] }; capitulos.push(cap); }
    cap.rubros.push(r);
  });

  const bloques = capitulos.map((c, n) => `
    <details class="pl-cap" open data-cap="${n}">
      <summary><span>${escapar(c.nombre)}</span><small data-conteo="${n}"></small></summary>
      <div class="tabla-responsive">
        <table class="pl-tabla">
          <thead><tr><th class="nro">N.º</th><th>Rubro</th><th class="uni">Unidad</th><th class="can">Cantidad</th></tr></thead>
          <tbody>
            ${c.rubros.map((r) => `
              <tr data-fila="${r.id}" data-cap="${n}" data-texto="${escapar((r.rubro + " " + r.codigo).toLowerCase())}">
                <td class="nro">${r.nro}</td>
                <td>${escapar(r.rubro)}</td>
                <td class="uni">${escapar(r.unidad)}</td>
                <td class="can"><input class="cant" type="text" inputmode="decimal" autocomplete="off" data-id="${r.id}" value="${escapar(texto(r.cantidad))}" aria-label="Cantidad de ${escapar(r.rubro)}" ${SOLO_LECTURA ? "disabled" : ""}></td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </details>`).join("");

  document.getElementById("contenido").innerHTML = `
    <section class="planteles-hero">
      <div class="planteles-hero-copy">
        <span class="planteles-eyebrow">PLANILLA DE MATERIALES · ${escapar(i.codigo_dea)}</span>
        <h1>${escapar(nombre)}</h1>
        <p>${escapar(lugar) || "&nbsp;"}${planes.length ? ` · Plan: ${escapar(planes.join(", "))}` : " · Sin plan (inspección en espera)"}</p>
      </div>
    </section>

    <div class="pl-aviso alerta ${SOLO_LECTURA ? "visible" : ""}" id="avisoCerrado">
      <span>${SIN_PERMISO
        ? "Tu perfil tiene acceso de <strong>solo lectura</strong>: puedes ver la planilla y descargar el Excel, pero no modificarla."
        : "El plan de este plantel está <strong>cerrado</strong>: puedes ver la planilla pero no modificarla. Reabre el plan para editar."}</span>
    </div>
    <div class="pl-aviso info" id="avisoBorrador">
      <span id="textoBorrador"></span>
      <button type="button" class="btn btn-fantasma btn-sm" id="btnDescartarBorrador">Descartar lo recuperado</button>
    </div>

    <div class="panel" style="margin-bottom:16px;">
      <div style="padding:14px 20px 0; display:flex; gap:10px; flex-wrap:wrap;">
        <a class="btn btn-fantasma btn-sm" href="${volver}">${ES_INGENIERO ? "← Mis planillas" : "← Volver al plan"}</a>
        ${planId && !ES_INGENIERO ? `<a class="btn btn-fantasma btn-sm" href="/inspecciones/consolidado.html?plan=${planId}">Ver consolidado del plan</a>` : ""}
        <button type="button" class="btn btn-fantasma btn-sm" id="btnExcelPlanilla">Descargar Excel</button>
      </div>
      <div class="pl-datos-titulo">
        <h3 style="margin:0;">Datos del plantel</h3>
        <span style="color:var(--rac-muted,#718198); font-size:.78rem;">Vienen de GESCOLAR. Corrígelos aquí si hace falta: solo cambia esta planilla.</span>
        ${SOLO_LECTURA ? "" : `<button type="button" class="btn btn-fantasma btn-sm" id="btnRestablecer">Restablecer desde GESCOLAR</button>`}
      </div>
      <div class="pl-cab" id="datosPlantel">
        ${CAMPOS_PLANTEL.map((c) => `
          <div class="campo${c.ancho ? " ancho" : ""}">
            <label for="dp_${c.clave}">${escapar(c.etiqueta)} <span class="pl-editado" data-editado="${c.clave}" style="display:none;">· editado</span></label>
            <input type="text" id="dp_${c.clave}" data-dp="${c.clave}" maxlength="${c.clave === "direccion" ? 300 : 200}"
              value="${escapar(c.fijo ? i.codigo_dea : CAB_BASE.datos[c.clave])}" ${c.fijo || SOLO_LECTURA ? "disabled" : ""}>
          </div>`).join("")}
      </div>
      <div class="pl-cab" style="padding-top:0;">
        <div class="campo">
          <label for="cabFecha">Fecha de la inspección</label>
          <input type="date" id="cabFecha" value="${escapar(CAB_BASE.fecha)}" ${SOLO_LECTURA ? "disabled" : ""}>
        </div>
        <div class="campo">
          <label for="cabEstado">Estado de la planilla</label>
          <select id="cabEstado" ${SOLO_LECTURA ? "disabled" : ""}>
            <option value="BORRADOR">Borrador (todavía cargando)</option>
            <option value="CARGADA">Cargada (completa)</option>
          </select>
        </div>
        <div class="campo ancho">
          <label>Ingenieros que inspeccionaron (el primero es el responsable)</label>
          <div class="pl-ing">${filasIng.join("")}</div>
        </div>
        <div class="campo ancho">
          <label for="cabObs">Observaciones</label>
          <textarea id="cabObs" maxlength="1000" ${SOLO_LECTURA ? "disabled" : ""}>${escapar(CAB_BASE.observaciones)}</textarea>
        </div>
      </div>
      ${otrosDatos ? `<div class="pl-membrete"><details><summary>Datos del membrete (copiados de GESCOLAR)</summary><dl>${otrosDatos}</dl></details></div>` : ""}
    </div>

    <div class="panel" style="padding-bottom:0;">
      <div style="padding:16px 20px;">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap;">
          <h3 style="margin:0;">Materiales de la lista oficial · ${DATA.rubros.length} rubros</h3>
          <span id="resumenRubros" style="color:var(--rac-muted,#718198); font-size:.82rem;"></span>
        </div>
        <p style="margin:6px 0 10px; color:var(--rac-muted,#718198); font-size:.82rem;">Escribe solo los rubros que apliquen; deja vacío el resto. Puedes usar coma o punto para decimales (0,5). No se redondea nada. Con <strong>Enter</strong> pasas al siguiente rubro.</p>
        <div class="filtros"><input type="search" id="buscarRubro" placeholder="Buscar un rubro…" style="flex:1; min-width:220px;"></div>
      </div>
      ${bloques}
      <div class="pl-adic" id="seccionAdic">
        <h3 style="margin:0 0 4px;">Materiales adicionales <span class="pl-adic-chip">Fuera de la lista oficial</span></h3>
        <p style="margin:0 0 12px; color:var(--rac-muted,#718198); font-size:.82rem;">Los que <strong>no están</strong> en la lista oficial. Escribe para buscar; si no existe, créalo (queda pendiente hasta que lo apruebe el administrador). Si dejas la cantidad vacía, el material queda anotado pero no suma.</p>
        ${SOLO_LECTURA ? "" : `
        <div class="pl-adic-buscar">
          <input type="search" id="adicBuscar" autocomplete="off" maxlength="200" placeholder="Escribe para buscar o agregar un material…">
          <div class="pl-sug" id="adicSug"></div>
        </div>`}
        <div id="adicLista"></div>
      </div>
      <div class="pl-barra">
        <span class="estado" id="estadoBarra"></span>
        <button type="button" class="btn btn-primario" id="btnGuardar" ${SOLO_LECTURA ? "disabled" : ""}>Guardar</button>
      </div>
    </div>
  `;

  document.getElementById("cabEstado").value = CAB_BASE.estado;
  enlazarEventos();
  pintarAdic();
  enlazarAdic();
  DATA.rubros.forEach((r) => marcarFila(r.id));
  actualizarConteos();
}

function enlazarEventos() {
  const cont = document.getElementById("contenido");
  cont.querySelectorAll("input.cant").forEach((inp) => {
    inp.addEventListener("input", () => alEscribir(inp));
    inp.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const visibles = Array.from(cont.querySelectorAll("tr:not(.oculta) input.cant"));
      const sig = visibles[visibles.indexOf(inp) + 1];
      if (sig) { sig.closest("details").open = true; sig.focus(); sig.select(); }
    });
  });
  ["cabFecha", "cabEstado", "cabObs"].forEach((id) => {
    const el = document.getElementById(id);
    el.addEventListener("input", alCambiarCabecera);
    el.addEventListener("change", alCambiarCabecera);
  });
  cont.querySelectorAll("[data-ing]").forEach((el) => el.addEventListener("input", alCambiarCabecera));
  cont.querySelectorAll("[data-dp]").forEach((el) => el.addEventListener("input", alCambiarCabecera));
  document.getElementById("btnExcelPlanilla").addEventListener("click", (e) => {
    if (Object.keys(ACTUAL).length || cabeceraCambio() || adicCambios().total) {
      mostrarToast("Guarda primero los cambios: el Excel se genera con lo que está guardado.", true);
      return;
    }
    descargarExcel(`/api/inspecciones/inspeccion/${INSPECCION_ID}/planilla.xlsx`, "PLANILLA.xlsx", e.currentTarget);
  });
  const restablecer = document.getElementById("btnRestablecer");
  if (restablecer) restablecer.addEventListener("click", restablecerDesdeGescolar);
  marcarEditados();
  document.getElementById("btnGuardar").addEventListener("click", guardar);
  document.getElementById("btnDescartarBorrador").addEventListener("click", descartarBorrador);
  document.getElementById("buscarRubro").addEventListener("input", filtrar);
}

function filtrar() {
  const q = document.getElementById("buscarRubro").value.trim().toLowerCase();
  document.querySelectorAll("tr[data-fila]").forEach((tr) => {
    tr.classList.toggle("oculta", Boolean(q) && !tr.dataset.texto.includes(q));
  });
  document.querySelectorAll("details.pl-cap").forEach((d) => {
    const hayVisibles = d.querySelector("tr[data-fila]:not(.oculta)");
    d.style.display = hayVisibles ? "" : "none";
    if (q && hayVisibles) d.open = true;
  });
}

// ---------------------------------------------------------------------------
// Edición
// ---------------------------------------------------------------------------

// Texto canónico → número, null (vacío) o NaN (inválido).
function leer(textoCrudo) {
  const t = String(textoCrudo).trim();
  if (t === "") return null;
  if (!REGEX_CANTIDAD.test(t)) return NaN;
  return Number(t.replace(",", "."));
}

function texto(n) {
  return n === null || n === undefined ? "" : String(n).replace(".", ",");
}

function distinto(id) {
  if (!(id in ACTUAL)) return false;
  const v = leer(ACTUAL[id]);
  if (Number.isNaN(v)) return true;
  return v !== BASE[id];
}

function alEscribir(inp) {
  const id = Number(inp.dataset.id);
  ACTUAL[id] = inp.value;
  if (!distinto(id)) delete ACTUAL[id];
  marcarFila(id);
  actualizarConteos();
  actualizarBarra();
  programarBorrador();
}

function marcarFila(id) {
  const tr = document.querySelector(`tr[data-fila="${id}"]`);
  if (!tr) return;
  const inp = tr.querySelector("input.cant");
  tr.classList.toggle("cambiada", id in ACTUAL);
  inp.classList.toggle("malo", id in ACTUAL && Number.isNaN(leer(ACTUAL[id])));
}

function valorMostrado(id) {
  return id in ACTUAL ? leer(ACTUAL[id]) : BASE[id];
}

function actualizarConteos() {
  let con = 0;
  const porCap = {};
  DATA.rubros.forEach((r) => {
    const v = valorMostrado(r.id);
    const tiene = typeof v === "number" && !Number.isNaN(v) && v > 0;
    if (tiene) con++;
    const tr = document.querySelector(`tr[data-fila="${r.id}"]`);
    const n = tr ? tr.dataset.cap : null;
    if (n !== null) {
      porCap[n] = porCap[n] || { total: 0, con: 0 };
      porCap[n].total++;
      if (tiene) porCap[n].con++;
    }
  });
  Object.entries(porCap).forEach(([n, c]) => {
    const el = document.querySelector(`[data-conteo="${n}"]`);
    if (el) el.textContent = `${c.con} de ${c.total} con cantidad`;
  });
  const res = document.getElementById("resumenRubros");
  if (res) res.textContent = `${con} rubro${con === 1 ? "" : "s"} con cantidad`;
}

function cabeceraActual() {
  return {
    fecha: document.getElementById("cabFecha").value || "",
    observaciones: document.getElementById("cabObs").value.trim(),
    estado: document.getElementById("cabEstado").value,
    inspectores: Array.from(document.querySelectorAll("[data-ing]")).map((e) => e.value.trim()).filter(Boolean),
    datos: Object.fromEntries(CLAVES_EDITABLES.map((k) => {
      const el = document.getElementById(`dp_${k}`);
      return [k, el ? el.value.trim() : CAB_BASE.datos[k]];
    })),
  };
}

// Marca con «· editado» los datos que ya no coinciden con GESCOLAR.
function marcarEditados() {
  CLAVES_EDITABLES.forEach((k) => {
    const el = document.getElementById(`dp_${k}`);
    const marca = document.querySelector(`[data-editado="${k}"]`);
    if (!el || !marca) return;
    marca.style.display = el.value.trim() !== String(GESCOLAR[k] || "").trim() ? "" : "none";
  });
}

function restablecerDesdeGescolar() {
  if (!window.confirm("¿Volver todos los datos del plantel a lo que dice GESCOLAR? Se pierden las correcciones que hiciste en esta planilla (al pulsar Guardar).")) return;
  CLAVES_EDITABLES.forEach((k) => {
    const el = document.getElementById(`dp_${k}`);
    if (el) el.value = String(GESCOLAR[k] || "");
  });
  alCambiarCabecera();
}

function cabeceraCambio() {
  return JSON.stringify(cabeceraActual()) !== JSON.stringify({ ...CAB_BASE, observaciones: CAB_BASE.observaciones.trim() });
}

function alCambiarCabecera() {
  marcarEditados();
  actualizarBarra();
  programarBorrador();
}

function hayInvalidos() {
  return Object.keys(ACTUAL).some((id) => Number.isNaN(leer(ACTUAL[id]))) || adicCambios().invalidos > 0;
}

function actualizarBarra() {
  const barra = document.getElementById("estadoBarra");
  if (!barra) return;
  const nCant = Object.keys(ACTUAL).length;
  const nAdic = adicCambios().total;
  const nCab = cabeceraCambio();
  barra.className = "estado";
  if (SOLO_LECTURA) { barra.textContent = SIN_PERMISO ? "Solo lectura." : "Solo lectura (plan cerrado)."; return; }
  if (hayInvalidos()) {
    barra.classList.add("malo");
    barra.textContent = "Hay cantidades con formato inválido (marcadas en rojo). Usa números positivos con hasta 3 decimales.";
    return;
  }
  if (!nCant && !nCab && !nAdic) { barra.textContent = "Todo guardado."; return; }
  barra.classList.add("sucio");
  const partes = [];
  if (nCant) partes.push(`${nCant} cantidad${nCant === 1 ? "" : "es"}`);
  if (nAdic) partes.push(`${nAdic} cambio${nAdic === 1 ? "" : "s"} en adicionales`);
  if (nCab) partes.push("datos de cabecera");
  barra.textContent = `Sin guardar: ${partes.join(" y ")}. Guardado como borrador en este equipo.`;
}

// ---------------------------------------------------------------------------
// Borrador automático (en este equipo)
// ---------------------------------------------------------------------------

const CLAVE_BORRADOR = `sid_planilla_borrador_${INSPECCION_ID}`;

function programarBorrador() {
  clearTimeout(temporizadorBorrador);
  temporizadorBorrador = setTimeout(guardarBorrador, 400);
}

function guardarBorrador() {
  try {
    const sucio = Object.keys(ACTUAL).length || cabeceraCambio() || adicCambios().total;
    if (!sucio) { localStorage.removeItem(CLAVE_BORRADOR); return; }
    localStorage.setItem(CLAVE_BORRADOR, JSON.stringify({
      ts: Date.now(),
      actualizado_en: DATA.inspeccion.actualizado_en,
      cant: ACTUAL,
      adic: ADIC.map((f) => ({ id: f.id, nombre: f.nombre, unidad: f.unidad, estado: f.estado, texto: f.texto })),
      cab: cabeceraActual(),
    }));
  } catch (_) { /* sin almacenamiento: se trabaja igual, solo sin borrador */ }
}

function borrarBorrador() {
  clearTimeout(temporizadorBorrador);
  try { localStorage.removeItem(CLAVE_BORRADOR); } catch (_) { /* nada */ }
}

function recuperarBorrador() {
  if (SOLO_LECTURA) { borrarBorrador(); return; }
  let b = null;
  try { b = JSON.parse(localStorage.getItem(CLAVE_BORRADOR) || "null"); } catch (_) { b = null; }
  if (!b || typeof b !== "object") return;

  let nCant = 0;
  Object.entries(b.cant || {}).forEach(([clave, valor]) => {
    const id = Number(clave);
    if (!(id in BASE) || typeof valor !== "string") return;
    const inp = document.querySelector(`input.cant[data-id="${id}"]`);
    if (!inp) return;
    ACTUAL[id] = valor;
    if (!distinto(id)) { delete ACTUAL[id]; return; }
    inp.value = valor;
    marcarFila(id);
    nCant++;
  });

  let nCab = false;
  if (b.cab && typeof b.cab === "object") {
    const c = b.cab;
    const f = document.getElementById("cabFecha");
    const o = document.getElementById("cabObs");
    const e = document.getElementById("cabEstado");
    if (typeof c.fecha === "string") f.value = c.fecha;
    if (typeof c.observaciones === "string") o.value = c.observaciones;
    if (["BORRADOR", "CARGADA"].includes(c.estado)) e.value = c.estado;
    if (c.datos && typeof c.datos === "object") {
      CLAVES_EDITABLES.forEach((k) => {
        const el = document.getElementById(`dp_${k}`);
        if (el && typeof c.datos[k] === "string") el.value = c.datos[k];
      });
      marcarEditados();
    }
    if (Array.isArray(c.inspectores)) {
      document.querySelectorAll("[data-ing]").forEach((el, k) => { el.value = String(c.inspectores[k] || ""); });
    }
    nCab = cabeceraCambio();
  }

  let nAdic = 0;
  if (Array.isArray(b.adic)) {
    const filas = b.adic
      .filter((f) => f && Number.isInteger(f.id) && typeof f.nombre === "string" && typeof f.texto === "string")
      .map((f) => ({ id: f.id, nombre: f.nombre, unidad: String(f.unidad || ""), estado: String(f.estado || "ACTIVO"), texto: f.texto }));
    const previo = JSON.stringify(ADIC);
    ADIC = filas;
    if (JSON.stringify(ADIC) !== previo) { pintarAdic(); }
    nAdic = adicCambios().total;
  }

  if (!nCant && !nCab && !nAdic) { borrarBorrador(); return; }
  const cuando = new Date(b.ts).toLocaleString("es-VE");
  const aviso = document.getElementById("avisoBorrador");
  document.getElementById("textoBorrador").innerHTML =
    `Recuperé lo que habías escrito sin guardar (${escapar(cuando)}): <strong>${nCant}</strong> cantidad${nCant === 1 ? "" : "es"}${nAdic ? ` y ${nAdic} cambio${nAdic === 1 ? "" : "s"} en adicionales` : ""}${nCab ? " y datos de cabecera" : ""}. Revisa y pulsa <strong>Guardar</strong>.`;
  aviso.classList.add("visible");
  actualizarConteos();
}

function descartarBorrador() {
  borrarBorrador();
  document.getElementById("avisoBorrador").classList.remove("visible");
  ACTUAL = {};
  iniciarAdic();
  dibujar();
  actualizarBarra();
}

window.addEventListener("beforeunload", (e) => {
  if (SOLO_LECTURA || !DATA) return;
  if (Object.keys(ACTUAL).length || cabeceraCambio() || adicCambios().total) { guardarBorrador(); e.preventDefault(); e.returnValue = ""; }
});

// ---------------------------------------------------------------------------
// Guardar
// ---------------------------------------------------------------------------

async function guardar() {
  if (guardando || SOLO_LECTURA) return;
  if (hayInvalidos()) { mostrarToast("Corrige las cantidades marcadas en rojo antes de guardar.", true); return; }
  const ids = Object.keys(ACTUAL);
  const cabCambio = cabeceraCambio();
  const adic = adicCambios();
  if (!ids.length && !cabCambio && !adic.total) { mostrarToast("No hay cambios por guardar."); return; }

  guardando = true;
  const boton = document.getElementById("btnGuardar");
  boton.disabled = true;
  boton.textContent = "Guardando…";
  try {
    if (cabCambio) {
      const c = cabeceraActual();
      await RAC.patch(`/api/inspecciones/inspeccion/${INSPECCION_ID}`, {
        fecha_inspeccion: c.fecha || null,
        observaciones: c.observaciones,
        estado: c.estado,
        inspectores: c.inspectores,
        datos_plantel: c.datos,
      });
      CAB_BASE = { ...c };
    }
    if (ids.length) {
      const cantidades = {};
      ids.forEach((id) => { cantidades[id] = ACTUAL[id].trim(); });
      await RAC.put(`/api/inspecciones/inspeccion/${INSPECCION_ID}/materiales`, { cantidades });
    }
    if (adic.total) {
      await RAC.put(`/api/inspecciones/inspeccion/${INSPECCION_ID}/adicionales`, { cantidades: adic.enviar, quitar: adic.quitar });
    }
    borrarBorrador();
    mostrarToast("Planilla guardada.");
    document.getElementById("avisoBorrador").classList.remove("visible");
    await cargar();
  } catch (err) {
    mostrarToast(`${err.message} Lo que escribiste sigue aquí como borrador.`, true);
    guardarBorrador();
    actualizarBarra();
  } finally {
    guardando = false;
    const b = document.getElementById("btnGuardar");
    if (b) { b.disabled = SOLO_LECTURA; b.textContent = "Guardar"; }
  }
}

// ---------------------------------------------------------------------------
// Materiales adicionales
// ---------------------------------------------------------------------------

const UNIDADES_COMUNES = ["UND", "M", "M2", "M3", "KG", "SACO", "LT", "GLN", "CUÑETE", "ROLLO", "PAR", "JUEGO", "BARRA", "LÁMINA"];

// Sin acentos, sin signos, minúsculas: «Tubo PVC 2"» y «tubo pvc 2» se comparan igual.
function norm(t) {
  return String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function iniciarAdic() {
  ADIC_BASE = {};
  ADIC = (DATA.adicionales || []).map((a) => {
    ADIC_BASE[a.adicional_id] = a.cantidad;
    return { id: a.adicional_id, nombre: a.nombre, unidad: a.unidad, estado: a.estado, texto: texto(a.cantidad) };
  });
}

// Qué hay que mandar al servidor: filas nuevas o con otra cantidad, y las que se quitaron.
function adicCambios() {
  const enviar = {};
  let invalidos = 0;
  ADIC.forEach((f) => {
    const v = leer(f.texto);
    if (Number.isNaN(v)) { invalidos++; return; }
    const esNueva = !(f.id in ADIC_BASE);
    if (esNueva || v !== ADIC_BASE[f.id]) enviar[f.id] = f.texto.trim();
  });
  const enPantalla = new Set(ADIC.map((f) => f.id));
  const quitar = Object.keys(ADIC_BASE).map(Number).filter((id) => !enPantalla.has(id));
  return { enviar, quitar, invalidos, total: Object.keys(enviar).length + quitar.length + invalidos };
}

function pintarAdic() {
  const cont = document.getElementById("adicLista");
  if (!cont) return;
  if (!ADIC.length) {
    cont.innerHTML = `<div class="pl-adic-vacio">Todavía no hay materiales adicionales en esta planilla.</div>`;
    return;
  }
  cont.innerHTML = `<div class="tabla-responsive"><table class="pl-tabla pl-adic-tabla">
    <thead><tr><th>Material</th><th class="uni">Unidad</th><th class="can">Cantidad</th><th class="quitar"></th></tr></thead>
    <tbody>${ADIC.map((f) => `
      <tr data-adic="${f.id}" class="${f.id in ADIC_BASE ? "" : "cambiada"}">
        <td>${escapar(f.nombre)}${f.estado === "PENDIENTE" ? ` <span class="pl-pend" title="Lo propuso un ingeniero; el administrador debe aprobarlo">pendiente de aprobación</span>` : ""}</td>
        <td class="uni">${escapar(f.unidad)}</td>
        <td class="can"><input class="cant adic-cant${Number.isNaN(leer(f.texto)) ? " malo" : ""}" type="text" inputmode="decimal" autocomplete="off" data-aid="${f.id}" value="${escapar(f.texto)}" aria-label="Cantidad de ${escapar(f.nombre)}" ${SOLO_LECTURA ? "disabled" : ""}></td>
        <td class="quitar">${SOLO_LECTURA ? "" : `<button type="button" class="btn btn-fantasma btn-sm" data-quitar="${f.id}" title="Quitar de esta planilla" aria-label="Quitar ${escapar(f.nombre)}">✕</button>`}</td>
      </tr>`).join("")}</tbody></table></div>`;
}

function enlazarAdic() {
  const lista = document.getElementById("adicLista");
  if (!lista) return;
  lista.addEventListener("input", (e) => {
    const inp = e.target.closest("input[data-aid]");
    if (!inp) return;
    const fila = ADIC.find((f) => f.id === Number(inp.dataset.aid));
    if (!fila) return;
    fila.texto = inp.value;
    inp.classList.toggle("malo", Number.isNaN(leer(fila.texto)));
    const tr = inp.closest("tr");
    tr.classList.toggle("cambiada", !(fila.id in ADIC_BASE) || leer(fila.texto) !== ADIC_BASE[fila.id]);
    actualizarBarra();
    programarBorrador();
  });
  lista.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-quitar]");
    if (!b) return;
    ADIC = ADIC.filter((f) => f.id !== Number(b.dataset.quitar));
    pintarAdic();
    actualizarBarra();
    programarBorrador();
  });
  const buscar = document.getElementById("adicBuscar");
  if (!buscar) return;
  // Los clics dentro de la lista de sugerencias no deben cerrarla (el contenido se redibuja al hacer clic).
  document.getElementById("adicSug").addEventListener("click", (e) => e.stopPropagation());
  buscar.addEventListener("input", sugerirAdic);
  buscar.addEventListener("focus", sugerirAdic);
  buscar.addEventListener("keydown", (e) => {
    if (e.key === "Escape") cerrarSug();
    if (e.key === "Enter") {
      e.preventDefault();
      const primera = document.querySelector("#adicSug [data-pick]");
      if (primera) primera.click();
    }
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".pl-adic-buscar")) cerrarSug();
  });
}

function cerrarSug() {
  const sug = document.getElementById("adicSug");
  if (sug) { sug.classList.remove("abierta"); sug.innerHTML = ""; }
}

function sugerirAdic() {
  const sug = document.getElementById("adicSug");
  const q = document.getElementById("adicBuscar").value.trim();
  if (!sug) return;
  if (q.length < 2) { cerrarSug(); return; }
  const palabras = norm(q).split(" ").filter(Boolean);
  const yaEstan = new Set(ADIC.map((f) => f.id));
  const candidatos = CATALOGO.filter((m) => {
    if (yaEstan.has(m.id)) return false;
    const pajar = norm(m.nombre + " " + (m.alias || []).join(" "));
    return palabras.every((w) => pajar.includes(w));
  });
  const nq = norm(q);
  candidatos.sort((a, b) => {
    const pa = norm(a.nombre).startsWith(nq) ? 0 : 1, pb = norm(b.nombre).startsWith(nq) ? 0 : 1;
    return pa - pb || a.nombre.localeCompare(b.nombre, "es");
  });
  const items = candidatos.slice(0, 8).map((m) => `
    <button type="button" class="pl-sug-item" data-pick="${m.id}">
      <span>${escapar(m.nombre)}${m.estado === "PENDIENTE" ? ` <em>(pendiente)</em>` : ""}</span><small>${escapar(m.unidad)}</small>
    </button>`);
  const existeIgual = CATALOGO.some((m) => norm(m.nombre) === nq || (m.alias || []).some((a) => norm(a) === nq));
  const yaAgregado = ADIC.some((f) => norm(f.nombre) === nq);
  if (q.length >= 3 && !existeIgual && !yaAgregado) {
    items.push(`<button type="button" class="pl-sug-item pl-sug-crear" data-crear="1"><span>➕ Crear «${escapar(q)}» como material nuevo</span></button>`);
  }
  if (!items.length) items.push(`<div class="pl-sug-vacio">${yaAgregado || existeIgual ? "Ese material ya está en la planilla." : "Sin coincidencias."}</div>`);
  sug.innerHTML = items.join("");
  sug.classList.add("abierta");
  sug.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => agregarAdic(Number(b.dataset.pick))));
  const crear = sug.querySelector("[data-crear]");
  if (crear) crear.addEventListener("click", () => formularioCrear(q));
}

function agregarAdic(id, enfocar = true) {
  const m = CATALOGO.find((x) => x.id === id);
  if (!m || ADIC.some((f) => f.id === id)) return;
  ADIC.push({ id: m.id, nombre: m.nombre, unidad: m.unidad, estado: m.estado, texto: "" });
  document.getElementById("adicBuscar").value = "";
  cerrarSug();
  pintarAdic();
  actualizarBarra();
  programarBorrador();
  if (enfocar) {
    const inp = document.querySelector(`input[data-aid="${id}"]`);
    if (inp) inp.focus();
  }
}

function formularioCrear(nombreInicial) {
  const sug = document.getElementById("adicSug");
  sug.innerHTML = `
    <div class="pl-crear">
      <strong>Material nuevo</strong>
      <label>Nombre <input type="text" id="nuevoNombre" maxlength="200" value="${escapar(nombreInicial)}"></label>
      <label>Unidad <input type="text" id="nuevaUnidad" maxlength="20" list="listaUnidades" placeholder="Ej.: UND, M, KG"></label>
      <datalist id="listaUnidades">${UNIDADES_COMUNES.map((u) => `<option value="${escapar(u)}">`).join("")}</datalist>
      <div class="pl-crear-botones">
        <button type="button" class="btn btn-primario btn-sm" id="btnCrearAdic">Crear y agregar</button>
        <button type="button" class="btn btn-fantasma btn-sm" id="btnCancelarCrear">Cancelar</button>
      </div>
      <span class="pl-crear-error" id="errorCrear"></span>
    </div>`;
  sug.classList.add("abierta");
  document.getElementById("nuevaUnidad").focus();
  document.getElementById("btnCancelarCrear").addEventListener("click", cerrarSug);
  document.getElementById("btnCrearAdic").addEventListener("click", crearAdic);
}

async function crearAdic() {
  const nombre = document.getElementById("nuevoNombre").value.trim();
  const unidad = document.getElementById("nuevaUnidad").value.trim();
  const error = document.getElementById("errorCrear");
  error.textContent = "";
  if (nombre.length < 3) { error.textContent = "Escribe el nombre del material."; return; }
  if (!unidad) { error.textContent = "Indica la unidad."; return; }
  const boton = document.getElementById("btnCrearAdic");
  boton.disabled = true;
  try {
    const r = await RAC.post("/api/inspecciones/adicionales", { nombre, unidad });
    CATALOGO.push(r.adicional);
    agregarAdic(r.adicional.id);
    mostrarToast(r.adicional.estado === "PENDIENTE" ? "Material creado: queda pendiente de aprobación." : "Material creado.");
  } catch (err) {
    boton.disabled = false;
    error.textContent = err.message;
    // Si ya existía (otro ingeniero lo creó), se busca en el catálogo y se agrega ese
    try { CATALOGO = (await RAC.get("/api/inspecciones/adicionales")).adicionales; } catch (_) { /* nada */ }
    const k = norm(nombre);
    const ya = CATALOGO.find((m) => norm(m.nombre) === k || (m.alias || []).some((x) => norm(x) === k));
    if (ya) agregarAdic(ya.id);
  }
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

// Descarga un Excel generado por el servidor (hace falta enviar el token, por eso no es un simple enlace).
async function descargarExcel(ruta, nombreRespaldo, boton) {
  const textoOriginal = boton.textContent;
  boton.disabled = true;
  boton.textContent = "Generando Excel…";
  try {
    const resp = await fetch(ruta, { headers: { Authorization: "Bearer " + RAC.getToken() } });
    if (resp.status === 401) { RAC.cerrarSesion(); return; }
    if (!resp.ok) {
      let mensaje = `Error ${resp.status}`;
      try { mensaje = (await resp.json()).error || mensaje; } catch (_) { /* sin cuerpo */ }
      throw new Error(mensaje);
    }
    const blob = await resp.blob();
    const m = /filename="([^"]+)"/.exec(resp.headers.get("Content-Disposition") || "");
    const enlace = document.createElement("a");
    enlace.href = URL.createObjectURL(blob);
    enlace.download = m ? m[1] : nombreRespaldo;
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    setTimeout(() => URL.revokeObjectURL(enlace.href), 4000);
  } catch (err) {
    mostrarToast(err.message, true);
  } finally {
    boton.disabled = false;
    boton.textContent = textoOriginal;
  }
}

function escapar(valor) {
  if (valor === undefined || valor === null) return "";
  return String(valor)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
