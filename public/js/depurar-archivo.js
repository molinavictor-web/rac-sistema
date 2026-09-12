// Solo admin -- mismo patrón de protección que rac-completo.js.
const usuario = renderShell("depurar-archivo", "Depurar archivo");
if (usuario && usuario.rol !== "admin") {
  document.getElementById("contenido").innerHTML = `
    <div class="vacio"><strong>No tienes permiso</strong>Solo un administrador puede depurar el archivo del RAC.</div>
  `;
} else if (usuario) {
  dibujar();
}

// Guardados tras un análisis exitoso, para poder armar la descarga sin
// tener que volver a pedirle el archivo al servidor.
let archivoLimpioBase64 = null;
let nombreSugerido = "archivo_limpio.csv";

function dibujar() {
  document.getElementById("contenido").innerHTML = `
    <div class="panel" style="max-width:720px;">
      <div class="panel-cabecera"><h2>Depurar archivo del RAC antes de cargar</h2></div>
      <div style="padding:20px;">
        <p style="color:var(--tinta-suave); margin-top:0;">
          Analiza el archivo CSV del RAC (armado a mano en Excel) y cuenta dos
          defectos típicos de un archivo manejado sin automatización: espacios
          sobrantes en las celdas y saltos de línea (Enter) metidos dentro de
          un dato. <strong>No toca la base de datos</strong> -- solo analiza el
          archivo y te entrega una copia ya limpia, lista para subir por
          "Cargar RAC completo".
        </p>
        <form id="formDepurar">
          <div class="campo">
            <label for="archivoDepurar">Archivo (.csv)</label>
            <input type="file" id="archivoDepurar" accept=".csv" required>
          </div>
          <button type="submit" class="btn btn-primario" id="btnAnalizar">Analizar archivo</button>
        </form>
        <div id="resultadoDepurar" style="margin-top:18px;"></div>
      </div>
    </div>
  `;
  document.getElementById("formDepurar").addEventListener("submit", analizarArchivo);
}

async function analizarArchivo(e) {
  e.preventDefault();
  const input = document.getElementById("archivoDepurar");
  const btn = document.getElementById("btnAnalizar");
  const resultado = document.getElementById("resultadoDepurar");
  if (!input.files.length) return;

  archivoLimpioBase64 = null;
  btn.disabled = true;
  btn.textContent = "Analizando…";
  resultado.innerHTML = `<div class="cargando">Analizando archivo…</div>`;

  try {
    const datos = new FormData();
    datos.append("archivo", input.files[0]);

    const resp = await fetch("/api/rac/depurar-archivo", {
      method: "POST",
      headers: { Authorization: "Bearer " + RAC.getToken() },
      body: datos,
    });
    const data = await resp.json().catch(() => null);
    if (!resp.ok) throw new Error((data && data.error) || `Error ${resp.status}`);

    archivoLimpioBase64 = data.archivoLimpioBase64;
    nombreSugerido = data.nombreSugerido || "archivo_limpio.csv";

    dibujarResultado(data);
    mostrarToast("Archivo analizado.");
  } catch (err) {
    resultado.innerHTML = `<div class="error-msg visible">${err.message}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Analizar archivo";
  }
}

function dibujarResultado(data) {
  const resultado = document.getElementById("resultadoDepurar");
  resultado.innerHTML = `
    <div style="display:flex; gap:14px; flex-wrap:wrap;">
      <div class="stat-card" style="flex:1; min-width:210px; border-color:#f0d98c;">
        <div class="lbl">Espacios cosméticos</div>
        <div style="margin-top:6px; font-size:2rem; font-weight:700;">${data.celdasConEspacioCosmetico.toLocaleString("es-VE")}</div>
        <div style="font-size:0.85rem; color:var(--tinta-suave);">celdas con espacio sobrante</div>
      </div>
      <div class="stat-card" style="flex:1; min-width:210px; border-color:#e08a8a;">
        <div class="lbl">Saltos de línea embebidos</div>
        <div style="margin-top:6px; font-size:2rem; font-weight:700;">${data.celdasConSaltoDeLinea.toLocaleString("es-VE")}</div>
        <div style="font-size:0.85rem; color:var(--tinta-suave);">celdas con Enter metido adentro</div>
      </div>
      <div class="stat-card" style="flex:1; min-width:210px; border-color:var(--tiza-clara);">
        <div class="lbl">Filas analizadas</div>
        <div style="margin-top:6px; font-size:2rem; font-weight:700;">${data.filasAnalizadas.toLocaleString("es-VE")}</div>
        <div style="font-size:0.85rem; color:var(--tinta-suave);">de ${data.totalCeldas.toLocaleString("es-VE")} celdas revisadas</div>
      </div>
    </div>
    <button type="button" class="btn btn-primario" id="btnDescargarLimpio" style="margin-top:18px;">Descargar archivo limpio</button>
  `;
  document.getElementById("btnDescargarLimpio").addEventListener("click", descargarLimpio);
}

// El archivo limpio viaja del servidor como base64 (mismos bytes latin1 que
// espera "Cargar RAC completo") -- se reconstruye a un Blob binario tal
// cual, sin pasar por texto/UTF-8, para no dañar tildes/ñ (mismo cuidado
// que ya toma rac-completo.js con textoLatin1ABytes).
function descargarLimpio() {
  if (!archivoLimpioBase64) return;
  const binario = atob(archivoLimpioBase64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  const blob = new Blob([bytes], { type: "text/csv" });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombreSugerido;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
