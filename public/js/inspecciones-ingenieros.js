// inspecciones-ingenieros.js — Resumen de ingenieros: cuántos planteles ha inspeccionado
// cada uno (columna RESPONSABLE de GESCOLAR) y, con el botón de la fila, la lista de sus
// planteles, cada uno con enlace a su ficha. Solo lectura; lo ven todos los perfiles del módulo.

const usuario = renderShell("inspecciones-ingenieros", "Ingenieros");
let RESUMEN = null;
const ABIERTOS = new Set(); // posiciones de ingenieros con la lista desplegada

if (usuario) cargar();

async function cargar() {
  document.getElementById("contenido").innerHTML = `
    <section class="planteles-hero">
      <div class="planteles-hero-copy">
        <span class="planteles-eyebrow">INSPECCIONES</span>
        <h1>Ingenieros e inspecciones</h1>
        <p>Planteles inspeccionados por cada ingeniero, según el campo RESPONSABLE de GESCOLAR.</p>
      </div>
    </section>
    <div class="panel">
      <div style="padding:16px 20px 0; display:flex; gap:12px; flex-wrap:wrap; align-items:center; justify-content:space-between;">
        <input type="search" id="buscar" placeholder="Buscar ingeniero, plantel, código o municipio…" style="flex:1; min-width:240px; padding:8px 12px; border:1px solid var(--borde); border-radius:8px;">
        <span id="resumen" style="color:var(--muted); font-size:.8rem;"></span>
      </div>
      <div id="tabla" style="margin-top:12px;"><div class="cargando">Cargando…</div></div>
    </div>`;
  document.getElementById("buscar").addEventListener("input", pintar);
  try {
    RESUMEN = await RAC.get("/api/inspecciones/resumen-ingenieros");
    pintar();
  } catch (err) {
    document.getElementById("tabla").innerHTML = `<div class="vacio"><strong>No se pudo cargar el resumen</strong>${escapar(err.message)}</div>`;
  }
}

function coincide(p, q) {
  return `${p.nombre_plantel} ${p.codigo_dea} ${p.municipio} ${p.parroquia}`.toLowerCase().includes(q);
}

function pintar() {
  if (!RESUMEN) return;
  const q = document.getElementById("buscar").value.trim().toLowerCase();
  document.getElementById("resumen").textContent =
    `${RESUMEN.ingenieros.length} ingeniero${RESUMEN.ingenieros.length === 1 ? "" : "s"} · ${RESUMEN.planteles_con_responsable} planteles inspeccionados de ${RESUMEN.total_planteles_gescolar}`;
  const cont = document.getElementById("tabla");
  if (!RESUMEN.ingenieros.length) {
    cont.innerHTML = `<div class="vacio"><strong>Todavía no hay responsables en GESCOLAR</strong>Cuando se llene la columna RESPONSABLE aparecerán aquí.</div>`;
    return;
  }
  // Con texto de búsqueda: se muestran los ingenieros que coinciden por nombre o con alguno de sus planteles.
  const bloques = [];
  RESUMEN.ingenieros.forEach((g, i) => {
    const porNombre = q && g.nombre.toLowerCase().includes(q);
    const planteles = q && !porNombre ? g.planteles.filter((p) => coincide(p, q)) : g.planteles;
    if (q && !porNombre && !planteles.length) return;
    const forzado = Boolean(q) && !porNombre; // se despliega solo para mostrar los planteles que coinciden
    const abierto = ABIERTOS.has(i) || forzado;
    const accion = forzado
      ? `<span style="color:var(--muted); font-size:.8rem;">${planteles.length} coincidencia${planteles.length === 1 ? "" : "s"}</span>`
      : `<button type="button" class="btn ${abierto ? "btn-fantasma" : "btn-primario"} btn-sm" data-ver="${i}">${abierto ? "Ocultar planteles" : "Ver planteles"}</button>`;
    let detalle = "";
    if (abierto) {
      const filas = planteles.map((p) => `<tr>
        <td><span class="cod">${escapar(p.codigo_dea)}</span></td>
        <td>${escapar(p.nombre_plantel)}</td>
        <td>${[escapar(p.municipio), escapar(p.parroquia)].filter(Boolean).join(" · ")}</td>
        <td>${p.tarea ? escapar(p.tarea) : ""}</td>
        <td><a class="btn btn-fantasma btn-sm" href="/inspecciones/plantel.html?cod=${encodeURIComponent(p.codigo_dea)}">Ver ficha</a></td>
      </tr>`).join("");
      detalle = `<div style="background:var(--surface-2, #f5f8fc); padding:4px 12px 14px;">
        <div class="tabla-responsive"><table>
          <thead><tr><th>Código</th><th>Plantel</th><th>Municipio · Parroquia</th><th>Tarea</th><th></th></tr></thead>
          <tbody>${filas}</tbody>
        </table></div>
        ${q && planteles.length < g.planteles.length ? `<div style="color:var(--muted); font-size:.78rem; margin-top:6px;">Mostrando ${planteles.length} de ${g.total} planteles que coinciden con la búsqueda.</div>` : ""}
      </div>`;
    }
    bloques.push(`<div style="border-top:1px solid var(--borde, #e3e9f1);">
      <div style="display:flex; align-items:center; gap:12px; padding:12px 20px; flex-wrap:wrap;">
        <strong style="flex:1 1 180px; min-width:0;">${escapar(g.nombre)}</strong>
        <span style="text-align:center; line-height:1.1;"><span style="font-size:1.25rem; font-weight:700;">${g.total}</span><br><span style="font-size:.68rem; color:var(--muted); text-transform:uppercase; letter-spacing:.04em;">inspecciones</span></span>
        ${accion}
      </div>
      ${detalle}
    </div>`);
  });
  if (!bloques.length) {
    cont.innerHTML = `<div class="vacio"><strong>Sin resultados</strong>Prueba con otro texto.</div>`;
    return;
  }
  cont.innerHTML = bloques.join("");
  cont.querySelectorAll("[data-ver]").forEach((b) => {
    b.addEventListener("click", () => {
      const i = Number(b.dataset.ver);
      if (ABIERTOS.has(i)) ABIERTOS.delete(i); else ABIERTOS.add(i);
      pintar();
    });
  });
}

function escapar(valor) {
  if (valor === undefined || valor === null) return "";
  return String(valor).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
