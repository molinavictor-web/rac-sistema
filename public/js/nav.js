// nav.js — dibuja el shell (sidebar + topbar) igual en todas las páginas,
// ajustando qué enlaces se ven según el rol del usuario.

function renderShell(paginaActiva, tituloTopbar) {
  const usuario = RAC.exigirSesion();
  if (!usuario) return null;

  const enlaces = [
    { id: "dashboard", href: "/dashboard.html", label: "Resumen", roles: null },
    { id: "rac", href: "/rac.html", label: "Consultar RAC", roles: null },
    { id: "alertas", href: "/alertas.html", label: "Alertas", roles: null },
    { id: "cargas", href: "/cargas.html", label: "Cargar personal", roles: ["encargado_municipio", "operador", "admin"] },
    { id: "nomina", href: "/nomina.html", label: "Cargar nómina Ministerio", roles: ["admin"] },
    { id: "rac-completo", href: "/rac-completo.html", label: "Cargar RAC completo", roles: ["admin"] },
    { id: "usuarios", href: "/usuarios.html", label: "Usuarios", roles: ["admin"] },
  ];

  const rolLabel = {
    admin: "Administrador",
    operador: "Operador",
    encargado_municipio: "Encargado de municipio",
  }[usuario.rol] || usuario.rol;

  const navHtml = enlaces
    .filter((e) => !e.roles || e.roles.includes(usuario.rol))
    .map((e) => `<a class="nav-link ${e.id === paginaActiva ? "activo" : ""}" href="${e.href}">${e.label}</a>`)
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
  return usuario;
}
