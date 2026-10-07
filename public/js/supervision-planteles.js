// supervision-planteles.js — panel de administración (rol admin/supervision):
// catálogo propio de planteles de Supervisión (independiente de GESCOLAR/RAC).
// Permite buscar, crear y editar planteles, asignarles sus niveles (Maternal,
// Preescolar, Primaria, ...) y cargar su matrícula (hembras y varones por nivel
// y período escolar, con histórico). El backend no expone borrado para este
// catálogo, así que aquí tampoco se ofrece esa acción.
//
// Si un plantel no tiene niveles asignados (o no se pudieron consultar), la
// matrícula se carga como un solo total de hembras y varones, igual que antes.
//
// La casilla "Está registrado en GESCOLAR" marca si el plantel cuenta para el
// reporte oficial; el filtro "Solo fuera de GESCOLAR" lista los que no están.
//
// Filtros "Solo sin director" y "Solo sin código DEA": trabajan sobre TODOS los
// planteles (vienen de /consolidado, sin el límite de 300 del listado). Un
// plantel sin código DEA se registra con un código provisional "SIN-DEA-001"
// (botón en el formulario de nuevo plantel) y así queda contado y visible.

const usuario = renderShell("supervision-planteles", "Supervisión · Planteles");
const LIMITE_LISTADO = 300; // el backend corta el listado en 300 filas
const ESPERADO_PLANTELES = 990; // universo real; 1 plantel aún no tiene código DEA

let planteles = [];
let totalCatalogo = null; // total real de planteles (viene de /resumen)
let matriculaPorPlantel = {}; // codigo_plantel -> última matrícula (viene de /consolidado)
let todosPlanteles = []; // todos los planteles con su director (viene de /consolidado)
let directorPorPlantel = {}; // codigo_plantel -> nombre del director
let soloSinDirector = false;
let soloSinCodigo = false;
let soloFueraGescolar = false;
let editando = null; // codigo_plantel en edición, o null si el formulario es "nuevo"
let textoBusqueda = "";
let temporizadorBusqueda;
let contadorBusqueda = 0; // descarta respuestas viejas si el usuario sigue escribiendo
let historialActual = []; // histórico de matrícula (totales) del plantel que se edita

// Niveles del plantel que se edita
let nivelesDisponibles = false; // false si no se pudo consultar el catálogo de niveles
let catalogoNiveles = []; // [{ clave, nombre, orden }]
let nivelesSel = new Set(); // claves marcadas en el formulario
let nivelesOriginales = []; // claves que tenía asignadas al abrir el formulario
let filasNivelActual = []; // matrícula por nivel ya cargada: [{ periodo_escolar, nivel, hembras, varones }]

// Lista larga con scroll interno y encabezado fijo.
(function () {
  if (document.getElementById("estiloListaScroll")) return;
  const st = document.createElement("style");
  st.id = "estiloListaScroll";
  st.textContent = ".lista-scroll{max-height:calc(100vh - 230px);min-height:320px;overflow:auto;}"
    + ".lista-scroll table{width:100%;font-size:.84rem;}"
    + ".lista-scroll th,.lista-scroll td{padding:8px;}"
    + ".lista-scroll td:first-child{white-space:nowrap;}"
    + ".lista-scroll thead th{position:sticky;top:0;z-index:2;background:#eef3f9;box-shadow:0 1px 0 #d9e1ec;white-space:nowrap;}";
  document.head.appendChild(st);
})();

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

