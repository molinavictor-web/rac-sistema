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
        <div class="hero-content">
          <div class="hero-kicker">Centro de la Calidad Educativa · Estado Monagas</div>
          <h1 class="hero-title">RAC - Sistema</h1>
          <p class="hero-text">Registro de Asignación de Cargos · Gestión y control de la información
  del personal y planteles educativos.</p>
        </div>
        <div class="hero-mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.35"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21V5.5Z"/><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M8 7h8M8 10h7M8 13h5"/></svg></div>
      </section>

      <div class="stats-grid">
        <div class="stat-card acento-riesgo">
          <div class="stat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3 22 20H2L12 3Z"/><path d="M12 9v5M12 17h.01"/></svg></div>
          <div class="num">${pendientes.length}</div><div class="lbl">Alertas pendientes de revisión</div>
        </div>
        <div class="stat-card">
          <div class="stat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/></svg></div>
          <div class="num">${alertas.length}</div><div class="lbl">Alertas totales registradas</div>
        </div>
        <div class="stat-card acento-verde">
          <div class="stat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h16M6 20v-7h12v7M8 13V8h8v5M10 8V4h4v4"/></svg></div>
          <div class="num">${totalPlanteles}</div><div class="lbl">Planteles en el catálogo</div>
        </div>
        <div class="stat-card acento-purple">
          <div class="stat-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="3"/><path d="M5 20c1.3-4 3.6-6 7-6s5.7 2 7 6"/></svg></div>
          <div class="num">${totalRac}</div><div class="lbl">Personal registrado en el RAC</div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-cabecera">
          <div><h2>Últimas alertas pendientes</h2><div class="panel-subtitulo">Revisa y atiende las alertas para mantener la calidad de la información.</div></div>
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
  if (!items.length) return `<div class="vacio"><strong>Sin alertas pendientes</strong>Todo el RAC está al día por ahora.</div>`;
  const filas = items.map((a) => `
    <tr>
      <td><span class="cod">${a.cedula || "—"}</span></td>
      <td class="tipo">${etiquetaTipo(a.tipo)}</td>
      <td>${a.detalle || "—"}</td>
      <td><span class="badge badge-pendiente">Pendiente</span></td>
    </tr>
  `).join("");
  return `<table><thead><tr><th>Cédula</th><th>Tipo</th><th>Detalle</th><th>Estado</th></tr></thead><tbody>${filas}</tbody></table>`;
}

function etiquetaTipo(tipo) {
  const mapa = {
    no_existe_ministerio: "No está en nómina del Ministerio",
    plantel_no_existe: "Plantel no existe",
    horas_invalidas: "Horas fuera de rango",
  };
  return mapa[tipo] || tipo || "—";
}
