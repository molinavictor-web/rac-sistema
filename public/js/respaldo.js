// Respaldo de datos (solo admin): descarga un ZIP con un CSV por tabla de la base de datos.
const usuario = renderShell("respaldo", "Respaldo de datos");
if (usuario && usuario.rol !== "admin") {
  document.getElementById("contenido").innerHTML = `<div class="vacio"><strong>No tienes permiso</strong>Solo un administrador puede descargar el respaldo.</div>`;
} else if (usuario) {
  dibujar();
}

function escapar(valor) {
  return String(valor === undefined || valor === null ? "" : valor).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fechaLarga(iso) {
  if (!iso) return "nunca desde este botón";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-VE", { dateStyle: "long", timeStyle: "short", timeZone: "America/Caracas" });
}

async function dibujar() {
  const cont = document.getElementById("contenido");
  cont.innerHTML = `<div class="panel" style="max-width:760px;"><div class="panel-cabecera"><h2>Respaldo de datos</h2></div><div style="padding:20px;" id="respCuerpo">Cargando…</div></div>`;
  try {
    const r = await RAC.get("/api/respaldo/resumen");
    const total = r.tablas.reduce((a, t) => a + t.filas, 0);
    const filas = r.tablas.map((t) => `<tr><td>${escapar(t.tabla)}</td><td style="text-align:right;">${t.filas.toLocaleString("es-VE")}</td></tr>`).join("");
    document.getElementById("respCuerpo").innerHTML = `
      <p style="margin-top:0; color:var(--tinta-suave);">Descarga <strong>todas las tablas</strong> de la base de datos (Supabase) en un solo archivo ZIP: un archivo CSV por tabla, un archivo <code>manifiesto.csv</code> con la cantidad de filas de cada una y un script para restaurar. Incluye usuarios (con las contraseñas cifradas) y la tabla rac. <strong>No incluye</strong> la nómina del Ministerio (<code>${escapar(r.excluidas.join(", "))}</code>) ni lo que está en Google Drive/Sheets.</p>
      <div style="background:#fffaf0; border:1px solid #f6d89b; border-radius:8px; padding:10px 14px; font-size:.86rem; margin:12px 0;">
        <strong>Guárdalo en un lugar privado.</strong> Trae contraseñas cifradas, cédulas y teléfonos. Se recomienda bajar uno cada mes y conservar los últimos tres.
      </div>
      <p style="margin:10px 0;">Último respaldo descargado: <strong>${escapar(fechaLarga(r.ultimo_respaldo))}</strong></p>
      <p style="margin:10px 0;">Tablas incluidas: <strong>${r.tablas.length}</strong> · Filas en total: <strong>${total.toLocaleString("es-VE")}</strong></p>
      <button type="button" class="btn btn-primario" id="btnRespaldo">Descargar respaldo (ZIP)</button>
      <div class="error-msg" id="respError"></div>
      <details style="margin-top:18px;"><summary style="cursor:pointer;">Ver las tablas y sus filas</summary>
        <div class="tabla-responsive" style="margin-top:8px;"><table><thead><tr><th>Tabla</th><th style="text-align:right;">Filas</th></tr></thead><tbody>${filas}</tbody></table></div>
      </details>`;
    document.getElementById("btnRespaldo").addEventListener("click", descargar);
  } catch (err) {
    document.getElementById("respCuerpo").innerHTML = `<div class="error-msg visible">${escapar(err.message)}</div>`;
  }
}

async function descargar() {
  const boton = document.getElementById("btnRespaldo");
  const errorEl = document.getElementById("respError");
  errorEl.classList.remove("visible");
  boton.disabled = true;
  boton.textContent = "Generando respaldo… (puede tardar un minuto)";
  try {
    const resp = await fetch("/api/respaldo/descargar", { headers: { Authorization: "Bearer " + RAC.getToken() } });
    if (resp.status === 401) { RAC.cerrarSesion(); return; }
    if (!resp.ok) {
      let mensaje = `Error ${resp.status}`;
      try { mensaje = (await resp.json()).error || mensaje; } catch (_) { /* sin cuerpo */ }
      throw new Error(mensaje);
    }
    const blob = await resp.blob();
    const m = /filename="([^"]+)"/.exec(resp.headers.get("Content-Disposition") || "");
    const enlace = document.createElement("a");
    enlace.href = URL.createObjectURL(blob);
    enlace.download = m ? m[1] : "RESPALDO_SID.zip";
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    setTimeout(() => URL.revokeObjectURL(enlace.href), 4000);
    mostrarToast("Respaldo descargado. Guárdalo en un lugar privado.");
    await dibujar();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.add("visible");
    boton.disabled = false;
    boton.textContent = "Descargar respaldo (ZIP)";
  }
}
