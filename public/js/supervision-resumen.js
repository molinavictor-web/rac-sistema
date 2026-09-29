// supervision-resumen.js — dashboard con tarjetas de conteo por categoría.
// Los "esperados" de planteles/municipales/circuitales son la cardinalidad
// real del archivo Excel original (SUPERVISORES_Y_DIRECTORES_ACTUALIZADO_
// 24-09-2026.xlsm): 990 planteles (989 cargados + 1 pendiente por falta de
// código), 14 supervisores municipales y 119 supervisores circuitales. Si
// el universo de referencia cambia, ajustar estos números.
// El esperado de DIRECTORES no es un número fijo: en teoría cada plantel
// debe tener su director, así que se compara contra la cantidad de
// planteles ya cargados (ver dibujarPantalla).
const ESPERADOS = {
  planteles: 990,
  supervisores_municipales: 14,
  supervisores_circuitales: 119,
};

const TARJETAS = [
  { clave: "planteles", titulo: "Planteles", enlace: "/supervision/planteles.html" },
  { clave: "supervisores_municipales", titulo: "Supervisores municipales", enlace: "/supervision/municipales.html" },
  { clave: "supervisores_circuitales", titulo: "Supervisores circuitales", enlace: "/supervision/circuitales.html" },
  { clave: "directores", titulo: "Directores", enlace: "/supervision/directores.html" },
];

const usuario = renderShell("supervision-resumen", "Supervisión · Resumen");

if (usuario) cargarPantalla();

async function cargarPantalla() {
  const contenido = document.getElementById("contenido");
  contenido.innerHTML = `<div class="cargando">Calculando resumen…</div>`;
  try {
    const datos = await RAC.get("/api/supervision/resumen");
    dibujarPantalla(datos);
  } catch (err) {
    contenido.innerHTML = `<div class="panel" style="padding:20px;"><div class="vacio"><strong>No se pudo cargar</strong>${escapar(err.message)}</div></div>`;
  }
}

function dibujarPantalla(datos) {
  const contenido = document.getElementById("contenido");
  contenido.innerHTML = `
    <section class="planteles-hero">
      <div class="planteles-hero-copy">
        <span class="planteles-eyebrow">SUPERVISIÓN</span>
        <h1>Resumen</h1>
        <p>Avance de carga frente al universo del archivo original de Supervisión</p>
      </div>
    </section>

    <div class="tarjetas-resumen" style="display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:16px;">
      ${TARJETAS.map((t) => {
        const cargados = Number(datos[t.clave] || 0);
        // Directores: el esperado es dinámico (un director por cada plantel
        // ya cargado). Los demás usan la cardinalidad fija del Excel.
        const esperado = t.clave === "directores" ? Number(datos.planteles || 0) : ESPERADOS[t.clave];
        const faltan = Math.max(esperado - cargados, 0);
        const porcentaje = esperado ? Math.min(Math.round((cargados / esperado) * 100), 100) : 0;
        return `
          <a href="${t.enlace}" class="panel" style="padding:20px; display:block; text-decoration:none; color:inherit;">
            <div style="font-size:.78rem; text-transform:uppercase; color:#718096; margin-bottom:8px;">${escapar(t.titulo)}</div>
            <div style="font-family:'Space Grotesk',sans-serif; font-size:2rem; font-weight:700;">${cargados}</div>
            <div style="font-size:.82rem; color:var(--muted); margin-bottom:10px;">de ${esperado} esperados</div>
            <div style="height:6px; border-radius:999px; background:rgba(0,0,0,.08); overflow:hidden; margin-bottom:8px;">
              <div style="height:100%; width:${porcentaje}%; background:var(--acento, #2f6fed); border-radius:999px;"></div>
            </div>
            <div style="font-size:.82rem; ${faltan > 0 ? "color:#b7791f;" : "color:#2f855a;"}">
              ${faltan > 0 ? `Faltan ${faltan} por incluir` : "Completo"}
            </div>
          </a>`;
      }).join("")}
    </div>
  `;
}

function escapar(valor) {
  if (valor === undefined || valor === null) return "";
  return String(valor).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
