// directorio-directores.js — módulo dedicado a consultar y mantener
// actualizados los datos de contacto del director de cada plantel.
// Fuente y destino de los datos: hoja GESCOLAR en Google Sheets (mismo
// origen que "Consultar planteles"), a través del backend
// /api/directorio-directores/*.

// Esta misma pantalla se sirve también como /inspecciones/directorio.html (solo consulta para los perfiles de Inspecciones).
const usuario = window.location.pathname.startsWith("/inspecciones/")
  ? renderShell("inspecciones-directorio", "Directorio de directores")
  : renderShell("directorio-directores", "Directorio de directores");

let temporizadorBusqueda = null;
let plantelEnEdicion = null;
const puedeEditar = usuario && (usuario.rol === "admin" || usuario.rol === "operador_plantel");
// Actualizar la hoja con los datos de directores de Supervisión: solo admin y solo desde la pantalla de RAC.
const puedeSincronizar = usuario && usuario.rol === "admin" && !window.location.pathname.startsWith("/inspecciones/");

if (usuario) dibujarPanel();

function dibujarPanel() {
  const contenido = document.getElementById("contenido");
  contenido.innerHTML = `
    <section class="planteles-hero">
      <div class="planteles-hero-copy">
        <span class="planteles-eyebrow">CATÁLOGO GESCOLAR</span>
        <h1>Directorio de directores</h1>
        <p>Datos de contacto del director de cada plantel · fuente: GESCOLAR.</p>
      </div>
    </section>

    ${puedeSincronizar ? `
    <div class="panel" id="panelSupervision" style="margin-bottom:14px;">
      <div style="padding:16px 20px;">
        <h2 style="margin:0 0 4px; font-size:1.05rem;">Actualizar con los datos de Supervisión</h2>
        <p style="margin:0 0 12px; color:var(--muted); font-size:.85rem;">Compara el director de GESCOLAR con el de Supervisión. Si la cédula es distinta, GESCOLAR quedó viejo y se reemplaza (nombre, cédula, teléfonos y correo). Si la cédula coincide, solo se completan vacíos. Primero ves una vista previa; no se escribe nada hasta que confirmes.</p>
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <button type="button" class="btn btn-primario" id="btnVistaPrevia">Ver vista previa</button>
          <button type="button" class="btn btn-fantasma" id="btnHistorialSync">Ver actualizaciones hechas</button>
        </div>
        <div class="error-msg" id="errorSync" style="margin-top:10px;"></div>
        <div id="resultadoSync" style="margin-top:12px;"></div>
      </div>
    </div>` : ""}

    <div class="panel">
      <div style="padding: 16px 20px 0;">
        <div class="filtros">
          <input type="text" id="qBuscarDirector" placeholder="Buscar por nombre del plantel, código DEA o nombre del director..." style="flex:1; min-width:280px;">
        </div>
      </div>
      <div id="resumenBusquedaDirector" style="padding: 10px 20px 0; color: var(--muted); font-size: .8rem;"></div>
      <div id="tablaDirectores" style="margin-top:12px;"></div>
    </div>
  `;

  const input = document.getElementById("qBuscarDirector");
  input.addEventListener("input", () => {
    clearTimeout(temporizadorBusqueda);
    temporizadorBusqueda = setTimeout(() => buscarDirectores(input.value.trim()), 380);
  });

  mostrarEstadoInicial();
  if (puedeSincronizar) {
    document.getElementById("btnVistaPrevia").addEventListener("click", verVistaPrevia);
    document.getElementById("btnHistorialSync").addEventListener("click", verHistorialSync);
  }
}

function mostrarEstadoInicial() {
  document.getElementById("resumenBusquedaDirector").textContent = "";
  document.getElementById("tablaDirectores").innerHTML = `
    <div class="vacio">
      <strong>Escribe para buscar</strong>
      Mínimo 2 caracteres — busca por nombre del plantel, código DEA o nombre del director.
    </div>`;
}

async function buscarDirectores(q) {
  const resumen = document.getElementById("resumenBusquedaDirector");
  const tabla = document.getElementById("tablaDirectores");

  if (!q) return mostrarEstadoInicial();
  if (q.length < 2) {
    resumen.textContent = "";
    tabla.innerHTML = `<div class="vacio"><strong>Escribe al menos 2 caracteres</strong>para empezar la búsqueda.</div>`;
    return;
  }

  tabla.innerHTML = `<div class="cargando">Buscando…</div>`;
  try {
    const resp = await RAC.get(`/api/directorio-directores/buscar?q=${encodeURIComponent(q)}`);
    const resultados = RAC.lista(resp, "directores");
    resumen.textContent = resp && typeof resp.total === "number"
      ? `${resp.total} resultado${resp.total === 1 ? "" : "s"}${resp.limitado ? " · mostrando los primeros 200" : ""}`
      : "";
    dibujarTablaDirectores(resultados);
  } catch (err) {
    resumen.textContent = "";
    tabla.innerHTML = `<div class="vacio"><strong>No se pudo buscar</strong>${escapar(err.message)}</div>`;
  }
}

