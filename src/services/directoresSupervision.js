// directoresSupervision.js — compara los datos del director de GESCOLAR (hoja de Google) con los de Supervisión
// (tabla directores_supervision) y arma el PLAN de actualización de la hoja. No escribe nada: solo calcula.
//
// Reglas acordadas con el usuario (4-nov-2026):
//  · Cédula DISTINTA (ambas con dato) → el director de GESCOLAR quedó viejo: se REEMPLAZA todo por lo de Supervisión
//    (nombre, cédula, teléfonos y correo). Si Supervisión no tiene algún teléfono o el correo, queda vacío (eran del director anterior).
//  · Cédula IGUAL (o vacía en GESCOLAR) → solo se COMPLETAN vacíos: nombre incompleto (GESCOLAR ⊂ Supervisión) o vacío,
//    teléfono si GESCOLAR no tiene ninguno válido. No se pisa nada que ya tenga dato.
//  · Lo que no se toca pero conviene mirar (nombre distinto con la misma cédula, teléfono distinto) se cuenta en `revisar`.
// Formato de teléfono en GESCOLAR: 10 dígitos sin el cero inicial (4141234567).

const CAMPOS = ["director_nombre", "tipo_documento", "documento_identidad", "telefono_director", "telefono_movil_director", "correo"];

const limpio = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim();
const soloDigitos = (v) => String(v == null ? "" : v).replace(/\D/g, "");
const cedulaClave = (v) => soloDigitos(v).replace(/^0+/, "");

