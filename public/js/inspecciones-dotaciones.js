// inspecciones-dotaciones.js — Dotación de un plan: lista de solicitudes (una por
// plantel), agregar planteles, consolidado (rubros × planteles) y catálogo de rubros.
// Sirve tanto a planes de rehabilitación como a planes «solo dotación».

const usuario = renderShell("inspecciones-planes", "Dotación del plan");
const PLAN_ID = Number(new URLSearchParams(window.location.search).get("plan"));
let DATOS = null; // { plan, dotaciones, puede_gestionar }
let CONS = null;
let temporizador = null;

if (usuario) {
  if (!PLAN_ID) error("Falta indicar el plan. Entra desde un plan de atención.");
  else cargar();
}

function error(mensaje) {
  document.getElementById("contenido").innerHTML = `<div class="panel"><div class="vacio"><strong>No se pudo abrir la dotación</strong>${escapar(mensaje)}<br><br>
    <a class="btn btn-fantasma btn-sm" href="/inspecciones/planes.html">← Volver a los planes</a></div></div>`;
}

async function cargar() {
  document.getElementById("contenido").innerHTML = `<div class="panel"><div class="cargando">Cargando dotación…</div></div>`;
  try {
    DATOS = await RAC.get(`/api/inspecciones/dotacion/plan/${PLAN_ID}`);
    CONS = ["admin", "operador_plantel", "insp_coordinador", "insp_consulta"].includes(usuario.rol)
      ? await RAC.get(`/api/inspecciones/dotacion/plan/${PLAN_ID}/consolidado`) : null;
  } catch (err) { error(err.message); return; }
  dibujar();
}

function formato(n) { return Number(n).toLocaleString("es-VE", { maximumFractionDigits: 3 }); }

function dibujar() {
  const { plan, dotaciones, puede_gestionar: gestiona } = DATOS;
  const abierto = plan.estado !== "CERRADO";
  document.getElementById("contenido").innerHTML = `
    <section class="planteles-hero"><div class="planteles-hero-copy">
      <span class="planteles-eyebrow">DOTACIÓN</span>
      <h1>${escapar(plan.nombre)}</h1>
      <p>${dotaciones.length} plantel${dotaciones.length === 1 ? "" : "es"} con solicitud de dotación.</p>
    </div></section>
    <div class="panel" style="margin-bottom:16px;"><div style="padding:14px 20px; display:flex; gap:10px; flex-wrap:wrap;">
      <a class="btn btn-fantasma btn-sm" href="/inspecciones/planes.html#plan-${Number(plan.id)}">← Volver al plan</a>
      ${gestiona ? `<button type="button" class="btn btn-fantasma btn-sm" id="btnCatalogo">Catálogo de rubros</button>` : ""}
      ${CONS ? `<button type="button" class="btn btn-primario btn-sm" id="btnExcelCons">Consolidado (Excel)</button>` : ""}
    </div></div>
    ${gestiona && abierto ? `<div class="panel" style="margin-bottom:16px;"><div style="padding:16px 20px 0;">
      <h3 style="margin:0 0 4px;">Agregar un plantel</h3>
      <p style="margin:0 0 10px; color:var(--muted); font-size:.82rem;">Busca por nombre, código DEA, municipio o parroquia. Los datos se copian de GESCOLAR y puedes corregirlos en la solicitud.</p>
      <input type="text" id="qPlantel" placeholder="Escribe al menos 2 caracteres…" style="width:100%; max-width:480px; padding:8px 10px; border:1px solid var(--borde); border-radius:8px;">
    </div><div id="resultados" style="margin-top:10px;"></div></div>` : ""}
    <div class="panel"><div style="padding:16px 20px 0;"><h3 style="margin:0;">Solicitudes de dotación</h3></div>
      <div id="lista" style="margin-top:12px;"></div></div>
    ${CONS ? `<div class="panel" style="margin-top:16px;"><div style="padding:16px 20px 0;"><h3 style="margin:0;">Consolidado</h3></div><div id="consolidado"></div></div>` : ""}`;
  pintarLista(gestiona && abierto);
  if (CONS) pintarConsolidado();
  const btnCat = document.getElementById("btnCatalogo");
  if (btnCat) btnCat.addEventListener("click", abrirCatalogo);
  const btnX = document.getElementById("btnExcelCons");
  if (btnX) btnX.addEventListener("click", (e) => descargar(`/api/inspecciones/dotacion/plan/${PLAN_ID}/consolidado.xlsx`, "DOTACION_CONSOLIDADO.xlsx", e.currentTarget));
  const q = document.getElementById("qPlantel");
  if (q) q.addEventListener("input", () => { clearTimeout(temporizador); temporizador = setTimeout(() => buscar(q.value.trim()), 380); });
}

