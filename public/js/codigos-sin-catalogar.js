const usuario = renderShell("codigos-sin-catalogar", "Códigos sin catalogar");
let codigoEnEdicion = null; // código en el modal "Marcar como typo"

if (usuario) dibujarPanel();

function dibujarPanel() {
  const contenido = document.getElementById("contenido");
  contenido.innerHTML = `
    <div class="panel">
      <div class="panel-cabecera">
        <h2>Códigos de plantel sin catalogar</h2>
        <button class="btn btn-fantasma btn-sm" id="btnRecargar">Recargar</button>
      </div>
      <p style="padding: 0 20px; color: var(--texto-tenue, #667085); font-size: 0.9em;">
        Códigos de plantel del RAC que no existen en el catálogo, agrupados por código (alerta "Plantel no existe"). Para cada uno: marca el código como error de dedo si el plantel correcto ya existe, da de alta el plantel si es nuevo o falta en el catálogo, o revisa a quién afecta.
      </p>
      <div id="tablaCodigos" style="margin-top:16px;"></div>
    </div>
  `;
  document.getElementById("btnRecargar").addEventListener("click", cargarCodigos);
  cargarCodigos();
}

async function cargarCodigos() {
  const tabla = document.getElementById("tablaCodigos");
  tabla.innerHTML = `<div class="cargando">Cargando…</div>`;
  try {
    const resp = await RAC.get("/api/alertas/plantel-no-existe/agrupado");
    const codigos = RAC.lista(resp, "codigos");
    dibujarTabla(codigos);
  } catch (err) {
    tabla.innerHTML = `<div class="vacio"><strong>No se pudo cargar</strong>${err.message}</div>`;
  }
}

function dibujarTabla(codigos) {
  const cont = document.getElementById("tablaCodigos");
  if (!codigos.length) {
    cont.innerHTML = `<div class="vacio"><strong>Sin códigos pendientes</strong>No hay alertas de "Plantel no existe" pendientes por catalogar.</div>`;
    return;
  }

  const filas = codigos.map((c) => `
    <tr>
      <td><span class="cod">${c.codigo}</span></td>
      <td>${c.cantidad}</td>
      <td>${dibujarMuestra(c.muestra)}</td>
      <td style="white-space:nowrap;">
        <button class="btn btn-fantasma btn-sm" data-typo="${c.codigo}">Marcar typo</button>
        <button class="btn btn-fantasma btn-sm" data-alta="${c.codigo}">Dar de alta</button>
        <button class="btn btn-fantasma btn-sm" data-detalle="${c.codigo}">Ver detalle</button>
      </td>
    </tr>
  `).join("");

  cont.innerHTML = `
    <table>
      <thead><tr><th>Código</th><th>Cantidad</th><th>Muestra</th><th></th></tr></thead>
      <tbody>${filas}</tbody>
    </table>
  `;

  cont.querySelectorAll("[data-typo]").forEach((btn) => {
    btn.addEventListener("click", () => abrirTypo(btn.dataset.typo));
  });
  cont.querySelectorAll("[data-alta]").forEach((btn) => {
    btn.addEventListener("click", () => {
      window.location.href = `/planteles.html?codigo_plantel=${encodeURIComponent(btn.dataset.alta)}`;
    });
  });
  cont.querySelectorAll("[data-detalle]").forEach((btn) => {
    btn.addEventListener("click", () => abrirDetalle(btn.dataset.detalle));
  });
}

function dibujarMuestra(muestra) {
  if (!muestra || !muestra.length) return "—";
  return muestra
    .map((p) => {
      const nombreCompleto = `${p.nombres || ""} ${p.apellidos || ""}`.trim();
      return nombreCompleto || p.cedula;
    })
    .join(", ");
}

// ---- Modal: Marcar como typo ----
const modalTypoFondo = document.getElementById("modalTypoFondo");
const formTypo = document.getElementById("formTypo");
const errorModalTypo = document.getElementById("errorModalTypo");

function abrirTypo(codigo) {
  codigoEnEdicion = codigo;
  formTypo.reset();
  errorModalTypo.classList.remove("visible");
  document.getElementById("tpCodigoIncorrecto").value = codigo;
  document.getElementById("tpCodigoIncorrectoContexto").textContent = codigo;
  modalTypoFondo.classList.add("visible");
}

function cerrarTypo() {
  modalTypoFondo.classList.remove("visible");
  codigoEnEdicion = null;
}

document.getElementById("btnCancelarTypo").addEventListener("click", cerrarTypo);

formTypo.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorModalTypo.classList.remove("visible");
  const btn = document.getElementById("btnGuardarTypo");
  btn.disabled = true;
  btn.textContent = "Guardando…";

  const datos = {
    codigo_incorrecto: codigoEnEdicion,
    codigo_correcto: document.getElementById("tpCodigoCorrecto").value.trim(),
    nota: document.getElementById("tpNota").value.trim() || null,
  };

  try {
    await RAC.post("/api/mapeo-codigos-plantel", datos);
    mostrarToast(`Mapeo guardado: ${datos.codigo_incorrecto} → ${datos.codigo_correcto}. Se aplica en la próxima carga completa del RAC.`);
    cerrarTypo();
  } catch (err) {
    errorModalTypo.textContent = err.message;
    errorModalTypo.classList.add("visible");
  } finally {
    btn.disabled = false;
    btn.textContent = "Guardar mapeo";
  }
});

// ---- Modal: Ver detalle ----
const modalDetalleFondo = document.getElementById("modalDetalleFondo");

async function abrirDetalle(codigo) {
  document.getElementById("dtCodigoContexto").textContent = codigo;
  const cont = document.getElementById("dtTabla");
  cont.innerHTML = `<div class="cargando">Cargando…</div>`;
  modalDetalleFondo.classList.add("visible");

  try {
    const resp = await RAC.get(
      `/api/alertas?tipo=plantel_no_existe&estado=pendiente&detalle=${encodeURIComponent(codigo)}`
    );
    const alertas = RAC.lista(resp, "alertas");
    dibujarDetalle(alertas);
  } catch (err) {
    cont.innerHTML = `<div class="vacio"><strong>No se pudo cargar</strong>${err.message}</div>`;
  }
}

function dibujarDetalle(alertas) {
  const cont = document.getElementById("dtTabla");
  if (!alertas.length) {
    cont.innerHTML = `<div class="vacio"><strong>Sin registros</strong></div>`;
    return;
  }
  const filas = alertas.map((a) => `
    <tr>
      <td>${a.cedula || "—"}</td>
      <td>${a.nombres || "—"} ${a.apellidos || ""}</td>
    </tr>
  `).join("");
  cont.innerHTML = `
    <table>
      <thead><tr><th>Cédula</th><th>Nombre</th></tr></thead>
      <tbody>${filas}</tbody>
    </table>
  `;
}

document.getElementById("btnCerrarDetalle").addEventListener("click", () => {
  modalDetalleFondo.classList.remove("visible");
});
