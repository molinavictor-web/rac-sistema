// planteles-consulta.js — pantalla de consulta de la hoja GESCOLAR (Google Sheets).
// Solo lectura: busca en /api/planteles-consulta/buscar y muestra la ficha
// completa de un plantel en un modal a pantalla completa (son 55 columnas),
// incluyendo los archivos disponibles en Drive para ese código DEA.

const usuario = renderShell("planteles-consulta", "Consultar planteles");

// Campos "confirmados" (coinciden EXACTO con CAMPOS_BUSQUEDA del backend) --
// se usan para las columnas fijas de la tabla y el encabezado de la ficha.
// El resto de las columnas de GESCOLAR se muestran igual, pero de forma
// genérica (ver renderizarFicha), porque su nombre exacto en la hoja puede
// variar y no vale la pena arriesgarse a que un campo real no se muestre
// por una diferencia de mayúsculas/guion bajo.
const CAMPO_CODIGO = "cod_plantel";
const CAMPO_NOMBRE = "nombre_plantel";
const CAMPO_MUNICIPIO = "municipio";
const CAMPO_PARROQUIA = "parroquia";
const CAMPO_DIRECTOR = "director_nombre";
const CAMPO_TEL_DIRECTOR = "telefono_director";
const CAMPO_TEL_MOVIL_DIRECTOR = "telefono_movil_director";

// Columnas de la tabla de resultados de la búsqueda (no lleva teléfonos --
// se quedaría muy ancha).
const CAMPOS_TABLA = [CAMPO_CODIGO, CAMPO_NOMBRE, CAMPO_MUNICIPIO, CAMPO_PARROQUIA, CAMPO_DIRECTOR];

