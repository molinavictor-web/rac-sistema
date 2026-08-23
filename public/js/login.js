if (RAC.getToken()) window.location.href = "/dashboard.html";

const form = document.getElementById("formLogin");
const errorMsg = document.getElementById("errorMsg");
const btn = document.getElementById("btnEntrar");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorMsg.classList.remove("visible");
  btn.disabled = true;
  btn.textContent = "Entrando…";

  try {
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    const data = await RAC.post("/api/auth/login", { email, password });
    RAC.guardarSesion(data.token, data.usuario);
    window.location.href = "/dashboard.html";
  } catch (err) {
    errorMsg.textContent = err.message === "Failed to fetch"
      ? "No se pudo conectar con el servidor."
      : "Correo o contraseña incorrectos.";
    errorMsg.classList.add("visible");
    btn.disabled = false;
    btn.textContent = "Entrar";
  }
});
