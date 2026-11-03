// infraestructuras.js — clasificar cada plantel: solo en su edificio o comparte edificio (código INFRA-000001…).

const usuario = renderShell("inspecciones-infra", "Infraestructuras");
const BASE = "/api/inspecciones/infraestructuras";
const PUEDE_ESCRIBIR = usuario && ["admin", "insp_coordinador", "insp_ingeniero"].includes(usuario.rol);
const PUEDE_SINCRONIZAR = usuario && ["admin", "insp_coordinador"].includes(usuario.rol);
const MUNICIPIOS = ["Acosta", "Aguasay", "Bolívar", "Caripe", "Cedeño", "Ezequiel Zamora", "Libertador", "Maturín", "Piar", "Punceres", "Santa Bárbara", "Sotillo", "Uracoa"];
const ETQ = { sin_clasificar: ["sin", "Sin clasificar"], solo: ["solo", "Solo en su edificio"], comparte: ["comparte", "Comparte edificio"] };
const n = (v) => Number(v || 0).toLocaleString("es-VE");

function escapar(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

let pagina = 1;
if (usuario) iniciar();

function iniciar() {
  document.getElementById("contenido").innerHTML = `
    <section class="planteles-hero"><div class="planteles-hero-copy">
      <span class="planteles-eyebrow">INSPECCIONES</span>
      <h1>Infraestructuras</h1>
      <p>Indica si cada plantel funciona solo en su edificio o lo comparte con otra institución. Cada edificio recibe un código <strong>INFRA-000001</strong>, <strong>INFRA-000002</strong>… y los compartidos también se anotan en la hoja «Coordenadas Planteles».</p>
    </div></section>
    <div id="tarjetas"><div class="cargando">Cargando…</div></div>
    <div class="panel">
      <div class="inf-filtros">
        <input type="text" id="q" placeholder="Buscar por código o nombre" style="min-width:230px;">
        <select id="estado"><option value="">Todos</option><option value="sin_clasificar">Sin clasificar</option><option value="solo">Solos en su edificio</option><option value="comparte">Comparten edificio</option></select>
        <select id="municipio"><option value="">Todos los municipios</option>${MUNICIPIOS.map((m) => `<option>${escapar(m)}</option>`).join("")}</select>
        <select id="parroquia" disabled title="Elige primero un municipio"><option value="">Todas las parroquias</option></select>
        ${PUEDE_SINCRONIZAR ? `<button type="button" class="btn btn-fantasma btn-sm" id="btnSync" title="Vuelve a leer la hoja Coordenadas Planteles">Sincronizar con la hoja</button>` : ""}
      </div>
      <div id="lista"><div class="cargando">Cargando…</div></div>
      <div class="inf-pag" id="paginas"></div>
    </div>`;
  let t = null;
  document.getElementById("q").addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { pagina = 1; cargarLista(); }, 300); });
  ["estado", "parroquia"].forEach((id) => document.getElementById(id).addEventListener("change", () => { pagina = 1; cargarLista(); }));
  document.getElementById("municipio").addEventListener("change", async () => { pagina = 1; await cargarParroquias(); cargarLista(); });
  const sync = document.getElementById("btnSync");
  if (sync) sync.addEventListener("click", sincronizar);
  cargarResumen();
  cargarLista();
}

