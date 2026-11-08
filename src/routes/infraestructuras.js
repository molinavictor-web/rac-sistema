// infraestructuras.js — pantalla "Infraestructuras": clasificar cada plantel como solo en su edificio o
// comparte edificio, con código INFRA-000001… por edificio (ver services/infraestructuras.js).
//
// Montado en /api/inspecciones/infraestructuras (dentro de /api/inspecciones: los perfiles insp_* ya pueden usarlo).
//   GET  /resumen?municipio=&parroquia=   tarjetas (del ámbito elegido; sin filtros, las globales): clasificados, sin clasificar, solos, edificios compartidos, infraestructuras
//   GET  /planteles?q=&estado=&municipio=&parroquia=&pagina=   planteles de GESCOLAR con su clasificación
//   GET  /parroquias?municipio=   parroquias de un municipio (para el filtro)
//   GET  /buscar?q=&excluir=      buscar otra institución (con su edificio, si ya tiene)
//   GET  /plantel/:codigo         un plantel con su edificio y compañeros
//   POST /clasificar              { codigo_dea, comparte, otras:[{codigo_dea,nombre}], espacios?:[…] }  (espacios: lista completa de espacios separados; si no viene, no se tocan)
//   GET  /sugerencias             posibles edificios compartidos por el código (D diurno + N nocturno, mismo número); POST /sugerencias/descartar y /restaurar
//   POST /sincronizar             (admin/coordinador) vuelve a importar la hoja Coordenadas Planteles

const express = require("express");
const { requireAuth, requireRol } = require("../middleware/auth");
const { pool } = require("../db/pool");
const gescolar = require("../services/gescolar");
const infra = require("../services/infraestructuras");

const router = express.Router();

const ROLES_ESCRIBE = ["admin", "insp_coordinador", "insp_ingeniero"];
const ROLES_LECTURA = [...ROLES_ESCRIBE, "insp_consulta", "operador_plantel"];
const ROLES_GESTION = ["admin", "insp_coordinador"];

const limpiar = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim();

function responderError(res, err, mensaje) {
  if (err instanceof infra.ErrorInfra) return res.status(err.status).json({ error: err.message, ...err.extra });
  console.error(mensaje, err);
  return res.status(500).json({ error: mensaje });
}

// Antes de leer, se importa lo que haya en la hoja (como mucho cada 5 minutos). Si falla, se muestra lo guardado.
async function asegurarSync() {
  try { return await infra.sincronizar(); } catch (e) { console.error("Infraestructuras: sincronizar:", e.message); return { hoja_ok: false }; }
}

router.get("/resumen", requireAuth, requireRol(...ROLES_LECTURA), async (req, res) => {
  try {
    const s = await asegurarSync();
    res.json({ ...(await infra.resumen({ municipio: limpiar(req.query.municipio), parroquia: limpiar(req.query.parroquia) })), hoja_ok: s.hoja_ok });
  } catch (err) {
    responderError(res, err, "No se pudo cargar el resumen de infraestructuras.");
  }
});

router.get("/planteles", requireAuth, requireRol(...ROLES_LECTURA), async (req, res) => {
  try {
    const estado = ["sin_clasificar", "solo", "comparte"].includes(req.query.estado) ? req.query.estado : "";
    const pagina = Math.max(1, parseInt(req.query.pagina, 10) || 1);
    await asegurarSync();
    res.json(await infra.listarPlanteles({ q: limpiar(req.query.q), estado, municipio: limpiar(req.query.municipio), parroquia: limpiar(req.query.parroquia), pagina, limite: 50 }));
  } catch (err) {
    responderError(res, err, "No se pudo cargar la lista de planteles.");
  }
});

router.get("/parroquias", requireAuth, requireRol(...ROLES_LECTURA), async (req, res) => {
  try {
    const municipio = limpiar(req.query.municipio);
    res.json({ parroquias: municipio ? await infra.parroquiasDe(municipio) : [] });
  } catch (err) {
    responderError(res, err, "No se pudo cargar las parroquias.");
  }
});

