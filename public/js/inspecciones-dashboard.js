// inspecciones-dashboard.js — pantalla principal del módulo Inspecciones.
// Cifras de GESCOLAR (atendidos, con inspección, por tipo de atención y por municipio) y del módulo.
// Solo lectura; lo ven todos los perfiles del módulo.

const usuario = renderShell("inspecciones-dashboard", "Resumen");

function escapar(valor) {
  return String(valor == null ? "" : valor).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const n = (v) => Number(v || 0).toLocaleString("es-VE");
const CATEGORIAS_ENTE = { GOBERNACION: "Gobernación", ALCALDIA: "Alcaldía", MINISTERIO: "Ministerio", INSTITUTO: "Instituto / otro organismo", FANB: "FANB", OTRO: "Otro" };
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
  const programas = d.por_programa || [];
  const filasTipo = programas.length
    ? programas.map((t) => `
        <div class="dash-fila-barra">
          <div class="nombre">${escapar(t.nombre)}${t.nota ? `<span class="dash-etiqueta">${escapar(t.nota)}</span>` : ""}<div class="dash-cant"><strong>${n(t.cantidad)}</strong> plantel${t.cantidad === 1 ? "" : "es"} · ${pct(t.porcentaje)}</div>${t.anios && t.anios.length ? `<div class="dash-cant" style="font-size:.74rem;">${t.anios.map((a) => `${escapar(a.anio)}: <strong>${n(a.cantidad)}</strong>`).join(" · ")}${t.repetidos_anios > 0 ? ` = ${n(t.anios.reduce((x, a) => x + a.cantidad, 0))} − <strong>${n(t.repetidos_anios)}</strong> atendido${t.repetidos_anios === 1 ? "" : "s"} en dos años = <strong>${n(t.cantidad)}</strong>` : ""}</div>` : ""}</div>
          <div class="dash-barra"><span class="${t.clave === "GOTA" ? "ok" : "azul"}" style="width:${Math.min(100, t.porcentaje)}%"></span></div>
        </div>`).join("") + (d.cuadre ? `
        <p class="dash-nota" style="margin-top:14px;">Suma de las barras <strong>${n(d.cuadre.suma_barras)}</strong>${d.cuadre.repetidos > 0 ? ` − <strong>${n(d.cuadre.repetidos)}</strong> planteles repetidos entre programas` : ""} = <strong>${n(d.cuadre.atendidos)}</strong> planteles atendidos (cada plantel se cuenta una sola vez).</p>` : "")
    : `<div class="vacio"><strong>Sin datos de atención</strong>Aún no hay planteles con tipo de atención o plan.</div>`;

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

  const filaBarra = (nombre, tot, cargadas) => {
    const porc = tot ? (cargadas / tot) * 100 : 0;
    return `
        <div class="dash-fila-barra">
          <div class="nombre">${escapar(nombre)}<div class="dash-cant"><strong>${n(tot)}</strong> plantel${tot === 1 ? "" : "es"} · <strong>${n(cargadas)}</strong> cargado${cargadas === 1 ? "" : "s"} · faltan <strong>${n(tot - cargadas)}</strong></div></div>
          <div class="dash-avance"><div class="dash-barra"><span class="ok" style="width:${Math.min(100, porc)}%"></span></div><span class="dash-porc">${pct(porc)}</span></div>
        </div>`;
  };
  const filasMunBarra = d.por_municipio.map((m) => filaBarra(m.municipio, m.total, m.instrumento || 0)).join("");
  const iu = d.instrumento || { cantidad: 0, faltan: d.total, porcentaje: 0 };
  const parr = d.parroquias_maturin || [];
  const filasParr = parr.length
    ? parr.map((o) => filaBarra(o.parroquia, o.total, o.instrumento)).join("")
    : `<div class="vacio"><strong>Sin datos</strong>No hay planteles del municipio Maturín en GESCOLAR.</div>`;
  const totParr = parr.reduce((x, o) => x + o.total, 0), cargParr = parr.reduce((x, o) => x + o.instrumento, 0);

  document.getElementById("dash").innerHTML = `
    <div class="stats-grid">
      ${tarjeta("", n(d.total), "Planteles en GESCOLAR", "")}
      ${tarjeta("stat-success acento-sello", n(d.atendidos.cantidad), "Planteles atendidos", pct(d.atendidos.porcentaje) + " del total")}
      ${tarjeta("stat-alert acento-riesgo", n(d.atendidos.faltan), "Faltan por atender", pct(100 - d.atendidos.porcentaje) + " del total")}
      ${tarjeta("stat-purple", n(d.con_inspeccion.cantidad), "Planteles con inspección", pct(d.con_inspeccion.porcentaje) + " del total")}
    </div>

    <div class="dash-dos" style="margin-top:16px;">
      ${bloqueAvance("Planteles atendidos", "Tienen un tipo de atención (p. ej. GOTA DE AMOR), están en un plan de la hoja o del sistema, o los atendió otro ente (Gobernación, alcaldía, ministerio…).", d.atendidos, d.total, "ok")}
      ${bloqueAvance("Planteles con inspección", "Tienen un ingeniero RESPONSABLE en GESCOLAR.", d.con_inspeccion, d.total, "azul")}
    </div>

    <div class="panel" style="margin-top:16px;"><div class="dash-bloque">
      <h3>Planteles atendidos por programa</h3>
      <p class="dash-nota">Un plantel puede aparecer en más de un programa (por ejemplo, Gota de Amor y luego un plan de Bricomiles), pero en el total cuenta una sola vez. El porcentaje es sobre ${n(d.total)} planteles.</p>
      ${filasTipo}
      <div class="dash-pie"><span>Atendidos con inspección: <strong>${n(d.atendidos_con_inspeccion)}</strong></span><span>Atendidos sin inspección: <strong>${n(d.atendidos_sin_inspeccion)}</strong></span></div>
    </div></div>

    <div class="dash-dos" style="margin-top:16px;">
      <div class="panel"><div class="dash-bloque">
        <h3>Planteles por municipio</h3>
        <p class="dash-nota">Total de planteles de GESCOLAR y cuántos ya están cargados con el Instrumento Uno CDCE (visitas enviadas). Avance general: <strong>${n(iu.cantidad)}</strong> de ${n(d.total)} (${pct(iu.porcentaje)}).</p>
        ${filasMunBarra}
      </div></div>
      <div class="panel"><div class="dash-bloque">
        <h3>Parroquias del municipio Maturín</h3>
        <p class="dash-nota">Planteles por parroquia y avance del Instrumento Uno CDCE. Maturín: <strong>${n(cargParr)}</strong> de ${n(totParr)} cargados (${pct(totParr ? (cargParr / totParr) * 100 : 0)}).</p>
        ${filasParr}
      </div></div>
    </div>

    <div class="panel" style="margin-top:16px;"><div class="dash-bloque">
      <h3>Por municipio</h3>
      <div class="tabla-responsive"><table class="dash-tabla">
        <thead><tr><th>Municipio</th><th class="num">Planteles</th><th class="num">Atendidos</th><th class="num">% atendidos</th><th class="num">Faltan</th><th class="num">Con inspección</th><th class="num">% inspección</th></tr></thead>
        <tbody>${filasMun}</tbody>
      </table></div>
    </div></div>

    ${d.entes ? `<div class="panel" style="margin-top:16px;"><div class="dash-bloque">
      <h3>Atenciones por ente</h3>
      <p class="dash-nota">Cada plantel cuenta <strong>una sola vez</strong> en «Planteles atendidos», aunque lo hayan atendido FEDE y otros entes; sus atenciones quedan todas en el historial del plantel.</p>
      <div class="stats-grid">
        ${tarjeta("stat-success acento-sello", n(d.atendidos.cantidad), "Planteles atendidos (total general)", "FEDE + otros entes, sin repetir")}
        ${tarjeta("", n(d.entes.solo_otros), "Atendidos solo por otros entes", "")}
        ${tarjeta("stat-purple", n(d.entes.ambos), "Atendidos por FEDE y por otro ente", "")}
      </div>
      <div class="tabla-responsive" style="margin-top:12px;"><table class="dash-tabla"><thead><tr><th>Ente</th><th>Categoría</th><th class="num">Planteles</th><th class="num">Atenciones</th></tr></thead><tbody>
        <tr><td><strong>FEDE</strong></td><td>FEDE (Bricomiles y programas)</td><td class="num">${n(d.entes.fede.planteles)}</td><td class="num">${n(d.entes.fede.atenciones)}</td></tr>
        ${d.entes.otros.map((o) => `<tr><td>${escapar(o.ente)}</td><td>${escapar(CATEGORIAS_ENTE[o.categoria] || o.categoria)}</td><td class="num">${n(o.planteles)}</td><td class="num">${n(o.atenciones)}</td></tr>`).join("")}
        ${d.entes.categorias.length ? `<tr><td colspan="4" style="background:#f4f7fb; font-size:.72rem; text-transform:uppercase;">Por categoría de ente</td></tr>
        ${d.entes.categorias.map((o) => `<tr><td colspan="2">${escapar(CATEGORIAS_ENTE[o.categoria] || o.categoria)}</td><td class="num">${n(o.planteles)}</td><td class="num">${n(o.atenciones)}</td></tr>`).join("")}` : ""}
      </tbody></table></div>
      <p style="margin:10px 0 0;"><a href="/inspecciones/otros-entes.html">Ver atenciones de otros entes →</a></p>
    </div></div>` : ""}

    ${d.comunal ? `<div class="panel" style="margin-top:16px;"><div class="dash-bloque">
      <h3>Proyectos comunales</h3>
      <p class="dash-nota">Atenciones menores que ejecutan los circuitos comunales con el proyecto que eligen en su consulta. <strong>No suman</strong> en «Planteles atendidos»; aquí solo se cuenta cuántos planteles tienen proyecto comunal.</p>
      <div class="stats-grid">
        ${tarjeta("stat-purple", n(d.comunal.planteles), "Planteles con proyecto comunal", pct(d.comunal.porcentaje) + " del total")}
        ${tarjeta("", n(d.comunal.proyectos), "Proyectos comunales", d.comunal.sin_planteles ? n(d.comunal.sin_planteles) + " sin planteles definidos" : "")}
        ${tarjeta("stat-success acento-sello", n(d.comunal.atendidos), "Planteles ya atendidos por proyecto comunal", "")}
      </div>
      <p style="margin:10px 0 0;"><a href="/inspecciones/proyectos-comunales.html">Ver proyectos comunales →</a></p>
    </div></div>` : ""}

    <div class="panel" style="margin-top:16px;"><div class="dash-bloque">
      <h3>Dentro del módulo de Inspecciones</h3>
      <p class="dash-nota">${d.columnas_plan ? "" : "Todavía no hay columnas de plan en GESCOLAR («PLAN <nombre>»): se crean al registrar un plan. "}Planes y planillas de materiales cargadas en el sistema.</p>
      <div class="stats-grid">
        ${tarjeta("", n(d.modulo.planes), "Planes de atención", "")}
        ${tarjeta("", n(d.modulo.en_planes), "Planteles en planes", "")}
        ${tarjeta("stat-success acento-sello", n(d.modulo.cargadas), "Planillas cargadas", "")}
        ${tarjeta("stat-alert acento-riesgo", n(d.modulo.borradores), "Planillas en borrador", "")}
      </div>
    </div></div>`;
}
