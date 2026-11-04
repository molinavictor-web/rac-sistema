// inspecciones-reportes.js — Reportes (Inspecciones).
// Se elige un plan —o se buscan y agregan planteles uno a uno—, se marcan las columnas (datos del plantel, matrícula, edificio, inspección…) y se ve la tabla
// en pantalla o se descarga en Excel. El servidor valida cada columna contra su catálogo cerrado.

const usuario = renderShell("inspecciones-reportes", "Reportes");
const n = (v) => Number(v || 0).toLocaleString("es-VE");
const CLAVE_GUARDADA = "rep_columnas_" + (usuario && usuario.id ? usuario.id : "x");

let CAT = null;          // { grupos, columnas, presets }
let PLANES = [];
let seleccion = new Set();
let ultimo = null;        // último reporte mostrado
let fuente = "plan";      // "plan" | "planteles"
let elegidos = [];        // [{codigo_dea, nombre, municipio, parroquia}] cuando la fuente es "planteles"
const CLAVE_ELEGIDOS = "rep_planteles_" + (usuario && usuario.id ? usuario.id : "x");
let temporizador = null;

function escapar(v) {
  return String(v === undefined || v === null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

if (usuario) iniciar();

async function iniciar() {
  document.getElementById("contenido").innerHTML = `
    <section class="planteles-hero"><div class="planteles-hero-copy">
      <span class="planteles-eyebrow">INSPECCIONES</span>
      <h1>Reportes</h1>
      <p>Elige un plan de atención, o busca y agrega los planteles que quieras, y marca los datos que quieres ver de sus planteles: matrícula, si comparten edificio o están solos, estado de la inspección, proyección de aulas a rehabilitar y más. Puedes verlo en pantalla o descargarlo en Excel.</p>
    </div></section>
    <div class="panel rep-panel" id="armado"><div class="cargando">Cargando…</div></div>
    <div id="resultado"></div>`;
  try {
    const [cat, planes] = await Promise.all([
      RAC.get("/api/inspecciones/reportes/catalogo"),
      RAC.get("/api/inspecciones/reportes/planes"),
    ]);
    CAT = cat;
    PLANES = planes.planes || [];
  } catch (err) {
    document.getElementById("armado").innerHTML = `<div class="rep-error">${escapar(err.message)}</div>`;
    return;
  }
  seleccion = columnasIniciales();
  dibujarArmado();
}

function columnasIniciales() {
  const validas = new Set(CAT.columnas.map((c) => c.id));
  try {
    const guardado = JSON.parse(localStorage.getItem(CLAVE_GUARDADA) || "null");
    if (Array.isArray(guardado)) {
      const ok = guardado.filter((id) => validas.has(id));
      if (ok.length) return new Set(ok);
    }
  } catch (_) { /* sin almacenamiento: se usa la combinación sugerida */ }
  const base = CAT.presets.find((p) => p.id === "esencial") || CAT.presets[0];
  return new Set(base ? base.columnas : []);
}

function recordar() {
  try { localStorage.setItem(CLAVE_GUARDADA, JSON.stringify([...seleccion])); } catch (_) { /* opcional */ }
}

// Borra la tabla y las tarjetas de abajo (para que no quede un resultado viejo que ya no corresponde a lo elegido).
function limpiarResultado() {
  ultimo = null;
  const r = document.getElementById("resultado");
  if (r) r.innerHTML = "";
  const e = document.getElementById("repError");
  if (e) e.textContent = "";
}

function cargarElegidos() {
  try {
    const g = JSON.parse(localStorage.getItem(CLAVE_ELEGIDOS) || "null");
    if (Array.isArray(g)) return g.filter((x) => x && typeof x.codigo_dea === "string").slice(0, 300);
  } catch (_) { /* sin almacenamiento */ }
  return [];
}
function recordarElegidos() {
  try { localStorage.setItem(CLAVE_ELEGIDOS, JSON.stringify(elegidos)); } catch (_) { /* opcional */ }
}

function planInicial() {
  const deUrl = Number(new URLSearchParams(window.location.search).get("plan"));
  if (deUrl && PLANES.some((p) => p.id === deUrl)) return deUrl;
  const activo = PLANES.find((p) => p.estado !== "CERRADO" && p.planteles > 0) || PLANES.find((p) => p.planteles > 0) || PLANES[0];
  return activo ? activo.id : 0;
}

function dibujarArmado() {
  const cont = document.getElementById("armado");
  const idPlan = planInicial();
  cont.innerHTML = `
    <div class="rep-presets" id="fuentes">
      <button type="button" class="rep-chip" data-fuente="plan">Un plan de atención</button>
      <button type="button" class="rep-chip" data-fuente="planteles">Planteles que yo elija</button>
    </div>
    <div class="rep-fila" id="bloquePlan">
      <label for="plan"><strong>Plan de atención</strong></label>
      <select id="plan">${PLANES.map((p) => `<option value="${p.id}"${p.id === idPlan ? " selected" : ""}>${escapar(p.nombre)} (${p.planteles} planteles)</option>`).join("")}</select>
    </div>
    <div id="bloquePlanteles" style="display:none;">
      <div class="rep-fila">
        <label for="buscar"><strong>Buscar plantel</strong></label>
        <input type="search" id="buscar" placeholder="Nombre, código DEA, municipio o parroquia…" autocomplete="off" style="flex:1; min-width:220px;">
      </div>
      <div id="sugerencias" class="rep-sugerencias"></div>
      <div id="elegidos" class="rep-elegidos"></div>
    </div>
    <div class="rep-presets" id="presets"><span style="font-size:.84rem; color:#5b6b80; align-self:center;">Combinaciones listas:</span>
      ${CAT.presets.map((p) => `<button type="button" class="rep-chip" data-preset="${escapar(p.id)}">${escapar(p.etiqueta)}</button>`).join("")}
    </div>
    <div class="rep-grupos" id="grupos">
      ${CAT.grupos.map((g) => `
        <div class="rep-grupo" data-grupo="${escapar(g.id)}">
          <h3>${escapar(g.etiqueta)} <button type="button" data-todo="${escapar(g.id)}">marcar / quitar todo</button></h3>
          ${CAT.columnas.filter((c) => c.grupo === g.id).map((c) => `<label><input type="checkbox" data-col="${escapar(c.id)}"> <span>${escapar(c.etiqueta)}</span></label>`).join("")}
        </div>`).join("")}
    </div>
    <div class="rep-acciones">
      <button type="button" class="btn btn-primario" id="btnVer">Ver reporte</button>
      <button type="button" class="btn btn-fantasma" id="btnExcel">Descargar Excel</button>
      <button type="button" class="btn btn-fantasma" id="btnLimpiar">Limpiar</button>
    </div>
    <div class="rep-error" id="repError"></div>`;

  elegidos = cargarElegidos();
  fuente = PLANES.length ? "plan" : "planteles";
  pintarFuente();
  pintarElegidos();
  cont.querySelectorAll("[data-fuente]").forEach((b) => b.addEventListener("click", () => { if (fuente !== b.dataset.fuente) { fuente = b.dataset.fuente; pintarFuente(); limpiarResultado(); } }));
  document.getElementById("buscar").addEventListener("input", (e) => {
    clearTimeout(temporizador);
    const q = e.target.value.trim();
    if (q.length < 2) { document.getElementById("sugerencias").innerHTML = ""; return; }
    temporizador = setTimeout(() => buscar(q), 300);
  });
  const selPlan = document.getElementById("plan");
  if (selPlan) selPlan.addEventListener("change", limpiarResultado);
  pintarSeleccion();
  cont.querySelectorAll("[data-col]").forEach((chk) => chk.addEventListener("change", () => {
    if (chk.checked) seleccion.add(chk.dataset.col); else seleccion.delete(chk.dataset.col);
    recordar(); pintarSeleccion();
  }));
  cont.querySelectorAll("[data-preset]").forEach((b) => b.addEventListener("click", () => {
    const p = CAT.presets.find((x) => x.id === b.dataset.preset);
    if (p) { seleccion = new Set(p.columnas); recordar(); pintarSeleccion(); }
  }));
  cont.querySelectorAll("[data-todo]").forEach((b) => b.addEventListener("click", () => {
    const ids = CAT.columnas.filter((c) => c.grupo === b.dataset.todo).map((c) => c.id);
    const todas = ids.every((id) => seleccion.has(id));
    ids.forEach((id) => { if (todas) seleccion.delete(id); else seleccion.add(id); });
    recordar(); pintarSeleccion();
  }));
  document.getElementById("btnVer").addEventListener("click", verReporte);
  document.getElementById("btnLimpiar").addEventListener("click", () => {
    if (fuente === "planteles") { elegidos = []; recordarElegidos(); pintarElegidos(); document.getElementById("buscar").value = ""; document.getElementById("sugerencias").innerHTML = ""; }
    limpiarResultado();
  });
  document.getElementById("btnExcel").addEventListener("click", (e) => descargarExcel(e.currentTarget));
}

function pintarFuente() {
  document.querySelectorAll("[data-fuente]").forEach((b) => b.classList.toggle("activa", b.dataset.fuente === fuente));
  document.getElementById("bloquePlan").style.display = fuente === "plan" ? "" : "none";
  document.getElementById("bloquePlanteles").style.display = fuente === "planteles" ? "" : "none";
  if (fuente === "plan" && !PLANES.length) {
    document.getElementById("bloquePlan").innerHTML = `<span style="color:#5b6b80;">Todavía no hay planes de atención. Usa «Planteles que yo elija».</span>`;
  }
}

async function buscar(q) {
  const cont = document.getElementById("sugerencias");
  try {
    const r = await RAC.get(`/api/inspecciones/reportes/seleccion/buscar?q=${encodeURIComponent(q)}`);
    if (document.getElementById("buscar").value.trim() !== q) return; // llegó tarde
    const libres = r.planteles.filter((p) => !elegidos.some((e) => e.codigo_dea === p.codigo_dea));
    cont.innerHTML = libres.length
      ? libres.map((p) => `<button type="button" class="rep-sug" data-add="${escapar(p.codigo_dea)}"><strong>${escapar(p.nombre)}</strong><span>${escapar(p.codigo_dea)} · ${escapar(p.municipio)}${p.parroquia ? " · " + escapar(p.parroquia) : ""}</span></button>`).join("") + (r.limitado ? `<div class="rep-nota">Hay más resultados: escribe más para afinar.</div>` : "")
      : `<div class="rep-nota">${r.planteles.length ? "Los que coinciden ya están agregados." : "No se encontró ningún plantel."}</div>`;
    cont.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => {
      const p = r.planteles.find((x) => x.codigo_dea === b.dataset.add);
      if (p && !elegidos.some((e) => e.codigo_dea === p.codigo_dea) && elegidos.length < 300) { elegidos.push(p); recordarElegidos(); pintarElegidos(); }
      b.remove();
    }));
  } catch (err) {
    cont.innerHTML = `<div class="rep-error">${escapar(err.message)}</div>`;
  }
}

