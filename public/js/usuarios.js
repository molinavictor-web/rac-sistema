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
        <div class="panel" style="margin-top:24px; border:1px solid #b3261e;">
          <div class="panel-cabecera">
            <h2 style="color:#b3261e;">Zona de peligro — Reiniciar datos</h2>
          </div>
          <div id="reinicioDatos">
            <p style="margin-bottom:12px;">
              Esta acción borra de forma <strong>DEFINITIVA e IRREVERSIBLE</strong> todos
              los registros de <code>alertas</code>, <code>rac</code>, <code>planteles</code>
              y <code>personal_ministerio</code>, dejando el sistema en cero para
              cargar datos nuevos desde el principio. No hay respaldo automático.
            </p>
            <div id="estadoDatos" class="cargando">Consultando estado…</div>
            <div style="margin-top:14px;">
              <label for="confirmacionReinicio" style="display:block; margin-bottom:6px; font-size:0.9rem;">
                Escribe <strong>REINICIAR</strong> para habilitar el botón:
              </label>
              <div style="display:flex; gap:10px;">
                <input type="text" id="confirmacionReinicio" placeholder="REINICIAR" style="flex:1; padding:10px 14px; font-size:1rem; border:1px solid #ccc; border-radius:6px;">
                <button class="btn btn-sm" id="btnReiniciar" disabled style="background:#b3261e; color:#fff;">Reiniciar datos</button>
              </div>
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

        const inputConfirmacion = document.getElementById("confirmacionReinicio");
        const btnReiniciar = document.getElementById("btnReiniciar");
        inputConfirmacion.addEventListener("input", () => {
          btnReiniciar.disabled = inputConfirmacion.value.trim() !== "REINICIAR";
        });
        btnReiniciar.addEventListener("click", reiniciarDatos);
        cargarEstadoDatos();
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
      const mapa = {
        admin: "Administrador",
        operador: "Operador",
        encargado_municipio: "Encargado de municipio",
        operador_credenciales: "Operador de credenciales",
      };
      return mapa[rol] || rol;
    }

    // ---- Mantenimiento: purga de auditoría (solo admin) ----
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

    // ---- Zona de peligro: reinicio de datos (solo admin) ----
    async function cargarEstadoDatos() {
      const cont = document.getElementById("estadoDatos");
      if (!cont) return;
      cont.className = "cargando";
      cont.textContent = "Consultando estado…";
      try {
        const data = await RAC.get("/api/mantenimiento/estado-datos");
        cont.className = "";
        cont.innerHTML = `
          <table>
            <tbody>
              <tr><td>RAC</td><td><strong>${data.rac.toLocaleString("es-VE")}</strong> registros</td></tr>
              <tr><td>Planteles</td><td><strong>${data.planteles.toLocaleString("es-VE")}</strong> registros</td></tr>
              <tr><td>Nómina (personal_ministerio)</td><td><strong>${data.personal_ministerio.toLocaleString("es-VE")}</strong> registros</td></tr>
              <tr><td>Alertas</td><td><strong>${data.alertas.toLocaleString("es-VE")}</strong> registros</td></tr>
            </tbody>
          </table>
        `;
      } catch (err) {
        cont.className = "vacio";
        cont.innerHTML = `<strong>No se pudo consultar el estado</strong>${err.message}`;
      }
    }

    async function reiniciarDatos() {
      const ok = window.confirm(
        "Esto borrará de forma DEFINITIVA e IRREVERSIBLE todos los registros de RAC, Planteles, Nómina y Alertas. No hay forma de deshacer esto. ¿Confirmas que quieres continuar?"
      );
      if (!ok) return;

      const btn = document.getElementById("btnReiniciar");
      const input = document.getElementById("confirmacionReinicio");
      btn.disabled = true;
      btn.textContent = "Reiniciando…";
      try {
        const data = await RAC.post("/api/mantenimiento/reiniciar-datos", { confirmacion: "REINICIAR" });
        mostrarToast(data.mensaje);
        input.value = "";
        cargarEstadoDatos();
      } catch (err) {
        mostrarToast(err.message, true);
      } finally {
        btn.textContent = "Reiniciar datos";
        btn.disabled = input.value.trim() !== "REINICIAR";
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
