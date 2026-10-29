// instrumento-uno-visita.js — llenado del INSTRUMENTO UNO CDCE por pasos.
// Las preguntas vienen del servidor (/api/inspecciones/instrumento-uno/esquema): aquí solo se dibujan.
// Los datos de GESCOLAR llegan precargados para confirmarlos o corregirlos; lo corregido queda marcado
// «· editado» y solo se guarda en el instrumento. Hay borrador automático en este equipo (por si se
// corta la señal): se recupera al volver a abrir la visita.

const usuario = renderShell("inspecciones-iu", "Instrumento Uno CDCE");
const BASE = "/api/inspecciones/instrumento-uno";
const VISITA_ID = Number(new URLSearchParams(window.location.search).get("id"));
const CLAVE_BORRADOR = () => `iu_borrador_${usuario ? usuario.id : 0}_${VISITA_ID}`;

let ESQ = null;          // esquema (preguntas)
let V = null;            // visita
let EDIFICIO = null;     // edificio actual de la visita (si ya se envió)
let datos = {};          // respuestas en pantalla
let fecha = "";
let paso = 0;
let errores = {};
let editable = false;
let resultado = null;    // respuesta del envío (pantalla final)
let infoEdificioPlantel = null; // edificio al que ya pertenece el plantel (consulta previa)
let temporizador = null;
const infoFilas = {};    // mensajes de la búsqueda de cada institución

if (usuario) iniciar();

