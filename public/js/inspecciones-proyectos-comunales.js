// inspecciones-proyectos-comunales.js — Proyectos comunales aprobados para atender planteles.
// Cada registro es UNA aprobación (año de la elección + nombre del proyecto). Circuito y consejo se eligen
// de los que ya existen en GESCOLAR. Con ?plantel=CODIGO se abre el formulario ya con ese plantel.

const usuario = renderShell("inspecciones-comunales", "Proyectos comunales");
const API = "/api/inspecciones/proyectos-comunales";
let LISTA = null;
let OPCIONES = { circuitos: [], consejos: [] };
let filtroTimer = null;

function escapar(v) {
  return String(v === undefined || v === null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

if (usuario) iniciar();

async function iniciar() {
  document.getElementById("contenido").innerHTML = `<div class="panel"><div class="cargando">Cargando proyectos comunales…</div></div>`;
  try {
    OPCIONES = await RAC.get(`${API}/opciones`);
    await cargar();
  } catch (err) {
    document.getElementById("contenido").innerHTML = `<div class="panel"><div class="vacio"><strong>No se pudo abrir la pantalla</strong>${escapar(err.message)}</div></div>`;
    return;
  }
  const codigo = (new URLSearchParams(window.location.search).get("plantel") || "").trim().toUpperCase();
  if (codigo && LISTA.puede_editar) abrirFormulario({ codigo_dea: codigo });
}

async function cargar() {
  const anio = (document.getElementById("fAnio") || {}).value || "";
  const q = (document.getElementById("fTexto") || {}).value || "";
  const ps = new URLSearchParams();
  if (anio) ps.set("anio", anio);
  if (q.trim()) ps.set("q", q.trim());
  LISTA = await RAC.get(`${API}/lista?${ps.toString()}`);
  dibujar(anio, q);
}

function dibujar(anioSel, q) {
  const { proyectos, resumen, anios, puede_editar: edita } = LISTA;
  const opAnios = [`<option value="">Todos los años</option>`].concat(anios.map((a) => `<option value="${a}" ${String(a) === String(anioSel) ? "selected" : ""}>${a}</option>`)).join("");
  document.getElementById("contenido").innerHTML = `
    <section class="planteles-hero"><div class="planteles-hero-copy">
      <span class="planteles-eyebrow">PROYECTOS COMUNALES</span>
      <h1>Atención por proyecto comunal</h1>
      <p>${resumen.proyectos} aprobación${resumen.proyectos === 1 ? "" : "es"} en ${resumen.planteles} plantel${resumen.planteles === 1 ? "" : "es"}.
        ${resumen.por_anio.map((a) => `${a.anio}: ${a.proyectos}`).join(" · ")}</p>
    </div></section>
    <div class="panel">
      <div class="pc-filtros">
        <label>Año de la elección<select id="fAnio">${opAnios}</select></label>
        <label style="flex:1; min-width:200px;">Buscar<input type="text" id="fTexto" value="${escapar(q)}" placeholder="Plantel, código, proyecto, circuito, consejo…"></label>
        ${edita ? `<button type="button" class="btn btn-primario btn-sm" id="btnNuevo">Registrar proyecto comunal</button>` : ""}
      </div>
      <div class="tabla-responsive">${proyectos.length ? `<table class="pc-tabla"><thead><tr><th>Plantel</th><th>Año</th><th>N.º</th><th>Proyecto</th><th>Circuito / Consejo comunal</th><th></th></tr></thead><tbody>
        ${proyectos.map((p) => `<tr>
          <td><strong>${escapar(p.nombre_plantel)}</strong><div class="pc-sub">${escapar(p.codigo_dea)} · ${escapar(p.municipio)}</div></td>
          <td>${p.anio}</td><td>${p.numero}</td>
          <td>${escapar(p.nombre_proyecto)}${p.observaciones ? `<div class="pc-sub">${escapar(p.observaciones)}</div>` : ""}</td>
          <td>${escapar(p.circuito_nombre) || "—"}<div class="pc-sub">${escapar(p.consejo_nombre)}</div></td>
          <td style="white-space:nowrap;">${edita ? `<button type="button" class="btn btn-fantasma btn-sm" data-editar="${p.id}">Editar</button> <button type="button" class="btn btn-fantasma btn-sm" data-quitar="${p.id}">Quitar</button>` : ""}</td>
        </tr>`).join("")}</tbody></table>` : `<div class="vacio"><strong>Sin proyectos comunales</strong>Aún no hay aprobaciones registradas${anioSel || q ? " con ese filtro" : ""}.</div>`}</div>
    </div>`;
  document.getElementById("fAnio").addEventListener("change", () => cargar().catch((e) => mostrarToast(e.message, true)));
  document.getElementById("fTexto").addEventListener("input", () => { clearTimeout(filtroTimer); filtroTimer = setTimeout(() => cargar().then(() => { const t = document.getElementById("fTexto"); t.focus(); t.setSelectionRange(t.value.length, t.value.length); }).catch((e) => mostrarToast(e.message, true)), 350); });
  const nuevo = document.getElementById("btnNuevo");
  if (nuevo) nuevo.addEventListener("click", () => abrirFormulario({}));
  document.querySelectorAll("[data-editar]").forEach((b) => b.addEventListener("click", () => abrirFormulario(proyectos.find((p) => p.id === Number(b.dataset.editar)))));
  document.querySelectorAll("[data-quitar]").forEach((b) => b.addEventListener("click", () => quitar(Number(b.dataset.quitar))));
}

async function quitar(id) {
  if (!window.confirm("¿Quitar esta aprobación de proyecto comunal?")) return;
  try { await RAC.del(`${API}/${id}`); mostrarToast("Proyecto quitado."); await cargar(); } catch (err) { mostrarToast(err.message, true); }
}

// Formulario: nuevo (sin id) o edición (con id). Si viene solo el código, se verifica el plantel al guardar.
function abrirFormulario(p) {
  const editando = Boolean(p.id);
  const lista = (arr, sel) => `<option value="">— sin indicar —</option>` + arr.map((x) => `<option value="${escapar(x.nombre)}" ${x.nombre === sel ? "selected" : ""}>${escapar(x.nombre)}</option>`).join("");
  const fondo = document.createElement("div");
  fondo.className = "pc-fondo";
  fondo.innerHTML = `<div class="pc-modal"><h3 style="margin:0;">${editando ? "Editar" : "Registrar"} proyecto comunal</h3>
    <div class="pc-form">
      <label>Plantel (código DEA)<div style="display:flex; gap:6px;"><input type="text" id="pcCodigo" value="${escapar(p.codigo_dea || "")}" ${editando ? "disabled" : ""} placeholder="Código o nombre del plantel" style="flex:1;">${editando ? "" : `<button type="button" class="btn btn-fantasma btn-sm" id="pcBuscar">Buscar</button>`}</div></label>
      <div id="pcResultados"></div>
      <label>Año de la elección<input type="number" id="pcAnio" min="2000" max="${new Date().getFullYear() + 1}" value="${escapar(p.anio || new Date().getFullYear())}"></label>
      <label>Nombre del proyecto<input type="text" id="pcNombre" maxlength="200" value="${escapar(p.nombre_proyecto || "")}"></label>
      <label>Circuito comunal<select id="pcCircuito">${lista(OPCIONES.circuitos, p.circuito_nombre)}</select></label>
      <label>Consejo comunal<select id="pcConsejo">${lista(OPCIONES.consejos, p.consejo_nombre)}</select></label>
      <label>Observaciones<textarea id="pcObs" rows="2" maxlength="1000">${escapar(p.observaciones || "")}</textarea></label>
      <div id="pcError" style="color:#c53030; font-size:.82rem;"></div>
    </div>
    <div style="display:flex; gap:8px; justify-content:flex-end;"><button type="button" class="btn btn-fantasma btn-sm" id="pcCancelar">Cancelar</button><button type="button" class="btn btn-primario btn-sm" id="pcGuardar">Guardar</button></div></div>`;
  document.body.appendChild(fondo);
  const cerrar = () => fondo.remove();
  fondo.querySelector("#pcCancelar").addEventListener("click", cerrar);
  const buscar = fondo.querySelector("#pcBuscar");
  if (buscar) buscar.addEventListener("click", async () => {
    const caja = fondo.querySelector("#pcResultados");
    const q = fondo.querySelector("#pcCodigo").value.trim();
    if (q.length < 2) { caja.innerHTML = `<div class="pc-sub">Escribe al menos 2 caracteres.</div>`; return; }
    try {
      const r = await RAC.get(`${API}/buscar?q=${encodeURIComponent(q)}`);
      caja.innerHTML = r.planteles.length ? r.planteles.map((x) => `<div style="padding:4px 0;"><button type="button" class="btn btn-fantasma btn-sm" data-pick="${escapar(x.cod_plantel)}">Elegir</button> ${escapar(x.nombre_plantel)} <span class="pc-sub">${escapar(x.cod_plantel)} · ${escapar(x.municipio)}</span></div>`).join("") + (r.limitado ? `<div class="pc-sub">Hay más resultados: afina la búsqueda.</div>` : "") : `<div class="pc-sub">Sin resultados.</div>`;
      caja.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => { fondo.querySelector("#pcCodigo").value = b.dataset.pick; caja.innerHTML = ""; }));
    } catch (err) { caja.innerHTML = `<div style="color:#c53030;">${escapar(err.message)}</div>`; }
  });
  fondo.querySelector("#pcGuardar").addEventListener("click", async () => {
    const err = fondo.querySelector("#pcError");
    err.textContent = "";
    const cuerpo = { anio: fondo.querySelector("#pcAnio").value, nombre_proyecto: fondo.querySelector("#pcNombre").value, circuito_nombre: fondo.querySelector("#pcCircuito").value, consejo_nombre: fondo.querySelector("#pcConsejo").value, observaciones: fondo.querySelector("#pcObs").value };
    const codigo = fondo.querySelector("#pcCodigo").value.trim().toUpperCase();
    try {
      if (editando) await RAC.put(`${API}/${p.id}`, cuerpo);
      else {
        if (!codigo) { err.textContent = "Elige el plantel."; return; }
        await RAC.post(`${API}/plantel/${encodeURIComponent(codigo)}`, cuerpo);
      }
      cerrar();
      mostrarToast("Proyecto comunal guardado.");
      await cargar();
    } catch (e) { err.textContent = e.message; }
  });
}
