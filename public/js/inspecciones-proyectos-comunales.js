// inspecciones-proyectos-comunales.js — Proyectos comunales por COMUNA / CIRCUITO COMUNAL.
// El proyecto pertenece a una comuna (obligatoria), lleva año, fecha de la consulta y nombre; el número (1.ª, 2.ª…)
// sale solo por comuna. Debajo se arma la lista de planteles que atiende (Por atender / Atendido).
// Con ?plantel=CODIGO se abre el formulario con la comuna de ese plantel y el plantel ya en la lista.

const usuario = renderShell("inspecciones-comunales", "Proyectos comunales");
const API = "/api/inspecciones/proyectos-comunales";
let LISTA = null;
let OPCIONES = { circuitos: [] };
let filtroTimer = null;
const ESTADO_TXT = { POR_ATENDER: "Por atender", ATENDIDO: "Atendido" };

function escapar(v) {
  return String(v === undefined || v === null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const sinAcentos = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function fechaBonita(iso) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ""); return m ? `${Number(m[3])} ${MESES[Number(m[2]) - 1]} ${m[1]}` : ""; }

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
  if (codigo && LISTA.puede_editar) {
    try {
      const f = await RAC.get(`${API}/plantel/${encodeURIComponent(codigo)}`);
      const pl = f.plantel || {};
      abrirFormulario({ circuito_nombre: pl.circuito_nombre || "", planteles: [{ codigo_dea: codigo, nombre_plantel: pl.nombre_plantel || codigo, estado: "POR_ATENDER" }] });
    } catch (_) { abrirFormulario({}); }
  }
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
      <p>${resumen.proyectos} proyecto${resumen.proyectos === 1 ? "" : "s"} · ${resumen.planteles} plantel${resumen.planteles === 1 ? "" : "es"} (${resumen.planteles_atendidos} atendido${resumen.planteles_atendidos === 1 ? "" : "s"})${resumen.sin_planteles ? ` · ${resumen.sin_planteles} sin planteles definidos` : ""}.
        ${resumen.por_anio.map((a) => `${a.anio}: ${a.proyectos}`).join(" · ")}</p>
    </div></section>
    <div class="panel">
      <div class="pc-filtros">
        <label>Año<select id="fAnio">${opAnios}</select></label>
        <label style="flex:1; min-width:200px;">Buscar<input type="text" id="fTexto" value="${escapar(q)}" placeholder="Comuna, proyecto, plantel o código…"></label>
        ${edita ? `<button type="button" class="btn btn-primario btn-sm" id="btnNuevo">Registrar proyecto comunal</button>` : ""}
      </div>
      <div style="padding:0 20px 16px;">${proyectos.length ? proyectos.map((p) => `
        <details class="pc-proyecto">
          <summary>
            <div><strong>${escapar(p.circuito_nombre)}</strong> <span class="pc-sub">${escapar(p.circuito_codigo)}</span></div>
            <div>${p.numero}.ª consulta · ${p.anio}${p.fecha_consulta ? ` · ${escapar(fechaBonita(p.fecha_consulta))}` : ""} — <strong>${escapar(p.nombre_proyecto)}</strong></div>
            <div class="${p.sin_planteles ? "pc-alerta" : "pc-sub"}">${p.sin_planteles ? "Falta definir los planteles que atiende" : `${p.planteles.length} plantel${p.planteles.length === 1 ? "" : "es"} · ${p.atendidos} atendido${p.atendidos === 1 ? "" : "s"}`}</div>
          </summary>
          ${p.observaciones ? `<div class="pc-sub" style="padding:6px 0;">${escapar(p.observaciones)}</div>` : ""}
          ${p.planteles.length ? `<div class="tabla-responsive"><table class="pc-tabla"><thead><tr><th>Plantel</th><th>Código</th><th>Municipio</th><th>Estado</th></tr></thead><tbody>
            ${p.planteles.map((x) => `<tr><td>${escapar(x.nombre_plantel)}</td><td>${escapar(x.codigo_dea)}</td><td>${escapar(x.municipio)}</td><td><span class="pc-estado ${x.estado === "ATENDIDO" ? "ok" : ""}">${ESTADO_TXT[x.estado]}</span></td></tr>`).join("")}</tbody></table></div>` : ""}
          ${edita ? `<div style="padding-top:8px;"><button type="button" class="btn btn-fantasma btn-sm" data-editar="${p.id}">Editar</button> <button type="button" class="btn btn-fantasma btn-sm" data-quitar="${p.id}">Quitar</button></div>` : ""}
        </details>`).join("") : `<div class="vacio"><strong>Sin proyectos comunales</strong>Aún no hay proyectos registrados${anioSel || q ? " con ese filtro" : ""}.</div>`}</div>
    </div>`;
  document.getElementById("fAnio").addEventListener("change", () => cargar().catch((e) => mostrarToast(e.message, true)));
  document.getElementById("fTexto").addEventListener("input", () => { clearTimeout(filtroTimer); filtroTimer = setTimeout(() => cargar().then(() => { const t = document.getElementById("fTexto"); t.focus(); t.setSelectionRange(t.value.length, t.value.length); }).catch((e) => mostrarToast(e.message, true)), 350); });
  const nuevo = document.getElementById("btnNuevo");
  if (nuevo) nuevo.addEventListener("click", () => abrirFormulario({}));
  document.querySelectorAll("[data-editar]").forEach((b) => b.addEventListener("click", () => abrirFormulario(proyectos.find((p) => p.id === Number(b.dataset.editar)))));
  document.querySelectorAll("[data-quitar]").forEach((b) => b.addEventListener("click", () => quitar(Number(b.dataset.quitar))));
}

async function quitar(id) {
  if (!window.confirm("¿Quitar este proyecto comunal y su lista de planteles?")) return;
  try { await RAC.del(`${API}/${id}`); mostrarToast("Proyecto quitado."); await cargar(); } catch (err) { mostrarToast(err.message, true); }
}

// Búsqueda "al escribir" (sin distinguir mayúsculas ni acentos), por código o por nombre: muestra TODOS los parecidos.
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

function filtrarLista(arr) {
  return (texto) => {
    const q = sinAcentos(texto);
    return arr.filter((x) => !q || sinAcentos(x.nombre).includes(q) || sinAcentos(x.codigo).includes(q)).slice(0, 40)
      .map((x) => ({ valor: x.nombre, etiqueta: x.nombre, sub: x.codigo || "" }));
  };
}

// Formulario: nuevo (sin id) o edición (con id). `p.planteles` = [{codigo_dea, nombre_plantel, estado}].
function abrirFormulario(p) {
  const editando = Boolean(p.id);
  const planteles = (p.planteles || []).map((x) => ({ codigo_dea: x.codigo_dea, nombre_plantel: x.nombre_plantel || x.codigo_dea, estado: x.estado || "POR_ATENDER" }));
  const fondo = document.createElement("div");
  fondo.className = "pc-fondo";
  fondo.innerHTML = `<div class="pc-modal"><h3 style="margin:0;">${editando ? "Editar" : "Registrar"} proyecto comunal</h3>
    <div class="pc-form">
      <label>Comuna o circuito comunal (obligatorio — escribe el código o el nombre)<input type="text" id="pcCircuito" autocomplete="off" placeholder="Escribe para buscar…" value="${escapar(p.circuito_nombre || "")}"></label>
      <div class="pc-lista" id="pcListaCir"></div>
      <div class="pc-fila">
        <label>Fecha de la consulta (elección)<input type="date" id="pcFecha" value="${escapar(p.fecha_consulta || "")}"></label>
        <label>Año<input type="number" id="pcAnio" min="2000" max="${new Date().getFullYear() + 1}" value="${escapar(p.anio || new Date().getFullYear())}"></label>
      </div>
      <label>Nombre del proyecto<input type="text" id="pcNombre" maxlength="200" value="${escapar(p.nombre_proyecto || "")}"></label>
      <label>Observaciones<textarea id="pcObs" rows="2" maxlength="1000">${escapar(p.observaciones || "")}</textarea></label>
      <h4 style="margin:6px 0 0;">Planteles que atiende este proyecto</h4>
      <div class="pc-sub">El número de consulta (1.ª, 2.ª…) se asigna solo, por comuna, según la fecha.</div>
      <div id="pcPlanteles"></div>
      <label>Agregar plantel (escribe el código o el nombre)<input type="text" id="pcBusca" autocomplete="off" placeholder="Ej.: OD06031608 o parte del nombre"></label>
      <div class="pc-lista" id="pcResultados"></div>
      <div><button type="button" class="btn btn-fantasma btn-sm" id="pcDelCircuito">Agregar los planteles de esta comuna</button></div>
      <div id="pcError" style="color:#c53030; font-size:.82rem;"></div>
    </div>
    <div style="display:flex; gap:8px; justify-content:flex-end;"><button type="button" class="btn btn-fantasma btn-sm" id="pcCancelar">Cancelar</button><button type="button" class="btn btn-primario btn-sm" id="pcGuardar">Guardar</button></div></div>`;
  document.body.appendChild(fondo);
  const $ = (id) => fondo.querySelector(id);
  const cerrar = () => fondo.remove();
  $("#pcCancelar").addEventListener("click", cerrar);

  const pintarPlanteles = () => {
    $("#pcPlanteles").innerHTML = planteles.length ? planteles.map((x, i) => `<div class="pc-plantel">
      <span style="flex:1; min-width:0;">${escapar(x.nombre_plantel)} <span class="pc-sub">${escapar(x.codigo_dea)}</span></span>
      <select data-estado="${i}"><option value="POR_ATENDER" ${x.estado === "POR_ATENDER" ? "selected" : ""}>Por atender</option><option value="ATENDIDO" ${x.estado === "ATENDIDO" ? "selected" : ""}>Atendido</option></select>
      <button type="button" class="btn btn-fantasma btn-sm" data-sacar="${i}" title="Quitar de la lista">✕</button></div>`).join("") : `<div class="pc-alerta">Aún no hay planteles en este proyecto.</div>`;
    fondo.querySelectorAll("[data-estado]").forEach((s) => s.addEventListener("change", () => { planteles[Number(s.dataset.estado)].estado = s.value; }));
    fondo.querySelectorAll("[data-sacar]").forEach((b) => b.addEventListener("click", () => { planteles.splice(Number(b.dataset.sacar), 1); pintarPlanteles(); }));
  };
  const agregar = (cod, nombre) => {
    const c = String(cod).toUpperCase();
    if (planteles.some((x) => x.codigo_dea === c)) return false;
    planteles.push({ codigo_dea: c, nombre_plantel: nombre || c, estado: "POR_ATENDER" });
    return true;
  };
  pintarPlanteles();

  conectarBusqueda($("#pcCircuito"), $("#pcListaCir"), filtrarLista(OPCIONES.circuitos), (x) => { $("#pcCircuito").value = x.valor; });
  conectarBusqueda($("#pcBusca"), $("#pcResultados"), async (texto) => {
    if (texto.trim().length < 2) return [];
    const r = await RAC.get(`${API}/buscar?q=${encodeURIComponent(texto.trim())}`);
    return r.planteles.map((x) => ({ valor: x.cod_plantel, etiqueta: x.nombre_plantel, sub: `${x.cod_plantel} · ${x.municipio}${x.parroquia ? " · " + x.parroquia : ""}` }));
  }, (x) => { agregar(x.valor, x.etiqueta); $("#pcBusca").value = ""; pintarPlanteles(); });

  // La fecha fija el año.
  $("#pcFecha").addEventListener("change", () => { const m = /^(\d{4})-/.exec($("#pcFecha").value); if (m) $("#pcAnio").value = m[1]; });

  const resolverCircuito = () => {
    const q = sinAcentos($("#pcCircuito").value);
    if (!q) throw new Error("La comuna o circuito comunal es obligatoria.");
    const x = OPCIONES.circuitos.find((y) => sinAcentos(y.nombre) === q) || OPCIONES.circuitos.find((y) => y.codigo && sinAcentos(y.codigo) === q);
    if (!x) throw new Error("Elige la comuna de la lista de sugerencias.");
    return x;
  };
  $("#pcDelCircuito").addEventListener("click", async () => {
    const err = $("#pcError");
    err.textContent = "";
    try {
      const c = resolverCircuito();
      const r = await RAC.get(`${API}/circuito/${encodeURIComponent(c.codigo || c.nombre)}`);
      let nuevos = 0;
      r.planteles.forEach((x) => { if (agregar(x.cod_plantel, x.nombre_plantel)) nuevos += 1; });
      pintarPlanteles();
      mostrarToast(r.planteles.length ? `${nuevos} plantel${nuevos === 1 ? "" : "es"} agregado${nuevos === 1 ? "" : "s"} (${r.planteles.length} en la comuna). Quita los que este proyecto no atienda.` : "GESCOLAR no tiene planteles vinculados a esta comuna.");
    } catch (e) { err.textContent = e.message; }
  });

  $("#pcGuardar").addEventListener("click", async () => {
    const err = $("#pcError");
    err.textContent = "";
    try {
      const c = resolverCircuito();
      const cuerpo = { circuito_codigo: c.codigo, circuito_nombre: c.nombre, anio: $("#pcAnio").value, fecha_consulta: $("#pcFecha").value, nombre_proyecto: $("#pcNombre").value, observaciones: $("#pcObs").value,
        planteles: planteles.map((x) => ({ codigo_dea: x.codigo_dea, estado: x.estado })) };
      if (editando) await RAC.put(`${API}/${p.id}`, cuerpo); else await RAC.post(`${API}/`, cuerpo);
      cerrar();
      mostrarToast("Proyecto comunal guardado.");
      await cargar();
    } catch (e) { err.textContent = e.message; }
  });
}
