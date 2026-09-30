// supervision-circuitos.js — catálogo de circuitos educativos (Supervisión).
// Muestra los circuitos con su supervisor circuital y sus planteles; marca los
// que no tienen supervisor; permite crear un circuito nuevo, cambiarle el
// nombre y asignar/quitar planteles. Todo con el mismo estilo del Resumen
// (estilos en línea + clases ya existentes) y sin handlers inline (CSP).
const BASE = "/api/supervision";

const usuario = renderShell("supervision-circuitos", "Supervisión · Circuitos");

let CIRCUITOS = [];
let TEXTO = "";
let SOLO_SIN_SUPERVISOR = false;

// api.js puede o no tener RAC.put: si no, se usa patch (el backend acepta ambos).
const enviarPut = (ruta, cuerpo) => (typeof RAC.put === "function" ? RAC.put(ruta, cuerpo) : RAC.patch(ruta, cuerpo));

if (usuario) cargarPantalla();

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") cerrarModal();
});

async function cargarPantalla() {
  const contenido = document.getElementById("contenido");
  contenido.innerHTML = `<div class="cargando">Cargando circuitos…</div>`;
  try {
    const datos = await RAC.get(`${BASE}/circuitos`);
    CIRCUITOS = datos.circuitos || [];
    dibujarPantalla();
  } catch (err) {
    contenido.innerHTML = `<div class="panel" style="padding:20px;"><div class="vacio"><strong>No se pudo cargar</strong>${escapar(err.message)}</div></div>`;
  }
}

async function recargarLista() {
  const datos = await RAC.get(`${BASE}/circuitos`);
  CIRCUITOS = datos.circuitos || [];
  pintarTarjetas();
  pintarTabla();
}

function dibujarPantalla() {
  const contenido = document.getElementById("contenido");
  contenido.innerHTML = `
    <section class="planteles-hero">
      <div class="planteles-hero-copy">
        <span class="planteles-eyebrow">SUPERVISIÓN</span>
        <h1>Circuitos</h1>
        <p>Catálogo de circuitos educativos con su supervisor circuital y sus planteles</p>
      </div>
    </section>

    <div id="circ-tarjetas" style="display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:16px; margin-bottom:16px;"></div>

    <div class="panel" style="padding:16px;">
      <div style="display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin-bottom:12px;">
        <input id="circ-buscar" type="search" placeholder="Buscar por código, circuito, municipio o supervisor…"
          style="flex:1; min-width:220px; padding:9px 12px; border:1px solid rgba(0,0,0,.18); border-radius:8px; font:inherit;">
        <label style="display:flex; align-items:center; gap:6px; font-size:.9rem; cursor:pointer;">
          <input type="checkbox" id="circ-solo-sin"> Solo sin supervisor
        </label>
        <button type="button" class="btn btn-sm" id="circ-nuevo">+ Nuevo circuito</button>
      </div>
      <div id="circ-tabla"></div>
    </div>
    <div id="circ-modal"></div>
  `;

  document.getElementById("circ-buscar").addEventListener("input", (e) => {
    TEXTO = e.target.value;
    pintarTabla();
  });
  document.getElementById("circ-solo-sin").addEventListener("change", (e) => {
    SOLO_SIN_SUPERVISOR = e.target.checked;
    pintarTabla();
  });
  document.getElementById("circ-nuevo").addEventListener("click", abrirNuevo);
  document.getElementById("circ-tabla").addEventListener("click", (e) => {
    const boton = e.target.closest("[data-accion]");
    if (!boton) return;
    const codigo = boton.dataset.codigo;
    if (boton.dataset.accion === "ver") abrirDetalle(codigo);
    if (boton.dataset.accion === "editar") abrirEditar(codigo);
  });

  pintarTarjetas();
  pintarTabla();
}

