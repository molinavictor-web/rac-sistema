// planteles-consulta.js — Consulta GESCOLAR.
// Rediseño visual 2026: se conserva la lógica de búsqueda, Drive, subida y
// descarga; solo se reorganiza la presentación para que la ficha sea más clara.

const usuario = renderShell("planteles-consulta", "Consultar planteles");

const CAMPO_CODIGO = "cod_plantel";
const CAMPO_NOMBRE = "nombre_plantel";
const CAMPO_MUNICIPIO = "municipio";
const CAMPO_PARROQUIA = "parroquia";
const CAMPO_DIRECTOR = "director_nombre";
const CAMPO_TEL_DIRECTOR = "telefono_director";
const CAMPO_TEL_MOVIL_DIRECTOR = "telefono_movil_director";

const CAMPOS_TABLA = [CAMPO_CODIGO, CAMPO_NOMBRE, CAMPO_MUNICIPIO, CAMPO_PARROQUIA, CAMPO_DIRECTOR];
const CAMPOS_DESTACADOS_FICHA = [
  CAMPO_CODIGO, CAMPO_NOMBRE, CAMPO_MUNICIPIO, CAMPO_PARROQUIA,
  CAMPO_DIRECTOR, CAMPO_TEL_DIRECTOR, CAMPO_TEL_MOVIL_DIRECTOR,
];

let ultimosResultados = [];
let temporizadorBusqueda = null;
const puedeRefrescar = usuario && (usuario.rol === "admin" || usuario.rol === "operador_plantel");

if (usuario) dibujarPanel();

function dibujarPanel() {
  const contenido = document.getElementById("contenido");
  contenido.innerHTML = `
    <div class="planteles-consulta-page">
      <section class="pc-hero">
        <div class="pc-hero-content">
          <div class="pc-kicker"><span class="pc-kicker-dot"></span> GESCOLAR · Consulta institucional</div>
          <h2>Consulta de planteles</h2>
          <p>Localiza rápidamente un plantel por nombre, código DEA, municipio, parroquia, circuito, consejo comunal o director. Consulta su ficha completa y los documentos asociados en Drive.</p>
        </div>
      </section>

      <section class="pc-search-panel" aria-label="Búsqueda de planteles">
        <div class="pc-search-row">
          <div class="pc-search-field">
            <label class="pc-search-label" for="qBuscar">Buscar plantel</label>
            <div class="pc-search-input-wrap">
              <span class="pc-search-icon" aria-hidden="true">⌕</span>
              <input class="pc-search-input" type="search" id="qBuscar" autocomplete="off" spellcheck="false"
                placeholder="Nombre, código DEA, municipio, parroquia, circuito, consejo comunal o director…"
                aria-describedby="ayudaBusqueda">
              <button type="button" class="pc-clear" id="btnLimpiarBusqueda" title="Limpiar búsqueda" aria-label="Limpiar búsqueda">×</button>
            </div>
          </div>
          ${puedeRefrescar ? `<button class="btn btn-fantasma pc-refresh" id="btnRefrescar" type="button">↻ &nbsp;Actualizar GESCOLAR</button>` : ""}
        </div>
        <div class="pc-meta">
          <div class="pc-results-count" id="resumenBusqueda" aria-live="polite"></div>
          <div class="pc-hint" id="ayudaBusqueda">Escribe al menos 2 caracteres · máximo 200 resultados visibles</div>
        </div>
      </section>

      <section class="pc-results" aria-label="Resultados de planteles">
        <div class="pc-results-head">
          <div>
            <h3>Resultados de consulta</h3>
          </div>
          <span>Fuente: GESCOLAR</span>
        </div>
        <div id="tablaPlanteles"></div>
      </section>
    </div>
  `;

  const input = document.getElementById("qBuscar");
  input.addEventListener("input", () => {
    clearTimeout(temporizadorBusqueda);
    temporizadorBusqueda = setTimeout(() => buscarPlanteles(input.value.trim()), 320);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      input.value = "";
      mostrarEstadoInicial();
      input.focus();
    }
  });

  document.getElementById("btnLimpiarBusqueda").addEventListener("click", () => {
    input.value = "";
    mostrarEstadoInicial();
    input.focus();
  });

  if (puedeRefrescar) {
    document.getElementById("btnRefrescar").addEventListener("click", refrescarDatos);
  }

  mostrarEstadoInicial();
}

