// supervision-planteles.js — panel de administración (rol admin/supervision):
// catálogo propio de planteles de Supervisión (independiente de GESCOLAR/RAC).
// Permite buscar, crear y editar planteles, y cargar su matrícula (hembras y
// varones por período escolar, con histórico). El backend no expone borrado
// para este catálogo, así que aquí tampoco se ofrece esa acción.

const usuario = renderShell("supervision-planteles", "Supervisión · Planteles");
const LIMITE_LISTADO = 300; // el backend corta el listado en 300 filas

let planteles = [];
let totalCatalogo = null; // total real de planteles (viene de /resumen)
let matriculaPorPlantel = {}; // codigo_plantel -> última matrícula (viene de /consolidado)
let editando = null; // codigo_plantel en edición, o null si el formulario es "nuevo"
let textoBusqueda = "";
let temporizadorBusqueda;
let contadorBusqueda = 0; // descarta respuestas viejas si el usuario sigue escribiendo
let historialActual = []; // histórico de matrícula del plantel que se edita

if (usuario) iniciar();

async function iniciar() {
  dibujarPantalla();
  await refrescar();
}

// Año escolar vigente: arranca en septiembre (ej. oct-2026 -> "2026-2027").
function periodoActual() {
  const hoy = new Date();
  const anio = hoy.getFullYear();
  return hoy.getMonth() >= 8 ? `${anio}-${anio + 1}` : `${anio - 1}-${anio}`;
}

// Total real del catálogo y última matrícula por plantel. Si alguno falla, la
// pantalla sigue funcionando (solo se ve "—" en la columna de matrícula).
async function cargarExtras() {
  try {
    const resumen = await RAC.get("/api/supervision/resumen");
    totalCatalogo = Number(resumen.planteles);
  } catch (_) { /* se usa el conteo del listado */ }
  try {
    const resp = await RAC.get("/api/supervision/consolidado");
    const mapa = {};
    RAC.lista(resp, "consolidado").forEach((f) => {
      if (f.matricula_periodo) {
        mapa[f.codigo_plantel] = {
          periodo: f.matricula_periodo,
          hembras: f.matricula_hembras,
          varones: f.matricula_varones,
          total: f.matricula_total,
        };
      }
    });
    matriculaPorPlantel = mapa;
  } catch (_) { /* sin matrícula en la tabla */ }
}

async function refrescar(recargarExtras = true) {
  const id = ++contadorBusqueda;
  const tabla = document.getElementById("tablaPlanteles");
  tabla.innerHTML = `<div class="cargando">Cargando planteles…</div>`;
  try {
    const q = textoBusqueda.trim();
    const [resp] = await Promise.all([
      RAC.get(`/api/supervision/planteles${q ? `?q=${encodeURIComponent(q)}` : ""}`),
      recargarExtras ? cargarExtras() : null,
    ]);
    if (id !== contadorBusqueda) return;
    planteles = RAC.lista(resp, "planteles");
    dibujarTabla();
  } catch (err) {
    if (id !== contadorBusqueda) return;
    tabla.innerHTML = `<div class="vacio"><strong>No se pudo cargar</strong>${escapar(err.message)}</div>`;
  }
}

function dibujarPantalla() {
  const contenido = document.getElementById("contenido");
  contenido.innerHTML = `
    <section class="planteles-hero">
      <div class="planteles-hero-copy">
        <span class="planteles-eyebrow">SUPERVISIÓN</span>
        <h1>Planteles</h1>
        <p id="heroConteo">Catálogo propio de Supervisión</p>
      </div>
    </section>

    <div class="panel" style="padding:20px; margin-bottom:20px; display:flex; gap:12px; flex-wrap:wrap; align-items:center; justify-content:space-between;">
      <input type="text" id="inputBuscar" placeholder="Buscar por código, epónimo o comuna…" style="flex:1; min-width:220px;" value="${escapar(textoBusqueda)}">
      <button type="button" class="btn" id="btnNuevo">+ Nuevo plantel</button>
    </div>

    <div class="panel" id="panelFormulario" style="padding:20px; margin-bottom:20px; display:none;"></div>

    <div class="panel" style="padding:20px;">
      <div id="resumenListado" style="font-size:.8rem; color:var(--muted); margin-bottom:10px;"></div>
      <div id="tablaPlanteles"></div>
    </div>
  `;

  document.getElementById("inputBuscar").addEventListener("input", (e) => {
    textoBusqueda = e.target.value;
    clearTimeout(temporizadorBusqueda);
    temporizadorBusqueda = setTimeout(() => refrescar(false), 350);
  });
  document.getElementById("btnNuevo").addEventListener("click", () => abrirFormulario(null));
}