function pintarElegidos() {
  const cont = document.getElementById("elegidos");
  if (!cont) return;
  cont.innerHTML = elegidos.length
    ? `<div class="rep-nota"><strong>${elegidos.length}</strong> plantel(es) elegido(s) <button type="button" id="quitarTodos" class="rep-link">quitar todos</button></div>` +
      elegidos.map((p) => `<span class="rep-pastilla" title="${escapar(p.codigo_dea)}">${escapar(p.nombre)} <button type="button" data-quitar="${escapar(p.codigo_dea)}" aria-label="Quitar ${escapar(p.nombre)}">×</button></span>`).join("")
    : `<div class="rep-nota">Todavía no has agregado planteles. Busca por nombre o código y toca el que quieras.</div>`;
  cont.querySelectorAll("[data-quitar]").forEach((b) => b.addEventListener("click", () => { elegidos = elegidos.filter((e) => e.codigo_dea !== b.dataset.quitar); recordarElegidos(); pintarElegidos(); limpiarResultado(); }));
  const qt = document.getElementById("quitarTodos");
  if (qt) qt.addEventListener("click", () => { elegidos = []; recordarElegidos(); pintarElegidos(); limpiarResultado(); });
}

function pintarSeleccion() {
  document.querySelectorAll("[data-col]").forEach((chk) => { chk.checked = seleccion.has(chk.dataset.col); });
  document.querySelectorAll("[data-preset]").forEach((b) => {
    const p = CAT.presets.find((x) => x.id === b.dataset.preset);
    const igual = p && p.columnas.length === seleccion.size && p.columnas.every((id) => seleccion.has(id));
    b.classList.toggle("activa", Boolean(igual));
  });
}

