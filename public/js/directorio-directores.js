// directorio-directores.js — módulo dedicado a consultar y mantener
// actualizados los datos de contacto del director de cada plantel.
// Fuente y destino de los datos: hoja GESCOLAR en Google Sheets (mismo
// origen que "Consultar planteles"), a través del backend
// /api/directorio-directores/*.

const usuario = renderShell("directorio-directores", "Directorio de directores");

let temporizadorBusqueda = null;
let plantelEnEdicion = null;
const puedeEditar = usuario && (usuario.rol === "admin" || usuario.rol === "operador_plantel");

if (usuario) dibujarPanel();

function dibujarPanel() {
  const contenido = document.getElementById("contenido");
  contenido.innerHTML = `
    <section class="planteles-hero">
      <div class="planteles-hero-copy">
        <span class="planteles-eyebrow">CATÁLOGO GESCOLAR</span>
        <h1>Directorio de directores</h1>
        <p>Datos de contacto del director de cada plantel · fuente: GESCOLAR.</p>
      </div>
    </section>

    <div class="panel">
      <div style="padding: 16px 20px 0;">
        <div class="filtros">
          <input type="text" id="qBuscarDirector" placeholder="Buscar por nombre del plantel, código DEA o nombre del director..." style="flex:1; min-width:280px;">
        </div>
      </div>
      <div id="resumenBusquedaDirector" style="padding: 10px 20px 0; color: var(--muted); font-size: .8rem;"></div>
      <div id="tablaDirectores" style="margin-top:12px;"></div>
    </div>
  `;

  const input = document.getElementById("qBuscarDirector");
  input.addEventListener("input", () => {
    clearTimeout(temporizadorBusqueda);
    temporizadorBusqueda = setTimeout(() => buscarDirectores(input.value.trim()), 380);
  });

  mostrarEstadoInicial();
}

function mostrarEstadoInicial() {
  document.getElementById("resumenBusquedaDirector").textContent = "";
  document.getElementById("tablaDirectores").innerHTML = `
    <div class="vacio">
      <strong>Escribe para buscar</strong>
      Mínimo 2 caracteres — busca por nombre del plantel, código DEA o nombre del director.
    </div>`;
}

async function buscarDirectores(q) {
  const resumen = document.getElementById("resumenBusquedaDirector");
  const tabla = document.getElementById("tablaDirectores");

  if (!q) return mostrarEstadoInicial();
  if (q.length < 2) {
    resumen.textContent = "";
    tabla.innerHTML = `<div class="vacio"><strong>Escribe al menos 2 caracteres</strong>para empezar la búsqueda.</div>`;
    return;
  }

  tabla.innerHTML = `<div class="cargando">Buscando…</div>`;
  try {
    const resp = await RAC.get(`/api/directorio-directores/buscar?q=${encodeURIComponent(q)}`);
    const resultados = RAC.lista(resp, "directores");
    resumen.textContent = resp && typeof resp.total === "number"
      ? `${resp.total} resultado${resp.total === 1 ? "" : "s"}${resp.limitado ? " · mostrando los primeros 200" : ""}`
      : "";
    dibujarTablaDirectores(resultados);
  } catch (err) {
    resumen.textContent = "";
    tabla.innerHTML = `<div class="vacio"><strong>No se pudo buscar</strong>${escapar(err.message)}</div>`;
  }
}

