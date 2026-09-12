const express = require('express');
const multer = require('multer');
const iconv = require('iconv-lite');
const router = express.Router();

const { requireAuth, requireRol } = require('../middleware/auth');
const { parsearCSV } = require('../utils/csv');

const upload = multer({ storage: multer.memoryStorage() });

// Colapsa cualquier espacio en blanco interno (incluyendo saltos de línea
// embebidos) a un solo espacio y recorta los extremos. Misma idea que
// limpiar() en racCompleto.js, pero sin la semántica de "vacío -> null":
// acá se está regenerando un archivo de texto para descargar, no un
// registro para la base de datos.
function limpiarCelda(valor) {
  return valor.replace(/\s+/g, ' ').trim();
}

// POST /api/rac/depurar-archivo  (solo admin)
// Herramienta de depuración PRE-carga (2026-09-12): analiza el archivo del
// RAC (mismo delimitador ';' y encoding latin1 que usa /cargar-completo,
// vía el mismo parsearCSV compartido) y cuenta dos defectos típicos de un
// archivo armado a mano en Excel:
//   - celdas con espacio/tab sobrante al inicio o al final del valor
//   - celdas con un salto de línea (Enter) embebido dentro del valor
// NO toca la base de datos. Devuelve el conteo y el archivo ya limpio
// (mismo formato ; / latin1 / CRLF), codificado en base64, para que el
// usuario lo descargue y lo use en "Cargar RAC completo" en vez del
// original. Pensada también como pieza de demostración: hace visible con
// números concretos cuántos defectos trae un archivo manejado sin
// automatización.
router.post(
  '/depurar-archivo',
  requireAuth,
  requireRol('admin'),
  upload.single('archivo'),
  (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No se envió ningún archivo' });
    }

    try {
      const contenido = iconv.decode(req.file.buffer, 'latin1');
      const filas = parsearCSV(contenido, ';').filter(
        (cols) => !(cols.length === 1 && (cols[0] === undefined || cols[0].trim() === ''))
      );

      if (filas.length < 2) {
        return res.status(400).json({ error: 'El archivo está vacío o no tiene filas de datos' });
      }

      let celdasConEspacioCosmetico = 0;
      let celdasConSaltoDeLinea = 0;
      let totalCeldas = 0;

      const filasLimpias = filas.map((fila, i) => {
        if (i === 0) return fila; // encabezado se deja tal cual
        return fila.map((valorCrudo) => {
          const original = valorCrudo ?? '';
          totalCeldas++;
          if (/[\r\n]/.test(original)) celdasConSaltoDeLinea++;
          if (original !== original.trim()) celdasConEspacioCosmetico++;
          return limpiarCelda(original);
        });
      });

      const contenidoLimpio =
        filasLimpias.map((fila) => fila.join(';')).join('\r\n') + '\r\n';
      const bufferLimpio = iconv.encode(contenidoLimpio, 'latin1');

      const nombreSugerido = req.file.originalname
        ? req.file.originalname.replace(/(\.[^.]+)?$/, '_limpio$1')
        : 'archivo_limpio.csv';

      res.json({
        filasAnalizadas: filas.length - 1,
        totalCeldas,
        celdasConEspacioCosmetico,
        celdasConSaltoDeLinea,
        archivoLimpioBase64: bufferLimpio.toString('base64'),
        nombreSugerido,
      });
    } catch (err) {
      console.error('Error depurando archivo:', err);
      res.status(500).json({ error: 'Error procesando el archivo' });
    }
  }
);

module.exports = router;