function parametros() {
  const plan = fuente === "plan" ? document.getElementById("plan").value : "";
  // El orden de las columnas lo define el catálogo, no el orden en que se marcaron.
  const cols = CAT.columnas.filter((c) => seleccion.has(c.id)).map((c) => c.id);
  return { plan, cols };
}

function validar() {
  const err = document.getElementById("repError");
  err.textContent = "";
  const { plan, cols } = parametros();
  if (fuente === "plan" && !plan) { err.textContent = "Elige un plan."; return null; }
  if (fuente === "planteles" && !elegidos.length) { err.textContent = "Agrega al menos un plantel."; return null; }
  if (!cols.length) { err.textContent = "Marca al menos una columna."; return null; }
  return { plan, cols };
}

async function verReporte() {
  const p = validar();
  if (!p) return;
  const cont = document.getElementById("resultado");
  cont.innerHTML = `<div class="panel"><div class="cargando">Armando el reporte…</div></div>`;
  try {
    ultimo = fuente === "plan"
      ? await RAC.get(`/api/inspecciones/reportes/plan/${encodeURIComponent(p.plan)}?columnas=${encodeURIComponent(p.cols.join(","))}`)
      : await RAC.post("/api/inspecciones/reportes/seleccion", { codigos: elegidos.map((e) => e.codigo_dea), columnas: p.cols });
    dibujarResultado();
  } catch (err) {
    cont.innerHTML = `<div class="panel rep-panel"><div class="rep-error">${escapar(err.message)}</div></div>`;
  }
}