function textoMatricula(codigo) {
  const m = matriculaPorPlantel[codigo];
  if (!m) return `<span class="vacio-inline">Sin matrícula</span>`;
  const h = Number(m.hembras) || 0;
  const v = Number(m.varones) || 0;
  const t = m.total !== null && m.total !== undefined ? Number(m.total) : h + v;
  return `<strong>${t}</strong> <span style="color:var(--muted); font-size:.78rem;">(H ${h} · V ${v})</span>
          <div style="color:var(--muted); font-size:.72rem;">${escapar(m.periodo)}</div>`;
}

function dibujarTabla() {
  const q = textoBusqueda.trim();
  document.getElementById("heroConteo").textContent =
    `Catálogo propio de Supervisión · ${totalCatalogo !== null ? totalCatalogo : planteles.length} planteles cargados`;

  let resumen = "";
  if (q) {
    resumen = `${planteles.length} resultado${planteles.length === 1 ? "" : "s"} para "${q}"`;
  } else if (planteles.length >= LIMITE_LISTADO) {
    resumen = `Mostrando los primeros ${LIMITE_LISTADO}${totalCatalogo ? ` de ${totalCatalogo}` : ""}. Usa el buscador para encontrar un plantel.`;
  }
  document.getElementById("resumenListado").textContent = resumen;

  const cont = document.getElementById("tablaPlanteles");
  if (!planteles.length) {
    cont.innerHTML = q
      ? `<div class="vacio"><strong>Sin resultados</strong>Ningún plantel coincide con la búsqueda.</div>`
      : `<div class="vacio"><strong>Sin planteles cargados</strong>Usa "+ Nuevo plantel" para agregar el primero.</div>`;
    return;
  }

  cont.innerHTML = `
    <div class="tabla-responsive">
      <table>
        <thead><tr><th>Código</th><th>Epónimo actual</th><th>Denominación</th><th>Dependencia</th><th>Turno</th><th>Comuna</th><th>Matrícula</th><th></th></tr></thead>
        <tbody>${planteles.map((p) => `
          <tr>
            <td>${escapar(p.codigo_plantel)}</td>
            <td>${escapar(p.eponimo_actual)}</td>
            <td>${escapar(p.denominacion || "—")}</td>
            <td>${escapar(p.dependencia || "—")}</td>
            <td>${escapar(p.turno || "—")}</td>
            <td>${escapar(p.nombre_comuna || "—")}</td>
            <td>${textoMatricula(p.codigo_plantel)}</td>
            <td><button type="button" class="btn btn-sm" data-editar="${escapar(p.codigo_plantel)}">Editar</button></td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;

  cont.querySelectorAll("[data-editar]").forEach((btn) => {
    btn.addEventListener("click", () => abrirFormulario(planteles.find((p) => p.codigo_plantel === btn.dataset.editar)));
  });
}