router.get("/buscar", requireAuth, requireRol(...ROLES_LECTURA), async (req, res) => {
  const q = gescolar.normalizar(req.query.q || "");
  if (q.length < 3) return res.json({ planteles: [] });
  const excluir = limpiar(req.query.excluir).toLowerCase();
  try {
    await asegurarSync();
    const r = await infra.listarPlanteles({ q: req.query.q, limite: 400 });
    const out = r.planteles.filter((p) => p.codigo_dea.toLowerCase() !== excluir).slice(0, 8);
    res.json({ planteles: out });
  } catch (err) {
    responderError(res, err, "No se pudo buscar en GESCOLAR.");
  }
});

router.get("/plantel/:codigo", requireAuth, requireRol(...ROLES_LECTURA), async (req, res) => {
  try {
    const fila = await gescolar.obtenerPlantel(req.params.codigo);
    if (!fila) return res.status(404).json({ error: `El código ${limpiar(req.params.codigo)} no existe en GESCOLAR.` });
    const codigo = limpiar(fila[gescolar.CAMPO_CODIGO]);
    await asegurarSync();
    const { rows } = await pool.query(
      `SELECT i.id, i.codigo, i.codigo_anterior FROM infra_miembros m JOIN infraestructuras i ON i.id = m.infraestructura_id WHERE lower(m.codigo_dea) = lower($1)`, [codigo]);
    let edificio = null;
    if (rows[0]) {
      const { edificios } = await infra.obtenerEdificios();
      edificio = edificios.find((e) => e.codigo_infraestructura === rows[0].codigo) || null;
    }
    const espacios = await infra.espaciosDe(codigo, rows[0] ? rows[0].codigo : "");
    res.json({
      espacios,
      codigo_dea: codigo,
      nombre_plantel: limpiar(fila.nombre_plantel),
      municipio: limpiar(fila.municipio),
      parroquia: limpiar(fila.parroquia),
      denominacion: limpiar(fila.denominacion),
      direccion: limpiar(fila.direccion),
      director: limpiar(fila.director_nombre),
      edificio,
    });
  } catch (err) {
    responderError(res, err, "No se pudo consultar el plantel.");
  }
});

router.post("/clasificar", requireAuth, requireRol(...ROLES_ESCRIBE), async (req, res) => {
  const b = req.body || {};
  const comparte = b.comparte === true;
  try {
    const fila = await gescolar.obtenerPlantel(b.codigo_dea);
    if (!fila) return res.status(404).json({ error: `El código ${limpiar(b.codigo_dea)} no existe en GESCOLAR.` });
    const codigo = limpiar(fila[gescolar.CAMPO_CODIGO]);

    let espacios = null;
    if (b.espacios !== undefined) {
      const v = infra.validarEspacios(b.espacios);
      if (v.error) return res.status(400).json({ error: v.error });
      espacios = v.espacios;
    }

    const otras = [];
    if (comparte) {
      const lista = Array.isArray(b.otras) ? b.otras.slice(0, 10) : [];
      for (const o of lista) {
        const c = limpiar(o && o.codigo_dea);
        const n = limpiar(o && o.nombre).slice(0, 150);
        if (c) {
          if (!/^[A-Za-z0-9]{6,15}$/.test(c)) return res.status(400).json({ error: `Código no válido: ${c}.` });
          if (c.toLowerCase() === codigo.toLowerCase()) continue;
          const f = await gescolar.obtenerPlantel(c);
          if (!f) return res.status(400).json({ error: `El código ${c} no existe en GESCOLAR. Si la institución no tiene código, deja el código vacío y escribe solo el nombre.` });
          otras.push({ codigo_dea: limpiar(f[gescolar.CAMPO_CODIGO]), nombre: limpiar(f.nombre_plantel) });
        } else if (n) {
          otras.push({ codigo_dea: "", nombre: n });
        }
      }
      if (!otras.length) return res.status(400).json({ error: "Agrega al menos una institución con la que comparte el edificio." });
    }

    const resultado = await infra.clasificar({ codigo_dea: codigo, nombre: limpiar(fila.nombre_plantel), comparte, otras, usuarioId: req.usuario.id });
    if (espacios) {
      try {
        await infra.guardarEspacios(codigo, espacios, req.usuario.id);
      } catch (e) {
        console.error("Infraestructuras: no se pudieron guardar los espacios:", e);
        return res.status(500).json({ error: "La clasificación se guardó, pero no se pudieron guardar los espacios separados. Intenta de nuevo." });
      }
    }
    const u = await pool.query("SELECT nombre FROM usuarios WHERE id = $1", [req.usuario.id]);
    const hoja = await infra.sincronizarHoja(resultado, (u.rows[0] && u.rows[0].nombre) || "");
    const { edificios } = await infra.obtenerEdificios();
    res.json({
      ok: true,
      codigo_infraestructura: resultado.infra.codigo,
      comparte: resultado.comparte,
      edificio: edificios.find((e) => e.codigo_infraestructura === resultado.infra.codigo) || null,
      hoja_coordenadas: hoja,
      espacios: await infra.espaciosDe(codigo, resultado.infra.codigo),
    });
  } catch (err) {
    responderError(res, err, "No se pudo guardar la clasificación.");
  }
});

