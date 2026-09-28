// supervision-mi-plantel.js — pantalla del director: datos de su plantel
// (solo lectura) + histórico de matrícula + formulario para cargar la
// matrícula del período escolar actual. El director solo puede ver/editar
// SU PROPIO codigo_plantel -- lo trae el token (usuario.codigo_plantel),
// el backend además lo revalida con requireMismoPlantel.

const usuario = renderShell("supervision-mi-plantel", "Mi plantel");
const codigoPlantel = usuario ? usuario.codigo_plantel : null;

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
    const resp = await RAC.get(`/api/supervision/planteles/${encodeURIComponent(codigoPlantel)}`);
    dibujarPantalla(resp);
  } catch (err) {
    contenido.innerHTML = `<div class="panel" style="padding:20px;"><div class="vacio"><strong>No se pudo cargar</strong>${escapar(err.message)}</div></div>`;
  }
}

function dibujarPantalla(datos) {
  const p = datos.plantel;
  const historico = datos.matricula_historico || [];
  const ultimo = historico[0]; // ya viene ordenado DESC por periodo_escolar

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
      <form id="formMatricula" style="display:flex; gap:12px; flex-wrap:wrap; align-items:flex-end;">
        <div>
          <label style="display:block; font-size:.78rem; margin-bottom:4px;">Período escolar</label>
          <input type="text" id="inputPeriodo" placeholder="2026-2027" style="width:130px;" value="${escapar(periodoEscolarActual())}" required>
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
      </form>
    </div>

    <div class="panel" style="padding:20px;">
      <h3 style="margin-bottom:10px;">Histórico de matrícula</h3>
      ${historico.length ? `
        <div class="tabla-responsive">
          <table>
            <thead><tr><th>Período</th><th>Hembras</th><th>Varones</th><th>Total</th><th>Actualizado</th></tr></thead>
            <tbody>${historico.map((m) => `
              <tr>
                <td>${escapar(m.periodo_escolar)}</td>
                <td>${m.hembras}</td>
                <td>${m.varones}</td>
                <td><strong>${m.total}</strong></td>
                <td>${new Date(m.actualizado_en).toLocaleDateString("es-VE")}</td>
              </tr>`).join("")}
            </tbody>
          </table>
        </div>
      ` : `<div class="vacio"><strong>Sin matrícula cargada todavía</strong>Usa el formulario de arriba para cargar el primer período.</div>`}
    </div>
  `;

  document.getElementById("formMatricula").addEventListener("submit", (e) => guardarMatricula(e));
}

async function guardarMatricula(e) {
  e.preventDefault();
  const boton = document.getElementById("btnGuardarMatricula");
  const estado = document.getElementById("estadoMatricula");
  const periodo_escolar = document.getElementById("inputPeriodo").value.trim();
  const hembras = document.getElementById("inputHembras").value;
  const varones = document.getElementById("inputVarones").value;

  boton.disabled = true;
  estado.textContent = "Guardando…";
  try {
    await RAC.post(`/api/supervision/matricula/${encodeURIComponent(codigoPlantel)}`, { periodo_escolar, hembras, varones });
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
  return String(valor).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
