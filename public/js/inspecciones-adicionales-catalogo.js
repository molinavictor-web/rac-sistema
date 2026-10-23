// inspecciones-adicionales-catalogo.js — Catálogo de materiales ADICIONALES
// (solo administrador): aprobar los propuestos por los ingenieros, corregir
// nombre/unidad, retirar y UNIFICAR duplicados («Cable 12» = «Cable THW 12»).
// Al unificar, las cantidades pasan al material oficial y el nombre viejo queda
// como alias (así el autocompletado lo sigue encontrando).

const usuario = renderShell("inspecciones-catalogo-adicionales", "Catálogo de adicionales");
let LISTA = [];

if (usuario) {
  if (usuario.rol !== "admin") {
    document.getElementById("contenido").innerHTML = `<div class="panel"><div class="vacio"><strong>Solo para administradores</strong>Pide al administrador que revise los materiales pendientes.</div></div>`;
  } else cargar();
}

async function cargar() {
  document.getElementById("contenido").innerHTML = `<div class="panel"><div class="cargando">Cargando catálogo…</div></div>`;
  try {
    LISTA = (await RAC.get("/api/inspecciones/adicionales?todos=1")).adicionales;
  } catch (err) {
    document.getElementById("contenido").innerHTML = `<div class="panel"><div class="vacio"><strong>No se pudo cargar</strong>${escapar(err.message)}</div></div>`;
    return;
  }
  dibujar();
}

function dibujar() {
  const pendientes = LISTA.filter((m) => m.estado === "PENDIENTE" && !m.unificado_en).length;
  document.getElementById("contenido").innerHTML = `
    <section class="planteles-hero">
      <div class="planteles-hero-copy">
        <span class="planteles-eyebrow">MATERIALES ADICIONALES</span>
        <h1>Catálogo de adicionales</h1>
        <p>${LISTA.filter((m) => !m.unificado_en && m.estado !== "RETIRADO").length} en uso · ${pendientes} pendiente${pendientes === 1 ? "" : "s"} de aprobación.</p>
      </div>
    </section>
    <div class="panel">
      <div class="ca-filtros">
        <input type="search" id="buscar" placeholder="Buscar material o alias…" style="flex:1; min-width:220px;">
        <select id="filtroEstado">
          <option value="USO">En uso (activos y pendientes)</option>
          <option value="PENDIENTE">Solo pendientes</option>
          <option value="ACTIVO">Solo activos</option>
          <option value="RETIRADO">Retirados y unificados</option>
          <option value="TODOS">Todos</option>
        </select>
      </div>
      <div id="zona"></div>
    </div>`;
  document.getElementById("buscar").addEventListener("input", pintar);
  document.getElementById("filtroEstado").addEventListener("change", pintar);
  if (pendientes) document.getElementById("filtroEstado").value = "PENDIENTE";
  pintar();
}