function escapar(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function api(metodo, ruta, cuerpo) {
  let resp;
  try {
    resp = await fetch(ruta, {
      method: metodo,
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + RAC.getToken() },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
  } catch (_) {
    throw new Error("Sin conexión. Lo que escribiste está guardado como borrador en este equipo; vuelve a intentar cuando tengas señal.");
  }
  if (resp.status === 401) { RAC.cerrarSesion(); throw new Error("Sesión expirada."); }
  let data = null;
  try { data = await resp.json(); } catch (_) { /* sin cuerpo */ }
  if (!resp.ok) {
    const e = new Error((data && data.error) || `Error ${resp.status}`);
    e.errores = (data && data.errores) || null;
    throw e;
  }
  return data;
}

function seccionesCampos() {
  return ESQ.secciones.map((s) => {
    const campos = [...s.campos];
    (s.grupos || []).forEach((g) => campos.push(...g.campos));
    return campos;
  });
}
function seccionDeError(clave) {
  if (clave === "fecha_visita") return 0;
  if (clave.startsWith("otras_instituciones")) return 3;
  const i = seccionesCampos().findIndex((cs) => cs.some((c) => c.clave === clave));
  return i === -1 ? 0 : i;
}

async function iniciar() {
  const contenido = document.getElementById("contenido");
  if (!VISITA_ID) { contenido.innerHTML = `<div class="panel"><div class="vacio"><strong>Falta la visita</strong><a href="/inspecciones/instrumento-uno.html">Volver a las visitas</a></div></div>`; return; }
  contenido.innerHTML = `<div class="cargando">Cargando…</div>`;
  try {
    const [esq, vis] = await Promise.all([api("GET", `${BASE}/esquema`), api("GET", `${BASE}/visitas/${VISITA_ID}`)]);
    ESQ = esq;
    V = vis.visita;
    EDIFICIO = vis.edificio;
    datos = JSON.parse(JSON.stringify(V.datos || {}));
    if (!Array.isArray(datos.otras_instituciones)) datos.otras_instituciones = [];
    fecha = V.fecha_visita || new Date().toISOString().slice(0, 10);
    editable = V.puede_editar;
    recuperarBorrador();
    pintar();
    api("GET", `${BASE}/plantel/${encodeURIComponent(V.codigo_dea)}`).then((p) => { infoEdificioPlantel = p.edificio; if (paso === 3) pintarEdificioInfo(); }).catch(() => {});
  } catch (err) {
    contenido.innerHTML = `<div class="panel"><div class="vacio"><strong>No se pudo abrir la visita</strong>${escapar(err.message)}<br><a href="/inspecciones/instrumento-uno.html">Volver a las visitas</a></div></div>`;
  }
}

// ---- Borrador en este equipo ----
let hayBorradorRecuperado = false;
function recuperarBorrador() {
  if (!editable) return;
  try {
    const raw = localStorage.getItem(CLAVE_BORRADOR());
    if (!raw) return;
    const b = JSON.parse(raw);
    if (b && b.datos && Number(b.guardadoEn) > new Date(V.actualizado_en).getTime()) {
      datos = b.datos;
      if (!Array.isArray(datos.otras_instituciones)) datos.otras_instituciones = [];
      if (b.fecha) fecha = b.fecha;
      hayBorradorRecuperado = true;
    }
  } catch (_) { /* sin almacenamiento: no pasa nada */ }
}
function guardarBorradorLocal() {
  if (!editable) return;
  clearTimeout(temporizador);
  temporizador = setTimeout(() => {
    try { localStorage.setItem(CLAVE_BORRADOR(), JSON.stringify({ datos, fecha, guardadoEn: Date.now() })); } catch (_) { /* nada */ }
  }, 300);
}
function borrarBorradorLocal() {
  clearTimeout(temporizador); // un guardado pendiente no debe revivir el borrador ya enviado al servidor
  try { localStorage.removeItem(CLAVE_BORRADOR()); } catch (_) { /* nada */ }
}

// ---- Dibujo ----
function nombreVisita() {
  return datos.nombre_plantel || (V.gescolar && V.gescolar.nombre_plantel) || V.codigo_dea;
}

function pintar() {
  const contenido = document.getElementById("contenido");
  if (resultado) { pintarResultado(contenido); return; }
  const sec = ESQ.secciones[paso];
  const pasosHtml = ESQ.secciones.map((s, i) => {
    const conError = Object.keys(errores).some((k) => seccionDeError(k) === i);
    return `<button type="button" class="iu-paso ${i === paso ? "activo" : ""} ${conError ? "error" : ""}" data-paso="${i}"><b>Paso ${i + 1}</b>${escapar(s.titulo)}</button>`;
  }).join("");
  contenido.innerHTML = `
    <section class="planteles-hero">
      <div class="planteles-hero-copy">
        <span class="planteles-eyebrow">INSTRUMENTO UNO CDCE</span>
        <h1>${escapar(nombreVisita())}</h1>
        <p>Código DEA <strong>${escapar(V.codigo_dea)}</strong> · ${V.estado === "ENVIADA" ? "Enviada" : "Borrador"}${V.ingeniero ? " · " + escapar(V.ingeniero) : ""}</p>
      </div>
    </section>
    ${hayBorradorRecuperado ? `<div class="iu-borrador"><span>Se recuperó un borrador guardado en este equipo que aún no estaba en el servidor.</span><button type="button" class="btn btn-fantasma btn-sm" id="btnDescartarBorrador">Descartar y usar lo del servidor</button></div>` : ""}
    ${!editable ? `<div class="iu-aviso">Solo lectura: ${V.estado === "ENVIADA" ? "esta visita ya fue enviada." : "no tienes permiso para modificar esta visita."}</div>` : ""}
    <div class="iu-pasos">${pasosHtml}</div>
    <div class="panel"><div class="iu-bloque" id="iuBloque">
      <h2>${escapar(sec.titulo)}</h2>
      <p class="iu-ayuda">${escapar(sec.ayuda || "")}</p>
      ${paso === 0 ? campoFecha() : ""}
      <div id="iuCampos" class="iu-dos">${sec.campos.map(campoHtml).join("")}</div>
      ${(sec.grupos || []).map(grupoHtml).join("")}
      ${sec.id === "infraestructura" ? `<div class="iu-aviso" id="avisoAulas" style="display:none;"></div>` : ""}
      ${sec.lista ? listaHtml() : ""}
    </div></div>
    <div class="iu-barra">
      <div class="izq">
        <button type="button" class="btn btn-fantasma" id="btnAnterior" ${paso === 0 ? "disabled" : ""}>← Anterior</button>
        ${paso < ESQ.secciones.length - 1 ? `<button type="button" class="btn btn-primario" id="btnSiguiente">Siguiente →</button>` : ""}
      </div>
      <div class="der">
        <a class="btn btn-fantasma" href="/inspecciones/instrumento-uno.html">Salir</a>
        ${V.puede_eliminar ? `<button type="button" class="btn btn-fantasma" id="btnEliminar" style="color:#b3261e;">Eliminar</button>` : ""}
        ${editable && V.estado === "BORRADOR" ? `<button type="button" class="btn btn-fantasma" id="btnBorrador">Guardar borrador</button>` : ""}
        ${editable && paso === ESQ.secciones.length - 1 ? `<button type="button" class="btn btn-primario" id="btnEnviar">${V.estado === "ENVIADA" ? "Guardar cambios (reenviar)" : "Enviar visita"}</button>` : ""}
      </div>
    </div>`;
  enganchar();
  actualizarDependencias();
  if (sec.id === "edificio") pintarEdificioInfo();
}

function campoFecha() {
  return `<div class="iu-campo ${errores.fecha_visita ? "con-error" : ""}"><label for="f_fecha_visita">Fecha de la visita</label>
    <input type="date" id="f_fecha_visita" value="${escapar(fecha)}" ${editable ? "" : "disabled"}>${errores.fecha_visita ? `<div class="iu-msg-error">${escapar(errores.fecha_visita)}</div>` : ""}</div>`;
}

function insigniaEditado(c) {
  const original = V.gescolar && Object.prototype.hasOwnProperty.call(V.gescolar, c.clave) ? V.gescolar[c.clave] : null;
  if (original === null || c.tipo === "multi") return "";
  const actual = datos[c.clave] === undefined ? "" : String(datos[c.clave]);
  if (actual === String(original)) return "";
  return `<span class="iu-edit">· editado</span>${editable ? `<button type="button" class="iu-restablecer" data-reset="${escapar(c.clave)}">Restablecer desde GESCOLAR</button>` : ""}`;
}

function entradaHtml(c) {
  const id = `f_${c.clave}`;
  const v = datos[c.clave];
  const dis = editable ? "" : "disabled";
  if (c.tipo === "parrafo") return `<textarea id="${id}" data-clave="${c.clave}" ${dis}>${escapar(v || "")}</textarea>`;
  if (c.tipo === "select") {
    return `<select id="${id}" data-clave="${c.clave}" ${dis}><option value="">— Elegir —</option>${c.opciones.map((o) => `<option value="${escapar(o.valor)}" ${v === o.valor ? "selected" : ""}>${escapar(o.etiqueta)}</option>`).join("")}</select>`;
  }
  if (c.tipo === "multi") {
    const marcados = Array.isArray(v) ? v : [];
    return `<div class="iu-multi" id="${id}">${c.opciones.map((o) => `<label><input type="checkbox" data-multi="${c.clave}" value="${escapar(o.valor)}" ${marcados.includes(o.valor) ? "checked" : ""} ${dis}> ${escapar(o.etiqueta)}</label>`).join("")}</div>`;
  }
  if (c.tipo === "entero") {
    return `<input type="number" id="${id}" data-clave="${c.clave}" inputmode="numeric" step="1" ${c.min !== undefined ? `min="${c.min}"` : ""} ${c.max !== undefined ? `max="${c.max}"` : ""} value="${escapar(v === undefined ? "" : v)}" ${dis}>`;
  }
  const tipo = c.tipo === "correo" ? "email" : "text";
  const modo = c.patron && /\\d/.test(c.patron) ? 'inputmode="numeric"' : "";
  return `<input type="${tipo}" id="${id}" data-clave="${c.clave}" ${modo} value="${escapar(v || "")}" autocomplete="off" ${dis}>`;
}

function campoHtml(c) {
  const err = errores[c.clave];
  return `<div class="iu-campo ${err ? "con-error" : ""} ${c.tipo === "parrafo" ? "iu-ancho" : ""}" id="fld-${c.clave}">
    <label for="f_${c.clave}">${escapar(c.etiqueta)}${c.obligatorio ? ` <span class="req">*</span>` : ""}<span data-slot="${c.clave}">${insigniaEditado(c)}</span></label>
    ${entradaHtml(c)}
    ${c.ayuda ? `<div class="iu-nota">${escapar(c.ayuda)}</div>` : ""}
    <div class="iu-msg-error" data-error="${c.clave}">${err ? escapar(err) : ""}</div>
  </div>`;
}

function grupoHtml(g) {
  if (g.id === "secciones") return `<div class="iu-grupo"><h3>${escapar(g.titulo)}</h3><p class="iu-ayuda">${escapar(g.ayuda || "")}</p><div id="grp-secciones"></div></div>`;
  return `<div class="iu-grupo"><h3>${escapar(g.titulo)}</h3><p class="iu-ayuda">${escapar(g.ayuda || "")}</p>
    <div class="iu-rejilla ${g.id.startsWith("legal") ? "ancha" : ""}">${g.campos.map(campoHtml).join("")}</div>
    ${g.id === "matricula" ? `<div class="iu-total">Total de matrícula: <strong id="totalMatricula">0</strong></div>` : ""}</div>`;
}

function pintarGrupoSecciones() {
  const cont = document.getElementById("grp-secciones");
  if (!cont) return;
  const g = ESQ.secciones[0].grupos.find((x) => x.id === "secciones");
  const visibles = g.campos.filter((c) => Number(datos[c.dependeDe]) > 0);
  cont.innerHTML = visibles.length
    ? `<div class="iu-rejilla">${visibles.map(campoHtml).join("")}</div>`
    : `<div class="iu-nota">Escribe primero la matrícula: aquí aparecerán los niveles que tengan estudiantes.</div>`;
}

function listaHtml() {
  const err = errores.otras_instituciones;
  return `<div class="iu-grupo"><h3>${escapar(ESQ.secciones[3].lista.etiqueta)}</h3>
    <div id="iuEdificioInfo"></div>
    <div id="iuListaWrap" style="display:none;">
      <p class="iu-ayuda">Escribe el código DEA de la otra institución y pulsa Buscar: se trae su nombre de GESCOLAR. Si no tiene código, escribe solo el nombre.</p>
      <div id="iuLista"></div>
      ${editable ? `<button type="button" class="btn btn-fantasma btn-sm" id="btnAgregarInst">+ Agregar otra institución</button>` : ""}
      <div class="iu-msg-error" id="errLista">${err ? escapar(err) : ""}</div>
    </div></div>`;
}

function pintarLista() {
  const cont = document.getElementById("iuLista");
  if (!cont) return;
  cont.innerHTML = datos.otras_instituciones.map((o, i) => {
    const e = errores[`otras_instituciones.${i}`];
    return `<div class="iu-inst" data-fila="${i}">
      <div><input type="text" placeholder="Código DEA" data-inst-codigo="${i}" value="${escapar(o.codigo_dea || "")}" ${editable ? "" : "disabled"}>${editable ? `<button type="button" class="btn btn-fantasma btn-sm" data-buscar="${i}" style="margin-top:6px;">Buscar</button>` : ""}</div>
      <div><input type="text" placeholder="Nombre de la institución" data-inst-nombre="${i}" value="${escapar(o.nombre || "")}" ${editable ? "" : "disabled"}>
        <div class="iu-sugerencias" data-sug="${i}" style="display:none;"></div>
        <div class="iu-nota" data-info-fila="${i}">${escapar(infoFilas[i] || "")}</div>
        ${e ? `<div class="iu-msg-error">${escapar(e)}</div>` : ""}</div>
      ${editable ? `<button type="button" class="btn btn-fantasma btn-sm" data-quitar="${i}">Quitar</button>` : "<span></span>"}
    </div>`;
  }).join("") || `<div class="iu-nota">Todavía no has agregado ninguna.</div>`;
}

function pintarEdificioInfo() {
  const cont = document.getElementById("iuEdificioInfo");
  if (!cont) return;
  const e = EDIFICIO || infoEdificioPlantel;
  cont.innerHTML = e
    ? `<div class="iu-aviso">Este plantel ya figura en el edificio <strong>${escapar(e.codigo_infraestructura)}</strong> con ${e.cantidad} nombre${e.cantidad === 1 ? "" : "s"}: ${e.miembros.map((m) => escapar(m.nombre || m.codigo_dea)).join(" · ")}.</div>`
    : "";
}

function actualizarDependencias() {
  // total de matrícula, secciones por nivel, cancha techada, suma de aulas y lista de instituciones
  const sec = ESQ.secciones[paso];
  if (sec.id === "plantel") {
    const total = ESQ.niveles.reduce((s, n) => s + (Number(datos[`matricula_${n.clave}`]) || 0), 0);
    const t = document.getElementById("totalMatricula");
    if (t) t.textContent = total.toLocaleString("es-VE");
    pintarGrupoSecciones();
  }
  if (sec.id === "infraestructura") {
    const canchas = (Number(datos.canchas_operativas) || 0) + (Number(datos.canchas_no_operativas) || 0);
    const f = document.getElementById("fld-cancha_techada");
    if (f) f.style.display = canchas > 0 ? "" : "none";
    const t = Number(datos.aulas_total), o = Number(datos.aulas_operativas), n = Number(datos.aulas_no_operativas);
    const av = document.getElementById("avisoAulas");
    if (av) {
      const sumaMal = datos.aulas_total !== undefined && datos.aulas_operativas !== undefined && datos.aulas_no_operativas !== undefined && [t, o, n].every(Number.isFinite) && o + n !== t;
      av.style.display = sumaMal ? "" : "none";
      av.textContent = sumaMal ? "Las aulas operativas y NO operativas no suman el total de aulas. Revísalo." : "";
    }
  }
  if (sec.id === "legal") {
    seccionesCampos()[paso].filter((c) => c.visibleSi).forEach((c) => {
      const f = document.getElementById(`fld-${c.clave}`);
      if (f) f.style.display = c.visibleSi.valores.includes(datos[c.visibleSi.clave]) ? "" : "none";
    });
  }
  if (sec.id === "edificio") {
    const wrap = document.getElementById("iuListaWrap");
    if (wrap) wrap.style.display = datos.comparte_edificio === "SI" ? "" : "none";
    pintarLista();
  }
}

// ---- Eventos ----
function enganchar() {
  const bloque = document.getElementById("iuBloque");
  const contenido = document.getElementById("contenido");
  contenido.querySelectorAll("[data-paso]").forEach((b) => b.addEventListener("click", () => irA(Number(b.dataset.paso))));
  const q = (id) => document.getElementById(id);
  if (q("btnAnterior")) q("btnAnterior").addEventListener("click", () => irA(paso - 1));
  if (q("btnSiguiente")) q("btnSiguiente").addEventListener("click", () => irA(paso + 1));
  if (q("btnBorrador")) q("btnBorrador").addEventListener("click", () => guardar(false));
  if (q("btnEliminar")) q("btnEliminar").addEventListener("click", eliminarVisita);
  if (q("btnEnviar")) q("btnEnviar").addEventListener("click", () => guardar(true));
  if (q("btnDescartarBorrador")) q("btnDescartarBorrador").addEventListener("click", () => {
    borrarBorradorLocal(); hayBorradorRecuperado = false;
    datos = JSON.parse(JSON.stringify(V.datos || {})); if (!Array.isArray(datos.otras_instituciones)) datos.otras_instituciones = [];
    fecha = V.fecha_visita; pintar();
  });
  if (q("f_fecha_visita")) q("f_fecha_visita").addEventListener("input", (e) => { fecha = e.target.value; guardarBorradorLocal(); });

  const alCambiar = (e) => {
    const t = e.target;
    if (t.dataset.clave) {
      datos[t.dataset.clave] = t.value;
      const slot = bloque.querySelector(`[data-slot="${t.dataset.clave}"]`);
      const c = buscarCampo(t.dataset.clave);
      if (slot && c) slot.innerHTML = insigniaEditado(c);
      quitarError(t.dataset.clave);
      actualizarDependencias();
    } else if (t.dataset.multi) {
      const k = t.dataset.multi;
      const marcados = [...bloque.querySelectorAll(`[data-multi="${k}"]:checked`)].map((x) => x.value);
      datos[k] = marcados;
      quitarError(k);
    } else if (t.dataset.instCodigo !== undefined) {
      datos.otras_instituciones[Number(t.dataset.instCodigo)].codigo_dea = t.value.trim().toUpperCase();
    } else if (t.dataset.instNombre !== undefined) {
      const i = Number(t.dataset.instNombre);
      datos.otras_instituciones[i].nombre = t.value;
      sugerir(i, t.value);
    } else return;
    guardarBorradorLocal();
  };
  bloque.addEventListener("input", alCambiar);
  bloque.addEventListener("change", (e) => { if (e.target.tagName === "SELECT" || e.target.type === "checkbox") alCambiar(e); });
  bloque.addEventListener("click", async (e) => {
    const sug = e.target.closest("[data-elegir]");
    if (sug) { e.stopPropagation(); elegirSugerencia(Number(sug.dataset.fila), Number(sug.dataset.elegir)); return; }
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.reset) {
      const k = b.dataset.reset;
      datos[k] = V.gescolar[k];
      const inp = document.getElementById(`f_${k}`);
      if (inp) inp.value = datos[k];
      const slot = bloque.querySelector(`[data-slot="${k}"]`);
      if (slot) slot.innerHTML = "";
      actualizarDependencias();
      guardarBorradorLocal();
    } else if (b.id === "btnAgregarInst") {
      datos.otras_instituciones.push({ codigo_dea: "", nombre: "" });
      pintarLista(); guardarBorradorLocal();
    } else if (b.dataset.quitar !== undefined) {
      datos.otras_instituciones.splice(Number(b.dataset.quitar), 1);
      Object.keys(infoFilas).forEach((k) => delete infoFilas[k]);
      pintarLista(); guardarBorradorLocal();
    } else if (b.dataset.buscar !== undefined) {
      await buscarInstitucion(Number(b.dataset.buscar));
    }
  });
}

function buscarCampo(clave) {
  for (const cs of seccionesCampos()) { const c = cs.find((x) => x.clave === clave); if (c) return c; }
  return null;
}

function quitarError(clave) {
  if (!errores[clave]) return;
  delete errores[clave];
  const f = document.getElementById(`fld-${clave}`);
  if (f) f.classList.remove("con-error");
  const m = document.querySelector(`[data-error="${clave}"]`);
  if (m) m.textContent = "";
}

async function buscarInstitucion(i) {
  const o = datos.otras_instituciones[i];
  const codigo = (o.codigo_dea || "").trim().toUpperCase();
  const info = document.querySelector(`[data-info-fila="${i}"]`);
  if (!codigo) { if (info) info.textContent = "Escribe un código DEA para buscar."; return; }
  if (codigo.toLowerCase() === V.codigo_dea.toLowerCase()) { if (info) info.textContent = "Ese es el mismo plantel de la visita."; return; }
  if (info) info.textContent = "Buscando…";
  try {
    const p = await api("GET", `${BASE}/plantel/${encodeURIComponent(codigo)}`);
    o.codigo_dea = p.codigo_dea;
    o.nombre = p.nombre_plantel;
    infoFilas[i] = p.edificio ? `Ya figura en el edificio ${p.edificio.codigo_infraestructura} (${p.edificio.cantidad} nombres).` : `${p.municipio}${p.parroquia ? " · " + p.parroquia : ""}`;
    delete errores[`otras_instituciones.${i}`];
    pintarLista(); guardarBorradorLocal();
  } catch (err) {
    infoFilas[i] = err.message;
    if (info) info.textContent = err.message;
  }
}

function irA(n) {
  if (n < 0 || n >= ESQ.secciones.length) return;
  paso = n;
  pintar();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---- Guardar / enviar ----
async function guardar(enviar) {
  const botones = document.querySelectorAll("#btnBorrador, #btnEnviar");
  botones.forEach((b) => { b.disabled = true; });
  try {
    const r = await api("PUT", `${BASE}/visitas/${VISITA_ID}`, { datos, fecha_visita: fecha, enviar });
    borrarBorradorLocal();
    hayBorradorRecuperado = false;
    errores = {};
    if (enviar) {
      resultado = r;
      V.estado = "ENVIADA";
      pintar();
      window.scrollTo({ top: 0 });
    } else {
      mostrarToast(r.avisos && r.avisos.length ? "Borrador guardado. " + r.avisos[0] : "Borrador guardado.");
      V.datos = JSON.parse(JSON.stringify(datos));
      V.actualizado_en = new Date().toISOString();
      botones.forEach((b) => { b.disabled = false; });
    }
  } catch (err) {
    botones.forEach((b) => { b.disabled = false; });
    if (err.errores) {
      errores = err.errores;
      const primero = Object.keys(errores).map(seccionDeError).sort((a, b) => a - b)[0];
      if (primero !== undefined) paso = primero;
      pintar();
      mostrarToast(`${err.message} (${Object.keys(errores).length} campo${Object.keys(errores).length === 1 ? "" : "s"})`, true);
      const primerError = document.querySelector(".con-error, .iu-msg-error:not(:empty)");
      if (primerError) primerError.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      mostrarToast(err.message, true);
    }
  }
}

function pintarResultado(contenido) {
  const r = resultado;
  const e = r.edificio;
  const hoja = {
    ok: "El código también quedó registrado en la hoja «Coordenadas Planteles».",
    pendiente: "El código se guardó en el sistema, pero no se pudo escribir en la hoja «Coordenadas Planteles» (Google no respondió). Abre la visita y pulsa «Guardar cambios (reenviar)» para reintentarlo.",
    no_configurada: "La hoja «Coordenadas Planteles» no está configurada en el servidor; el código quedó solo en el sistema.",
    no_aplica: "",
  }[r.hoja_coordenadas] || "";
  contenido.innerHTML = `
    <section class="planteles-hero"><div class="planteles-hero-copy"><span class="planteles-eyebrow">INSTRUMENTO UNO CDCE</span><h1>Visita enviada</h1><p>${escapar(nombreVisita())} · ${escapar(V.codigo_dea)}</p></div></section>
    <div class="iu-resultado">
      <p style="margin:0 0 6px;"><strong>Los datos quedaron guardados.</strong></p>
      ${r.comparte
        ? `<p style="margin:6px 0;">Código de infraestructura del edificio: <code>${escapar(r.codigo_infraestructura)}</code><br>En este edificio funcionan <strong>${e ? e.cantidad : "?"}</strong> nombres:</p>
           <ul class="iu-edificio-lista">${(e ? e.miembros : []).map((m) => `<li>${escapar(m.nombre || "(sin nombre)")}${m.codigo_dea ? ` <small>(${escapar(m.codigo_dea)})</small>` : ""}</li>`).join("")}</ul>`
        : `<p style="margin:6px 0;">Este plantel no comparte edificio. Su código de infraestructura es <code>${escapar(r.codigo_infraestructura)}</code>.</p>`}
      ${hoja ? `<p class="iu-nota" style="margin-top:10px;">${escapar(hoja)}</p>` : ""}
      ${(r.avisos || []).map((a) => `<div class="iu-aviso">${escapar(a)}</div>`).join("")}
      <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:14px;">
        <a class="btn btn-primario" href="/inspecciones/instrumento-uno.html">Nueva visita</a>
        <button type="button" class="btn btn-fantasma" id="btnVolverVisita">Ver la visita</button>
      </div>
    </div>`;
  document.getElementById("btnVolverVisita").addEventListener("click", () => { resultado = null; paso = 0; pintar(); });
}

async function eliminarVisita() {
  const msg = `¿Eliminar esta visita (${nombreVisita()})? Esta acción no se puede deshacer.` +
    (V.estado === "ENVIADA" ? "\n\nEstá ENVIADA: lo que ya se escribió en la hoja «Coordenadas Planteles» no se borra." : "");
  if (!window.confirm(msg)) return;
  try {
    await api("DELETE", `${BASE}/visitas/${VISITA_ID}`);
    borrarBorradorLocal();
    window.location.href = "/inspecciones/instrumento-uno.html";
  } catch (err) {
    mostrarToast(err.message, true);
  }
}

// ---- Búsqueda por nombre dentro de «Otras instituciones» ----
const sugerenciasPorFila = {};
const temporizadoresSug = {};
function sugerir(i, texto) {
  clearTimeout(temporizadoresSug[i]);
  const cont = document.querySelector(`[data-sug="${i}"]`);
  if (!cont) return;
  if (String(texto).trim().length < 3) { cont.style.display = "none"; return; }
  temporizadoresSug[i] = setTimeout(async () => {
    try {
      const r = await api("GET", `${BASE}/buscar?q=${encodeURIComponent(texto.trim())}&excluir=${encodeURIComponent(V.codigo_dea)}`);
      sugerenciasPorFila[i] = r.planteles;
      const c = document.querySelector(`[data-sug="${i}"]`);
      if (!c) return;
      c.innerHTML = r.planteles.length
        ? r.planteles.map((p, k) => `<button type="button" class="iu-sug" data-fila="${i}" data-elegir="${k}"><strong>${escapar(p.nombre_plantel)}</strong><small>${escapar(p.codigo_dea)} · ${escapar(p.municipio)}${p.parroquia ? " · " + escapar(p.parroquia) : ""}</small></button>`).join("") +
          `<div class="iu-nota" style="padding:4px 8px;">¿No está en la lista? Deja el nombre como lo escribiste (sin código).</div>`
        : `<div class="iu-nota" style="padding:6px 8px;">Sin coincidencias en GESCOLAR. Se guardará solo con el nombre que escribiste.</div>`;
      c.style.display = "";
    } catch (_) { /* si falla la búsqueda, se puede seguir escribiendo el nombre a mano */ }
  }, 300);
}
function elegirSugerencia(i, k) {
  const p = (sugerenciasPorFila[i] || [])[k];
  if (!p) return;
  const o = datos.otras_instituciones[i];
  o.codigo_dea = p.codigo_dea;
  o.nombre = p.nombre_plantel;
  delete errores[`otras_instituciones.${i}`];
  infoFilas[i] = `${p.municipio}${p.parroquia ? " · " + p.parroquia : ""}`;
  pintarLista();
  guardarBorradorLocal();
}
