// Solo admin -- si alguien más entra directo por URL, se le redirige.
const usuario = renderShell("rac-completo", "Cargar RAC completo");
if (usuario && usuario.rol !== "admin") {
  document.getElementById("contenido").innerHTML = `
    <div class="vacio"><strong>No tienes permiso</strong>Solo un administrador puede cargar el RAC completo.</div>
  `;
} else if (usuario) {
  dibujar();
}
function dibujar() {
  document.getElementById("contenido").innerHTML = `
    <div class="panel" style="max-width:640px;">
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
          corte. Cuando termine toda la subida, usa el panel de abajo
          ("Revisar registros no encontrados") una sola vez para detectar
          quiénes del RAC actual no aparecieron en esta carga.
        </p>
        <form id="formRacCompleto">
          <div class="campo">
            <label for="archivo">Archivo (.csv)</label>
            <input type="file" id="archivo" accept=".csv" required>
          </div>
          <div class="campo">
            <label for="filasPorPedazo">Filas por pedazo</label>
            <input type="number" id="filasPorPedazo" value="3000" min="200" step="100">
          </div>
          <button type="submit" class="btn btn-primario" id="btnSubir">Sincronizar RAC</button>
        </form>
        <div id="progresoRacCompleto" style="margin-top:14px;"></div>
        <div id="resultadoRacCompleto" style="margin-top:18px;"></div>
      </div>
    </div>

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
  document.getElementById("formRacCompleto").addEventListener("submit", subirRacCompleto);

  // Se precarga con la hora actual como valor por defecto; el usuario debe
  // ajustarla a la hora real de justo antes de empezar a subir el primer
  // pedazo si la carga se hizo en varias partes.
  const inputDesde = document.getElementById("desde");
  const ahora = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
  inputDesde.value = ahora.toISOString().slice(0, 16);

  document.getElementById("formVerificarObsoletos").addEventListener("submit", verificarObsoletos);
}

// ---------- División del CSV en el navegador (misma lógica que partir_csv.js) ----------

// Descarta líneas vacías o que son solo separadores ";;;;;" sin ningún dato,
// para no gastar pedazos en relleno del Excel.
function esLineaVacia(linea) {
  return linea.split(";").every((c) => c.trim() === "");
}

// Divide el texto completo del CSV en un arreglo de "pedazos" (cada uno ya
// con el encabezado repetido), respetando exactamente la misma lógica que
// el script de escritorio partir_csv.js.
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

// El archivo se lee como texto en latin1 (misma codificación que ya usa el
// resto del proyecto), así que para reconstruir el Blob a subir hay que
// devolver esos mismos bytes -- no se puede usar new Blob([texto]) directo
// porque el navegador lo re-codificaría a UTF-8 y dañaría tildes/ñ.
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
  const input = document.getElementById("archivo");
  const inputFilas = document.getElementById("filasPorPedazo");
  const btn = document.getElementById("btnSubir");
  const progreso = document.getElementById("progresoRacCompleto");
  const resultado = document.getElementById("resultadoRacCompleto");
  if (!input.files.length) return;

  const confirmado = confirm(
    "Esto sincroniza el RAC completo con el contenido de este archivo (actualiza existentes, agrega nuevos y genera alertas). ¿Continuar?"
  );
  if (!confirmado) return;

  const filasPorPedazo = Math.max(parseInt(inputFilas.value, 10) || 3000, 200);
  btn.disabled = true;
  progreso.innerHTML = "";
  resultado.innerHTML = "";

  try {
    btn.textContent = "Leyendo archivo…";
    const textoCompleto = await leerArchivoComoLatin1(input.files[0]);
    const pedazos = partirCsvEnPedazos(textoCompleto, filasPorPedazo);

    if (pedazos.length === 0) {
      throw new Error("El archivo no tiene filas de datos para procesar.");
    }

    const totales = {
      insertados: 0,
      actualizados: 0,
      sinCambios: 0,
      filasConError: 0,
      lineasVaciasIgnoradas: 0,
      alertasGeneradas: 0,
    };

    for (let i = 0; i < pedazos.length; i++) {
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
      const nombrePedazo = input.files[0].name.replace(/\.csv$/i, "") + `_parte${numeroPedazo}.csv`;

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
      totales.lineasVaciasIgnoradas += data.lineasVaciasIgnoradas || 0;
      totales.alertasGeneradas += data.alertasGeneradas || 0;
    }

    progreso.innerHTML = "";
    resultado.innerHTML = `
      <div class="stat-card" style="border-color:var(--tiza-clara);">
        <div class="lbl">RAC sincronizado (${pedazos.length} parte${pedazos.length > 1 ? "s" : ""})</div>
        <div style="margin-top:6px; font-size:0.9rem; display:grid; gap:4px;">
          <div>Insertados: <strong>${totales.insertados}</strong></div>
          <div>Actualizados: <strong>${totales.actualizados}</strong></div>
          <div>Sin cambios: <strong>${totales.sinCambios}</strong></div>
          <div>Filas con error: <strong>${totales.filasConError}</strong></div>
          <div>Líneas vacías ignoradas (relleno del archivo): <strong>${totales.lineasVaciasIgnoradas}</strong></div>
          <div>Alertas generadas: <strong>${totales.alertasGeneradas}</strong></div>
        </div>
      </div>
    `;
    mostrarToast("RAC sincronizado correctamente.");
  } catch (err) {
    progreso.innerHTML = "";
    resultado.innerHTML = `<div class="error-msg visible">${err.message}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Sincronizar RAC";
    input.value = "";
  }
}

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
