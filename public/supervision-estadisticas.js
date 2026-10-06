// supervision-estadisticas.js — pantalla "Estadísticas" del módulo Supervisión.
// Matrícula (hembras / varones) por estado, circuito, municipio y parroquia,
// con búsqueda por circuito y lista de planteles que faltan por cargar matrícula.
// La pestaña "Por tipo de plantel" muestra instituciones y matrícula por
// dependencia (nacional, estadal, municipal, autónoma, subvencionadas, privada)
// y arma el reporte de texto que la profesora de Supervisión envía.
(function () {
  "use strict";

  const usuario = renderShell("supervision-estadisticas", "Estadísticas");
  if (!usuario) return;

  const API = "/api/supervision";
  const ESPERADO_PLANTELES = 990; // universo real; 1 plantel aún no tiene código DEA
  const contenido = document.getElementById("contenido");

  const estado = {
    periodo: null,
    periodos: [],
    datos: null,           // respuesta de /estadisticas
    sinMatricula: [],      // respuesta de /estadisticas/sin-matricula
    dependencias: null,    // respuesta de /estadisticas/dependencias
    depError: null,        // mensaje si falló /estadisticas/dependencias
    alcance: "gescolar",   // "gescolar" = reporte oficial, "todos" = todos los planteles
    pestana: "dependencias",
    soloIncompletos: false,
    abiertos: new Set(),   // municipios desplegados
    circuitoSel: null,
    filtro: { municipio: "", parroquia: "", circuito: "", texto: "" },
  };

  // ---------- utilidades ----------
  const fmt = (n) => Number(n || 0).toLocaleString("es-VE");
  // Miles con punto SIEMPRE (también en 4 cifras: 5.283), como en el reporte de la profesora.
  const miles = (n) => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (s) =>
    String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const pct = (a, b) => (b ? Math.round((a * 100) / b) : 0);
  const aviso = (msg, error) => {
    if (typeof mostrarToast === "function") mostrarToast(msg, !!error);
  };

  function descargarCsv(nombre, cabeceras, filas) {
    const q = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
    const lineas = [cabeceras.map(q).join(";")].concat(filas.map((f) => f.map(q).join(";")));
    const blob = new Blob(["\ufeff" + lineas.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Barrita: el fondo es la parte de hembras y la franja interior la de varones.
  function barra(h, v) {
    const t = h + v;
    if (!t) return `<span class="est-prop vacia" title="Sin matrícula cargada"></span>`;
    const wv = t ? Math.round((v * 100) / t) : 0;
    const tip = `Hembras ${pct(h, t)}% · Varones ${pct(v, t)}%`;
    return `<span class="est-prop" title="${tip}"><span style="width:${wv}%"></span></span>`;
  }

  function cobertura(con, total) {
    const falta = total - con;
    const cls = falta > 0 ? "est-falta" : "est-ok";
    return `<span class="${cls}">${fmt(con)} / ${fmt(total)}</span>`;
  }

  // ---------- esqueleto ----------
  function renderEsqueleto() {
    contenido.innerHTML = `
      <section class="est-hero">
        <div class="est-hero-texto">
          <div class="est-hero-eyebrow">Supervisión · Matrícula escolar</div>
          <div class="est-hero-titulo">Estadísticas de matrícula</div>
          <div class="est-hero-sub">Hembras y varones del estado Monagas, por tipo de plantel, circuito, municipio y parroquia.</div>
        </div>
        <label class="est-hero-periodo">Período escolar
          <select id="estPeriodo"></select>
        </label>
      </section>
      <div class="est-nota" id="estNota"></div>
      <div class="est-kpis" id="estKpis"></div>
      <div class="est-tabs" id="estTabs" role="tablist"></div>
      <div id="estPanel"></div>`;
    document.getElementById("estPeriodo").addEventListener("change", async (e) => {
      estado.periodo = e.target.value;
      estado.circuitoSel = null;
      await cargarDatos();
    });
    contenido.addEventListener("click", onClick);
    contenido.addEventListener("input", onInput);
    contenido.addEventListener("change", onChange);
  }

  function renderPeriodos() {
    const sel = document.getElementById("estPeriodo");
    sel.innerHTML = estado.periodos
      .map((p) => `<option value="${esc(p)}" ${p === estado.periodo ? "selected" : ""}>${esc(p)}</option>`)
      .join("");
  }

  // ---------- tarjetas generales ----------
  function renderKpis() {
    const g = estado.datos.general;
    const total = g.hembras + g.varones;
    const faltan = g.sin_matricula;
    document.getElementById("estKpis").innerHTML = `
      <div class="est-kpi hembras"><div class="etq">Hembras</div><div class="val">${fmt(g.hembras)}</div><div class="sub">${pct(g.hembras, total)}% de la matrícula cargada</div></div>
      <div class="est-kpi varones"><div class="etq">Varones</div><div class="val">${fmt(g.varones)}</div><div class="sub">${pct(g.varones, total)}% de la matrícula cargada</div></div>
      <div class="est-kpi total"><div class="etq">Total estado Monagas</div><div class="val">${fmt(total)}</div><div class="sub">Período ${esc(estado.datos.periodo)}</div></div>
      <div class="est-kpi cobertura ${faltan > 0 ? "falta" : ""}">
        <div class="etq">Planteles con matrícula</div>
        <div class="val">${fmt(g.con_matricula)} de ${fmt(g.planteles)}</div>
        <div class="sub">${faltan > 0
          ? `Faltan ${fmt(faltan)} · <a href="#" data-accion="ir-faltan">ver cuáles</a>`
          : "Todos los planteles cargaron su matrícula"}</div>
      </div>`;

    const notas = [];
    if (g.planteles < ESPERADO_PLANTELES) {
      notas.push(`El sistema tiene ${fmt(g.planteles)} de los ${fmt(ESPERADO_PLANTELES)} planteles del estado (falta el plantel que aún no tiene código DEA).`);
    }
    if (g.sin_circuito > 0) {
      notas.push(`${fmt(g.sin_circuito)} planteles no tienen circuito asignado: cuentan en el total del estado pero no aparecen en ningún circuito.`);
    }
    notas.push("Las cifras suman solo los planteles que ya cargaron su matrícula en este período.");
    document.getElementById("estNota").innerHTML = notas.map(esc).join("<br>");
  }

  // ---------- pestañas ----------
  const PESTANAS = [
    { id: "dependencias", etiqueta: "Por tipo de plantel" },
    { id: "circuitos", etiqueta: "Por circuito" },
    { id: "municipios", etiqueta: "Municipios y parroquias" },
    { id: "buscar", etiqueta: "Buscar circuito" },
    { id: "faltan", etiqueta: "Sin matrícula" },
  ];

  function renderTabs() {
    const faltan = estado.sinMatricula.length;
    document.getElementById("estTabs").innerHTML = PESTANAS.map((p) => {
      const insignia = p.id === "faltan" && faltan > 0 ? `<span class="insignia">${fmt(faltan)}</span>` : "";
      return `<button type="button" role="tab" class="est-tab ${p.id === estado.pestana ? "activo" : ""}" data-accion="pestana" data-id="${p.id}">${p.etiqueta}${insignia}</button>`;
    }).join("");
  }

  function renderPanel() {
    renderTabs();
    const panel = document.getElementById("estPanel");
    if (estado.pestana === "dependencias") {
      panel.innerHTML = htmlDependencias();
      const ta = document.getElementById("estReporte");
      if (ta && estado.dependencias) ta.value = textoReporte(estado.dependencias);
    } else if (estado.pestana === "circuitos") panel.innerHTML = htmlCircuitos();
    else if (estado.pestana === "municipios") panel.innerHTML = htmlMunicipios();
    else if (estado.pestana === "buscar") {
      panel.innerHTML = htmlBuscar();
      actualizarResultadosBusqueda();
    } else {
      panel.innerHTML = htmlFaltan();
      actualizarTablaFaltan();
    }
  }

  // ---------- pestaña: por tipo de plantel ----------
  // Cómo se escribe cada tipo en el reporte de la profesora (matrícula / instituciones).
  const ETIQUETAS_REPORTE = {
    nacional: { mat: "Nacional", inst: "Nacionales" },
    estadal: { mat: "Estadal", inst: "Estadales" },
    municipal: { mat: "Municipal", inst: "Municipales" },
    autonoma: { mat: "Autónomo", inst: "Autónomos" },
    subvencionadas: { mat: "Subvencionado", inst: "Subvencionados" },
    privada: { mat: "Privado", inst: "Privados" },
    otra: { mat: "Otra dependencia", inst: "Otra dependencia" },
    sin_dependencia: { mat: "Sin dependencia", inst: "Sin dependencia" },
  };

  function textoReporte(d) {
    const etq = (t, campo) => (ETIQUETAS_REPORTE[t.clave] || {})[campo] || t.nombre;
    const lineasMatricula = d.tipos.map((t) => `🔹${etq(t, "mat")}: ${miles(t.total)}`);
    const lineasInstituciones = d.tipos.map((t) => `🔹${etq(t, "inst")}: ${miles(t.planteles)}`);
    return [
      "📝Estado: Monagas",
      `📅Período escolar: ${d.periodo}`,
      "🚻Matrícula disgregada por dependencia:",
      ...lineasMatricula,
      `📈Total Matrícula Del Estado: ${miles(d.general.total)}`,
      "✨✨✨✨✨✨✨",
      "🏤Cantidad de instituciones por dependencia:",
      ...lineasInstituciones,
      `📈Total de instituciones en el estado: ${miles(d.general.planteles)}`,
      "✨✨✨✨✨✨",
    ].join("\n");
  }

  function htmlDependencias() {
    if (estado.depError) {
      return `<div class="est-vacio est-error">${esc(estado.depError)}</div>`;
    }
    const d = estado.dependencias;
    if (!d) return `<div class="est-vacio">Cargando…</div>`;
    const g = d.general;
    const al = d.alcances || { todos: 0, gescolar: 0 };

    const filas = d.tipos.map((t) => `
      <tr>
        <td>${esc(t.nombre)}</td>
        <td class="num">${fmt(t.planteles)}</td>
        <td class="num">${cobertura(t.con_matricula, t.planteles)}</td>
        <td class="num">${fmt(t.hembras)}</td>
        <td class="num">${fmt(t.varones)}</td>
        <td class="num"><strong>${fmt(t.total)}</strong></td>
        <td>${barra(t.hembras, t.varones)}</td>
      </tr>`).join("");

    const avisos = [];
    if (d.alcance === "gescolar" && al.todos > al.gescolar) {
      avisos.push(`Reporte oficial: se cuentan los ${fmt(al.gescolar)} planteles registrados en GESCOLAR. El sistema tiene ${fmt(al.todos)} en total (${fmt(al.todos - al.gescolar)} todavía no están en GESCOLAR).`);
    }
    if (g.sin_matricula > 0) {
      avisos.push(`Faltan ${fmt(g.sin_matricula)} de ${fmt(g.planteles)} planteles por cargar la matrícula del período ${d.periodo}: las cifras de matrícula son parciales.`);
    }

    return `
      <div class="est-herramientas">
        <label class="est-campo">Qué planteles contar
          <select id="estAlcance">
            <option value="gescolar" ${d.alcance === "gescolar" ? "selected" : ""}>Reporte oficial (solo planteles en GESCOLAR)</option>
            <option value="todos" ${d.alcance === "todos" ? "selected" : ""}>Todos los planteles del sistema</option>
          </select>
        </label>
        <span class="espacio"></span>
        <button type="button" class="btn btn-sm btn-fantasma" data-accion="csv-dependencias">Exportar CSV</button>
      </div>
      ${avisos.map((a) => `<div class="est-aviso">${esc(a)}</div>`).join("")}
      <div class="tabla-responsive">
        <table class="est-tabla">
          <thead><tr><th>Tipo de plantel</th><th class="num">Instituciones</th><th class="num">Con matrícula</th><th class="num">Hembras</th><th class="num">Varones</th><th class="num">Matrícula total</th><th></th></tr></thead>
          <tbody>${filas}</tbody>
          <tfoot><tr><td>Total estado Monagas</td><td class="num">${fmt(g.planteles)}</td><td class="num">${fmt(g.con_matricula)} / ${fmt(g.planteles)}</td><td class="num">${fmt(g.hembras)}</td><td class="num">${fmt(g.varones)}</td><td class="num">${fmt(g.total)}</td><td></td></tr></tfoot>
        </table>
      </div>
      <p class="est-nota" style="margin-top:8px">Subvencionadas suma las subvencionadas por el MPPE y las oficiales. La matrícula cuenta solo los planteles que ya la cargaron en este período.</p>

      <div class="est-detalle" style="margin-top:16px">
        <h3>Reporte para enviar</h3>
        <div class="meta">Mismo formato del reporte de Supervisión. Puedes editar el texto antes de copiarlo.</div>
        <textarea id="estReporte" rows="21" spellcheck="false" style="width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #c9d3e0;border-radius:8px;font:inherit;line-height:1.5;resize:vertical"></textarea>
        <div class="est-herramientas" style="margin-top:10px">
          <button type="button" class="btn" data-accion="copiar-reporte">Copiar reporte</button>
          <button type="button" class="btn btn-sm btn-fantasma" data-accion="regenerar-reporte">Restablecer texto</button>
        </div>
      </div>`;
  }

  async function copiarReporte() {
    const ta = document.getElementById("estReporte");
    if (!ta || !ta.value.trim()) return;
    let copiado = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(ta.value);
        copiado = true;
      }
    } catch (err) {
      copiado = false;
    }
    if (!copiado) {
      try {
        ta.focus();
        ta.select();
        copiado = document.execCommand("copy");
      } catch (err) {
        copiado = false;
      }
    }
    aviso(copiado ? "Reporte copiado. Ya puedes pegarlo en WhatsApp." : "No se pudo copiar automáticamente: selecciona el texto y cópialo a mano.", !copiado);
  }

  function exportarDependencias() {
    const d = estado.dependencias;
    if (!d) return;
    const filas = d.tipos.map((t) => [t.nombre, t.planteles, t.con_matricula, t.sin_matricula, t.hembras, t.varones, t.total]);
    filas.push(["TOTAL ESTADO MONAGAS", d.general.planteles, d.general.con_matricula, d.general.sin_matricula, d.general.hembras, d.general.varones, d.general.total]);
    descargarCsv(
      `matricula-por-tipo-de-plantel-${d.alcance}-${d.periodo}.csv`,
      ["Tipo de plantel", "Instituciones", "Con matrícula", "Sin matrícula", "Hembras", "Varones", "Matrícula total"],
      filas
    );
  }

  // ---------- pestaña: por circuito ----------
  function circuitosVisibles() {
    return estado.datos.circuitos.filter((c) => !estado.soloIncompletos || c.sin_matricula > 0);
  }

  function htmlCircuitos() {
    const lista = circuitosVisibles();
    const filas = lista.map((c) => `
      <tr class="clic" data-accion="ver-circuito" data-codigo="${esc(c.codigo_circuito)}" title="Ver el detalle de este circuito">
        <td>${esc(c.codigo_circuito)}</td>
        <td>${esc(c.nombre)}</td>
        <td>${esc(c.municipio || "—")}</td>
        <td class="num">${cobertura(c.con_matricula, c.planteles)}</td>
        <td class="num">${fmt(c.hembras)}</td>
        <td class="num">${fmt(c.varones)}</td>
        <td class="num"><strong>${fmt(c.total)}</strong></td>
        <td>${barra(c.hembras, c.varones)}</td>
      </tr>`).join("");
    const tot = lista.reduce((a, c) => ({
      planteles: a.planteles + c.planteles, con: a.con + c.con_matricula,
      h: a.h + c.hembras, v: a.v + c.varones,
    }), { planteles: 0, con: 0, h: 0, v: 0 });

    return `
      <div class="est-herramientas">
        <label class="est-check"><input type="checkbox" id="estSoloIncompletos" ${estado.soloIncompletos ? "checked" : ""}> Solo circuitos con planteles sin matrícula</label>
        <span class="espacio"></span>
        <button type="button" class="btn btn-sm btn-fantasma" data-accion="csv-circuitos">Exportar CSV</button>
      </div>
      <div class="est-contador">Mostrando ${fmt(lista.length)} de ${fmt(estado.datos.circuitos.length)} circuitos. Toca un circuito para ver su detalle.</div>
      <div class="tabla-responsive">
        <table class="est-tabla">
          <thead><tr><th>Código</th><th>Circuito</th><th>Municipio</th><th class="num">Planteles con matrícula</th><th class="num">Hembras</th><th class="num">Varones</th><th class="num">Total</th><th></th></tr></thead>
          <tbody>${filas || `<tr><td colspan="8"><div class="est-vacio">No hay circuitos con esos filtros.</div></td></tr>`}</tbody>
          <tfoot><tr><td colspan="3">Total mostrado</td><td class="num">${fmt(tot.con)} / ${fmt(tot.planteles)}</td><td class="num">${fmt(tot.h)}</td><td class="num">${fmt(tot.v)}</td><td class="num">${fmt(tot.h + tot.v)}</td><td></td></tr></tfoot>
        </table>
      </div>`;
  }

  // ---------- pestaña: municipios y parroquias ----------
  function htmlMunicipios() {
    const filas = estado.datos.municipios.map((m, i) => {
      const abierto = estado.abiertos.has(m.municipio);
      const hijos = m.parroquias.map((p) => `
        <tr class="est-hijo ${abierto ? "visible" : ""}" data-padre="${i}">
          <td>${esc(p.parroquia)}</td>
          <td class="num">${cobertura(p.con_matricula, p.planteles)}</td>
          <td class="num">${fmt(p.hembras)}</td>
          <td class="num">${fmt(p.varones)}</td>
          <td class="num">${fmt(p.total)}</td>
          <td>${barra(p.hembras, p.varones)}</td>
        </tr>`).join("");
      return `
        <tr class="est-muni clic" data-accion="toggle-muni" data-idx="${i}" data-municipio="${esc(m.municipio)}">
          <td><span class="est-flecha ${abierto ? "abierto" : ""}">▸</span>${esc(m.municipio)} <span class="mun" style="font-weight:400;color:#6b7a90">(${m.parroquias.length} ${m.parroquias.length === 1 ? "parroquia" : "parroquias"})</span></td>
          <td class="num">${cobertura(m.con_matricula, m.planteles)}</td>
          <td class="num">${fmt(m.hembras)}</td>
          <td class="num">${fmt(m.varones)}</td>
          <td class="num">${fmt(m.total)}</td>
          <td>${barra(m.hembras, m.varones)}</td>
        </tr>${hijos}`;
    }).join("");
    const g = estado.datos.general;
    return `
      <div class="est-herramientas">
        <button type="button" class="btn btn-sm btn-fantasma" data-accion="abrir-todos">Desplegar todos</button>
        <button type="button" class="btn btn-sm btn-fantasma" data-accion="cerrar-todos">Plegar todos</button>
        <span class="espacio"></span>
        <button type="button" class="btn btn-sm btn-fantasma" data-accion="csv-municipios">Exportar CSV</button>
      </div>
      <div class="est-contador">Toca un municipio para ver sus parroquias.</div>
      <div class="tabla-responsive">
        <table class="est-tabla">
          <thead><tr><th>Municipio / parroquia</th><th class="num">Planteles con matrícula</th><th class="num">Hembras</th><th class="num">Varones</th><th class="num">Total</th><th></th></tr></thead>
          <tbody>${filas}</tbody>
          <tfoot><tr><td>Estado Monagas</td><td class="num">${fmt(g.con_matricula)} / ${fmt(g.planteles)}</td><td class="num">${fmt(g.hembras)}</td><td class="num">${fmt(g.varones)}</td><td class="num">${fmt(g.total)}</td><td></td></tr></tfoot>
        </table>
      </div>`;
  }

  // ---------- pestaña: buscar circuito ----------
  function htmlBuscar() {
    return `
      <div class="est-herramientas">
        <label class="est-campo" style="flex:1 1 320px">Código o nombre del circuito
          <input type="search" id="estBusca" placeholder="Ej.: 160101001 o el nombre del circuito" autocomplete="off" style="width:100%">
        </label>
      </div>
      <div id="estResultados"></div>
      <div id="estDetalle"></div>`;
  }

  function buscarCircuitos(texto) {
    const t = norm(texto);
    if (!t) return [];
    return estado.datos.circuitos
      .filter((c) => norm(c.codigo_circuito).includes(t) || norm(c.nombre).includes(t))
      .slice(0, 30);
  }

  function actualizarResultadosBusqueda() {
    const input = document.getElementById("estBusca");
    const caja = document.getElementById("estResultados");
    if (!input || !caja) return;
    const texto = input.value;
    if (!texto.trim()) {
      caja.innerHTML = `<div class="est-vacio">Escribe el código o parte del nombre del circuito para ver sus datos.</div>`;
    } else {
      const res = buscarCircuitos(texto);
      if (!res.length) {
        caja.innerHTML = `<div class="est-vacio">No se encontró ningún circuito con “${esc(texto)}”.</div>`;
      } else if (res.length === 1 && estado.circuitoSel !== res[0].codigo_circuito) {
        estado.circuitoSel = res[0].codigo_circuito;
        caja.innerHTML = "";
      } else if (res.length > 1) {
        caja.innerHTML = `<div class="est-contador">${res.length} resultados${res.length === 30 ? " (se muestran los primeros 30)" : ""}. Elige uno:</div>
          <ul class="est-lista">${res.map((c) => `
            <li><button type="button" data-accion="ver-circuito" data-codigo="${esc(c.codigo_circuito)}">
              <span class="cod">${esc(c.codigo_circuito)}</span>${esc(c.nombre)} <span class="mun">· ${esc(c.municipio || "sin municipio")}</span>
            </button></li>`).join("")}</ul>`;
      } else {
        caja.innerHTML = "";
      }
    }
    pintarDetalleCircuito();
  }

  function pintarDetalleCircuito() {
    const caja = document.getElementById("estDetalle");
    if (!caja) return;
    const c = estado.circuitoSel && estado.datos.circuitos.find((x) => x.codigo_circuito === estado.circuitoSel);
    if (!c) { caja.innerHTML = ""; return; }
    const faltantes = estado.sinMatricula.filter((p) => p.codigo_circuito === c.codigo_circuito);
    caja.innerHTML = `
      <div class="est-detalle">
        <h3>${esc(c.nombre)}</h3>
        <div class="meta">Circuito ${esc(c.codigo_circuito)} · Municipio ${esc(c.municipio || "sin municipio")} · ${fmt(c.planteles)} planteles${c.activo === false ? " · inactivo" : ""}</div>
        <div class="est-kpis" style="margin-bottom:6px">
          <div class="est-kpi hembras"><div class="etq">Hembras</div><div class="val">${fmt(c.hembras)}</div></div>
          <div class="est-kpi varones"><div class="etq">Varones</div><div class="val">${fmt(c.varones)}</div></div>
          <div class="est-kpi total"><div class="etq">Total</div><div class="val">${fmt(c.total)}</div></div>
          <div class="est-kpi cobertura ${faltantes.length ? "falta" : ""}"><div class="etq">Planteles con matrícula</div><div class="val">${fmt(c.con_matricula)} de ${fmt(c.planteles)}</div></div>
        </div>
        <h4>Planteles sin matrícula en este circuito (${fmt(faltantes.length)})</h4>
        ${faltantes.length ? `
          <div class="est-herramientas"><span class="espacio"></span><button type="button" class="btn btn-sm btn-fantasma" data-accion="csv-faltan-circuito" data-codigo="${esc(c.codigo_circuito)}">Exportar CSV</button></div>
          <div class="tabla-responsive"><table class="est-tabla">
            <thead><tr><th>Código</th><th>Plantel</th><th>Parroquia</th><th>Director</th><th>Teléfono</th></tr></thead>
            <tbody>${faltantes.map((p) => `<tr><td>${esc(p.codigo_plantel)}</td><td>${esc(p.nombre)}</td><td>${esc(p.parroquia)}</td><td>${esc(p.director_nombre || "—")}</td><td>${esc(p.director_telefono || "—")}</td></tr>`).join("")}</tbody>
          </table></div>`
          : `<div class="est-vacio">Todos los planteles de este circuito ya cargaron su matrícula.</div>`}
      </div>`;
  }

  // ---------- pestaña: planteles sin matrícula ----------
  function htmlFaltan() {
    const d = estado.datos;
    const f = estado.filtro;
    const municipios = d.municipios.map((m) => m.municipio);
    const muni = d.municipios.find((m) => m.municipio === f.municipio);
    const parroquias = muni ? muni.parroquias.map((p) => p.parroquia) : [];
    const opt = (v, sel) => `<option value="${esc(v)}" ${v === sel ? "selected" : ""}>${esc(v)}</option>`;
    return `
      <div class="est-herramientas">
        <label class="est-campo">Municipio
          <select id="estFMuni"><option value="">Todos</option>${municipios.map((m) => opt(m, f.municipio)).join("")}</select>
        </label>
        <label class="est-campo">Parroquia
          <select id="estFParr" ${muni ? "" : "disabled"}><option value="">Todas</option>${parroquias.map((p) => opt(p, f.parroquia)).join("")}</select>
        </label>
        <label class="est-campo">Circuito
          <select id="estFCirc"><option value="">Todos</option>${d.circuitos.map((c) => `<option value="${esc(c.codigo_circuito)}" ${c.codigo_circuito === f.circuito ? "selected" : ""}>${esc(c.codigo_circuito)} · ${esc(c.nombre)}</option>`).join("")}</select>
        </label>
        <label class="est-campo" style="flex:1 1 200px">Buscar
          <input type="search" id="estFTexto" placeholder="Plantel, código o director" value="${esc(f.texto)}" autocomplete="off">
        </label>
        <button type="button" class="btn btn-sm btn-fantasma" data-accion="limpiar-filtros">Limpiar</button>
        <button type="button" class="btn btn-sm btn-fantasma" data-accion="csv-faltan">Exportar CSV</button>
      </div>
      <div id="estFaltanTabla"></div>`;
  }

  function faltanFiltrados() {
    const f = estado.filtro;
    const t = norm(f.texto);
    return estado.sinMatricula.filter((p) =>
      (!f.municipio || p.municipio === f.municipio) &&
      (!f.parroquia || p.parroquia === f.parroquia) &&
      (!f.circuito || p.codigo_circuito === f.circuito) &&
      (!t || norm(`${p.codigo_plantel} ${p.nombre} ${p.director_nombre || ""}`).includes(t))
    );
  }

  function actualizarTablaFaltan() {
    const caja = document.getElementById("estFaltanTabla");
    if (!caja) return;
    const lista = faltanFiltrados();
    if (!estado.sinMatricula.length) {
      caja.innerHTML = `<div class="est-vacio">Todos los planteles ya cargaron su matrícula del período ${esc(estado.periodo)}.</div>`;
      return;
    }
    caja.innerHTML = `
      <div class="est-contador">Mostrando ${fmt(lista.length)} de ${fmt(estado.sinMatricula.length)} planteles sin matrícula en el período ${esc(estado.periodo)}.</div>
      <div class="tabla-responsive"><table class="est-tabla">
        <thead><tr><th>Código</th><th>Plantel</th><th>Municipio</th><th>Parroquia</th><th>Circuito</th><th>Director</th><th>Teléfono</th></tr></thead>
        <tbody>${lista.map((p) => `
          <tr>
            <td>${esc(p.codigo_plantel)}</td>
            <td>${esc(p.nombre)}</td>
            <td>${esc(p.municipio)}</td>
            <td>${esc(p.parroquia)}</td>
            <td>${p.codigo_circuito ? `${esc(p.codigo_circuito)} · ${esc(p.nombre_circuito || "")}` : "Sin circuito"}</td>
            <td>${esc(p.director_nombre || "Sin director")}</td>
            <td>${esc(p.director_telefono || "—")}</td>
          </tr>`).join("") || `<tr><td colspan="7"><div class="est-vacio">Ningún plantel coincide con esos filtros.</div></td></tr>`}</tbody>
      </table></div>`;
  }

  // ---------- exportaciones ----------
  const filaFaltan = (p) => [
    p.codigo_plantel, p.nombre, p.municipio, p.parroquia, p.codigo_circuito || "", p.nombre_circuito || "",
    p.director_nombre || "", p.director_telefono || "",
  ];
  const CAB_FALTAN = ["Código plantel", "Plantel", "Municipio", "Parroquia", "Código circuito", "Circuito", "Director", "Teléfono"];

  function exportarCircuitos() {
    descargarCsv(
      `matricula-por-circuito-${estado.periodo}.csv`,
      ["Código circuito", "Circuito", "Municipio", "Planteles", "Con matrícula", "Sin matrícula", "Hembras", "Varones", "Total"],
      circuitosVisibles().map((c) => [c.codigo_circuito, c.nombre, c.municipio || "", c.planteles, c.con_matricula, c.sin_matricula, c.hembras, c.varones, c.total])
    );
  }

  function exportarMunicipios() {
    const filas = [];
    estado.datos.municipios.forEach((m) => {
      filas.push([m.municipio, "(total municipio)", m.planteles, m.con_matricula, m.sin_matricula, m.hembras, m.varones, m.total]);
      m.parroquias.forEach((p) => filas.push([m.municipio, p.parroquia, p.planteles, p.con_matricula, p.sin_matricula, p.hembras, p.varones, p.total]));
    });
    descargarCsv(
      `matricula-municipios-parroquias-${estado.periodo}.csv`,
      ["Municipio", "Parroquia", "Planteles", "Con matrícula", "Sin matrícula", "Hembras", "Varones", "Total"],
      filas
    );
  }

  // ---------- eventos ----------
  function onClick(e) {
    const el = e.target.closest("[data-accion]");
    if (!el) return;
    const accion = el.dataset.accion;
    if (accion === "ir-faltan") {
      e.preventDefault();
      estado.pestana = "faltan";
      renderPanel();
    } else if (accion === "pestana") {
      estado.pestana = el.dataset.id;
      renderPanel();
    } else if (accion === "copiar-reporte") {
      copiarReporte();
    } else if (accion === "regenerar-reporte") {
      const ta = document.getElementById("estReporte");
      if (ta && estado.dependencias) ta.value = textoReporte(estado.dependencias);
    } else if (accion === "csv-dependencias") {
      exportarDependencias();
    } else if (accion === "ver-circuito") {
      estado.circuitoSel = el.dataset.codigo;
      estado.pestana = "buscar";
      renderPanel();
      const input = document.getElementById("estBusca");
      const c = estado.datos.circuitos.find((x) => x.codigo_circuito === estado.circuitoSel);
      if (input && c) input.value = c.codigo_circuito;
      const caja = document.getElementById("estResultados");
      if (caja) caja.innerHTML = "";
      pintarDetalleCircuito();
    } else if (accion === "toggle-muni") {
      const m = el.dataset.municipio;
      if (estado.abiertos.has(m)) estado.abiertos.delete(m); else estado.abiertos.add(m);
      const abierto = estado.abiertos.has(m);
      el.querySelector(".est-flecha").classList.toggle("abierto", abierto);
      document.querySelectorAll(`tr.est-hijo[data-padre="${el.dataset.idx}"]`).forEach((tr) => tr.classList.toggle("visible", abierto));
    } else if (accion === "abrir-todos") {
      estado.datos.municipios.forEach((m) => estado.abiertos.add(m.municipio));
      renderPanel();
    } else if (accion === "cerrar-todos") {
      estado.abiertos.clear();
      renderPanel();
    } else if (accion === "limpiar-filtros") {
      estado.filtro = { municipio: "", parroquia: "", circuito: "", texto: "" };
      renderPanel();
    } else if (accion === "csv-circuitos") {
      exportarCircuitos();
    } else if (accion === "csv-municipios") {
      exportarMunicipios();
    } else if (accion === "csv-faltan") {
      descargarCsv(`planteles-sin-matricula-${estado.periodo}.csv`, CAB_FALTAN, faltanFiltrados().map(filaFaltan));
    } else if (accion === "csv-faltan-circuito") {
      const cod = el.dataset.codigo;
      descargarCsv(`sin-matricula-circuito-${cod}-${estado.periodo}.csv`, CAB_FALTAN,
        estado.sinMatricula.filter((p) => p.codigo_circuito === cod).map(filaFaltan));
    }
  }

  function onInput(e) {
    if (e.target.id === "estBusca") {
      estado.circuitoSel = null;
      actualizarResultadosBusqueda();
    } else if (e.target.id === "estFTexto") {
      estado.filtro.texto = e.target.value;
      actualizarTablaFaltan();
    }
  }

  async function onChange(e) {
    const id = e.target.id;
    if (id === "estAlcance") {
      estado.alcance = e.target.value === "todos" ? "todos" : "gescolar";
      await cargarDependencias();
      renderPanel();
    } else if (id === "estSoloIncompletos") {
      estado.soloIncompletos = e.target.checked;
      renderPanel();
    } else if (id === "estFMuni") {
      estado.filtro.municipio = e.target.value;
      estado.filtro.parroquia = "";
      renderPanel();
    } else if (id === "estFParr") {
      estado.filtro.parroquia = e.target.value;
      actualizarTablaFaltan();
    } else if (id === "estFCirc") {
      estado.filtro.circuito = e.target.value;
      actualizarTablaFaltan();
    }
  }

  // ---------- carga de datos ----------
  // Si esta consulta falla no se cae el resto de la pantalla: solo la pestaña
  // "Por tipo de plantel" muestra el error.
  async function cargarDependencias() {
    estado.depError = null;
    try {
      const q = `?periodo=${encodeURIComponent(estado.periodo)}&alcance=${encodeURIComponent(estado.alcance)}`;
      estado.dependencias = await RAC.get(`${API}/estadisticas/dependencias${q}`);
    } catch (err) {
      estado.dependencias = null;
      estado.depError = (err && err.message) || "No se pudieron cargar las estadísticas por tipo de plantel.";
    }
  }

  async function cargarDatos() {
    const panel = document.getElementById("estPanel");
    panel.innerHTML = `<div class="est-vacio">Cargando estadísticas…</div>`;
    try {
      const q = `?periodo=${encodeURIComponent(estado.periodo)}`;
      const [datos, faltan] = await Promise.all([
        RAC.get(`${API}/estadisticas${q}`),
        RAC.get(`${API}/estadisticas/sin-matricula${q}`),
        cargarDependencias(),
      ]);
      estado.datos = datos;
      estado.sinMatricula = faltan.planteles || [];
      renderKpis();
      renderPanel();
    } catch (err) {
      const msg = (err && err.message) || "No se pudieron cargar las estadísticas.";
      panel.innerHTML = `<div class="est-vacio est-error">${esc(msg)}</div>`;
      aviso(msg, true);
    }
  }

  async function iniciar() {
    renderEsqueleto();
    try {
      const r = await RAC.get(`${API}/estadisticas/periodos`);
      estado.periodos = r.periodos && r.periodos.length ? r.periodos : [r.periodo_defecto];
      estado.periodo = r.periodo_defecto || estado.periodos[0];
      renderPeriodos();
    } catch (err) {
      const msg = (err && err.message) || "No se pudieron cargar los períodos escolares.";
      document.getElementById("estPanel").innerHTML = `<div class="est-vacio est-error">${esc(msg)}</div>`;
      aviso(msg, true);
      return;
    }
    await cargarDatos();
  }

  iniciar();
})();