async function cargarResumen() {
  const cont = document.getElementById("tarjetas");
  try {
    const r = await RAC.get(`${BASE}/resumen`);
    const pct = r.nombres_planteles ? Math.round((r.clasificados / r.nombres_planteles) * 100) : 0;
    cont.innerHTML = `
      ${r.hoja_ok ? "" : `<div class="inf-aviso">No se pudo leer la hoja «Coordenadas Planteles»; se muestra lo que ya está guardado en el sistema.</div>`}
      <div class="panel" style="padding:16px 20px; margin-bottom:12px;">
        <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap;"><strong>Avance de la clasificación</strong><span>${n(r.clasificados)} de ${n(r.nombres_planteles)} planteles · <strong>${pct}%</strong></span></div>
        <div class="inf-barra"><span style="width:${pct}%"></span></div>
      </div>
      <div class="inf-tarjetas">
        <div class="stat-card"><div class="num">${n(r.nombres_planteles)}</div><div class="lbl">Nombres de planteles (GESCOLAR)</div></div>
        <div class="stat-card"><div class="num">${n(r.sin_clasificar)}</div><div class="lbl">Sin clasificar</div></div>
        <div class="stat-card"><div class="num">${n(r.solos)}</div><div class="lbl">Solos en su edificio</div></div>
        <div class="stat-card"><div class="num">${n(r.edificios_compartidos)}</div><div class="lbl">Edificios compartidos</div><div class="lbl" style="margin-top:2px;">${n(r.nombres_en_compartidos)} nombres en ellos</div></div>
        <div class="stat-card"><div class="num">${r.infraestructuras === null ? "—" : n(r.infraestructuras)}</div><div class="lbl">Infraestructuras (edificios)</div><div class="lbl" style="margin-top:2px;">baja al registrar compartidos</div></div>
        <div class="stat-card"><div class="num">${n(r.planteles_con_espacios)}</div><div class="lbl">Planteles con espacios separados</div><div class="lbl" style="margin-top:2px;">${n(r.espacios_separados)} espacios adicionales</div></div>
      </div>`;
  } catch (ex) {
    cont.innerHTML = `<div class="panel"><div class="vacio"><strong>No se pudo cargar el resumen</strong>${escapar(ex.message)}</div></div>`;
  }
}

// Las parroquias dependen del municipio elegido; sin municipio el filtro queda apagado.
async function cargarParroquias() {
  const sel = document.getElementById("parroquia");
  const municipio = document.getElementById("municipio").value;
  sel.innerHTML = `<option value="">Todas las parroquias</option>`;
  sel.disabled = !municipio;
  sel.title = municipio ? "" : "Elige primero un municipio";
  if (!municipio) return;
  try {
    const r = await RAC.get(`${BASE}/parroquias?municipio=${encodeURIComponent(municipio)}`);
    sel.innerHTML = `<option value="">Todas las parroquias (${r.parroquias.length})</option>` + r.parroquias.map((x) => `<option>${escapar(x)}</option>`).join("");
  } catch (ex) {
    mostrarToast(ex.message, true);
  }
}

async function cargarLista() {
  const cont = document.getElementById("lista");
  const q = document.getElementById("q").value.trim();
  const estado = document.getElementById("estado").value;
  const municipio = document.getElementById("municipio").value;
  const parroquia = document.getElementById("parroquia").value;
  try {
    const r = await RAC.get(`${BASE}/planteles?q=${encodeURIComponent(q)}&estado=${estado}&municipio=${encodeURIComponent(municipio)}&parroquia=${encodeURIComponent(parroquia)}&pagina=${pagina}`);
    if (!r.planteles.length) {
      cont.innerHTML = `<div class="vacio"><strong>Sin resultados</strong>Prueba con otro filtro.</div>`;
      document.getElementById("paginas").innerHTML = "";
      return;
    }
    cont.innerHTML = `<div class="tabla-responsive"><table>
      <thead><tr><th>Código DEA</th><th>Plantel</th><th>Municipio</th><th>Parroquia</th><th>Estado</th><th>Código de infraestructura</th><th></th></tr></thead>
      <tbody>${r.planteles.map((p) => {
        const [clase, texto] = ETQ[p.estado];
        return `<tr>
          <td><code>${escapar(p.codigo_dea)}</code></td><td>${escapar(p.nombre_plantel)}</td><td>${escapar(p.municipio)}</td><td>${escapar(p.parroquia)}</td>
          <td><span class="inf-etq ${clase}">${texto}</span>${p.estado === "comparte" ? ` <small>(${p.cantidad} nombres)</small>` : ""}${p.espacios ? ` <span class="inf-etq esp" title="Funciona además en otros espacios separados">+${p.espacios} espacio${p.espacios === 1 ? "" : "s"}</span>` : ""}</td>
          <td>${p.codigo_infraestructura ? `<code class="infra">${escapar(p.codigo_infraestructura)}</code>` : ""}${p.codigo_anterior ? ` <small title="Código que tenía en la hoja Coordenadas Planteles">(hoja: ${escapar(p.codigo_anterior)})</small>` : ""}</td>
          <td style="white-space:nowrap;"><button type="button" class="btn btn-fantasma btn-sm" data-abrir="${escapar(p.codigo_dea)}">${PUEDE_ESCRIBIR ? (p.estado === "sin_clasificar" ? "Clasificar" : "Cambiar") : "Ver"}</button></td>
        </tr>`;
      }).join("")}</tbody></table></div>`;
    cont.querySelectorAll("[data-abrir]").forEach((b) => b.addEventListener("click", () => abrirPlantel(b.dataset.abrir)));
    const paginas = Math.max(1, Math.ceil(r.total_filtrado / r.limite));
    document.getElementById("paginas").innerHTML = `<button type="button" class="btn btn-fantasma btn-sm" id="pgAnt" ${pagina <= 1 ? "disabled" : ""}>← Anterior</button>
      <span>${n(r.total_filtrado)} planteles · página ${pagina} de ${paginas}</span>
      <button type="button" class="btn btn-fantasma btn-sm" id="pgSig" ${pagina >= paginas ? "disabled" : ""}>Siguiente →</button>`;
    document.getElementById("pgAnt").addEventListener("click", () => { pagina--; cargarLista(); });
    document.getElementById("pgSig").addEventListener("click", () => { pagina++; cargarLista(); });
  } catch (ex) {
    cont.innerHTML = `<div class="vacio"><strong>No se pudo cargar la lista</strong>${escapar(ex.message)}</div>`;
  }
}