function dibujarTablaDirectores(planteles) {
  const cont = document.getElementById("tablaDirectores");
  if (!planteles.length) {
    cont.innerHTML = `<div class="vacio"><strong>Sin resultados</strong>Prueba con otro nombre, código o director.</div>`;
    return;
  }

  const filas = planteles.map((p, i) => `
    <tr>
      <td><span class="cod">${escapar(p.cod_plantel) || "—"}</span></td>
      <td>${escapar(p.nombre_plantel) || "—"}<br><span style="color:var(--muted); font-size:.78rem;">${[escapar(p.municipio), escapar(p.parroquia)].filter(Boolean).join(" · ")}</span></td>
      <td>${escapar(p.director_nombre) || "—"}</td>
      <td>${[escapar(p.telefono_director), escapar(p.telefono_movil_director)].filter(Boolean).join(" / ") || "—"}</td>
      <td>${escapar(p.correo) || "—"}</td>
      <td>${puedeEditar ? `<button class="btn btn-fantasma btn-sm" data-editar="${i}">Editar</button>` : ""}</td>
    </tr>
  `).join("");

  cont.innerHTML = `
    <div class="tabla-responsive">
      <table>
        <thead><tr><th>Código</th><th>Plantel</th><th>Director</th><th>Teléfono(s)</th><th>Correo</th><th></th></tr></thead>
        <tbody>${filas}</tbody>
      </table>
    </div>
  `;

  cont.querySelectorAll("[data-editar]").forEach((btn) => {
    const plantel = planteles[Number(btn.dataset.editar)];
    btn.addEventListener("click", () => abrirEdicionDirector(plantel));
  });
}

// ---- Modal de edición ----
const modalDirectorFondo = document.getElementById("modalDirectorFondo");
const formDirector = document.getElementById("formDirector");
const errorModalDirector = document.getElementById("errorModalDirector");

async function abrirEdicionDirector(plantelResumen) {
  plantelEnEdicion = plantelResumen.cod_plantel;
  errorModalDirector.classList.remove("visible");
  document.getElementById("modalDirectorTitulo").textContent = plantelResumen.nombre_plantel || "Editar director";
  document.getElementById("modalDirectorSubtitulo").textContent = plantelResumen.cod_plantel || "";
  formDirector.reset();
  modalDirectorFondo.classList.add("visible");

  // Trae el detalle completo (incluye tipo_documento/documento_identidad,
  // que la tabla de resultados no muestra) antes de dejar editar.
  try {
    const detalle = await RAC.get(`/api/directorio-directores/${encodeURIComponent(plantelResumen.cod_plantel)}`);
    document.getElementById("dirNombre").value = detalle.director_nombre || "";
    document.getElementById("dirTipoDocumento").value = detalle.tipo_documento || "";
    document.getElementById("dirDocumento").value = detalle.documento_identidad || "";
    document.getElementById("dirTelefono").value = detalle.telefono_director || "";
    document.getElementById("dirTelefonoMovil").value = detalle.telefono_movil_director || "";
    document.getElementById("dirCorreo").value = detalle.correo || "";
  } catch (err) {
    errorModalDirector.textContent = err.message;
    errorModalDirector.classList.add("visible");
  }
}

function cerrarEdicionDirector() {
  modalDirectorFondo.classList.remove("visible");
  plantelEnEdicion = null;
}

document.getElementById("btnCancelarDirector").addEventListener("click", cerrarEdicionDirector);
modalDirectorFondo.addEventListener("click", (e) => {
  if (e.target === modalDirectorFondo) cerrarEdicionDirector();
});