function mostrarEstadoInicial() {
  const resumen = document.getElementById("resumenBusqueda");
  const tabla = document.getElementById("tablaPlanteles");
  if (!resumen || !tabla) return;
  resumen.textContent = "";
  tabla.innerHTML = `
    <div class="pc-empty">
      <div class="pc-empty-icon" aria-hidden="true">⌕</div>
      <strong>Busca un plantel para comenzar</strong>
      <span>Utiliza el campo superior para consultar por nombre, código DEA, municipio, parroquia, circuito, consejo comunal o director.</span>
    </div>`;
}

async function buscarPlanteles(q) {
  const resumen = document.getElementById("resumenBusqueda");
  const tabla = document.getElementById("tablaPlanteles");
  if (!resumen || !tabla) return;

  if (!q) return mostrarEstadoInicial();
  if (q.length < 2) {
    resumen.textContent = "";
    tabla.innerHTML = `<div class="pc-empty"><div class="pc-empty-icon" aria-hidden="true">⌕</div><strong>Escribe al menos 2 caracteres</strong><span>La búsqueda comenzará cuando introduzcas más información.</span></div>`;
    return;
  }

  tabla.innerHTML = `<div class="pc-loading"><span class="pc-loading-dot"></span>Buscando en GESCOLAR…</div>`;
  try {
    const resp = await RAC.get(`/api/planteles-consulta/buscar?q=${encodeURIComponent(q)}`);
    ultimosResultados = RAC.lista(resp, "planteles");
    resumen.textContent = resp && typeof resp.total === "number"
      ? `${resp.total.toLocaleString("es-VE")} resultado${resp.total === 1 ? "" : "s"}${resp.limitado ? " · mostrando los primeros 200" : ""}`
      : "";
    dibujarTabla(ultimosResultados);
  } catch (err) {
    resumen.textContent = "";
    tabla.innerHTML = `<div class="pc-empty"><div class="pc-empty-icon" aria-hidden="true">!</div><strong>No se pudo realizar la búsqueda</strong><span>${escapar(err.message)}</span></div>`;
  }
}

function dibujarTabla(planteles) {
  const cont = document.getElementById("tablaPlanteles");
  if (!cont) return;

  if (!planteles.length) {
    cont.innerHTML = `<div class="pc-empty"><div class="pc-empty-icon" aria-hidden="true">⌕</div><strong>Sin resultados</strong><span>No encontramos planteles con ese criterio. Prueba con otro nombre, código DEA, municipio o director.</span></div>`;
    return;
  }

  const filas = planteles.map((p, i) => `
    <tr>
      <td><span class="pc-code">${escapar(p[CAMPO_CODIGO]) || "—"}</span></td>
      <td><div class="pc-plantel-name">${escapar(p[CAMPO_NOMBRE]) || "Sin nombre registrado"}</div></td>
      <td>${escapar(p[CAMPO_MUNICIPIO]) || "—"}</td>
      <td>${escapar(p[CAMPO_PARROQUIA]) || "—"}</td>
      <td>${escapar(p[CAMPO_DIRECTOR]) || "—"}</td>
      <td class="pc-action"><button class="btn btn-fantasma btn-sm pc-view-btn" type="button" data-ver-ficha="${i}" aria-label="Ver ficha de ${escapar(p[CAMPO_NOMBRE]) || "plantel"}">Ver ficha <span aria-hidden="true">→</span></button></td>
    </tr>
  `).join("");

  cont.innerHTML = `
    <div class="pc-table-wrap">
      <table class="pc-table">
        <thead>
          <tr>
            <th scope="col">Código DEA</th>
            <th scope="col">Plantel</th>
            <th scope="col">Municipio</th>
            <th scope="col">Parroquia</th>
            <th scope="col">Director</th>
            <th scope="col"><span class="sr-only">Acciones</span></th>
          </tr>
        </thead>
        <tbody>${filas}</tbody>
      </table>
    </div>
  `;

  cont.querySelectorAll("[data-ver-ficha]").forEach((btn) => {
    const plantel = planteles[Number(btn.dataset.verFicha)];
    btn.addEventListener("click", () => abrirFicha(plantel));
  });
}