async function sincronizar() {
  const b = document.getElementById("btnSync");
  b.disabled = true; b.textContent = "Sincronizando…";
  try {
    const r = await RAC.post(`${BASE}/sincronizar`, {});
    mostrarToast(r.hoja_ok ? "Sincronizado con la hoja." : "No se pudo leer la hoja; se dejó lo que ya estaba.", !r.hoja_ok);
    cargarResumen(); cargarLista();
  } catch (ex) {
    mostrarToast(ex.message, true);
  } finally {
    b.disabled = false; b.textContent = "Sincronizar con la hoja";
  }
}

// ---------------------------------------------------------------------------
// Ventana para clasificar un plantel
// ---------------------------------------------------------------------------

let P = null;            // plantel abierto
let compartidas = [];    // instituciones elegidas {codigo_dea, nombre}
let modo = "solo";
let espacios = [];       // espacios separados del plantel abierto (se envían completos al guardar)

async function abrirPlantel(codigo) {
  try {
    P = await RAC.get(`${BASE}/plantel/${encodeURIComponent(codigo)}`);
  } catch (ex) { mostrarToast(ex.message, true); return; }
  const e = P.edificio;
  compartidas = e && e.cantidad > 1 ? e.miembros.filter((m) => !(m.codigo_dea && m.codigo_dea.toLowerCase() === P.codigo_dea.toLowerCase())).map((m) => ({ codigo_dea: m.codigo_dea, nombre: m.nombre })) : [];
  modo = e && e.cantidad > 1 ? "comparte" : "solo";
  espacios = (P.espacios || []).map((x) => ({ ...x }));
  const fondo = document.createElement("div");
  fondo.className = "inf-fondo"; fondo.id = "infFondo";
  fondo.innerHTML = `<div class="inf-modal" role="dialog" aria-modal="true">
    <h2>${escapar(P.nombre_plantel)}</h2>
    <div class="sub"><code>${escapar(P.codigo_dea)}</code> · ${escapar(P.municipio)}${P.parroquia ? " · " + escapar(P.parroquia) : ""}${P.director ? `<br>Director(a): ${escapar(P.director)}` : ""}${P.direccion ? `<br>${escapar(P.direccion)}` : ""}</div>
    ${e ? `<div class="inf-aviso" style="background:#eef6ff; border-color:#b9d4f5;">Hoy figura en el edificio <code class="infra">${escapar(e.codigo_infraestructura)}</code>${e.cantidad > 1 ? ` con ${e.cantidad} nombres` : " (solo)"}.</div>` : ""}
    ${PUEDE_ESCRIBIR ? `
    <label class="inf-opcion" id="opSolo"><input type="radio" name="modo" value="solo"><span><strong>Está solo en su edificio</strong><br><small>En ese edificio no funciona otra institución.</small></span></label>
    <label class="inf-opcion" id="opComparte"><input type="radio" name="modo" value="comparte"><span><strong>Comparte el edificio con otra(s) institución(es)</strong><br><small>Busca la otra institución por nombre o código DEA.</small></span></label>
    <div id="zonaComparte"></div>` : `<p class="sub">Solo puedes consultar esta información.</p>`}
    <div id="zonaEspacios"></div>
    ${PUEDE_ESCRIBIR ? `<div class="inf-error" id="infError"></div>` : ""}
    <div class="inf-acciones"><button type="button" class="btn btn-fantasma" id="infCerrar">${PUEDE_ESCRIBIR ? "Cancelar" : "Cerrar"}</button>${PUEDE_ESCRIBIR ? `<button type="button" class="btn btn-primario" id="infGuardar">Guardar</button>` : ""}</div>
  </div>`;
  document.body.appendChild(fondo);
  fondo.addEventListener("click", (ev) => { if (ev.target === fondo) cerrar(); });
  document.getElementById("infCerrar").addEventListener("click", cerrar);
  if (PUEDE_ESCRIBIR) {
    fondo.querySelectorAll('input[name="modo"]').forEach((r) => r.addEventListener("change", () => { modo = r.value; pintarModo(); }));
    document.getElementById("infGuardar").addEventListener("click", guardar);
    pintarModo();
  }
  pintarEspacios();
}

