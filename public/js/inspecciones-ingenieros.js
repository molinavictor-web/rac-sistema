// inspecciones-ingenieros.js — Resumen de ingenieros: cuántos planteles ha inspeccionado
// cada uno (columna RESPONSABLE de GESCOLAR) y, con el botón de la fila, la lista de sus
// planteles, cada uno con enlace a su ficha. Lo ven todos los perfiles del módulo.
// Administrador y coordinador pueden además asignar el ingeniero responsable de CUALQUIER plantel
// (con o sin plan), cambiarlo o quitarlo: se escribe en la columna RESPONSABLE de GESCOLAR y queda
// en el historial. Un plantel tiene un solo ingeniero a cargo.

const usuario = renderShell("inspecciones-ingenieros", "Ingenieros");
const PUEDE_GESTIONAR = ["admin", "insp_coordinador"].includes(usuario && usuario.rol);
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
        ${PUEDE_GESTIONAR ? `<div style="margin-top:12px; display:flex; gap:10px; flex-wrap:wrap;">
          <button type="button" class="btn btn-primario btn-sm" id="btnAsignar">Asignar plantel</button>
          <button type="button" class="btn btn-fantasma btn-sm" id="btnHistorial" style="background:#fff;">Historial de asignaciones</button>
        </div>` : ""}
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
  if (PUEDE_GESTIONAR) {
    document.getElementById("btnAsignar").addEventListener("click", () => abrirAsignar(null));
    document.getElementById("btnHistorial").addEventListener("click", verHistorial);
  }
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
  const nIng = RESUMEN.ingenieros.length;
  const promedio = nIng ? RESUMEN.planteles_con_responsable / nIng : 0;
  const maximo = nIng ? Math.max(...RESUMEN.ingenieros.map((g) => g.total)) : 0;
  document.getElementById("resumen").textContent =
    `${nIng} ingeniero${nIng === 1 ? "" : "s"} · ${RESUMEN.planteles_con_responsable} planteles inspeccionados de ${RESUMEN.total_planteles_gescolar}` +
    (nIng ? ` · promedio ${promedio.toLocaleString("es-VE", { maximumFractionDigits: 1 })} por ingeniero` : "");
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
        <td style="white-space:nowrap;"><a class="btn btn-fantasma btn-sm" href="/inspecciones/plantel.html?cod=${encodeURIComponent(p.codigo_dea)}">Ver ficha</a>${PUEDE_GESTIONAR ? ` <button type="button" class="btn btn-fantasma btn-sm" data-cambiar="${escapar(p.codigo_dea)}" data-nombre="${escapar(p.nombre_plantel)}" data-resp="${escapar(g.nombre)}">Cambiar</button> <button type="button" class="btn btn-fantasma btn-sm" data-quitar="${escapar(p.codigo_dea)}" data-nombre="${escapar(p.nombre_plantel)}" data-resp="${escapar(g.nombre)}">Quitar</button>` : ""}</td>
      </tr>`).join("");
      detalle = `<div style="background:var(--surface-2, #f5f8fc); padding:4px 12px 14px;">
        <div class="tabla-responsive"><table>
          <thead><tr><th>Código</th><th>Plantel</th><th>Municipio · Parroquia</th><th>Tarea</th><th></th></tr></thead>
          <tbody>${filas}</tbody>
        </table></div>
        ${q && planteles.length < g.planteles.length ? `<div style="color:var(--muted); font-size:.78rem; margin-top:6px;">Mostrando ${planteles.length} de ${g.total} planteles que coinciden con la búsqueda.</div>` : ""}
      </div>`;
    }
    const dif = Math.round((g.total - promedio) * 10) / 10;
    const chip = dif === 0 ? "en el promedio" : `${dif > 0 ? "+" : "−"}${Math.abs(dif).toLocaleString("es-VE", { maximumFractionDigits: 1 })} vs promedio`;
    const colorChip = dif > 0.5 ? "background:#fff7ed; color:#9c4221;" : dif < -0.5 ? "background:#ebf4ff; color:#2c5282;" : "background:#e6f4ea; color:#276749;";
    const ancho = maximo ? Math.round((g.total / maximo) * 100) : 0;
    bloques.push(`<div style="border-top:1px solid var(--borde, #e3e9f1);">
      <div style="display:flex; align-items:center; gap:12px; padding:12px 20px; flex-wrap:wrap;">
        <div style="flex:1 1 180px; min-width:0;">
          <strong>${escapar(g.nombre)}</strong>
          <div style="height:5px; background:#edf2f7; border-radius:3px; margin-top:6px; max-width:260px;"><div style="height:5px; width:${ancho}%; background:#1a73e8; border-radius:3px;"></div></div>
        </div>
        <span style="${colorChip} font-size:.72rem; font-weight:600; padding:2px 8px; border-radius:999px; white-space:nowrap;">${chip}</span>
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
  cont.querySelectorAll("[data-cambiar]").forEach((b) => {
    b.addEventListener("click", () => abrirAsignar({ cod_plantel: b.dataset.cambiar, nombre_plantel: b.dataset.nombre, responsable: b.dataset.resp }));
  });
  cont.querySelectorAll("[data-quitar]").forEach((b) => {
    b.addEventListener("click", () => quitar(b.dataset.quitar, b.dataset.nombre, b.dataset.resp));
  });
}

