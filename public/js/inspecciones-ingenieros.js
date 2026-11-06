// inspecciones-ingenieros.js — Ingenieros e inspecciones.
// Dos grupos (lista oficial): INGENIEROS, que pueden estar a cargo de un plantel (columna RESPONSABLE de GESCOLAR),
// y personal de APOYO (en formación, administrativo, sistemas), que solo participa en equipos. Cada grupo se
// compara contra su propio promedio y lleva sus 3 insignias: los ingenieros por planteles a cargo, el apoyo por
// planteles en equipo.
// Un plantel tiene un solo ingeniero a cargo. Lo ven todos los perfiles del módulo; administrador y coordinador
// además asignan responsable y equipo a CUALQUIER plantel (con o sin plan), y el administrador mantiene la lista
// oficial y unifica escrituras distintas de un mismo nombre en GESCOLAR.

const usuario = renderShell("inspecciones-ingenieros", "Ingenieros");
const PUEDE_GESTIONAR = ["admin", "insp_coordinador"].includes(usuario && usuario.rol);
const ES_ADMIN = Boolean(usuario && usuario.rol === "admin");
let RESUMEN = null;
const ABIERTOS = new Set(); // nombres de ingenieros con la lista desplegada

if (usuario) cargar();

async function cargar() {
  document.getElementById("contenido").innerHTML = `
    <section class="planteles-hero">
      <div class="planteles-hero-copy">
        <span class="planteles-eyebrow">INSPECCIONES</span>
        <h1>Ingenieros e inspecciones</h1>
        <p>Planteles a cargo de cada ingeniero (campo RESPONSABLE de GESCOLAR) y su participación en los equipos de inspección.</p>
        ${PUEDE_GESTIONAR ? `<div style="margin-top:12px; display:flex; gap:10px; flex-wrap:wrap;">
          <button type="button" class="btn btn-primario btn-sm" id="btnAsignar">Asignar plantel</button>
          <button type="button" class="btn btn-fantasma btn-sm" id="btnHistorial" style="background:#fff;">Historial de asignaciones</button>
          ${ES_ADMIN ? `<button type="button" class="btn btn-fantasma btn-sm" id="btnLista" style="background:#fff;">Lista de ingenieros</button>
          <button type="button" class="btn btn-fantasma btn-sm" id="btnCorregir" style="background:#fff;">Corregir nombres</button>` : ""}
        </div>` : ""}
      </div>
    </section>
    <div class="panel">
      <div style="padding:16px 20px 0; display:flex; gap:12px; flex-wrap:wrap; align-items:center; justify-content:space-between;">
        <input type="search" id="buscar" placeholder="Buscar ingeniero, plantel, código o municipio…" style="flex:1; min-width:240px; padding:8px 12px; border:1px solid var(--borde); border-radius:8px;">
        <span id="resumen" style="color:var(--muted); font-size:.8rem;"></span>
      </div>
      <div id="tabla" style="margin-top:12px;"><div class="cargando">Cargando…</div></div>
    </div>`;
  document.getElementById("buscar").addEventListener("input", pintar);
  if (PUEDE_GESTIONAR) {
    document.getElementById("btnAsignar").addEventListener("click", () => abrirAsignar(null));
    document.getElementById("btnHistorial").addEventListener("click", verHistorial);
    if (ES_ADMIN) {
      document.getElementById("btnLista").addEventListener("click", verLista);
      document.getElementById("btnCorregir").addEventListener("click", corregirNombres);
    }
  }
  try {
    RESUMEN = await RAC.get("/api/inspecciones/resumen-ingenieros");
    pintar();
  } catch (err) {
    document.getElementById("tabla").innerHTML = `<div class="vacio"><strong>No se pudo cargar el resumen</strong>${escapar(err.message)}</div>`;
  }
}

function coincide(p, q) {
  return `${p.nombre_plantel} ${p.codigo_dea} ${p.municipio || ""} ${p.parroquia || ""}`.toLowerCase().includes(q);
}

// Ingenieros (pueden ir a cargo) de la lista oficial, o todos los que aparezcan si aún no hay lista.
function baseIngenieros() {
  return RESUMEN.ingenieros.filter((g) => g.tipo !== "APOYO" && (!RESUMEN.lista_oficial || g.en_lista));
}
function baseApoyo() {
  return RESUMEN.ingenieros.filter((g) => g.tipo === "APOYO");
}
// Todos los nombres de la lista (para marcar el equipo).
function baseTodos() {
  return RESUMEN.ingenieros.filter((g) => !RESUMEN.lista_oficial || g.en_lista);
}

// Posición (1, 2, 3) por valores distintos de la medida del grupo: los empatados comparten insignia. Solo con valor > 0.
function posiciones(grupo, medida) {
  const distintos = [...new Set(grupo.map(medida).filter((t) => t > 0))].sort((a, b) => b - a).slice(0, 3);
  return new Map(distintos.map((t, i) => [t, i + 1]));
}

const COLOR_PUESTO = { 1: "#d69e2e", 2: "#718096", 3: "#b7791f" };

const fmt = (n) => n.toLocaleString("es-VE", { maximumFractionDigits: 1 });

