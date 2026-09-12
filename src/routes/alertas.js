const express = require("express");
const { pool, conTransaccionAuditada } = require("../db/pool");
const { requireAuth, requireRol } = require("../middleware/auth");
const router = express.Router();

/**
 * Completa nombres/apellidos para un arreglo de filas que tengan columna
 * "cedula", cruzando primero contra personal_ministerio (fuente principal)
 * y, si la cédula no aparece ahí, contra rac como respaldo.
 *
 * IMPORTANTE: esto se hace con un mapa en memoria (2 consultas extra, con
 * las cédulas ya deduplicadas) y NO con un JOIN directo -- una cédula puede
 * tener varias filas en `rac` (docentes con varios planteles), y un JOIN
 * ahí duplicaría cada fila una vez por cada registro suyo en `rac`.
 * `personal_ministerio` sí es 1 fila por cédula, pero se optó por el mismo
 * patrón en ambas para mantenerlo consistente.
 *
 * Devuelve un Map cedula -> { nombres, apellidos }.
 */
async function completarNombres(filas) {
  const cedulas = [...new Set(filas.map((f) => f.cedula).filter(Boolean))];
  const mapaNombres = new Map();
  if (!cedulas.length) return mapaNombres;

  const nominaRes = await pool.query(
    `SELECT cedula, nombres, apellidos FROM personal_ministerio WHERE cedula = ANY($1)`,
    [cedulas]
  );
  for (const fila of nominaRes.rows) {
    mapaNombres.set(fila.cedula, { nombres: fila.nombres, apellidos: fila.apellidos });
  }

  const cedulasSinNomina = cedulas.filter((c) => !mapaNombres.has(c));
  if (cedulasSinNomina.length) {
    // DISTINCT ON (cedula) para no traer más de una fila por cédula aunque
    // esa cédula tenga varios registros en rac (docentes multi-plantel).
    const racRes = await pool.query(
      `SELECT DISTINCT ON (cedula) cedula, nombres, apellidos
       FROM rac
       WHERE cedula = ANY($1)
       ORDER BY cedula, actualizado_en DESC`,
      [cedulasSinNomina]
    );
    for (const fila of racRes.rows) {
      mapaNombres.set(fila.cedula, { nombres: fila.nombres, apellidos: fila.apellidos });
    }
  }

  return mapaNombres;
}

/**
 * GET /api/alertas?estado=pendiente&tipo=no_existe_ministerio&detalle=CODIGO
 * Bandeja de alertas para el operador.
 *
 * MEJORA 7 (2026-09-07):
 *  - Se quitó el LIMIT 200 fijo -- con 8.000+ alertas, ese límite hacía que
 *    tanto la tabla como cualquier resumen/conteo del frontend solo vieran
 *    una fracción arbitraria (las 200 más recientes), sin ninguna forma de
 *    saber que había más. La cantidad de alertas es manejable para traer
 *    completa en una sola consulta (mismo orden de magnitud que otras
 *    tablas del sistema que ya se cargan enteras, ej. planteles/exportar).
 *  - Sin parámetro "estado": se sigue devolviendo solo pendientes (mismo
 *    comportamiento histórico -- otras pantallas dependen de esto, ej. un
 *    badge de conteo de pendientes).
 *  - estado=todas: ahora SÍ quita el filtro de estado (antes cualquier
 *    valor que no fuera uno de los 4 estados reales terminaba cayendo en
 *    el default "pendiente" porque el frontend mandaba la petición SIN el
 *    parámetro -- "Todas" nunca había mostrado nada distinto de pendientes).
 *  - Respuesta ahora es { alertas, total } en vez del arreglo plano -- el
 *    frontend ya soporta ambas formas (RAC.lista busca la clave "alertas"
 *    si no es un arreglo directo), así que esto no rompe nada existente.
 *
 * MEJORA 8 (2026-09-09):
 *  - La tabla `alertas` solo guarda la cédula, nunca nombre/apellido -- la
 *    bandeja se veía como una lista de números sin contexto de a quién
 *    corresponde cada fila. Se completan `nombres`/`apellidos` por cédula
 *    (ver helper completarNombres arriba).
 *
 * MEJORA "Códigos sin catalogar" (2026-09-11):
 *  - Se agrega el parámetro opcional "detalle" para filtrar por el código
 *    exacto de plantel -- lo usa la pantalla nueva "Códigos sin catalogar"
 *    al hacer clic en "Ver detalle" de un código agrupado.
 *  - DATO CLAVE descubierto al probar (2026-09-11): la columna `detalle`
 *    para alertas tipo `plantel_no_existe` NO guarda el código puro (ej.
 *    "OD07934890"), guarda el MENSAJE completo generado por racCompleto.js:
 *    `Código de plantel "OD07934890" no existe en el catálogo maestro`
 *    (código entre comillas). Por eso el filtro NO puede ser igualdad
 *    directa `a.detalle = $N` contra el código puro -- se busca el código
 *    como substring exacto entre comillas dentro del mensaje con
 *    `position('"CODIGO"' in a.detalle) > 0`. Esto también es lo que
 *    corrige el endpoint agrupado de abajo (ver su comentario).
 */