function norm(t) {
  return String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function pintar() {
  const q = norm(document.getElementById("buscar").value);
  const f = document.getElementById("filtroEstado").value;
  const visibles = LISTA.filter((m) => {
    const enUso = !m.unificado_en && m.estado !== "RETIRADO";
    if (f === "USO" && !enUso) return false;
    if (f === "PENDIENTE" && !(m.estado === "PENDIENTE" && !m.unificado_en)) return false;
    if (f === "ACTIVO" && !(m.estado === "ACTIVO" && !m.unificado_en)) return false;
    if (f === "RETIRADO" && enUso) return false;
    return !q || norm(m.nombre + " " + (m.alias || []).join(" ")).includes(q);
  });
  const zona = document.getElementById("zona");
  if (!visibles.length) {
    zona.innerHTML = `<div class="vacio"><strong>Nada que mostrar</strong>Cambia el filtro o la búsqueda.</div>`;
    return;
  }
  zona.innerHTML = `<div class="tabla-responsive"><table class="ca-tabla">
    <thead><tr><th>Material</th><th>Unidad</th><th>Estado</th><th class="num">Usos</th><th></th></tr></thead>
    <tbody>${visibles.map((m) => {
      const unif = m.unificado_en ? LISTA.find((x) => x.id === m.unificado_en) : null;
      return `<tr>
        <td>${escapar(m.nombre)}${unif ? `<div class="ca-alias">unificado en «${escapar(unif.nombre)}»</div>` : ""}${(m.alias || []).length ? `<div class="ca-alias">También: ${escapar(m.alias.join(" · "))}</div>` : ""}</td>
        <td>${escapar(m.unidad)}</td>
        <td><span class="ca-est ${m.estado}">${m.unificado_en ? "UNIFICADO" : m.estado}</span></td>
        <td class="num">${m.usos}</td>
        <td><div class="ca-acciones">${m.unificado_en ? "" : `
          ${m.estado === "PENDIENTE" ? `<button class="btn btn-primario btn-sm" data-ac="aprobar" data-id="${m.id}">Aprobar</button>` : ""}
          <button class="btn btn-fantasma btn-sm" data-ac="editar" data-id="${m.id}">Editar</button>
          ${m.estado !== "RETIRADO" ? `<button class="btn btn-fantasma btn-sm" data-ac="unificar" data-id="${m.id}">Unificar con…</button>
          <button class="btn btn-fantasma btn-sm" data-ac="retirar" data-id="${m.id}">Retirar</button>` : `<button class="btn btn-fantasma btn-sm" data-ac="reactivar" data-id="${m.id}">Reactivar</button>`}`}
        </div></td></tr>`;
    }).join("")}</tbody></table></div>`;
  zona.querySelectorAll("[data-ac]").forEach((b) => b.addEventListener("click", () => accion(b.dataset.ac, Number(b.dataset.id))));
}

async function cambiar(id, cuerpo, mensaje) {
  try {
    await RAC.patch(`/api/inspecciones/adicionales/${id}`, cuerpo);
    mostrarToast(mensaje);
    await cargarSinReiniciar();
  } catch (err) { mostrarToast(err.message, true); }
}

async function cargarSinReiniciar() {
  LISTA = (await RAC.get("/api/inspecciones/adicionales?todos=1")).adicionales;
  pintar();
}

function accion(tipo, id) {
  const m = LISTA.find((x) => x.id === id);
  if (!m) return;
  if (tipo === "aprobar") cambiar(id, { estado: "ACTIVO" }, "Material aprobado.");
  else if (tipo === "reactivar") cambiar(id, { estado: "ACTIVO" }, "Material reactivado.");
  else if (tipo === "retirar") {
    if (m.usos > 0 && !window.confirm(`«${m.nombre}» tiene cantidades en ${m.usos} planilla(s). Retirarlo no las borra, pero ya no se podrá agregar a otras. ¿Retirar?`)) return;
    cambiar(id, { estado: "RETIRADO" }, "Material retirado.");
  }
  else if (tipo === "editar") modal(m, "editar");
  else if (tipo === "unificar") modal(m, "unificar");
}

function modal(m, tipo) {
  const fondo = document.createElement("div");
  fondo.className = "ca-fondo";
  let cuerpo;
  if (tipo === "editar") {
    cuerpo = `<h3 style="margin:0;">Editar material</h3>
      <label>Nombre <input id="mNombre" maxlength="200" value="${escapar(m.nombre)}"></label>
      <label>Unidad <input id="mUnidad" maxlength="20" value="${escapar(m.unidad)}"></label>`;
  } else {
    const otros = LISTA.filter((x) => x.id !== m.id && !x.unificado_en && x.estado !== "RETIRADO").sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    cuerpo = `<h3 style="margin:0;">Unificar «${escapar(m.nombre)}»</h3>
      <p style="margin:0; font-size:.85rem;">Es el <strong>mismo material</strong> que otro de la lista. Las cantidades de este pasan al que elijas (si un plantel tenía los dos, se suman) y este nombre queda como alias. <strong>No se puede deshacer</strong> desde la pantalla.</p>
      <label>Se unifica con (el que queda)
        <select id="mDestino"><option value="">— elige —</option>${otros.map((o) => `<option value="${o.id}">${escapar(o.nombre)} (${escapar(o.unidad)})</option>`).join("")}</select>
      </label>`;
  }
  fondo.innerHTML = `<div class="ca-modal">${cuerpo}<div class="err" id="mErr"></div>
    <div class="botones"><button class="btn btn-fantasma btn-sm" id="mCancelar">Cancelar</button><button class="btn btn-primario btn-sm" id="mOk">${tipo === "editar" ? "Guardar" : "Unificar"}</button></div></div>`;
  document.body.appendChild(fondo);
  const cerrar = () => fondo.remove();
  fondo.querySelector("#mCancelar").addEventListener("click", cerrar);
  fondo.addEventListener("click", (e) => { if (e.target === fondo) cerrar(); });
  fondo.querySelector("#mOk").addEventListener("click", async () => {
    const err = fondo.querySelector("#mErr");
    err.textContent = "";
    try {
      if (tipo === "editar") {
        await RAC.patch(`/api/inspecciones/adicionales/${m.id}`, { nombre: fondo.querySelector("#mNombre").value.trim(), unidad: fondo.querySelector("#mUnidad").value.trim() });
        mostrarToast("Material actualizado.");
      } else {
        const destino = Number(fondo.querySelector("#mDestino").value);
        if (!destino) { err.textContent = "Elige con cuál material se unifica."; return; }
        await RAC.post(`/api/inspecciones/adicionales/${m.id}/unificar`, { destino_id: destino });
        mostrarToast("Materiales unificados.");
      }
      cerrar();
      await cargarSinReiniciar();
    } catch (e) { err.textContent = e.message; }
  });
}

function escapar(valor) {
  if (valor === undefined || valor === null) return "";
  return String(valor).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