// Una fila (ingeniero o personal de apoyo). ctx: { apoyo, promedio, maximo, puestos, q }.
// Ingenieros: medida = planteles a cargo. Apoyo: medida = planteles en equipo.
function bloqueDe(g, ctx) {
  const { apoyo, promedio, maximo, puestos, q } = ctx;
  const medida = apoyo ? g.en_equipo : g.total;
  const todos = (apoyo ? [] : g.planteles).concat(g.planteles_equipo || []);
  const porNombre = q && g.nombre.toLowerCase().includes(q);
  const filtrados = q && !porNombre ? todos.filter((p) => coincide(p, q)) : todos;
  if (q && !porNombre && !filtrados.length) return "";
  const forzado = Boolean(q) && !porNombre;
  const abierto = ABIERTOS.has(g.nombre) || forzado;
  const accion = forzado
    ? `<span style="color:var(--muted); font-size:.8rem;">${filtrados.length} coincidencia${filtrados.length === 1 ? "" : "s"}</span>`
    : `<button type="button" class="btn ${abierto ? "btn-fantasma" : "btn-primario"} btn-sm" data-ver="${escapar(g.nombre)}">${abierto ? "Ocultar planteles" : "Ver planteles"}</button>`;
  let detalle = "";
  if (abierto) {
    const aCargoVis = apoyo ? [] : (q && !porNombre ? g.planteles.filter((p) => coincide(p, q)) : g.planteles);
    const equipoVis = q && !porNombre ? (g.planteles_equipo || []).filter((p) => coincide(p, q)) : (g.planteles_equipo || []);
    const filas = aCargoVis.map((p) => `<tr>
      <td><span class="cod">${escapar(p.codigo_dea)}</span></td>
      <td>${escapar(p.nombre_plantel)}</td>
      <td>${[escapar(p.municipio), escapar(p.parroquia)].filter(Boolean).join(" · ")}</td>
      <td>${p.tarea ? escapar(p.tarea) : ""}</td>
      <td style="white-space:nowrap;"><a class="btn btn-fantasma btn-sm" href="/inspecciones/plantel.html?cod=${encodeURIComponent(p.codigo_dea)}">Ver ficha</a>${PUEDE_GESTIONAR ? ` <button type="button" class="btn btn-fantasma btn-sm" data-editar="${escapar(p.codigo_dea)}" data-nombre="${escapar(p.nombre_plantel)}" data-resp="${escapar(g.nombre)}">Editar</button> <button type="button" class="btn btn-fantasma btn-sm" data-quitar="${escapar(p.codigo_dea)}" data-nombre="${escapar(p.nombre_plantel)}" data-resp="${escapar(g.nombre)}">Quitar</button>` : ""}</td>
    </tr>`).join("");
    const filasEq = equipoVis.map((p) => `<tr>
      <td><span class="cod">${escapar(p.codigo_dea)}</span></td>
      <td>${escapar(p.nombre_plantel)}</td>
      <td>${[escapar(p.municipio), escapar(p.parroquia)].filter(Boolean).join(" · ")}</td>
      <td style="white-space:nowrap;"><a class="btn btn-fantasma btn-sm" href="/inspecciones/plantel.html?cod=${encodeURIComponent(p.codigo_dea)}">Ver ficha</a>${PUEDE_GESTIONAR ? ` <button type="button" class="btn btn-fantasma btn-sm" data-editar="${escapar(p.codigo_dea)}" data-nombre="${escapar(p.nombre_plantel)}" data-resp="">Equipo</button>` : ""}</td>
    </tr>`).join("");
    detalle = `<div style="background:var(--surface-2, #f5f8fc); padding:4px 12px 14px;">
      ${aCargoVis.length ? `<div style="font-weight:600; font-size:.8rem; margin:8px 0 2px;">A su cargo (${aCargoVis.length})</div>
      <div class="tabla-responsive"><table>
        <thead><tr><th>Código</th><th>Plantel</th><th>Municipio · Parroquia</th><th>Tarea</th><th></th></tr></thead>
        <tbody>${filas}</tbody>
      </table></div>` : ""}
      ${equipoVis.length ? `<div style="font-weight:600; font-size:.8rem; margin:10px 0 2px;">Participó en el equipo (${equipoVis.length})</div>
      <div class="tabla-responsive"><table>
        <thead><tr><th>Código</th><th>Plantel</th><th>Municipio · Parroquia</th><th></th></tr></thead>
        <tbody>${filasEq}</tbody>
      </table></div>` : ""}
      ${!aCargoVis.length && !equipoVis.length ? `<p style="color:var(--muted); font-size:.82rem; margin:10px 0 0;">Todavía no tiene planteles registrados.</p>` : ""}
    </div>`;
  }
  const puesto = RESUMEN.lista_oficial && !g.en_lista ? 0 : puestos.get(medida) || 0;
  const insignia = puesto ? `<span title="${puesto}.º ${apoyo ? "en planteles de equipo" : "en planteles a cargo"}" style="display:inline-flex; align-items:center; justify-content:center; width:22px; height:22px; border-radius:50%; background:${COLOR_PUESTO[puesto]}; color:#fff; font-size:.72rem; font-weight:700; margin-right:8px;">${puesto}</span>` : "";
  const fuera = RESUMEN.lista_oficial && !g.en_lista ? `<span style="background:#fff7ed; color:#9c4221; font-size:.68rem; font-weight:600; padding:2px 6px; border-radius:999px; margin-left:8px;">fuera de la lista oficial</span>` : "";
  const dif = Math.round((medida - promedio) * 10) / 10;
  const chip = dif === 0 ? "en el promedio" : `${dif > 0 ? "+" : "−"}${fmt(Math.abs(dif))} vs promedio`;
  const colorChip = dif > 0.5 ? "background:#fff7ed; color:#9c4221;" : dif < -0.5 ? "background:#ebf4ff; color:#2c5282;" : "background:#e6f4ea; color:#276749;";
  const ancho = maximo ? Math.round((medida / maximo) * 100) : 0;
  const cifra = (n, rotulo) => `<span style="text-align:center; line-height:1.1; min-width:62px;"><span style="font-size:1.2rem; font-weight:700;">${n}</span><br><span style="font-size:.64rem; color:var(--muted); text-transform:uppercase; letter-spacing:.04em;">${rotulo}</span></span>`;
  const cifras = apoyo ? cifra(g.en_equipo, "en equipo") : `${cifra(g.total, "a cargo")}${cifra(g.en_equipo, "en equipo")}${cifra(g.participacion, "participación")}`;
  return `<div style="border-top:1px solid var(--borde, #e3e9f1);">
    <div style="display:flex; align-items:center; gap:12px; padding:12px 20px; flex-wrap:wrap;">
      <div style="flex:1 1 200px; min-width:0;">
        <div style="display:flex; align-items:center;">${insignia}<strong>${escapar(g.nombre)}</strong>${fuera}</div>
        <div style="height:5px; background:#edf2f7; border-radius:3px; margin-top:6px; max-width:260px;"><div style="height:5px; width:${ancho}%; background:${apoyo ? "#38a169" : "#1a73e8"}; border-radius:3px;"></div></div>
      </div>
      <span style="${colorChip} font-size:.72rem; font-weight:600; padding:2px 8px; border-radius:999px; white-space:nowrap;">${chip}</span>
      ${cifras}
      ${accion}
    </div>
    ${detalle}
  </div>`;
}