function cerrar() {
  const f = document.getElementById("infFondo");
  if (f) f.remove();
  P = null;
}

function pintarModo() {
  document.querySelectorAll('input[name="modo"]').forEach((r) => { r.checked = r.value === modo; });
  document.getElementById("opSolo").classList.toggle("activa", modo === "solo");
  document.getElementById("opComparte").classList.toggle("activa", modo === "comparte");
  const z = document.getElementById("zonaComparte");
  if (modo !== "comparte") { z.innerHTML = ""; return; }
  z.innerHTML = `
    <ul class="inf-lista" id="infLista"></ul>
    <input type="text" id="infBuscar" placeholder="Buscar institución por nombre o código DEA (mínimo 3 letras)" autocomplete="off" style="width:100%; padding:10px 12px; border:1px solid #c7d2e0; border-radius:9px; font:inherit; box-sizing:border-box;">
    <div class="inf-res" id="infRes" style="display:none;"></div>
    <details style="margin-top:8px;"><summary style="cursor:pointer; font-size:.85rem; color:#1b5fc4;">La institución no tiene código DEA: agregarla por nombre</summary>
      <div style="display:flex; gap:8px; margin-top:6px;"><input type="text" id="infNombre" placeholder="Nombre de la institución" style="flex:1; padding:9px 12px; border:1px solid #c7d2e0; border-radius:9px; font:inherit;"><button type="button" class="btn btn-fantasma btn-sm" id="infAgregarNombre">Agregar</button></div>
    </details>`;
  pintarLista();
  let t = null;
  document.getElementById("infBuscar").addEventListener("input", (ev) => { clearTimeout(t); t = setTimeout(() => buscar(ev.target.value), 300); });
  document.getElementById("infAgregarNombre").addEventListener("click", () => {
    const i = document.getElementById("infNombre");
    const nombre = i.value.trim();
    if (!nombre) return;
    if (!compartidas.some((c) => !c.codigo_dea && c.nombre.toLowerCase() === nombre.toLowerCase())) compartidas.push({ codigo_dea: "", nombre });
    i.value = ""; pintarLista();
  });
}

