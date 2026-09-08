const usuario = renderShell("alertas", "Alertas");
    let todasLasAlertas = [];
    let filtroActual = "pendiente";
    // MEJORA 7 (2026-09-07): filtro por tipo de alerta, aplicado en el
    // navegador sobre lo que ya trajo el filtro de estado (no hace falta
    // pedirle esto al backend -- la cantidad de alertas cargadas de una vez
    // es manejable). "todos" no filtra nada.
    let filtroTipo = "todos";
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
        pintarResumenTipos();
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
              <select id="filtroTipo">
                <option value="todos">Todos los tipos</option>
                <option value="plantel_no_existe">Plantel no existe</option>
                <option value="fila_incompleta">Fila incompleta (sin cédula/plantel)</option>
                <option value="cedula_no_existe_nomina">No está en nómina del Ministerio</option>
                <option value="valor_fuera_de_rango">Valor fuera de rango</option>
                <option value="registro_actualizado">Registro actualizado</option>
                <option value="registro_no_encontrado_en_carga">No encontrado en la última carga</option>
                <option value="incongruencia_tipo_personal">Incongruencia de tipo de personal</option>
              </select>
            </div>
          </div>
          <div id="resumenTipos" style="margin:12px 0;"></div>
          <div id="tablaAlertas"></div>
        </div>
      `;
      document.getElementById("filtroEstado").value = filtroActual;
      document.getElementById("filtroEstado").addEventListener("change", (e) => {
        filtroActual = e.target.value;
        cargarAlertas();
      });
      document.getElementById("filtroTipo").value = filtroTipo;
      document.getElementById("filtroTipo").addEventListener("change", (e) => {
        filtroTipo = e.target.value;
        pintarResumenTipos();
        dibujarTabla();
      });
      cargarAlertas();
    }

    // MEJORA 7 (2026-09-07): resumen de cantidades por tipo, sobre lo que
    // trajo el filtro de estado actual (ej. en "Pendientes", cuántas
    // pendientes hay de cada tipo). Cada chip es clicable y actúa como
    // atajo del combo "filtroTipo" -- clic de nuevo sobre el ya activo lo
    // quita (vuelve a "todos").
    function pintarResumenTipos() {
      const cont = document.getElementById("resumenTipos");
      if (!cont) return;
      if (!todasLasAlertas.length) {
        cont.innerHTML = "";
        return;
      }

      const conteos = {};
      for (const a of todasLasAlertas) {
        conteos[a.tipo] = (conteos[a.tipo] || 0) + 1;
      }

      const chips = Object.entries(conteos)
        .sort((a, b) => b[1] - a[1])
        .map(([tipo, cantidad]) => `
          <button type="button" class="badge ${filtroTipo === tipo ? "badge-pendiente" : "badge-descartado"}"
                  data-chip-tipo="${tipo}" style="cursor:pointer; border:none;">
            ${etiquetaTipo(tipo)}: <strong>${cantidad}</strong>
          </button>
        `).join(" ");

      cont.innerHTML = `
        <div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center;">
          <span style="color:var(--tinta-suave); font-size:0.85rem;">Total: <strong>${todasLasAlertas.length}</strong></span>
          ${chips}
        </div>
      `;

      cont.querySelectorAll("[data-chip-tipo]").forEach((chip) => {
        chip.addEventListener("click", () => {
          const tipo = chip.dataset.chipTipo;
          filtroTipo = filtroTipo === tipo ? "todos" : tipo;
          document.getElementById("filtroTipo").value = filtroTipo;
          pintarResumenTipos();
          dibujarTabla();
        });
      });
    }

    function dibujarTabla() {
      const cont = document.getElementById("tablaAlertas");
      const items = filtroTipo === "todos"
        ? todasLasAlertas
        : todasLasAlertas.filter((a) => a.tipo === filtroTipo);

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

    // MEJORA 6 (2026-09-07): todo tipo de alerta pendiente ahora tiene un
    // botón "Revisar" que lleva a la acción que corresponda:
    //  - "plantel_no_existe" / "fila_incompleta": la fila nunca llegó a
    //    insertarse en el RAC -- la única forma real de resolverla es dando
    //    de alta el registro (abre el modal de alta, MEJORA 5/6).
    //  - el resto de tipos son sobre un registro que YA existe en el RAC
    //    (se insertó o actualizó igual, o es un aviso sobre uno existente)
    //    -- "Revisar" lleva a verlo/editarlo en "Consultar RAC" con la
    //    cédula ya precargada.
    const TIPOS_ALTA_MANUAL = ["plantel_no_existe", "fila_incompleta"];
    const TIPOS_VER_EN_RAC = [
      "cedula_no_existe_nomina",
      "no_existe_ministerio",
      "valor_fuera_de_rango",
      "horas_invalidas",
      "registro_actualizado",
      "registro_no_encontrado_en_carga",
      "incongruencia_tipo_personal",
    ];

    function accionesFila(a) {
      if (a.estado !== "pendiente") return "";

      if (TIPOS_ALTA_MANUAL.includes(a.tipo)) {
        return `
          <button class="btn btn-primario btn-sm" data-revisar="${a.id}">Revisar</button>
          <button class="btn btn-fantasma btn-sm" data-id="${a.id}" data-accion="descartado">Descartar</button>
        `;
      }

      if (TIPOS_VER_EN_RAC.includes(a.tipo) && a.cedula) {
        return `
          <a class="btn btn-primario btn-sm" href="/rac.html?cedula=${encodeURIComponent(a.cedula)}">Revisar</a>
          <button class="btn btn-fantasma btn-sm" data-id="${a.id}" data-accion="resuelto">Marcar resuelta</button>
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
        fila_incompleta: "Fila incompleta (sin cédula y/o plantel)",
        horas_invalidas: "Horas fuera de rango",
        valor_fuera_de_rango: "Valor fuera de rango",
        registro_actualizado: "Registro actualizado",
        registro_no_encontrado_en_carga: "No encontrado en la última carga",
        incongruencia_tipo_personal: "Incongruencia de tipo de personal",
      };
      return mapa[tipo] || tipo || "—";
    }

    // ---- Modal de alta manual (MEJORA 5, ampliado en MEJORA 6) ----
    const modalAltaFondo = document.getElementById("modalAltaFondo");
    const formAlta = document.getElementById("formAlta");
    const errorModalAlta = document.getElementById("errorModalAlta");
    const alCedula = document.getElementById("alCedula");

    function abrirAlta(alerta) {
      if (!alerta) return;
      alertaEnAlta = alerta;
      errorModalAlta.classList.remove("visible");

      const fila = alerta.detalle_fila || {};
      // MEJORA 6: en "fila_incompleta" la cédula puede faltar del todo --
      // en ese caso se deja editable para completarla a mano. Para
      // "plantel_no_existe" (y "fila_incompleta" cuando sí traía cédula,
      // solo le faltaba el plantel) se mantiene bloqueada como antes.
      const faltaCedula = Array.isArray(fila.camposFaltantes) && fila.camposFaltantes.includes("CEDULA");
      if (faltaCedula) {
        alCedula.disabled = false;
        alCedula.value = "";
        alCedula.placeholder = "Escribe la cédula (no venía en el archivo)";
      } else {
        alCedula.disabled = true;
        alCedula.placeholder = "";
        alCedula.value = alerta.cedula || "";
      }

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
      // Deja el campo cédula en su estado por defecto para la próxima vez
      // que se abra el modal (evita que quede editable si la última
      // revisión fue una fila_incompleta sin cédula).
      alCedula.disabled = true;
      alCedula.placeholder = "";
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

      // MEJORA 6: si la cédula estaba editable (fila_incompleta sin cédula),
      // se manda la corregida en el body.
      if (!alCedula.disabled) {
        const cedulaCorregida = alCedula.value.trim();
        if (!cedulaCorregida) {
          errorModalAlta.textContent = "Debes escribir la cédula.";
          errorModalAlta.classList.add("visible");
          btn.disabled = false;
          btn.textContent = "Dar de alta";
          return;
        }
        datos.cedula = cedulaCorregida;
      }

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