async function refrescarDatos() {
  const btn = document.getElementById("btnRefrescar");
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = "Actualizando…";
  try {
    const resp = await RAC.post("/api/planteles-consulta/refrescar", {});
    mostrarToast(`Datos actualizados (${resp.total} planteles).`);
    const q = document.getElementById("qBuscar").value.trim();
    if (q.length >= 2) await buscarPlanteles(q);
    else mostrarEstadoInicial();
  } catch (err) {
    mostrarToast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = "↻  Actualizar GESCOLAR";
  }
}

// -------------------------------------------------------------------------
// Ficha completa
// -------------------------------------------------------------------------
const modalFichaFondo = document.getElementById("modalFichaFondo");

function abrirFicha(plantel) {
  document.getElementById("fichaTitulo").textContent = plantel[CAMPO_NOMBRE] || "Plantel sin nombre";
  const piezasSub = [plantel[CAMPO_CODIGO], plantel[CAMPO_MUNICIPIO], plantel[CAMPO_PARROQUIA]].filter(Boolean);
  document.getElementById("fichaSubtitulo").textContent = piezasSub.join(" · ") || "Información institucional";
  document.getElementById("fichaContenido").innerHTML = renderizarFicha(plantel);
  modalFichaFondo.classList.add("visible");
  document.body.style.overflow = "hidden";

  const codigoDea = plantel[CAMPO_CODIGO];
  if (codigoDea) cargarArchivosFicha(codigoDea);
  document.getElementById("btnCerrarFicha").focus();
}

function cerrarFicha() {
  modalFichaFondo.classList.remove("visible");
  document.body.style.overflow = "";
}

document.getElementById("btnCerrarFicha").addEventListener("click", cerrarFicha);
modalFichaFondo.addEventListener("click", (e) => {
  if (e.target === modalFichaFondo) cerrarFicha();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && modalFichaFondo.classList.contains("visible")) cerrarFicha();
});

function renderizarFicha(plantel) {
  const destacados = CAMPOS_DESTACADOS_FICHA.filter((c) => plantel[c]);
  const resto = Object.keys(plantel).filter((c) => !CAMPOS_DESTACADOS_FICHA.includes(c) && plantel[c] !== "");

  const tarjetasHtml = destacados.map((c) => `
    <div class="pc-highlight">
      <div class="pc-highlight-label">${etiquetar(c)}</div>
      <div class="pc-highlight-value">${valorFormateado(plantel[c])}</div>
    </div>
  `).join("");

  const filasHtml = resto.map((c) => `
    <div class="pc-data-item">
      <div class="pc-data-label">${etiquetar(c)}</div>
      <div class="pc-data-value">${valorFormateado(plantel[c])}</div>
    </div>
  `).join("");

  return `
    <section class="pc-section" id="fichaArchivosBox" aria-labelledby="tituloArchivos">
      <div class="pc-section-head">
        <h3 id="tituloArchivos">Documentos del plantel</h3>
        <span>Google Drive · código DEA ${escapar(plantel[CAMPO_CODIGO]) || "—"}</span>
      </div>
      <div class="pc-drive">
        <div class="pc-drive-toolbar">
          <div class="pc-drive-toolbar-left"><span class="pc-drive-count">…</span><span class="pc-muted">Consultando archivos asociados</span></div>
        </div>
        <div class="pc-drive-list"><div class="pc-loading">Buscando archivos en Drive…</div></div>
      </div>
    </section>

    ${tarjetasHtml ? `
      <section class="pc-section" aria-labelledby="tituloResumenPlantel">
        <div class="pc-section-head">
          <h3 id="tituloResumenPlantel">Resumen institucional</h3>
          <span>Información principal</span>
        </div>
        <div class="pc-highlight-grid">${tarjetasHtml}</div>
      </section>` : ""}

    ${filasHtml ? `
      <section class="pc-section" aria-labelledby="tituloDatosGescolar">
        <div class="pc-section-head">
          <h3 id="tituloDatosGescolar">Todos los datos GESCOLAR</h3>
          <span>${resto.length} campos disponibles</span>
        </div>
        <div class="pc-data-card"><div class="pc-data-grid">${filasHtml}</div></div>
      </section>` : ""}
  `;
}

