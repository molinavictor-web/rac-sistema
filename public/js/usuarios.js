const usuario = renderShell("usuarios", "Usuarios");
    if (usuario) dibujarPanel();

    function dibujarPanel() {
      document.getElementById("contenido").innerHTML = `
        <div class="panel">
          <div class="panel-cabecera">
            <h2>Personas con acceso al sistema</h2>
            <button class="btn btn-primario btn-sm" id="btnNuevo">Nuevo usuario</button>
          </div>
          <div id="tablaUsuarios"></div>
        </div>
        ${usuario.rol === "admin" ? `
        <div class="panel" style="margin-top:24px;">
          <div class="panel-cabecera">
            <h2>Mantenimiento</h2>
          </div>
          <div id="mantenimiento">
            <p style="margin-bottom:12px;">
              La tabla <code>auditoria</code> crece todos los días y puede llenar
              el espacio disponible de la base de datos. Los registros de más
              de 3 días pueden borrarse de forma definitiva para liberar espacio.
            </p>
            <div id="estadoAuditoria" class="cargando">Consultando estado…</div>
            <div style="display:flex; gap:10px; margin-top:14px;">
              <button class="btn btn-fantasma btn-sm" id="btnVerEstado">Actualizar estado</button>
              <button class="btn btn-primario btn-sm" id="btnPurgar">Purgar auditoría (&gt;3 días)</button>
            </div>
          </div>
        </div>
        ` : ""}
      `;
      document.getElementById("btnNuevo").addEventListener("click", abrirModal);
      cargarUsuarios();

      if (usuario.rol === "admin") {
        document.getElementById("btnVerEstado").addEventListener("click", cargarEstadoAuditoria);
        document.getElementById("btnPurgar").addEventListener("click", purgarAuditoria);
        cargarEstadoAuditoria();
      }
    }

    async function cargarUsuarios() {
      const cont = document.getElementById("tablaUsuarios");
      cont.innerHTML = `<div class="cargando">Cargando usuarios…</div>`;
      try {
        const resp = await RAC.get("/api/usuarios");
        const items = RAC.lista(resp, "usuarios");
        if (!items.length) {
          cont.innerHTML = `<div class="vacio"><strong>Aún no hay usuarios registrados</strong>Crea el primero con el botón de arriba.</div>`;
          return;
        }
        const filas = items.map((u) => `
          <tr>
            <td>${u.nombre}</td>
            <td>${u.email}</td>
            <td>${etiquetaRol(u.rol)}</td>
            <td>${u.activo ? '<span class="badge badge-resuelto">Activo</span>' : '<span class="badge badge-descartado">Inactivo</span>'}</td>
            <td>
              <button class="btn btn-fantasma btn-sm" data-id="${u.id}" data-activo="${u.activo}">
                ${u.activo ? "Desactivar" : "Reactivar"}
              </button>
            </td>
          </tr>
        `).join("");
        cont.innerHTML = `
          <table>
            <thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Estado</th><th></th></tr></thead>
            <tbody>${filas}</tbody>
          </table>
        `;
        cont.querySelectorAll("[data-id]").forEach((btn) => {
          btn.addEventListener("click", () => cambiarActivo(btn.dataset.id, btn.dataset.activo === "true"));
        });
      } catch (err) {
        cont.innerHTML = `<div class="vacio"><strong>No se pudo cargar la lista</strong>${err.message}</div>`;
      }
    }

    async function cambiarActivo(id, activoActual) {
      try {
        await RAC.patch(`/api/usuarios/${id}/activo`, { activo: !activoActual });
        mostrarToast(activoActual ? "Usuario desactivado." : "Usuario reactivado.");
        cargarUsuarios();
      } catch (err) {
        mostrarToast(err.message, true);
      }
    }

    function etiquetaRol(rol) {
      const mapa = { admin: "Administrador", operador: "Operador", encargado_municipio: "Encargado de municipio" };
      return mapa[rol] || rol;
    }

    // ---- Mantenimiento (solo admin) ----
    async function cargarEstadoAuditoria() {
      const cont = document.getElementById("estadoAuditoria");
      if (!cont) return;
      cont.className = "cargando";
      cont.textContent = "Consultando estado…";
      try {
        const data = await RAC.get("/api/mantenimiento/estado-auditoria");
        const fecha = data.fecha_mas_antigua
          ? new Date(data.fecha_mas_antigua).toLocaleString("es-VE")
          : "—";
        cont.className = "";
        cont.innerHTML = `
          <table>
            <tbody>
              <tr><td>Registros totales</td><td><strong>${data.total_registros.toLocaleString("es-VE")}</strong></td></tr>
              <tr><td>Tamaño actual</td><td><strong>${data.tamano_actual}</strong></td></tr>
              <tr><td>Registro más antiguo</td><td>${fecha}</td></tr>
            </tbody>
          </table>
        `;
      } catch (err) {
        cont.className = "vacio";
        cont.innerHTML = `<strong>No se pudo consultar el estado</strong>${err.message}`;
      }
    }

    async function purgarAuditoria() {
      const ok = window.confirm(
        "Esto borrará de forma DEFINITIVA todos los registros de auditoría con más de 3 días de antigüedad y no se pueden recuperar. ¿Continuar?"
      );
      if (!ok) return;

      const btn = document.getElementById("btnPurgar");
      btn.disabled = true;
      btn.textContent = "Purgando…";
      try {
        const data = await RAC.post("/api/mantenimiento/purgar-auditoria", {});
        mostrarToast(`Auditoría purgada: ${data.registros_borrados.toLocaleString("es-VE")} registros borrados. Tamaño actual: ${data.tamano_actual}.`);
        cargarEstadoAuditoria();
      } catch (err) {
        mostrarToast(err.message, true);
      } finally {
        btn.disabled = false;
        btn.textContent = "Purgar auditoría (>3 días)";
      }
    }

    // ---- Modal de creación ----
    const modalFondo = document.getElementById("modalFondo");
    const formUsuario = document.getElementById("formUsuario");
    const errorModal = document.getElementById("errorModal");

    function abrirModal() {
      formUsuario.reset();
      errorModal.classList.remove("visible");
      modalFondo.classList.add("visible");
    }
    function cerrarModal() { modalFondo.classList.remove("visible"); }

    document.getElementById("btnCancelar").addEventListener("click", cerrarModal);
    document.getElementById("rol").addEventListener("change", (e) => {
      document.getElementById("campoMunicipio").style.display =
        e.target.value === "encargado_municipio" ? "block" : "none";
    });

    formUsuario.addEventListener("submit", async (e) => {
      e.preventDefault();
      errorModal.classList.remove("visible");
      const btn = document.getElementById("btnGuardar");
      btn.disabled = true;
      btn.textContent = "Creando…";

      const cuerpo = {
        nombre: document.getElementById("nombre").value.trim(),
        email: document.getElementById("email").value.trim(),
        password: document.getElementById("password").value,
        rol: document.getElementById("rol").value,
      };
      const municipioId = document.getElementById("municipio_id").value;
      if (cuerpo.rol === "encargado_municipio" && municipioId) {
        cuerpo.municipio_id = Number(municipioId);
      }

      try {
        await RAC.post("/api/usuarios", cuerpo);
        mostrarToast("Usuario creado correctamente.");
        cerrarModal();
        cargarUsuarios();
      } catch (err) {
        errorModal.textContent = err.message;
        errorModal.classList.add("visible");
      } finally {
        btn.disabled = false;
        btn.textContent = "Crear usuario";
      }
    });