formDirector.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!plantelEnEdicion) return;
  errorModalDirector.classList.remove("visible");
  const btn = document.getElementById("btnGuardarDirector");
  btn.disabled = true;
  btn.textContent = "Guardando…";

  const datos = {
    director_nombre: document.getElementById("dirNombre").value.trim() || null,
    tipo_documento: document.getElementById("dirTipoDocumento").value || null,
    documento_identidad: document.getElementById("dirDocumento").value.trim() || null,
    telefono_director: document.getElementById("dirTelefono").value.trim() || null,
    telefono_movil_director: document.getElementById("dirTelefonoMovil").value.trim() || null,
    correo: document.getElementById("dirCorreo").value.trim() || null,
  };

  try {
    await RAC.post(`/api/directorio-directores/${encodeURIComponent(plantelEnEdicion)}`, datos);
    mostrarToast("Datos del director actualizados.");
    cerrarEdicionDirector();
    const q = document.getElementById("qBuscarDirector").value.trim();
    if (q.length >= 2) buscarDirectores(q);
  } catch (err) {
    errorModalDirector.textContent = err.message;
    errorModalDirector.classList.add("visible");
  } finally {
    btn.disabled = false;
    btn.textContent = "Guardar cambios";
  }
});

// ---- Actualizar con Supervisión (admin) ----
const ETIQUETAS_CAMPO = {
  director_nombre: "Director", documento_identidad: "Cédula", tipo_documento: "Tipo doc.",
  telefono_movil_director: "Móvil", telefono_director: "Teléfono", correo: "Correo",
};
let PLAN = null;

function mostrarErrorSync(mensaje) {
  const e = document.getElementById("errorSync");
  e.textContent = mensaje || "";
  e.classList.toggle("visible", Boolean(mensaje));
}

async function verVistaPrevia() {
  mostrarErrorSync("");
  const cont = document.getElementById("resultadoSync");
  const btn = document.getElementById("btnVistaPrevia");
  btn.disabled = true;
  cont.innerHTML = `<div class="cargando">Comparando GESCOLAR con Supervisión…</div>`;
  try {
    PLAN = await RAC.get("/api/directorio-directores/sincronizar-supervision/vista-previa");
    dibujarVistaPrevia();
  } catch (err) {
    cont.innerHTML = "";
    mostrarErrorSync(err.message);
  } finally {
    btn.disabled = false;
  }
}

function dibujarVistaPrevia() {
  const cont = document.getElementById("resultadoSync");
  const r = PLAN.resumen;
  const ficha = (n, t) => `<div style="flex:1; min-width:140px; padding:10px 12px; border:1px solid var(--line,#e0e7f0); border-radius:10px;"><div style="font-size:1.3rem; font-weight:700;">${n}</div><div style="font-size:.8rem; color:var(--muted);">${t}</div></div>`;
  cont.innerHTML = `
    <div style="display:flex; gap:10px; flex-wrap:wrap;">
      ${ficha(r.reemplazar, "directores que se REEMPLAZAN (cédula distinta)")}
      ${ficha(r.completar, "planteles donde se COMPLETAN vacíos")}
      ${ficha(r.sin_cambio, "sin cambios")}
      ${ficha(r.revisar_nombre + r.revisar_telefono, "diferencias que NO se tocan (nombre/teléfono ya con dato)")}
    </div>
    <p style="margin:10px 0; font-size:.82rem; color:var(--muted);">${r.solo_gescolar} planteles están solo en GESCOLAR y ${r.solo_supervision} solo en Supervisión: no se tocan.</p>
    ${PLAN.cambios.length ? `
    <div class="filtros" style="margin-bottom:8px;">
      <select id="filtroTipoSync"><option value="">Todos los cambios</option><option value="REEMPLAZO">Solo reemplazos</option><option value="COMPLETAR">Solo vacíos</option></select>
      <input type="text" id="filtroTextoSync" placeholder="Filtrar por plantel o código..." style="flex:1; min-width:220px;">
    </div>
    <div class="tabla-responsive" style="max-height:420px; overflow:auto;"><table id="tablaPlanSync"></table></div>
    <div style="margin-top:12px; display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
      <button type="button" class="btn btn-primario" id="btnAplicarSync">Aplicar ${PLAN.cambios.length} cambios en la hoja GESCOLAR</button>
      <span style="font-size:.8rem; color:var(--muted);">Queda registro de quién y cuándo, y se puede restaurar.</span>
    </div>` : `<div class="vacio"><strong>No hay nada que actualizar</strong>GESCOLAR ya está al día con Supervisión.</div>`}`;
  if (PLAN.cambios.length) {
    document.getElementById("filtroTipoSync").addEventListener("change", dibujarTablaPlan);
    document.getElementById("filtroTextoSync").addEventListener("input", dibujarTablaPlan);
    document.getElementById("btnAplicarSync").addEventListener("click", aplicarSync);
    dibujarTablaPlan();
  }
}