// -------------------------------------------------------------------------
// Archivos de Drive
// -------------------------------------------------------------------------
async function cargarArchivosFicha(codigoDea) {
  const caja = document.getElementById("fichaArchivosBox");
  if (!caja) return;

  try {
    const resp = await RAC.get(`/api/planteles-consulta/${encodeURIComponent(codigoDea)}/archivos`);
    if (!document.getElementById("fichaArchivosBox")) return;
    dibujarArchivosFicha(codigoDea, resp);
  } catch (err) {
    const cajaActual = document.getElementById("fichaArchivosBox");
    if (!cajaActual) return;
    cajaActual.querySelector(".pc-drive").innerHTML = `
      <div class="pc-drive-list"><div class="pc-empty" style="padding:34px 20px;"><div class="pc-empty-icon" aria-hidden="true">!</div><strong>No se pudo consultar Drive</strong><span>${escapar(err.message)}</span></div></div>`;
  }
}

function dibujarArchivosFicha(codigoDea, resp) {
  const caja = document.getElementById("fichaArchivosBox");
  if (!caja) return;

  const archivos = (resp && resp.archivos) || [];
  const sinCarpeta = resp && resp.carpetaEncontrada === false;
  const drive = caja.querySelector(".pc-drive");
  if (!drive) return;

  const botonSubir = puedeRefrescar ? `
    <div class="pc-upload">
      <input type="file" id="inputSubirArchivos" multiple style="display:none;">
      <button class="btn btn-fantasma btn-sm" id="btnSubirArchivos" type="button">＋ Subir archivos</button>
      <span id="estadoSubida" class="pc-upload-status"></span>
    </div>` : "";

  let listaHtml;
  if (sinCarpeta) {
    listaHtml = `<div class="pc-empty" style="padding:34px 20px;"><div class="pc-empty-icon" aria-hidden="true">📁</div><strong>Sin carpeta en Drive</strong><span>No existe una carpeta con el código ${escapar(codigoDea)} dentro de “Planteles”${puedeRefrescar ? ". Puedes subir un archivo y la carpeta se creará automáticamente." : "."}</span></div>`;
  } else if (!archivos.length) {
    listaHtml = `<div class="pc-empty" style="padding:34px 20px;"><div class="pc-empty-icon" aria-hidden="true">📁</div><strong>Carpeta vacía</strong><span>La carpeta de este plantel existe, pero todavía no contiene archivos.</span></div>`;
  } else {
    listaHtml = `<div class="pc-drive-list">${archivos.map((a, i) => `
      <div class="pc-drive-file">
        <div class="pc-file-icon" aria-hidden="true">${iconoArchivo(a.mimeType, a.nombre)}</div>
        <div class="pc-file-info">
          <div class="pc-file-name">${escapar(a.nombre)}</div>
          <div class="pc-file-meta">${formatoTamano(a.tamano)}${a.modificado ? ` · ${formatoFecha(a.modificado)}` : ""}</div>
        </div>
        <button class="btn btn-fantasma btn-sm" type="button" data-descargar="${i}">Descargar</button>
      </div>
    `).join("")}</div>`;
  }

  drive.innerHTML = `
    <div class="pc-drive-toolbar">
      <div class="pc-drive-toolbar-left"><span class="pc-drive-count">${archivos.length}</span><span class="pc-muted">${archivos.length === 1 ? "archivo asociado" : "archivos asociados"}</span></div>
      ${botonSubir}
    </div>
    ${listaHtml}
  `;

  if (!sinCarpeta && archivos.length) {
    drive.querySelectorAll("[data-descargar]").forEach((btn) => {
      const archivo = archivos[Number(btn.dataset.descargar)];
      btn.addEventListener("click", () => descargarArchivoDrive(codigoDea, archivo, btn));
    });
  }

  if (puedeRefrescar) {
    const input = document.getElementById("inputSubirArchivos");
    const boton = document.getElementById("btnSubirArchivos");
    if (boton && input) {
      boton.addEventListener("click", () => input.click());
      input.addEventListener("change", (e) => subirArchivosDrive(codigoDea, e.target.files));
    }
  }
}