function pintar() {
  if (!RESUMEN) return;
  const q = document.getElementById("buscar").value.trim().toLowerCase();
  const ingenieros = baseIngenieros();
  const apoyo = baseApoyo();
  const aCargo = ingenieros.reduce((a, g) => a + g.total, 0);
  const promIng = ingenieros.length ? aCargo / ingenieros.length : 0;
  const promApoyo = apoyo.length ? apoyo.reduce((a, g) => a + g.en_equipo, 0) / apoyo.length : 0;
  document.getElementById("resumen").textContent =
    `${ingenieros.length} ingeniero${ingenieros.length === 1 ? "" : "s"}` + (apoyo.length ? ` · ${apoyo.length} de apoyo` : "") +
    ` · ${RESUMEN.planteles_con_responsable} planteles inspeccionados de ${RESUMEN.total_planteles_gescolar}` +
    (ingenieros.length ? ` · promedio ${fmt(promIng)} a cargo por ingeniero` : "");
  const cont = document.getElementById("tabla");
  if (!RESUMEN.ingenieros.length) {
    cont.innerHTML = `<div class="vacio"><strong>Todavía no hay ingenieros</strong>Cuando se llene la columna RESPONSABLE o la lista oficial aparecerán aquí.</div>`;
    return;
  }
  const ctxIng = { apoyo: false, promedio: promIng, maximo: ingenieros.length ? Math.max(...ingenieros.map((g) => g.total)) : 0, puestos: posiciones(ingenieros, (g) => g.total), q };
  const ctxApoyo = { apoyo: true, promedio: promApoyo, maximo: apoyo.length ? Math.max(...apoyo.map((g) => g.en_equipo)) : 0, puestos: posiciones(apoyo, (g) => g.en_equipo), q };
  // Los nombres fuera de la lista oficial (que no son de apoyo) se muestran con los ingenieros, marcados.
  const filasIng = RESUMEN.ingenieros.filter((g) => g.tipo !== "APOYO").map((g) => bloqueDe(g, ctxIng)).filter(Boolean);
  const filasApoyo = apoyo.slice().sort((a, b) => b.en_equipo - a.en_equipo || a.nombre.localeCompare(b.nombre, "es")).map((g) => bloqueDe(g, ctxApoyo)).filter(Boolean);
  if (!filasIng.length && !filasApoyo.length) {
    cont.innerHTML = `<div class="vacio"><strong>Sin resultados</strong>Prueba con otro texto.</div>`;
    return;
  }
  const titulo = (t, sub) => `<div style="padding:14px 20px 6px; border-top:1px solid var(--borde, #e3e9f1);"><strong style="font-size:.9rem;">${t}</strong> <span style="color:var(--muted); font-size:.78rem;">${sub}</span></div>`;
  cont.innerHTML =
    (filasIng.length ? (apoyo.length ? titulo("Ingenieros", "a cargo de planteles · se comparan entre ellos") : "") + filasIng.join("") : "") +
    (filasApoyo.length ? titulo("Personal de apoyo", "participan en equipos · se comparan entre ellos") + filasApoyo.join("") : "");
  cont.querySelectorAll("[data-ver]").forEach((b) => {
    b.addEventListener("click", () => {
      const n = b.dataset.ver;
      if (ABIERTOS.has(n)) ABIERTOS.delete(n); else ABIERTOS.add(n);
      pintar();
    });
  });
  cont.querySelectorAll("[data-editar]").forEach((b) => {
    b.addEventListener("click", () => abrirAsignar({ cod_plantel: b.dataset.editar, nombre_plantel: b.dataset.nombre, responsable: b.dataset.resp }));
  });
  cont.querySelectorAll("[data-quitar]").forEach((b) => {
    b.addEventListener("click", () => quitar(b.dataset.quitar, b.dataset.nombre, b.dataset.resp));
  });
}

