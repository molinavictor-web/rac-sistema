const usuario = renderShell("cargas", "Cargar personal");
    if (usuario) dibujar();

    function dibujar() {
      document.getElementById("contenido").innerHTML = `
        <div class="panel" style="max-width:560px;">
          <div class="panel-cabecera"><h2>Subir archivo del municipio</h2></div>
          <div style="padding:20px;">
            <p style="color:var(--tinta-suave); margin-top:0;">
              Sube el Excel consolidado de tu municipio. Cada fila se valida
              automáticamente contra el RAC, la nómina del Ministerio y el
              catálogo de planteles; lo que no cuadre queda como alerta para revisión.
            </p>
            <form id="formCarga">
              <div class="campo">
                <label for="archivo">Archivo (.xlsx)</label>
                <input type="file" id="archivo" accept=".xlsx,.xls" required>
              </div>
              <button type="submit" class="btn btn-primario" id="btnSubir">Subir y validar</button>
            </form>
            <div id="resultadoCarga" style="margin-top:18px;"></div>
          </div>
        </div>
      `;

      document.getElementById("formCarga").addEventListener("submit", subirArchivo);
    }

    async function subirArchivo(e) {
      e.preventDefault();
      const input = document.getElementById("archivo");
      const btn = document.getElementById("btnSubir");
      const resultado = document.getElementById("resultadoCarga");
      if (!input.files.length) return;

      const datos = new FormData();
      // Ajusta "archivo" si tu ruta /api/cargas espera otro nombre de campo.
      datos.append("archivo", input.files[0]);

      btn.disabled = true;
      btn.textContent = "Subiendo…";
      resultado.innerHTML = "";

      try {
        const resp = await fetch("/api/cargas", {
          method: "POST",
          headers: { Authorization: "Bearer " + RAC.getToken() },
          body: datos,
        });
        const data = await resp.json().catch(() => null);
        if (!resp.ok) throw new Error((data && data.error) || `Error ${resp.status}`);

        const filas = (data && (data.cantidad_filas || data.filas)) || "—";
        const alertas = (data && (data.alertas_generadas ?? data.alertas)) || 0;

        resultado.innerHTML = `
          <div class="stat-card" style="border-color:var(--tiza-clara);">
            <div class="lbl">Carga procesada</div>
            <div style="margin-top:6px; font-size:0.9rem;">
              Filas procesadas: <strong>${filas}</strong><br>
              Alertas generadas: <strong>${alertas}</strong>
            </div>
            <a href="/alertas.html" class="btn btn-fantasma btn-sm" style="margin-top:12px;">Revisar alertas</a>
          </div>
        `;
        mostrarToast("Archivo cargado y validado.");
      } catch (err) {
        resultado.innerHTML = `<div class="error-msg visible">${err.message}</div>`;
      } finally {
        btn.disabled = false;
        btn.textContent = "Subir y validar";
        input.value = "";
      }
    }
