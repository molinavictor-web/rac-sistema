// supervision-planteles.js — panel de administración (rol admin/supervision):
// catálogo propio de planteles de Supervisión (independiente de GESCOLAR/RAC).
// Permite buscar, crear y editar planteles. El backend no expone borrado
// para este catálogo, así que aquí tampoco se ofrece esa acción.

const usuario = renderShell("supervision-planteles", "Supervisión · Planteles");
let planteles = [];
let editando = null; // codigo_plantel en edición, o null si el formulario es "nuevo"

if (usuario) cargarPantalla();

async function cargarPantalla(q = "") {
  const contenido = document.getElementById("contenido");
  contenido.innerHTML = `<div class="cargando">Cargando planteles…</div>`;
  try {
    const resp = await RAC.get(`/api/supervision/planteles${q ? `?q=${encodeURIComponent(q)}` : ""}`);
    planteles = RAC.lista(resp, "planteles");
    dibujarPantalla(q);
  } catch (err) {
    contenido.innerHTML = `<div class="panel" style="padding:20px;"><div class="vacio"><strong>No se pudo cargar</strong>${escapar(err.message)}</div></div>`;
  }
}

function dibujarPantalla(q) {
  const contenido = document.getElementById("contenido");
  contenido.innerHTML = `
    <section class="planteles-hero">
      <div class="planteles-hero-copy">
        <span class="planteles-eyebrow">SUPERVISIÓN</span>
        <h1>Planteles</h1>
        <p>Catálogo propio de Supervisión · ${planteles.length} planteles cargados</p>
      </div>
    </section>

    <div class="panel" style="padding:20px; margin-bottom:20px; display:flex; gap:12px; flex-wrap:wrap; align-items:center; justify-content:space-between;">
      <input type="text" id="inputBuscar" placeholder="Buscar por código, epónimo o comuna…" style="flex:1; min-width:220px;" value="${escapar(q || "")}">
      <button type="button" class="btn" id="btnNuevo">+ Nuevo plantel</button>
    </div>

    <div class="panel" id="panelFormulario" style="padding:20px; margin-bottom:20px; display:none;"></div>

    <div class="panel" style="padding:20px;">
      ${planteles.length ? `
        <div class="tabla-responsive">
          <table>
            <thead><tr><th>Código</th><th>Epónimo actual</th><th>Denominación</th><th>Dependencia</th><th>Turno</th><th>Comuna</th><th></th></tr></thead>
            <tbody>${planteles.map((p) => `
              <tr>
                <td>${escapar(p.codigo_plantel)}</td>
                <td>${escapar(p.eponimo_actual)}</td>
                <td>${escapar(p.denominacion || "—")}</td>
                <td>${escapar(p.dependencia || "—")}</td>
                <td>${escapar(p.turno || "—")}</td>
                <td>${escapar(p.nombre_comuna || "—")}</td>
                <td><button type="button" class="btn btn-sm" data-editar="${escapar(p.codigo_plantel)}">Editar</button></td>
              </tr>`).join("")}
            </tbody>
          </table>
        </div>
      ` : `<div class="vacio"><strong>Sin planteles cargados</strong>Usa "+ Nuevo plantel" para agregar el primero.</div>`}
    </div>
  `;

  let temporizadorBusqueda;
  document.getElementById("inputBuscar").addEventListener("input", (e) => {
    clearTimeout(temporizadorBusqueda);
    temporizadorBusqueda = setTimeout(() => cargarPantalla(e.target.value.trim()), 350);
  });
  document.getElementById("btnNuevo").addEventListener("click", () => abrirFormulario(null));
  document.querySelectorAll("[data-editar]").forEach((btn) => {
    btn.addEventListener("click", () => abrirFormulario(planteles.find((p) => p.codigo_plantel === btn.dataset.editar)));
  });
}

function abrirFormulario(plantel) {
  editando = plantel ? plantel.codigo_plantel : null;
  const p = plantel || {};
  const panel = document.getElementById("panelFormulario");
  panel.style.display = "block";
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
          ${["NACIONAL", "ESTADAL", "MUNICIPAL", "PRIVADA", "AUTÓNOMA", "SUBVENCIONADOS OFICIALES", "SUBVENCIONADA MPPE"].map((v) =>
            `<option value="${v}" ${p.dependencia === v ? "selected" : ""}>${v}</option>`).join("")}
        </select>
      </div>
      <div><label>Turno</label><input type="text" name="turno" value="${escapar(p.turno)}"></div>
      <div><label>Dirección</label><input type="text" name="direccion" value="${escapar(p.direccion)}"></div>
      <div><label>Comuna (código)</label><input type="text" name="cod_comuna" value="${escapar(p.cod_comuna)}"></div>
      <div><label>Comuna (nombre)</label><input type="text" name="nombre_comuna" value="${escapar(p.nombre_comuna)}"></div>
      <div><label>Coordenadas geo</label><input type="text" name="coordenadas_geo" value="${escapar(p.coordenadas_geo)}"></div>
      <div><label>Ubicación geo</label><input type="text" name="ubicacion_geo" value="${escapar(p.ubicacion_geo)}"></div>
      <div style="grid-column:1/-1; display:flex; gap:10px; margin-top:6px;">
        <button type="submit" class="btn" id="btnGuardarPlantel">Guardar</button>
        <button type="button" class="btn btn-fantasma" id="btnCancelarPlantel">Cancelar</button>
      </div>
    </form>
  `;
  panel.querySelectorAll("label").forEach((l) => { l.style.display = "block"; l.style.fontSize = ".78rem"; l.style.marginBottom = "4px"; });
  document.getElementById("btnCancelarPlantel").addEventListener("click", () => { panel.style.display = "none"; panel.innerHTML = ""; });
  document.getElementById("formPlantel").addEventListener("submit", guardarPlantel);
}

async function guardarPlantel(e) {
  e.preventDefault();
  const boton = document.getElementById("btnGuardarPlantel");
  const datos = Object.fromEntries(new FormData(e.target).entries());
  boton.disabled = true;
  try {
    if (editando) {
      await RAC.put(`/api/supervision/planteles/${encodeURIComponent(editando)}`, datos);
      mostrarToast("Plantel actualizado.");
    } else {
      await RAC.post("/api/supervision/planteles", datos);
      mostrarToast("Plantel creado.");
    }
    cargarPantalla();
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
