// instrumento-uno.js — entrada del INSTRUMENTO UNO CDCE: se escribe el código DEA para iniciar (o retomar)
// una visita, y abajo está la lista de visitas.

const usuario = renderShell("inspecciones-iu", "Instrumento Uno CDCE");
const BASE = "/api/inspecciones/instrumento-uno";
const PUEDE_CREAR = usuario && ["admin", "insp_coordinador", "insp_ingeniero"].includes(usuario.rol);

function escapar(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function fechaCorta(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d) ? String(iso) : d.toLocaleDateString("es-VE");
}

if (usuario) iniciar();

function iniciar() {
  document.getElementById("contenido").innerHTML = `
    <section class="planteles-hero">
      <div class="planteles-hero-copy">
        <span class="planteles-eyebrow">INSPECCIONES</span>
        <h1>INSTRUMENTO UNO CDCE</h1>
        <p>Datos de la visita exprés a un plantel: escribe el código DEA, confirma lo que ya hay en GESCOLAR y completa el resto.</p>
      </div>
    </section>
    ${PUEDE_CREAR ? `<div class="panel"><div class="iu-nueva">
      <form id="formNueva">
        <div><label for="codigoDea">Código DEA del plantel</label><input type="text" id="codigoDea" autocomplete="off" placeholder="Ej.: OD06031608"></div>
        <button type="submit" class="btn btn-primario" id="btnIniciar">Iniciar visita</button>
      </form>
      <div class="iu-msg-error" id="errNueva" style="color:#b3261e; font-size:.85rem; margin-top:8px;"></div>
    </div></div>` : ""}
    <div class="panel">
      <div class="filtros" style="padding:14px 20px; display:flex; gap:10px; flex-wrap:wrap;">
        <input type="text" id="buscar" placeholder="Buscar por código o nombre" style="padding:9px 12px; border:1px solid #c7d2e0; border-radius:9px; min-width:220px;">
        <select id="estado" style="padding:9px 12px; border:1px solid #c7d2e0; border-radius:9px;">
          <option value="">Todas</option><option value="BORRADOR">Borradores</option><option value="ENVIADA">Enviadas</option>
        </select>
      </div>
      <div id="lista"><div class="cargando">Cargando…</div></div>
    </div>`;
  const form = document.getElementById("formNueva");
  if (form) form.addEventListener("submit", iniciarVisita);
  let t = null;
  document.getElementById("buscar").addEventListener("input", () => { clearTimeout(t); t = setTimeout(cargarLista, 300); });
  document.getElementById("estado").addEventListener("change", cargarLista);
  cargarLista();
}

async function iniciarVisita(e) {
  e.preventDefault();
  const codigo = document.getElementById("codigoDea").value.trim();
  const err = document.getElementById("errNueva");
  err.textContent = "";
  if (!codigo) { err.textContent = "Escribe el código DEA."; return; }
  const btn = document.getElementById("btnIniciar");
  btn.disabled = true; btn.textContent = "Buscando en GESCOLAR…";
  try {
    const r = await RAC.post(`${BASE}/visitas`, { codigo_dea: codigo });
    window.location.href = `/inspecciones/instrumento-uno-visita.html?id=${r.id}`;
  } catch (ex) {
    err.textContent = ex.message;
    btn.disabled = false; btn.textContent = "Iniciar visita";
  }
}

async function cargarLista() {
  const cont = document.getElementById("lista");
  const q = document.getElementById("buscar").value.trim();
  const estado = document.getElementById("estado").value;
  try {
    const { visitas } = await RAC.get(`${BASE}/visitas?q=${encodeURIComponent(q)}&estado=${estado}`);
    if (!visitas.length) {
      cont.innerHTML = `<div class="vacio"><strong>Todavía no hay visitas</strong>${PUEDE_CREAR ? "Escribe un código DEA arriba para iniciar la primera." : ""}</div>`;
      return;
    }
    cont.innerHTML = `<div class="tabla-responsive"><table>
      <thead><tr><th>Código DEA</th><th>Plantel</th><th>Municipio</th><th>Estado</th><th>Fecha visita</th><th>Ingeniero</th><th>Cód. infraestructura</th><th></th></tr></thead>
      <tbody>${visitas.map((v) => `<tr>
        <td><code>${escapar(v.codigo_dea)}</code></td>
        <td>${escapar(v.nombre_plantel)}</td>
        <td>${escapar(v.municipio)}</td>
        <td><span class="iu-etq ${v.estado === "ENVIADA" ? "enviada" : "borrador"}">${v.estado === "ENVIADA" ? "Enviada" : "Borrador"}</span></td>
        <td>${escapar(v.fecha_visita ? fechaCorta(v.fecha_visita + "T12:00:00") : "")}</td>
        <td>${escapar(v.ingeniero || "")}</td>
        <td>${escapar(v.codigo_infraestructura || "")}${v.codigo_infraestructura && !v.infra_sincronizada ? ` <small title="Aún no escrito en la hoja Coordenadas Planteles">⚠</small>` : ""}</td>
        <td style="white-space:nowrap;"><a class="btn btn-fantasma btn-sm" href="/inspecciones/instrumento-uno-visita.html?id=${v.id}">${v.estado === "BORRADOR" ? "Continuar" : "Abrir"}</a>${v.puede_eliminar ? ` <button type="button" class="btn btn-fantasma btn-sm" data-eliminar="${v.id}" data-nombre="${escapar(v.nombre_plantel || v.codigo_dea)}" data-estado="${v.estado}" style="color:#b3261e;">Eliminar</button>` : ""}</td>
      </tr>`).join("")}</tbody></table></div>`;
    cont.querySelectorAll("[data-eliminar]").forEach((b) => b.addEventListener("click", () => eliminar(b)));
  } catch (ex) {
    cont.innerHTML = `<div class="vacio"><strong>No se pudo cargar la lista</strong>${escapar(ex.message)}</div>`;
  }
}

async function eliminar(b) {
  const enviada = b.dataset.estado === "ENVIADA";
  const msg = `¿Eliminar la visita de «${b.dataset.nombre}»? Esta acción no se puede deshacer.` +
    (enviada ? "\n\nEstá ENVIADA: se quitará del sistema, pero lo que ya se escribió en la hoja «Coordenadas Planteles» no se borra." : "");
  if (!window.confirm(msg)) return;
  b.disabled = true;
  try {
    await RAC.del(`${BASE}/visitas/${b.dataset.eliminar}`);
    try { Object.keys(localStorage).filter((k) => k.endsWith("_" + b.dataset.eliminar) && k.startsWith("iu_borrador_")).forEach((k) => localStorage.removeItem(k)); } catch (_) { /* nada */ }
    mostrarToast("Visita eliminada.");
    cargarLista();
  } catch (ex) {
    b.disabled = false;
    mostrarToast(ex.message, true);
  }
}