async function recargar() {
  RESUMEN = await RAC.get("/api/inspecciones/resumen-ingenieros");
  pintar();
}

async function quitar(codigo, nombre, resp) {
  if (!window.confirm(`¿Quitar a ${resp} como responsable de «${nombre}»?\n\nEl plantel quedará sin ingeniero en GESCOLAR y se le resta una inspección a ${resp}.`)) return;
  try {
    await RAC.post("/api/inspecciones/ingenieros/asignar-plantel", { codigo_dea: codigo, responsable: null });
    mostrarToast("Plantel sin responsable.");
    await recargar();
  } catch (err) {
    mostrarToast(err.message, true);
  }
}

// Ventana para asignar. Con "previo" ya viene el plantel elegido (botón Cambiar de la lista);
// sin él se busca el plantel en GESCOLAR (con o sin plan).
function abrirAsignar(previo) {
  let plantel = previo ? { cod_plantel: previo.cod_plantel, nombre_plantel: previo.nombre_plantel, responsable: previo.responsable || "" } : null;
  const nombres = (RESUMEN ? RESUMEN.ingenieros : []).map((g) => g.nombre);
  const fondo = document.createElement("div");
  fondo.className = "modal-fondo visible";
  fondo.innerHTML = `
    <div class="modal" style="max-width:520px;">
      <h2 style="margin-bottom:4px;">Asignar ingeniero a un plantel</h2>
      <p style="margin:0 0 12px; color:var(--muted); font-size:.85rem;">El plantel no necesita estar en un plan. Tiene un solo ingeniero a cargo y se guarda en GESCOLAR (columna RESPONSABLE).</p>
      <div id="zonaPlantel"></div>
      <div id="zonaIngeniero" style="display:none; margin-top:14px;">
        <label for="selIng" style="font-weight:600; font-size:.85rem;">Ingeniero a cargo</label>
        <select id="selIng" style="width:100%; margin-top:4px;"></select>
        <input type="text" id="inpNuevo" maxlength="80" placeholder="Nombre y apellido" style="width:100%; margin-top:6px; display:none;">
        <div id="avisoCambio" style="display:none; margin-top:8px; padding:8px 10px; border-radius:8px; background:#fff7ed; border:1px solid #f6ad55; font-size:.8rem;"></div>
      </div>
      <div class="error-msg" id="errorAsig"></div>
      <div style="display:flex; gap:10px; margin-top:14px;">
        <button type="button" class="btn btn-primario" id="btnGuardarAsig" disabled>Guardar</button>
        <button type="button" class="btn btn-fantasma" id="btnCancelarAsig">Cancelar</button>
      </div>
    </div>`;
  document.body.appendChild(fondo);
  const cerrar = () => fondo.remove();
  const zona = fondo.querySelector("#zonaPlantel");
  const zonaIng = fondo.querySelector("#zonaIngeniero");
  const sel = fondo.querySelector("#selIng");
  const nuevo = fondo.querySelector("#inpNuevo");
  const aviso = fondo.querySelector("#avisoCambio");
  const guardar = fondo.querySelector("#btnGuardarAsig");
  const errorEl = fondo.querySelector("#errorAsig");

  const elegido = () => (sel.value === "__nuevo__" ? nuevo.value.replace(/\s+/g, " ").trim() : sel.value === "__ninguno__" ? "" : sel.value);

  function refrescar() {
    nuevo.style.display = sel.value === "__nuevo__" ? "block" : "none";
    if (!plantel) { guardar.disabled = true; return; }
    const v = elegido();
    const actual = plantel.responsable || "";
    const igual = v.toLowerCase() === actual.toLowerCase();
    guardar.disabled = igual || (sel.value === "__nuevo__" && !v);
    if (actual && !igual) {
      aviso.style.display = "block";
      aviso.innerHTML = v
        ? `Este plantel ya figura con <strong>${escapar(actual)}</strong>. Al guardar pasa a <strong>${escapar(v)}</strong> (a ${escapar(actual)} se le resta una inspección).`
        : `Este plantel figura con <strong>${escapar(actual)}</strong>. Al guardar quedará sin responsable.`;
    } else {
      aviso.style.display = "none";
    }
  }

  function mostrarIngeniero() {
    zonaIng.style.display = "block";
    const actual = plantel.responsable || "";
    const ops = [`<option value="" ${actual ? "" : "selected"} disabled>Elige un ingeniero…</option>`];
    nombres.forEach((n) => ops.push(`<option value="${escapar(n)}" ${n.toLowerCase() === actual.toLowerCase() ? "selected" : ""}>${escapar(n)}</option>`));
    ops.push(`<option value="__nuevo__">Otro (nombre nuevo)…</option>`);
    if (actual) ops.push(`<option value="__ninguno__">— Sin responsable —</option>`);
    sel.innerHTML = ops.join("");
    refrescar();
  }

  function pintarZonaPlantel() {
    if (plantel) {
      zona.innerHTML = `<div style="padding:10px 12px; border:1px solid var(--borde); border-radius:8px; display:flex; gap:10px; align-items:center; justify-content:space-between;">
        <div><strong>${escapar(plantel.nombre_plantel)}</strong><br><small style="color:var(--muted);"><span class="cod">${escapar(plantel.cod_plantel)}</span> · ${plantel.responsable ? "Responsable actual: " + escapar(plantel.responsable) : "Sin responsable"}</small></div>
        ${previo ? "" : `<button type="button" class="btn btn-fantasma btn-sm" id="btnOtroPlantel">Cambiar plantel</button>`}
      </div>`;
      const b = zona.querySelector("#btnOtroPlantel");
      if (b) b.addEventListener("click", () => { plantel = null; zonaIng.style.display = "none"; guardar.disabled = true; pintarZonaPlantel(); });
      mostrarIngeniero();
    } else {
      zona.innerHTML = `<label for="inpBuscarP" style="font-weight:600; font-size:.85rem;">Plantel</label>
        <input type="search" id="inpBuscarP" placeholder="Nombre, código DEA, municipio o parroquia…" style="width:100%; margin-top:4px; padding:8px 12px; border:1px solid var(--borde); border-radius:8px;">
        <div id="resultadosP" style="max-height:220px; overflow:auto; margin-top:6px;"></div>`;
      const inp = zona.querySelector("#inpBuscarP");
      const res = zona.querySelector("#resultadosP");
      let temporizador = null;
      let ultima = 0;
      inp.addEventListener("input", () => {
        clearTimeout(temporizador);
        const q = inp.value.trim();
        if (q.length < 2) { res.innerHTML = ""; return; }
        temporizador = setTimeout(async () => {
          const turno = ++ultima;
          res.innerHTML = `<div class="cargando">Buscando…</div>`;
          try {
            const r = await RAC.get(`/api/inspecciones/ingenieros/buscar-plantel?q=${encodeURIComponent(q)}`);
            if (turno !== ultima) return;
            if (!r.planteles.length) { res.innerHTML = `<p style="color:var(--muted); font-size:.82rem;">Sin resultados.</p>`; return; }
            res.innerHTML = r.planteles.map((p, i) => `<div data-i="${i}" style="padding:8px 10px; border-bottom:1px solid var(--borde); cursor:pointer;">
              <strong>${escapar(p.nombre_plantel)}</strong><br><small style="color:var(--muted);"><span class="cod">${escapar(p.cod_plantel)}</span> · ${[escapar(p.municipio), escapar(p.parroquia)].filter(Boolean).join(" · ")} · ${p.responsable ? escapar(p.responsable) : "sin responsable"}</small></div>`).join("") +
              (r.limitado ? `<p style="color:var(--muted); font-size:.76rem; margin:6px 0 0;">Hay más resultados; afina la búsqueda.</p>` : "");
            res.querySelectorAll("[data-i]").forEach((el) => el.addEventListener("click", () => {
              plantel = r.planteles[Number(el.dataset.i)];
              pintarZonaPlantel();
            }));
          } catch (err) {
            if (turno === ultima) res.innerHTML = `<p style="color:#c53030; font-size:.82rem;">${escapar(err.message)}</p>`;
          }
        }, 300);
      });
      inp.focus();
    }
  }

  sel.addEventListener("change", () => { refrescar(); if (sel.value === "__nuevo__") nuevo.focus(); });
  nuevo.addEventListener("input", refrescar);
  fondo.querySelector("#btnCancelarAsig").addEventListener("click", cerrar);
  fondo.addEventListener("click", (e) => { if (e.target === fondo) cerrar(); });
  guardar.addEventListener("click", async () => {
    errorEl.classList.remove("visible");
    guardar.disabled = true;
    guardar.textContent = "Guardando…";
    try {
      const r = await RAC.post("/api/inspecciones/ingenieros/asignar-plantel", { codigo_dea: plantel.cod_plantel, responsable: elegido() || null });
      mostrarToast(r.sin_cambio ? "Sin cambios." : r.responsable ? `Asignado a ${r.responsable}.` : "Plantel sin responsable.");
      cerrar();
      await recargar();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.add("visible");
      guardar.disabled = false;
      guardar.textContent = "Guardar";
    }
  });
  pintarZonaPlantel();
}

