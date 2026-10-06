// supervision-mi-plantel.js — pantalla del director: datos de su plantel
// (solo lectura) + histórico de matrícula + formulario para cargar la
// matrícula del período escolar actual. El director solo puede ver/editar
// SU PROPIO codigo_plantel -- lo trae el token (usuario.codigo_plantel),
// el backend además lo revalida con requireMismoPlantel.
//
// La matrícula se carga POR NIVEL (Maternal, Preescolar, Primaria, Media
// General, ...) según los niveles que Supervisión le asignó al plantel; el
// total del plantel es la suma. Si el plantel todavía no tiene niveles
// asignados (o no se pudieron consultar), se muestra el formulario anterior
// con un solo total de hembras y varones, para que nadie quede sin poder cargar.

const usuario = renderShell("supervision-mi-plantel", "Mi plantel");
const codigoPlantel = usuario ? usuario.codigo_plantel : null;

let nivelesInfo = null; // { catalogo, asignados, filas } o null si no se pudo consultar

if (usuario && !codigoPlantel) {
  document.getElementById("contenido").innerHTML = `
    <div class="panel" style="padding:20px;">
      <div class="vacio"><strong>Tu cuenta no tiene un plantel asignado</strong>Contacta a Supervisión para que corrijan tu usuario.</div>
    </div>`;
} else if (usuario) {
  cargarPantalla();
}

async function cargarPantalla() {
  const contenido = document.getElementById("contenido");
  contenido.innerHTML = `<div class="cargando">Cargando datos del plantel…</div>`;
  try {
    const codigo = encodeURIComponent(codigoPlantel);
    const [resp, niveles] = await Promise.all([
      RAC.get(`/api/supervision/planteles/${codigo}`),
      RAC.get(`/api/supervision/matricula-nivel/${codigo}`).catch(() => null),
    ]);
    nivelesInfo = niveles;
    dibujarPantalla(resp);
  } catch (err) {
    contenido.innerHTML = `<div class="panel" style="padding:20px;"><div class="vacio"><strong>No se pudo cargar</strong>${escapar(err.message)}</div></div>`;
  }
}

const usaNiveles = () => !!(nivelesInfo && nivelesInfo.asignados && nivelesInfo.asignados.length);

function nivelesDelPlantel() {
  const asignados = new Set(nivelesInfo.asignados);
  return nivelesInfo.catalogo.filter((n) => asignados.has(n.clave));
}

// Matrícula por nivel cargada en un período: { clave: { hembras, varones } }.
function filasDelPeriodo(periodo) {
  const mapa = {};
  ((nivelesInfo && nivelesInfo.filas) || []).forEach((f) => {
    if (f.periodo_escolar === periodo) mapa[f.nivel] = { hembras: f.hembras, varones: f.varones };
  });
  return mapa;
}

// Texto "Maternal H 5 · V 6" por cada nivel cargado en ese período.
function detalleDelPeriodo(periodo) {
  if (!nivelesInfo) return "—";
  const nombres = {};
  nivelesInfo.catalogo.forEach((n) => { nombres[n.clave] = n.nombre; });
  const filas = nivelesInfo.filas.filter((f) => f.periodo_escolar === periodo);
  if (!filas.length) return `<span style="color:var(--muted);">—</span>`;
  return filas
    .map((f) => `<div style="font-size:.78rem;">${escapar(nombres[f.nivel] || f.nivel)}: H ${f.hembras} · V ${f.varones}</div>`)
    .join("");
}