async function recargar() {
  RESUMEN = await RAC.get("/api/inspecciones/resumen-ingenieros");
  pintar();
}

async function quitar(codigo, nombre, resp) {
  if (!window.confirm(`¿Quitar a ${resp} como responsable de «${nombre}»?\n\nEl plantel quedará sin ingeniero a cargo en GESCOLAR y se le resta un plantel a ${resp}.`)) return;
  try {
    await RAC.post("/api/inspecciones/ingenieros/asignar-plantel", { codigo_dea: codigo, responsable: null });
    mostrarToast("Plantel sin responsable.");
    await recargar();
  } catch (err) {
    mostrarToast(err.message, true);
  }
}

// Ventana para asignar el responsable y el equipo de un plantel. Con "previo" ya viene el plantel elegido;
// sin él se busca el plantel en GESCOLAR (con o sin plan). Con lista oficial solo se elige de la lista.
function abrirAsignar(previo) {
  let plantel = previo ? { cod_plantel: previo.cod_plantel, nombre_plantel: previo.nombre_plantel, responsable: previo.responsable || "" } : null;
  let equipoInicial = [];
  const nombres = baseIngenieros().map((g) => g.nombre).sort((a, b) => a.localeCompare(b, "es")); // pueden ir a cargo
  const nombresEquipo = baseTodos().map((g) => g.nombre).sort((a, b) => a.localeCompare(b, "es")); // pueden ir en el equipo
  const libre = !RESUMEN.lista_oficial; // sin lista oficial se permite escribir un nombre nuevo
  const fondo = document.createElement("div");
  fondo.className = "modal-fondo visible";
  fondo.innerHTML = `
    <div class="modal" style="max-width:540px;">
      <h2 style="margin-bottom:4px;">Responsable y equipo de un plantel</h2>
      <p style="margin:0 0 12px; color:var(--muted); font-size:.85rem;">El plantel no necesita estar en un plan. Tiene un solo ingeniero a cargo (se guarda en GESCOLAR, columna RESPONSABLE) y puede tener un equipo que participó en la inspección.</p>
      <div id="zonaPlantel"></div>
      <div id="zonaIngeniero" style="display:none; margin-top:14px;">
        <label for="selIng" style="font-weight:600; font-size:.85rem;">Ingeniero a cargo</label>
        <select id="selIng" style="width:100%; margin-top:4px;"></select>
        <input type="text" id="inpNuevo" maxlength="80" placeholder="Nombre y apellido" style="width:100%; margin-top:6px; display:none;">
        <div id="avisoCambio" style="display:none; margin-top:8px; padding:8px 10px; border-radius:8px; background:#fff7ed; border:1px solid #f6ad55; font-size:.8rem;"></div>
        <div style="margin-top:14px; font-weight:600; font-size:.85rem;">Equipo que participó <span style="font-weight:400; color:var(--muted);">(opcional; se cuenta en «en equipo»)</span></div>
        <div id="listaEquipo" style="max-height:190px; overflow:auto; margin-top:4px; display:grid; grid-template-columns:repeat(auto-fill,minmax(210px,1fr)); gap:2px 10px;"></div>
        <p style="margin:6px 0 0; color:var(--muted); font-size:.74rem;">Los ingenieros anotados en la planilla del plantel se cuentan siempre en su equipo.</p>
      </div>
      <div class="error-msg" id="errorAsig"></div>
      <div style="display:flex; gap:10px; margin-top:14px;">
        <button type="button" class="btn btn-primario" id="btnGuardarAsig" disabled>Guardar</button>
        <button type="button" class="btn btn-fantasma" id="btnCancelarAsig">Cancelar</button>
      </div>
    </div>`;
  document.body.appendChild(fondo);
  const cerrar = () => fondo.remove();
  const zona = fondo.querySelector("#zonaPlantel");
  const zonaIng = fondo.querySelector("#zonaIngeniero");
  const sel = fondo.querySelector("#selIng");
  const nuevo = fondo.querySelector("#inpNuevo");
  const aviso = fondo.querySelector("#avisoCambio");
  const guardar = fondo.querySelector("#btnGuardarAsig");
  const errorEl = fondo.querySelector("#errorAsig");
  const listaEq = fondo.querySelector("#listaEquipo");

  const elegido = () => (sel.value === "__nuevo__" ? nuevo.value.replace(/\s+/g, " ").trim() : sel.value === "__ninguno__" ? "" : sel.value);
  const marcados = () => [...listaEq.querySelectorAll("input:checked")].map((c) => c.value).sort();
  const mismoEquipo = () => JSON.stringify(marcados()) === JSON.stringify(equipoInicial.slice().sort());
  const mismoResp = () => elegido().toLowerCase() === (plantel.responsable || "").toLowerCase();

  function refrescar() {
    nuevo.style.display = sel.value === "__nuevo__" ? "block" : "none";
    if (!plantel) { guardar.disabled = true; return; }
    const v = elegido();
    const actual = plantel.responsable || "";
    guardar.disabled = (mismoResp() && mismoEquipo()) || (sel.value === "__nuevo__" && !v) || sel.value === "";
    if (actual && !mismoResp()) {
      aviso.style.display = "block";
      aviso.innerHTML = v
        ? `Este plantel ya figura con <strong>${escapar(actual)}</strong>. Al guardar pasa a <strong>${escapar(v)}</strong> (a ${escapar(actual)} se le resta un plantel a cargo).`
        : `Este plantel figura con <strong>${escapar(actual)}</strong>. Al guardar quedará sin responsable.`;
    } else {
      aviso.style.display = "none";
    }
  }

  function pintarEquipo() {
    const actualResp = elegido().toLowerCase();
    listaEq.innerHTML = nombresEquipo.map((n) => `<label style="display:flex; gap:6px; align-items:center; padding:3px 0; font-size:.84rem; cursor:pointer;">
        <input type="checkbox" value="${escapar(n)}" ${equipoInicial.some((e) => e.toLowerCase() === n.toLowerCase()) ? "checked" : ""} ${n.toLowerCase() === actualResp ? "disabled" : ""}> ${escapar(n)}</label>`).join("");
    listaEq.querySelectorAll("input").forEach((c) => c.addEventListener("change", refrescar));
  }

  async function mostrarIngeniero() {
    zonaIng.style.display = "block";
    const actual = plantel.responsable || "";
    const ops = [`<option value="" ${actual ? "" : "selected"} disabled>Elige un ingeniero…</option>`];
    nombres.forEach((n) => ops.push(`<option value="${escapar(n)}" ${n.toLowerCase() === actual.toLowerCase() ? "selected" : ""}>${escapar(n)}</option>`));
    if (libre) ops.push(`<option value="__nuevo__">Otro (nombre nuevo)…</option>`);
    if (actual) ops.push(`<option value="__ninguno__">— Sin responsable —</option>`);
    sel.innerHTML = ops.join("");
    equipoInicial = [];
    try {
      const e = await RAC.get(`/api/inspecciones/ingenieros/equipo/${encodeURIComponent(plantel.cod_plantel)}`);
      equipoInicial = [...new Set((e.propios || []).concat(e.planilla || []).map((x) => nombresEquipo.find((n) => n.toLowerCase() === String(x).toLowerCase())).filter(Boolean))];
    } catch (_) { /* si falla se muestra vacío */ }
    pintarEquipo();
    refrescar();
  }

  function pintarZonaPlantel() {
    if (plantel) {
      zona.innerHTML = `<div style="padding:10px 12px; border:1px solid var(--borde); border-radius:8px; display:flex; gap:10px; align-items:center; justify-content:space-between;">
        <div><strong>${escapar(plantel.nombre_plantel)}</strong><br><small style="color:var(--muted);"><span class="cod">${escapar(plantel.cod_plantel)}</span> · ${plantel.responsable ? "A cargo: " + escapar(plantel.responsable) : "Sin responsable"}</small></div>
        ${previo ? "" : `<button type="button" class="btn btn-fantasma btn-sm" id="btnOtroPlantel">Cambiar plantel</button>`}
      </div>`;
      const b = zona.querySelector("#btnOtroPlantel");
      if (b) b.addEventListener("click", () => { plantel = null; zonaIng.style.display = "none"; guardar.disabled = true; pintarZonaPlantel(); });
      mostrarIngeniero();
    } else {
      zona.innerHTML = `<label for="inpBuscarP" style="font-weight:600; font-size:.85rem;">Plantel</label>
        <input type="search" id="inpBuscarP" placeholder="Nombre, código DEA, municipio o parroquia…" style="width:100%; margin-top:4px; padding:8px 12px; border:1px solid var(--borde); border-radius:8px;">
        <div id="resultadosP" style="max-height:220px; overflow:auto; margin-top:6px;"></div>`;
      const inp = zona.querySelector("#inpBuscarP");
      const res = zona.querySelector("#resultadosP");
      let temporizador = null;
      let ultima = 0;
      inp.addEventListener("input", () => {
        clearTimeout(temporizador);
        const q = inp.value.trim();
        if (q.length < 2) { res.innerHTML = ""; return; }
        temporizador = setTimeout(async () => {
          const turno = ++ultima;
          res.innerHTML = `<div class="cargando">Buscando…</div>`;
          try {
            const r = await RAC.get(`/api/inspecciones/ingenieros/buscar-plantel?q=${encodeURIComponent(q)}`);
            if (turno !== ultima) return;
            if (!r.planteles.length) { res.innerHTML = `<p style="color:var(--muted); font-size:.82rem;">Sin resultados.</p>`; return; }
            res.innerHTML = r.planteles.map((p, i) => `<div data-i="${i}" style="padding:8px 10px; border-bottom:1px solid var(--borde); cursor:pointer;">
              <strong>${escapar(p.nombre_plantel)}</strong><br><small style="color:var(--muted);"><span class="cod">${escapar(p.cod_plantel)}</span> · ${[escapar(p.municipio), escapar(p.parroquia)].filter(Boolean).join(" · ")} · ${p.responsable ? escapar(p.responsable) : "sin responsable"}</small></div>`).join("") +
              (r.limitado ? `<p style="color:var(--muted); font-size:.76rem; margin:6px 0 0;">Hay más resultados; afina la búsqueda.</p>` : "");
            res.querySelectorAll("[data-i]").forEach((el) => el.addEventListener("click", () => {
              plantel = r.planteles[Number(el.dataset.i)];
              pintarZonaPlantel();
            }));
          } catch (err) {
            if (turno === ultima) res.innerHTML = `<p style="color:#c53030; font-size:.82rem;">${escapar(err.message)}</p>`;
          }
        }, 300);
      });
      inp.focus();
    }
  }

  sel.addEventListener("change", () => { pintarEquipoConservando(); refrescar(); if (sel.value === "__nuevo__") nuevo.focus(); });
  nuevo.addEventListener("input", refrescar);
  // Al cambiar de responsable, ese ingeniero no puede ser también del equipo: se desmarca y bloquea.
  function pintarEquipoConservando() {
    const previos = new Set(marcados().map((x) => x.toLowerCase()));
    equipoInicial.forEach((e) => { /* el equipo guardado se compara siempre contra lo marcado */ });
    const resp = elegido().toLowerCase();
    listaEq.querySelectorAll("input").forEach((c) => {
      const es = c.value.toLowerCase() === resp;
      if (es) c.checked = false;
      c.disabled = es;
      if (!es && previos.has(c.value.toLowerCase())) c.checked = true;
    });
  }
  fondo.querySelector("#btnCancelarAsig").addEventListener("click", cerrar);
  fondo.addEventListener("click", (e) => { if (e.target === fondo) cerrar(); });
  guardar.addEventListener("click", async () => {
    errorEl.classList.remove("visible");
    guardar.disabled = true;
    guardar.textContent = "Guardando…";
    try {
      let mensaje = "Cambios guardados.";
      if (!mismoResp()) {
        const r = await RAC.post("/api/inspecciones/ingenieros/asignar-plantel", { codigo_dea: plantel.cod_plantel, responsable: elegido() || null });
        mensaje = r.responsable ? `Asignado a ${r.responsable}.` : "Plantel sin responsable.";
      }
      if (!mismoEquipo()) {
        await RAC.put(`/api/inspecciones/ingenieros/equipo/${encodeURIComponent(plantel.cod_plantel)}`, { nombres: marcados() });
        mensaje += " Equipo guardado.";
      }
      mostrarToast(mensaje);
      cerrar();
      await recargar();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.add("visible");
      guardar.disabled = false;
      guardar.textContent = "Guardar";
    }
  });
  pintarZonaPlantel();
}

