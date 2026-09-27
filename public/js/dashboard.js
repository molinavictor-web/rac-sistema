const usuario = renderShell("dashboard", "Resumen");
if (usuario) cargarResumen();

function accion(href, color, icono, texto) {
  return `
    <a class="accion-rapida" href="${href}">
      <span class="accion-icono ${color}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${icono}</svg></span>
      <span>${texto}</span>
      <span class="accion-flecha">›</span>
    </a>`;
}

function accionesRapidasHtml(usuario) {
  let filas = "";

  if (usuario.rol === "admin") {
    filas =
      accion("/carga-completa.html", "accion-verde", '<path d="M5 3h14v18H5zM8 7h8M8 11h8M8 15h5"/>', "Cargar archivo Excel") +
      accion("/rac.html", "accion-azul", '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>', "Consultar un registro") +
      accion("/exportar-rac.html", "accion-morada", '<path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14"/>', "Exportar información") +
      accion("/planteles.html", "accion-cian", '<path d="m3 10 9-6 9 6M5 10v10h14V10M9 20v-6h6v6"/>', "Gestionar planteles") +
      accion("/alertas.html", "accion-naranja", '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4"/>', "Ver alertas");
  } else if (usuario.rol === "operador") {
    filas =
      accion("/alertas.html", "accion-naranja", '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4"/>', "Ver alertas") +
      accion("/planteles.html", "accion-cian", '<path d="m3 10 9-6 9 6M5 10v10h14V10M9 20v-6h6v6"/>', "Gestionar planteles") +
      accion("/directorio-directores.html", "accion-azul", '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M6 17c.6-2 1.6-3 3-3s2.4 1 3 3M15 9h3M15 13h3"/>', "Consultar director") +
      accion("/depurar-archivo.html", "accion-morada", '<path d="m4 20 5-5m-2-6 5-5 8 8-5 5H7V9Z"/><path d="M14 6 18 10"/>', "Depurar archivo") +
      accion("/cargas.html", "accion-verde", '<path d="M12 3v12m0 0 4-4m-4 4-4-4M4 20h16"/>', "Cargar por municipio");
  }

  if (!filas) return "";

  return `
    <div class="panel acciones-rapidas">
      <div class="acciones-rapidas-cab">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"/></svg>
        Acciones rápidas
      </div>
      ${filas}
    </div>`;
}

async function cargarResumen() {
  const contenido = document.getElementById("contenido");
  contenido.innerHTML = `<div class="cargando">Cargando resumen…</div>`;

  try {
    const [alertasResp, plantelesResp, racResp] = await Promise.all([
      RAC.get("/api/alertas"),
      RAC.get("/api/planteles"),
      RAC.get("/api/rac"),
    ]);

    const alertas = RAC.lista(alertasResp, "alertas");
    const pendientes = alertas.filter((a) => a.estado === "pendiente");
    const totalPlanteles = plantelesResp.total ?? RAC.lista(plantelesResp, "planteles").length;
    const totalRac = racResp.total ?? RAC.lista(racResp, "rac").length;

    contenido.innerHTML = `
      <section class="dashboard-hero">
        <div class="hero-copy">
          <span class="hero-eyebrow">CENTRO DE LA CALIDAD EDUCATIVA · ESTADO MONAGAS</span>
          <h2>RAC · Sistema</h2>
          <p>Registro de Asignación de Cargos</p>
          <small>Gestión, validación y control de la información del personal y planteles educativos.</small>
        </div>
        <div class="hero-symbol" aria-hidden="true">
          <svg viewBox="0 0 64 64">
            <path d="M18 9h29a4 4 0 0 1 4 4v34a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4V13a4 4 0 0 1 4-4Z"/>
            <path d="M24 21h21M24 30h21M24 39h14"/>
            <path d="M18 51 12 56V13a4 4 0 0 1 4-4"/>
          </svg>
        </div>
        <div class="hero-accent hero-accent-yellow"></div>
        <div class="hero-accent hero-accent-red"></div>
      </section>

      <div class="stats-grid">
        <div class="stat-card stat-alert acento-riesgo">
          <div class="stat-icon">
            <svg viewBox="0 0 24 24"><path d="M10.3 4.3 2.7 18a2 2 0 0 0 1.75 3h15.1a2 2 0 0 0 1.75-3L13.7 4.3a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></svg>
          </div>
          <div class="num">${pendientes.length}</div>
          <div class="lbl">Alertas pendientes de revisión</div>
        </div>

        <div class="stat-card stat-info">
          <div class="stat-icon">
            <svg viewBox="0 0 24 24"><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/></svg>
          </div>
          <div class="num">${alertas.length}</div>
          <div class="lbl">Alertas totales registradas</div>
        </div>

        <div class="stat-card stat-success acento-sello">
          <div class="stat-icon">
            <svg viewBox="0 0 24 24"><path d="M4 21h16M6 21V9h12v12M9 9V5h6v4M9 13h6M9 17h6"/></svg>
          </div>
          <div class="num">${totalPlanteles}</div>
          <div class="lbl">Planteles en el catálogo</div>
        </div>

        <div class="stat-card stat-purple">
          <div class="stat-icon">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4.2 3.4-6.5 8-6.5s7.2 2.3 8 6.5"/></svg>
          </div>
          <div class="num">${totalRac}</div>
          <div class="lbl">Personal registrado en el RAC</div>
        </div>
      </div>

      <div class="dashboard-cols">
        <div class="panel dashboard-panel">
          <div class="panel-cabecera">
            <div>
              <h2>Últimas alertas pendientes</h2>
              <p class="panel-subtitulo">Revisa y atiende las alertas para mantener la calidad de la información.</p>
            </div>
            <a class="btn btn-fantasma btn-sm" href="/alertas.html">Ver todas →</a>
          </div>
          ${tablaAlertas(pendientes.slice(0, 6))}
        </div>

        <div class="dashboard-lateral">
          ${accionesRapidasHtml(usuario)}

          <div class="banner-gob">
            <svg class="banner-gob-icono" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 58V26l18-12 18 12v32"/><path d="M20 58V34h8v24M36 58V34h8v24M32 14V6M27 9h10"/></svg>
            <div class="banner-gob-texto">
              <strong>Mejores datos,<br>mejores decisiones</strong>
              <span>Juntos por una educación de calidad.</span>
            </div>
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    contenido.innerHTML = `<div class="vacio"><strong>No se pudo cargar el resumen</strong>${err.message}</div>`;
  }
}

function tablaAlertas(items) {
  if (!items.length) {
    return `<div class="vacio"><strong>Sin alertas pendientes</strong>Todo el RAC está al día por ahora.</div>`;
  }
  const filas = items.map((a) => `
    <tr>
      <td><span class="cod">${a.cedula || "—"}</span></td>
      <td><span class="tipo-alerta">${etiquetaTipo(a.tipo)}</span></td>
      <td>${a.detalle || "—"}</td>
      <td><span class="badge badge-pendiente">Pendiente</span></td>
    </tr>
  `).join("");
  return `
    <div class="tabla-responsive">
      <table>
        <thead><tr><th>Cédula</th><th>Tipo</th><th>Detalle</th><th>Estado</th></tr></thead>
        <tbody>${filas}</tbody>
      </table>
    </div>
  `;
}

function etiquetaTipo(tipo) {
  const mapa = {
    no_existe_ministerio: "No está en nómina del Ministerio",
    plantel_no_existe: "Plantel no existe",
    horas_invalidas: "Horas fuera de rango",
  };
  return mapa[tipo] || tipo || "—";
}
