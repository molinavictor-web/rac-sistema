// inspecciones-otros-entes.js — Atenciones de OTROS ENTES (Gobernación, alcaldías, ministerios, SENIAT, FANB…).
// Cada atención = plantel + ente + año (+ mes opcional) + qué se hizo. El plantel cuenta una sola vez como atendido,
// pero todas sus atenciones quedan en el historial. Con ?plantel=CODIGO se abre el formulario con ese plantel.

const usuario = renderShell("inspecciones-otros-entes", "Atenciones de otros entes");
const API = "/api/inspecciones/otros-entes";
let LISTA = null;
let CATALOGO = { entes: [], categorias: [], puede_editar: false };
let filtroTimer = null;
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function escapar(v) {
  return String(v === undefined || v === null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const sinAcentos = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const fechaTxt = (a) => (a.mes ? `${MESES[a.mes - 1]} ${a.anio}` : String(a.anio));

if (usuario) iniciar();

async function iniciar() {
  document.getElementById("contenido").innerHTML = `<div class="panel"><div class="cargando">Cargando atenciones…</div></div>`;
  try {
    CATALOGO = await RAC.get(`${API}/catalogo`);
    await cargar();
  } catch (err) {
    document.getElementById("contenido").innerHTML = `<div class="panel"><div class="vacio"><strong>No se pudo abrir la pantalla</strong>${escapar(err.message)}</div></div>`;
    return;
  }
  const codigo = (new URLSearchParams(window.location.search).get("plantel") || "").trim().toUpperCase();
  if (codigo && LISTA.puede_editar) {
    let nombre = codigo;
    try { const r = await RAC.get(`${API}/buscar?q=${encodeURIComponent(codigo)}`); const x = r.planteles.find((y) => y.cod_plantel.toUpperCase() === codigo); if (x) nombre = x.nombre_plantel; } catch (_) { /* se deja el código */ }
    abrirFormulario({ codigo_dea: codigo, nombre_plantel: nombre });
  }
}

async function cargar() {
  const g = (id) => (document.getElementById(id) || {}).value || "";
  const ps = new URLSearchParams();
  if (g("fAnio")) ps.set("anio", g("fAnio"));
  if (g("fEnte")) ps.set("ente", g("fEnte"));
  if (g("fCategoria")) ps.set("categoria", g("fCategoria"));
  if (g("fTexto").trim()) ps.set("q", g("fTexto").trim());
  LISTA = await RAC.get(`${API}/lista?${ps.toString()}`);
  dibujar({ anio: g("fAnio"), ente: g("fEnte"), categoria: g("fCategoria"), q: g("fTexto") });
}

function dibujar(f) {
  const { atenciones, resumen, anios, puede_editar: edita } = LISTA;
  const opc = (arr, sel, todos) => `<option value="">${todos}</option>` + arr.map(([v, t]) => `<option value="${escapar(v)}" ${String(v) === String(sel) ? "selected" : ""}>${escapar(t)}</option>`).join("");
  document.getElementById("contenido").innerHTML = `
    <section class="planteles-hero"><div class="planteles-hero-copy">
      <span class="planteles-eyebrow">OTROS ENTES</span>
      <h1>Atenciones de otros entes</h1>
      <p>${resumen.atenciones} atención${resumen.atenciones === 1 ? "" : "es"} en ${resumen.planteles} plantel${resumen.planteles === 1 ? "" : "es"}. Gobernación, alcaldías, ministerios, SENIAT, FANB…</p>
    </div></section>
    <div class="panel">
      <div class="oe-filtros">
        <label>Año<select id="fAnio">${opc(anios.map((a) => [a, a]), f.anio, "Todos")}</select></label>
        <label>Categoría<select id="fCategoria">${opc(CATALOGO.categorias.map((c) => [c.codigo, c.nombre]), f.categoria, "Todas")}</select></label>
        <label>Ente<select id="fEnte">${opc(CATALOGO.entes.map((e) => [e.id, e.nombre]), f.ente, "Todos")}</select></label>
        <label style="flex:1; min-width:180px;">Buscar<input type="text" id="fTexto" value="${escapar(f.q)}" placeholder="Plantel, código, ente, qué se hizo…"></label>
        ${edita ? `<button type="button" class="btn btn-primario btn-sm" id="btnNuevo">Registrar atención</button>` : ""}
        ${CATALOGO.puede_editar ? `<button type="button" class="btn btn-fantasma btn-sm" id="btnCatalogo">Catálogo de entes</button>` : ""}
      </div>
      ${resumen.por_ente.length ? `<div class="oe-resumen">${resumen.por_ente.map((o) => `<span class="oe-chip"><strong>${escapar(o.ente)}</strong>: ${o.planteles} plantel${o.planteles === 1 ? "" : "es"} · ${o.atenciones} atención${o.atenciones === 1 ? "" : "es"}</span>`).join("")}</div>` : ""}
      <div class="tabla-responsive">${atenciones.length ? `<table class="oe-tabla"><thead><tr><th>Plantel</th><th>Ente</th><th>Cuándo</th><th>Qué se hizo</th><th></th></tr></thead><tbody>
        ${atenciones.map((a) => `<tr>
          <td><strong>${escapar(a.nombre_plantel)}</strong><div class="oe-sub">${escapar(a.codigo_dea)} · ${escapar(a.municipio)}</div></td>
          <td>${escapar(a.ente)}<div class="oe-sub">${escapar(a.categoria_texto)}</div></td>
          <td>${escapar(fechaTxt(a))}</td><td>${escapar(a.descripcion) || "—"}</td>
          <td style="white-space:nowrap;">${edita ? `<button type="button" class="btn btn-fantasma btn-sm" data-editar="${a.id}">Editar</button> <button type="button" class="btn btn-fantasma btn-sm" data-quitar="${a.id}">Quitar</button>` : ""}</td>
        </tr>`).join("")}</tbody></table>` : `<div class="vacio"><strong>Sin atenciones registradas</strong>Aún no hay atenciones de otros entes${f.anio || f.ente || f.categoria || f.q ? " con ese filtro" : ""}.</div>`}</div>
    </div>`;
  ["fAnio", "fCategoria", "fEnte"].forEach((id) => document.getElementById(id).addEventListener("change", () => cargar().catch((e) => mostrarToast(e.message, true))));
  document.getElementById("fTexto").addEventListener("input", () => { clearTimeout(filtroTimer); filtroTimer = setTimeout(() => cargar().then(() => { const t = document.getElementById("fTexto"); t.focus(); t.setSelectionRange(t.value.length, t.value.length); }).catch((e) => mostrarToast(e.message, true)), 350); });
  const nuevo = document.getElementById("btnNuevo");
  if (nuevo) nuevo.addEventListener("click", () => abrirFormulario({}));
  const cat = document.getElementById("btnCatalogo");
  if (cat) cat.addEventListener("click", abrirCatalogo);
  document.querySelectorAll("[data-editar]").forEach((b) => b.addEventListener("click", () => abrirFormulario(atenciones.find((a) => a.id === Number(b.dataset.editar)))));
  document.querySelectorAll("[data-quitar]").forEach((b) => b.addEventListener("click", () => quitar(Number(b.dataset.quitar))));
}

async function quitar(id) {
  if (!window.confirm("¿Quitar esta atención del historial?")) return;
  try { await RAC.del(`${API}/${id}`); mostrarToast("Atención quitada."); await cargar(); } catch (err) { mostrarToast(err.message, true); }
}

// Búsqueda "al escribir" (sin distinguir mayúsculas ni acentos), por código o por nombre: muestra TODOS los parecidos.
function conectarBusqueda(input, caja, fuente, alElegir) {
  let t = null;
  let n = 0;
  const pintar = async () => {
    const mio = ++n;
    let items = [];
    try { items = await fuente(input.value); } catch (err) { if (mio === n) caja.innerHTML = `<div class="oe-sub" style="padding:6px 10px;color:#c53030;">${escapar(err.message)}</div>`; return; }
    if (mio !== n) return;
    caja.innerHTML = items.length
      ? items.map((x, k) => `<button type="button" class="oe-opcion" data-k="${k}"><strong>${escapar(x.etiqueta)}</strong>${x.sub ? `<span class="oe-sub"> · ${escapar(x.sub)}</span>` : ""}</button>`).join("")
      : `<div class="oe-sub" style="padding:6px 10px;">Sin coincidencias.</div>`;
    caja.querySelectorAll("[data-k]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); alElegir(items[Number(b.dataset.k)]); caja.innerHTML = ""; }));
  };
  input.addEventListener("input", () => { clearTimeout(t); t = setTimeout(pintar, 250); });
  input.addEventListener("focus", () => { if (!caja.innerHTML) pintar(); });
}

// Formulario: nueva (sin id) o edición (con id).
function abrirFormulario(a) {
  const editando = Boolean(a.id);
  const activos = CATALOGO.entes.filter((e) => e.activo || e.id === a.ente_id);
  let codigoElegido = a.codigo_dea || "";
  let enteElegido = a.ente_id || null;
  const fondo = document.createElement("div");
  fondo.className = "oe-fondo";
  fondo.innerHTML = `<div class="oe-modal"><h3 style="margin:0;">${editando ? "Editar" : "Registrar"} atención de otro ente</h3>
    <div class="oe-form">
      ${editando ? `<label>Plantel<input type="text" value="${escapar((a.nombre_plantel || "") + " · " + (a.codigo_dea || ""))}" disabled></label>` : `
      <label>Plantel (escribe el código o el nombre)<input type="text" id="oeBusca" autocomplete="off" placeholder="Ej.: OD06031608 o parte del nombre" value="${escapar(a.nombre_plantel || "")}"></label>
      <div class="oe-lista" id="oeResultados"></div>
      <div id="oeElegido" class="oe-sub">${codigoElegido ? `Plantel elegido: ${escapar(a.nombre_plantel || codigoElegido)} (${escapar(codigoElegido)})` : ""}</div>`}
      <label>Ente que atendió (escribe para buscar)<input type="text" id="oeEnte" autocomplete="off" placeholder="Ej.: Gobernación, Alcaldía de Maturín, SENIAT…" value="${escapar(a.ente || "")}"></label>
      <div class="oe-lista" id="oeListaEnte"></div>
      <div class="oe-fila">
        <label>Año<input type="number" id="oeAnio" min="2000" max="${new Date().getFullYear() + 1}" value="${escapar(a.anio || new Date().getFullYear())}"></label>
        <label>Mes (opcional)<select id="oeMes"><option value="">— no se sabe —</option>${MESES.map((m, i) => `<option value="${i + 1}" ${a.mes === i + 1 ? "selected" : ""}>${m}</option>`).join("")}</select></label>
      </div>
      <label>Qué se hizo<textarea id="oeDesc" rows="3" maxlength="500" placeholder="Ej.: rehabilitación de baños, cambio de techo, dotación de pupitres…">${escapar(a.descripcion || "")}</textarea></label>
      <div id="oeError" style="color:#c53030; font-size:.82rem;"></div>
    </div>
    <div style="display:flex; gap:8px; justify-content:flex-end;"><button type="button" class="btn btn-fantasma btn-sm" id="oeCancelar">Cancelar</button><button type="button" class="btn btn-primario btn-sm" id="oeGuardar">Guardar</button></div></div>`;
  document.body.appendChild(fondo);
  const $ = (id) => fondo.querySelector(id);
  const cerrar = () => fondo.remove();
  $("#oeCancelar").addEventListener("click", cerrar);

  if (!editando) {
    conectarBusqueda($("#oeBusca"), $("#oeResultados"), async (texto) => {
      if (texto.trim().length < 2) return [];
      const r = await RAC.get(`${API}/buscar?q=${encodeURIComponent(texto.trim())}`);
      return r.planteles.map((x) => ({ valor: x.cod_plantel, etiqueta: x.nombre_plantel, sub: `${x.cod_plantel} · ${x.municipio}${x.parroquia ? " · " + x.parroquia : ""}` }));
    }, (x) => { codigoElegido = x.valor; $("#oeBusca").value = x.etiqueta; $("#oeElegido").textContent = `Plantel elegido: ${x.etiqueta} (${x.valor})`; });
    $("#oeBusca").addEventListener("input", () => { codigoElegido = ""; $("#oeElegido").textContent = ""; });
  }
  conectarBusqueda($("#oeEnte"), $("#oeListaEnte"), (texto) => {
    const q = sinAcentos(texto);
    return activos.filter((e) => !q || sinAcentos(e.nombre).includes(q) || sinAcentos(e.categoria_texto).includes(q) || sinAcentos(e.municipio).includes(q)).slice(0, 40)
      .map((e) => ({ valor: e.id, etiqueta: e.nombre, sub: e.categoria_texto }));
  }, (x) => { enteElegido = x.valor; $("#oeEnte").value = x.etiqueta; });
  $("#oeEnte").addEventListener("input", () => { enteElegido = null; });

  $("#oeGuardar").addEventListener("click", async () => {
    const err = $("#oeError");
    err.textContent = "";
    try {
      if (!editando && !codigoElegido) throw new Error("Elige el plantel de la lista de sugerencias.");
      if (!enteElegido) {
        const q = sinAcentos($("#oeEnte").value);
        const e = activos.find((x) => sinAcentos(x.nombre) === q);
        if (!e) throw new Error("Elige el ente de la lista de sugerencias (si no está, agrégalo en «Catálogo de entes»).");
        enteElegido = e.id;
      }
      const cuerpo = { ente_id: enteElegido, anio: $("#oeAnio").value, mes: $("#oeMes").value, descripcion: $("#oeDesc").value };
      if (editando) await RAC.put(`${API}/${a.id}`, cuerpo); else await RAC.post(`${API}/plantel/${encodeURIComponent(codigoElegido)}`, cuerpo);
      cerrar();
      mostrarToast("Atención guardada.");
      await cargar();
    } catch (e) { err.textContent = e.message; }
  });
}

// Catálogo de entes (admin e insp_coordinador): agregar, renombrar y activar/desactivar.
async function abrirCatalogo() {
  const fondo = document.createElement("div");
  fondo.className = "oe-fondo";
  document.body.appendChild(fondo);
  const cerrar = async () => { fondo.remove(); try { CATALOGO = await RAC.get(`${API}/catalogo`); await cargar(); } catch (_) { /* se queda como está */ } };
  const pintar = async () => {
    let cat;
    try { cat = await RAC.get(`${API}/catalogo?todos=1`); } catch (e) { mostrarToast(e.message, true); return; }
    const opcCat = (sel) => cat.categorias.map((c) => `<option value="${c.codigo}" ${c.codigo === sel ? "selected" : ""}>${escapar(c.nombre)}</option>`).join("");
    fondo.innerHTML = `<div class="oe-modal" style="width:min(720px,100%);"><h3 style="margin:0;">Catálogo de entes</h3>
      <div class="oe-sub">FEDE no va aquí: es el sistema actual. Un ente con atenciones no se borra: se desactiva.</div>
      <div class="oe-form" style="border:1px solid var(--borde); border-radius:10px; padding:10px;">
        <strong style="font-size:.85rem;">Agregar un ente</strong>
        <div class="oe-fila"><label>Categoría<select id="ncCat">${opcCat("")}</select></label><label>Nombre<input type="text" id="ncNombre" maxlength="120"></label></div>
        <label id="ncMunLabel" style="display:none;">Municipio de la alcaldía<input type="text" id="ncMun"></label>
        <div id="ncError" style="color:#c53030; font-size:.82rem;"></div>
        <div><button type="button" class="btn btn-primario btn-sm" id="ncAgregar">Agregar</button></div>
      </div>
      <div class="tabla-responsive"><table class="oe-tabla"><thead><tr><th>Ente</th><th>Categoría</th><th>Atenciones</th><th></th></tr></thead><tbody>
        ${cat.entes.map((e) => `<tr class="${e.activo ? "" : "oe-inactivo"}"><td>${escapar(e.nombre)}${e.municipio ? `<div class="oe-sub">${escapar(e.municipio)}</div>` : ""}</td><td>${escapar(e.categoria_texto)}</td><td>${e.atenciones}</td>
          <td style="white-space:nowrap;"><button type="button" class="btn btn-fantasma btn-sm" data-renombrar="${e.id}">Renombrar</button> <button type="button" class="btn btn-fantasma btn-sm" data-activo="${e.id}">${e.activo ? "Desactivar" : "Activar"}</button></td></tr>`).join("")}
      </tbody></table></div>
      <div style="display:flex; justify-content:flex-end;"><button type="button" class="btn btn-fantasma btn-sm" id="ncCerrar">Cerrar</button></div></div>`;
    const $ = (id) => fondo.querySelector(id);
    $("#ncCerrar").addEventListener("click", cerrar);
    const munVis = () => { $("#ncMunLabel").style.display = $("#ncCat").value === "ALCALDIA" ? "grid" : "none"; };
    $("#ncCat").addEventListener("change", munVis); munVis();
    $("#ncAgregar").addEventListener("click", async () => {
      try { await RAC.post(`${API}/catalogo`, { categoria: $("#ncCat").value, nombre: $("#ncNombre").value, municipio: $("#ncMun").value }); mostrarToast("Ente agregado."); await pintar(); }
      catch (e) { $("#ncError").textContent = e.message; }
    });
    fondo.querySelectorAll("[data-renombrar]").forEach((b) => b.addEventListener("click", async () => {
      const e = cat.entes.find((x) => x.id === Number(b.dataset.renombrar));
      const nuevo = window.prompt("Nuevo nombre del ente:", e.nombre);
      if (!nuevo || nuevo.trim() === e.nombre) return;
      try { await RAC.put(`${API}/catalogo/${e.id}`, { categoria: e.categoria, nombre: nuevo, municipio: e.municipio }); await pintar(); } catch (er) { mostrarToast(er.message, true); }
    }));
    fondo.querySelectorAll("[data-activo]").forEach((b) => b.addEventListener("click", async () => {
      const e = cat.entes.find((x) => x.id === Number(b.dataset.activo));
      try { await RAC.put(`${API}/catalogo/${e.id}`, { categoria: e.categoria, nombre: e.nombre, municipio: e.municipio, activo: !e.activo }); await pintar(); } catch (er) { mostrarToast(er.message, true); }
    }));
  };
  await pintar();
}
