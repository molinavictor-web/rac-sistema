// carga-completa.js — pantalla combinada del flujo de carga mensual completo.
//
// REDISEÑO (2026-09-13): antes "Cargar planteles", "Cargar nómina
// Ministerio" y "Cargar RAC completo" (con su panel de "Revisar registros
// no encontrados") vivían en 3 páginas separadas (planteles-carga.html,
// nomina.html, rac-completo.html), cada una con su propio enlace en el
// menú. En la práctica estos 4 pasos SIEMPRE se hacen juntos, en este
// orden, solo durante una recarga mensual completa (no son tareas del día
// a día como "Cargar por municipio") -- separarlos en 3 menús distintos no
// reflejaba cómo se usan de verdad. Se combinan aquí en una sola pantalla
// numerada (Paso 1 a 4), y el menú (nav.js) pasa a tener un solo enlace
// para las tres.
//
// La lógica de negocio de cada paso (endpoints, validaciones, mensajes) es
// EXACTAMENTE la misma que ya estaba en planteles-carga.js / nomina.js /
// rac-completo.js -- lo único que cambia es la presentación conjunta y los
// IDs de elementos que antes se repetían entre los 3 archivos (los tres
// usaban id="archivo" y id="btnSubir" para su propio formulario; en la
// misma página eso chocaría, así que cada input/botón de subida ahora
// tiene su propio ID por paso: archivoPlanteles/btnSubirPlanteles,
// archivoNomina/btnSubirNomina, archivoRacCompleto/btnSubirRacCompleto).
//
// MEJORA (2026-09-13, sugerida por Claude): el campo "Justo antes de subir
// el primer pedazo" del Paso 4 antes había que escribirlo a mano, mirando
// el reloj antes de arrancar el Paso 3 -- una fuente de error humano justo
// en el paso que más importa que salga bien (si la hora queda mal, se
// generan alertas de "obsoleto" para gente que sí se cargó). Como ahora
// los Pasos 3 y 4 viven en la misma página, al terminar con éxito el Paso 3
// se autocompleta el campo del Paso 4 con la hora REAL en que arrancó esa
// carga (capturada por el código, no recordada por el usuario). Sigue
// siendo editable por si hace falta ajustarla a mano.

// Solo admin -- si alguien más entra directo por URL, se le redirige. Los
// 4 pasos son todos exclusivos de admin, así que un solo chequeo alcanza.
const usuario = renderShell("carga-completa", "Carga completa mensual");
if (usuario && usuario.rol !== "admin") {
  document.getElementById("contenido").innerHTML = `
    <div class="vacio"><strong>No tienes permiso</strong>Solo un administrador puede hacer la carga completa mensual.</div>
  `;
} else if (usuario) {
  dibujar();
}

// ---------- Paso 3: progreso guardado + Wake Lock (igual que antes) ----------

const CLAVE_PROGRESO = "rac_completo_progreso_v1";

function guardarProgreso(estado) {
  try {
    sessionStorage.setItem(CLAVE_PROGRESO, JSON.stringify(estado));
  } catch (_) {
    // Si sessionStorage falla (modo privado, cuota llena, etc.) simplemente
    // no se podrá reanudar; no es motivo para interrumpir la carga.
  }
}
function leerProgreso() {
  try {
    const raw = sessionStorage.getItem(CLAVE_PROGRESO);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}
function borrarProgreso() {
  try {
    sessionStorage.removeItem(CLAVE_PROGRESO);
  } catch (_) {}
}

let wakeLock = null;
async function solicitarWakeLock() {
  try {
    if ("wakeLock" in navigator) {
      wakeLock = await navigator.wakeLock.request("screen");
    }
  } catch (_) {
    // No soportado o permiso denegado: se ignora silenciosamente.
  }
}
function liberarWakeLock() {
  if (wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && cargaEnCurso) {
    solicitarWakeLock();
  }
});
let cargaEnCurso = false;

// ---------- Dibujado de la pantalla completa (4 pasos) ----------

