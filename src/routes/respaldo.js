// respaldo.js — Respaldo de los datos de Supabase descargable por el administrador.
//
//   GET /api/respaldo/resumen    tablas que entran en el respaldo (con filas), tablas excluidas y fecha del último respaldo
//   GET /api/respaldo/descargar  ZIP con: LEEME.txt, restaurar.psql, manifiesto.csv y tablas/<tabla>.csv
//
// - Una tabla = un CSV (UTF-8, separado por comas, con encabezado). Los valores se leen como texto de Postgres,
//   así que se restauran tal cual con COPY (fechas, JSON, números, arreglos…). NULL se escribe vacío y el texto
//   vacío entre comillas ("") para poder distinguirlos.
// - Se excluye personal_ministerio (nómina completa, 137 MB): decisión del usuario; el Ministerio no la actualiza.
// - Las columnas generadas (p. ej. infraestructuras.codigo) no se exportan: Postgres las recalcula.
// - Se lee todo en una sola transacción de solo lectura (una "foto" consistente) y se va comprimiendo al vuelo,
//   así el servidor gratuito no gasta memoria aunque la tabla sea grande.
// - Solo rol admin.

const express = require("express");
const archiver = require("archiver");
const { pool } = require("../db/pool");
const { requireAuth, requireRol } = require("../middleware/auth");

const router = express.Router();

const EXCLUIDAS = ["personal_ministerio"];
const LOTE = 2000;
const CLAVE_ULTIMO = "ultimo_respaldo";

const q = (nombre) => `"${String(nombre).replace(/"/g, '""')}"`;