// Lista oficial de ingenieros (solo admin): agregar y retirar/reactivar. No se borra ni se renombra.
async function verLista() {
  const fondo = document.createElement("div");
  fondo.className = "modal-fondo visible";
  fondo.innerHTML = `<div class="modal" style="max-width:520px;">
    <h2 style="margin-bottom:4px;">Lista de ingenieros y equipos</h2>
    <p style="margin:0 0 10px; color:var(--muted); font-size:.82rem;">Solo estos nombres se pueden elegir. Los <strong>ingenieros</strong> pueden quedar a cargo de un plantel; el personal de <strong>apoyo</strong> solo participa en equipos. Editar un nombre lo corrige en todos los sitios; retirar conserva su historial; eliminar solo se permite si no tiene nada registrado.</p>
    <div style="display:flex; gap:8px; margin-bottom:10px;">
      <input type="text" id="inpAgregar" maxlength="80" placeholder="Nombre y apellido (MAYÚSCULAS)" style="flex:1; padding:8px 12px; border:1px solid var(--borde); border-radius:8px;">
      <select id="selTipoNuevo"><option value="INGENIERO">Ingeniero</option><option value="APOYO">Apoyo</option></select>
      <button type="button" class="btn btn-primario btn-sm" id="btnAgregar">Agregar</button>
    </div>
    <div class="error-msg" id="errorLista"></div>
    <div id="cuerpoLista" style="max-height:50vh; overflow:auto;"><div class="cargando">Cargando…</div></div>
    <div style="margin-top:14px;"><button type="button" class="btn btn-fantasma" id="btnCerrarLista">Cerrar</button></div>
  </div>`;
  document.body.appendChild(fondo);
  let cambio = false;
  const cerrar = async () => { fondo.remove(); if (cambio) { try { await recargar(); } catch (_) {} } };
  fondo.querySelector("#btnCerrarLista").addEventListener("click", cerrar);
  fondo.addEventListener("click", (e) => { if (e.target === fondo) cerrar(); });
  const cuerpo = fondo.querySelector("#cuerpoLista");
  const errorEl = fondo.querySelector("#errorLista");
  async function pintarLista() {
    try {
      const r = await RAC.get("/api/inspecciones/ingenieros/catalogo");
      cuerpo.innerHTML = r.ingenieros.length
        ? `<table><tbody>` + r.ingenieros.map((c) => `<tr><td style="${c.activo ? "" : "color:var(--muted); text-decoration:line-through;"}">${escapar(c.nombre)} <span style="font-size:.68rem; font-weight:600; padding:2px 6px; border-radius:999px; ${c.tipo === "APOYO" ? "background:#e6f4ea; color:#276749;" : "background:#ebf4ff; color:#2c5282;"}">${c.tipo === "APOYO" ? "apoyo" : "ingeniero"}</span></td>
            <td style="text-align:right; white-space:nowrap;"><button type="button" class="btn btn-fantasma btn-sm" data-editar-nombre="${Number(c.id)}" data-nombre="${escapar(c.nombre)}">Editar</button>
              <button type="button" class="btn btn-fantasma btn-sm" data-tipo="${Number(c.id)}" data-nuevo-tipo="${c.tipo === "APOYO" ? "INGENIERO" : "APOYO"}">${c.tipo === "APOYO" ? "Pasar a ingeniero" : "Pasar a apoyo"}</button>
              <button type="button" class="btn btn-fantasma btn-sm" data-id="${Number(c.id)}" data-activo="${c.activo ? "0" : "1"}">${c.activo ? "Retirar" : "Reactivar"}</button>
              <button type="button" class="btn btn-fantasma btn-sm" data-eliminar="${Number(c.id)}" data-nombre="${escapar(c.nombre)}">Eliminar</button></td></tr>`).join("") + `</tbody></table>`
        : `<div class="vacio"><strong>La lista está vacía</strong>Agrega a los ingenieros arriba.</div>`;
      cuerpo.querySelectorAll("[data-id]").forEach((b) => b.addEventListener("click", async () => {
        errorEl.classList.remove("visible");
        try {
          await RAC.patch(`/api/inspecciones/ingenieros/catalogo/${b.dataset.id}`, { activo: b.dataset.activo === "1" });
          cambio = true;
          await pintarLista();
        } catch (err) { errorEl.textContent = err.message; errorEl.classList.add("visible"); }
      }));
      cuerpo.querySelectorAll("[data-editar-nombre]").forEach((b) => b.addEventListener("click", async () => {
        errorEl.classList.remove("visible");
        const nuevo = window.prompt(`Nuevo nombre para ${b.dataset.nombre}.\n\nSe corregirá también en GESCOLAR, en los equipos y en las planillas donde ya figura.`, b.dataset.nombre);
        if (nuevo === null || nuevo.trim().toUpperCase() === b.dataset.nombre) return;
        try {
          await RAC.patch(`/api/inspecciones/ingenieros/catalogo/${b.dataset.editarNombre}`, { nombre: nuevo });
          cambio = true;
          mostrarToast("Nombre actualizado.");
          await pintarLista();
        } catch (err) { errorEl.textContent = err.message; errorEl.classList.add("visible"); }
      }));
      cuerpo.querySelectorAll("[data-tipo]").forEach((b) => b.addEventListener("click", async () => {
        errorEl.classList.remove("visible");
        try {
          await RAC.patch(`/api/inspecciones/ingenieros/catalogo/${b.dataset.tipo}`, { tipo: b.dataset.nuevoTipo });
          cambio = true;
          await pintarLista();
        } catch (err) { errorEl.textContent = err.message; errorEl.classList.add("visible"); }
      }));
      cuerpo.querySelectorAll("[data-eliminar]").forEach((b) => b.addEventListener("click", async () => {
        errorEl.classList.remove("visible");
        if (!window.confirm(`¿Eliminar a ${b.dataset.nombre} de la lista?\n\nSolo se puede si no tiene nada registrado.`)) return;
        try {
          await RAC.del(`/api/inspecciones/ingenieros/catalogo/${b.dataset.eliminar}`);
          cambio = true;
          mostrarToast("Ingeniero eliminado de la lista.");
          await pintarLista();
        } catch (err) { errorEl.textContent = err.message; errorEl.classList.add("visible"); }
      }));
    } catch (err) {
      cuerpo.innerHTML = `<div class="vacio"><strong>No se pudo cargar la lista</strong>${escapar(err.message)}</div>`;
    }
  }
  fondo.querySelector("#btnAgregar").addEventListener("click", async () => {
    errorEl.classList.remove("visible");
    const inp = fondo.querySelector("#inpAgregar");
    try {
      await RAC.post("/api/inspecciones/ingenieros/catalogo", { nombre: inp.value, tipo: fondo.querySelector("#selTipoNuevo").value });
      inp.value = "";
      cambio = true;
      await pintarLista();
    } catch (err) { errorEl.textContent = err.message; errorEl.classList.add("visible"); }
  });
  pintarLista();
}

