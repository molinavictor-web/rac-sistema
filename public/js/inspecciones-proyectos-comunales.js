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

// Búsqueda "al escribir" (sin distinguir mayúsculas ni acentos), por código o por nombre: muestra TODOS los parecidos.
const sinAcentos = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

// Conecta un campo de texto con una lista de sugerencias. `fuente(texto)` devuelve (o promete) [{valor, etiqueta, sub}].
function conectarBusqueda(input, caja, fuente, alElegir) {
  let t = null;
  let n = 0;
  const pintar = async () => {
    const mio = ++n;
    let items = [];
    try { items = await fuente(input.value); } catch (err) { if (mio === n) caja.innerHTML = `<div class="pc-sub" style="padding:6px 10px;color:#c53030;">${escapar(err.message)}</div>`; return; }
    if (mio !== n) return;
    caja.innerHTML = items.length
      ? items.map((x, k) => `<button type="button" class="pc-opcion" data-k="${k}"><strong>${escapar(x.etiqueta)}</strong>${x.sub ? `<span class="pc-sub"> · ${escapar(x.sub)}</span>` : ""}</button>`).join("")
      : `<div class="pc-sub" style="padding:6px 10px;">Sin coincidencias.</div>`;
    caja.querySelectorAll("[data-k]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); alElegir(items[Number(b.dataset.k)]); caja.innerHTML = ""; }));
  };
  input.addEventListener("input", () => { clearTimeout(t); t = setTimeout(pintar, 250); });
  input.addEventListener("focus", () => { if (!caja.innerHTML) pintar(); });
}

// Lista fija (circuitos/consejos): filtra por código o nombre.
function filtrarLista(arr) {
  return (texto) => {
    const q = sinAcentos(texto);
    return arr.filter((x) => !q || sinAcentos(x.nombre).includes(q) || sinAcentos(x.codigo).includes(q)).slice(0, 40)
      .map((x) => ({ valor: x.nombre, etiqueta: x.nombre, sub: x.codigo || "" }));
  };
}

// Formulario: nuevo (sin id) o edición (con id). Si viene solo el código, se verifica el plantel al guardar.
function abrirFormulario(p) {
  const editando = Boolean(p.id);
  const fondo = document.createElement("div");
  fondo.className = "pc-fondo";
  fondo.innerHTML = `<div class="pc-modal"><h3 style="margin:0;">${editando ? "Editar" : "Registrar"} proyecto comunal</h3>
    <div class="pc-form">
      ${editando ? `<label>Plantel<input type="text" value="${escapar((p.nombre_plantel || "") + " · " + (p.codigo_dea || ""))}" disabled></label>` : `
      <label>Plantel (escribe el código o el nombre)<input type="text" id="pcBusca" autocomplete="off" placeholder="Ej.: OD06031608 o parte del nombre" value="${escapar(p.codigo_dea || "")}"></label>
      <div class="pc-lista" id="pcResultados"></div>
      <div id="pcElegido" class="pc-sub"></div>`}
      <label>Año de la elección<input type="number" id="pcAnio" min="2000" max="${new Date().getFullYear() + 1}" value="${escapar(p.anio || new Date().getFullYear())}"></label>
      <label>Nombre del proyecto<input type="text" id="pcNombre" maxlength="200" value="${escapar(p.nombre_proyecto || "")}"></label>
      <label>Circuito comunal (código o nombre)<input type="text" id="pcCircuito" autocomplete="off" placeholder="Escribe para buscar…" value="${escapar(p.circuito_nombre || "")}"></label>
      <div class="pc-lista" id="pcListaCir"></div>
      <label>Consejo comunal (código o nombre)<input type="text" id="pcConsejo" autocomplete="off" placeholder="Escribe para buscar…" value="${escapar(p.consejo_nombre || "")}"></label>
      <div class="pc-lista" id="pcListaCon"></div>
      <label>Observaciones<textarea id="pcObs" rows="2" maxlength="1000">${escapar(p.observaciones || "")}</textarea></label>
      <div id="pcError" style="color:#c53030; font-size:.82rem;"></div>
    </div>
    <div style="display:flex; gap:8px; justify-content:flex-end;"><button type="button" class="btn btn-fantasma btn-sm" id="pcCancelar">Cancelar</button><button type="button" class="btn btn-primario btn-sm" id="pcGuardar">Guardar</button></div></div>`;
  document.body.appendChild(fondo);
  const $ = (id) => fondo.querySelector(id);
  const cerrar = () => fondo.remove();
  $("#pcCancelar").addEventListener("click", cerrar);
  let codigoElegido = "";

  if (!editando) {
    conectarBusqueda($("#pcBusca"), $("#pcResultados"), async (texto) => {
      if (texto.trim().length < 2) return [];
      const r = await RAC.get(`${API}/buscar?q=${encodeURIComponent(texto.trim())}`);
      return r.planteles.map((x) => ({ valor: x.cod_plantel, etiqueta: x.nombre_plantel, sub: `${x.cod_plantel} · ${x.municipio}${x.parroquia ? " · " + x.parroquia : ""}` }));
    }, (x) => { codigoElegido = x.valor; $("#pcBusca").value = x.etiqueta; $("#pcElegido").textContent = `Plantel elegido: ${x.etiqueta} (${x.valor})`; });
    $("#pcBusca").addEventListener("input", () => { codigoElegido = ""; $("#pcElegido").textContent = ""; });
    if (p.codigo_dea) codigoElegido = String(p.codigo_dea).toUpperCase();
  }
  conectarBusqueda($("#pcCircuito"), $("#pcListaCir"), filtrarLista(OPCIONES.circuitos), (x) => { $("#pcCircuito").value = x.valor; });
  conectarBusqueda($("#pcConsejo"), $("#pcListaCon"), filtrarLista(OPCIONES.consejos), (x) => { $("#pcConsejo").value = x.valor; });

  // El texto de circuito/consejo debe coincidir con uno de la lista (por nombre o por código); vacío = sin indicar.
  const resolver = (texto, arr, rotulo) => {
    const q = sinAcentos(texto);
    if (!q) return "";
    const x = arr.find((y) => sinAcentos(y.nombre) === q) || arr.find((y) => y.codigo && sinAcentos(y.codigo) === q);
    if (!x) throw new Error(`Elige el ${rotulo} de la lista de sugerencias.`);
    return x.nombre;
  };
  $("#pcGuardar").addEventListener("click", async () => {
    const err = $("#pcError");
    err.textContent = "";
    try {
      const cuerpo = { anio: $("#pcAnio").value, nombre_proyecto: $("#pcNombre").value, circuito_nombre: resolver($("#pcCircuito").value, OPCIONES.circuitos, "circuito comunal"), consejo_nombre: resolver($("#pcConsejo").value, OPCIONES.consejos, "consejo comunal"), observaciones: $("#pcObs").value };
      if (editando) await RAC.put(`${API}/${p.id}`, cuerpo);
      else {
        if (!codigoElegido) { err.textContent = "Elige el plantel de la lista de sugerencias."; return; }
        await RAC.post(`${API}/plantel/${encodeURIComponent(codigoElegido)}`, cuerpo);
      }
      cerrar();
      mostrarToast("Proyecto comunal guardado.");
      await cargar();
    } catch (e) { err.textContent = e.message; }
  });
}
