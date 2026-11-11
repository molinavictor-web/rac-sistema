const usuario = renderShell("credenciales", "Credenciales");
if (usuario) dibujarPanel();

function dibujarPanel() {
  document.getElementById("contenido").innerHTML = `
    <div class="panel">
      <div class="panel-cabecera">
        <h2>Generar credencial (nómina + RAC)</h2>
      </div>
      <div class="buscador-credenciales" style="display:flex; gap:10px; margin-bottom:16px;">
        <input type="text" id="cedulaBuscar" placeholder="Escribe una cédula, ej. 9293431" style="flex:1; padding:10px 14px; font-size:1rem; border:1px solid #ccc; border-radius:6px;">
        <button class="btn btn-primario btn-sm" id="btnBuscar">Buscar</button>
      </div>
      <div id="firmanteActual" style="font-size:.88rem; color:#555; margin:-6px 0 14px;"></div>
      <div id="resultadosCredenciales"></div>
    </div>

    ${usuario.rol === "admin" ? `
    <div class="panel" style="margin-top:24px;">
      <div class="panel-cabecera">
        <h2>Autoridad que firma (solo administrador)</h2>
      </div>
      <p style="margin-bottom:12px;">
        Estos datos salen en el texto y en la firma de las credenciales <strong>nuevas</strong>.
        Las ya emitidas conservan la firma con la que salieron, y la hoja anota quién firmó cada una.
      </p>
      <div id="formFirmante"><div class="cargando">Cargando…</div></div>
    </div>
    ` : ""}

    <div class="panel" style="margin-top:24px;">
      <div class="panel-cabecera">
        <h2>Pendientes de aprobación</h2>
        <button class="btn btn-fantasma btn-sm" id="btnRefrescarPendientes">Actualizar</button>
      </div>
      <p style="margin-bottom:12px;">Aprueba solo después de haber impreso, firmado físicamente y escaneado el documento.</p>
      <div id="tablaPendientes"></div>
    </div>

    ${usuario.rol === "admin" ? `
    <div class="panel" style="margin-top:24px;">
      <div class="panel-cabecera">
        <h2>Todas las credenciales (solo administrador)</h2>
        <button class="btn btn-fantasma btn-sm" id="btnRefrescarTodas">Actualizar</button>
      </div>
      <p style="margin-bottom:12px;">
        Eliminar marca la credencial como no válida (no se borra el registro, queda
        guardado para auditoría). Si ya está aprobada, se pedirá una confirmación extra.
      </p>
      <div id="tablaTodas"></div>
    </div>
    ` : ""}
  `;

  document.getElementById("btnBuscar").addEventListener("click", buscarCedula);
  document.getElementById("cedulaBuscar").addEventListener("keydown", (e) => {
    if (e.key === "Enter") buscarCedula();
  });
  document.getElementById("btnRefrescarPendientes").addEventListener("click", cargarPendientes);

  cargarPendientes();
  cargarFirmante();

  if (usuario.rol === "admin") {
    document.getElementById("btnRefrescarTodas").addEventListener("click", cargarTodas);
    cargarTodas();
  }
}

// Registros de la última búsqueda, por id del RAC (para llenar el editor).
let registrosBuscados = {};
// URL del PDF de vista previa abierto en cada tarjeta (para liberarla al cerrar).
const urlsVistaPrevia = {};