function pintarLista(puedeQuitar) {
  const zona = document.getElementById("lista");
  if (!DATOS.dotaciones.length) { zona.innerHTML = `<div class="vacio"><strong>Aún no hay solicitudes</strong>Agrega un plantel para empezar.</div>`; return; }
  zona.innerHTML = `<div class="tabla-responsive"><table class="dt-tabla"><thead><tr><th>Plantel</th><th>Código DEA</th><th>Municipio</th><th>Parroquia</th><th class="dt-num">Rubros</th><th></th></tr></thead><tbody>
    ${DATOS.dotaciones.map((d) => `<tr><td>${escapar(d.nombre_plantel)}${d.en_rehabilitacion ? ` <span class="dt-retirado">(rehabilitación)</span>` : ""}</td><td>${escapar(d.codigo_dea)}</td><td>${escapar(d.municipio)}</td><td>${escapar(d.parroquia)}</td><td class="dt-num">${d.rubros_con_cantidad}</td>
      <td style="white-space:nowrap;"><a class="btn btn-primario btn-sm" href="/inspecciones/dotacion.html?id=${Number(d.id)}">Abrir</a>
      ${puedeQuitar ? ` <button type="button" class="btn btn-fantasma btn-sm" data-quitar="${Number(d.id)}">Quitar</button>` : ""}</td></tr>`).join("")}
  </tbody></table></div>`;
  zona.querySelectorAll("[data-quitar]").forEach((b) => b.addEventListener("click", () => quitar(Number(b.dataset.quitar))));
}

function pintarConsolidado() {
  const zona = document.getElementById("consolidado");
  const bloques = CONS.bloques.filter((b) => b.filas.length);
  if (!bloques.length) { zona.innerHTML = `<div class="vacio"><strong>Sin cantidades todavía</strong>Aparecerá aquí cuando se carguen cantidades.</div>`; return; }
  zona.innerHTML = `<div class="dt-scroll"><table class="dt-tabla"><thead><tr><th>Descripción</th><th>Unidad</th>
    ${CONS.planteles.map((p) => `<th class="dt-num" title="${escapar(p.nombre_plantel)}">${escapar(p.nombre_plantel.slice(0, 22))}</th>`).join("")}<th class="dt-num">Total</th></tr></thead><tbody>
    ${bloques.map((b) => `<tr><td colspan="${CONS.planteles.length + 3}" class="dt-bloque">${escapar(b.titulo)}</td></tr>` + b.filas.map((f) =>
      `<tr><td>${escapar(f.nombre)}</td><td>${escapar(f.unidad)}</td>${f.cantidades.map((c) => `<td class="dt-num">${c > 0 ? formato(c) : ""}</td>`).join("")}<td class="dt-num"><strong>${formato(f.total)}</strong></td></tr>`).join("")).join("")}
  </tbody></table></div>`;
}

async function buscar(q) {
  const zona = document.getElementById("resultados");
  if (q.length < 2) { zona.innerHTML = ""; return; }
  zona.innerHTML = `<div class="cargando">Buscando…</div>`;
  try {
    const r = await RAC.get(`/api/inspecciones/dotacion/buscar?q=${encodeURIComponent(q)}&plan_id=${PLAN_ID}`);
    if (!r.planteles.length) { zona.innerHTML = `<div class="vacio"><strong>Sin resultados</strong></div>`; return; }
    zona.innerHTML = `<div class="tabla-responsive"><table class="dt-tabla"><tbody>${r.planteles.map((p) => `<tr><td>${escapar(p.nombre_plantel)}</td><td>${escapar(p.cod_plantel)}</td><td>${escapar(p.municipio)}</td>
      <td>${p.en_el_plan ? `<span class="dt-retirado">ya está en el plan</span>` : `<button type="button" class="btn btn-primario btn-sm" data-agregar="${escapar(p.cod_plantel)}">Agregar</button>`}</td></tr>`).join("")}</tbody></table></div>${r.limitado ? `<div style="padding:8px 20px; color:var(--muted); font-size:.78rem;">Hay más resultados: afina la búsqueda.</div>` : ""}`;
    zona.querySelectorAll("[data-agregar]").forEach((b) => b.addEventListener("click", () => agregar(b.dataset.agregar)));
  } catch (err) { zona.innerHTML = `<div class="vacio"><strong>${escapar(err.message)}</strong></div>`; }
}

async function agregar(codigo) {
  try {
    const r = await RAC.post(`/api/inspecciones/dotacion/plan/${PLAN_ID}`, { codigo_dea: codigo });
    window.location.href = `/inspecciones/dotacion.html?id=${Number(r.id)}`;
  } catch (err) { mostrarToast(err.message, true); }
}

async function quitar(id) {
  if (!window.confirm("¿Quitar esta solicitud de dotación y sus cantidades?")) return;
  try {
    await RAC.del(`/api/inspecciones/dotacion/${id}`);
    mostrarToast("Solicitud quitada.");
    await cargar();
  } catch (err) { mostrarToast(err.message, true); }
}