function normalizar(valor) {
  return String(valor === undefined || valor === null ? "" : valor)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

const esProvisional = (codigo) => /^SIN-DEA-/i.test(String(codigo || ""));
const filtrosActivos = () => soloSinDirector || soloSinCodigo || soloFueraGescolar;

// Total real del catálogo, todos los planteles con su director y la última
// matrícula por plantel. Si alguno falla, la pantalla sigue funcionando.
async function cargarExtras() {
  try {
    const resumen = await RAC.get("/api/supervision/resumen");
    totalCatalogo = Number(resumen.planteles);
  } catch (_) { /* se usa el conteo del listado */ }
  try {
    const resp = await RAC.get("/api/supervision/consolidado");
    const filas = RAC.lista(resp, "consolidado") || [];
    const mapa = {};
    const directores = {};
    filas.forEach((f) => {
      if (f.matricula_periodo) {
        mapa[f.codigo_plantel] = {
          periodo: f.matricula_periodo,
          hembras: f.matricula_hembras,
          varones: f.matricula_varones,
          total: f.matricula_total,
        };
      }
      if (f.director_nombre) directores[f.codigo_plantel] = f.director_nombre;
    });
    matriculaPorPlantel = mapa;
    directorPorPlantel = directores;
    todosPlanteles = filas;
  } catch (_) { /* sin matrícula ni directores en la tabla */ }
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
      <div style="display:flex; gap:14px; flex-wrap:wrap; align-items:center; flex:1; min-width:260px;">
        <input type="text" id="inputBuscar" placeholder="Buscar por código, epónimo o comuna…" style="flex:1; min-width:220px;" value="${escapar(textoBusqueda)}">
        <label style="display:flex; gap:6px; align-items:center; font-size:.82rem; white-space:nowrap;">
          <input type="checkbox" id="chkSinDirector" ${soloSinDirector ? "checked" : ""}> Solo sin director <span id="cntSinDirector" style="color:var(--muted);"></span>
        </label>
        <label style="display:flex; gap:6px; align-items:center; font-size:.82rem; white-space:nowrap;">
          <input type="checkbox" id="chkSinCodigo" ${soloSinCodigo ? "checked" : ""}> Solo sin código DEA <span id="cntSinCodigo" style="color:var(--muted);"></span>
        </label>
        <label style="display:flex; gap:6px; align-items:center; font-size:.82rem; white-space:nowrap;">
          <input type="checkbox" id="chkFueraGescolar" ${soloFueraGescolar ? "checked" : ""}> Solo fuera de GESCOLAR <span id="cntFueraGescolar" style="color:var(--muted);"></span>
        </label>
      </div>
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
    if (filtrosActivos()) { dibujarTabla(); return; } // con filtros se busca en memoria
    temporizadorBusqueda = setTimeout(() => refrescar(false), 350);
  });
  document.getElementById("chkSinDirector").addEventListener("change", (e) => { soloSinDirector = e.target.checked; dibujarTabla(); });
  document.getElementById("chkSinCodigo").addEventListener("change", (e) => { soloSinCodigo = e.target.checked; dibujarTabla(); });
  document.getElementById("chkFueraGescolar").addEventListener("change", (e) => { soloFueraGescolar = e.target.checked; dibujarTabla(); });
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

// Con filtros activos se muestran TODOS los planteles que cumplan (sin el límite
// de 300 del listado); sin filtros, el listado normal del servidor.
function filasVisibles() {
  if (!filtrosActivos()) return planteles;
  const q = normalizar(textoBusqueda);
  return todosPlanteles.filter((f) =>
    (!soloSinDirector || !f.director_nombre) &&
    (!soloSinCodigo || esProvisional(f.codigo_plantel)) &&
    (!soloFueraGescolar || f.en_gescolar === false) &&
    (!q || normalizar([f.codigo_plantel, f.eponimo_actual, f.nombre_comuna].join(" ")).includes(q))
  );
}

function textoDirector(codigo) {
  if (!todosPlanteles.length) return "—";
  return directorPorPlantel[codigo]
    ? escapar(directorPorPlantel[codigo])
    : `<span style="color:#b7791f; font-weight:600;">Sin director</span>`;
}