function sinAcentos(s) {
  return limpio(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}
function palabras(s) { return new Set(sinAcentos(s).split(" ").filter(Boolean)); }
function esSubconjunto(a, b) { return a.size > 0 && [...a].every((x) => b.has(x)); }
function mismoConjunto(a, b) { return a.size === b.size && esSubconjunto(a, b); }

// Número telefónico en el formato de la hoja (10 dígitos, sin el 0 inicial). "" si no es un teléfono válido.
function telefonoHoja(v) {
  let d = soloDigitos(v);
  if (d.startsWith("58") && d.length >= 12) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return d.length === 10 ? d : "";
}
// Todos los números que haya en un texto de Supervisión ("0414-1234567 / 0291-6413141"), sin repetir.
function telefonosDe(texto) {
  const partes = String(texto || "").split(/[\/;,]|\s{2,}|\sy\s/i);
  const salida = [];
  partes.forEach((p) => { const t = telefonoHoja(p); if (t && !salida.includes(t)) salida.push(t); });
  if (!salida.length) { const t = telefonoHoja(texto); if (t) salida.push(t); }
  return salida;
}
const esMovil = (t) => /^4(12|14|16|24|26)/.test(t);
// Reparte los teléfonos de Supervisión en las dos columnas de GESCOLAR: móvil y fijo.
function repartirTelefonos(lista) {
  const moviles = lista.filter(esMovil);
  const fijos = lista.filter((t) => !esMovil(t));
  return { movil: moviles[0] || "", fijo: fijos[0] || moviles[1] || "" };
}

// encabezado: fila de títulos de la hoja; filas: resto (arreglos crudos); sup: filas de directores_supervision.
function planear(encabezado, filas, sup) {
  const idx = {};
  ["cod_plantel", "nombre_plantel", "municipio", ...CAMPOS].forEach((c) => { idx[c] = encabezado.indexOf(c); });
  const faltan = CAMPOS.concat(["cod_plantel"]).filter((c) => idx[c] === -1);
  if (faltan.length) throw new Error("Faltan columnas en la hoja GESCOLAR: " + faltan.join(", "));
  const porCodigo = new Map(sup.map((s) => [limpio(s.codigo_plantel).toUpperCase(), s]));
  const valor = (fila, campo) => limpio(fila[idx[campo]]);

  const resumen = { en_ambos: 0, solo_gescolar: 0, reemplazar: 0, completar: 0, sin_cambio: 0, revisar_nombre: 0, revisar_telefono: 0 };
  const cambios = [];
  const vistos = new Set();

  filas.forEach((fila, i) => {
    if (!fila.some((v) => v !== undefined && v !== "")) return;
    const codigo = valor(fila, "cod_plantel").toUpperCase();
    if (!codigo) return;
    vistos.add(codigo);
    const s = porCodigo.get(codigo);
    if (!s) { resumen.solo_gescolar += 1; return; }
    resumen.en_ambos += 1;

    const actual = {};
    CAMPOS.forEach((c) => { actual[c] = valor(fila, c); });
    const nuevo = {};
    const sCed = soloDigitos(s.cedula);
    const sNombre = limpio(s.nombre);
    const sCorreo = limpio(s.correo);
    const tel = repartirTelefonos(telefonosDe(s.telefono));
    const gCed = cedulaClave(actual.documento_identidad);
    const gTelValidos = [telefonoHoja(actual.telefono_director), telefonoHoja(actual.telefono_movil_director)].filter(Boolean);
    let tipo = null;

    if (gCed && sCed && gCed !== cedulaClave(sCed)) {
      // ---- REEMPLAZO: otro director ----
      tipo = "REEMPLAZO";
      if (sNombre) nuevo.director_nombre = sNombre;
      nuevo.documento_identidad = sCed;
      nuevo.tipo_documento = actual.tipo_documento || "V";
      nuevo.telefono_movil_director = tel.movil;
      nuevo.telefono_director = tel.fijo;
      nuevo.correo = sCorreo;
    } else {
      // ---- COMPLETAR vacíos ----
      if (!gCed && sCed) { nuevo.documento_identidad = sCed; if (!actual.tipo_documento) nuevo.tipo_documento = "V"; }
      const a = palabras(actual.director_nombre), b = palabras(sNombre);
      if (sNombre) {
        if (!a.size) nuevo.director_nombre = sNombre;
        else if (!mismoConjunto(a, b) && esSubconjunto(a, b)) nuevo.director_nombre = sNombre;
        else if (!mismoConjunto(a, b) && gCed && gCed === cedulaClave(sCed) && !esSubconjunto(b, a)) resumen.revisar_nombre += 1;
      }
      if (!gTelValidos.length) {
        if (tel.movil) nuevo.telefono_movil_director = tel.movil;
        if (tel.fijo) nuevo.telefono_director = tel.fijo;
        if (nuevo.telefono_movil_director || nuevo.telefono_director) tipo = tipo || "COMPLETAR";
      } else {
        const todos = telefonosDe(s.telefono);
        if (todos.length && !todos.some((t) => gTelValidos.includes(t))) resumen.revisar_telefono += 1;
      }
      if (Object.keys(nuevo).length) tipo = tipo || "COMPLETAR";
    }

    const campos = [];
    CAMPOS.forEach((c) => {
      if (nuevo[c] === undefined) return;
      const antes = actual[c];
      const despues = limpio(nuevo[c]);
      const igualValor = c === "documento_identidad" ? cedulaClave(antes) === cedulaClave(despues) && antes === despues
        : (c.startsWith("telefono") ? telefonoHoja(antes) === despues && (despues !== "" || antes === "") : antes === despues);
      if (!igualValor) campos.push({ campo: c, antes, despues });
    });
    if (!campos.length) { resumen.sin_cambio += 1; return; }
    if (tipo === "REEMPLAZO") resumen.reemplazar += 1; else resumen.completar += 1;
    cambios.push({
      codigo, plantel: valor(fila, "nombre_plantel"), municipio: valor(fila, "municipio"),
      fila: i + 2, tipo, campos,
    });
  });
  resumen.solo_supervision = [...porCodigo.keys()].filter((k) => !vistos.has(k)).length;
  return { resumen, cambios };
}

module.exports = { planear, telefonosDe, repartirTelefonos, telefonoHoja, CAMPOS };
