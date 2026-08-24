const usuario = renderShell("cargas", "Cargar personal");

if (usuario) dibujar();

async function dibujar() {
  const puedeElegirMunicipio = usuario.rol === "admin" || usuario.rol === "operador";

  let campoMunicipioHtml = "";
  if (puedeElegirMunicipio) {
    campoMunicipioHtml = `
      <div class="campo">
        <label for="municipio_id">Municipio</label>
        <select id="municipio_id" required>
          <option value="">Selecciona un municipio…</option>
        </select>
      </div>
    `;
  }

  document.getElementById("contenido").innerHTML = `
    <div class="panel" style="max-width:560px;">
      <div class="panel-cabecera"><h2>Subir archivo del municipio</h2></div>
      <div style="padding:20px;">
        <p style="color:var(--tinta-suave); margin-top:0;">
          Sube el Excel consolidado del municipio. Cada fila se valida
          automáticamente contra el RAC, la nómina del Ministerio y el
          catálogo de planteles; lo que no cuadre queda como alerta para revisión.
        </p>
        <form id="formCarga">
          ${campoMunicipioHtml}
          <div class="campo">
            <label for="periodo_escolar">Periodo escolar</label>
            <input type="text" id="periodo_escolar" placeholder="2025-2026" required>
          </div>
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

  if (puedeElegirMunicipio) {
    await cargarMunicipios();
  }
}

async function cargarMunicipios() {
  const select = document.getElementById("municipio_id");
  try {
    // Se apoya en /api/planteles (que ya trae municipio_id) para
    // armar la lista, ya que no existe un endpoint dedicado a municipios.
    // Ajusta esto si tu backend agrega /api/municipios más adelante.
    const resp = await RAC.get("/api/planteles");
    const planteles = RAC.lista(resp, "planteles");
    const vistos = new Map();
    for (const p of planteles) {
      if (p.municipio_id && !vistos.has(p.municipio_id)) {
        vistos.set(p.municipio_id, p.municipio_nombre || `Municipio ${p.municipio_id}`);
      }
    }
    for (const [id, nombre] of vistos) {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = nombre;
      select.appendChild(opt);
    }
  } catch (err) {
    mostrarToast("No se pudo cargar la lista de municipios.", true);
  }
}

async function subirArchivo(e) {
  e.preventDefault();
  const input = document.getElementById("archivo");
  const btn = document.getElementById("btnSubir");
  const resultado = document.getElementById("resultadoCarga");
  if (!input.files.length) return;

  const municipioSelect = document.getElementById("municipio_id");
  const municipioId = municipioSelect ? municipioSelect.value : usuario.municipio_id;
  if (!municipioId) {
    resultado.innerHTML = `<div class="error-msg visible">Selecciona un municipio.</div>`;
    return;
  }

  const datos = new FormData();
  datos.append("archivo", input.files[0]);
  datos.append("municipio_id", municipioId);
  datos.append("periodo_escolar", document.getElementById("periodo_escolar").value.trim());

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

    resultado.innerHTML = `
      <div class="stat-card" style="border-color:var(--tiza-clara);">
        <div class="lbl">Carga procesada</div>
        <div style="margin-top:6px; font-size:0.9rem;">
          Filas procesadas: <strong>${data.filas_procesadas ?? "—"}</strong><br>
          Alertas generadas: <strong>${data.alertas_generadas ?? 0}</strong>
        </div>
        <a href="/alertas.html" class="btn btn-fantasma btn-sm" style="margin-top:12px;">Revisar alertas</a>
      </div>
    `;
    mostrarToast("Archivo cargado y validado.");
    document.getElementById("formCarga").reset();
  } catch (err) {
    resultado.innerHTML = `<div class="error-msg visible">${err.message}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = "Subir y validar";
  }
}
