// api.js — cliente ligero para hablar con el backend del RAC.
// Usa rutas relativas ("/api/...") porque el frontend se sirve
// desde el mismo servicio de Render que expone la API.

const RAC = (() => {
  const TOKEN_KEY = "rac_token";
  const USUARIO_KEY = "rac_usuario";

  // El módulo de Supervisión vive en el mismo repo/servidor pero con
  // acceso aparte (/supervision/login.html) -- si la sesión expira o
  // no existe, hay que devolver al usuario al login correcto según en
  // qué sección del sitio esté, no siempre al /login.html principal.
  function loginUrl() {
    return window.location.pathname.startsWith("/supervision/") ? "/supervision/login.html" : "/login.html";
  }

  function getToken() {
    return sessionStorage.getItem(TOKEN_KEY);
  }

  function getUsuario() {
    const raw = sessionStorage.getItem(USUARIO_KEY);
    return raw ? JSON.parse(raw) : null;
  }

  function guardarSesion(token, usuario) {
    sessionStorage.setItem(TOKEN_KEY, token);
    sessionStorage.setItem(USUARIO_KEY, JSON.stringify(usuario));
  }

  function cerrarSesion() {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USUARIO_KEY);
    window.location.href = loginUrl();
  }

  function exigirSesion() {
    if (!getToken()) {
      window.location.href = loginUrl();
      return null;
    }
    return getUsuario();
  }

  async function llamar(ruta, opciones = {}) {
    const headers = Object.assign(
      { "Content-Type": "application/json" },
      opciones.headers || {}
    );
    const token = getToken();
    if (token) headers["Authorization"] = "Bearer " + token;

    const resp = await fetch(ruta, Object.assign({}, opciones, { headers }));

    if (resp.status === 401) {
      cerrarSesion();
      throw new Error("Sesión expirada.");
    }

    let data = null;
    try { data = await resp.json(); } catch (_) { /* respuesta sin cuerpo */ }

    if (!resp.ok) {
      const mensaje = (data && data.error) ? data.error : `Error ${resp.status}`;
      throw new Error(mensaje);
    }
    return data;
  }

  // El backend puede envolver los listados como {alertas:[...]}, {usuarios:[...]},
  // {data:[...]} o devolver el arreglo directo. Esto evita que la interfaz
  // se rompa si el nombre de la envoltura no coincide exactamente.
  function lista(data, ...claves) {
    if (Array.isArray(data)) return data;
    if (!data) return [];
    for (const clave of claves) {
      if (Array.isArray(data[clave])) return data[clave];
    }
    for (const valor of Object.values(data)) {
      if (Array.isArray(valor)) return valor;
    }
    return [];
  }

  return {
    getToken, getUsuario, guardarSesion, cerrarSesion, exigirSesion, lista,
    get: (ruta) => llamar(ruta, { method: "GET" }),
    post: (ruta, body) => llamar(ruta, { method: "POST", body: JSON.stringify(body) }),
    patch: (ruta, body) => llamar(ruta, { method: "PATCH", body: JSON.stringify(body) }),
    del: (ruta) => llamar(ruta, { method: "DELETE" }),
  };
})();

function mostrarToast(mensaje, esError = false) {
  let el = document.querySelector(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = mensaje;
  el.classList.toggle("error", esError);
  el.classList.add("visible");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("visible"), 3200);
}