async function subirArchivosDrive(codigoDea, fileList) {
  if (!fileList || !fileList.length) return;
  const estado = document.getElementById("estadoSubida");
  const input = document.getElementById("inputSubirArchivos");
  const formData = new FormData();
  Array.from(fileList).forEach((f) => formData.append("archivos", f));

  if (estado) estado.textContent = `Subiendo ${fileList.length} archivo(s)…`;
  try {
    const resp = await fetch(`/api/planteles-consulta/${encodeURIComponent(codigoDea)}/archivos`, {
      method: "POST",
      headers: { Authorization: "Bearer " + RAC.getToken() },
      body: formData,
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => null);
      throw new Error((data && data.error) || `Error ${resp.status}`);
    }
    mostrarToast(`Subido${fileList.length === 1 ? "" : "s"} a Drive (${fileList.length}).`);
    await cargarArchivosFicha(codigoDea);
  } catch (err) {
    if (estado) estado.textContent = "";
    mostrarToast(err.message, true);
  } finally {
    if (input) input.value = "";
  }
}

async function descargarArchivoDrive(codigoDea, archivo, boton) {
  const textoOriginal = boton.textContent;
  boton.disabled = true;
  boton.textContent = "Descargando…";
  try {
    const resp = await fetch(`/api/planteles-consulta/${encodeURIComponent(codigoDea)}/archivos/${encodeURIComponent(archivo.id)}/descargar`, {
      headers: { Authorization: "Bearer " + RAC.getToken() },
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => null);
      throw new Error((data && data.error) || `Error ${resp.status}`);
    }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = archivo.nombre;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) {
    mostrarToast(err.message, true);
  } finally {
    boton.disabled = false;
    boton.textContent = textoOriginal;
  }
}

function iconoArchivo(mimeType, nombre) {
  const tipo = String(mimeType || "").toLowerCase();
  const ext = String(nombre || "").split(".").pop().toLowerCase();
  if (tipo.includes("pdf") || ext === "pdf") return "PDF";
  if (tipo.includes("spreadsheet") || ["xls", "xlsx", "csv"].includes(ext)) return "XLS";
  if (tipo.includes("document") || ["doc", "docx"].includes(ext)) return "DOC";
  if (tipo.includes("image") || ["png", "jpg", "jpeg", "webp"].includes(ext)) return "IMG";
  return "FILE";
}

function formatoTamano(bytes) {
  if (!bytes && bytes !== 0) return "Tamaño no disponible";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatoFecha(valor) {
  try {
    return new Intl.DateTimeFormat("es-VE", { dateStyle: "medium" }).format(new Date(valor));
  } catch (_) {
    return "Fecha no disponible";
  }
}

function etiquetar(clave) {
  if (clave === clave.toUpperCase() && /_/.test(clave)) return clave.replace(/_/g, " ");
  return clave.replace(/_/g, " ").replace(/\b\w/g, (letra) => letra.toUpperCase());
}

function valorFormateado(valor) {
  const texto = String(valor ?? "").trim();
  if (!texto) return "—";
  const normal = texto.toUpperCase();
  if (normal === "SI" || normal === "SÍ") return `<span class="badge badge-resuelto">Sí</span>`;
  if (normal === "NO") return `<span class="badge badge-descartado">No</span>`;
  if (normal === "#N/A") return `<span class="badge badge-pendiente">Sin dato</span>`;
  return escapar(texto);
}

function escapar(valor) {
  if (valor === undefined || valor === null) return "";
  return String(valor)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