// Tarjetas destacadas arriba de la ficha (sí incluye los teléfonos, para
// tenerlos a la vista sin bajar a buscarlos en "Todos los datos").
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
    <div class="panel">
      <div class="panel-cabecera">
        <div>
          <h2>Consultar planteles (GESCOLAR)</h2>
          <p class="panel-subtitulo">Datos importados de la hoja GESCOLAR en Google Sheets · solo lectura</p>
        </div>
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          ${puedeRefrescar ? `<button class="btn btn-fantasma btn-sm" id="btnRefrescar">Actualizar desde Sheets</button>` : ""}
          ${usuario && usuario.rol === "admin" ? `<button class="btn btn-fantasma btn-sm" id="btnReconectarDrive">Reconectar Google Drive</button>` : ""}
        </div>
      </div>
      <div style="padding: 16px 20px 0;">
        <div class="filtros">
          <input type="text" id="qBuscar" placeholder="Buscar por nombre, código, municipio, parroquia, circuito, consejo comunal o director..." style="flex:1; min-width:280px;">
        </div>
      </div>
      <div id="resumenBusqueda" style="padding: 10px 20px 0; color: var(--muted); font-size: .8rem;"></div>
      <div id="tablaPlanteles" style="margin-top:12px;"></div>
    </div>
  `;

  const input = document.getElementById("qBuscar");
  input.addEventListener("input", () => {
    clearTimeout(temporizadorBusqueda);
    temporizadorBusqueda = setTimeout(() => buscarPlanteles(input.value.trim()), 380);
  });

  if (puedeRefrescar) {
    document.getElementById("btnRefrescar").addEventListener("click", refrescarDatos);
  }
  if (usuario && usuario.rol === "admin") {
    document.getElementById("btnReconectarDrive").addEventListener("click", reconectarDrive);
  }

  mostrarEstadoInicial();
}

function mostrarEstadoInicial() {
  document.getElementById("resumenBusqueda").textContent = "";
  document.getElementById("tablaPlanteles").innerHTML = `
    <div class="vacio">
      <strong>Escribe para buscar</strong>
      Mínimo 2 caracteres — busca por nombre del plantel, código, municipio, parroquia, circuito comunal, consejo comunal o director.
    </div>`;
}

async function buscarPlanteles(q) {
  const resumen = document.getElementById("resumenBusqueda");
  const tabla = document.getElementById("tablaPlanteles");

  if (!q) return mostrarEstadoInicial();
  if (q.length < 2) {
    resumen.textContent = "";
    tabla.innerHTML = `<div class="vacio"><strong>Escribe al menos 2 caracteres</strong>para empezar la búsqueda.</div>`;
    return;
  }

  tabla.innerHTML = `<div class="cargando">Buscando…</div>`;
  try {
    const resp = await RAC.get(`/api/planteles-consulta/buscar?q=${encodeURIComponent(q)}`);
    ultimosResultados = RAC.lista(resp, "planteles");
    resumen.textContent = resp && typeof resp.total === "number"
      ? `${resp.total} resultado${resp.total === 1 ? "" : "s"}${resp.limitado ? " · mostrando los primeros 200" : ""}`
      : "";
    dibujarTabla(ultimosResultados);
  } catch (err) {
    resumen.textContent = "";
    tabla.innerHTML = `<div class="vacio"><strong>No se pudo buscar</strong>${err.message}</div>`;
  }
}

function dibujarTabla(planteles) {
  const cont = document.getElementById("tablaPlanteles");
  if (!planteles.length) {
    cont.innerHTML = `<div class="vacio"><strong>Sin resultados</strong>Prueba con otro nombre, código o municipio.</div>`;
    return;
  }

  const filas = planteles.map((p, i) => `
    <tr>
      <td><span class="cod">${escapar(p[CAMPO_CODIGO]) || "—"}</span></td>
      <td>${escapar(p[CAMPO_NOMBRE]) || "—"}</td>
      <td>${escapar(p[CAMPO_MUNICIPIO]) || "—"}</td>
      <td>${escapar(p[CAMPO_PARROQUIA]) || "—"}</td>
      <td>${escapar(p[CAMPO_DIRECTOR]) || "—"}</td>
      <td><button class="btn btn-fantasma btn-sm" data-ver-ficha="${i}">Ver ficha</button></td>
    </tr>
  `).join("");

  cont.innerHTML = `
    <table>
      <thead><tr><th>Código</th><th>Plantel</th><th>Municipio</th><th>Parroquia</th><th>Director</th><th></th></tr></thead>
      <tbody>${filas}</tbody>
    </table>
  `;

  cont.querySelectorAll("[data-ver-ficha]").forEach((btn) => {
    const plantel = planteles[Number(btn.dataset.verFicha)];
    btn.addEventListener("click", () => abrirFicha(plantel));
  });
}

// Abre en una pestaña nueva la pantalla de Google para dar permiso de
// Drive de nuevo (necesario cada ~7 días mientras la app de Google Cloud
// siga en modo "Prueba"). El token nuevo lo guarda el backend solo.
async function reconectarDrive() {
  try {
    const resp = await RAC.get("/api/planteles-consulta/drive-oauth/iniciar");
    window.open(resp.url, "_blank");
  } catch (err) {
    mostrarToast(err.message, true);
  }
}

async function refrescarDatos() {
  const btn = document.getElementById("btnRefrescar");
  btn.disabled = true;
  btn.textContent = "Actualizando…";
  try {
    const resp = await RAC.post("/api/planteles-consulta/refrescar", {});
    mostrarToast(`Datos actualizados (${resp.total} planteles).`);
    const q = document.getElementById("qBuscar").value.trim();
    if (q.length >= 2) buscarPlanteles(q);
  } catch (err) {
    mostrarToast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = "Actualizar desde Sheets";
  }
}

// ---- Ficha completa (modal a pantalla completa) ----
const modalFichaFondo = document.getElementById("modalFichaFondo");

function abrirFicha(plantel) {
  document.getElementById("fichaTitulo").textContent = plantel[CAMPO_NOMBRE] || "Plantel sin nombre";
  const piezasSub = [plantel[CAMPO_CODIGO], plantel[CAMPO_MUNICIPIO], plantel[CAMPO_PARROQUIA]].filter(Boolean);
  document.getElementById("fichaSubtitulo").textContent = piezasSub.join(" · ");
  document.getElementById("fichaContenido").innerHTML = renderizarFicha(plantel);
  modalFichaFondo.classList.add("visible");
  document.body.style.overflow = "hidden";

  const codigoDea = plantel[CAMPO_CODIGO];
  if (codigoDea) {
    cargarArchivosFicha(codigoDea); // esta también busca la foto de fachada, ver dibujarArchivosFicha
    cargarUbicacionFicha(codigoDea);
  }
}

function cerrarFicha() {
  modalFichaFondo.classList.remove("visible");
  document.body.style.overflow = "";
}

document.getElementById("btnCerrarFicha").addEventListener("click", cerrarFicha);
modalFichaFondo.addEventListener("click", (e) => {
  if (e.target === modalFichaFondo) cerrarFicha();
});

// Recorre TODAS las columnas que vinieron de GESCOLAR (no solo las
// "confirmadas") para que la ficha nunca se quede corta si la hoja trae
// columnas con nombres que aquí no se conocen exacto. Los campos destacados
// van primero, en tarjetas; el resto se agrupa como una cuadrícula
// etiqueta/valor, en el mismo orden en que vienen en la hoja. La sección de
// archivos de Drive arranca vacía (con "Buscando…") y se llena aparte, en
// cargarArchivosFicha, para no bloquear la apertura de la ficha.
function renderizarFicha(plantel) {
  const destacados = CAMPOS_DESTACADOS_FICHA.filter((c) => plantel[c]);
  const resto = Object.keys(plantel).filter((c) => !CAMPOS_DESTACADOS_FICHA.includes(c) && plantel[c] !== "");

  const tarjetasHtml = destacados.map((c) => `
    <div class="stat-card" style="min-height:auto; padding:13px 15px;">
      <h3 style="margin-bottom:6px;">${etiquetar(c)}</h3>
      <div style="font-size:.95rem; font-weight:600; color:var(--navy-900);">${valorFormateado(plantel[c])}</div>
    </div>
  `).join("");

  // El resto de los campos se acomoda en 3 columnas (una sola no se
  // aprovechaba el ancho de la pantalla y obligaba a bajar demasiado).
  const filasHtml = resto.map((c) => `
    <div>
      <div style="font-size:.66rem; text-transform:uppercase; letter-spacing:.05em; color:#718096; margin-bottom:3px;">${etiquetar(c)}</div>
      <div style="font-size:.85rem; color:var(--text);">${valorFormateado(plantel[c])}</div>
    </div>
  `).join("");

  return `
    <div class="ficha-encabezado-visual">
      <div id="fichaFotoBox" class="ficha-visual-caja">
        <div class="cargando">Buscando foto…</div>
      </div>
      <div id="fichaMapaBox" class="ficha-visual-caja">
        <div class="cargando">Buscando ubicación…</div>
      </div>
    </div>
    <div id="fichaArchivosBox" style="margin-bottom:22px;">
      <h3 style="margin-bottom:8px;">Archivos disponibles (Drive)</h3>
      <div class="cargando">Buscando archivos…</div>
    </div>
    ${tarjetasHtml ? `<div class="stats-grid" style="grid-template-columns:repeat(auto-fill,minmax(190px,1fr)); margin-bottom:22px;">${tarjetasHtml}</div>` : ""}
    ${filasHtml
      ? `<h3 style="margin-bottom:8px;">Todos los datos (GESCOLAR)</h3>
         <div class="panel" style="box-shadow:none;">
           <div class="ficha-datos-grid">${filasHtml}</div>
         </div>`
      : ""}
  `;
}

// ---- Foto de fachada + ubicación (arriba de la ficha) ----

// Tipos de imagen que cuentan como "foto de fachada" al buscar entre los
// archivos de Drive de este plantel.
const MIME_IMAGENES = ["image/jpeg", "image/png", "image/webp", "image/heic"];

async function mostrarFotoFachada(codigoDea, archivos) {
  const caja = document.getElementById("fichaFotoBox");
  if (!caja) return;

  // Prioriza el archivo con nombre fijo FACHADA_<código>; si el plantel
  // todavía no tiene uno (fotos subidas antes de este botón, por ejemplo),
  // cae a la primera imagen que encuentre en la carpeta.
  const foto = (archivos || []).find((a) => /^FACHADA_/i.test(a.nombre) && MIME_IMAGENES.includes(a.mimeType))
    || (archivos || []).find((a) => MIME_IMAGENES.includes(a.mimeType));

  const botonSubir = puedeRefrescar ? `
    <input type="file" id="inputFotoFachada" accept="image/jpeg,image/png,image/webp,image/heic" style="display:none;">
    <button class="btn btn-fantasma btn-sm" id="btnFotoFachada" style="position:absolute; ${foto ? "bottom:8px; right:8px;" : ""}">${foto ? "Cambiar foto" : "Subir foto de fachada"}</button>
  ` : "";

  if (!foto) {
    caja.innerHTML = `<div style="position:relative; height:100%; display:flex; flex-direction:column; justify-content:center; align-items:center; text-align:center; padding:12px; color:var(--muted); font-size:.82rem;">
      <div style="margin-bottom:10px;">Sin foto todavía</div>
      ${botonSubir}
    </div>`;
    engancharBotonFotoFachada(codigoDea);
    return;
  }

  try {
    const resp = await fetch(`/api/planteles-consulta/${encodeURIComponent(codigoDea)}/archivos/${encodeURIComponent(foto.id)}/descargar`, {
      headers: { Authorization: "Bearer " + RAC.getToken() },
    });
    if (!resp.ok) throw new Error("No se pudo cargar la foto");
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    caja.innerHTML = `
      <div style="position:relative; height:100%;">
        <img src="${url}" alt="Fachada del plantel" style="width:100%; height:100%; object-fit:cover; border-radius:10px;">
        ${foto.modificado ? `<span style="position:absolute; bottom:8px; left:8px; background:rgba(0,0,0,.6); color:#fff; font-size:.7rem; padding:3px 8px; border-radius:6px;">${fechaRelativa(foto.modificado)}</span>` : ""}
        ${botonSubir}
      </div>`;
    engancharBotonFotoFachada(codigoDea);
  } catch (err) {
    caja.innerHTML = `<div class="vacio"><strong>No se pudo cargar la foto</strong>${escapar(err.message)}</div>`;
  }
}

function engancharBotonFotoFachada(codigoDea) {
  const btn = document.getElementById("btnFotoFachada");
  const input = document.getElementById("inputFotoFachada");
  if (!btn || !input) return;
  btn.addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    if (input.files && input.files[0]) subirFotoFachada(codigoDea, input.files[0]);
  });
}

async function subirFotoFachada(codigoDea, archivo) {
  const caja = document.getElementById("fichaFotoBox");
  if (caja) caja.innerHTML = `<div class="cargando" style="height:100%; display:flex; align-items:center; justify-content:center;">Subiendo foto…</div>`;

  const formData = new FormData();
  formData.append("foto", archivo);
  try {
    const resp = await fetch(`/api/planteles-consulta/${encodeURIComponent(codigoDea)}/foto-fachada`, {
      method: "POST",
      headers: { Authorization: "Bearer " + RAC.getToken() },
      body: formData,
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => null);
      throw new Error((data && data.error) || `Error ${resp.status}`);
    }
    mostrarToast("Foto de fachada actualizada.");
    cargarArchivosFicha(codigoDea); // refresca la lista Y vuelve a llamar mostrarFotoFachada
  } catch (err) {
    mostrarToast(err.message, true);
    cargarArchivosFicha(codigoDea); // restaura la foto/lista anterior
  }
}

// "hace X" a partir de una fecha ISO (la que devuelve Drive en modifiedTime).
function fechaRelativa(fechaISO) {
  const diffMs = Date.now() - new Date(fechaISO).getTime();
  const dias = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (dias < 1) return "Actualizada hoy";
  if (dias === 1) return "Actualizada ayer";
  if (dias < 30) return `Actualizada hace ${dias} días`;
  const meses = Math.floor(dias / 30);
  if (meses < 12) return `Actualizada hace ${meses} mes${meses === 1 ? "" : "es"}`;
  const anios = Math.floor(meses / 12);
  return `Actualizada hace ${anios} año${anios === 1 ? "" : "s"}`;
}

async function cargarUbicacionFicha(codigoDea) {
  const caja = document.getElementById("fichaMapaBox");
  if (!caja) return;

  try {
    const resp = await RAC.get(`/api/planteles-consulta/${encodeURIComponent(codigoDea)}/coordenadas`);
    if (!document.getElementById("fichaMapaBox")) return; // la ficha pudo cerrarse
    if (!resp || !resp.encontrado) {
      caja.innerHTML = `<div class="vacio" style="height:100%; display:flex; flex-direction:column; justify-content:center;"><strong>Sin coordenadas todavía</strong>Se cargan desde el bot de WhatsApp (comando "foto").</div>`;
      return;
    }
    const { latitud, longitud } = resp;
    caja.innerHTML = `
      <iframe
        src="https://www.google.com/maps?q=${encodeURIComponent(latitud)},${encodeURIComponent(longitud)}&output=embed"
        style="width:100%; height:100%; border:0; border-radius:10px;"
        loading="lazy" referrerpolicy="no-referrer-when-downgrade">
      </iframe>`;
  } catch (err) {
    caja.innerHTML = `<div class="vacio"><strong>No se pudo cargar la ubicación</strong>${escapar(err.message)}</div>`;
  }
}

// ---- Archivos de Drive para el código DEA de la ficha abierta ----

async function cargarArchivosFicha(codigoDea) {
  const caja = document.getElementById("fichaArchivosBox");
  if (!caja) return; // la ficha pudo cerrarse antes de que responda el servidor

  try {
    const resp = await RAC.get(`/api/planteles-consulta/${encodeURIComponent(codigoDea)}/archivos`);
    // Si el usuario ya cerró esta ficha o abrió otra, no pisar contenido ajeno.
    if (!document.getElementById("fichaArchivosBox")) return;
    dibujarArchivosFicha(codigoDea, resp);
    mostrarFotoFachada(codigoDea, resp && resp.archivos);
  } catch (err) {
    const cajaActual = document.getElementById("fichaArchivosBox");
    if (!cajaActual) return;
    cajaActual.innerHTML = `
      <h3 style="margin-bottom:8px;">Archivos disponibles (Drive)</h3>
      <div class="vacio"><strong>No se pudo consultar Drive</strong>${escapar(err.message)}</div>
    `;
  }
}

function dibujarArchivosFicha(codigoDea, resp) {
  const caja = document.getElementById("fichaArchivosBox");
  if (!caja) return;

  const archivos = (resp && resp.archivos) || [];
  const sinCarpeta = resp && resp.carpetaEncontrada === false;

  const botonSubir = puedeRefrescar ? `
    <div style="margin-bottom:10px; display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
      <input type="file" id="inputSubirArchivos" multiple style="display:none;">
      <button class="btn btn-fantasma btn-sm" id="btnSubirArchivos">+ Subir archivos</button>
      <span id="estadoSubida" style="font-size:.78rem; color:var(--muted);"></span>
    </div>` : "";

  let listaHtml;
  if (sinCarpeta) {
    listaHtml = `<div class="vacio"><strong>Sin carpeta en Drive</strong>No existe una carpeta con el código ${escapar(codigoDea)} dentro de "Planteles"${puedeRefrescar ? " todavía — sube un archivo y se crea sola." : "."}</div>`;
  } else if (!archivos.length) {
    listaHtml = `<div class="vacio"><strong>Carpeta vacía</strong>La carpeta de este plantel en Drive no tiene archivos todavía.</div>`;
  } else {
    listaHtml = `<div>${archivos.map((a, i) => `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px 14px; border:1px solid var(--border); border-radius:10px; margin-bottom:8px;">
        <div style="min-width:0;">
          <div style="font-size:.86rem; font-weight:600; color:var(--navy-900); overflow-wrap:anywhere;">${escapar(a.nombre)}</div>
          <div style="font-size:.72rem; color:var(--muted);">${formatoTamano(a.tamano)}</div>
        </div>
        <button class="btn btn-fantasma btn-sm" data-descargar="${i}" style="flex:0 0 auto;">Descargar</button>
      </div>
    `).join("")}</div>`;
  }

  caja.innerHTML = `<h3 style="margin-bottom:8px;">Archivos disponibles (Drive)</h3>${botonSubir}${listaHtml}`;

  if (!sinCarpeta && archivos.length) {
    caja.querySelectorAll("[data-descargar]").forEach((btn) => {
      const archivo = archivos[Number(btn.dataset.descargar)];
      btn.addEventListener("click", () => descargarArchivoDrive(codigoDea, archivo, btn));
    });
  }

  if (puedeRefrescar) {
    document.getElementById("btnSubirArchivos").addEventListener("click", () => document.getElementById("inputSubirArchivos").click());
    document.getElementById("inputSubirArchivos").addEventListener("change", (e) => subirArchivosDrive(codigoDea, e.target.files));
  }
}

// Sube (multipart/form-data) uno o varios archivos a la carpeta del código
// DEA -- el backend la crea sola si todavía no existe. Al terminar, refresca
// la lista de archivos de la ficha.
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
    cargarArchivosFicha(codigoDea);
  } catch (err) {
    if (estado) estado.textContent = "";
    mostrarToast(err.message, true);
  } finally {
    if (input) input.value = "";
  }
}

// Descarga binaria: no se puede usar un <a href> simple porque la sesión va
// por header Authorization (Bearer), no por cookie -- se trae como blob y se
// fuerza la descarga con un enlace temporal (mismo patrón que credenciales.js).
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
    URL.revokeObjectURL(url);
  } catch (err) {
    mostrarToast(err.message, true);
  } finally {
    boton.disabled = false;
    boton.textContent = textoOriginal;
  }
}

function formatoTamano(bytes) {
  if (!bytes && bytes !== 0) return "Tamaño no disponible";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Convierte una llave de columna (ej. "NOMB_CIRCUITO", "director_correo") en
// una etiqueta legible ("Nomb circuito" → se deja tal cual si ya está en
// mayúsculas por ser sigla/código de hoja; si es snake_case normal, la
// capitaliza palabra por palabra).
function etiquetar(clave) {
  if (clave === clave.toUpperCase() && /_/.test(clave)) {
    return clave.replace(/_/g, " ");
  }
  return clave
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letra) => letra.toUpperCase());
}

// Valores tipo SI/NO/#N/A (banderas de documentos: fotos, informe, etc.) se
// muestran como badge en vez de texto plano.
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
    .replace(/>/g, "&gt;");
}