function dibujarTabla() {
  const q = textoBusqueda.trim();
  const sinDirectorN = todosPlanteles.filter((f) => !f.director_nombre).length;
  const sinCodigoN = todosPlanteles.filter((f) => esProvisional(f.codigo_plantel)).length;
  const fueraGescolarN = todosPlanteles.filter((f) => f.en_gescolar === false).length;
  const faltaRegistrar = totalCatalogo !== null && totalCatalogo < ESPERADO_PLANTELES ? ESPERADO_PLANTELES - totalCatalogo : 0;

  document.getElementById("heroConteo").textContent =
    `Catálogo propio de Supervisión · ${totalCatalogo !== null ? totalCatalogo : planteles.length} planteles cargados`;
  if (todosPlanteles.length) {
    document.getElementById("cntSinDirector").textContent = `(${sinDirectorN})`;
    document.getElementById("cntSinCodigo").textContent = `(${sinCodigoN})`;
    document.getElementById("cntFueraGescolar").textContent = `(${fueraGescolarN})`;
  }

  const cont = document.getElementById("tablaPlanteles");
  if (filtrosActivos() && !todosPlanteles.length) {
    document.getElementById("resumenListado").textContent = "";
    cont.innerHTML = `<div class="vacio"><strong>No se pudieron cargar los datos para filtrar</strong>Recarga la pantalla e intenta de nuevo.</div>`;
    return;
  }

  const lista = filasVisibles();
  const notaFalta = faltaRegistrar && sinCodigoN === 0
    ? ` Falta registrar ${faltaRegistrar} plantel${faltaRegistrar === 1 ? "" : "es"} sin código DEA (EPE Celestina Reyes): usa "+ Nuevo plantel" y el botón "Usar código provisional".`
    : "";

  let resumen = "";
  if (filtrosActivos()) {
    const quienes = [soloSinDirector ? "sin director" : "", soloSinCodigo ? "sin código DEA" : "", soloFueraGescolar ? "fuera de GESCOLAR" : ""].filter(Boolean).join(" y ");
    resumen = `Mostrando ${lista.length} plantel${lista.length === 1 ? "" : "es"} ${quienes}${q ? ` para "${q}"` : ""}.${notaFalta}`;
  } else if (q) {
    resumen = `${lista.length} resultado${lista.length === 1 ? "" : "s"} para "${q}"`;
  } else if (planteles.length >= LIMITE_LISTADO) {
    resumen = `Mostrando los primeros ${LIMITE_LISTADO}${totalCatalogo ? ` de ${totalCatalogo}` : ""}. Usa el buscador o los filtros para encontrar un plantel.`;
  }
  if (!filtrosActivos() && notaFalta && !q) resumen = (resumen + notaFalta).trim();
  document.getElementById("resumenListado").textContent = resumen;

  if (!lista.length) {
    cont.innerHTML = filtrosActivos()
      ? `<div class="vacio"><strong>Sin planteles</strong>${soloSinCodigo && !sinCodigoN ? "Todavía no hay planteles registrados con código provisional." : "Ningún plantel cumple los filtros."}</div>`
      : q
        ? `<div class="vacio"><strong>Sin resultados</strong>Ningún plantel coincide con la búsqueda.</div>`
        : `<div class="vacio"><strong>Sin planteles cargados</strong>Usa "+ Nuevo plantel" para agregar el primero.</div>`;
    return;
  }

  cont.innerHTML = `
    <div class="tabla-responsive lista-scroll">
      <table>
        <thead><tr><th>Código</th><th>Epónimo actual</th><th>Denominación</th><th>Dependencia</th><th>Turno</th><th>Comuna</th><th>Director</th><th>Matrícula</th><th></th></tr></thead>
        <tbody>${lista.map((p) => {
          const sinDir = todosPlanteles.length && !directorPorPlantel[p.codigo_plantel];
          return `
          <tr>
            <td>${escapar(p.codigo_plantel)}${esProvisional(p.codigo_plantel) ? ` <span style="color:#9c4221; font-size:.72rem; font-weight:600;">· sin código DEA</span>` : ""}${p.en_gescolar === false ? ` <span style="color:#6b7a90; font-size:.72rem; font-weight:600;">· fuera de GESCOLAR</span>` : ""}</td>
            <td>${escapar(p.eponimo_actual)}</td>
            <td>${escapar(p.denominacion || "—")}</td>
            <td>${escapar(p.dependencia || "—")}</td>
            <td>${escapar(p.turno || "—")}</td>
            <td>${escapar(p.nombre_comuna || "—")}</td>
            <td>${textoDirector(p.codigo_plantel)}</td>
            <td>${textoMatricula(p.codigo_plantel)}</td>
            <td><div style="display:flex; gap:6px; flex-wrap:wrap; min-width:90px;">
              <button type="button" class="btn btn-sm" data-editar="${escapar(p.codigo_plantel)}">Editar</button>
              ${sinDir ? `<a class="btn btn-sm btn-fantasma" href="/supervision/directores.html?nuevo=${encodeURIComponent(p.codigo_plantel)}">+ Director</a>` : ""}
            </div></td>
          </tr>`; }).join("")}
        </tbody>
      </table>
    </div>
  `;

  cont.querySelectorAll("[data-editar]").forEach((btn) => {
    btn.addEventListener("click", () => abrirEditar(btn.dataset.editar));
  });
}

