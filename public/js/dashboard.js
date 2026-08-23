const usuario = renderShell("dashboard", "Resumen");
    if (usuario) cargarResumen();

    async function cargarResumen() {
      const contenido = document.getElementById("contenido");
      contenido.innerHTML = `<div class="cargando">Cargando resumen…</div>`;

      try {
        const [alertasResp, plantelesResp] = await Promise.all([
          RAC.get("/api/alertas"),
          RAC.get("/api/planteles"),
        ]);

        const alertas = RAC.lista(alertasResp, "alertas");
        const planteles = RAC.lista(plantelesResp, "planteles");
        const pendientes = alertas.filter((a) => a.estado === "pendiente");

        contenido.innerHTML = `
          <div class="stats-grid">
            <div class="stat-card acento-riesgo">
              <div class="num">${pendientes.length}</div>
              <div class="lbl">Alertas pendientes de revisión</div>
            </div>
            <div class="stat-card">
              <div class="num">${alertas.length}</div>
              <div class="lbl">Alertas totales registradas</div>
            </div>
            <div class="stat-card acento-sello">
              <div class="num">${planteles.length}</div>
              <div class="lbl">Planteles en el catálogo</div>
            </div>
          </div>

          <div class="panel">
            <div class="panel-cabecera">
              <h2>Últimas alertas pendientes</h2>
              <a class="btn btn-fantasma btn-sm" href="/alertas.html">Ver todas</a>
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
          <td>${etiquetaTipo(a.tipo)}</td>
          <td>${a.detalle || "—"}</td>
          <td><span class="badge badge-pendiente">Pendiente</span></td>
        </tr>
      `).join("");
      return `
        <table>
          <thead><tr><th>Cédula</th><th>Tipo</th><th>Detalle</th><th>Estado</th></tr></thead>
          <tbody>${filas}</tbody>
        </table>
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
