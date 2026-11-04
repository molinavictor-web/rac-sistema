// inspecciones-cambios.js — Cambios recientes (solo admin): lo último que se cargó por consultas exprés,
// con filtro por municipio o plantel y un botón para volver al dato anterior.

const usuario = renderShell("inspecciones-cambios", "Cambios recientes");
const API = "/api/inspecciones/consultas";

function escapar(v) {
  return String(v === undefined || v === null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

let CAMBIOS = [];
let temporizador = null;

if (usuario) iniciar();

function iniciar() {
  document.getElementById("contenido").innerHTML = `
    <section class="planteles-hero"><div class="planteles-hero-copy">
      <span class="planteles-eyebrow">INSPECCIONES</span>
      <h1>Cambios recientes</h1>
      <p>Lo último que se cargó o actualizó por consultas exprés: qué cambió, quién, cuándo y con qué nota. Si algo no te cuadra, puedes volver al dato anterior.</p>
    </div></section>
    <div class="panel iu-bloque" style="margin-bottom:14px;">
      <div class="ce-fila">
        <input type="text" id="fMunicipio" placeholder="Municipio (ej.: MATURIN)" autocomplete="off">
        <input type="search" id="fTexto" placeholder="Plantel o código DEA" autocomplete="off">
        <button type="button" class="btn btn-fantasma" id="btnRecargar">Actualizar</button>
      </div>
    </div>
    <div id="resultado"><div class="panel"><div class="cargando">Cargando…</div></div></div>`;
  ["fMunicipio", "fTexto"].forEach((id) => document.getElementById(id).addEventListener("input", () => { clearTimeout(temporizador); temporizador = setTimeout(cargar, 400); }));
  document.getElementById("btnRecargar").addEventListener("click", cargar);
  cargar();
}

async function cargar() {
  const cont = document.getElementById("resultado");
  const q = new URLSearchParams();
  const m = document.getElementById("fMunicipio").value.trim();
  const t = document.getElementById("fTexto").value.trim();
  if (m) q.set("municipio", m);
  if (t) q.set("q", t);
  q.set("limite", "200");
  try {
    CAMBIOS = (await RAC.get(`${API}/cambios?${q.toString()}`)).cambios;
  } catch (err) {
    cont.innerHTML = `<div class="panel"><div class="iu-msg-error" style="padding:14px;">${escapar(err.message)}</div></div>`;
    return;
  }
  dibujar();
}

function fechaHora(iso) {
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toLocaleString("es-VE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function dibujar() {
  const cont = document.getElementById("resultado");
  if (!CAMBIOS.length) {
    cont.innerHTML = `<div class="panel"><div class="vacio"><strong>No hay cambios</strong>Cuando se llene una consulta exprés, los cambios aparecerán aquí.</div></div>`;
    return;
  }
  cont.innerHTML = `<div class="panel"><div class="tabla-responsive"><table class="ce-tabla">
    <thead><tr><th>Cuándo</th><th>Plantel</th><th>Pregunta</th><th>Antes</th><th>Ahora</th><th>Quién / consulta</th><th></th></tr></thead>
    <tbody>${CAMBIOS.map((c) => `<tr class="${c.revertido_en ? "rev" : ""}">
      <td>${escapar(fechaHora(c.creado_en))}</td>
      <td><strong>${escapar(c.plantel || c.codigo_dea)}</strong><br><small>${escapar(c.codigo_dea)}${c.municipio ? " · " + escapar(c.municipio) : ""}</small></td>
      <td>${escapar(c.pregunta)}</td>
      <td>${escapar(c.anterior)}</td>
      <td>${escapar(c.nuevo)}${c.nota ? `<br><span class="nota">“${escapar(c.nota)}”</span>` : ""}</td>
      <td>${escapar(c.usuario || "")}<br><small>${escapar(c.consulta || "")}</small></td>
      <td>${c.revertido_en ? "<small>revertido</small>" : `<button type="button" class="btn btn-fantasma" data-rev="${c.id}">Volver al anterior</button>`}</td>
    </tr>`).join("")}</tbody></table></div></div>`;
  cont.querySelectorAll("[data-rev]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("¿Volver al dato anterior?")) return;
    b.disabled = true;
    try {
      await RAC.post(`${API}/cambios/${b.dataset.rev}/revertir`, {});
      mostrarToast("Dato anterior restaurado.");
      await cargar();
    } catch (e) {
      mostrarToast(e.message, true);
      b.disabled = false;
    }
  }));
}