function pintarTarjetas() {
  const total = CIRCUITOS.length;
  const sin = CIRCUITOS.filter((c) => !c.supervisor).length;
  const planteles = CIRCUITOS.reduce((acc, c) => acc + Number(c.planteles || 0), 0);
  const tarjeta = (titulo, valor, nota, color) => `
    <div class="panel" style="padding:18px;">
      <div style="font-size:.78rem; text-transform:uppercase; color:#718096; margin-bottom:8px;">${escapar(titulo)}</div>
      <div style="font-family:'Space Grotesk',sans-serif; font-size:2rem; font-weight:700; ${color ? `color:${color};` : ""}">${valor}</div>
      <div style="font-size:.82rem; color:var(--muted);">${escapar(nota)}</div>
    </div>`;
  document.getElementById("circ-tarjetas").innerHTML =
    tarjeta("Circuitos", total, "en el catálogo") +
    tarjeta("Con supervisor", total - sin, "circuitos cubiertos", "#2f855a") +
    tarjeta("Sin supervisor", sin, sin ? "falta cargar el supervisor" : "todos cubiertos", sin ? "#b7791f" : "#2f855a") +
    tarjeta("Planteles", planteles, "asignados a un circuito");
}

function pintarTabla() {
  const q = normalizar(TEXTO);
  const filas = CIRCUITOS.filter((c) => {
    if (SOLO_SIN_SUPERVISOR && c.supervisor) return false;
    if (!q) return true;
    return normalizar([c.codigo_circuito, c.nombre, c.municipio, c.supervisor].join(" ")).includes(q);
  });
  const cont = document.getElementById("circ-tabla");
  if (!filas.length) {
    cont.innerHTML = `<div class="vacio"><strong>Sin resultados</strong>Prueba con otra búsqueda.</div>`;
    return;
  }
  const th = "text-align:left; padding:8px 10px; font-size:.75rem; text-transform:uppercase; color:#718096; border-bottom:1px solid rgba(0,0,0,.12); white-space:nowrap;";
  const td = "padding:9px 10px; border-bottom:1px solid rgba(0,0,0,.06); vertical-align:middle;";
  cont.innerHTML = `
    <div style="font-size:.82rem; color:var(--muted); margin-bottom:8px;">${filas.length} de ${CIRCUITOS.length} circuitos</div>
    <div style="overflow-x:auto;">
      <table style="width:100%; border-collapse:collapse; font-size:.9rem;">
        <thead><tr>
          <th style="${th}">Código</th><th style="${th}">Circuito</th><th style="${th}">Municipio</th>
          <th style="${th} text-align:right;">Planteles</th><th style="${th}">Supervisor circuital</th><th style="${th}"></th>
        </tr></thead>
        <tbody>
          ${filas.map((c) => `
            <tr${c.supervisor ? "" : ' style="background:rgba(183,121,31,.07);"'}>
              <td style="${td} font-family:monospace;">${escapar(c.codigo_circuito)}</td>
              <td style="${td}"><strong>${escapar(c.nombre)}</strong>${c.activo === false ? ' <span style="color:#a0aec0; font-size:.78rem;">(inactivo)</span>' : ""}</td>
              <td style="${td}">${escapar(c.municipio || "—")}</td>
              <td style="${td} text-align:right;">${Number(c.planteles || 0)}</td>
              <td style="${td}">${c.supervisor ? escapar(c.supervisor) : '<span style="color:#b7791f; font-weight:600;">Sin supervisor</span>'}</td>
              <td style="${td} white-space:nowrap; text-align:right;">
                <button type="button" class="btn btn-fantasma btn-sm" data-accion="ver" data-codigo="${escapar(c.codigo_circuito)}">Ver</button>
                <button type="button" class="btn btn-fantasma btn-sm" data-accion="editar" data-codigo="${escapar(c.codigo_circuito)}">Editar</button>
              </td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
}

// ---------- modales ----------

function abrirModal(titulo, cuerpoHtml, ancho) {
  const cont = document.getElementById("circ-modal");
  cont.innerHTML = `
    <div id="circ-overlay" style="position:fixed; inset:0; background:rgba(15,23,42,.55); z-index:1000; display:flex; align-items:flex-start; justify-content:center; padding:4vh 12px; overflow:auto;">
      <div class="panel" style="background:#fff; width:100%; max-width:${ancho || 560}px; padding:20px; border-radius:14px;">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:12px; margin-bottom:14px;">
          <h2 style="margin:0; font-size:1.15rem;">${escapar(titulo)}</h2>
          <button type="button" class="btn btn-fantasma btn-sm" id="circ-cerrar">Cerrar</button>
        </div>
        <div id="circ-modal-cuerpo">${cuerpoHtml}</div>
      </div>
    </div>`;
  document.getElementById("circ-cerrar").addEventListener("click", cerrarModal);
  document.getElementById("circ-overlay").addEventListener("mousedown", (e) => {
    if (e.target.id === "circ-overlay") cerrarModal();
  });
}