// Corregir nombres (solo admin): valores de RESPONSABLE en GESCOLAR que no coinciden con la lista oficial.
async function corregirNombres() {
  const fondo = document.createElement("div");
  fondo.className = "modal-fondo visible";
  fondo.innerHTML = `<div class="modal" style="max-width:720px;">
    <h2 style="margin-bottom:4px;">Corregir nombres en GESCOLAR</h2>
    <p style="margin:0 0 10px; color:var(--muted); font-size:.82rem;">Estos valores de la columna RESPONSABLE no están escritos igual que la lista oficial. Elige cómo corregir cada uno; lo que dejes en «No tocar» no se modifica.</p>
    <div id="cuerpoCorr" style="max-height:55vh; overflow:auto;"><div class="cargando">Revisando GESCOLAR…</div></div>
    <div class="error-msg" id="errorCorr"></div>
    <div style="display:flex; gap:10px; margin-top:14px;">
      <button type="button" class="btn btn-primario" id="btnAplicarCorr" disabled>Aplicar correcciones</button>
      <button type="button" class="btn btn-fantasma" id="btnCerrarCorr">Cerrar</button>
    </div>
  </div>`;
  document.body.appendChild(fondo);
  const cerrar = () => fondo.remove();
  fondo.querySelector("#btnCerrarCorr").addEventListener("click", cerrar);
  fondo.addEventListener("click", (e) => { if (e.target === fondo) cerrar(); });
  const cuerpo = fondo.querySelector("#cuerpoCorr");
  const aplicar = fondo.querySelector("#btnAplicarCorr");
  const errorEl = fondo.querySelector("#errorCorr");
  let datos;
  try {
    datos = await RAC.get("/api/inspecciones/ingenieros/corregir-nombres/vista-previa");
  } catch (err) {
    cuerpo.innerHTML = `<div class="vacio"><strong>No se pudo revisar</strong>${escapar(err.message)}</div>`;
    return;
  }
  if (datos.lista_vacia) { cuerpo.innerHTML = `<div class="vacio"><strong>La lista oficial está vacía</strong>Primero agrega a los ingenieros en «Lista de ingenieros».</div>`; return; }
  if (!datos.valores.length) { cuerpo.innerHTML = `<div class="vacio"><strong>Todo coincide</strong>Todos los nombres de GESCOLAR están escritos como en la lista oficial.</div>`; return; }
  cuerpo.innerHTML = `<div class="tabla-responsive"><table><thead><tr><th>Como está en GESCOLAR</th><th>Planteles</th><th>Corregir a</th></tr></thead><tbody>` +
    datos.valores.map((v, i) => `<tr><td><strong>${escapar(v.actual)}</strong>${v.motivo ? `<br><small style="color:var(--muted);">${escapar(v.motivo)}</small>` : ""}</td>
      <td>${v.planteles.length}</td>
      <td><select data-i="${i}" style="width:100%;"><option value="">— No tocar —</option>${datos.lista.map((n) => `<option value="${escapar(n)}" ${n === v.sugerido ? "selected" : ""}>${escapar(n)}</option>`).join("")}</select></td></tr>`).join("") + `</tbody></table></div>`;
  const elegidas = () => [...cuerpo.querySelectorAll("select")].filter((s) => s.value).map((s) => ({ actual: datos.valores[Number(s.dataset.i)].actual, nuevo: s.value }));
  const refrescar = () => { aplicar.disabled = !elegidas().length; };
  cuerpo.querySelectorAll("select").forEach((s) => s.addEventListener("change", refrescar));
  refrescar();
  aplicar.addEventListener("click", async () => {
    errorEl.classList.remove("visible");
    aplicar.disabled = true;
    aplicar.textContent = "Aplicando…";
    try {
      const r = await RAC.post("/api/inspecciones/ingenieros/corregir-nombres/aplicar", { confirmar: true, correcciones: elegidas() });
      mostrarToast(`${r.aplicados} plantel${r.aplicados === 1 ? "" : "es"} corregido${r.aplicados === 1 ? "" : "s"}.`);
      cerrar();
      await recargar();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.add("visible");
      aplicar.disabled = false;
      aplicar.textContent = "Aplicar correcciones";
    }
  });
}

