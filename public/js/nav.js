// nav.js — shell visual compartido de RAC · Sistema.
// Mantiene la navegación y los permisos existentes; el rediseño solo cambia
// la presentación y agrega una navegación móvil.

function renderShell(paginaActiva, tituloTopbar) {
  const usuario = RAC.exigirSesion();
  if (!usuario) return null;

  const grupos = [
    {
      id: null,
      titulo: null,
      enlaces: [
        { id: "dashboard", href: "/dashboard.html", label: "Resumen", icon: "dashboard", roles: null },
        { id: "rac", href: "/rac.html", label: "Consultar RAC", icon: "search", roles: null },
        { id: "exportar-rac", href: "/exportar-rac.html", label: "Exportar RAC", icon: "download", roles: ["admin", "operador"] },
      ],
    },
    {
      id: "alertas-calidad",
      titulo: "Alertas y calidad de datos",
      enlaces: [
        { id: "alertas", href: "/alertas.html", label: "Alertas", icon: "alert", roles: null },
        { id: "codigos-sin-catalogar", href: "/codigos-sin-catalogar.html", label: "Códigos sin catalogar", icon: "tag", roles: ["operador", "admin"] },
        { id: "depurar-archivo", href: "/depurar-archivo.html", label: "Depurar archivo", icon: "clean", roles: ["admin"] },
      ],
    },
    {
      id: "cargas-catalogos",
      titulo: "Cargas y catálogos",
      enlaces: [
        { id: "cargas", href: "/cargas.html", label: "Cargar por municipio", icon: "upload", roles: ["encargado_municipio", "operador", "admin"] },
        { id: "carga-completa", href: "/carga-completa.html", label: "Carga completa mensual", icon: "calendar", roles: ["admin"] },
        { id: "planteles", href: "/planteles.html", label: "Planteles", icon: "school", roles: ["admin"] },
      ],
    },
    {
      id: "credenciales-grupo",
      titulo: "Credenciales",
      enlaces: [
        { id: "credenciales", href: "/credenciales.html", label: "Credenciales", icon: "card", roles: ["admin", "operador", "operador_credenciales"] },
      ],
    },
    {
      id: "administracion",
      titulo: "Administración",
      enlaces: [
        { id: "usuarios", href: "/usuarios.html", label: "Usuarios", icon: "users", roles: ["admin"] },
      ],
    },
  ];

  const rolLabel = {
    admin: "Administrador",
    operador: "Operador",
    encargado_municipio: "Encargado de municipio",
    operador_credenciales: "Operador de credenciales",
  }[usuario.rol] || usuario.rol;

  const iconos = {
    dashboard: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
    search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 5 5"/></svg>',
    download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11"/><path d="m8 10 4 4 4-4"/><path d="M4 20h16"/></svg>',
    alert: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.3 4.3 2.7 18a2 2 0 0 0 1.75 3h15.1a2 2 0 0 0 1.75-3L13.7 4.3a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
    tag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m20 13-7 7-10-10V3h7l10 10Z"/><circle cx="7" cy="7" r="1.2"/></svg>',
    clean: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 15H6L5 6"/><path d="M10 10v7M14 10v7"/></svg>',
    upload: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21V9"/><path d="m7 14 5-5 5 5"/><path d="M4 4h16"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M7 2v4M17 2v4M3 9h18"/></svg>',
    school: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10 9-6 9 6"/><path d="M5 10v9h14v-9"/><path d="M9 19v-5h6v5"/></svg>',
    card: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h5"/></svg>',
    users: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3 20c.5-4 2.5-6 6-6s5.5 2 6 6"/><path d="M16 5.5a3 3 0 0 1 0 5.5M17 14c2.5.5 3.8 2.2 4 5"/></svg>',
    menu: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
  };

  const gruposVisibles = grupos
    .map((g) => ({
      ...g,
      enlaces: g.enlaces.filter((e) => !e.roles || e.roles.includes(usuario.rol)),
    }))
    .filter((g) => g.enlaces.length > 0);

  const navHtml = gruposVisibles.map((g) => {
    const enlacesHtml = g.enlaces.map((e) =>
      `<a class="nav-link ${e.id === paginaActiva ? "activo" : ""}" href="${e.href}" title="${e.label}">
        <span class="nav-link-icon">${iconos[e.icon] || ""}</span>
        <span class="nav-link-text">${e.label}</span>
      </a>`
    ).join("");

    if (!g.titulo) return `<div class="nav-grupo-plano">${enlacesHtml}</div>`;

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
  }).join("");

  document.getElementById("shell").innerHTML = `
    <div class="app-shell">
      <aside class="sidebar" id="sidebar">
        <div class="sidebar-head">
          <div class="brand-mark" aria-hidden="true">
            <span class="brand-mark-inner">RAC</span>
          </div>
          <div class="sidebar-brand-text">
            <strong>RAC · Sistema</strong>
            <span>Registro de Asignación de Cargos</span>
          </div>
        </div>

        <div class="sidebar-context">
          <span>MONAGAS · EDUCACIÓN</span>
          <strong>Gestión educativa</strong>
        </div>

        <nav class="sidebar-nav" aria-label="Navegación principal">${navHtml}</nav>

        <div class="sidebar-pie">
          <div class="usuario-chip">
            <span class="avatar">${(usuario.nombre || "U").trim().charAt(0).toUpperCase()}</span>
            <div class="usuario-datos">
              <strong>${usuario.nombre}</strong>
              <span class="rol-badge">${rolLabel}</span>
            </div>
          </div>
          <button class="btn btn-fantasma btn-sm btn-ancho btn-salir" id="btnSalir">Cerrar sesión</button>
        </div>
      </aside>

      <div class="sidebar-backdrop" id="sidebarBackdrop"></div>

      <div class="main-col">
        <header class="topbar">
          <div class="topbar-left">
            <button class="mobile-menu" id="btnMenu" aria-label="Abrir menú">${iconos.menu}</button>
            <div>
              <div class="topbar-kicker">MONAGAS · EDUCACIÓN</div>
              <h1>${tituloTopbar}</h1>
            </div>
          </div>
          <div class="topbar-user">
            <span class="topbar-avatar">${(usuario.nombre || "U").trim().charAt(0).toUpperCase()}</span>
            <span>${rolLabel}</span>
          </div>
        </header>
        <main class="contenido" id="contenido"></main>
      </div>
    </div>
  `;

  document.getElementById("btnSalir").addEventListener("click", RAC.cerrarSesion);

  document.querySelectorAll("[data-toggle-grupo]").forEach((boton) => {
    boton.addEventListener("click", () => {
      const id = boton.dataset.toggleGrupo;
      const contenido = document.querySelector(`[data-contenido-grupo="${id}"]`);
      const flecha = document.querySelector(`[data-flecha-grupo="${id}"]`);
      contenido.classList.toggle("abierto");
      flecha.classList.toggle("abierto");
    });
  });

  const sidebar = document.getElementById("sidebar");
  const backdrop = document.getElementById("sidebarBackdrop");
  const btnMenu = document.getElementById("btnMenu");

  const cerrarMenu = () => {
    sidebar.classList.remove("movil-abierto");
    backdrop.classList.remove("visible");
    btnMenu.innerHTML = iconos.menu;
    btnMenu.setAttribute("aria-label", "Abrir menú");
  };

  btnMenu.addEventListener("click", () => {
    const abierto = sidebar.classList.toggle("movil-abierto");
    backdrop.classList.toggle("visible", abierto);
    btnMenu.innerHTML = abierto ? iconos.close : iconos.menu;
    btnMenu.setAttribute("aria-label", abierto ? "Cerrar menú" : "Abrir menú");
  });

  backdrop.addEventListener("click", cerrarMenu);
  document.querySelectorAll(".nav-link").forEach((link) => link.addEventListener("click", cerrarMenu));

  return usuario;
}
