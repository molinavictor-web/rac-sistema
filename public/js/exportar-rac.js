// Admin y operador -- si alguien más entra directo por URL, se le redirige.
const usuario = renderShell("exportar-rac", "Exportar RAC");
if (usuario && !["admin", "operador"].includes(usuario.rol)) {
  document.getElementById("contenido").innerHTML = `
    <div class="vacio"><strong>No tienes permiso</strong>Solo un administrador u operador puede exportar el RAC.</div>
  `;
} else if (usuario) {
  dibujar();
}

function dibujar() {
  document.getElementById("contenido").innerHTML = `
    <div class="panel" style="max-width:560px;">
      <div class="panel-cabecera"><h2>Exportar RAC</h2></div>
      <div style="padding:20px;">
        <p style="color:var(--tinta-suave); margin-top:0;">
          Descarga el RAC completo en el mismo formato del CSV de carga
          (33 columnas, separado por ";"), listo para enviar a la sede
          central o reabrir con la misma estructura de siempre. Las
          columnas que hoy no tienen fuente en el sistema (por ejemplo
          NIVEL, MODALIDAD o PERIODO O GRUPO) se exportan vacías.
        </p>
        <button type="button" class="btn btn-primario" id="btnExportarGeneral">
          Descargar RAC (formato general)
        </button>
        <div id="resultadoExportar" style="margin-top:18px;"></div>
      </div>
    </div>
  `;
  document.getElementById("btnExportarGeneral").addEventListener("click", exportarGeneral);
}

async function exportarGeneral() {
  const btn = document.getElementById("btnExportarGeneral");
  const resultado = document.getElementById("resultadoExportar");
  btn.disabled = true;
  btn.textContent = "Generando archivo…";
  resultado.innerHTML = "";
  try {
    const resp = await fetch("/api/rac/exportar-general", {
      headers: { Authorization: "Bearer " + RAC.getToken() },
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => null);
      throw new Error((data && data.error) || `Error ${resp.status}`);
    }
    const blob = await resp.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `RAC_GENERAL_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
    resultado.innerHTML = `
      <div class="stat-card" style="border-color:var(--tiza-clara);">
        <div class="lbl">Archivo generado</div>
        <div style="margin-top:6px; font-size:0.9rem;">
          La descarga debería iniciar automáticamente.
        </div>
      </div>
    `;
    mostrarToast("RAC exportado.");
  } catch (err) {
    resultado.innerHTML = `<div class="error-msg visible">${err.message}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Descargar RAC (formato general)";
  }
}