function dibujar() {
  const progresoPrevio = leerProgreso();
  document.getElementById("contenido").innerHTML = `
    <div style='font-size:1.3em; font-weight:700; margin: 28px 0 8px 0; font-family: var(--fuente-titulo, "Space Grotesk", sans-serif);'>Paso 1</div>
    <div class="panel" style="max-width:640px;">
      <div class="panel-cabecera"><h2>Actualizar catálogo de planteles</h2></div>
      <div style="padding:20px;">
        <p style="color:var(--tinta-suave); margin-top:0;">
          Sube el archivo CSV del catálogo de planteles (separado por ",",
          el mismo formato exportado desde Excel con la opción "CSV
          (delimitado por comas)"). <strong>Esta carga NO reemplaza</strong>
          el catálogo actual -- actualiza o agrega planteles por código
          de plantel, sin borrar los existentes.
        </p>
        <form id="formPlanteles">
          <div class="campo">
            <label for="archivoPlanteles">Archivo (.csv)</label>
            <input type="file" id="archivoPlanteles" accept=".csv" required>
          </div>
          <button type="submit" class="btn btn-primario" id="btnSubirPlanteles">Cargar planteles</button>
        </form>
        <div id="resultadoPlanteles" style="margin-top:18px;"></div>
      </div>
    </div>

    <div style='font-size:1.3em; font-weight:700; margin: 28px 0 8px 0; font-family: var(--fuente-titulo, "Space Grotesk", sans-serif);'>Paso 2</div>
    <div class="panel" style="max-width:640px; margin-top:20px;">
      <div class="panel-cabecera"><h2>Actualizar nómina del Ministerio</h2></div>
      <div style="padding:20px;">
        <p style="color:var(--tinta-suave); margin-top:0;">
          Sube el archivo CSV mensual (separado por ";", el mismo formato
          que exporta el Ministerio). <strong>Esta carga reemplaza por
          completo</strong> la nómina actual — es una foto del mes, no
          se acumula con la anterior. El cruce con el RAC se sigue
          haciendo únicamente por cédula.
        </p>
        <form id="formNomina">
          <div class="campo">
            <label for="archivoNomina">Archivo (.csv)</label>
            <input type="file" id="archivoNomina" accept=".csv" required>
          </div>
          <button type="submit" class="btn btn-primario" id="btnSubirNomina">Reemplazar nómina</button>
        </form>
        <div id="resultadoNomina" style="margin-top:18px;"></div>
      </div>
    </div>

    <div style='font-size:1.3em; font-weight:700; margin: 28px 0 8px 0; font-family: var(--fuente-titulo, "Space Grotesk", sans-serif);'>Paso 3</div>
    <div class="panel" style="max-width:640px; margin-top:20px;">
      <div class="panel-cabecera"><h2>Cargar la última versión completa del RAC</h2></div>
      <div style="padding:20px;">
        <p style="color:var(--tinta-suave); margin-top:0;">
          Sube el archivo CSV completo del RAC (separado por ";", el mismo
          formato que maneja la oficina central). <strong>Esta carga no
          reemplaza nada a ciegas</strong>: por cada fila, si el registro
          (cédula + plantel) ya existe se actualiza y se genera una alerta
          avisando el cambio; si no existe, se agrega como nuevo,
          validando contra la nómina del Ministerio.
        </p>
        <p style="color:var(--tinta-suave);">
          Si el archivo es grande, se divide automáticamente en pedazos y se
          suben uno por uno, para evitar que una sola carga muy larga se
          corte. Al terminar con éxito, el campo "Justo antes de subir el
          primer pedazo" del Paso 4 se completa solo con la hora real en
          que arrancó esta carga.
        </p>
        <p style="background:#fff8e1; border:1px solid #f0d98c; border-radius:8px; padding:10px 12px; font-size:0.9rem;">
          <strong>Importante:</strong> esta carga puede tardar varios minutos.
          No cambies de pestaña, no bloquees la pantalla ni dejes que la
          laptop/PC entre en reposo mientras corre — si el navegador descarta
          la pestaña, la carga se corta a mitad de camino sin avisar.
        </p>
        ${
          progresoPrevio
            ? `<div class="stat-card" style="border-color:#f0d98c; margin-bottom:14px;">
                 <div class="lbl">Carga incompleta detectada</div>
                 <div style="margin-top:6px; font-size:0.9rem;">
                   Archivo <strong>${progresoPrevio.nombreArchivo}</strong>,
                   quedó subida hasta la parte
                   <strong>${progresoPrevio.pedazoSiguiente - 1}</strong> de
                   <strong>${progresoPrevio.totalPedazos}</strong>.
                   Selecciona el mismo archivo abajo para poder reanudarla,
                   o descarta este aviso si quieres empezar de nuevo.
                 </div>
                 <button type="button" class="btn btn-fantasma btn-sm" id="btnDescartarProgreso" style="margin-top:8px;">
                   Descartar y empezar de cero
                 </button>
               </div>`
            : ""
        }
        <form id="formRacCompleto">
          <div class="campo">
            <label for="archivoRacCompleto">Archivo (.csv)</label>
            <input type="file" id="archivoRacCompleto" accept=".csv" required>
          </div>
          <div class="campo">
            <label for="filasPorPedazo">Filas por pedazo</label>
            <input type="number" id="filasPorPedazo" value="3000" min="200" step="100">
          </div>
          <button type="submit" class="btn btn-primario" id="btnSubirRacCompleto">Sincronizar RAC</button>
        </form>
        <div id="progresoRacCompleto" style="margin-top:14px;"></div>
        <div id="resultadoRacCompleto" style="margin-top:18px;"></div>
      </div>
    </div>

    <div style='font-size:1.3em; font-weight:700; margin: 28px 0 8px 0; font-family: var(--fuente-titulo, "Space Grotesk", sans-serif);'>Paso 4</div>
    <div class="panel" style="max-width:640px; margin-top:20px;">
      <div class="panel-cabecera"><h2>Revisar registros no encontrados</h2></div>
      <div style="padding:20px;">
        <p style="color:var(--tinta-suave); margin-top:0;">
          Paso manual, a correr <strong>una sola vez</strong> después de
          terminar de subir todos los pedazos de una carga completa. Genera
          una alerta para cada registro del RAC cuya última actualización sea
          anterior a la fecha/hora indicada abajo (es decir, que ningún
          pedazo subido lo tocó) — no borra nada automáticamente, solo marca
          para revisión.
        </p>
        <form id="formVerificarObsoletos">
          <div class="campo">
            <label for="desde">Justo antes de subir el primer pedazo</label>
            <input type="datetime-local" id="desde" required>
          </div>
          <button type="submit" class="btn btn-primario" id="btnVerificar">Revisar obsoletos</button>
        </form>
        <div id="resultadoObsoletos" style="margin-top:18px;"></div>
      </div>
    </div>
  `;

  document.getElementById("formPlanteles").addEventListener("submit", subirPlanteles);
  document.getElementById("formNomina").addEventListener("submit", subirNomina);
  document.getElementById("formRacCompleto").addEventListener("submit", subirRacCompleto);
  document.getElementById("formVerificarObsoletos").addEventListener("submit", verificarObsoletos);

  const btnDescartarProgreso = document.getElementById("btnDescartarProgreso");
  if (btnDescartarProgreso) {
    btnDescartarProgreso.addEventListener("click", () => {
      borrarProgreso();
      dibujar();
    });
  }

  // Valor inicial del Paso 4: la hora actual, igual que antes -- se
  // sobrescribe solo si el Paso 3 termina con éxito en esta misma carga
  // de página (ver "completarHoraInicioEnPaso4" más abajo).
  const inputDesde = document.getElementById("desde");
  const ahora = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
  inputDesde.value = ahora.toISOString().slice(0, 16);
}