function celdaCsv(valor) {
  if (valor === null || valor === undefined) return "";
  const t = String(valor);
  if (t === "" || /[",\r\n]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
  return t;
}

function fechaCaracas(fecha = new Date()) {
  return fecha.toLocaleDateString("en-CA", { timeZone: "America/Caracas" });
}

// Tablas del esquema public (sin las excluidas) con sus columnas reales (sin generadas).
async function leerEstructura(cliente) {
  const tablas = (await cliente.query(
    `SELECT c.relname AS tabla, c.oid
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
        AND NOT (c.relname = ANY($1::text[]))
      ORDER BY c.relname`,
    [EXCLUIDAS]
  )).rows;
  const columnas = (await cliente.query(
    `SELECT a.attrelid AS oid, a.attname AS columna
       FROM pg_attribute a
      WHERE a.attrelid = ANY($1::oid[]) AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
      ORDER BY a.attrelid, a.attnum`,
    [tablas.map((t) => t.oid)]
  )).rows;
  const porOid = new Map();
  columnas.forEach((c) => {
    if (!porOid.has(c.oid)) porOid.set(c.oid, []);
    porOid.get(c.oid).push(c.columna);
  });
  const lista = tablas.map((t) => ({ tabla: t.tabla, oid: t.oid, columnas: porOid.get(t.oid) || [] }));

  // Dependencias (claves foráneas) para restaurar en el orden correcto.
  const fks = (await cliente.query(
    `SELECT cl.relname AS hija, cp.relname AS padre
       FROM pg_constraint k
       JOIN pg_class cl ON cl.oid = k.conrelid
       JOIN pg_class cp ON cp.oid = k.confrelid
      WHERE k.contype = 'f' AND cl.relnamespace = 'public'::regnamespace AND cp.relnamespace = 'public'::regnamespace`
  )).rows;
  const seriales = (await cliente.query(
    `SELECT c.relname AS tabla, a.attname AS columna
       FROM pg_attrdef d
       JOIN pg_class c ON c.oid = d.adrelid
       JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
      WHERE c.relnamespace = 'public'::regnamespace AND pg_get_expr(d.adbin, d.adrelid) LIKE 'nextval(%'`
  )).rows;
  return { lista, fks, seriales };
}

// Orden de restauración: primero las tablas de las que otras dependen (Kahn). Si hubiera un ciclo, el resto va al final.
function ordenRestauracion(lista, fks) {
  const nombres = new Set(lista.map((t) => t.tabla));
  const deps = new Map(lista.map((t) => [t.tabla, new Set()]));
  fks.forEach((f) => {
    if (f.hija !== f.padre && nombres.has(f.hija) && nombres.has(f.padre)) deps.get(f.hija).add(f.padre);
  });
  const orden = [];
  const pendientes = new Set(nombres);
  let avanzo = true;
  while (pendientes.size && avanzo) {
    avanzo = false;
    for (const t of [...pendientes].sort()) {
      if ([...deps.get(t)].every((d) => !pendientes.has(d))) {
        orden.push(t); pendientes.delete(t); avanzo = true;
      }
    }
  }
  const conCiclo = [...pendientes].sort();
  return { orden: orden.concat(conCiclo), conCiclo };
}

function guionRestaurar({ lista, fks, seriales, fecha }) {
  const { orden, conCiclo } = ordenRestauracion(lista, fks);
  const info = new Map(lista.map((t) => [t.tabla, t]));
  const l = [];
  l.push(`-- Restauración del respaldo SID del ${fecha}`);
  l.push("-- Cómo usarlo (en la carpeta donde descomprimiste el ZIP):");
  l.push('--   psql "<cadena de conexión de Supabase>" -f restaurar.psql');
  l.push("-- Requisitos: las tablas ya deben existir y estar VACÍAS (créalas con schema.sql y los scripts de scripts/sql/ del repositorio).");
  l.push("-- Todo va dentro de una transacción: si algo falla, no queda nada a medias.");
  l.push("-- No incluye personal_ministerio (nómina); esa se vuelve a cargar con la carga normal del Ministerio.");
  if (conCiclo.length) l.push(`-- OJO: estas tablas tienen dependencias circulares y van al final; si falla una clave foránea, cárgalas en otro orden: ${conCiclo.join(", ")}`);
  l.push("\\set ON_ERROR_STOP on");
  l.push("BEGIN;");
  orden.forEach((t) => {
    const cols = info.get(t).columnas.map(q).join(", ");
    l.push(`\\copy ${q(t)} (${cols}) FROM 'tablas/${t}.csv' WITH (FORMAT csv, HEADER true, ENCODING 'UTF8')`);
  });
  l.push("-- Ajustar los contadores automáticos (ids) para que los registros nuevos no choquen con los restaurados");
  seriales.filter((s) => info.has(s.tabla)).forEach((s) => {
    l.push(`SELECT setval(pg_get_serial_sequence('public.${q(s.tabla)}', '${s.columna}'), GREATEST(COALESCE((SELECT MAX(${q(s.columna)}) FROM public.${q(s.tabla)}), 0), 1));`);
  });
  l.push("COMMIT;");
  return l.join("\n") + "\n";
}

function textoLeeme({ fecha, cantidad }) {
  return [
    `RESPALDO DE DATOS — SID Educación Monagas — ${fecha}`,
    "",
    `Contiene ${cantidad} tablas de la base de datos (Supabase), una por archivo en la carpeta «tablas».`,
    "NO contiene personal_ministerio (nómina del Ministerio, 137 MB): se decidió no respaldarla; se vuelve a cargar con la carga normal.",
    "NO contiene lo que está en Google Drive / Google Sheets (GESCOLAR, Coordenadas Planteles, archivos de planteles): eso se respalda desde Drive.",
    "",
    "ARCHIVOS",
    "  manifiesto.csv   cuántas filas tiene cada tabla (para comprobar el respaldo)",
    "  restaurar.psql   script para restaurar (ver abajo)",
    "  tablas/*.csv     los datos (UTF-8, separados por coma; se abren con Excel con «Datos > Desde texto/CSV»)",
    "",
    "CUIDADO: la tabla «usuarios» trae las contraseñas cifradas y otras tablas traen datos personales (cédulas, teléfonos).",
    "Guarda este archivo en un lugar PRIVADO (no en un repositorio, no en un grupo, no por correo abierto).",
    "",
    "CÓMO RESTAURAR (lo hace alguien con conocimientos técnicos, o una IA con acceso a Supabase)",
    "  1. Crear las tablas vacías: schema.sql y los scripts de scripts/sql/ del repositorio rac-sistema (en orden).",
    "  2. Descomprimir este ZIP y, en esa carpeta: psql \"<cadena de conexión de Supabase>\" -f restaurar.psql",
    "  3. Revisar que las filas coincidan con manifiesto.csv.",
    "  Alternativa sin psql: en Supabase > Table Editor, cada tabla > Insert > Import data from CSV (en el orden de restaurar.psql).",
    "",
    "Se recomienda descargar un respaldo cada mes y guardar al menos los tres últimos.",
    "",
  ].join("\r\n");
}

async function* csvDeTabla(cliente, t, contador, indice) {
  const cursor = `respaldo_c${indice}`;
  const sel = t.columnas.map((c) => `${q(c)}::text AS ${q(c)}`).join(", ");
  yield Buffer.from(t.columnas.map(celdaCsv).join(",") + "\n", "utf8");
  if (!t.columnas.length) return;
  await cliente.query(`DECLARE ${cursor} NO SCROLL CURSOR FOR SELECT ${sel} FROM public.${q(t.tabla)}`);
  try {
    for (;;) {
      const { rows } = await cliente.query(`FETCH ${LOTE} FROM ${cursor}`);
      if (!rows.length) break;
      contador.filas += rows.length;
      yield Buffer.from(rows.map((r) => t.columnas.map((c) => celdaCsv(r[c])).join(",")).join("\n") + "\n", "utf8");
      if (rows.length < LOTE) break;
    }
  } finally {
    await cliente.query(`CLOSE ${cursor}`).catch(() => {});
  }
}

router.get("/resumen", requireAuth, requireRol("admin"), async (req, res) => {
  const cliente = await pool.connect();
  try {
    const { lista } = await leerEstructura(cliente);
    const tablas = [];
    for (const t of lista) {
      const { rows } = await cliente.query(`SELECT COUNT(*)::bigint AS n FROM public.${q(t.tabla)}`);
      tablas.push({ tabla: t.tabla, filas: Number(rows[0].n) });
    }
    let ultimo = null;
    try {
      const r = await cliente.query("SELECT valor FROM configuracion WHERE clave = $1", [CLAVE_ULTIMO]);
      ultimo = r.rows.length ? r.rows[0].valor : null;
    } catch (_) { /* sin dato */ }
    res.json({ tablas, excluidas: EXCLUIDAS, ultimo_respaldo: ultimo });
  } catch (err) {
    console.error("Respaldo (resumen):", err);
    res.status(500).json({ error: "No se pudo leer la lista de tablas." });
  } finally {
    cliente.release();
  }
});

router.get("/descargar", requireAuth, requireRol("admin"), async (req, res) => {
  const { Readable } = require("stream");
  const cliente = await pool.connect();
  let cerrado = false;
  const cerrar = async (ok) => {
    if (cerrado) return;
    cerrado = true;
    try { await cliente.query(ok ? "COMMIT" : "ROLLBACK"); } catch (_) { /* ya cerrada */ }
    cliente.release();
  };
  let zip = null;
  res.on("close", () => { if (!cerrado) { if (zip) zip.abort(); cerrar(false); } });
  try {
    await cliente.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const estructura = await leerEstructura(cliente);
    const fecha = fechaCaracas();
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="RESPALDO_SID_${fecha}.zip"`);
    res.setHeader("Cache-Control", "no-store");

    zip = archiver("zip", { zlib: { level: 6 } });
    let falloZip = null;
    zip.on("error", (e) => { falloZip = e; });
    zip.on("warning", (e) => console.warn("Respaldo (aviso zip):", e.message));
    zip.pipe(res);

    zip.append(Buffer.from(textoLeeme({ fecha, cantidad: estructura.lista.length }), "utf8"), { name: "LEEME.txt" });
    zip.append(Buffer.from(guionRestaurar({ ...estructura, fecha }), "utf8"), { name: "restaurar.psql" });

    // Una tabla a la vez (así se usa un solo cursor) y esperando a que archiver termine cada archivo.
    const manifiesto = ["tabla,filas"];
    for (let i = 0; i < estructura.lista.length; i++) {
      const t = estructura.lista[i];
      const nombre = `tablas/${t.tabla}.csv`;
      const contador = { filas: 0 };
      await new Promise((resolve, reject) => {
        const limpiar = () => { zip.removeListener("entry", alEntrar); zip.removeListener("error", alFallar); };
        const alEntrar = (e) => { if (e.name === nombre) { limpiar(); resolve(); } };
        const alFallar = (e) => { limpiar(); reject(e); };
        zip.on("entry", alEntrar);
        zip.on("error", alFallar);
        const flujo = Readable.from(csvDeTabla(cliente, t, contador, i));
        flujo.on("error", alFallar);
        zip.append(flujo, { name: nombre });
      });
      manifiesto.push(`${t.tabla},${contador.filas}`);
    }
    if (falloZip) throw falloZip;
    zip.append(Buffer.from(manifiesto.join("\n") + "\n", "utf8"), { name: "manifiesto.csv" });
    await zip.finalize();
    await cerrar(true);
    try {
      await pool.query(
        `INSERT INTO configuracion (clave, valor) VALUES ($1, $2)
         ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor`,
        [CLAVE_ULTIMO, new Date().toISOString()]
      );
    } catch (e) { console.warn("Respaldo: no se pudo anotar la fecha:", e.message); }
  } catch (err) {
    console.error("Respaldo (descarga):", err);
    await cerrar(false);
    if (!res.headersSent) res.status(500).json({ error: "No se pudo generar el respaldo." });
    else res.destroy(err);
  }
});

module.exports = router;