function dibujarTablaPlan() {
  const tipo = document.getElementById("filtroTipoSync").value;
  const q = document.getElementById("filtroTextoSync").value.trim().toLowerCase();
  const lista = PLAN.cambios.filter((c) => (!tipo || c.tipo === tipo) && (!q || `${c.plantel} ${c.codigo}`.toLowerCase().includes(q)));
  const vista = lista.slice(0, 300);
  document.getElementById("tablaPlanSync").innerHTML = `
    <thead><tr><th>Plantel</th><th>Cambio</th><th>Dato</th><th>Antes</th><th>Después</th></tr></thead>
    <tbody>${vista.map((c) => c.campos.map((x, i) => `<tr>
      ${i === 0 ? `<td rowspan="${c.campos.length}"><strong>${escapar(c.plantel)}</strong><br><small>${escapar(c.codigo)} · ${escapar(c.municipio)}</small></td><td rowspan="${c.campos.length}">${c.tipo === "REEMPLAZO" ? "Reemplazo" : "Completar"}</td>` : ""}
      <td>${escapar(ETIQUETAS_CAMPO[x.campo] || x.campo)}</td><td>${escapar(x.antes) || "—"}</td><td><strong>${escapar(x.despues) || "(vacío)"}</strong></td></tr>`).join("")).join("")}</tbody>
    ${lista.length > vista.length ? `<caption style="caption-side:bottom; padding:8px; color:var(--muted); font-size:.8rem;">Se muestran los primeros ${vista.length} de ${lista.length} planteles; al aplicar se escriben todos.</caption>` : ""}`;
}

async function aplicarSync() {
  const r = PLAN.resumen;
  if (!window.confirm(`Se va a escribir en la hoja GESCOLAR:\n\n• ${r.reemplazar} directores reemplazados\n• ${r.completar} planteles con vacíos completados\n\nQueda registro y se puede restaurar. ¿Aplicar?`)) return;
  mostrarErrorSync("");
  const btn = document.getElementById("btnAplicarSync");
  btn.disabled = true;
  btn.textContent = "Escribiendo en la hoja…";
  try {
    const res = await RAC.post("/api/directorio-directores/sincronizar-supervision/aplicar", { confirmar: true });
    mostrarToast(`Hoja actualizada: ${res.aplicados} planteles.`);
    document.getElementById("resultadoSync").innerHTML = `<div class="vacio"><strong>Listo: ${res.aplicados} planteles actualizados (${res.celdas || 0} datos)</strong>Si algo no quedó bien, entra a «Ver actualizaciones hechas» y usa «Restaurar».</div>`;
    PLAN = null;
  } catch (err) {
    mostrarErrorSync(err.message);
    btn.disabled = false;
    btn.textContent = `Aplicar ${PLAN.cambios.length} cambios en la hoja GESCOLAR`;
  }
}

async function verHistorialSync() {
  mostrarErrorSync("");
  const cont = document.getElementById("resultadoSync");
  try {
    const { historial } = await RAC.get("/api/directorio-directores/sincronizar-supervision/historial");
    cont.innerHTML = historial.length ? `<div class="tabla-responsive"><table>
      <thead><tr><th>Cuándo</th><th>Quién</th><th>Reemplazos</th><th>Completados</th><th></th></tr></thead>
      <tbody>${historial.map((h) => `<tr><td>${escapar(new Date(h.creado_en).toLocaleString("es-VE"))}</td><td>${escapar(h.usuario || "")}</td>
        <td>${h.resumen.reemplazar}</td><td>${h.resumen.completar}</td>
        <td>${h.revertido_en ? "<small>restaurada</small>" : `<button type="button" class="btn btn-fantasma" data-restaurar="${h.id}">Restaurar</button>`}</td></tr>`).join("")}</tbody></table></div>`
      : `<div class="vacio"><strong>Todavía no se ha hecho ninguna actualización</strong></div>`;
    cont.querySelectorAll("[data-restaurar]").forEach((b) => b.addEventListener("click", async () => {
      if (!window.confirm("¿Devolver la hoja GESCOLAR a como estaba antes de esa actualización?\n\nSolo se restauran los datos que nadie haya cambiado después.")) return;
      b.disabled = true;
      try {
        const r = await RAC.post(`/api/directorio-directores/sincronizar-supervision/${b.dataset.restaurar}/revertir`, {});
        mostrarToast(`Restaurados ${r.restauradas} datos${r.omitidas ? ` (${r.omitidas} se dejaron porque alguien los cambió después)` : ""}.`);
        verHistorialSync();
      } catch (err) {
        mostrarErrorSync(err.message);
        b.disabled = false;
      }
    }));
  } catch (err) {
    mostrarErrorSync(err.message);
  }
}

function escapar(valor) {
  if (valor === undefined || valor === null) return "";
  return String(valor)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