// Convierte un ISO string (UTC) al formato que espera un <input type="datetime-local">,
// en hora LOCAL del navegador -- misma conversión que ya se usaba para el valor
// por defecto "ahora".
function completarHoraInicioEnPaso4(isoStringUtc) {
  const inputDesde = document.getElementById("desde");
  if (!inputDesde) return;
  const fecha = new Date(isoStringUtc);
  const local = new Date(fecha.getTime() - fecha.getTimezoneOffset() * 60000);
  inputDesde.value = local.toISOString().slice(0, 16);
}

// ---------- Paso 1: Cargar planteles (misma lógica que planteles-carga.js) ----------

async function subirPlanteles(e) {
  e.preventDefault();
  const input = document.getElementById("archivoPlanteles");
  const btn = document.getElementById("btnSubirPlanteles");
  const resultado = document.getElementById("resultadoPlanteles");
  if (!input.files.length) return;

  const datos = new FormData();
  datos.append("archivo", input.files[0]);

  btn.disabled = true;
  btn.textContent = "Subiendo y procesando…";
  resultado.innerHTML = "";

  try {
    const resp = await fetch("/api/planteles/cargar-masiva", {
      method: "POST",
      headers: { Authorization: "Bearer " + RAC.getToken() },
      body: datos,
    });
    const data = await resp.json().catch(() => null);
    if (!resp.ok) throw new Error((data && data.error) || `Error ${resp.status}`);

    let detalleErrores = "";
    if (data.errores && data.errores.length > 0) {
      const items = data.errores
        .map(err => `<li>Línea ${err.linea}${err.codigo_plantel ? " (" + err.codigo_plantel + ")" : ""}: ${err.motivo}</li>`)
        .join("");
      detalleErrores = `
        <div style="margin-top:10px; font-size:0.85rem; color:var(--tinta-suave);">
          <strong>Detalle de errores (máx. 50 de ${data.filasConError}):</strong>
          <ul>${items}</ul>
        </div>
      `;
    }

    resultado.innerHTML = `
      <div class="stat-card" style="border-color:var(--tiza-clara);">
        <div class="lbl">Carga completada</div>
        <div style="margin-top:6px; font-size:0.9rem;">
          Insertados: <strong>${data.insertados}</strong> ·
          Actualizados: <strong>${data.actualizados}</strong> ·
          Filas con error: <strong>${data.filasConError}</strong> ·
          Líneas vacías ignoradas: <strong>${data.lineasVaciasIgnoradas}</strong>
        </div>
      </div>
      ${detalleErrores}
    `;
    mostrarToast("Catálogo de planteles actualizado.");
  } catch (err) {
    resultado.innerHTML = `<div class="error-msg visible">${err.message}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Cargar planteles";
    input.value = "";
  }
}

// ---------- Paso 2: Cargar nómina del Ministerio (misma lógica que nomina.js) ----------

async function subirNomina(e) {
  e.preventDefault();
  const input = document.getElementById("archivoNomina");
  const btn = document.getElementById("btnSubirNomina");
  const resultado = document.getElementById("resultadoNomina");
  if (!input.files.length) return;

  const confirmado = confirm(
    "Esto reemplaza TODA la nómina actual del Ministerio con el contenido de este archivo. ¿Continuar?"
  );
  if (!confirmado) return;

  const datos = new FormData();
  datos.append("archivo", input.files[0]);

  btn.disabled = true;
  btn.textContent = "Subiendo y procesando… puede tardar varios minutos";
  resultado.innerHTML = "";

  try {
    const resp = await fetch("/api/personal-ministerio/cargar", {
      method: "POST",
      headers: { Authorization: "Bearer " + RAC.getToken() },
      body: datos,
    });
    const data = await resp.json().catch(() => null);
    if (!resp.ok) throw new Error((data && data.error) || `Error ${resp.status}`);

    resultado.innerHTML = `
      <div class="stat-card" style="border-color:var(--tiza-clara);">
        <div class="lbl">Nómina actualizada</div>
        <div style="margin-top:6px; font-size:0.9rem;">
          Registros cargados: <strong>${data.registros_cargados}</strong>
        </div>
      </div>
    `;
    mostrarToast("Nómina del Ministerio actualizada.");
  } catch (err) {
    resultado.innerHTML = `<div class="error-msg visible">${err.message}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Reemplazar nómina";
    input.value = "";
  }
}