function cerrarModal() {
  const cont = document.getElementById("circ-modal");
  if (cont) cont.innerHTML = "";
}

function mensaje(texto, esError) {
  const el = document.getElementById("circ-msg");
  if (!el) return;
  el.style.color = esError ? "#c53030" : "#2f855a";
  el.textContent = texto || "";
}

const estiloInput = "width:100%; padding:9px 12px; border:1px solid rgba(0,0,0,.18); border-radius:8px; font:inherit; box-sizing:border-box;";
const estiloLabel = "display:block; font-size:.8rem; color:#4a5568; margin:10px 0 4px;";

function abrirNuevo() {
  abrirModal("Nuevo circuito", `
    <p style="margin:0 0 6px; font-size:.88rem; color:var(--muted);">
      El código tiene 9 dígitos y sus 4 primeros identifican el municipio (ej. 1601 = Acosta).
    </p>
    <label style="${estiloLabel}" for="nc-codigo">Código del circuito</label>
    <input id="nc-codigo" inputmode="numeric" maxlength="9" placeholder="160101001" style="${estiloInput}">
    <label style="${estiloLabel}" for="nc-nombre">Nombre del circuito</label>
    <input id="nc-nombre" placeholder="Ej. SIMÓN BOLÍVAR" style="${estiloInput}">
    <div id="circ-msg" style="min-height:1.2em; margin-top:10px; font-size:.88rem;"></div>
    <div style="margin-top:12px; text-align:right;"><button type="button" class="btn btn-sm" id="nc-guardar">Guardar circuito</button></div>
  `, 480);
  document.getElementById("nc-guardar").addEventListener("click", async () => {
    const codigo = document.getElementById("nc-codigo").value.trim();
    const nombre = document.getElementById("nc-nombre").value.trim();
    if (!/^\d{9}$/.test(codigo)) return mensaje("El código debe tener exactamente 9 dígitos.", true);
    if (!nombre) return mensaje("Falta el nombre del circuito.", true);
    try {
      await RAC.post(`${BASE}/circuitos`, { codigo_circuito: codigo, nombre });
      cerrarModal();
      await recargarLista();
    } catch (err) {
      mensaje(err.message, true);
    }
  });
}

function abrirEditar(codigo) {
  const c = CIRCUITOS.find((x) => x.codigo_circuito === codigo);
  if (!c) return;
  abrirModal("Editar circuito", `
    <div style="font-size:.85rem; color:var(--muted);">Código: <span style="font-family:monospace;">${escapar(c.codigo_circuito)}</span> (no se puede cambiar)</div>
    <label style="${estiloLabel}" for="ec-nombre">Nombre del circuito</label>
    <input id="ec-nombre" value="${escapar(c.nombre)}" style="${estiloInput}">
    <label style="display:flex; align-items:center; gap:6px; margin-top:12px; font-size:.9rem; cursor:pointer;">
      <input type="checkbox" id="ec-activo" ${c.activo === false ? "" : "checked"}> Circuito activo
    </label>
    <div id="circ-msg" style="min-height:1.2em; margin-top:10px; font-size:.88rem;"></div>
    <div style="margin-top:12px; text-align:right;"><button type="button" class="btn btn-sm" id="ec-guardar">Guardar cambios</button></div>
  `, 480);
  document.getElementById("ec-guardar").addEventListener("click", async () => {
    const nombre = document.getElementById("ec-nombre").value.trim();
    if (!nombre) return mensaje("Falta el nombre del circuito.", true);
    try {
      await enviarPut(`${BASE}/circuitos/${encodeURIComponent(codigo)}`, {
        nombre,
        activo: document.getElementById("ec-activo").checked,
      });
      cerrarModal();
      await recargarLista();
    } catch (err) {
      mensaje(err.message, true);
    }
  });
}

async function abrirDetalle(codigo) {
  abrirModal(`Circuito ${codigo}`, `<div class="cargando">Cargando…</div>`, 860);
  await pintarDetalle(codigo);
}

