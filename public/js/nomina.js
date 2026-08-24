// Solo admin -- si alguien más entra directo por URL, se le redirige.
const usuario = renderShell("nomina", "Cargar nómina del Ministerio");
if (usuario && usuario.rol !== "admin") {
  document.getElementById("contenido").innerHTML = `
    <div class="vacio"><strong>No tienes permiso</strong>Solo un administrador puede cargar la nómina.</div>
  `;
} else if (usuario) {
  dibujar();
}

function dibujar() {
  document.getElementById("contenido").innerHTML = `
    <div class="panel" style="max-width:560px;">
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
            <label for="archivo">Archivo (.csv)</label>
            <input type="file" id="archivo" accept=".csv" required>
          </div>
          <button type="submit" class="btn btn-primario" id="btnSubir">Reemplazar nómina</button>
        </form>
        <div id="resultadoNomina" style="margin-top:18px;"></div>
      </div>
    </div>
  `;
  document.getElementById("formNomina").addEventListener("submit", subirNomina);
}

async function subirNomina(e) {
  e.preventDefault();
  const input = document.getElementById("archivo");
  const btn = document.getElementById("btnSubir");
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