async function abrirFormulario(plantel) {
  editando = plantel ? plantel.codigo_plantel : null;
  const p = plantel || {};
  const panel = document.getElementById("panelFormulario");
  panel.style.display = "block";
  panel.innerHTML = `<div class="cargando">Cargando plantel…</div>`;
  panel.scrollIntoView({ behavior: "smooth", block: "start" });

  // Histórico de matrícula del plantel (solo si ya existe).
  historialActual = [];
  let avisoMatricula = "";
  if (plantel) {
    try {
      const resp = await RAC.get(`/api/supervision/matricula/${encodeURIComponent(plantel.codigo_plantel)}`);
      historialActual = RAC.lista(resp, "matricula") || [];
    } catch (err) {
      avisoMatricula = `No se pudo cargar el histórico de matrícula (${err.message}).`;
    }
  }

  const dependencias = ["NACIONAL", "ESTADAL", "MUNICIPAL", "PRIVADA", "AUTÓNOMA", "SUBVENCIONADOS OFICIALES", "SUBVENCIONADA MPPE"];
  if (p.dependencia && !dependencias.includes(p.dependencia)) dependencias.push(p.dependencia);

  const periodo = periodoActual();
  const filaPeriodo = historialActual.find((f) => f.periodo_escolar === periodo);

  panel.innerHTML = `
    <h3 style="margin-bottom:14px;">${plantel ? `Editar plantel — ${escapar(p.codigo_plantel)}` : "Nuevo plantel"}</h3>
    <form id="formPlantel" style="display:grid; grid-template-columns:repeat(2,1fr); gap:12px;">
      <div><label>Código de plantel</label><input type="text" name="codigo_plantel" value="${escapar(p.codigo_plantel)}" ${plantel ? "readonly" : "required"}></div>
      <div><label>Epónimo actual</label><input type="text" name="eponimo_actual" value="${escapar(p.eponimo_actual)}" required></div>
      <div><label>Epónimo anterior</label><input type="text" name="eponimo_anterior" value="${escapar(p.eponimo_anterior)}"></div>
      <div><label>Denominación</label><input type="text" name="denominacion" value="${escapar(p.denominacion)}"></div>
      <div><label>Niveles / modalidad</label><input type="text" name="niveles_modalidad" value="${escapar(p.niveles_modalidad)}"></div>
      <div>
        <label>Dependencia</label>
        <select name="dependencia">
          <option value="">—</option>
          ${dependencias.map((v) => `<option value="${escapar(v)}" ${p.dependencia === v ? "selected" : ""}>${escapar(v)}</option>`).join("")}
        </select>
      </div>
      <div><label>Turno</label><input type="text" name="turno" value="${escapar(p.turno)}"></div>
      <div><label>Dirección</label><input type="text" name="direccion" value="${escapar(p.direccion)}"></div>
      <div><label>Comuna (código)</label><input type="text" name="cod_comuna" value="${escapar(p.cod_comuna)}"></div>
      <div><label>Comuna (nombre)</label><input type="text" name="nombre_comuna" value="${escapar(p.nombre_comuna)}"></div>
      <div><label>Coordenadas geo</label><input type="text" name="coordenadas_geo" value="${escapar(p.coordenadas_geo)}"></div>
      <div><label>Ubicación geo</label><input type="text" name="ubicacion_geo" value="${escapar(p.ubicacion_geo)}"></div>

      <div style="grid-column:1/-1; border-top:1px solid var(--rac-border, #dfe7f0); padding-top:14px; margin-top:4px;">
        <h3 style="margin-bottom:4px;">Matrícula</h3>
        <p style="font-size:.8rem; color:var(--muted); margin-bottom:12px;">
          Se guarda por período escolar: si el período ya existe se actualiza; si es uno nuevo se agrega al histórico sin tocar los anteriores. Déjala en blanco para no cambiarla.
        </p>
        ${avisoMatricula ? `<p style="font-size:.8rem; color:#b7791f; margin-bottom:10px;">${escapar(avisoMatricula)}</p>` : ""}
        <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:12px; align-items:end;">
          <div>
            <label>Período escolar</label>
            <input type="text" name="periodo_escolar" id="inputPeriodo" list="listaPeriodos" value="${escapar(periodo)}" placeholder="2026-2027" autocomplete="off">
            <datalist id="listaPeriodos">${historialActual.map((f) => `<option value="${escapar(f.periodo_escolar)}"></option>`).join("")}</datalist>
          </div>
          <div><label>Hembras</label><input type="number" name="hembras" id="inputHembras" min="0" step="1" value="${filaPeriodo ? escapar(filaPeriodo.hembras) : ""}"></div>
          <div><label>Varones</label><input type="number" name="varones" id="inputVarones" min="0" step="1" value="${filaPeriodo ? escapar(filaPeriodo.varones) : ""}"></div>
          <div><label>Total</label><div id="textoTotal" style="padding:9px 0; font-weight:700;">—</div></div>
        </div>
        ${historialActual.length ? `
          <div class="tabla-responsive" style="margin-top:14px;">
            <table>
              <thead><tr><th>Período</th><th>Hembras</th><th>Varones</th><th>Total</th><th></th></tr></thead>
              <tbody>${historialActual.map((f) => `
                <tr>
                  <td>${escapar(f.periodo_escolar)}</td>
                  <td>${escapar(f.hembras)}</td>
                  <td>${escapar(f.varones)}</td>
                  <td>${escapar(f.total !== null && f.total !== undefined ? f.total : (Number(f.hembras) || 0) + (Number(f.varones) || 0))}</td>
                  <td><button type="button" class="btn btn-sm btn-fantasma" data-cargar-periodo="${escapar(f.periodo_escolar)}">Cargar</button></td>
                </tr>`).join("")}
              </tbody>
            </table>
          </div>` : ""}
      </div>

      <div style="grid-column:1/-1; display:flex; gap:10px; margin-top:6px;">
        <button type="submit" class="btn" id="btnGuardarPlantel">Guardar</button>
        <button type="button" class="btn btn-fantasma" id="btnCancelarPlantel">Cancelar</button>
      </div>
    </form>
  `;
  panel.querySelectorAll("label").forEach((l) => { l.style.display = "block"; l.style.fontSize = ".78rem"; l.style.marginBottom = "4px"; });

  const inputPeriodo = document.getElementById("inputPeriodo");
  const inputHembras = document.getElementById("inputHembras");
  const inputVarones = document.getElementById("inputVarones");
  const textoTotal = document.getElementById("textoTotal");

  const actualizarTotal = () => {
    const h = inputHembras.value.trim();
    const v = inputVarones.value.trim();
    textoTotal.textContent = h === "" && v === "" ? "—" : String((Number(h) || 0) + (Number(v) || 0));
  };
  const cargarPeriodo = (nombre) => {
    const fila = historialActual.find((f) => f.periodo_escolar === nombre);
    if (!fila) return;
    inputPeriodo.value = fila.periodo_escolar;
    inputHembras.value = fila.hembras;
    inputVarones.value = fila.varones;
    actualizarTotal();
  };
  inputHembras.addEventListener("input", actualizarTotal);
  inputVarones.addEventListener("input", actualizarTotal);
  inputPeriodo.addEventListener("change", () => cargarPeriodo(inputPeriodo.value.trim()));
  panel.querySelectorAll("[data-cargar-periodo]").forEach((btn) => {
    btn.addEventListener("click", () => cargarPeriodo(btn.dataset.cargarPeriodo));
  });
  actualizarTotal();

  document.getElementById("btnCancelarPlantel").addEventListener("click", cerrarFormulario);
  document.getElementById("formPlantel").addEventListener("submit", guardarPlantel);
}