function celda(c, v) {
  if (c.tipo === "decimal") return `<td class="num">${v === null || v === undefined ? "—" : Number(v).toLocaleString("es-VE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>`;
  if (c.tipo === "entero") return `<td class="num">${v === null || v === undefined ? "—" : n(v)}</td>`;
  if (c.id === "edificio_estado") {
    const clase = v === "Comparte edificio" ? "comparte" : v === "Solo en su edificio" ? "solo" : "sin";
    return `<td><span class="rep-etq ${clase}">${escapar(v)}</span></td>`;
  }
  if (c.id === "edificio_codigo") return `<td><code style="font-family:'IBM Plex Mono',monospace;">${escapar(v)}</code></td>`;
  return `<td>${escapar(v)}</td>`;
}

function dibujarResultado() {
  const r = ultimo;
  const res = r.resumen;
  const conProy = res.alumnos_adicionales_min !== null && res.alumnos_adicionales_min !== undefined;
  const tarjeta = (num, txt) => `<div class="stat-card"><div class="num">${n(num)}</div><div class="lbl">${escapar(txt)}</div></div>`;
  const conEdificio = res.edificios_distintos !== null && res.edificios_distintos !== undefined;
  const tfoot = r.columnas.some((c) => c.sumable)
    ? `<tfoot><tr>${r.columnas.map((c, i) => c.sumable ? `<td class="num">${n(r.totales[c.id])}</td>` : `<td>${i === 0 ? "TOTAL" : ""}</td>`).join("")}</tr></tfoot>`
    : "";
  document.getElementById("resultado").innerHTML = `
    <div class="rep-tarjetas">
      ${tarjeta(res.planteles, "Planteles")}
      ${tarjeta(res.matricula_total, "Matrícula total")}
      ${conProy ? tarjeta(res.aulas_no_operativas, "Aulas no operativas") + tarjeta(res.alumnos_adicionales_min, "Alumnos adicionales (mín.)") + tarjeta(res.alumnos_adicionales_max, "Alumnos adicionales (máx.)") + (res.planteles_fuerza_mayor ? tarjeta(res.planteles_fuerza_mayor, "Planteles con aulas perdidas por fuerza mayor") : "") : ""}
      ${conEdificio ? tarjeta(res.edificios_distintos, "Edificios distintos") + tarjeta(res.planteles_solos, "Solos en su edificio") + tarjeta(res.planteles_comparten, "Comparten edificio") + tarjeta(res.sin_clasificar, "Sin clasificar") : ""}
    </div>
    ${(r.avisos || []).map((a) => `<div class="rep-aviso">${escapar(a)}</div>`).join("")}
    <div class="panel">
      ${r.filas.length ? `<div class="tabla-responsive rep-scroll"><table class="rep-tabla">
        <thead><tr>${r.columnas.map((c) => `<th class="${c.tipo === "texto" ? "" : "num"}">${escapar(c.etiqueta)}</th>`).join("")}</tr></thead>
        <tbody>${r.filas.map((f) => `<tr>${r.columnas.map((c) => celda(c, f[c.id])).join("")}</tr>`).join("")}</tbody>
        ${tfoot}
      </table></div>` : `<div class="vacio"><strong>No hay planteles para mostrar</strong>Si es un plan, enlaza planteles desde «Planes de atención».</div>`}
    </div>`;
}

// Descarga el Excel (hace falta enviar el token, por eso no es un simple enlace).
async function descargarExcel(boton) {
  const p = validar();
  if (!p) return;
  const original = boton.textContent;
  boton.disabled = true;
  boton.textContent = "Generando Excel…";
  try {
    const resp = fuente === "plan"
      ? await fetch(`/api/inspecciones/reportes/plan/${encodeURIComponent(p.plan)}/excel?columnas=${encodeURIComponent(p.cols.join(","))}`, { headers: { Authorization: "Bearer " + RAC.getToken() } })
      : await fetch("/api/inspecciones/reportes/seleccion/excel", {
        method: "POST",
        headers: { Authorization: "Bearer " + RAC.getToken(), "Content-Type": "application/json" },
        body: JSON.stringify({ codigos: elegidos.map((e) => e.codigo_dea), columnas: p.cols }),
      });
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
    enlace.download = m ? m[1] : "REPORTE.xlsx";
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    setTimeout(() => URL.revokeObjectURL(enlace.href), 4000);
  } catch (err) {
    mostrarToast(err.message, true);
  } finally {
    boton.disabled = false;
    boton.textContent = original;
  }
}