function escapar(valor) {
  return String(valor === null || valor === undefined ? "" : valor)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

async function buscarCedula() {
  const cedula = document.getElementById("cedulaBuscar").value.trim();
  const cont = document.getElementById("resultadosCredenciales");
  if (!cedula) {
    cont.innerHTML = `<div class="vacio"><strong>Escribe una cédula</strong>Debes indicar una cédula para buscar.</div>`;
    return;
  }
  cont.innerHTML = `<div class="cargando">Buscando…</div>`;
  try {
    const data = await RAC.get(`/api/credenciales/buscar/${encodeURIComponent(cedula)}`);
    if (!data.encontrado) {
      cont.innerHTML = `<div class="vacio"><strong>No se encontró ningún registro</strong>Esa cédula no aparece en el RAC.</div>`;
      return;
    }
    registrosBuscados = {};
    data.registros.forEach((r) => { registrosBuscados[r.id] = r; });
    cont.innerHTML = data.registros.map((r) => {
      const nombreCompleto = [r.nombres, r.apellidos].filter(Boolean).join(" ") || "—";
      const activo = (r.situacion || "").toUpperCase() === "ACTIVO";
      return `
        <div class="registro" id="registro-${r.id}" style="background:#fff; border:1px solid #ddd; border-radius:8px; padding:16px 20px; margin-bottom:14px;">
          <div style="font-weight:700; font-size:1.05rem;">${escapar(nombreCompleto)}</div>
          <div>Cédula: ${escapar(r.cedula)}</div>
          <div>Situación: <strong>${escapar(r.situacion || "—")}</strong></div>
          <div>Cargo: ${escapar(r.cargo || "—")} (código ${escapar(r.codigo_cargo || "—")})</div>
          <div>Tipo de personal: ${escapar(r.tipo_personal || "—")}</div>
          <div>Plantel: ${escapar(r.nombre_plantel || "—")} (código ${escapar(r.codigo_plantel || "—")})</div>
          <div>Municipio / Parroquia: ${escapar(r.municipio || "—")} / ${escapar(r.parroquia || "—")}</div>
          <div>Horas académicas: ${escapar(r.horas_academicas || "—")} · Horas administrativas: ${escapar(r.horas_adm || "—")}</div>
          <div>Fecha de ingreso: ${escapar(r.fecha_ingreso || "—")}</div>
          ${activo
            ? `<button class="btn btn-primario btn-sm" style="margin-top:10px;" data-preparar="${r.id}">Revisar datos y generar</button>`
            : `<div style="margin-top:8px; color:#888; font-size:.9rem;">Solo se generan credenciales para registros en situación ACTIVO.</div>`}
          <div class="editor-credencial" id="editor-${r.id}"></div>
        </div>
      `;
    }).join("");
    cont.querySelectorAll("[data-preparar]").forEach((btn) => {
      btn.addEventListener("click", () => abrirEditor(btn.dataset.preparar, btn));
    });
  } catch (err) {
    cont.innerHTML = `<div class="vacio"><strong>No se pudo buscar</strong>${escapar(err.message)}</div>`;
  }
}

// ---- Editor: datos del documento (solo para la credencial, no cambia el RAC) ----
const CAMPOS_FORMULARIO = [
  { campo: "nombres", etiqueta: "Nombres" },
  { campo: "apellidos", etiqueta: "Apellidos" },
  { campo: "director_plantel", etiqueta: "Director(a) del plantel (opcional)" },
  { campo: "cargo", etiqueta: "Cargo nominal" },
  { campo: "codigo_cargo", etiqueta: "Código de cargo (CÓDIGO RAC)" },
  { campo: "tipo_personal", etiqueta: "Tipo de personal", tipo: "select" },
  { campo: "horas_academicas", etiqueta: "Horas académicas (máx. 54)" },
  { campo: "horas_adm", etiqueta: "Horas administrativas (máx. 168)" },
  { campo: "fecha_ingreso", etiqueta: "Fecha de ingreso (DD/MM/AAAA)" },
  { campo: "nombre_plantel", etiqueta: "Nombre del plantel" },
  { campo: "codigo_plantel", etiqueta: "Código DEA" },
  { campo: "municipio", etiqueta: "Municipio" },
  { campo: "parroquia", etiqueta: "Parroquia" },
];

function abrirEditor(id, boton) {
  const r = registrosBuscados[id];
  const cont = document.getElementById(`editor-${id}`);
  if (!r || !cont) return;
  boton.style.display = "none";

  const estiloInput = "width:100%; padding:8px 10px; border:1px solid #ccc; border-radius:6px; font-size:.95rem; box-sizing:border-box;";
  const campos = CAMPOS_FORMULARIO.map((c) => {
    const valor = r[c.campo] === null || r[c.campo] === undefined ? "" : r[c.campo];
    let control;
    if (c.tipo === "select") {
      const opciones = [["D", "D — Docente"], ["A", "A — Administrativo"], ["O", "O — Obrero"]];
      const actual = String(valor).toUpperCase();
      control = `<select data-campo="${c.campo}" style="${estiloInput}">
        ${opciones.map(([v, t]) => `<option value="${v}" ${actual === v ? "selected" : ""}>${t}</option>`).join("")}
      </select>`;
    } else {
      control = `<input type="text" data-campo="${c.campo}" value="${escapar(valor)}" style="${estiloInput}">`;
    }
    return `<label style="display:block; font-size:.85rem; color:#555;">${c.etiqueta}${control}</label>`;
  }).join("");

  cont.innerHTML = `
    <div style="margin-top:14px; padding-top:14px; border-top:1px dashed #ccc;">
      <p style="margin:0 0 10px; font-size:.9rem; color:#555;">
        Corrige lo que haga falta. <strong>Estos cambios solo se usan en este documento</strong>
        y quedan anotados en la hoja de credenciales emitidas; el RAC no se modifica.
        La cédula (V-${escapar(r.cedula)}) no se puede cambiar.
        Si es docente se imprimen las horas académicas; si no, las administrativas.
      </p>
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(230px, 1fr)); gap:10px 14px;">
        ${campos}
      </div>
      <div style="display:flex; flex-wrap:wrap; gap:10px; margin-top:14px;">
        <button class="btn btn-fantasma btn-sm" data-accion="previa">Vista previa</button>
        <button class="btn btn-primario btn-sm" data-accion="generar">Generar credencial (PDF)</button>
        <button class="btn btn-fantasma btn-sm" data-accion="cancelar">Cancelar</button>
      </div>
      <div class="zona-previa" style="margin-top:14px;"></div>
    </div>
  `;

  cont.querySelector('[data-accion="previa"]').addEventListener("click", (e) => verVistaPrevia(id, e.currentTarget));
  cont.querySelector('[data-accion="generar"]').addEventListener("click", (e) => generarCredencial(id, e.currentTarget));
  cont.querySelector('[data-accion="cancelar"]').addEventListener("click", () => {
    liberarVistaPrevia(id);
    cont.innerHTML = "";
    boton.style.display = "";
  });
  // Si se cambia algo después de la vista previa, avisar que quedó vieja.
  cont.querySelectorAll("[data-campo]").forEach((el) => {
    el.addEventListener("input", () => {
      const aviso = cont.querySelector(".aviso-previa");
      if (aviso) aviso.style.display = "block";
    });
  });
}

function leerFormulario(id) {
  const datos = {};
  document.querySelectorAll(`#editor-${id} [data-campo]`).forEach((el) => {
    datos[el.dataset.campo] = el.value.trim();
  });
  return datos;
}

async function pedirPdf(url, id) {
  const r = registrosBuscados[id];
  const resp = await fetch(url, {
    method: "POST",
    headers: { Authorization: "Bearer " + RAC.getToken(), "Content-Type": "application/json" },
    body: JSON.stringify({ rac_id: Number(id), cedula: r.cedula, datos: leerFormulario(id) }),
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => null);
    throw new Error((data && data.error) || `Error ${resp.status}`);
  }
  return resp.blob();
}

function liberarVistaPrevia(id) {
  if (urlsVistaPrevia[id]) {
    URL.revokeObjectURL(urlsVistaPrevia[id]);
    delete urlsVistaPrevia[id];
  }
}

async function verVistaPrevia(id, boton) {
  const zona = document.querySelector(`#editor-${id} .zona-previa`);
  boton.disabled = true;
  boton.textContent = "Preparando…";
  try {
    const blob = await pedirPdf("/api/credenciales/vista-previa", id);
    liberarVistaPrevia(id);
    const url = URL.createObjectURL(blob);
    urlsVistaPrevia[id] = url;
    zona.innerHTML = `
      <div class="aviso-previa" style="display:none; background:#fff6e0; border:1px solid #e0b040; border-radius:6px; padding:8px 12px; margin-bottom:8px; font-size:.9rem;">
        Cambiaste datos después de esta vista previa. Pulsa «Vista previa» otra vez para actualizarla.
      </div>
      <iframe src="${url}" title="Vista previa de la credencial" style="width:100%; height:720px; border:1px solid #ccc; border-radius:6px; background:#f4f4f4;"></iframe>
      <div style="margin-top:6px; font-size:.85rem;">
        ¿No se ve? <a href="${url}" target="_blank" rel="noopener">Abrir la vista previa en otra pestaña</a>.
        La marca «VISTA PREVIA» no sale en el documento final.
      </div>
    `;
  } catch (err) {
    mostrarToast(err.message, true);
  } finally {
    boton.disabled = false;
    boton.textContent = "Vista previa";
  }
}

async function generarCredencial(id, boton) {
  const r = registrosBuscados[id];
  boton.disabled = true;
  boton.textContent = "Generando…";
  try {
    const blob = await pedirPdf(`/api/credenciales/generar/${encodeURIComponent(r.cedula)}`, id);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `credencial_${r.cedula}_${r.codigo_cargo || id}.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    boton.textContent = "PDF descargado ✓";
    mostrarToast("Credencial generada y registrada como pendiente de aprobación.");
    cargarPendientes();
    if (usuario.rol === "admin") cargarTodas();
  } catch (err) {
    boton.disabled = false;
    boton.textContent = "Generar credencial (PDF)";
    mostrarToast(err.message, true);
  }
}

// ---- Autoridad que firma ----
async function cargarFirmante() {
  const linea = document.getElementById("firmanteActual");
  try {
    const f = await RAC.get("/api/credenciales/firmante");
    if (linea) {
      linea.innerHTML = `Firma actualmente: <strong>${escapar(f.nombre)}</strong> — ${escapar(f.cargo)}`;
    }
    if (usuario.rol === "admin") dibujarFormFirmante(f);
  } catch (err) {
    if (linea) linea.textContent = "";
    const cont = document.getElementById("formFirmante");
    if (cont) cont.innerHTML = `<div class="vacio"><strong>No se pudo cargar</strong>${escapar(err.message)}</div>`;
  }
}

function dibujarFormFirmante(f) {
  const cont = document.getElementById("formFirmante");
  if (!cont) return;
  const estiloInput = "width:100%; padding:8px 10px; border:1px solid #ccc; border-radius:6px; font-size:.95rem; box-sizing:border-box;";
  const campo = (id, etiqueta, valor, ayuda) => `
    <label style="display:block; font-size:.85rem; color:#555;">${etiqueta}
      <input type="text" data-firmante="${id}" value="${escapar(valor)}" style="${estiloInput}">
      ${ayuda ? `<span style="font-size:.78rem; color:#888;">${ayuda}</span>` : ""}
    </label>`;
  const ultima = f.actualizado_en
    ? `Último cambio: ${escapar(new Date(f.actualizado_en).toLocaleString("es-VE"))}${f.actualizado_por ? ` por ${escapar(f.actualizado_por)}` : ""}.`
    : "Todavía no se ha cambiado desde aquí (se usan los datos configurados en el servidor).";
  cont.innerHTML = `
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:10px 14px;">
      ${campo("nombre", "Nombre completo (como debe salir)", f.nombre, "Ej. PROFA. MARÍA PÉREZ")}
      ${campo("cedula", "Cédula", f.cedula, "Ej. V-12.345.678")}
      ${campo("cargo", "Cargo", f.cargo, "Ej. Directora de Zona Educativa del Estado Monagas")}
      ${campo("resolucion", "Resolución / Gaceta", f.resolucion, "Sale debajo de la firma")}
    </div>
    <div style="display:flex; flex-wrap:wrap; align-items:center; gap:12px; margin-top:14px;">
      <button class="btn btn-primario btn-sm" id="btnGuardarFirmante">Guardar autoridad</button>
      <span style="font-size:.85rem; color:#777;">${ultima}</span>
    </div>
  `;
  document.getElementById("btnGuardarFirmante").addEventListener("click", guardarFirmante);
}

async function guardarFirmante() {
  const boton = document.getElementById("btnGuardarFirmante");
  const datos = {};
  document.querySelectorAll("#formFirmante [data-firmante]").forEach((el) => {
    datos[el.dataset.firmante] = el.value.trim();
  });
  const vacio = Object.entries(datos).find(([, v]) => !v);
  if (vacio) {
    mostrarToast("Todos los campos de la autoridad son obligatorios.", true);
    return;
  }
  const ok = window.confirm(
    `¿Guardar a ${datos.nombre} como la autoridad que firma?\n\nSolo afecta a las credenciales que se generen de aquí en adelante.`
  );
  if (!ok) return;
  boton.disabled = true;
  boton.textContent = "Guardando…";
  try {
    await RAC.put("/api/credenciales/firmante", datos);
    mostrarToast("Autoridad que firma actualizada.");
    cargarFirmante();
  } catch (err) {
    boton.disabled = false;
    boton.textContent = "Guardar autoridad";
    mostrarToast(err.message, true);
  }
}

async function cargarPendientes() {
  const cont = document.getElementById("tablaPendientes");
  if (!cont) return;
  cont.innerHTML = `<div class="cargando">Cargando pendientes…</div>`;
  try {
    const data = await RAC.get("/api/credenciales/pendientes");
    if (!data.pendientes.length) {
      cont.innerHTML = `<div class="vacio"><strong>No hay credenciales pendientes</strong></div>`;
      return;
    }
    const filas = data.pendientes.map((p) => `
      <tr>
        <td>${p.codigo_verificacion}</td>
        <td>${p.cedula}</td>
        <td>${p.nombre}</td>
        <td>${p.plantel || ""}</td>
        <td><button class="btn btn-fantasma btn-sm" data-codigo="${p.codigo_verificacion}">Aprobar</button></td>
      </tr>
    `).join("");
    cont.innerHTML = `
      <table>
        <thead><tr><th>Código</th><th>Cédula</th><th>Nombre</th><th>Plantel</th><th></th></tr></thead>
        <tbody>${filas}</tbody>
      </table>
    `;
    cont.querySelectorAll("[data-codigo]").forEach((btn) => {
      btn.addEventListener("click", () => aprobarCredencial(btn));
    });
  } catch (err) {
    cont.innerHTML = `<div class="vacio"><strong>No se pudo cargar</strong>${err.message}</div>`;
  }
}

async function aprobarCredencial(boton) {
  const codigo = boton.dataset.codigo;
  const ok = window.confirm("¿Confirmas que ya la firmaste físicamente?");
  if (!ok) return;
  boton.disabled = true;
  boton.textContent = "Aprobando…";
  try {
    await RAC.post(`/api/credenciales/aprobar/${encodeURIComponent(codigo)}`, {});
    mostrarToast("Credencial aprobada.");
    cargarPendientes();
    if (usuario.rol === "admin") cargarTodas();
  } catch (err) {
    boton.disabled = false;
    boton.textContent = "Aprobar";
    mostrarToast(err.message, true);
  }
}

// ---- Panel "Todas las credenciales" (solo admin) ----
function etiquetaEstadoCredencial(estado) {
  const mapa = {
    pendiente: '<span class="badge">Pendiente</span>',
    aprobada: '<span class="badge badge-resuelto">Aprobada</span>',
    eliminada: '<span class="badge badge-descartado">Eliminada</span>',
  };
  return mapa[estado] || estado || "—";
}

async function cargarTodas() {
  const cont = document.getElementById("tablaTodas");
  if (!cont) return;
  cont.innerHTML = `<div class="cargando">Cargando credenciales…</div>`;
  try {
    const data = await RAC.get("/api/credenciales/todas");
    if (!data.credenciales.length) {
      cont.innerHTML = `<div class="vacio"><strong>Aún no se ha generado ninguna credencial</strong></div>`;
      return;
    }
    const filas = data.credenciales.map((c) => `
      <tr>
        <td>${c.codigo_verificacion}</td>
        <td>${c.cedula}</td>
        <td>${c.nombre}</td>
        <td>${c.plantel || ""}</td>
        <td>${etiquetaEstadoCredencial(c.estado)}</td>
        <td>
          ${c.estado === "eliminada"
            ? ""
            : `<button class="btn btn-fantasma btn-sm" data-eliminar-codigo="${c.codigo_verificacion}" data-estado="${c.estado}">Eliminar</button>`
          }
        </td>
      </tr>
    `).join("");
    cont.innerHTML = `
      <table>
        <thead><tr><th>Código</th><th>Cédula</th><th>Nombre</th><th>Plantel</th><th>Estado</th><th></th></tr></thead>
        <tbody>${filas}</tbody>
      </table>
    `;
    cont.querySelectorAll("[data-eliminar-codigo]").forEach((btn) => {
      btn.addEventListener("click", () => eliminarCredencial(btn));
    });
  } catch (err) {
    cont.innerHTML = `<div class="vacio"><strong>No se pudo cargar</strong>${err.message}</div>`;
  }
}

async function eliminarCredencial(boton) {
  const codigo = boton.dataset.eliminarCodigo;
  const estado = boton.dataset.estado;

  const confirmarAprobada = estado === "aprobada";
  const mensaje = confirmarAprobada
    ? "Esta credencial YA FUE APROBADA (probablemente ya fue entregada). ¿Seguro que quieres eliminarla?"
    : "¿Eliminar esta credencial pendiente?";
  const ok = window.confirm(mensaje);
  if (!ok) return;

  boton.disabled = true;
  boton.textContent = "Eliminando…";
  try {
    const resp = await fetch(`/api/credenciales/${encodeURIComponent(codigo)}`, {
      method: "DELETE",
      headers: {
        Authorization: "Bearer " + RAC.getToken(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(confirmarAprobada ? { confirmarAprobada: true } : {}),
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => null);
      throw new Error((data && data.error) || `Error ${resp.status}`);
    }
    mostrarToast("Credencial eliminada.");
    cargarTodas();
    cargarPendientes();
  } catch (err) {
    boton.disabled = false;
    boton.textContent = "Eliminar";
    mostrarToast(err.message, true);
  }
}
