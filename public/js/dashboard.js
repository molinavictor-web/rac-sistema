const usuario = renderShell("dashboard", "Resumen");
if (usuario) cargarResumen();

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
          <span class="hero-eyebrow">SECRETARÍA DE EDUCACIÓN · ESTADO MONAGAS</span>
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
