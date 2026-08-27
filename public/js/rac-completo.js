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
          Si el archivo es muy grande, puedes subirlo partido en varios
          pedazos, uno por uno, en esta misma página. Cuando termines de
          subir <strong>todos</strong> los pedazos, usa el panel de abajo
          ("Revisar registros no encontrados") una sola vez para detectar
          quiénes del RAC actual no aparecieron en ninguna carga reciente.
        </p>
        <form id="formRacCompleto">
          <div class="campo">
            <label for="archivo">Archivo (.csv)</label>
            <input type="file" id="archivo" accept=".csv" required>
          </div>
          <button type="submit" class="btn btn-primario" id="btnSubir">Sincronizar RAC</button>
        </form>
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
async function subirRacCompleto(e) {
  e.preventDefault();
  const input = document.getElementById("archivo");
  const btn = document.getElementById("btnSubir");
  const resultado = document.getElementById("resultadoRacCompleto");
  if (!input.files.length) return;
  const confirmado = confirm(
    "Esto sincroniza el RAC completo con el contenido de este archivo (actualiza existentes, agrega nuevos y genera alertas). ¿Continuar?"
  );
  if (!confirmado) return;
  const datos = new FormData();
  datos.append("archivo", input.files[0]);
  btn.disabled = true;
  btn.textContent = "Subiendo y procesando… puede tardar varios minutos";
  resultado.innerHTML = "";
  try {
    const resp = await fetch("/api/rac/cargar-completo", {
      method: "POST",
      headers: { Authorization: "Bearer " + RAC.getToken() },
      body: datos,
    });
    const data = await resp.json().catch(() => null);
    if (!resp.ok) throw new Error((data && data.error) || `Error ${resp.status}`);
    resultado.innerHTML = `
      <div class="stat-card" style="border-color:var(--tiza-clara);">
        <div class="lbl">RAC sincronizado</div>
        <div style="margin-top:6px; font-size:0.9rem; display:grid; gap:4px;">
          <div>Insertados: <strong>${data.insertados}</strong></div>
          <div>Actualizados: <strong>${data.actualizados}</strong></div>
          <div>Sin cambios: <strong>${data.sinCambios}</strong></div>
          <div>Filas con error: <strong>${data.filasConError}</strong></div>
          <div>Líneas vacías ignoradas (relleno del archivo): <strong>${data.lineasVaciasIgnoradas}</strong></div>
          <div>Alertas generadas: <strong>${data.alertasGeneradas}</strong></div>
        </div>
      </div>
    `;
    mostrarToast("RAC sincronizado correctamente.");
  } catch (err) {
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