function cerrarFormulario() {
  const panel = document.getElementById("panelFormulario");
  panel.style.display = "none";
  panel.innerHTML = "";
}

async function guardarPlantel(e) {
  e.preventDefault();
  const boton = document.getElementById("btnGuardarPlantel");
  const datos = Object.fromEntries(new FormData(e.target).entries());

  // La matrícula va a su propio endpoint: se separa de los datos del plantel.
  const periodo = String(datos.periodo_escolar || "").trim();
  const hembras = String(datos.hembras ?? "").trim();
  const varones = String(datos.varones ?? "").trim();
  delete datos.periodo_escolar;
  delete datos.hembras;
  delete datos.varones;

  const quiereMatricula = hembras !== "" || varones !== "";
  if (quiereMatricula) {
    const esEntero = (t) => /^\d+$/.test(t);
    if (!periodo) { mostrarToast("Indica el período escolar de la matrícula.", true); return; }
    if (hembras === "" || varones === "") { mostrarToast("Para guardar la matrícula completa hembras y varones.", true); return; }
    if (!esEntero(hembras) || !esEntero(varones)) { mostrarToast("Hembras y varones deben ser números enteros (0 o más).", true); return; }
  }

  boton.disabled = true;
  try {
    let codigo = editando;
    if (editando) {
      await RAC.put(`/api/supervision/planteles/${encodeURIComponent(editando)}`, datos);
    } else {
      await RAC.post("/api/supervision/planteles", datos);
      codigo = String(datos.codigo_plantel || "").trim();
    }

    if (quiereMatricula) {
      try {
        await RAC.post(`/api/supervision/matricula/${encodeURIComponent(codigo)}`, {
          periodo_escolar: periodo,
          hembras: Number(hembras),
          varones: Number(varones),
        });
      } catch (err) {
        mostrarToast(`Plantel guardado, pero la matrícula no: ${err.message}`, true);
        cerrarFormulario();
        refrescar();
        return;
      }
    }

    mostrarToast(editando ? "Plantel actualizado." : "Plantel creado.");
    cerrarFormulario();
    refrescar();
  } catch (err) {
    mostrarToast(err.message, true);
  } finally {
    boton.disabled = false;
  }
}

function escapar(valor) {
  if (valor === undefined || valor === null) return "";
  return String(valor).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