// ---------- Paso 3: Cargar RAC completo (misma lógica que rac-completo.js) ----------

function esLineaVacia(linea) {
  return linea.split(";").every((c) => c.trim() === "");
}

function partirCsvEnPedazos(textoCompleto, filasPorPedazo) {
  const lineas = textoCompleto.split(/\r\n|\r|\n/);
  const encabezado = lineas[0];
  const filasDeDatos = lineas.slice(1).filter((l) => l.trim() !== "" && !esLineaVacia(l));

  const pedazos = [];
  for (let i = 0; i < filasDeDatos.length; i += filasPorPedazo) {
    const trozo = filasDeDatos.slice(i, i + filasPorPedazo);
    pedazos.push([encabezado, ...trozo].join("\r\n"));
  }
  return pedazos;
}

function textoLatin1ABytes(texto) {
  const bytes = new Uint8Array(texto.length);
  for (let i = 0; i < texto.length; i++) {
    bytes[i] = texto.charCodeAt(i) & 0xff;
  }
  return bytes;
}

function leerArchivoComoLatin1(archivo) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(lector.result);
    lector.onerror = () => reject(new Error("No se pudo leer el archivo."));
    lector.readAsText(archivo, "ISO-8859-1");
  });
}

async function subirRacCompleto(e) {
  e.preventDefault();
  const input = document.getElementById("archivoRacCompleto");
  const inputFilas = document.getElementById("filasPorPedazo");
  const btn = document.getElementById("btnSubirRacCompleto");
  const progreso = document.getElementById("progresoRacCompleto");
  const resultado = document.getElementById("resultadoRacCompleto");
  if (!input.files.length) return;

  const archivo = input.files[0];
  const filasPorPedazo = Math.max(parseInt(inputFilas.value, 10) || 3000, 200);

  let pedazoInicial = 1;
  let totales = {
    insertados: 0,
    actualizados: 0,
    sinCambios: 0,
    filasConError: 0,
    duplicadosEnArchivo: 0,
    lineasVaciasIgnoradas: 0,
    alertasGeneradas: 0,
  };
  // MEJORA (2026-09-13): hora real de inicio de esta carga -- ver comentario
  // arriba de completarHoraInicioEnPaso4. Si se reanuda una carga incompleta,
  // se conserva la hora de inicio ORIGINAL (guardada junto al progreso), no
  // la de este reintento -- esa es la hora que de verdad importa para el
  // Paso 4 (justo antes de subir el PRIMER pedazo de toda la carga).
  let horaInicioCarga = new Date().toISOString();

  const progresoPrevio = leerProgreso();
  if (
    progresoPrevio &&
    progresoPrevio.nombreArchivo === archivo.name &&
    progresoPrevio.tamanioArchivo === archivo.size &&
    progresoPrevio.filasPorPedazo === filasPorPedazo
  ) {
    const reanudar = confirm(
      `Se detectó una carga incompleta de este mismo archivo, subida hasta la parte ${progresoPrevio.pedazoSiguiente - 1} de ${progresoPrevio.totalPedazos}.\n\nAceptar = reanudar desde ahí.\nCancelar = empezar de nuevo desde cero (se perderá el conteo previo, aunque los datos ya insertados no se duplican).`
    );
    if (reanudar) {
      pedazoInicial = progresoPrevio.pedazoSiguiente;
      totales = progresoPrevio.totales;
      horaInicioCarga = progresoPrevio.horaInicio || horaInicioCarga;
    } else {
      borrarProgreso();
    }
  } else if (progresoPrevio) {
    const descartar = confirm(
      `Hay una carga incompleta guardada de otro archivo (${progresoPrevio.nombreArchivo}). Si continúas con este archivo, se descartará ese progreso guardado. ¿Continuar?`
    );
    if (!descartar) return;
    borrarProgreso();
  } else {
    const confirmado = confirm(
      "Esto sincroniza el RAC completo con el contenido de este archivo (actualiza existentes, agrega nuevos y genera alertas). ¿Continuar?"
    );
    if (!confirmado) return;
  }

  btn.disabled = true;
  progreso.innerHTML = "";
  resultado.innerHTML = "";
  cargaEnCurso = true;
  await solicitarWakeLock();

  try {
    btn.textContent = "Leyendo archivo…";
    const textoCompleto = await leerArchivoComoLatin1(archivo);
    const pedazos = partirCsvEnPedazos(textoCompleto, filasPorPedazo);

    if (pedazos.length === 0) {
      throw new Error("El archivo no tiene filas de datos para procesar.");
    }
    if (pedazoInicial > pedazos.length) {
      throw new Error("El progreso guardado no coincide con este archivo (ya se habían subido todas las partes). Se descarta.");
    }

    for (let i = pedazoInicial - 1; i < pedazos.length; i++) {
      const numeroPedazo = i + 1;
      btn.textContent = `Subiendo parte ${numeroPedazo} de ${pedazos.length}…`;
      progreso.innerHTML = `
        <div class="stat-card" style="border-color:var(--tiza-clara);">
          <div class="lbl">Progreso</div>
          <div style="margin-top:6px; font-size:0.9rem;">
            Subiendo parte <strong>${numeroPedazo}</strong> de <strong>${pedazos.length}</strong>…
          </div>
        </div>
      `;

      const bytes = textoLatin1ABytes(pedazos[i]);
      const blob = new Blob([bytes], { type: "text/csv" });
      const nombrePedazo = archivo.name.replace(/\.csv$/i, "") + `_parte${numeroPedazo}.csv`;

      const datos = new FormData();
      datos.append("archivo", blob, nombrePedazo);

      const resp = await fetch("/api/rac/cargar-completo", {
        method: "POST",
        headers: { Authorization: "Bearer " + RAC.getToken() },
        body: datos,
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok) {
        throw new Error(
          `Falló en la parte ${numeroPedazo} de ${pedazos.length}: ${(data && data.error) || `Error ${resp.status}`}`
        );
      }

      totales.insertados += data.insertados || 0;
      totales.actualizados += data.actualizados || 0;
      totales.sinCambios += data.sinCambios || 0;
      totales.filasConError += data.filasConError || 0;
      totales.duplicadosEnArchivo += data.duplicadosEnArchivo || 0;
      totales.lineasVaciasIgnoradas += data.lineasVaciasIgnoradas || 0;
      totales.alertasGeneradas += data.alertasGeneradas || 0;

      guardarProgreso({
        nombreArchivo: archivo.name,
        tamanioArchivo: archivo.size,
        filasPorPedazo,
        pedazoSiguiente: numeroPedazo + 1,
        totalPedazos: pedazos.length,
        totales,
        horaInicio: horaInicioCarga,
      });
    }

    borrarProgreso();
    progreso.innerHTML = "";
    resultado.innerHTML = `
      <div class="stat-card" style="border-color:var(--tiza-clara);">
        <div class="lbl">RAC sincronizado (${pedazos.length} parte${pedazos.length > 1 ? "s" : ""})</div>
        <div style="margin-top:6px; font-size:0.9rem; display:grid; gap:4px;">
          <div>Insertados: <strong>${totales.insertados}</strong></div>
          <div>Actualizados: <strong>${totales.actualizados}</strong></div>
          <div>Sin cambios: <strong>${totales.sinCambios}</strong></div>
          <div>Filas con error: <strong>${totales.filasConError}</strong></div>
          <div>Nombramientos duplicados en el archivo: <strong>${totales.duplicadosEnArchivo}</strong></div>
          <div>Líneas vacías ignoradas (relleno del archivo): <strong>${totales.lineasVaciasIgnoradas}</strong></div>
          <div>Alertas generadas: <strong>${totales.alertasGeneradas}</strong></div>
        </div>
      </div>
    `;
    // MEJORA (2026-09-13): autocompleta el Paso 4 con la hora real de
    // inicio de ESTA carga -- ya no hay que recordarla ni escribirla a mano.
    completarHoraInicioEnPaso4(horaInicioCarga);
    mostrarToast("RAC sincronizado correctamente.");
  } catch (err) {
    progreso.innerHTML = "";
    resultado.innerHTML = `<div class="error-msg visible">${err.message}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Sincronizar RAC";
    input.value = "";
    cargaEnCurso = false;
    liberarWakeLock();
  }
}

// ---------- Paso 4: Revisar registros no encontrados (misma lógica que rac-completo.js) ----------

async function verificarObsoletos(e) {
  e.preventDefault();
  const inputDesde = document.getElementById("desde");
  const btn = document.getElementById("btnVerificar");
  const resultado = document.getElementById("resultadoObsoletos");
  if (!inputDesde.value) return;
  const confirmado = confirm(
    "Esto genera una alerta para todo registro del RAC no tocado desde la fecha indicada. Úsalo solo después de terminar de subir TODOS los pedazos. ¿Continuar?"
  );
  if (!confirmado) return;
  btn.disabled = true;
  btn.textContent = "Revisando…";
  resultado.innerHTML = "";
  try {
    const resp = await fetch("/api/rac/verificar-obsoletos", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + RAC.getToken(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ desde: new Date(inputDesde.value).toISOString() }),
    });
    const data = await resp.json().catch(() => null);
    if (!resp.ok) throw new Error((data && data.error) || `Error ${resp.status}`);
    resultado.innerHTML = `
      <div class="stat-card" style="border-color:var(--tiza-clara);">
        <div class="lbl">Revisión completada</div>
        <div style="margin-top:6px; font-size:0.9rem;">
          Alertas generadas: <strong>${data.alertasGeneradas}</strong>
        </div>
      </div>
    `;
    mostrarToast("Revisión de obsoletos completada.");
  } catch (err) {
    resultado.innerHTML = `<div class="error-msg visible">${err.message}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Revisar obsoletos";
  }
}
