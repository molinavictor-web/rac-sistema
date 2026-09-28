// supervision-login.js — login independiente del módulo Supervisión.
// Usa el MISMO endpoint /api/auth/login que el resto del sistema (Opción A
// de la conversación) -- solo valida que el rol devuelto pertenezca a este
// módulo antes de dejar entrar, para no confundir a alguien que se
// equivocó de puerta con un usuario del RAC principal.

const ROLES_PERMITIDOS = ["admin", "supervision", "director"];

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
      throw new Error("Esta cuenta no tiene acceso al módulo de Supervisión.");
    }
    RAC.guardarSesion(resp.token, resp.usuario);
    window.location.href = resp.usuario.rol === "director" ? "/supervision/mi-plantel.html" : "/supervision/planteles.html";
  } catch (err) {
    error.textContent = err.message;
    error.classList.add("visible");
  } finally {
    boton.disabled = false;
    boton.textContent = "Entrar";
  }
});