function pintarLista() {
  const ul = document.getElementById("infLista");
  if (!ul) return;
  ul.innerHTML = compartidas.length
    ? compartidas.map((c, i) => `<li><span>${escapar(c.nombre || c.codigo_dea)}${c.codigo_dea ? ` <small>(${escapar(c.codigo_dea)})</small>` : ` <small>(sin código DEA)</small>`}</span><button type="button" class="btn btn-fantasma btn-sm" data-quitar="${i}" style="color:#b3261e;">Quitar</button></li>`).join("")
    : `<li style="color:#718198;">Aún no has agregado ninguna institución.</li>`;
  ul.querySelectorAll("[data-quitar]").forEach((b) => b.addEventListener("click", () => { compartidas.splice(Number(b.dataset.quitar), 1); pintarLista(); }));
}

async function buscar(texto) {
  const res = document.getElementById("infRes");
  const q = texto.trim();
  if (q.length < 3) { res.style.display = "none"; return; }
  try {
    const r = await RAC.get(`${BASE}/buscar?q=${encodeURIComponent(q)}&excluir=${encodeURIComponent(P.codigo_dea)}`);
    res.style.display = "";
    res.innerHTML = r.planteles.length
      ? r.planteles.map((p, i) => `<button type="button" data-i="${i}">${escapar(p.nombre_plantel)} <small>${escapar(p.codigo_dea)} · ${escapar(p.municipio)}${p.codigo_infraestructura ? ` · ya en ${escapar(p.codigo_infraestructura)}` : ""}</small></button>`).join("")
      : `<div style="padding:10px; color:#718198;">Sin resultados.</div>`;
    res.querySelectorAll("[data-i]").forEach((b) => b.addEventListener("click", () => {
      const p = r.planteles[Number(b.dataset.i)];
      if (!compartidas.some((c) => c.codigo_dea && c.codigo_dea.toLowerCase() === p.codigo_dea.toLowerCase())) compartidas.push({ codigo_dea: p.codigo_dea, nombre: p.nombre_plantel });
      document.getElementById("infBuscar").value = ""; res.style.display = "none"; pintarLista();
    }));
  } catch (ex) {
    res.style.display = ""; res.innerHTML = `<div style="padding:10px; color:#b3261e;">${escapar(ex.message)}</div>`;
  }
}