async function pintarDetalle(codigo) {
  const cuerpo = document.getElementById("circ-modal-cuerpo");
  if (!cuerpo) return;
  try {
    const d = await RAC.get(`${BASE}/circuitos/${encodeURIComponent(codigo)}`);
    const th = "text-align:left; padding:6px 8px; font-size:.74rem; text-transform:uppercase; color:#718096; border-bottom:1px solid rgba(0,0,0,.12);";
    const td = "padding:7px 8px; border-bottom:1px solid rgba(0,0,0,.06);";
    cuerpo.innerHTML = `
      <div style="font-size:1.05rem; font-weight:600; margin-bottom:10px;">${escapar(d.circuito.nombre)}</div>

      <div style="font-size:.78rem; text-transform:uppercase; color:#718096; margin-bottom:6px;">Supervisor circuital</div>
      ${d.supervisores.length
        ? d.supervisores.map((s) => `<div style="margin-bottom:4px;"><strong>${escapar(s.nombres)} ${escapar(s.apellidos)}</strong>
            <span style="color:var(--muted); font-size:.85rem;"> · ${escapar(s.telefono || "sin teléfono")} · ${escapar(s.correo || "sin correo")}</span></div>`).join("")
        : `<div style="color:#b7791f; font-weight:600; margin-bottom:4px;">Sin supervisor cargado</div>`}

      <div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin:16px 0 6px;">
        <input id="dp-codigo" placeholder="Código de plantel a agregar" style="${estiloInput} flex:1; min-width:200px; width:auto;">
        <button type="button" class="btn btn-sm" id="dp-agregar">Agregar plantel</button>
      </div>
      <div id="circ-msg" style="min-height:1.2em; font-size:.88rem; margin-bottom:6px;"></div>

      <div style="font-size:.78rem; text-transform:uppercase; color:#718096; margin:8px 0 6px;">Planteles del circuito (${d.planteles.length})</div>
      ${d.planteles.length ? `
        <div style="overflow-x:auto;">
          <table style="width:100%; border-collapse:collapse; font-size:.88rem;">
            <thead><tr><th style="${th}">Código</th><th style="${th}">Plantel</th><th style="${th}">Municipio</th><th style="${th}">Parroquia</th><th style="${th}"></th></tr></thead>
            <tbody>${d.planteles.map((p) => `
              <tr>
                <td style="${td} font-family:monospace;">${escapar(p.codigo_plantel)}</td>
                <td style="${td}">${escapar(p.eponimo_actual)}</td>
                <td style="${td}">${escapar(p.municipio || "—")}</td>
                <td style="${td}">${escapar(p.parroquia || "—")}</td>
                <td style="${td} text-align:right;"><button type="button" class="btn btn-fantasma btn-sm" data-quitar="${escapar(p.codigo_plantel)}">Quitar</button></td>
              </tr>`).join("")}
            </tbody>
          </table>
        </div>` : `<div class="vacio"><strong>Sin planteles</strong>Este circuito todavía no tiene planteles asignados.</div>`}
    `;

    document.getElementById("dp-agregar").addEventListener("click", async () => {
      const cod = document.getElementById("dp-codigo").value.trim().toUpperCase();
      if (!cod) return mensaje("Escribe el código del plantel.", true);
      try {
        await RAC.post(`${BASE}/circuitos/${encodeURIComponent(codigo)}/planteles`, { codigo_plantel: cod });
        await pintarDetalle(codigo);
        await recargarLista();
      } catch (err) {
        mensaje(err.message, true);
      }
    });
    cuerpo.querySelectorAll("[data-quitar]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const cod = btn.dataset.quitar;
        if (!window.confirm(`¿Quitar el plantel ${cod} de este circuito?`)) return;
        try {
          await RAC.del(`${BASE}/circuitos/${encodeURIComponent(codigo)}/planteles/${encodeURIComponent(cod)}`);
          await pintarDetalle(codigo);
          await recargarLista();
        } catch (err) {
          mensaje(err.message, true);
        }
      });
    });
  } catch (err) {
    cuerpo.innerHTML = `<div class="vacio"><strong>No se pudo cargar</strong>${escapar(err.message)}</div>`;
  }
}

// ---------- utilidades ----------

function normalizar(valor) {
  return String(valor === undefined || valor === null ? "" : valor)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function escapar(valor) {
  if (valor === undefined || valor === null) return "";
  return String(valor)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
