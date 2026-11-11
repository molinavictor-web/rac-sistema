// inspecciones-consulta-llenar.js — llenar una consulta exprés: se escribe el código DEA, se traen los datos vigentes
// de las fases de la consulta, se verifican o actualizan y se guarda. Las preguntas salen del esquema del Instrumento Uno
// (el servidor valida todo; aquí solo se muestran los campos y se ocultan los que dependen de otra respuesta).

// Esta misma pantalla la usan el personal (Inspecciones: escribe el código DEA de cualquier plantel) y el DIRECTOR
// (Supervisión: llena solo su plantel, el de su sesión; el servidor ignora cualquier otro código).
const MODO_DIRECTOR = window.location.pathname.startsWith("/supervision/");
const usuario = renderShell(MODO_DIRECTOR ? "supervision-consulta-express" : "inspecciones-consultas", "Llenar consulta");
const API = MODO_DIRECTOR ? "/api/inspecciones/consultas/director" : "/api/inspecciones/consultas";
const VOLVER = MODO_DIRECTOR ? "/supervision/consulta-express.html" : "/inspecciones/consultas.html";
const rutaPlantel = (codigo) => (MODO_DIRECTOR ? `${API}/${idConsulta}` : `${API}/${idConsulta}/plantel/${encodeURIComponent(codigo)}`);
const idConsulta = Number(new URLSearchParams(window.location.search).get("id")) || 0;