async function verHistorial() {
  const fondo = document.createElement("div");
  fondo.className = "modal-fondo visible";
  fondo.innerHTML = `<div class="modal" style="max-width:760px;">
    <h2 style="margin-bottom:8px;">Historial de asignaciones</h2>
    <div id="cuerpoHist" style="max-height:60vh; overflow:auto;"><div class="cargando">Cargando…</div></div>
    <div style="margin-top:14px;"><button type="button" class="btn btn-fantasma" id="btnCerrarHist">Cerrar</button></div>
  </div>`;
  document.body.appendChild(fondo);
  const cerrar = () => fondo.remove();
  fondo.querySelector("#btnCerrarHist").addEventListener("click", cerrar);
  fondo.addEventListener("click", (e) => { if (e.target === fondo) cerrar(); });
  const cuerpo = fondo.querySelector("#cuerpoHist");
  try {
    const r = await RAC.get("/api/inspecciones/ingenieros/historial");
    if (!r.cambios.length) { cuerpo.innerHTML = `<div class="vacio"><strong>Todavía no hay cambios registrados</strong>Aparecerán aquí las asignaciones hechas desde esta pantalla.</div>`; return; }
    cuerpo.innerHTML = `<div class="tabla-responsive"><table><thead><tr><th>Fecha</th><th>Plantel</th><th>Antes</th><th>Ahora</th><th>Hecho por</th></tr></thead><tbody>` +
      r.cambios.map((c) => `<tr>
        <td>${escapar(new Date(c.creado_en).toLocaleString("es-VE"))}</td>
        <td>${escapar(c.plantel)}<br><small class="cod">${escapar(c.codigo_dea)}</small></td>
        <td>${c.anterior ? escapar(c.anterior) : "<em>sin responsable</em>"}</td>
        <td>${c.nuevo ? escapar(c.nuevo) : "<em>sin responsable</em>"}</td>
        <td>${escapar(c.usuario || "")}</td></tr>`).join("") + `</tbody></table></div>`;
  } catch (err) {
    cuerpo.innerHTML = `<div class="vacio"><strong>No se pudo cargar el historial</strong>${escapar(err.message)}</div>`;
  }
}

function escapar(valor) {
  if (valor === undefined || valor === null) return "";
  return String(valor).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