// Posibles edificios compartidos por el patrón del código (D diurno + N nocturno con el mismo número).
router.get("/sugerencias", requireAuth, requireRol(...ROLES_LECTURA), async (req, res) => {
  try {
    await asegurarSync();
    res.json({ ...(await infra.sugerenciasPorCodigo()), puede_escribir: ROLES_ESCRIBE.includes(req.usuario.rol) });
  } catch (err) {
    responderError(res, err, "No se pudieron calcular las sugerencias.");
  }
});

const CLAVE_SUGERENCIA = /^S\d{4}-\d{4}$/;
router.post("/sugerencias/descartar", requireAuth, requireRol(...ROLES_ESCRIBE), async (req, res) => {
  const b = req.body || {};
  const clave = limpiar(b.clave).toUpperCase();
  const a = limpiar(b.codigo_a), c = limpiar(b.codigo_b);
  if (!CLAVE_SUGERENCIA.test(clave) || !a || !c) return res.status(400).json({ error: "Pareja no válida." });
  try {
    await pool.query(
      `INSERT INTO infra_sugerencias_descartadas (clave, codigo_a, codigo_b, descartado_por) VALUES ($1::text, $2::text, $3::text, $4::int)
       ON CONFLICT (clave) DO UPDATE SET descartado_por = EXCLUDED.descartado_por, descartado_en = NOW()`, [clave, a, c, req.usuario.id]);
    res.json({ ok: true });
  } catch (err) {
    if (err.code === "42P01") return res.status(503).json({ error: "Falta ejecutar el script 31 en Supabase." });
    responderError(res, err, "No se pudo descartar la sugerencia.");
  }
});

router.post("/sugerencias/restaurar", requireAuth, requireRol(...ROLES_ESCRIBE), async (req, res) => {
  const clave = limpiar((req.body || {}).clave).toUpperCase();
  if (!CLAVE_SUGERENCIA.test(clave)) return res.status(400).json({ error: "Pareja no válida." });
  try {
    await pool.query("DELETE FROM infra_sugerencias_descartadas WHERE clave = $1", [clave]);
    res.json({ ok: true });
  } catch (err) {
    if (err.code === "42P01") return res.status(503).json({ error: "Falta ejecutar el script 31 en Supabase." });
    responderError(res, err, "No se pudo restaurar la sugerencia.");
  }
});

router.post("/sincronizar", requireAuth, requireRol(...ROLES_GESTION), async (req, res) => {
  try {
    const s = await infra.sincronizar({ forzar: true });
    res.json({ ok: true, hoja_ok: s.hoja_ok, resumen: await infra.resumen() });
  } catch (err) {
    responderError(res, err, "No se pudo sincronizar con la hoja.");
  }
});

module.exports = router;
