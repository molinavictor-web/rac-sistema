// inspecciones-dashboard.js — pantalla principal del módulo Inspecciones.
// Cifras de GESCOLAR (atendidos, con inspección, por tipo de atención y por municipio) y del módulo.
// Solo lectura; lo ven todos los perfiles del módulo.

const usuario = renderShell("inspecciones-dashboard", "Resumen");

function escapar(valor) {
  return String(valor == null ? "" : valor).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const n = (v) => Number(v || 0).toLocaleString("es-VE");
const pct = (v) => Number(v || 0).toLocaleString("es-VE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " %";

if (usuario) cargar();

async function cargar() {
  const contenido = document.getElementById("contenido");
  contenido.innerHTML = `
    <section class="planteles-hero">
      <div class="planteles-hero-copy">
        <span class="planteles-eyebrow">INSPECCIONES</span>
        <h1>Resumen de planteles</h1>
        <p>Atención e inspecciones de los planteles de GESCOLAR · Monagas.</p>
      </div>
    </section>
    <div id="dash"><div class="cargando">Cargando cifras…</div></div>`;
  try {
    pintar(await RAC.get("/api/inspecciones/dashboard"));
  } catch (err) {
    document.getElementById("dash").innerHTML = `<div class="panel"><div class="vacio"><strong>No se pudo cargar el resumen</strong>${escapar(err.message)}</div></div>`;
  }
}

function tarjeta(clase, numero, etiqueta, pie) {
  return `<div class="stat-card ${clase}"><div class="num">${numero}</div><div class="lbl">${etiqueta}</div>${pie ? `<div class="lbl" style="margin-top:2px;">${pie}</div>` : ""}</div>`;
}

function bloqueAvance(titulo, nota, b, total, clase) {
  return `
    <div class="panel"><div class="dash-bloque">
      <h3>${titulo}</h3>
      <p class="dash-nota">${nota}</p>
      <div class="dash-barra" role="img" aria-label="${titulo}: ${pct(b.porcentaje)}"><span class="${clase}" style="width:${Math.min(100, b.porcentaje)}%"></span></div>
      <div class="dash-pie">
        <span><strong>${n(b.cantidad)}</strong> de ${n(total)} (${pct(b.porcentaje)})</span>
        <span>Faltan <strong>${n(b.faltan)}</strong> (${pct(100 - b.porcentaje)})</span>
      </div>
    </div></div>`;
}

function pintar(d) {
  const filasTipo = d.por_tipo.length
    ? d.por_tipo.map((t) => `
        <div class="dash-fila-barra">
          <div class="nombre">${escapar(t.nombre)}<span class="dash-etiqueta ${t.origen === "plan" ? "plan" : ""}">${t.origen === "plan" ? "plan actual" : "tipo de atención"}</span></div>
          <div class="dash-barra"><span class="${t.origen === "plan" ? "azul" : "ok"}" style="width:${Math.min(100, t.porcentaje)}%"></span></div>
          <div class="valor">${n(t.cantidad)} · ${pct(t.porcentaje)}</div>
        </div>`).join("")
    : `<div class="vacio"><strong>Sin datos de atención</strong>Aún no hay planteles con tipo de atención o plan en GESCOLAR.</div>`;

  const filasMun = d.por_municipio.map((m) => `
      <tr>
        <td>${escapar(m.municipio)}</td>
        <td class="num">${n(m.total)}</td>
        <td class="num">${n(m.atendidos)}</td>
        <td class="num">${pct(m.total ? (m.atendidos / m.total) * 100 : 0)}</td>
        <td class="num">${n(m.total - m.atendidos)}</td>
        <td class="num">${n(m.con_inspeccion)}</td>
        <td class="num">${pct(m.total ? (m.con_inspeccion / m.total) * 100 : 0)}</td>
      </tr>`).join("");

  document.getElementById("dash").innerHTML = `
    <div class="stats-grid">
      ${tarjeta("", n(d.total), "Planteles en GESCOLAR", "")}
      ${tarjeta("stat-success acento-sello", n(d.atendidos.cantidad), "Planteles atendidos", pct(d.atendidos.porcentaje) + " del total")}
      ${tarjeta("stat-alert acento-riesgo", n(d.atendidos.faltan), "Faltan por atender", pct(100 - d.atendidos.porcentaje) + " del total")}
      ${tarjeta("stat-purple", n(d.con_inspeccion.cantidad), "Planteles con inspección", pct(d.con_inspeccion.porcentaje) + " del total")}
    </div>

    <div class="dash-dos" style="margin-top:16px;">
      ${bloqueAvance("Planteles atendidos", "Tienen tipo de atención (p. ej. GOTA DE AMOR) o plan de rehabilitación.", d.atendidos, d.total, "ok")}
      ${bloqueAvance("Planteles con inspección", "Tienen un ingeniero RESPONSABLE en GESCOLAR.", d.con_inspeccion, d.total, "azul")}
    </div>

    <div class="panel" style="margin-top:16px;"><div class="dash-bloque">
      <h3>Planteles atendidos por tipo de atención</h3>
      <p class="dash-nota">Un plantel puede aparecer en más de uno (por ejemplo, atendido antes con GOTA DE AMOR y ahora en el plan). El porcentaje es sobre ${n(d.total)} planteles.</p>
      ${filasTipo}
      <div class="dash-pie"><span>Atendidos con inspección: <strong>${n(d.atendidos_con_inspeccion)}</strong></span><span>Atendidos sin inspección: <strong>${n(d.atendidos_sin_inspeccion)}</strong></span></div>
    </div></div>

    <div class="panel" style="margin-top:16px;"><div class="dash-bloque">
      <h3>Por municipio</h3>
      <div class="tabla-responsive"><table class="dash-tabla">
        <thead><tr><th>Municipio</th><th class="num">Planteles</th><th class="num">Atendidos</th><th class="num">% atendidos</th><th class="num">Faltan</th><th class="num">Con inspección</th><th class="num">% inspección</th></tr></thead>
        <tbody>${filasMun}</tbody>
      </table></div>
    </div></div>

    <div class="panel" style="margin-top:16px;"><div class="dash-bloque">
      <h3>Dentro del módulo de Inspecciones</h3>
      <p class="dash-nota">${d.columna_plan_existe ? "" : "La columna PLAN REHABILITACION todavía no existe en GESCOLAR: se crea la primera vez que se registra un plan. "}Planes y planillas de materiales cargadas en el sistema.</p>
      <div class="stats-grid">
        ${tarjeta("", n(d.modulo.planes), "Planes de atención", "")}
        ${tarjeta("", n(d.modulo.en_planes), "Planteles en planes", "")}
        ${tarjeta("stat-success acento-sello", n(d.modulo.cargadas), "Planillas cargadas", "")}
        ${tarjeta("stat-alert acento-riesgo", n(d.modulo.borradores), "Planillas en borrador", "")}
      </div>
    </div></div>`;
}