// Con filtros, la fila viene del consolidado (datos parciales): se trae el
// plantel completo antes de abrir el formulario.
async function abrirEditar(codigo) {
  let p = planteles.find((x) => x.codigo_plantel === codigo);
  if (!p) {
    try {
      const resp = await RAC.get(`/api/supervision/planteles/${encodeURIComponent(codigo)}`);
      p = resp.plantel;
    } catch (err) {
      mostrarToast(err.message, true);
      return;
    }
  }
  abrirFormulario(p);
}

// Siguiente código provisional libre: SIN-DEA-001, SIN-DEA-002…
function siguienteCodigoProvisional() {
  const usados = todosPlanteles.map((f) => f.codigo_plantel).concat(planteles.map((p) => p.codigo_plantel));
  let max = 0;
  usados.forEach((c) => {
    const m = /^SIN-DEA-(\d+)$/i.exec(String(c || ""));
    if (m) max = Math.max(max, Number(m[1]));
  });
  return `SIN-DEA-${String(max + 1).padStart(3, "0")}`;
}

// ---------- matrícula por nivel / por total (bloque del formulario) ----------

const usaNivelesEnForm = () => nivelesDisponibles && nivelesSel.size > 0;
const nivelesMarcados = () => catalogoNiveles.filter((n) => nivelesSel.has(n.clave));

// Matrícula por nivel ya cargada en un período: { clave: { hembras, varones } }.
function filasNivelDelPeriodo(periodo) {
  const mapa = {};
  filasNivelActual.forEach((f) => {
    if (f.periodo_escolar === periodo) mapa[f.nivel] = { hembras: f.hembras, varones: f.varones };
  });
  return mapa;
}

// Períodos que se ofrecen en la lista: los del histórico de totales y los de niveles.
function periodosConocidos() {
  const set = new Set(historialActual.map((f) => f.periodo_escolar));
  filasNivelActual.forEach((f) => set.add(f.periodo_escolar));
  return [...set].sort().reverse();
}

// Lee lo que hay escrito en los campos de matrícula (para no perderlo al
// volver a dibujar el bloque cuando se marca o desmarca un nivel).
function leerValoresMatricula() {
  const valores = { periodo: "", porNivel: {}, hembras: "", varones: "" };
  const per = document.getElementById("inputPeriodo");
  if (per) valores.periodo = per.value;
  document.querySelectorAll("#bloqueMatricula tr[data-nivel]").forEach((tr) => {
    valores.porNivel[tr.dataset.nivel] = {
      hembras: tr.querySelector(".inp-h").value,
      varones: tr.querySelector(".inp-v").value,
    };
  });
  const h = document.getElementById("inputHembras");
  const v = document.getElementById("inputVarones");
  if (h) valores.hembras = h.value;
  if (v) valores.varones = v.value;
  return valores;
}

