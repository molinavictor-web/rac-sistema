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
          validando contra la nómina del Ministerio. Los registros que ya
          estaban en el RAC pero no aparecen en este archivo generan una
          alerta para revisión — nunca se borran automáticamente.
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
  `;
  document.getElementById("formRacCompleto").addEventListener("submit", subirRacCompleto);
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
          <div>No encontrados en esta carga (posible baja): <strong>${data.noEncontradosEnCarga}</strong></div>
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
