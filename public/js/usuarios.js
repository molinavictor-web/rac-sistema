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
      `;
      document.getElementById("btnNuevo").addEventListener("click", abrirModal);
      cargarUsuarios();
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