function dibujarBloqueMatricula(valores) {
  const cont = document.getElementById("bloqueMatricula");
  const periodo = (valores && valores.periodo !== "" ? valores.periodo : null) || periodoActual();
  const porNivel = usaNivelesEnForm();

  const filaPeriodoTotal = historialActual.find((f) => f.periodo_escolar === periodo);
  const previosNivel = filasNivelDelPeriodo(periodo);

  const tablaHistorial = periodosConocidos().length ? `
    <div class="tabla-responsive" style="margin-top:14px;">
      <table>
        <thead><tr><th>Período</th><th>Hembras</th><th>Varones</th><th>Total</th><th></th></tr></thead>
        <tbody>${periodosConocidos().map((per) => {
          const f = historialActual.find((x) => x.periodo_escolar === per);
          const suma = filasNivelActual.filter((x) => x.periodo_escolar === per)
            .reduce((a, x) => ({ h: a.h + Number(x.hembras), v: a.v + Number(x.varones) }), { h: 0, v: 0 });
          const h = f ? Number(f.hembras) : suma.h;
          const v = f ? Number(f.varones) : suma.v;
          const t = f && f.total !== null && f.total !== undefined ? f.total : h + v;
          return `
          <tr>
            <td>${escapar(per)}</td>
            <td>${escapar(h)}</td>
            <td>${escapar(v)}</td>
            <td>${escapar(t)}</td>
            <td><button type="button" class="btn btn-sm btn-fantasma" data-cargar-periodo="${escapar(per)}">Cargar</button></td>
          </tr>`; }).join("")}
        </tbody>
      </table>
    </div>` : "";

  let campos;
  if (porNivel) {
    campos = `
      <div style="margin-bottom:12px; max-width:200px;">
        <label>Período escolar</label>
        <input type="text" name="periodo_escolar" id="inputPeriodo" list="listaPeriodos" value="${escapar(periodo)}" placeholder="2026-2027" autocomplete="off">
        <datalist id="listaPeriodos">${periodosConocidos().map((per) => `<option value="${escapar(per)}"></option>`).join("")}</datalist>
      </div>
      <div class="tabla-responsive">
        <table>
          <thead><tr><th>Nivel</th><th>Hembras</th><th>Varones</th><th>Total</th></tr></thead>
          <tbody>${nivelesMarcados().map((n) => {
            const escrito = valores && valores.porNivel && valores.porNivel[n.clave];
            const guardado = previosNivel[n.clave];
            const h = escrito ? escrito.hembras : (guardado ? guardado.hembras : "");
            const v = escrito ? escrito.varones : (guardado ? guardado.varones : "");
            return `
            <tr data-nivel="${escapar(n.clave)}">
              <td>${escapar(n.nombre)}</td>
              <td><input type="number" class="inp-h" min="0" step="1" style="width:100px;" value="${escapar(h)}"></td>
              <td><input type="number" class="inp-v" min="0" step="1" style="width:100px;" value="${escapar(v)}"></td>
              <td class="tot-fila"><strong>—</strong></td>
            </tr>`; }).join("")}
          </tbody>
          <tfoot><tr>
            <td><strong>Total del plantel</strong></td>
            <td id="totalH"><strong>—</strong></td>
            <td id="totalV"><strong>—</strong></td>
            <td id="totalT"><strong>—</strong></td>
          </tr></tfoot>
        </table>
      </div>`;
  } else {
    const h = valores && valores.hembras !== "" ? valores.hembras : (filaPeriodoTotal ? filaPeriodoTotal.hembras : "");
    const v = valores && valores.varones !== "" ? valores.varones : (filaPeriodoTotal ? filaPeriodoTotal.varones : "");
    campos = `
      <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:12px; align-items:end;">
        <div>
          <label>Período escolar</label>
          <input type="text" name="periodo_escolar" id="inputPeriodo" list="listaPeriodos" value="${escapar(periodo)}" placeholder="2026-2027" autocomplete="off">
          <datalist id="listaPeriodos">${periodosConocidos().map((per) => `<option value="${escapar(per)}"></option>`).join("")}</datalist>
        </div>
        <div><label>Hembras</label><input type="number" name="hembras" id="inputHembras" min="0" step="1" value="${escapar(h)}"></div>
        <div><label>Varones</label><input type="number" name="varones" id="inputVarones" min="0" step="1" value="${escapar(v)}"></div>
        <div><label>Total</label><div id="textoTotal" style="padding:9px 0; font-weight:700;">—</div></div>
      </div>`;
  }

  cont.oninput = null; // se vuelve a poner abajo si el bloque es por nivel
  cont.innerHTML = campos + tablaHistorial;
  cont.querySelectorAll("label").forEach((l) => { l.style.display = "block"; l.style.fontSize = ".78rem"; l.style.marginBottom = "4px"; });

  const inputPeriodo = document.getElementById("inputPeriodo");

  // Totales en vivo
  if (porNivel) {
    const num = (input) => (input.value.trim() === "" ? null : Number(input.value));
    const recalcular = () => {
      let th = 0, tv = 0, alguno = false;
      cont.querySelectorAll("tbody tr[data-nivel]").forEach((tr) => {
        const h = num(tr.querySelector(".inp-h"));
        const v = num(tr.querySelector(".inp-v"));
        const celda = tr.querySelector(".tot-fila strong");
        if (h === null && v === null) { celda.textContent = "—"; return; }
        alguno = true;
        th += h || 0;
        tv += v || 0;
        celda.textContent = String((h || 0) + (v || 0));
      });
      document.querySelector("#totalH strong").textContent = alguno ? String(th) : "—";
      document.querySelector("#totalV strong").textContent = alguno ? String(tv) : "—";
      document.querySelector("#totalT strong").textContent = alguno ? String(th + tv) : "—";
    };
    cont.oninput = (e) => {
      if (e.target.classList && (e.target.classList.contains("inp-h") || e.target.classList.contains("inp-v"))) recalcular();
    };
    recalcular();
  } else {
    const inputHembras = document.getElementById("inputHembras");
    const inputVarones = document.getElementById("inputVarones");
    const textoTotal = document.getElementById("textoTotal");
    const actualizarTotal = () => {
      const h = inputHembras.value.trim();
      const v = inputVarones.value.trim();
      textoTotal.textContent = h === "" && v === "" ? "—" : String((Number(h) || 0) + (Number(v) || 0));
    };
    inputHembras.addEventListener("input", actualizarTotal);
    inputVarones.addEventListener("input", actualizarTotal);
    actualizarTotal();
  }

  // Cargar los valores de un período del histórico en los campos
  const cargarPeriodo = (nombre) => {
    if (porNivel) {
      const previos = filasNivelDelPeriodo(nombre);
      inputPeriodo.value = nombre;
      cont.querySelectorAll("tbody tr[data-nivel]").forEach((tr) => {
        const f = previos[tr.dataset.nivel];
        tr.querySelector(".inp-h").value = f ? f.hembras : "";
        tr.querySelector(".inp-v").value = f ? f.varones : "";
      });
      cont.querySelector("tbody tr[data-nivel] .inp-h").dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      const fila = historialActual.find((f) => f.periodo_escolar === nombre);
      if (!fila) return;
      inputPeriodo.value = fila.periodo_escolar;
      document.getElementById("inputHembras").value = fila.hembras;
      document.getElementById("inputVarones").value = fila.varones;
      document.getElementById("inputHembras").dispatchEvent(new Event("input", { bubbles: true }));
    }
  };
  inputPeriodo.addEventListener("change", () => cargarPeriodo(inputPeriodo.value.trim()));
  cont.querySelectorAll("[data-cargar-periodo]").forEach((btn) => {
    btn.addEventListener("click", () => cargarPeriodo(btn.dataset.cargarPeriodo));
  });
}