function htmlFormularioMatricula(ultimo) {
  const periodo = periodoEscolarActual();

  if (!usaNiveles()) {
    return `
      <p style="font-size:.8rem; color:var(--muted); margin-bottom:12px;">
        Tu plantel todavía no tiene niveles asignados, así que la matrícula se carga como un solo total. Si quieres cargarla por nivel, pídele a Supervisión que se los asigne.
      </p>
      <form id="formMatricula" style="display:flex; gap:12px; flex-wrap:wrap; align-items:flex-end;">
        <div>
          <label style="display:block; font-size:.78rem; margin-bottom:4px;">Período escolar</label>
          <input type="text" id="inputPeriodo" placeholder="2026-2027" style="width:130px;" value="${escapar(periodo)}" required>
        </div>
        <div>
          <label style="display:block; font-size:.78rem; margin-bottom:4px;">Hembras</label>
          <input type="number" id="inputHembras" min="0" style="width:100px;" value="${ultimo ? ultimo.hembras : ""}" required>
        </div>
        <div>
          <label style="display:block; font-size:.78rem; margin-bottom:4px;">Varones</label>
          <input type="number" id="inputVarones" min="0" style="width:100px;" value="${ultimo ? ultimo.varones : ""}" required>
        </div>
        <button type="submit" class="btn" id="btnGuardarMatricula">Guardar</button>
        <span id="estadoMatricula" style="font-size:.8rem; color:var(--muted);"></span>
      </form>`;
  }

  const previos = filasDelPeriodo(periodo);
  return `
    <p style="font-size:.8rem; color:var(--muted); margin-bottom:12px;">
      Escribe hembras y varones de cada nivel (si un nivel no tiene estudiantes, coloca 0). El total del plantel es la suma de los niveles.
    </p>
    <form id="formMatricula">
      <div style="margin-bottom:14px;">
        <label style="display:block; font-size:.78rem; margin-bottom:4px;">Período escolar</label>
        <input type="text" id="inputPeriodo" placeholder="2026-2027" style="width:130px;" value="${escapar(periodo)}" required>
      </div>
      <div class="tabla-responsive">
        <table>
          <thead><tr><th>Nivel</th><th>Hembras</th><th>Varones</th><th>Total</th></tr></thead>
          <tbody>${nivelesDelPlantel().map((n) => {
            const f = previos[n.clave];
            return `
            <tr data-nivel="${escapar(n.clave)}">
              <td>${escapar(n.nombre)}</td>
              <td><input type="number" class="inp-h" min="0" step="1" style="width:100px;" value="${f ? escapar(f.hembras) : ""}"></td>
              <td><input type="number" class="inp-v" min="0" step="1" style="width:100px;" value="${f ? escapar(f.varones) : ""}"></td>
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
      </div>
      <div style="display:flex; gap:12px; align-items:center; margin-top:14px;">
        <button type="submit" class="btn" id="btnGuardarMatricula">Guardar</button>
        <span id="estadoMatricula" style="font-size:.8rem; color:var(--muted);"></span>
      </div>
    </form>`;
}

function dibujarPantalla(datos) {
  const p = datos.plantel;
  const historico = datos.matricula_historico || [];
  const ultimo = historico[0]; // ya viene ordenado DESC por periodo_escolar
  const conNiveles = usaNiveles();

  const contenido = document.getElementById("contenido");
  contenido.innerHTML = `
    <section class="planteles-hero">
      <div class="planteles-hero-copy">
        <span class="planteles-eyebrow">MI PLANTEL</span>
        <h1>${escapar(p.eponimo_actual)}</h1>
        <p>${escapar(p.codigo_plantel)} · ${escapar(p.denominacion || "—")} · ${escapar(p.turno || "—")}</p>
      </div>
    </section>

    <div class="panel" style="padding:20px; margin-bottom:20px;">
      <h3 style="margin-bottom:10px;">Datos del plantel</h3>
      <div class="ficha-datos-grid" style="display:grid; grid-template-columns:repeat(2,1fr); gap:12px;">
        <div><div style="font-size:.7rem; text-transform:uppercase; color:#718096;">Niveles / modalidad</div><div>${escapar(p.niveles_modalidad || "—")}</div></div>
        <div><div style="font-size:.7rem; text-transform:uppercase; color:#718096;">Dependencia</div><div>${escapar(p.dependencia || "—")}</div></div>
        <div><div style="font-size:.7rem; text-transform:uppercase; color:#718096;">Dirección</div><div>${escapar(p.direccion || "—")}</div></div>
        <div><div style="font-size:.7rem; text-transform:uppercase; color:#718096;">Comuna</div><div>${escapar(p.nombre_comuna || "—")}</div></div>
      </div>
    </div>

    <div class="panel" style="padding:20px; margin-bottom:20px;">
      <h3 style="margin-bottom:10px;">Cargar matrícula</h3>
      ${htmlFormularioMatricula(ultimo)}
    </div>

    <div class="panel" style="padding:20px;">
      <h3 style="margin-bottom:10px;">Histórico de matrícula</h3>
      ${historico.length ? `
        <div class="tabla-responsive">
          <table>
            <thead><tr><th>Período</th><th>Hembras</th><th>Varones</th><th>Total</th>${conNiveles ? "<th>Por nivel</th>" : ""}<th>Actualizado</th></tr></thead>
            <tbody>${historico.map((m) => `
              <tr>
                <td>${escapar(m.periodo_escolar)}</td>
                <td>${m.hembras}</td>
                <td>${m.varones}</td>
                <td><strong>${m.total}</strong></td>
                ${conNiveles ? `<td>${detalleDelPeriodo(m.periodo_escolar)}</td>` : ""}
                <td>${new Date(m.actualizado_en).toLocaleDateString("es-VE")}</td>
              </tr>`).join("")}
            </tbody>
          </table>
        </div>
      ` : `<div class="vacio"><strong>Sin matrícula cargada todavía</strong>Usa el formulario de arriba para cargar el primer período.</div>`}
    </div>
  `;

  document.getElementById("formMatricula").addEventListener("submit", (e) => guardarMatricula(e));
  if (conNiveles) prepararFormularioPorNivel();
}

// Totales en vivo y recarga de los valores cuando se cambia el período.
function prepararFormularioPorNivel() {
  const form = document.getElementById("formMatricula");
  const num = (input) => (input.value.trim() === "" ? null : Number(input.value));

  const recalcular = () => {
    let th = 0, tv = 0, alguno = false;
    form.querySelectorAll("tbody tr").forEach((tr) => {
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

  form.addEventListener("input", (e) => {
    if (e.target.classList.contains("inp-h") || e.target.classList.contains("inp-v")) recalcular();
  });
  document.getElementById("inputPeriodo").addEventListener("change", (e) => {
    const previos = filasDelPeriodo(e.target.value.trim());
    if (!Object.keys(previos).length) return; // período sin datos: se deja lo que haya escrito
    form.querySelectorAll("tbody tr").forEach((tr) => {
      const f = previos[tr.dataset.nivel];
      tr.querySelector(".inp-h").value = f ? f.hembras : "";
      tr.querySelector(".inp-v").value = f ? f.varones : "";
    });
    recalcular();
  });
  recalcular();
}

async function guardarMatricula(e) {
  e.preventDefault();
  const boton = document.getElementById("btnGuardarMatricula");
  const estado = document.getElementById("estadoMatricula");
  const periodo_escolar = document.getElementById("inputPeriodo").value.trim();
  const codigo = encodeURIComponent(codigoPlantel);

  let ruta;
  let cuerpo;
  if (usaNiveles()) {
    const niveles = [];
    for (const tr of document.querySelectorAll("#formMatricula tbody tr")) {
      const h = tr.querySelector(".inp-h").value.trim();
      const v = tr.querySelector(".inp-v").value.trim();
      const nombre = tr.firstElementChild.textContent;
      if (h === "" || v === "") {
        mostrarToast(`Completa hembras y varones de ${nombre} (si no hay estudiantes, coloca 0).`, true);
        return;
      }
      if (!/^\d+$/.test(h) || !/^\d+$/.test(v)) {
        mostrarToast(`En ${nombre}, hembras y varones deben ser números enteros (0 o más).`, true);
        return;
      }
      niveles.push({ nivel: tr.dataset.nivel, hembras: Number(h), varones: Number(v) });
    }
    ruta = `/api/supervision/matricula-nivel/${codigo}`;
    cuerpo = { periodo_escolar, niveles };
  } else {
    ruta = `/api/supervision/matricula/${codigo}`;
    cuerpo = {
      periodo_escolar,
      hembras: document.getElementById("inputHembras").value,
      varones: document.getElementById("inputVarones").value,
    };
  }

  boton.disabled = true;
  estado.textContent = "Guardando…";
  try {
    await RAC.post(ruta, cuerpo);
    mostrarToast("Matrícula guardada.");
    cargarPantalla(); // repinta con el histórico actualizado
  } catch (err) {
    estado.textContent = "";
    mostrarToast(err.message, true);
  } finally {
    boton.disabled = false;
  }
}

// Año escolar venezolano típico: septiembre a julio. Si estamos entre
// septiembre y diciembre, el período "actual" empieza este año; si estamos
// entre enero y agosto, empezó el año anterior.
function periodoEscolarActual() {
  const hoy = new Date();
  const anio = hoy.getFullYear();
  const inicio = hoy.getMonth() >= 8 ? anio : anio - 1; // getMonth() 8 = septiembre
  return `${inicio}-${inicio + 1}`;
}

function escapar(valor) {
  if (valor === undefined || valor === null) return "";
  return String(valor).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
