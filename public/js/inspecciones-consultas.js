// inspecciones-consultas.js — lista de consultas exprés del Instrumento Uno.
// Admin y coordinadores crean y cierran consultas (eligen una o varias fases); todos los que llenan entran por «Llenar».

const usuario = renderShell("inspecciones-consultas", "Consultas exprés");
const API = "/api/inspecciones/consultas";

function escapar(v) {
  return String(v === undefined || v === null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

let FASES = [];
let LISTA = { consultas: [], puede_crear: false, puede_llenar: false };

if (usuario) iniciar();

async function iniciar() {
  document.getElementById("contenido").innerHTML = `
    <section class="planteles-hero"><div class="planteles-hero-copy">
      <span class="planteles-eyebrow">INSPECCIONES</span>
      <h1>Consultas exprés</h1>
      <p>Pide solo una parte del Instrumento Uno. Se escribe el código DEA del plantel, se traen los datos que ya existen, se verifican o actualizan y se guarda. Sirve para cualquier plantel.</p>
    </div></section>
    <div id="nueva"></div>
    <div id="lista"><div class="panel"><div class="cargando">Cargando…</div></div></div>`;
  await cargar();
}

async function cargar() {
  const cont = document.getElementById("lista");
  try {
    const [f, l] = await Promise.all([RAC.get(`${API}/fases`), RAC.get(`${API}/`)]);
    FASES = f.fases;
    LISTA = l;
  } catch (err) {
    cont.innerHTML = `<div class="panel"><div class="iu-msg-error" style="padding:14px;">${escapar(err.message)}</div></div>`;
    return;
  }
  dibujarNueva();
  dibujarLista();
}

function dibujarNueva() {
  const cont = document.getElementById("nueva");
  if (!LISTA.puede_crear) { cont.innerHTML = ""; return; }
  cont.innerHTML = `
    <div class="panel iu-bloque" style="margin-bottom:14px;">
      <h2>Nueva consulta</h2>
      <p class="iu-ayuda">Ponle un nombre y marca las fases que quieres pedir. Entre menos fases, más corta y fácil de llenar.</p>
      <div class="iu-campo"><label for="cNombre">Nombre</label><input type="text" id="cNombre" maxlength="120" placeholder="Ej.: Servicios e infraestructura — noviembre" autocomplete="off"></div>
      <div class="iu-campo"><label>Fases que incluye</label>
        <div class="ce-fases">${FASES.map((f) => `<label><input type="checkbox" data-fase="${escapar(f.id)}"> ${escapar(f.titulo)}</label>`).join("")}</div>
        <div class="iu-nota">«Edificio compartido» todavía no está disponible en las consultas exprés.</div>
      </div>
      <div class="iu-msg-error" id="cError"></div>
      <button type="button" class="btn btn-primario" id="btnCrear">Crear consulta</button>
    </div>`;
  document.getElementById("btnCrear").addEventListener("click", crear);
}

async function crear() {
  const err = document.getElementById("cError");
  err.textContent = "";
  const nombre = document.getElementById("cNombre").value.trim();
  const fases = [...document.querySelectorAll("[data-fase]:checked")].map((x) => x.dataset.fase);
  if (!nombre) { err.textContent = "Ponle un nombre a la consulta."; return; }
  if (!fases.length) { err.textContent = "Marca al menos una fase."; return; }
  const b = document.getElementById("btnCrear");
  b.disabled = true;
  try {
    await RAC.post(`${API}/`, { nombre, fases });
    mostrarToast("Consulta creada.");
    await cargar();
  } catch (e) {
    err.textContent = e.message;
  } finally {
    b.disabled = false;
  }
}

function fecha(iso) {
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toLocaleDateString("es-VE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function dibujarLista() {
  const cont = document.getElementById("lista");
  if (!LISTA.consultas.length) {
    cont.innerHTML = `<div class="panel"><div class="vacio"><strong>No hay consultas ${LISTA.puede_crear ? "todavía" : "abiertas"}</strong>${LISTA.puede_crear ? "Crea la primera con el formulario de arriba." : "Cuando un coordinador cree una, aparecerá aquí."}</div></div>`;
    return;
  }
  cont.innerHTML = LISTA.consultas.map((c) => `
    <div class="ce-tarjeta">
      <h3>${escapar(c.nombre)} <span class="ce-etq ${c.estado === "ABIERTA" ? "abierta" : "cerrada"}">${c.estado === "ABIERTA" ? "Abierta" : "Cerrada"}</span></h3>
      <div>${c.titulos_fases.map((t) => `<span class="ce-etq">${escapar(t)}</span>`).join("")}</div>
      <div class="iu-nota">Creada el ${escapar(fecha(c.creado_en))}${c.creado_por_nombre ? " por " + escapar(c.creado_por_nombre) : ""} · ${c.planteles_actualizados} plantel(es) actualizado(s) · ${c.cambios} cambio(s)</div>
      <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">
        ${c.estado === "ABIERTA" && LISTA.puede_llenar ? `<a class="btn btn-primario" style="text-decoration:none;" href="/inspecciones/consulta-llenar.html?id=${c.id}">Llenar</a>` : ""}
        ${LISTA.puede_crear ? `<button type="button" class="btn btn-fantasma" data-estado="${c.estado === "ABIERTA" ? "CERRADA" : "ABIERTA"}" data-id="${c.id}">${c.estado === "ABIERTA" ? "Cerrar consulta" : "Reabrir"}</button>` : ""}
        ${LISTA.puede_crear ? `<button type="button" class="btn btn-fantasma" data-eliminar="${c.id}" data-nombre="${escapar(c.nombre)}">Eliminar</button>` : ""}
      </div>
    </div>`).join("");
  cont.querySelectorAll("[data-eliminar]").forEach((b) => b.addEventListener("click", async () => {
    if (!window.confirm(`¿Eliminar la consulta «${b.dataset.nombre}»?\n\nLos datos que ya se guardaron con ella NO se borran: siguen en los planteles y en «Cambios recientes». Solo desaparece la consulta de la lista.`)) return;
    b.disabled = true;
    try {
      await RAC.del(`${API}/${b.dataset.eliminar}`);
      mostrarToast("Consulta eliminada.");
      await cargar();
    } catch (e) {
      mostrarToast(e.message, true);
      b.disabled = false;
    }
  }));
  cont.querySelectorAll("[data-estado]").forEach((b) => b.addEventListener("click", async () => {
    b.disabled = true;
    try {
      await RAC.patch(`${API}/${b.dataset.id}`, { estado: b.dataset.estado });
      await cargar();
    } catch (e) {
      mostrarToast(e.message, true);
      b.disabled = false;
    }
  }));
}
