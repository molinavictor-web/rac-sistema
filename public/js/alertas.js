const usuario = renderShell("alertas", "Alertas");
    let todasLasAlertas = [];
    let filtroActual = "pendiente";
    let alertaEnAlta = null;

    if (usuario) dibujarPanel();

    // CORRECCIÓN: antes se pedía /api/alertas UNA sola vez (sin filtro) y el
    // combo solo re-filtraba ese mismo arreglo en el navegador -- como el
    // backend por defecto solo devolvía "pendiente", el combo nunca podía
    // mostrar Revisadas/Resueltas/Descartadas, sin importar cuántas hubiera
    // realmente. Ahora cada cambio de filtro vuelve a pedirle al servidor
    // justo el estado elegido (o todas, sin filtro, si se elige "Todas").
    async function cargarAlertas() {
      const contenido = document.getElementById("contenido");
      const tabla = document.getElementById("tablaAlertas");
      if (tabla) tabla.innerHTML = `<div class="cargando">Cargando alertas…</div>`;
      else contenido.innerHTML = `<div class="cargando">Cargando alertas…</div>`;
      try {
        const query = filtroActual === "todas" ? "" : `?estado=${encodeURIComponent(filtroActual)}`;
        const resp = await RAC.get(`/api/alertas${query}`);
        todasLasAlertas = RAC.lista(resp, "alertas");
        dibujarTabla();
      } catch (err) {
        const destino = document.getElementById("tablaAlertas") || contenido;
        destino.innerHTML = `<div class="vacio"><strong>No se pudieron cargar las alertas</strong>${err.message}</div>`;
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
        cargarAlertas();
      });
      cargarAlertas();
    }

    function dibujarTabla() {
      const cont = document.getElementById("tablaAlertas");
      const items = todasLasAlertas;

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
      cont.querySelectorAll("[data-revisar]").forEach((btn) => {
        const alerta = todasLasAlertas.find((a) => String(a.id) === btn.dataset.revisar);
        btn.addEventListener("click", () => abrirAlta(alerta));
      });
    }

    function accionesFila(a) {
      if (a.estado !== "pendiente") return "";

      // Las alertas "plantel_no_existe" no se pueden marcar resueltas a
      // secas -- esa fila nunca llegó a insertarse en el RAC, así que la
      // única forma real de resolverla es dando de alta el registro
      // (botón "Revisar", MEJORA 5). Sí se puede descartar, si aplica.
      if (a.tipo === "plantel_no_existe") {
        return `
          <button class="btn btn-primario btn-sm" data-revisar="${a.id}">Revisar</button>
          <button class="btn btn-fantasma btn-sm" data-id="${a.id}" data-accion="descartado">Descartar</button>
        `;
      }

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
        cedula_no_existe_nomina: "No está en nómina del Ministerio",
        plantel_no_existe: "Plantel no existe",
        horas_invalidas: "Horas fuera de rango",
        valor_fuera_de_rango: "Valor fuera de rango",
        registro_actualizado: "Registro actualizado",
        registro_no_encontrado_en_carga: "No encontrado en la última carga",
        incongruencia_tipo_personal: "Incongruencia de tipo de personal",
      };
      return mapa[tipo] || tipo || "—";
    }

    // ---- Modal de alta manual (MEJORA 5) ----
    const modalAltaFondo = document.getElementById("modalAltaFondo");
    const formAlta = document.getElementById("formAlta");
    const errorModalAlta = document.getElementById("errorModalAlta");

    function abrirAlta(alerta) {
      if (!alerta) return;
      alertaEnAlta = alerta;
      errorModalAlta.classList.remove("visible");

      const fila = alerta.detalle_fila || {};

      document.getElementById("alCedula").value = alerta.cedula || "";
      document.getElementById("alCodigoPlantel").value = "";
      document.getElementById("alCodigoIntentadoHint").textContent = fila.codigo_plantel_intentado
        ? `Código que venía en el archivo (no existe en el catálogo): ${fila.codigo_plantel_intentado}`
        : "";
      document.getElementById("alCodigoDependencia").value = fila.codigo_dependencia || "";
      document.getElementById("alCodigoCargo").value = fila.codigo_cargo || "";
      document.getElementById("alTipoPersonal").value = fila.tipo_personal || "";
      document.getElementById("alCargo").value = fila.cargo || "";
      document.getElementById("alTurno").value = fila.turno || "";
      document.getElementById("alHorasAcademicas").value = fila.horas_academicas ?? "";
      document.getElementById("alHorasAdm").value = fila.horas_adm ?? "";
      document.getElementById("alSituacion").value = fila.situacion || "";

      modalAltaFondo.classList.add("visible");
    }

    function cerrarAlta() {
      modalAltaFondo.classList.remove("visible");
      alertaEnAlta = null;
    }

    document.getElementById("btnCancelarAlta").addEventListener("click", cerrarAlta);

    formAlta.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!alertaEnAlta) return;
      errorModalAlta.classList.remove("visible");
      const btn = document.getElementById("btnGuardarAlta");
      btn.disabled = true;
      btn.textContent = "Guardando…";

      const horasAcademicas = document.getElementById("alHorasAcademicas").value;
      const horasAdm = document.getElementById("alHorasAdm").value;

      const datos = {
        codigo_plantel: document.getElementById("alCodigoPlantel").value.trim(),
        codigo_dependencia: document.getElementById("alCodigoDependencia").value.trim() || null,
        codigo_cargo: document.getElementById("alCodigoCargo").value.trim() || null,
        tipo_personal: document.getElementById("alTipoPersonal").value || null,
        cargo: document.getElementById("alCargo").value.trim() || null,
        turno: document.getElementById("alTurno").value || null,
        horas_academicas: horasAcademicas === "" ? null : Number(horasAcademicas),
        horas_adm: horasAdm === "" ? null : Number(horasAdm),
        situacion: document.getElementById("alSituacion").value.trim() || null,
      };

      try {
        await RAC.post(`/api/rac/resolver-alta/${alertaEnAlta.id}`, datos);
        mostrarToast("Registro dado de alta y alerta resuelta.");
        cerrarAlta();
        await cargarAlertas();
      } catch (err) {
        errorModalAlta.textContent = err.message;
        errorModalAlta.classList.add("visible");
      } finally {
        btn.disabled = false;
        btn.textContent = "Dar de alta";
      }
    });
