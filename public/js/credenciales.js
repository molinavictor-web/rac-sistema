const usuario = renderShell("credenciales", "Credenciales");
if (usuario) dibujarPanel();

function dibujarPanel() {
  document.getElementById("contenido").innerHTML = `
    <div class="panel">
      <div class="panel-cabecera">
        <h2>Generar credencial (nómina + RAC)</h2>
      </div>
      <div class="buscador-credenciales" style="display:flex; gap:10px; margin-bottom:16px;">
        <input type="text" id="cedulaBuscar" placeholder="Escribe una cédula, ej. 9293431" style="flex:1; padding:10px 14px; font-size:1rem; border:1px solid #ccc; border-radius:6px;">
        <button class="btn btn-primario btn-sm" id="btnBuscar">Buscar</button>
      </div>
      <div id="resultadosCredenciales"></div>
    </div>

    <div class="panel" style="margin-top:24px;">
      <div class="panel-cabecera">
        <h2>Pendientes de aprobación</h2>
        <button class="btn btn-fantasma btn-sm" id="btnRefrescarPendientes">Actualizar</button>
      </div>
      <p style="margin-bottom:12px;">Aprueba solo después de haber impreso, firmado físicamente y escaneado el documento.</p>
      <div id="tablaPendientes"></div>
    </div>
  `;

  document.getElementById("btnBuscar").addEventListener("click", buscarCedula);
  document.getElementById("cedulaBuscar").addEventListener("keydown", (e) => {
    if (e.key === "Enter") buscarCedula();
  });
  document.getElementById("btnRefrescarPendientes").addEventListener("click", cargarPendientes);

  cargarPendientes();
}

async function buscarCedula() {
  const cedula = document.getElementById("cedulaBuscar").value.trim();
  const cont = document.getElementById("resultadosCredenciales");
  if (!cedula) {
    cont.innerHTML = `<div class="vacio"><strong>Escribe una cédula</strong>Debes indicar una cédula para buscar.</div>`;
    return;
  }
  cont.innerHTML = `<div class="cargando">Buscando…</div>`;
  try {
    const data = await RAC.get(`/api/credenciales/buscar/${encodeURIComponent(cedula)}`);
    if (!data.encontrado) {
      cont.innerHTML = `<div class="vacio"><strong>No se encontró ningún registro</strong>Esa cédula no aparece en el RAC.</div>`;
      return;
    }
    cont.innerHTML = data.registros.map((r) => {
      const nombreCompleto = [r.nombres, r.apellidos].filter(Boolean).join(" ") || "—";
      const activo = (r.situacion || "").toUpperCase() === "ACTIVO";
      return `
        <div class="registro" style="background:#fff; border:1px solid #ddd; border-radius:8px; padding:16px 20px; margin-bottom:14px;">
          <div style="font-weight:700; font-size:1.05rem;">${nombreCompleto}</div>
          <div>Cédula: ${r.cedula}</div>
          <div>Situación: <strong>${r.situacion || "—"}</strong></div>
          <div>Cargo: ${r.cargo || "—"} (código ${r.codigo_cargo || "—"})</div>
          <div>Tipo de personal: ${r.tipo_personal || "—"}</div>
          <div>Plantel: ${r.nombre_plantel || "—"} (código ${r.codigo_plantel || "—"})</div>
          <div>Municipio / Parroquia: ${r.municipio || "—"} / ${r.parroquia || "—"}</div>
          <div>Horas administrativas: ${r.horas_adm || "—"}</div>
          <div>Fecha de ingreso: ${r.fecha_ingreso || "—"}</div>
          ${activo ? `<button class="btn btn-primario btn-sm" style="margin-top:10px;" data-cedula="${r.cedula}">Generar credencial (PDF)</button>` : ""}
        </div>
      `;
    }).join("");
    cont.querySelectorAll("[data-cedula]").forEach((btn) => {
      btn.addEventListener("click", () => generarCredencial(btn));
    });
  } catch (err) {
    cont.innerHTML = `<div class="vacio"><strong>No se pudo buscar</strong>${err.message}</div>`;
  }
}

async function generarCredencial(boton) {
  const cedula = boton.dataset.cedula;
  boton.disabled = true;
  boton.textContent = "Generando…";
  try {
    const resp = await fetch(`/api/credenciales/generar/${encodeURIComponent(cedula)}`, {
      method: "POST",
      headers: { Authorization: "Bearer " + RAC.getToken() },
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => null);
      throw new Error((data && data.error) || `Error ${resp.status}`);
    }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `credencial_${cedula}.pdf`;
    a.click();
    boton.textContent = "PDF descargado ✓";
    mostrarToast("Credencial generada y registrada como pendiente de aprobación.");
    cargarPendientes();
  } catch (err) {
    boton.disabled = false;
    boton.textContent = "Generar credencial (PDF)";
    mostrarToast(err.message, true);
  }
}

async function cargarPendientes() {
  const cont = document.getElementById("tablaPendientes");
  if (!cont) return;
  cont.innerHTML = `<div class="cargando">Cargando pendientes…</div>`;
  try {
    const data = await RAC.get("/api/credenciales/pendientes");
    if (!data.pendientes.length) {
      cont.innerHTML = `<div class="vacio"><strong>No hay credenciales pendientes</strong></div>`;
      return;
    }
    const filas = data.pendientes.map((p) => `
      <tr>
        <td>${p.codigo_verificacion}</td>
        <td>${p.cedula}</td>
        <td>${p.nombre}</td>
        <td>${p.plantel || ""}</td>
        <td><button class="btn btn-fantasma btn-sm" data-codigo="${p.codigo_verificacion}">Aprobar</button></td>
      </tr>
    `).join("");
    cont.innerHTML = `
      <table>
        <thead><tr><th>Código</th><th>Cédula</th><th>Nombre</th><th>Plantel</th><th></th></tr></thead>
        <tbody>${filas}</tbody>
      </table>
    `;
    cont.querySelectorAll("[data-codigo]").forEach((btn) => {
      btn.addEventListener("click", () => aprobarCredencial(btn));
    });
  } catch (err) {
    cont.innerHTML = `<div class="vacio"><strong>No se pudo cargar</strong>${err.message}</div>`;
  }
}

async function aprobarCredencial(boton) {
  const codigo = boton.dataset.codigo;
  const ok = window.confirm("¿Confirmas que ya la firmaste físicamente?");
  if (!ok) return;
  boton.disabled = true;
  boton.textContent = "Aprobando…";
  try {
    await RAC.post(`/api/credenciales/aprobar/${encodeURIComponent(codigo)}`, {});
    mostrarToast("Credencial aprobada.");
    cargarPendientes();
  } catch (err) {
    boton.disabled = false;
    boton.textContent = "Aprobar";
    mostrarToast(err.message, true);
  }
}
