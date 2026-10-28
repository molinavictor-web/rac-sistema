// instrumento-uno-edificios.js — edificios donde funciona más de una institución (código de infraestructura).

const usuario = renderShell("inspecciones-edificios", "Edificios compartidos");

function escapar(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const n = (v) => Number(v || 0).toLocaleString("es-VE");

if (usuario) cargar();

async function cargar() {
  const contenido = document.getElementById("contenido");
  contenido.innerHTML = `
    <section class="planteles-hero"><div class="planteles-hero-copy">
      <span class="planteles-eyebrow">INSTRUMENTO UNO CDCE</span>
      <h1>Edificios compartidos</h1>
      <p>Cuántos nombres de institución funcionan en un mismo edificio, según el código de infraestructura.</p>
    </div></section>
    <div id="edif"><div class="cargando">Cargando…</div></div>`;
  try {
    const r = await RAC.get("/api/inspecciones/instrumento-uno/edificios");
    const lista = r.edificios;
    document.getElementById("edif").innerHTML = `
      <div class="iu-tarjetas">
        <div class="stat-card"><div class="num">${n(r.compartidos)}</div><div class="lbl">Edificios compartidos</div></div>
        <div class="stat-card"><div class="num">${n(r.instituciones_en_compartidos)}</div><div class="lbl">Nombres de institución en ellos</div></div>
      </div>
      ${r.hoja_ok ? "" : `<div class="iu-aviso" style="margin:0 0 12px; padding:9px 12px; border-radius:9px; background:#fff8e1; border:1px solid #f2c94c; font-size:.84rem;">No se pudo leer la hoja «Coordenadas Planteles»; se muestran solo los edificios registrados en el instrumento.</div>`}
      <div class="panel" style="padding:12px 20px;"><input type="text" id="filtro" placeholder="Buscar por código o nombre" style="padding:9px 12px; border:1px solid #c7d2e0; border-radius:9px; min-width:240px;"></div>
      <div id="tarjetas"></div>`;
    const pintar = () => {
      const q = document.getElementById("filtro").value.trim().toLowerCase();
      const f = lista.filter((e) => !q || e.codigo_infraestructura.toLowerCase().includes(q) || e.miembros.some((m) => String(m.nombre || "").toLowerCase().includes(q) || String(m.codigo_dea || "").toLowerCase().includes(q)));
      document.getElementById("tarjetas").innerHTML = f.length
        ? f.map((e) => `<div class="panel iu-edif"><h3>Edificio <code>${escapar(e.codigo_infraestructura)}</code> · ${e.cantidad} nombres</h3>
            <ul>${e.miembros.map((m) => `<li>${escapar(m.nombre || "(sin nombre)")}${m.codigo_dea ? ` <small>${escapar(m.codigo_dea)}</small>` : ""}</li>`).join("")}</ul></div>`).join("")
        : `<div class="panel"><div class="vacio"><strong>Sin resultados</strong></div></div>`;
    };
    document.getElementById("filtro").addEventListener("input", pintar);
    pintar();
  } catch (err) {
    document.getElementById("edif").innerHTML = `<div class="panel"><div class="vacio"><strong>No se pudo cargar</strong>${escapar(err.message)}</div></div>`;
  }
}