function dibujarTablaDirectores(planteles) {
  const cont = document.getElementById("tablaDirectores");
  if (!planteles.length) {
    cont.innerHTML = `<div class="vacio"><strong>Sin resultados</strong>Prueba con otro nombre, código o director.</div>`;
    return;
  }

  const filas = planteles.map((p, i) => `
    <tr>
      <td><span class="cod">${escapar(p.cod_plantel) || "—"}</span></td>
      <td>${escapar(p.nombre_plantel) || "—"}<br><span style="color:var(--muted); font-size:.78rem;">${[escapar(p.municipio), escapar(p.parroquia)].filter(Boolean).join(" · ")}</span></td>
      <td>${escapar(p.director_nombre) || "—"}</td>
      <td>${[escapar(p.telefono_director), escapar(p.telefono_movil_director)].filter(Boolean).join(" / ") || "—"}</td>
      <td>${escapar(p.correo) || "—"}</td>
      <td>${puedeEditar ? `<button class="btn btn-fantasma btn-sm" data-editar="${i}">Editar</button>` : ""}</td>
    </tr>
  `).join("");

  cont.innerHTML = `
    <div class="tabla-responsive">
      <table>
        <thead><tr><th>Código</th><th>Plantel</th><th>Director</th><th>Teléfono(s)</th><th>Correo</th><th></th></tr></thead>
        <tbody>${filas}</tbody>
      </table>
    </div>
  `;

  cont.querySelectorAll("[data-editar]").forEach((btn) => {
    const plantel = planteles[Number(btn.dataset.editar)];
    btn.addEventListener("click", () => abrirEdicionDirector(plantel));
  });
}

// ---- Modal de edición ----
const modalDirectorFondo = document.getElementById("modalDirectorFondo");
const formDirector = document.getElementById("formDirector");
const errorModalDirector = document.getElementById("errorModalDirector");

async function abrirEdicionDirector(plantelResumen) {
  plantelEnEdicion = plantelResumen.cod_plantel;
  errorModalDirector.classList.remove("visible");
  document.getElementById("modalDirectorTitulo").textContent = plantelResumen.nombre_plantel || "Editar director";
  document.getElementById("modalDirectorSubtitulo").textContent = plantelResumen.cod_plantel || "";
  formDirector.reset();
  modalDirectorFondo.classList.add("visible");

  // Trae el detalle completo (incluye tipo_documento/documento_identidad,
  // que la tabla de resultados no muestra) antes de dejar editar.
  try {
    const detalle = await RAC.get(`/api/directorio-directores/${encodeURIComponent(plantelResumen.cod_plantel)}`);
    document.getElementById("dirNombre").value = detalle.director_nombre || "";
    document.getElementById("dirTipoDocumento").value = detalle.tipo_documento || "";
    document.getElementById("dirDocumento").value = detalle.documento_identidad || "";
    document.getElementById("dirTelefono").value = detalle.telefono_director || "";
    document.getElementById("dirTelefonoMovil").value = detalle.telefono_movil_director || "";
    document.getElementById("dirCorreo").value = detalle.correo || "";
  } catch (err) {
    errorModalDirector.textContent = err.message;
    errorModalDirector.classList.add("visible");
  }
}

function cerrarEdicionDirector() {
  modalDirectorFondo.classList.remove("visible");
  plantelEnEdicion = null;
}

document.getElementById("btnCancelarDirector").addEventListener("click", cerrarEdicionDirector);
modalDirectorFondo.addEventListener("click", (e) => {
  if (e.target === modalDirectorFondo) cerrarEdicionDirector();
});

formDirector.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!plantelEnEdicion) return;
  errorModalDirector.classList.remove("visible");
  const btn = document.getElementById("btnGuardarDirector");
  btn.disabled = true;
  btn.textContent = "Guardando…";

  const datos = {
    director_nombre: document.getElementById("dirNombre").value.trim() || null,
    tipo_documento: document.getElementById("dirTipoDocumento").value || null,
    documento_identidad: document.getElementById("dirDocumento").value.trim() || null,
    telefono_director: document.getElementById("dirTelefono").value.trim() || null,
    telefono_movil_director: document.getElementById("dirTelefonoMovil").value.trim() || null,
    correo: document.getElementById("dirCorreo").value.trim() || null,
  };

  try {
    await RAC.post(`/api/directorio-directores/${encodeURIComponent(plantelEnEdicion)}`, datos);
    mostrarToast("Datos del director actualizados.");
    cerrarEdicionDirector();
    const q = document.getElementById("qBuscarDirector").value.trim();
    if (q.length >= 2) buscarDirectores(q);
  } catch (err) {
    errorModalDirector.textContent = err.message;
    errorModalDirector.classList.add("visible");
  } finally {
    btn.disabled = false;
    btn.textContent = "Guardar cambios";
  }
});

function escapar(valor) {
  if (valor === undefined || valor === null) return "";
  return String(valor)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