function pintarEspacios() {
  const z = document.getElementById("zonaEspacios");
  if (!z) return;
  if (!PUEDE_ESCRIBIR) {
    z.innerHTML = espacios.length ? `<h3 class="inf-h3">Espacios separados del plantel</h3>
      <ul class="inf-lista">${espacios.map((x) => `<li><span><strong>${escapar(x.subcodigo)}</strong> · ${escapar(x.descripcion)}${x.aulas !== null && x.aulas !== undefined ? ` · ${x.aulas} aula${x.aulas === 1 ? "" : "s"}` : ""}${x.distancia ? ` · ${escapar(x.distancia)}` : ""}${x.referencia ? `<br><small>${escapar(x.referencia)}</small>` : ""}</span></li>`).join("")}</ul>` : "";
    return;
  }
  z.innerHTML = `
    <h3 class="inf-h3">Espacios separados del mismo plantel</h3>
    <p class="sub" style="margin:0 0 8px;">Si el plantel (con este mismo código DEA) funciona además en otros sitios separados del edificio principal, por ejemplo un aula en una casa del caserío, agrégalos aquí. Sirve para saber cuántos espacios hay que atender al rehabilitar.</p>
    ${espacios.map((x, i) => `<div class="inf-esp" data-i="${i}">
      <div class="inf-esp-cab"><strong>${x.subcodigo ? escapar(x.subcodigo) : `Espacio nuevo`}</strong><button type="button" class="btn btn-fantasma btn-sm" data-quitar-esp="${i}" style="color:#b3261e;">Quitar</button></div>
      <label>Descripción *<input type="text" data-c="descripcion" value="${escapar(x.descripcion)}" maxlength="150" placeholder="Ej.: Casa de la Sra. Rosa (aula de 1.er grado)"></label>
      <label>Referencia / cómo llegar<input type="text" data-c="referencia" value="${escapar(x.referencia)}" maxlength="300" placeholder="Ej.: pasando el puente, tercera casa a mano izquierda"></label>
      <div class="inf-esp-fila">
        <label>Distancia o tiempo desde el edificio principal<input type="text" data-c="distancia" value="${escapar(x.distancia)}" maxlength="100" placeholder="Ej.: 10 minutos a pie"></label>
        <label>Aulas o salones<input type="number" data-c="aulas" value="${x.aulas === null || x.aulas === undefined ? "" : x.aulas}" min="0" max="200" step="1"></label>
      </div>
      <div class="inf-esp-fila">
        <label>Latitud (opcional)<input type="text" data-c="latitud" value="${x.latitud === null || x.latitud === undefined ? "" : x.latitud}" placeholder="9.7424"></label>
        <label>Longitud (opcional)<input type="text" data-c="longitud" value="${x.longitud === null || x.longitud === undefined ? "" : x.longitud}" placeholder="-63.1952"></label>
      </div>
      <label>Observaciones<input type="text" data-c="observaciones" value="${escapar(x.observaciones)}" maxlength="500"></label>
    </div>`).join("")}
    <button type="button" class="btn btn-fantasma btn-sm" id="infAgregarEsp" ${espacios.length >= 15 ? "disabled" : ""}>+ Agregar espacio separado</button>`;
  z.querySelectorAll(".inf-esp").forEach((caja) => {
    const i = Number(caja.dataset.i);
    caja.querySelectorAll("[data-c]").forEach((inp) => inp.addEventListener("input", () => { espacios[i][inp.dataset.c] = inp.value; }));
  });
  z.querySelectorAll("[data-quitar-esp]").forEach((b) => b.addEventListener("click", () => {
    const x = espacios[Number(b.dataset.quitarEsp)];
    if (x.id && !window.confirm(`¿Quitar el espacio «${x.descripcion || x.subcodigo}»?`)) return;
    espacios.splice(Number(b.dataset.quitarEsp), 1); pintarEspacios();
  }));
  document.getElementById("infAgregarEsp").addEventListener("click", () => {
    espacios.push({ id: null, subcodigo: "", descripcion: "", referencia: "", distancia: "", aulas: "", observaciones: "", latitud: "", longitud: "" });
    pintarEspacios();
    const cajas = document.querySelectorAll(".inf-esp");
    const ultima = cajas[cajas.length - 1];
    if (ultima) { const inp = ultima.querySelector("input"); if (inp) inp.focus(); }
  });
}

async function guardar() {
  const err = document.getElementById("infError");
  err.textContent = "";
  if (modo === "comparte" && !compartidas.length) { err.textContent = "Agrega la institución con la que comparte el edificio."; return; }
  const e = P.edificio;
  if (modo === "solo" && e && e.cantidad > 1 && !window.confirm(`¿Sacar a «${P.nombre_plantel}» del edificio ${e.codigo_infraestructura}? Pasará a tener su propio código de infraestructura.`)) return;
  const b = document.getElementById("infGuardar");
  b.disabled = true; b.textContent = "Guardando…";
  try {
    const r = await RAC.post(`${BASE}/clasificar`, { codigo_dea: P.codigo_dea, comparte: modo === "comparte", otras: modo === "comparte" ? compartidas : [], espacios: espacios.map((x) => ({ id: x.id, descripcion: x.descripcion, referencia: x.referencia, distancia: x.distancia, aulas: x.aulas, observaciones: x.observaciones, latitud: x.latitud, longitud: x.longitud })) });
    const aviso = { pendiente: " (la hoja Coordenadas Planteles no respondió; el código quedó guardado en el sistema)", no_configurada: "" }[r.hoja_coordenadas] || "";
    mostrarToast(`Guardado: ${r.codigo_infraestructura}${r.comparte ? ` · ${r.edificio ? r.edificio.cantidad : "?"} nombres` : " · solo en su edificio"}${r.espacios && r.espacios.length ? ` · ${r.espacios.length} espacio${r.espacios.length === 1 ? "" : "s"} separado${r.espacios.length === 1 ? "" : "s"}` : ""}${aviso}`);
    cerrar(); cargarResumen(); cargarLista();
  } catch (ex) {
    err.textContent = ex.message;
    b.disabled = false; b.textContent = "Guardar";
  }
}
