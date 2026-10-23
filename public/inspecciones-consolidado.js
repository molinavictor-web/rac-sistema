// inspecciones-consolidado.js — Inspecciones, etapa 2: consolidado oficial de
// un plan. Se calcula al momento a partir de las planillas de los planteles
// enlazados: si cambias una cantidad en una planilla, aquí cambia sola.
// Solo cuentan planteles activos en el plan y cantidades mayores que cero.

const usuario = renderShell("inspecciones-planes", "Consolidado del plan");
const PLAN_ID = Number(new URLSearchParams(window.location.search).get("plan"));
let CONS = null;

if (usuario) {
  if (!PLAN_ID) error("Falta indicar el plan. Entra desde un plan de atención.");
  else cargar();
}

function error(mensaje) {
  document.getElementById("contenido").innerHTML = `
    <div class="panel"><div class="vacio"><strong>No se pudo abrir el consolidado</strong>${escapar(mensaje)}<br><br>
    <a class="btn btn-fantasma btn-sm" href="/inspecciones/planes.html">← Volver a los planes</a></div></div>`;
}

async function cargar() {
  document.getElementById("contenido").innerHTML = `<div class="panel"><div class="cargando">Calculando consolidado…</div></div>`;
  try {
    CONS = await RAC.get(`/api/inspecciones/planes/${PLAN_ID}/consolidado`);
  } catch (err) {
    error(err.message);
    return;
  }
  dibujar();
}

function formato(n) {
  // Sin redondear: se muestran los decimales que tenga (máx. 3), con coma.
  return Number(n).toLocaleString("es-VE", { maximumFractionDigits: 3 });
}

function dibujar() {
  const { plan, planteles, rubros } = CONS;
  const conCantidad = rubros.filter((r) => r.total > 0).length;

  document.getElementById("contenido").innerHTML = `
    <section class="planteles-hero">
      <div class="planteles-hero-copy">
        <span class="planteles-eyebrow">CONSOLIDADO OFICIAL · ${escapar(plan.version_catalogo)}</span>
        <h1>${escapar(plan.nombre)}</h1>
        <p>${planteles.length} plantel${planteles.length === 1 ? "" : "es"} en el plan · ${conCantidad} rubro${conCantidad === 1 ? "" : "s"} con cantidad.</p>
      </div>
    </section>
    <div class="panel">
      <div style="padding:14px 20px; display:flex; gap:10px; flex-wrap:wrap; align-items:center; justify-content:space-between;">
        <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
          <a class="btn btn-fantasma btn-sm" href="/inspecciones/planes.html#plan-${Number(plan.id)}">← Volver al plan</a>
          <label style="font-size:.82rem; display:flex; gap:6px; align-items:center;"><input type="checkbox" id="soloConCantidad" checked> Solo rubros con cantidad</label>
          <input type="search" id="buscar" placeholder="Buscar un rubro…" style="padding:7px 10px; border:1px solid var(--borde); border-radius:8px; min-width:200px;">
        </div>
        <span style="color:var(--rac-muted,#718198); font-size:.78rem;">Se calcula al momento; no se guarda aparte.</span>
      </div>
      <div id="zonaTabla"></div>
    </div>
  `;
  document.getElementById("soloConCantidad").addEventListener("change", pintarTabla);
  document.getElementById("buscar").addEventListener("input", pintarTabla);
  pintarTabla();
}

function pintarTabla() {
  const { planteles, rubros } = CONS;
  const soloCon = document.getElementById("soloConCantidad").checked;
  const q = document.getElementById("buscar").value.trim().toLowerCase();
  const zona = document.getElementById("zonaTabla");

  if (!planteles.length) {
    zona.innerHTML = `<div class="vacio"><strong>Este plan todavía no tiene planteles</strong>Agrégalos desde el plan y carga sus planillas.</div>`;
    return;
  }

  const visibles = rubros.filter((r) => (!soloCon || r.total > 0) && (!q || r.rubro.toLowerCase().includes(q)));
  if (!visibles.length) {
    zona.innerHTML = `<div class="vacio"><strong>${soloCon && !q ? "Aún no hay cantidades cargadas" : "Sin resultados"}</strong>${soloCon && !q ? "Carga las planillas de los planteles y vuelve aquí." : "Prueba con otro texto."}</div>`;
    return;
  }

  const cabeceras = planteles.map((p) =>
    `<th class="plantel num"><a href="/inspecciones/planilla.html?id=${Number(p.inspeccion_id)}&plan=${Number(CONS.plan.id)}" title="Abrir la planilla">${escapar(p.nombre_plantel)}</a></th>`).join("");
  const columnas = planteles.length + 4;

  let capActual = null;
  const filas = [];
  visibles.forEach((r) => {
    if (r.capitulo !== capActual) {
      capActual = r.capitulo;
      filas.push(`<tr class="cap"><td colspan="${columnas}">${escapar(capActual)}</td></tr>`);
    }
    const celdas = planteles.map((p) => {
      const v = r.cantidades[p.inspeccion_id];
      return v > 0 ? `<td class="num">${formato(v)}</td>` : `<td class="num cero">·</td>`;
    }).join("");
    filas.push(`
      <tr>
        <td class="rubro"><span style="color:var(--rac-muted,#718198); font-size:.72rem;">${r.nro}.</span> ${escapar(r.rubro)}</td>
        <td class="uni">${escapar(r.unidad)}</td>
        ${celdas}
        <td class="num">${r.planteles_con_cantidad || ""}</td>
        <td class="num total">${r.total > 0 ? formato(r.total) : "—"}</td>
      </tr>`);
  });

  zona.innerHTML = `
    <div class="co-scroll">
      <table class="co-tabla">
        <thead><tr><th class="rubro">Rubro</th><th>Unidad</th>${cabeceras}<th class="num">N.º planteles</th><th class="num total">TOTAL</th></tr></thead>
        <tbody>${filas.join("")}</tbody>
      </table>
    </div>`;
}

function escapar(valor) {
  if (valor === undefined || valor === null) return "";
  return String(valor)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
