const usuario = renderShell("alertas", "Alertas");
    let todasLasAlertas = [];
    let filtroActual = "pendiente";

    if (usuario) cargarAlertas();

    async function cargarAlertas() {
      const contenido = document.getElementById("contenido");
      contenido.innerHTML = `<div class="cargando">Cargando alertas…</div>`;
      try {
        const resp = await RAC.get("/api/alertas");
        todasLasAlertas = RAC.lista(resp, "alertas");
        dibujarPanel();
      } catch (err) {
        contenido.innerHTML = `<div class="vacio"><strong>No se pudieron cargar las alertas</strong>${err.message}</div>`;
      }
    }

    function dibujarPanel() {
      const contenido = document.getElementById("contenido");
      contenido.innerHTML = `
        <div class="panel">
          <div class="panel-cabecera">
            <h2>Bandeja de alertas</h2>
            <div class="filtros">
              <select id="filtroEstado">
                <option value="pendiente">Pendientes</option>
                <option value="revisado">Revisadas</option>
                <option value="resuelto">Resueltas</option>
                <option value="descartado">Descartadas</option>
                <option value="todas">Todas</option>
              </select>
            </div>
          </div>
          <div id="tablaAlertas"></div>
        </div>
      `;
      document.getElementById("filtroEstado").value = filtroActual;
      document.getElementById("filtroEstado").addEventListener("change", (e) => {
        filtroActual = e.target.value;
        dibujarTabla();
      });
      dibujarTabla();
    }

    function dibujarTabla() {
      const cont = document.getElementById("tablaAlertas");
      const items = filtroActual === "todas"
        ? todasLasAlertas
        : todasLasAlertas.filter((a) => a.estado === filtroActual);

      if (!items.length) {
        cont.innerHTML = `<div class="vacio"><strong>No hay alertas en esta vista</strong>Cambia el filtro para ver otras.</div>`;
        return;
      }

      const filas = items.map((a) => `
        <tr>
          <td><span class="cod">${a.cedula || "—"}</span></td>
          <td>${etiquetaTipo(a.tipo)}</td>
          <td>${a.detalle || "—"}</td>
          <td>${badgeEstado(a.estado)}</td>
          <td>${accionesFila(a)}</td>
        </tr>
      `).join("");

      cont.innerHTML = `
        <table>
          <thead><tr><th>Cédula</th><th>Tipo</th><th>Detalle</th><th>Estado</th><th></th></tr></thead>
          <tbody>${filas}</tbody>
        </table>
      `;

      cont.querySelectorAll("[data-accion]").forEach((btn) => {
        btn.addEventListener("click", () => resolverAlerta(btn.dataset.id, btn.dataset.accion));
      });
    }

    function accionesFila(a) {
      if (a.estado !== "pendiente") return "";
      return `
        <button class="btn btn-fantasma btn-sm" data-id="${a.id}" data-accion="resuelto">Marcar resuelta</button>
        <button class="btn btn-fantasma btn-sm" data-id="${a.id}" data-accion="descartado">Descartar</button>
      `;
    }

    async function resolverAlerta(id, nuevoEstado) {
      try {
        // Ajusta esta ruta si tu backend usa otro patrón para actualizar alertas.
        await RAC.patch(`/api/alertas/${id}`, { estado: nuevoEstado });
        mostrarToast(nuevoEstado === "resuelto" ? "Alerta marcada como resuelta." : "Alerta descartada.");
        await cargarAlertas();
      } catch (err) {
        mostrarToast(err.message, true);
      }
    }

    function badgeEstado(estado) {
      const mapa = {
        pendiente: "badge-pendiente",
        resuelto: "badge-resuelto",
        descartado: "badge-descartado",
        revisado: "badge-revisado",
      };
      const clase = mapa[estado] || "badge-descartado";
      return `<span class="badge ${clase}">${estado || "—"}</span>`;
    }

    function etiquetaTipo(tipo) {
      const mapa = {
        no_existe_ministerio: "No está en nómina del Ministerio",
        plantel_no_existe: "Plantel no existe",
        horas_invalidas: "Horas fuera de rango",
      };
      return mapa[tipo] || tipo || "—";
    }
