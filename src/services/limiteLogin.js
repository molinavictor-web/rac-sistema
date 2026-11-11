// limiteLogin.js — bloqueo temporal por intentos fallidos de inicio de sesión.
//
// Tras MAX_FALLOS claves incorrectas SEGUIDAS para el mismo correo, ese correo espera MINUTOS_BLOQUEO minutos.
// - Se cuenta por correo (en minúsculas), exista o no el usuario, para no revelar qué correos existen.
// - Un ingreso correcto reinicia el conteo. Si pasa más de la ventana sin fallos, el conteo también se reinicia.
// - No se usa la dirección IP: el servidor está detrás del proxy de Render y todos los usuarios compartirían la misma.
// - Vive en memoria (sin tablas): si el servidor se reinicia, los bloqueos se borran. Es suficiente contra adivinar claves.

const MAX_FALLOS = 5;
const MINUTOS_BLOQUEO = 15;
const VENTANA_MS = MINUTOS_BLOQUEO * 60 * 1000;
const MAX_ENTRADAS = 5000;

const estados = new Map(); // clave -> { fallos, ultimo, bloqueadoHasta }

function clave(email) {
  return String(email || "").trim().toLowerCase().slice(0, 200);
}

function limpiarVencidos(ahora) {
  for (const [k, e] of estados) {
    if (e.bloqueadoHasta <= ahora && ahora - e.ultimo > VENTANA_MS) estados.delete(k);
  }
}

// Minutos que faltan para poder intentar de nuevo (0 = puede intentar).
function minutosDeEspera(email, ahora = Date.now()) {
  const e = estados.get(clave(email));
  if (!e || e.bloqueadoHasta <= ahora) return 0;
  return Math.ceil((e.bloqueadoHasta - ahora) / 60000);
}

function registrarFallo(email, ahora = Date.now()) {
  const k = clave(email);
  if (!k) return;
  if (estados.size >= MAX_ENTRADAS && !estados.has(k)) limpiarVencidos(ahora);
  let e = estados.get(k);
  if (!e || (e.bloqueadoHasta <= ahora && ahora - e.ultimo > VENTANA_MS)) e = { fallos: 0, ultimo: ahora, bloqueadoHasta: 0 };
  e.fallos += 1;
  e.ultimo = ahora;
  if (e.fallos >= MAX_FALLOS) { e.bloqueadoHasta = ahora + VENTANA_MS; e.fallos = 0; }
  estados.set(k, e);
}

function registrarExito(email) {
  estados.delete(clave(email));
}

function mensajeEspera(minutos) {
  return `Demasiados intentos fallidos. Espera ${minutos} minuto${minutos === 1 ? "" : "s"} e inténtalo de nuevo.`;
}

function reiniciarTodo() { estados.clear(); }

module.exports = { MAX_FALLOS, MINUTOS_BLOQUEO, minutosDeEspera, registrarFallo, registrarExito, mensajeEspera, reiniciarTodo };
