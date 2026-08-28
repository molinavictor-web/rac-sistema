// Solo admin -- si alguien más entra directo por URL, se le redirige.
const usuario = renderShell("planteles-carga", "Cargar planteles");
if (usuario && usuario.rol !== "admin") {
  document.getElementById("contenido").innerHTML = `
    <div class="vacio"><strong>No tienes permiso</strong>Solo un administrador puede cargar el catálogo de planteles.</div>
  `;
} else if (usuario) {
  dibujar();
}

function dibujar() {
  document.getElementById("contenido").innerHTML = `
    <div class="panel" style="max-width:560px;">
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
            <label for="archivo">Archivo (.csv)</label>
            <input type="file" id="archivo" accept=".csv" required>
          </div>
          <button type="submit" class="btn btn-primario" id="btnSubir">Cargar planteles</button>
        </form>
        <div id="resultadoPlanteles" style="margin-top:18px;"></div>
      </div>
    </div>
  `;
  document.getElementById("formPlanteles").addEventListener("submit", subirPlanteles);
}

async function subirPlanteles(e) {
  e.preventDefault();
  const input = document.getElementById("archivo");
  const btn = document.getElementById("btnSubir");
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