async function verHistorial() {
  const fondo = document.createElement("div");
  fondo.className = "modal-fondo visible";
  fondo.innerHTML = `<div class="modal" style="max-width:760px;">
    <h2 style="margin-bottom:8px;">Historial de asignaciones</h2>
    <div id="cuerpoHist" style="max-height:60vh; overflow:auto;"><div class="cargando">Cargando…</div></div>
    <div style="margin-top:14px;"><button type="button" class="btn btn-fantasma" id="btnCerrarHist">Cerrar</button></div>
  </div>`;
  document.body.appendChild(fondo);
  const cerrar = () => fondo.remove();
  fondo.querySelector("#btnCerrarHist").addEventListener("click", cerrar);
  fondo.addEventListener("click", (e) => { if (e.target === fondo) cerrar(); });
  const cuerpo = fondo.querySelector("#cuerpoHist");
  try {
    const r = await RAC.get("/api/inspecciones/ingenieros/historial");
    if (!r.cambios.length) { cuerpo.innerHTML = `<div class="vacio"><strong>Todavía no hay cambios registrados</strong>Aparecerán aquí las asignaciones hechas desde esta pantalla.</div>`; return; }
    cuerpo.innerHTML = `<div class="tabla-responsive"><table><thead><tr><th>Fecha</th><th>Plantel</th><th>Antes</th><th>Ahora</th><th>Hecho por</th></tr></thead><tbody>` +
      r.cambios.map((c) => `<tr>
        <td>${escapar(new Date(c.creado_en).toLocaleString("es-VE"))}</td>
        <td>${escapar(c.plantel)}<br><small class="cod">${escapar(c.codigo_dea)}</small></td>
        <td>${c.anterior ? escapar(c.anterior) : "<em>sin responsable</em>"}</td>
        <td>${c.nuevo ? escapar(c.nuevo) : "<em>sin responsable</em>"}</td>
        <td>${escapar(c.usuario || "")}</td></tr>`).join("") + `</tbody></table></div>`;
  } catch (err) {
    cuerpo.innerHTML = `<div class="vacio"><strong>No se pudo cargar el historial</strong>${escapar(err.message)}</div>`;
  }
}

function escapar(valor) {
  if (valor === undefined || valor === null) return "";
  return String(valor).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
