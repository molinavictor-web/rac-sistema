// nav.js — shell visual compartido del sistema RAC.
function renderShell(paginaActiva, tituloTopbar) {
  const sidSupervision = window.location.pathname.startsWith("/supervision/") && document.body.classList.contains("sid-tech-supervision");
  const usuario = RAC.exigirSesion();
  if (!usuario) return null;

  // Usuarios del módulo Supervisión (roles 'supervision' y 'director') solo
  // pueden estar en las pantallas de /supervision/. Si llegan a cualquier otra
  // (por ejemplo al entrar por el login general), se les manda a su panel.
  // El backend también lo bloquea (requireAuth en src/middleware/auth.js).
  if (["supervision", "director"].includes(usuario.rol) && !window.location.pathname.startsWith("/supervision/")) {
    window.location.replace(usuario.rol === "director" ? "/supervision/mi-plantel.html" : "/supervision/resumen.html");
    return null;
  }

  const ROLES_RAC = ["admin", "operador", "encargado_municipio", "operador_credenciales", "operador_plantel"];

  const grupos = [
    { id: null, titulo: null, enlaces: [
      { id: "dashboard", href: "/dashboard.html", label: "Resumen", roles: ROLES_RAC },
      { id: "rac", href: "/rac.html", label: "Consultar RAC", roles: ROLES_RAC },
      { id: "exportar-rac", href: "/exportar-rac.html", label: "Exportar RAC", roles: ["admin", "operador"] },
    ]},
    { id: "alertas-calidad", titulo: "Alertas y calidad de datos", enlaces: [
      { id: "alertas", href: "/alertas.html", label: "Alertas", roles: ROLES_RAC },
      { id: "codigos-sin-catalogar", href: "/codigos-sin-catalogar.html", label: "Códigos sin catalogar", roles: ["operador", "admin"] },
      { id: "depurar-archivo", href: "/depurar-archivo.html", label: "Depurar archivo", roles: ["admin"] },
    ]},
    { id: "cargas-catalogos", titulo: "Cargas y catálogos", enlaces: [
      { id: "cargas", href: "/cargas.html", label: "Cargar por municipio", roles: ["encargado_municipio", "operador", "admin"] },
      { id: "carga-completa", href: "/carga-completa.html", label: "Carga completa mensual", roles: ["admin"] },
      { id: "planteles", href: "/planteles.html", label: "Planteles", roles: ["admin", "operador"] },
      { id: "planteles-consulta", href: "/planteles-consulta.html", label: "Consultar planteles", roles: ["admin", "operador_plantel"] },
      { id: "directorio-directores", href: "/directorio-directores.html", label: "Directorio de directores", roles: ["admin", "operador_plantel", "operador"] },
    ]},
    { id: "credenciales-grupo", titulo: "Credenciales", enlaces: [
      { id: "credenciales", href: "/credenciales.html", label: "Credenciales", roles: ["admin", "operador_credenciales"] },
    ]},
    { id: "supervision-grupo", titulo: "Supervisión", enlaces: [
      { id: "supervision-resumen", href: "/supervision/resumen.html", label: "Resumen", roles: ["admin", "supervision"] },
      { id: "supervision-estadisticas", href: "/supervision/estadisticas.html", label: "Estadísticas", roles: ["admin", "supervision"] },
      { id: "supervision-alertas", href: "/supervision/alertas.html", label: "Alertas", roles: ["admin", "supervision"] },
      { id: "supervision-planteles", href: "/supervision/planteles.html", label: "Planteles", roles: ["admin", "supervision"] },
      { id: "supervision-consolidado", href: "/supervision/consolidado.html", label: "Consolidado", roles: ["admin", "supervision"] },
      { id: "supervision-municipales", href: "/supervision/municipales.html", label: "Supervisores municipales", roles: ["admin", "supervision"] },
      { id: "supervision-circuitales", href: "/supervision/circuitales.html", label: "Supervisores circuitales", roles: ["admin", "supervision"] },
      { id: "supervision-circuitos", href: "/supervision/circuitos.html", label: "Circuitos", roles: ["admin", "supervision"] },
      { id: "supervision-directores", href: "/supervision/directores.html", label: "Directores", roles: ["admin", "supervision"] },
      { id: "supervision-mi-plantel", href: "/supervision/mi-plantel.html", label: "Mi plantel", roles: ["director"] },
    ]},
    { id: "administracion", titulo: "Administración", enlaces: [
      { id: "usuarios", href: "/usuarios.html", label: "Usuarios", roles: ["admin"] },
    ]},
  ];

  const rolLabel = {
    admin: "Administrador",
    operador: "Operador",
    encargado_municipio: "Encargado de municipio",
    operador_credenciales: "Operador de credenciales",
    operador_plantel: "Operador de plantel",
    supervision: "Supervisión",
    director: "Director de plantel",
  }[usuario.rol] || usuario.rol;

  const iconos = {
    dashboard: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 13h7V3H3v10Zm11 8h7V3h-7v18ZM3 21h7v-4H3v4Zm11 0h7v-4h-7v4Z"/></svg>`,
    rac: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>`,
    "exportar-rac": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14"/></svg>`,
    alertas: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4"/></svg>`,
    "codigos-sin-catalogar": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 5h16v14H4zM8 9h8M8 13h5"/></svg>`,
    "depurar-archivo": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m4 20 5-5m-2-6 5-5 8 8-5 5H7V9Z"/><path d="M14 6 18 10"/></svg>`,
    cargas: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 20h16"/></svg>`,
    "carga-completa": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 3h14v18H5zM8 7h8M8 11h8M8 15h5"/></svg>`,
    planteles: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m3 10 9-6 9 6M5 10v10h14V10M9 20v-6h6v6"/></svg>`,
    "planteles-consulta": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m3 10 9-6 9 6M5 10v10h14V10M9 20v-6h6v6"/><circle cx="17.5" cy="17.5" r="3.2"/><path d="m21 21-1.6-1.6"/></svg>`,
    "directorio-directores": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M6 17c.6-2 1.6-3 3-3s2.4 1 3 3M15 9h3M15 13h3"/></svg>`,
    credenciales: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8" cy="12" r="2"/><path d="M13 10h5M13 14h4"/></svg>`,
    "supervision-resumen": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 13h7V3H3v10Zm11 8h7V3h-7v18ZM3 21h7v-4H3v4Zm11 0h7v-4h-7v4Z"/></svg>`,
    "supervision-estadisticas": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>`,
    "supervision-alertas": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4"/></svg>`,
    "supervision-planteles": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m3 10 9-6 9 6M5 10v10h14V10M9 20v-6h6v6"/></svg>`,
    "supervision-consolidado": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16"/></svg>`,
    "supervision-municipales": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="3"/><path d="M5 20c1.3-4 3.6-6 7-6s5.7 2 7 6"/></svg>`,
    "supervision-circuitales": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><path d="M12 4v8l5 3"/></svg>`,
    "supervision-circuitos": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M8.5 6h7M7.3 8.2l3.5 7.6M16.7 8.2l-3.5 7.6"/></svg>`,
    "supervision-directores": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M6 17c.6-2 1.6-3 3-3s2.4 1 3 3M15 9h3M15 13h3"/></svg>`,
    "supervision-mi-plantel": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m3 10 9-6 9 6M5 10v10h14V10M9 20v-6h6v6"/></svg>`,
    usuarios: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="3"/><path d="M5 20c1.3-4 3.6-6 7-6s5.7 2 7 6"/></svg>`,
  };

  const gruposVisibles = grupos
    .map((g) => ({ ...g, enlaces: g.enlaces.filter((e) => !e.roles || e.roles.includes(usuario.rol)) }))
    .filter((g) => g.enlaces.length > 0);

  const navHtml = gruposVisibles.map((g) => {
    const enlacesHtml = g.enlaces.map((e) => `
      <a class="nav-link ${e.id === paginaActiva ? "activo" : ""}" data-nav-id="${e.id}" href="${e.href}">
        <span class="nav-icon">${iconos[e.id] || ""}</span><span>${e.label}</span>
      </a>`).join("");

    if (!g.titulo) return `<div class="nav-grupo-plano">${enlacesHtml}</div>`;

    const abierto = g.enlaces.some((e) => e.id === paginaActiva);
    return `
      <div class="nav-grupo" data-grupo="${g.id}">
        <button type="button" class="nav-grupo-titulo" data-toggle-grupo="${g.id}">
          <span>${g.titulo}</span><span class="nav-grupo-flecha ${abierto ? "abierto" : ""}" data-flecha-grupo="${g.id}">▸</span>
        </button>
        <div class="nav-grupo-contenido ${abierto ? "abierto" : ""}" data-contenido-grupo="${g.id}">${enlacesHtml}</div>
      </div>`;
  }).join("");

  document.getElementById("shell").innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="sidebar-decor" aria-hidden="true"></div>
        <div class="sidebar-mobile-head">
          <div class="sidebar-mobile-head-brand">
            <div class="sidebar-brand-mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21V5.5Z"/><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M8 7h8M8 10h7"/></svg></div>
            <div><strong>${sidSupervision ? "SID · Educación" : "RAC · Sistema"}</strong><span>${sidSupervision ? "Sistema Integrado Digital" : "Registro de Asignación de Cargos"}</span></div>
          </div>
          <button type="button" class="sidebar-mobile-close" id="btnCerrarMenuMovil" aria-label="Cerrar menú">×</button>
        </div>
        <div class="sidebar-brand">
          ${sidSupervision ? `<div class="sid-tech-logo" aria-label="SID"><span class="sid-tech-glyph" aria-hidden="true">◈</span><strong>SID</strong></div>` : ""}
          <div class="sidebar-brand-mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21V5.5Z"/><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M8 7h8M8 10h7"/></svg></div>
          <div class="sidebar-brand-text"><strong>${sidSupervision ? "SID · Supervisión" : "RAC · Sistema"}</strong><span>${sidSupervision ? "SID-Educación · Monagas" : "Registro de Asignación de Cargos"}</span></div>
        </div>
        <div class="sidebar-marca">${sidSupervision ? "SID · SUPERVISIÓN" : "Monagas · Educación"}</div>
        <div class="sidebar-titulo">${sidSupervision ? "Supervisión Educativa" : "Gestión educativa"}</div>
        <nav>${navHtml}</nav>
        <div class="sidebar-pie">
          <div class="usuario-chip">
            <div class="avatar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="3.6"/><path d="M5 20c1.4-4.3 3.9-6.4 7-6.4s5.6 2.1 7 6.4"/></svg></div>
            <div class="usuario-datos"><strong>${usuario.nombre}</strong><span class="rol-badge">${rolLabel}</span></div>
          </div>
          <button class="btn btn-fantasma btn-sm btn-ancho btn-salir" id="btnSalir"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg> Cerrar sesión</button>
        </div>
      </aside>
      <div class="main-col">
        <header class="topbar">
          <div class="topbar-title"><div><div class="crumb">${sidSupervision ? "SID-EDUCACIÓN · SUPERVISIÓN" : "MONAGAS · EDUCACIÓN"}</div><div class="title">${tituloTopbar}</div></div></div>
          ${sidSupervision ? `<div class="sid-tech-topbar-identity" aria-label="SID-Educación"><strong>EDUCACIÓN</strong><span>Sistema Integrado Digital</span></div>` : ""}
          <div class="topbar-user" aria-label="Sesión activa">
            <div class="topbar-user-avatar">${(usuario.nombre || "U").charAt(0).toUpperCase()}</div>
            <div class="topbar-user-info"><strong>${usuario.nombre || "Usuario"}</strong><span>${rolLabel}</span></div>
          </div>
        </header>
        <main class="contenido" id="contenido"></main>
      </div>
    </div>`;

  const sidebar = document.querySelector(".sidebar");
  const mainCol = document.querySelector(".main-col");
  const topbar = document.querySelector(".topbar");
  const menuBtn = document.createElement("button");
  menuBtn.type = "button";
  menuBtn.className = "mobile-menu";
  menuBtn.setAttribute("aria-label", "Abrir menú");
  menuBtn.setAttribute("aria-expanded", "false");
  menuBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>`;
  const backdrop = document.createElement("div");
  backdrop.className = "sidebar-backdrop";
  backdrop.setAttribute("aria-hidden", "true");
  document.body.appendChild(backdrop);
  topbar.querySelector(".topbar-title")?.prepend(menuBtn);
  const cerrarMenuMovil = () => {
    sidebar.classList.remove("movil-abierto");
    backdrop.classList.remove("visible");
    backdrop.setAttribute("aria-hidden", "true");
    menuBtn.setAttribute("aria-expanded", "false");
    document.body.classList.remove("menu-movil-abierto");
  };
  menuBtn.addEventListener("click", () => {
    const abierto = sidebar.classList.toggle("movil-abierto");
    backdrop.classList.toggle("visible", abierto);
    backdrop.setAttribute("aria-hidden", String(!abierto));
    menuBtn.setAttribute("aria-expanded", String(abierto));
    document.body.classList.toggle("menu-movil-abierto", abierto);
  });
  backdrop.addEventListener("click", cerrarMenuMovil);
  document.addEventListener("keydown", (evento) => {
    if (evento.key === "Escape" && sidebar.classList.contains("movil-abierto")) cerrarMenuMovil();
  });
  document.getElementById("btnCerrarMenuMovil")?.addEventListener("click", cerrarMenuMovil);
  document.querySelectorAll(".nav-link").forEach((link) => link.addEventListener("click", cerrarMenuMovil));

  document.getElementById("btnSalir").addEventListener("click", () => {
    cerrarMenuMovil();
    RAC.cerrarSesion();
  });
  document.querySelectorAll("[data-toggle-grupo]").forEach((boton) => {
    boton.addEventListener("click", () => {
      const id = boton.dataset.toggleGrupo;
      document.querySelector(`[data-contenido-grupo="${id}"]`).classList.toggle("abierto");
      document.querySelector(`[data-flecha-grupo="${id}"]`).classList.toggle("abierto");
    });
  });
  return usuario;
}
