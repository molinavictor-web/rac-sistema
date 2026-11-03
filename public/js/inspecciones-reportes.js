// inspecciones-reportes.js — Reportes por plan (Inspecciones).
// Se elige un plan, se marcan las columnas (datos del plantel, matrícula, edificio, inspección…) y se ve la tabla
// en pantalla o se descarga en Excel. El servidor valida cada columna contra su catálogo cerrado.

const usuario = renderShell("inspecciones-reportes", "Reportes");
const n = (v) => Number(v || 0).toLocaleString("es-VE");
const CLAVE_GUARDADA = "rep_columnas_" + (usuario && usuario.id ? usuario.id : "x");

let CAT = null;          // { grupos, columnas, presets }
let PLANES = [];
let seleccion = new Set();
let ultimo = null;        // último reporte mostrado

function escapar(v) {
  return String(v === undefined || v === null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

if (usuario) iniciar();

async function iniciar() {
  document.getElementById("contenido").innerHTML = `
    <section class="planteles-hero"><div class="planteles-hero-copy">
      <span class="planteles-eyebrow">INSPECCIONES</span>
      <h1>Reportes por plan</h1>
      <p>Elige un plan de atención y marca los datos que quieres ver de sus planteles: matrícula, si comparten edificio o están solos, estado de la inspección y más. Puedes verlo en pantalla o descargarlo en Excel.</p>
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

function planInicial() {
  const deUrl = Number(new URLSearchParams(window.location.search).get("plan"));
  if (deUrl && PLANES.some((p) => p.id === deUrl)) return deUrl;
  const activo = PLANES.find((p) => p.estado !== "CERRADO" && p.planteles > 0) || PLANES.find((p) => p.planteles > 0) || PLANES[0];
  return activo ? activo.id : 0;
}

function dibujarArmado() {
  const cont = document.getElementById("armado");
  if (!PLANES.length) {
    cont.innerHTML = `<div class="vacio"><strong>Todavía no hay planes de atención</strong>Crea un plan en «Planes de atención» y enlaza sus planteles.</div>`;
    return;
  }
  const idPlan = planInicial();
  cont.innerHTML = `
    <div class="rep-fila">
      <label for="plan"><strong>Plan de atención</strong></label>
      <select id="plan">${PLANES.map((p) => `<option value="${p.id}"${p.id === idPlan ? " selected" : ""}>${escapar(p.nombre)} (${p.planteles} planteles)</option>`).join("")}</select>
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
    </div>
    <div class="rep-error" id="repError"></div>`;

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
  document.getElementById("btnExcel").addEventListener("click", (e) => descargarExcel(e.currentTarget));
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
  const plan = document.getElementById("plan").value;
  // El orden de las columnas lo define el catálogo, no el orden en que se marcaron.
  const cols = CAT.columnas.filter((c) => seleccion.has(c.id)).map((c) => c.id);
  return { plan, cols };
}

function validar() {
  const err = document.getElementById("repError");
  err.textContent = "";
  const { plan, cols } = parametros();
  if (!plan) { err.textContent = "Elige un plan."; return null; }
  if (!cols.length) { err.textContent = "Marca al menos una columna."; return null; }
  return { plan, cols };
}

async function verReporte() {
  const p = validar();
  if (!p) return;
  const cont = document.getElementById("resultado");
  cont.innerHTML = `<div class="panel"><div class="cargando">Armando el reporte…</div></div>`;
  try {
    ultimo = await RAC.get(`/api/inspecciones/reportes/plan/${encodeURIComponent(p.plan)}?columnas=${encodeURIComponent(p.cols.join(","))}`);
    dibujarResultado();
  } catch (err) {
    cont.innerHTML = `<div class="panel rep-panel"><div class="rep-error">${escapar(err.message)}</div></div>`;
  }
}

function celda(c, v) {
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
  const tarjeta = (num, txt) => `<div class="stat-card"><div class="num">${n(num)}</div><div class="lbl">${escapar(txt)}</div></div>`;
  const conEdificio = res.edificios_distintos !== null && res.edificios_distintos !== undefined;
  const tfoot = r.columnas.some((c) => c.sumable)
    ? `<tfoot><tr>${r.columnas.map((c, i) => c.sumable ? `<td class="num">${n(r.totales[c.id])}</td>` : `<td>${i === 0 ? "TOTAL" : ""}</td>`).join("")}</tr></tfoot>`
    : "";
  document.getElementById("resultado").innerHTML = `
    <div class="rep-tarjetas">
      ${tarjeta(res.planteles, "Planteles")}
      ${tarjeta(res.matricula_total, "Matrícula total")}
      ${conEdificio ? tarjeta(res.edificios_distintos, "Edificios distintos") + tarjeta(res.planteles_solos, "Solos en su edificio") + tarjeta(res.planteles_comparten, "Comparten edificio") + tarjeta(res.sin_clasificar, "Sin clasificar") : ""}
    </div>
    ${(r.avisos || []).map((a) => `<div class="rep-aviso">${escapar(a)}</div>`).join("")}
    <div class="panel">
      ${r.filas.length ? `<div class="tabla-responsive rep-scroll"><table class="rep-tabla">
        <thead><tr>${r.columnas.map((c) => `<th class="${c.tipo === "entero" ? "num" : ""}">${escapar(c.etiqueta)}</th>`).join("")}</tr></thead>
        <tbody>${r.filas.map((f) => `<tr>${r.columnas.map((c) => celda(c, f[c.id])).join("")}</tr>`).join("")}</tbody>
        ${tfoot}
      </table></div>` : `<div class="vacio"><strong>Este plan no tiene planteles activos</strong>Enlaza planteles al plan desde «Planes de atención».</div>`}
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
    const resp = await fetch(`/api/inspecciones/reportes/plan/${encodeURIComponent(p.plan)}/excel?columnas=${encodeURIComponent(p.cols.join(","))}`, { headers: { Authorization: "Bearer " + RAC.getToken() } });
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
