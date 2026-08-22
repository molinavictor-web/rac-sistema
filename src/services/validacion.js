/**
 * Lógica de validación RAC <-> Ministerio.
 *
 * Misma lógica probada en validar_rac.py con datos reales, adaptada
 * para trabajar contra la base de datos (no archivos CSV sueltos).
 *
 * Dos validaciones INDEPENDIENTES por cada fila cargada al RAC:
 *
 *   1. La CEDULA debe existir en personal_ministerio.
 *      NO -> alerta 'no_existe_ministerio' (persona asignada sin
 *            aprobación del Ministerio). Cédulas repetidas en el
 *            RAC son válidas (multi-turno / multi-plantel) y NO
 *            generan alerta por sí solas.
 *
 *   2. El codigo_plantel (COD DEA) debe existir en la tabla
 *      planteles (catálogo maestro). Esta validación es contra el
 *      catálogo, NO contra la nómina.
 *
 *   3. Las horas académicas/administrativas no pueden superar el
 *      máximo físico de 168h/semana (reforzado también con CHECK
 *      constraints en la propia tabla `rac`, ver schema.sql).
 */

const MAX_HORAS_SEMANA = 168;

/**
 * Valida un registro individual (una fila ya parseada de un Excel
 * subido) contra la base de datos. No escribe nada -- solo evalúa
 * y devuelve la lista de alertas que generaría este registro.
 *
 * @param {import('pg').PoolClient} client - conexión/cliente activo
 * @param {object} registro - { cedula, codigo_plantel, horas_academicas, horas_adm, ... }
 * @returns {Promise<Array<{tipo: string, detalle: string}>>}
 */
async function validarRegistro(client, registro) {
  const alertas = [];
  const cedula = normalizarCedula(registro.cedula);

  // --- Validación 1: existencia en el Ministerio (solo por cédula) ---
  const { rows: enMinisterio } = await client.query(
    "SELECT 1 FROM personal_ministerio WHERE cedula = $1 LIMIT 1",
    [cedula]
  );
  if (enMinisterio.length === 0) {
    alertas.push({
      tipo: "no_existe_ministerio",
      detalle:
        "La cédula no aparece en la data del Ministerio (posible asignación sin aprobación del Ministerio).",
    });
  }

  // --- Validación 2: el plantel existe en el catálogo maestro ---
  if (registro.codigo_plantel) {
    const { rows: plantel } = await client.query(
      "SELECT id FROM planteles WHERE codigo_plantel = $1 LIMIT 1",
      [registro.codigo_plantel]
    );
    if (plantel.length === 0) {
      alertas.push({
        tipo: "plantel_no_existe",
        detalle: `El código de plantel '${registro.codigo_plantel}' no existe en el catálogo maestro (COD DEA).`,
      });
    }
  }

  // --- Validación 3: horas dentro de rango físicamente posible ---
  for (const campo of ["horas_academicas", "horas_adm"]) {
    const valor = registro[campo];
    if (valor !== undefined && valor !== null && valor !== "") {
      const horas = Number(valor);
      if (Number.isNaN(horas)) {
        alertas.push({
          tipo: "horas_no_numericas",
          detalle: `${campo} = '${valor}' no es un número válido.`,
        });
      } else if (horas > MAX_HORAS_SEMANA) {
        alertas.push({
          tipo: "horas_invalidas",
          detalle: `${campo} = ${horas} (excede el máximo físico de ${MAX_HORAS_SEMANA}h/semana).`,
        });
      }
    }
  }

  return alertas;
}

function normalizarCedula(cedula) {
  return String(cedula || "").trim().replace(/^0+/, "");
}

module.exports = { validarRegistro, normalizarCedula, MAX_HORAS_SEMANA };
