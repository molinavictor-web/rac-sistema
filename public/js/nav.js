// nav.js — dibuja el shell (sidebar + topbar) igual en todas las páginas,
// ajustando qué enlaces se ven según el rol del usuario.
//
// REDISEÑO (2026-09-12): con 13 enlaces el menú plano ya se veía muy largo,
// sobre todo para admin (que ve casi todos). Se agrupan en secciones
// colapsables (clic en el título del grupo para expandir/contraer).
// "General" queda sin encabezado y siempre visible -- son los enlaces de
// uso diario (Resumen, Consultar RAC, Exportar RAC). Los demás grupos
// arrancan CERRADOS por decisión del usuario, EXCEPTO si el grupo contiene
// la página activa -- así nunca se esconde en qué sección está parado.
function renderShell(paginaActiva, tituloTopbar) {
  const usuario = RAC.exigirSesion();
  if (!usuario) return null;

  const grupos = [
    {
      id: null, // "General": sin título, siempre expandido, no colapsable.
      titulo: null,
      enlaces: [
        { id: "dashboard", href: "/dashboard.html", label: "Resumen", roles: null },
        { id: "rac", href: "/rac.html", label: "Consultar RAC", roles: null },
        { id: "exportar-rac", href: "/exportar-rac.html", label: "Exportar RAC", roles: ["admin", "operador"] },
      ],
    },
    {
      id: "alertas-calidad",
      titulo: "Alertas y calidad de datos",
      enlaces: [
        { id: "alertas", href: "/alertas.html", label: "Alertas", roles: null },
        { id: "codigos-sin-catalogar", href: "/codigos-sin-catalogar.html", label: "Códigos sin catalogar", roles: ["operador", "admin"] },
        { id: "depurar-archivo", href: "/depurar-archivo.html", label: "Depurar archivo", roles: ["admin"] },
      ],
    },
    {
      id: "cargas-catalogos",
      titulo: "Cargas y catálogos",
      enlaces: [
        { id: "cargas", href: "/cargas.html", label: "Cargar por muncipio", roles: ["encargado_municipio", "operador", "admin"] },
        { id: "nomina", href: "/nomina.html", label: "Cargar nómina Ministerio", roles: ["admin"] },
        { id: "rac-completo", href: "/rac-completo.html", label: "Cargar RAC completo", roles: ["admin"] },
        { id: "planteles-carga", href: "/planteles-carga.html", label: "Cargar planteles", roles: ["admin"] },
        { id: "planteles", href: "/planteles.html", label: "Planteles", roles: ["admin"] },
      ],
    },
    {
      id: "credenciales-grupo",
      // Grupo separado de "Administración" -- decisión explícita del
      // usuario (2026-09-12), aunque hoy solo tenga un enlace adentro.
      titulo: "Credenciales",
      enlaces: [
        { id: "credenciales", href: "/credenciales.html", label: "Credenciales", roles: ["admin", "operador", "operador_credenciales"] },
      ],
    },
    {
      id: "administracion",
      titulo: "Administración",
      enlaces: [
        { id: "usuarios", href: "/usuarios.html", label: "Usuarios", roles: ["admin"] },
      ],
    },
  ];

  const rolLabel = {
    admin: "Administrador",
    operador: "Operador",
    encargado_municipio: "Encargado de municipio",
    operador_credenciales: "Operador de credenciales",
  }[usuario.rol] || usuario.rol;

  // Filtra por rol y descarta de una vez cualquier grupo que quede sin
  // ningún enlace visible para este usuario (ej. "Credenciales" para un
  // encargado_municipio no debería ni mostrar el título del grupo).
  const gruposVisibles = grupos
    .map((g) => ({
      ...g,
      enlaces: g.enlaces.filter((e) => !e.roles || e.roles.includes(usuario.rol)),
    }))
    .filter((g) => g.enlaces.length > 0);

  const navHtml = gruposVisibles
    .map((g) => {
      const enlacesHtml = g.enlaces
        .map(
          (e) =>
            `<a class="nav-link ${e.id === paginaActiva ? "activo" : ""}" href="${e.href}">${e.label}</a>`
        )
        .join("");

      if (!g.titulo) {
        return `<div class="nav-grupo-plano">${enlacesHtml}</div>`;
      }

      const contieneActiva = g.enlaces.some((e) => e.id === paginaActiva);
      const abierto = contieneActiva;

      return `
        <div class="nav-grupo" data-grupo="${g.id}">
          <button type="button" class="nav-grupo-titulo" data-toggle-grupo="${g.id}">
            <span>${g.titulo}</span>
            <span class="nav-grupo-flecha ${abierto ? "abierto" : ""}" data-flecha-grupo="${g.id}">▸</span>
          </button>
          <div class="nav-grupo-contenido ${abierto ? "abierto" : ""}" data-contenido-grupo="${g.id}">
            ${enlacesHtml}
          </div>
        </div>
      `;
    })
    .join("");

  document.getElementById("shell").innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div>
          <div class="sidebar-marca">Monagas · Educación</div>
          <div class="sidebar-titulo">RAC</div>
        </div>
        <nav>${navHtml}</nav>
        <div class="sidebar-pie">
          <div class="usuario-chip">
            <strong>${usuario.nombre}</strong>
            <span class="rol-badge">${rolLabel}</span>
          </div>
          <button class="btn btn-fantasma btn-sm btn-ancho" id="btnSalir">Cerrar sesión</button>
        </div>
      </aside>
      <div class="main-col">
        <header class="topbar"><h1>${tituloTopbar}</h1></header>
        <main class="contenido" id="contenido"></main>
      </div>
    </div>
  `;

  document.getElementById("btnSalir").addEventListener("click", RAC.cerrarSesion);

  // Clic en el título de un grupo: alterna la clase "abierto" en su
  // contenido y en su flecha (que gira 90° vía CSS, ver .nav-grupo-flecha
  // en style.css). Estado en memoria del DOM nada más -- no se guarda
  // entre recargas ni entre páginas, cada carga vuelve a arrancar cerrado
  // (salvo el grupo de la página activa).
  document.querySelectorAll("[data-toggle-grupo]").forEach((boton) => {
    boton.addEventListener("click", () => {
      const id = boton.dataset.toggleGrupo;
      const contenido = document.querySelector(`[data-contenido-grupo="${id}"]`);
      const flecha = document.querySelector(`[data-flecha-grupo="${id}"]`);
      contenido.classList.toggle("abierto");
      flecha.classList.toggle("abierto");
    });
  });

  return usuario;
}