async function descargar(url, nombre, boton) {
  const original = boton ? boton.textContent : "";
  if (boton) { boton.disabled = true; boton.textContent = "Generando Excel…"; }
  try {
    const resp = await fetch(url, { headers: { Authorization: "Bearer " + RAC.getToken() } });
    if (resp.status === 401) { RAC.cerrarSesion(); return; }
    if (!resp.ok) { let m = `Error ${resp.status}`; try { m = (await resp.json()).error || m; } catch (_) { /* sin cuerpo */ } throw new Error(m); }
    const blob = await resp.blob();
    const m = /filename="([^"]+)"/.exec(resp.headers.get("Content-Disposition") || "");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = m ? m[1] : nombre;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  } catch (err) { mostrarToast(err.message, true); }
  finally { if (boton) { boton.disabled = false; boton.textContent = original; } }
}

// ---- Catálogo de rubros (admin / coordinador) ----
async function abrirCatalogo() {
  let bloques;
  try { bloques = (await RAC.get("/api/inspecciones/dotacion/rubros?todos=1")).bloques; }
  catch (err) { mostrarToast(err.message, true); return; }
  const filas = [];
  bloques.forEach((b) => b.rubros.forEach((r) => filas.push({ bloque: b.bloque, titulo: b.titulo, nombre: r.nombre, unidad: r.unidad })));
  const fondo = document.createElement("div");
  fondo.className = "dt-fondo";
  fondo.innerHTML = `<div class="dt-modal" role="dialog" aria-label="Catálogo de rubros de dotación">
    <h3 style="margin:0;">Catálogo de rubros de dotación</h3>
    <p style="margin:0; color:var(--muted); font-size:.82rem;">Cambia el nombre o la unidad, reordena con las flechas, quita lo que no uses o agrega rubros nuevos. Un rubro quitado sigue apareciendo en las solicitudes que ya lo tenían.</p>
    <div id="catCuerpo"></div><div class="err" id="catError" style="color:#c53030; font-size:.82rem;"></div>
    <div style="display:flex; gap:8px; justify-content:flex-end;"><button type="button" class="btn btn-fantasma" id="catCancelar">Cancelar</button><button type="button" class="btn btn-primario" id="catGuardar">Guardar catálogo</button></div></div>`;
  document.body.appendChild(fondo);
  const titulos = bloques.map((b) => ({ bloque: b.bloque, titulo: b.titulo }));
  function pintarCat() {
    document.getElementById("catCuerpo").innerHTML = titulos.map((t) => `<div class="dt-bloque" style="margin-top:8px;">${escapar(t.titulo)}</div>
      <table class="dt-tabla"><tbody>${filas.map((f, i) => f.bloque !== t.bloque ? "" : `<tr>
        <td><input type="text" data-i="${i}" data-c="nombre" value="${escapar(f.nombre)}" style="width:100%; text-align:left;"></td>
        <td><input type="text" data-i="${i}" data-c="unidad" value="${escapar(f.unidad)}" style="width:90px; text-align:left;"></td>
        <td style="white-space:nowrap;"><button type="button" class="btn btn-fantasma btn-sm" data-sube="${i}" title="Subir">↑</button> <button type="button" class="btn btn-fantasma btn-sm" data-baja="${i}" title="Bajar">↓</button> <button type="button" class="btn btn-fantasma btn-sm" data-quita="${i}">Quitar</button></td></tr>`).join("")}</tbody></table>
      <button type="button" class="btn btn-fantasma btn-sm" data-nuevo="${t.bloque}" style="margin-top:6px;">+ Agregar rubro</button>`).join("");
    const cuerpo = document.getElementById("catCuerpo");
    cuerpo.querySelectorAll("input[data-i]").forEach((el) => el.addEventListener("input", () => { filas[Number(el.dataset.i)][el.dataset.c] = el.value; }));
    const mover = (i, d) => {
      let j = i + d;
      while (j >= 0 && j < filas.length && filas[j].bloque !== filas[i].bloque) j += d;
      if (j < 0 || j >= filas.length) return;
      [filas[i], filas[j]] = [filas[j], filas[i]]; pintarCat();
    };
    cuerpo.querySelectorAll("[data-sube]").forEach((b) => b.addEventListener("click", () => mover(Number(b.dataset.sube), -1)));
    cuerpo.querySelectorAll("[data-baja]").forEach((b) => b.addEventListener("click", () => mover(Number(b.dataset.baja), 1)));
    cuerpo.querySelectorAll("[data-quita]").forEach((b) => b.addEventListener("click", () => { filas.splice(Number(b.dataset.quita), 1); pintarCat(); }));
    cuerpo.querySelectorAll("[data-nuevo]").forEach((b) => b.addEventListener("click", () => { filas.push({ bloque: b.dataset.nuevo, nombre: "", unidad: "UNIDAD" }); pintarCat(); }));
  }
  pintarCat();
  document.getElementById("catCancelar").addEventListener("click", () => fondo.remove());
  document.getElementById("catGuardar").addEventListener("click", async () => {
    try {
      await RAC.put("/api/inspecciones/dotacion/rubros", { rubros: filas.map((f) => ({ id: f.id, bloque: f.bloque, nombre: f.nombre, unidad: f.unidad })) });
      fondo.remove(); mostrarToast("Catálogo guardado."); await cargar();
    } catch (err) { document.getElementById("catError").textContent = err.message; }
  });
}

function escapar(valor) {
  if (valor === undefined || valor === null) return "";
  return String(valor).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