router.get("/", requireAuth, async (req, res) => {
  const estadoParam = req.query.estado;
  const condiciones = [];
  const valores = [];

  if (estadoParam === undefined) {
    valores.push("pendiente");
    condiciones.push(`a.estado = $${valores.length}`);
  } else if (estadoParam !== "todas") {
    valores.push(estadoParam);
    condiciones.push(`a.estado = $${valores.length}`);
  }
  // estadoParam === "todas" -> sin condición de estado, trae todas.

  if (req.query.tipo) {
    valores.push(req.query.tipo);
    condiciones.push(`a.tipo = $${valores.length}`);
  }

  if (req.query.detalle) {
    // Ver nota "DATO CLAVE" arriba: el código real va envuelto en comillas
    // dentro del mensaje completo, así que se busca como substring exacto
    // (con sus comillas) en vez de comparar por igualdad.
    valores.push(`"${req.query.detalle}"`);
    condiciones.push(`position($${valores.length} in a.detalle) > 0`);
  }

  const where = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";
  const { rows } = await pool.query(
    `SELECT a.*, u.nombre AS revisado_por_nombre
     FROM alertas a
     LEFT JOIN usuarios u ON u.id = a.revisado_por
     ${where}
     ORDER BY a.creado_en DESC`,
    valores
  );

  const mapaNombres = await completarNombres(rows);
  const alertasConNombre = rows.map((a) => {
    const datos = mapaNombres.get(a.cedula);
    return {
      ...a,
      nombres: datos ? datos.nombres : null,
      apellidos: datos ? datos.apellidos : null,
    };
  });

  res.json({ alertas: alertasConNombre, total: alertasConNombre.length });
});

/**
 * GET /api/alertas/plantel-no-existe/agrupado
 * Vista agrupada para la pantalla "Códigos sin catalogar": un código de
 * plantel por fila, con el total de alertas pendientes que genera y hasta
 * 3 cédulas de muestra (con nombre) para dar contexto sin abrir el detalle.
 * Reemplaza el GROUP BY manual que antes se corría por SQL directo en
 * Supabase.
 *
 * DATO CLAVE (2026-09-11, ver también el comentario de GET "/" arriba):
 * `detalle` guarda el mensaje completo, no el código puro -- se extrae el
 * código con `substring(detalle from '"([^"]*)"')` (todo lo que está entre
 * el primer par de comillas) y se agrupa por ese valor extraído, no por
 * `detalle` crudo. Esto es lo que hace que el código que llega al frontend
 * (y que este usa tal cual en atributos HTML y para armar la URL de
 * "Dar de alta") sea el código puro y no el mensaje completo -- antes esto
 * rompía esos dos botones porque el mensaje trae comillas que cortan a la
 * mitad un atributo HTML sin escapar.
 *
 * Nota de rutas: esto va montado antes que nada que use "/:algo" en este
 * archivo para evitar que Express confunda "plantel-no-existe" con un
 * parámetro -- hoy no hay ningún GET "/:id" en este router, pero se deja
 * así por si se agrega uno más adelante.
 */
router.get("/plantel-no-existe/agrupado", requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT g.codigo, g.cantidad, s.cedula
     FROM (
       SELECT
         substring(detalle from '"([^"]*)"') AS codigo,
         COUNT(*)::int AS cantidad
       FROM alertas
       WHERE tipo = 'plantel_no_existe' AND estado = 'pendiente'
       GROUP BY substring(detalle from '"([^"]*)"')
     ) g
     LEFT JOIN LATERAL (
       SELECT a.cedula
       FROM alertas a
       WHERE a.tipo = 'plantel_no_existe' AND a.estado = 'pendiente'
         AND substring(a.detalle from '"([^"]*)"') = g.codigo
       ORDER BY a.cedula
       LIMIT 3
     ) s ON true
     ORDER BY g.cantidad DESC, g.codigo`
  );

  const mapaNombres = await completarNombres(rows);

  const agrupados = new Map();
  for (const fila of rows) {
    if (!agrupados.has(fila.codigo)) {
      agrupados.set(fila.codigo, { codigo: fila.codigo, cantidad: fila.cantidad, muestra: [] });
    }
    if (fila.cedula) {
      const datos = mapaNombres.get(fila.cedula);
      agrupados.get(fila.codigo).muestra.push({
        cedula: fila.cedula,
        nombres: datos ? datos.nombres : null,
        apellidos: datos ? datos.apellidos : null,
      });
    }
  }

  const codigos = [...agrupados.values()];
  res.json({ codigos, total: codigos.length });
});

/**
 * PATCH /api/alertas/:id
 * Marca una alerta como revisada/resuelta/descartada.
 * Solo operador/admin.
 */
router.patch("/:id", requireAuth, requireRol("operador", "admin"), async (req, res) => {
  const { estado } = req.body; // revisado / resuelto / descartado
  if (!["revisado", "resuelto", "descartado"].includes(estado)) {
    return res.status(400).json({ error: "Estado inválido." });
  }
  const resultado = await conTransaccionAuditada(req.usuario.id, async (client) => {
    const { rows } = await client.query(
      `UPDATE alertas
       SET estado = $1, revisado_por = $2, fecha_revision = now()
       WHERE id = $3 RETURNING *`,
      [estado, req.usuario.id, req.params.id]
    );
    return rows[0];
  });
  if (!resultado) {
    return res.status(404).json({ error: "Alerta no encontrada." });
  }
  res.json(resultado);
});

module.exports = router;