async function abrirFormulario(plantel) {
  editando = plantel ? plantel.codigo_plantel : null;
  const p = plantel || {};
  const panel = document.getElementById("panelFormulario");
  panel.style.display = "block";
  panel.innerHTML = `<div class="cargando">Cargando plantel…</div>`;
  panel.scrollIntoView({ behavior: "smooth", block: "start" });

  // Histórico de matrícula (totales) y niveles del plantel (solo si ya existe).
  historialActual = [];
  filasNivelActual = [];
  nivelesSel = new Set();
  nivelesOriginales = [];
  catalogoNiveles = [];
  nivelesDisponibles = false;
  let avisoMatricula = "";
  let avisoNiveles = "";
  if (plantel) {
    const codigo = encodeURIComponent(plantel.codigo_plantel);
    try {
      const resp = await RAC.get(`/api/supervision/matricula/${codigo}`);
      historialActual = RAC.lista(resp, "matricula") || [];
    } catch (err) {
      avisoMatricula = `No se pudo cargar el histórico de matrícula (${err.message}).`;
    }
    try {
      const resp = await RAC.get(`/api/supervision/matricula-nivel/${codigo}`);
      catalogoNiveles = resp.catalogo || [];
      nivelesSel = new Set(resp.asignados || []);
      nivelesOriginales = [...nivelesSel];
      filasNivelActual = resp.filas || [];
      nivelesDisponibles = catalogoNiveles.length > 0;
    } catch (err) {
      avisoNiveles = `No se pudieron cargar los niveles (${err.message}). La matrícula se carga como un solo total.`;
    }
  } else {
    try {
      const resp = await RAC.get("/api/supervision/niveles");
      catalogoNiveles = resp.niveles || [];
      nivelesDisponibles = catalogoNiveles.length > 0;
    } catch (err) {
      avisoNiveles = `No se pudieron cargar los niveles (${err.message}). La matrícula se carga como un solo total.`;
    }
  }

  const dependencias = ["NACIONAL", "ESTADAL", "MUNICIPAL", "PRIVADA", "AUTÓNOMA", "SUBVENCIONADOS OFICIALES", "SUBVENCIONADA MPPE"];
  if (p.dependencia && !dependencias.includes(p.dependencia)) dependencias.push(p.dependencia);

  panel.innerHTML = `
    <h3 style="margin-bottom:14px;">${plantel ? `Editar plantel — ${escapar(p.codigo_plantel)}` : "Nuevo plantel"}</h3>
    <form id="formPlantel" style="display:grid; grid-template-columns:repeat(2,1fr); gap:12px;">
      <div>
        <label>Código de plantel</label>
        <input type="text" name="codigo_plantel" id="inputCodigoPlantel" value="${escapar(p.codigo_plantel)}" ${plantel ? "readonly" : "required"}>
        ${plantel ? "" : `<button type="button" class="btn btn-sm btn-fantasma" id="btnCodigoProvisional" style="margin-top:6px;">Usar código provisional (sin código DEA)</button>`}
      </div>
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
      <div style="grid-column:1/-1;">
        <label class="lbl-check" style="display:flex; gap:8px; align-items:center; font-size:.84rem;">
          <input type="checkbox" id="chkEnGescolar" ${p.en_gescolar ? "checked" : ""}> Está registrado en GESCOLAR
          <span style="color:var(--muted); font-size:.78rem;">(cuenta para el reporte oficial)</span>
        </label>
      </div>

      ${nivelesDisponibles ? `
      <div style="grid-column:1/-1; border-top:1px solid var(--rac-border, #dfe7f0); padding-top:14px; margin-top:4px;">
        <h3 style="margin-bottom:4px;">Niveles del plantel</h3>
        <p style="font-size:.8rem; color:var(--muted); margin-bottom:10px;">
          Marca los niveles que atiende este plantel: la matrícula se carga por cada uno y el total es la suma.
          ${plantel && !nivelesOriginales.length ? "Este plantel todavía no tiene niveles asignados." : ""}
        </p>
        <div id="listaNiveles" style="display:flex; flex-wrap:wrap; gap:8px 18px;">
          ${catalogoNiveles.map((n) => `
            <label class="lbl-check" style="display:flex; gap:6px; align-items:center; font-size:.84rem;">
              <input type="checkbox" data-nivel="${escapar(n.clave)}" ${nivelesSel.has(n.clave) ? "checked" : ""}> ${escapar(n.nombre)}
            </label>`).join("")}
        </div>
      </div>` : ""}

      <div style="grid-column:1/-1; border-top:1px solid var(--rac-border, #dfe7f0); padding-top:14px; margin-top:4px;">
        <h3 style="margin-bottom:4px;">Matrícula</h3>
        <p style="font-size:.8rem; color:var(--muted); margin-bottom:12px;">
          Se guarda por período escolar: si el período ya existe se actualiza; si es uno nuevo se agrega al histórico sin tocar los anteriores. Déjala en blanco para no cambiarla.
          ${nivelesDisponibles ? "Con niveles marcados se carga por nivel (todos los niveles del período)." : ""}
        </p>
        ${avisoMatricula ? `<p style="font-size:.8rem; color:#b7791f; margin-bottom:10px;">${escapar(avisoMatricula)}</p>` : ""}
        ${avisoNiveles ? `<p style="font-size:.8rem; color:#b7791f; margin-bottom:10px;">${escapar(avisoNiveles)}</p>` : ""}
        <div id="bloqueMatricula"></div>
      </div>

      <div style="grid-column:1/-1; display:flex; gap:10px; margin-top:6px;">
        <button type="submit" class="btn" id="btnGuardarPlantel">Guardar</button>
        <button type="button" class="btn btn-fantasma" id="btnCancelarPlantel">Cancelar</button>
      </div>
    </form>
  `;
  panel.querySelectorAll("label:not(.lbl-check)").forEach((l) => { l.style.display = "block"; l.style.fontSize = ".78rem"; l.style.marginBottom = "4px"; });

  const btnProvisional = document.getElementById("btnCodigoProvisional");
  if (btnProvisional) {
    btnProvisional.addEventListener("click", () => {
      document.getElementById("inputCodigoPlantel").value = siguienteCodigoProvisional();
    });
  }

  // Marcar / desmarcar niveles: se vuelve a dibujar el bloque de matrícula sin perder lo escrito.
  const lista = document.getElementById("listaNiveles");
  if (lista) {
    lista.addEventListener("change", (e) => {
      const caja = e.target;
      if (!caja.dataset || !caja.dataset.nivel) return;
      const valores = leerValoresMatricula();
      if (caja.checked) nivelesSel.add(caja.dataset.nivel); else nivelesSel.delete(caja.dataset.nivel);
      dibujarBloqueMatricula(valores);
    });
  }

  dibujarBloqueMatricula(null);

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
  datos.en_gescolar = document.getElementById("chkEnGescolar").checked; // una casilla sin marcar no viaja en FormData

  const esEntero = (t) => /^\d+$/.test(t);
  const porNivel = usaNivelesEnForm();

  // Se valida TODO antes de guardar nada, para no dejar el plantel a medias.
  let quiereMatricula = false;
  let niveles = [];
  if (porNivel) {
    const filas = [...document.querySelectorAll("#bloqueMatricula tr[data-nivel]")].map((tr) => ({
      nivel: tr.dataset.nivel,
      nombre: tr.firstElementChild.textContent,
      h: tr.querySelector(".inp-h").value.trim(),
      v: tr.querySelector(".inp-v").value.trim(),
    }));
    quiereMatricula = filas.some((f) => f.h !== "" || f.v !== "");
    if (quiereMatricula) {
      if (!periodo) { mostrarToast("Indica el período escolar de la matrícula.", true); return; }
      for (const f of filas) {
        if (f.h === "" || f.v === "") { mostrarToast(`Completa hembras y varones de ${f.nombre} (si no hay estudiantes, coloca 0).`, true); return; }
        if (!esEntero(f.h) || !esEntero(f.v)) { mostrarToast(`En ${f.nombre}, hembras y varones deben ser números enteros (0 o más).`, true); return; }
      }
      niveles = filas.map((f) => ({ nivel: f.nivel, hembras: Number(f.h), varones: Number(f.v) }));
    }
  } else {
    quiereMatricula = hembras !== "" || varones !== "";
    if (quiereMatricula) {
      if (!periodo) { mostrarToast("Indica el período escolar de la matrícula.", true); return; }
      if (hembras === "" || varones === "") { mostrarToast("Para guardar la matrícula completa hembras y varones.", true); return; }
      if (!esEntero(hembras) || !esEntero(varones)) { mostrarToast("Hembras y varones deben ser números enteros (0 o más).", true); return; }
    }
  }

  const nivelesActuales = [...nivelesSel].sort();
  const cambioNiveles = nivelesDisponibles
    && JSON.stringify(nivelesActuales) !== JSON.stringify([...nivelesOriginales].sort());

  boton.disabled = true;
  try {
    let codigo = editando;
    if (editando) {
      await RAC.put(`/api/supervision/planteles/${encodeURIComponent(editando)}`, datos);
    } else {
      await RAC.post("/api/supervision/planteles", datos);
      codigo = String(datos.codigo_plantel || "").trim();
    }

    if (cambioNiveles) {
      try {
        await RAC.put(`/api/supervision/planteles/${encodeURIComponent(codigo)}/niveles`, { niveles: nivelesActuales });
      } catch (err) {
        mostrarToast(`Plantel guardado, pero los niveles no: ${err.message}`, true);
        cerrarFormulario();
        refrescar();
        return;
      }
    }

    if (quiereMatricula) {
      try {
        if (porNivel) {
          await RAC.post(`/api/supervision/matricula-nivel/${encodeURIComponent(codigo)}`, { periodo_escolar: periodo, niveles });
        } else {
          await RAC.post(`/api/supervision/matricula/${encodeURIComponent(codigo)}`, {
            periodo_escolar: periodo,
            hembras: Number(hembras),
            varones: Number(varones),
          });
        }
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
  return String(valor).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