function escapar(v) {
  return String(v === undefined || v === null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Como RAC.get/put, pero el error lleva los mensajes por campo (errores) que manda el servidor.
async function api(metodo, ruta, cuerpo) {
  const resp = await fetch(ruta, {
    method: metodo,
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + RAC.getToken() },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
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

let CONSULTA = null;   // {id, nombre, fases, titulos_fases}
let P = null;          // respuesta del plantel abierto
let datos = {};
let errores = {};
let temporizador = null;
const infoFilas = {};          // texto de ayuda por fila de «otras instituciones»
const sugerenciasPorFila = {};
const temporizadoresSug = {};

if (usuario) iniciar();

async function iniciar() {
  const cont = document.getElementById("contenido");
  if (MODO_DIRECTOR) return iniciarDirector(cont);
  if (!idConsulta) { cont.innerHTML = `<div class="panel"><div class="vacio"><strong>Falta elegir la consulta</strong><a href="${VOLVER}">Ir a Consultas exprés</a></div></div>`; return; }
  try {
    const l = await api("GET", `${API}/`);
    CONSULTA = l.consultas.find((c) => c.id === idConsulta);
  } catch (err) {
    cont.innerHTML = `<div class="panel"><div class="iu-msg-error" style="padding:14px;">${escapar(err.message)}</div></div>`;
    return;
  }
  if (!CONSULTA) { cont.innerHTML = `<div class="panel"><div class="vacio"><strong>Esa consulta no existe o está cerrada</strong><a href="${VOLVER}">Volver a Consultas exprés</a></div></div>`; return; }
  cont.innerHTML = `
    <section class="planteles-hero"><div class="planteles-hero-copy">
      <span class="planteles-eyebrow">CONSULTA EXPRÉS</span>
      <h1>${escapar(CONSULTA.nombre)}</h1>
      <p>${CONSULTA.titulos_fases.map(escapar).join(" · ")}</p>
    </div></section>
    <div class="panel iu-bloque" id="buscador">
      <h2>Código DEA del plantel</h2>
      <div class="ce-fila">
        <input type="text" id="codigo" placeholder="Código DEA o parte del nombre" autocomplete="off" style="flex:1;">
        <button type="button" class="btn btn-primario" id="btnAbrir">Abrir plantel</button>
      </div>
      <div id="sugerencias"></div>
      <div class="iu-msg-error" id="errBuscar"></div>
    </div>
    <div id="formulario"></div>`;
  document.getElementById("btnAbrir").addEventListener("click", () => abrir(document.getElementById("codigo").value));
  document.getElementById("codigo").addEventListener("keydown", (e) => { if (e.key === "Enter") abrir(e.target.value); });
  document.getElementById("codigo").addEventListener("input", (e) => {
    clearTimeout(temporizador);
    const q = e.target.value.trim();
    if (q.length < 3) { document.getElementById("sugerencias").innerHTML = ""; return; }
    temporizador = setTimeout(() => sugerir(q), 300);
  });
}

// ---- Director: lista de consultas abiertas y, al elegir una, el formulario de su plantel ----
async function iniciarDirector(cont) {
  let lista;
  try {
    lista = (await api("GET", `${API}/`)).consultas;
  } catch (err) {
    cont.innerHTML = `<div class="panel"><div class="iu-msg-error" style="padding:14px;">${escapar(err.message)}</div></div>`;
    return;
  }
  if (!idConsulta) {
    cont.innerHTML = `
      <section class="planteles-hero"><div class="planteles-hero-copy">
        <span class="planteles-eyebrow">CONSULTA EXPRÉS</span>
        <h1>Consultas abiertas</h1>
        <p>Aquí puedes revisar y actualizar los datos de tu plantel cuando la oficina abre una consulta.</p>
      </div></section>
      ${lista.length
        ? lista.map((c) => `<div class="ce-tarjeta"><h3>${escapar(c.nombre)}</h3>
            ${c.descripcion ? `<p class="iu-ayuda" style="margin:0 0 6px;">${escapar(c.descripcion)}</p>` : ""}
            <div>${c.titulos_fases.map((t) => `<span class="ce-etq">${escapar(t)}</span>`).join("")}</div>
            <div style="margin-top:10px;"><a class="btn btn-primario" style="text-decoration:none;" href="/supervision/consulta-express.html?id=${c.id}">Llenar para mi plantel</a></div></div>`).join("")
        : `<div class="panel"><div class="vacio"><strong>No hay consultas abiertas por ahora</strong>Cuando la oficina abra una, aparecerá aquí.</div></div>`}`;
    return;
  }
  CONSULTA = lista.find((c) => c.id === idConsulta);
  if (!CONSULTA) { cont.innerHTML = `<div class="panel"><div class="vacio"><strong>Esa consulta no existe o ya está cerrada</strong><a href="${VOLVER}">Volver a las consultas</a></div></div>`; return; }
  cont.innerHTML = `
    <section class="planteles-hero"><div class="planteles-hero-copy">
      <span class="planteles-eyebrow">CONSULTA EXPRÉS</span>
      <h1>${escapar(CONSULTA.nombre)}</h1>
      <p>${CONSULTA.titulos_fases.map(escapar).join(" · ")}</p>
    </div></section>
    <div id="formulario"></div>`;
  const form = document.getElementById("formulario");
  form.innerHTML = `<div class="panel"><div class="cargando">Abriendo tu plantel…</div></div>`;
  try {
    P = await api("GET", rutaPlantel());
  } catch (e) {
    form.innerHTML = `<div class="panel"><div class="iu-msg-error" style="padding:14px;">${escapar(e.message)} <a href="${VOLVER}">Volver</a></div></div>`;
    return;
  }
  mostrarPlantel();
}

async function sugerir(q) {
  const box = document.getElementById("sugerencias");
  try {
    const r = await api("GET", `/api/inspecciones/instrumento-uno/buscar?q=${encodeURIComponent(q)}`);
    if (document.getElementById("codigo").value.trim() !== q) return;
    box.innerHTML = r.planteles.length
      ? `<div class="ce-cajasug">${r.planteles.map((p) => `<button type="button" class="ce-sug" data-dea="${escapar(p.codigo_dea)}">${escapar(p.nombre_plantel)}<small>${escapar(p.codigo_dea)} · ${escapar(p.municipio)}${p.parroquia ? " · " + escapar(p.parroquia) : ""}</small></button>`).join("")}</div>`
      : "";
    box.querySelectorAll("[data-dea]").forEach((b) => b.addEventListener("click", () => { document.getElementById("codigo").value = b.dataset.dea; box.innerHTML = ""; abrir(b.dataset.dea); }));
  } catch (_) { box.innerHTML = ""; }
}

async function abrir(codigo) {
  const err = document.getElementById("errBuscar");
  err.textContent = "";
  const c = String(codigo || "").trim();
  if (!c) { err.textContent = "Escribe el código DEA."; return; }
  const form = document.getElementById("formulario");
  form.innerHTML = `<div class="panel"><div class="cargando">Abriendo plantel…</div></div>`;
  try {
    P = await api("GET", rutaPlantel(c));
  } catch (e) {
    form.innerHTML = "";
    err.textContent = e.message;
    return;
  }
  document.getElementById("sugerencias").innerHTML = "";
  mostrarPlantel();
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

// Prepara los datos del plantel abierto (P) y dibuja el formulario.
function mostrarPlantel() {
  datos = JSON.parse(JSON.stringify(P.datos || {}));
  if (P.secciones.some((x) => x.lista) && !Array.isArray(datos.otras_instituciones)) datos.otras_instituciones = [];
  errores = {};
  Object.keys(infoFilas).forEach((k) => delete infoFilas[k]);
  pintar();
}

// ---- Dibujo del formulario ----

function etiquetaOrigen(clave) {
  const m = P.meta && P.meta[clave];
  if (!m) return "";
  if (m.fuente === "gescolar") return `<span class="ce-origen">de GESCOLAR</span>`;
  if (m.fuente === "visita") return `<span class="ce-origen">de la visita</span>`;
  if (m.fuente === "infraestructuras") return `<span class="ce-origen">de Infraestructuras</span>`;
  const f = m.en ? new Date(m.en).toLocaleDateString("es-VE", { day: "2-digit", month: "2-digit" }) : "";
  return `<span class="ce-origen ${m.verificado_campo ? "campo" : ""}">${m.verificado_campo ? "✓ verificado en campo" : "actualizado"} ${escapar(f)}${m.usuario ? " · " + escapar(m.usuario) : ""}</span>`;
}

function opcionesHtml(c, v) {
  const una = (o) => `<option value="${escapar(o.valor)}" ${v === o.valor ? "selected" : ""}>${escapar(o.etiqueta)}</option>`;
  if (!c.opciones.some((o) => o.grupo)) return c.opciones.map(una).join("");
  const grupos = [];
  c.opciones.forEach((o) => { let g = grupos.find((x) => x.nombre === o.grupo); if (!g) { g = { nombre: o.grupo, lista: [] }; grupos.push(g); } g.lista.push(o); });
  return grupos.map((g) => `<optgroup label="${escapar(g.nombre)}">${g.lista.map(una).join("")}</optgroup>`).join("");
}

function entradaHtml(c) {
  const id = `f_${c.clave}`;
  const v = datos[c.clave];
  if (c.tipo === "parrafo") return `<textarea id="${id}" data-clave="${c.clave}">${escapar(v || "")}</textarea>`;
  if (c.tipo === "select") return `<select id="${id}" data-clave="${c.clave}"><option value="">— Elegir —</option>${opcionesHtml(c, v)}</select>`;
  if (c.tipo === "multi") {
    const marcados = Array.isArray(v) ? v : [];
    return `<div class="iu-multi" id="${id}">${c.opciones.map((o) => `<label><input type="checkbox" data-multi="${c.clave}" value="${escapar(o.valor)}" ${marcados.includes(o.valor) ? "checked" : ""}> ${escapar(o.etiqueta)}</label>`).join("")}</div>`;
  }
  if (c.tipo === "entero") return `<input type="number" id="${id}" data-clave="${c.clave}" inputmode="numeric" step="1" ${c.min !== undefined ? `min="${c.min}"` : ""} ${c.max !== undefined ? `max="${c.max}"` : ""} value="${escapar(v === undefined ? "" : v)}">`;
  const modo = c.patron && /\\d/.test(c.patron) ? 'inputmode="numeric"' : "";
  return `<input type="${c.tipo === "correo" ? "email" : "text"}" id="${id}" data-clave="${c.clave}" ${modo} value="${escapar(v || "")}" autocomplete="off">`;
}

function campoHtml(c) {
  const err = errores[c.clave];
  return `<div class="iu-campo ${err ? "con-error" : ""} ${c.tipo === "parrafo" ? "iu-ancho" : ""}" id="fld-${c.clave}" ${c.dependeDe ? `data-dep="${c.dependeDe}"` : ""}>
    <label for="f_${c.clave}">${escapar(c.etiqueta)}${c.obligatorio || c.obligatorioVisible ? ` <span class="req">*</span>` : ""}${etiquetaOrigen(c.clave)}</label>
    ${entradaHtml(c)}
    ${c.ayuda ? `<div class="iu-nota">${escapar(c.ayuda)}</div>` : ""}
    <div class="iu-msg-error" data-error="${c.clave}">${err ? escapar(err) : ""}</div>
  </div>`;
}

function grupoHtml(g) {
  return `<div class="iu-grupo"><h3>${escapar(g.titulo)}</h3>${g.ayuda ? `<p class="iu-ayuda">${escapar(g.ayuda)}</p>` : ""}
    <div class="iu-rejilla ${g.id.startsWith("legal") ? "ancha" : ""}">${g.campos.map(campoHtml).join("")}</div></div>`;
}

function seccionHtml(s) {
  return `<div class="panel iu-bloque" style="margin-top:14px;">
    <h2>${escapar(s.titulo)}</h2>${s.ayuda ? `<p class="iu-ayuda">${escapar(s.ayuda)}</p>` : ""}
    ${s.campos.length ? `<div class="iu-dos">${s.campos.map(campoHtml).join("")}</div>` : ""}
    ${(s.grupos || []).map(grupoHtml).join("")}
    ${s.lista ? listaHtml(s) : ""}
  </div>`;
}

// ---- Edificio compartido: otras instituciones que funcionan en el mismo edificio ----
function listaHtml(s) {
  const e = P.edificio;
  const err = errores.otras_instituciones;
  return `<div class="iu-grupo" id="iuListaWrap" style="display:none;"><h3>${escapar(s.lista.etiqueta)}</h3>
    ${e ? `<div class="iu-aviso">Este plantel ya figura en el edificio <strong>${escapar(e.codigo_infraestructura)}</strong> con ${e.cantidad} nombres: ${e.miembros.map((m) => escapar(m.nombre || m.codigo_dea)).join(" · ")}.</div>` : ""}
    <p class="iu-ayuda">Escribe el código DEA de la otra institución y pulsa Buscar: se trae su nombre de GESCOLAR. Si no tiene código, escribe solo el nombre.</p>
    <div id="iuLista"></div>
    <button type="button" class="btn btn-fantasma btn-sm" id="btnAgregarInst">+ Agregar otra institución</button>
    <div class="iu-msg-error" id="errLista">${err ? escapar(err) : ""}</div>
  </div>`;
}

function pintarLista() {
  const cont = document.getElementById("iuLista");
  if (!cont) return;
  cont.innerHTML = (datos.otras_instituciones || []).map((o, i) => {
    const e = errores[`otras_instituciones.${i}`];
    return `<div class="iu-inst" data-fila="${i}">
      <div><input type="text" placeholder="Código DEA" data-inst-codigo="${i}" value="${escapar(o.codigo_dea || "")}"><button type="button" class="btn btn-fantasma btn-sm" data-buscar="${i}" style="margin-top:6px;">Buscar</button></div>
      <div><input type="text" placeholder="Nombre de la institución" data-inst-nombre="${i}" value="${escapar(o.nombre || "")}">
        <div class="iu-sugerencias" data-sug="${i}" style="display:none;"></div>
        <div class="iu-nota" data-info-fila="${i}">${escapar(infoFilas[i] || "")}</div>
        ${e ? `<div class="iu-msg-error">${escapar(e)}</div>` : ""}</div>
      <button type="button" class="btn btn-fantasma btn-sm" data-quitar="${i}">Quitar</button>
    </div>`;
  }).join("") || `<div class="iu-nota">Todavía no has agregado ninguna.</div>`;
}

async function buscarInstitucion(i) {
  const o = datos.otras_instituciones[i];
  const codigo = (o.codigo_dea || "").trim().toUpperCase();
  const info = document.querySelector(`[data-info-fila="${i}"]`);
  if (!codigo) { if (info) info.textContent = "Escribe un código DEA para buscar."; return; }
  if (codigo.toLowerCase() === P.plantel.codigo_dea.toLowerCase()) { if (info) info.textContent = "Ese es el mismo plantel."; return; }
  if (info) info.textContent = "Buscando…";
  try {
    const p = await api("GET", `/api/inspecciones/instrumento-uno/plantel/${encodeURIComponent(codigo)}`);
    o.codigo_dea = p.codigo_dea;
    o.nombre = p.nombre_plantel;
    infoFilas[i] = p.edificio ? `Ya figura en el edificio ${p.edificio.codigo_infraestructura} (${p.edificio.cantidad} nombres).` : `${p.municipio}${p.parroquia ? " · " + p.parroquia : ""}`;
    delete errores[`otras_instituciones.${i}`];
    pintarLista();
  } catch (err) {
    infoFilas[i] = err.message;
    if (info) info.textContent = err.message;
  }
}

function sugerirInstitucion(i, texto) {
  clearTimeout(temporizadoresSug[i]);
  const cont = document.querySelector(`[data-sug="${i}"]`);
  if (!cont) return;
  if (String(texto).trim().length < 3) { cont.style.display = "none"; return; }
  temporizadoresSug[i] = setTimeout(async () => {
    try {
      const r = await api("GET", `/api/inspecciones/instrumento-uno/buscar?q=${encodeURIComponent(texto.trim())}&excluir=${encodeURIComponent(P.plantel.codigo_dea)}`);
      sugerenciasPorFila[i] = r.planteles;
      const c = document.querySelector(`[data-sug="${i}"]`);
      if (!c) return;
      c.innerHTML = r.planteles.length
        ? r.planteles.map((p, k) => `<button type="button" class="iu-sug" data-fila="${i}" data-elegir="${k}"><strong>${escapar(p.nombre_plantel)}</strong><small>${escapar(p.codigo_dea)} · ${escapar(p.municipio)}${p.parroquia ? " · " + escapar(p.parroquia) : ""}</small></button>`).join("") +
          `<div class="iu-nota" style="padding:4px 8px;">¿No está en la lista? Deja el nombre como lo escribiste (sin código).</div>`
        : `<div class="iu-nota" style="padding:6px 8px;">Sin coincidencias en GESCOLAR. Se guardará solo con el nombre que escribiste.</div>`;
      c.style.display = "";
    } catch (_) { /* se puede seguir escribiendo el nombre a mano */ }
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
}

function pintar() {
  const form = document.getElementById("formulario");
  form.innerHTML = `
    <div class="panel iu-bloque" style="margin-top:14px;">
      <strong>${escapar(P.plantel.nombre_plantel)}</strong>
      <div class="iu-nota">${escapar(P.plantel.codigo_dea)} · ${escapar(P.plantel.municipio)}${P.plantel.parroquia ? " · " + escapar(P.plantel.parroquia) : ""}</div>
      <p class="iu-ayuda" style="margin-top:8px;">Revisa lo que ya está cargado: si está bien, déjalo; si cambió, corrígelo. Lo que quede vacío y sea obligatorio hay que completarlo.</p>
    </div>
    ${P.secciones.map(seccionHtml).join("")}
    <div class="panel iu-bloque" style="margin-top:14px;">
      <div class="iu-campo iu-ancho"><label for="nota">Nota del cambio (opcional)</label>
        <textarea id="nota" maxlength="500" placeholder="Ej.: se construyeron 3 aulas por proyecto comunal; el terreno cedió con la crecida de la quebrada."></textarea>
        <div class="iu-nota">Queda guardada junto al cambio y explica, por ejemplo, un salto de matrícula o aulas inhabilitadas.</div></div>
      <div class="iu-campo"><div class="iu-multi"><label><input type="checkbox" id="verificado"> Verificado en campo (confirmé estos datos en el plantel)</label></div></div>
    </div>
    <div class="iu-barra"><div class="izq"><div class="iu-msg-error" id="resumenError"></div></div>
      <div class="der"><button type="button" class="btn btn-fantasma" id="btnOtro">Cancelar</button><button type="button" class="btn btn-primario" id="btnGuardar" ${P.puede_guardar ? "" : "disabled"}>Guardar</button></div></div>`;
  enganchar();
  pintarLista();
  actualizarVisibilidad();
}

// Campos de las fases, aplanados
function todosCampos() {
  const r = [];
  P.secciones.forEach((s) => { r.push(...s.campos); (s.grupos || []).forEach((g) => r.push(...g.campos)); });
  return r;
}

function cumple(c) {
  const v = c.visibleSi;
  if (!v) return true;
  const padre = todosCampos().find((x) => x.clave === v.clave);
  const padreOculto = padre && padre.visibleSi && !cumple(padre);
  if (padreOculto) return false;
  const a = datos[v.clave];
  if (v.mayorQue !== undefined) return Number(a) > v.mayorQue;
  return (Array.isArray(a) ? a : [a]).some((x) => v.valores.includes(x));
}

function actualizarVisibilidad() {
  const wrap = document.getElementById("iuListaWrap");
  if (wrap) wrap.style.display = datos.comparte_edificio === "SI" ? "" : "none";
  todosCampos().forEach((c) => {
    const f = document.getElementById(`fld-${c.clave}`);
    if (!f) return;
    let ver = cumple(c);
    if (ver && c.dependeDe && c.dependeDe.startsWith("matricula_")) ver = Number(datos[c.dependeDe]) > 0;
    if (ver && c.clave === "cancha_techada") ver = (Number(datos.canchas_operativas) || 0) + (Number(datos.canchas_no_operativas) || 0) > 0;
    f.style.display = ver ? "" : "none";
  });
}

function enganchar() {
  const form = document.getElementById("formulario");
  // #formulario se conserva al redibujar: los oyentes se registran UNA sola vez (si no, cada botón actuaría varias veces)
  if (!form.dataset.enganchado) {
    form.dataset.enganchado = "1";
    enlazarFormulario(form);
  }
  document.getElementById("btnOtro").addEventListener("click", () => {
    if (MODO_DIRECTOR) { window.location.href = VOLVER; return; }
    form.innerHTML = ""; P = null; document.getElementById("codigo").value = ""; document.getElementById("codigo").focus();
  });
  document.getElementById("btnGuardar").addEventListener("click", guardar);
}

function enlazarFormulario(form) {
  const alCambiar = (e) => {
    const t = e.target;
    if (t.dataset.clave) {
      datos[t.dataset.clave] = t.value;
    } else if (t.dataset.multi) {
      datos[t.dataset.multi] = [...form.querySelectorAll(`[data-multi="${t.dataset.multi}"]:checked`)].map((x) => x.value);
    } else return;
    const k = t.dataset.clave || t.dataset.multi;
    delete errores[k];
    const fe = document.getElementById(`fld-${k}`);
    if (fe) { fe.classList.remove("con-error"); const m = fe.querySelector(".iu-msg-error"); if (m) m.textContent = ""; }
    actualizarVisibilidad();
  };
  // lista de otras instituciones (no son campos del esquema)
  form.addEventListener("input", (e) => {
    const t = e.target;
    if (t.dataset.instCodigo !== undefined) { datos.otras_instituciones[Number(t.dataset.instCodigo)].codigo_dea = t.value.trim().toUpperCase(); return; }
    if (t.dataset.instNombre !== undefined) {
      const i = Number(t.dataset.instNombre);
      datos.otras_instituciones[i].nombre = t.value;
      sugerirInstitucion(i, t.value);
    }
  });
  form.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.id === "btnAgregarInst") { datos.otras_instituciones.push({ codigo_dea: "", nombre: "" }); pintarLista(); return; }
    if (b.dataset.quitar !== undefined) { datos.otras_instituciones.splice(Number(b.dataset.quitar), 1); pintarLista(); return; }
    if (b.dataset.buscar !== undefined) { buscarInstitucion(Number(b.dataset.buscar)); return; }
    if (b.dataset.elegir !== undefined) { elegirSugerencia(Number(b.dataset.fila), Number(b.dataset.elegir)); }
  });
  form.addEventListener("input", alCambiar);
  form.addEventListener("change", (e) => { if (e.target.tagName === "SELECT" || e.target.type === "checkbox") alCambiar(e); });
}


async function guardar() {
  const b = document.getElementById("btnGuardar");
  const resumen = document.getElementById("resumenError");
  resumen.textContent = "";
  b.disabled = true;
  const envio = {};
  todosCampos().forEach((c) => { const v = datos[c.clave]; envio[c.clave] = v === undefined ? "" : v; });
  if (P.secciones.some((x) => x.lista)) envio.otras_instituciones = datos.otras_instituciones || [];
  try {
    const r = await api("PUT", rutaPlantel(P.plantel.codigo_dea), {
      datos: envio, nota: document.getElementById("nota").value, verificado: document.getElementById("verificado").checked,
    });
    const ed = r.edificio;
    const avisoEdificio = ed
      ? `<div class="iu-aviso" style="${ed.hoja_coordenadas === "pendiente" ? "" : "background:#eef6ee;"}">Edificio: <strong>${escapar(ed.codigo_infraestructura)}</strong> (${ed.comparte ? "comparte con otra(s) institución(es)" : "el plantel está solo en su edificio"}).${ed.hoja_coordenadas === "pendiente" ? " <strong>La hoja «Coordenadas Planteles» quedó pendiente</strong> (Google no respondió): se completa al sincronizar en Infraestructuras." : ""}</div>`
      : "";
    const avisos = avisoEdificio + (r.avisos || []).map((a) => `<div class="iu-aviso">${escapar(a)}</div>`).join("");
    document.getElementById("formulario").innerHTML = `
      <div class="iu-resultado"><strong>Guardado.</strong> ${r.cambios ? `${r.cambios} dato(s) actualizado(s) en ${escapar(r.plantel.nombre_plantel)}.` : `No hubo cambios en ${escapar(r.plantel.nombre_plantel)}.`}
        ${avisos}
        <div style="margin-top:12px;">${MODO_DIRECTOR ? "" : `<button type="button" class="btn btn-primario" id="btnSiguiente">Otro plantel</button> `}<a class="btn ${MODO_DIRECTOR ? "btn-primario" : "btn-fantasma"}" style="text-decoration:none;" href="${VOLVER}">Volver a las consultas</a></div>
      </div>`;
    if (!MODO_DIRECTOR) document.getElementById("btnSiguiente").addEventListener("click", () => { document.getElementById("formulario").innerHTML = ""; P = null; const c = document.getElementById("codigo"); c.value = ""; c.focus(); window.scrollTo({ top: 0, behavior: "smooth" }); });
  } catch (e) {
    b.disabled = false;
    if (e.errores) {
      const nota = document.getElementById("nota").value;
      const ver = document.getElementById("verificado").checked;
      errores = e.errores;
      pintar();
      document.getElementById("nota").value = nota;
      document.getElementById("verificado").checked = ver;
      const primero = todosCampos().find((c) => errores[c.clave]);
      document.getElementById("resumenError").textContent = `Revisa ${Object.keys(errores).length} campo(s) marcado(s).`;
      if (primero) { const f = document.getElementById(`fld-${primero.clave}`); if (f) f.scrollIntoView({ behavior: "smooth", block: "center" }); }
    } else {
      resumen.textContent = e.message;
    }
  }
}
