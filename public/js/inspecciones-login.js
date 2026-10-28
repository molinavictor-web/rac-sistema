// inspecciones-login.js — entrada independiente del módulo Inspecciones.
// Usa el MISMO endpoint /api/auth/login que el resto del sistema; solo valida
// que el rol devuelto pertenezca a este módulo antes de dejar entrar.
//   insp_ingeniero  → "Mis planillas"
//   el resto        → "Planes de atención"

const ROLES_PERMITIDOS = ["admin", "operador_plantel", "insp_coordinador", "insp_ingeniero", "insp_consulta"];

document.getElementById("formLogin").addEventListener("submit", async (e) => {
  e.preventDefault();
  const boton = document.getElementById("btnEntrar");
  const error = document.getElementById("loginError");
  error.classList.remove("visible");

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  boton.disabled = true;
  boton.textContent = "Entrando…";
  try {
    const resp = await RAC.post("/api/auth/login", { email, password });
    if (!ROLES_PERMITIDOS.includes(resp.usuario.rol)) {
      throw new Error("Esta cuenta no tiene acceso al módulo de Inspecciones.");
    }
    RAC.guardarSesion(resp.token, resp.usuario);
    try { sessionStorage.setItem("rac_portal", "inspecciones"); } catch (_) { /* sin almacenamiento */ }
    window.location.href = resp.usuario.rol === "insp_ingeniero" ? "/inspecciones/mis-planillas.html" : "/inspecciones/planes.html";
  } catch (err) {
    error.textContent = err.message === "Failed to fetch"
      ? "No se pudo conectar con el servidor."
      : err.message === "Credenciales inválidas."
        ? "Correo o contraseña incorrectos."
        : err.message;
    error.classList.add("visible");
    boton.disabled = false;
    boton.innerHTML = 'Entrar a Inspecciones <span aria-hidden="true">→</span>';
  }
});
