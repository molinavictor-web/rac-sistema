// Parser de CSV que respeta comillas dobles (RFC4180): un campo entre
// comillas puede contener el delimitador, comillas escapadas ("") y saltos
// de línea reales sin que eso corte la fila -- a diferencia de un split
// crudo por salto de línea, que sí se rompe con esos casos (ver incidente
// 2026-09-12: un archivo real del RAC con celdas con Enter embebido estaba
// generando registros "sin sentido" al cargar).
//
// Se extrajo a este archivo compartido (antes vivía solo dentro de
// racCompleto.js) para que la nueva herramienta "Depurar archivo"
// (src/routes/depurarArchivo.js) analice el archivo exactamente de la
// misma forma que la carga real -- si en el futuro se ajusta el parser,
// se ajusta en un solo lugar para ambos.
function parsearCSV(contenido, delimitador = ';') {
  const filas = [];
  let fila = [];
  let campo = '';
  let dentroDeComillas = false;
  let i = 0;
  const n = contenido.length;

  while (i < n) {
    const c = contenido[i];

    if (dentroDeComillas) {
      if (c === '"') {
        if (contenido[i + 1] === '"') {
          campo += '"';
          i += 2;
          continue;
        }
        dentroDeComillas = false;
        i++;
        continue;
      }
      campo += c;
      i++;
      continue;
    }

    if (c === '"') {
      dentroDeComillas = true;
      i++;
      continue;
    }
    if (c === delimitador) {
      fila.push(campo);
      campo = '';
      i++;
      continue;
    }
    if (c === '\r') {
      // Se ignora aquí -- el fin real de fila lo marca el '\n' que sigue
      // (o, si el archivo trae un '\r' suelto sin '\n', se trata como
      // carácter normal dentro del campo al no matchear nada).
      i++;
      continue;
    }
    if (c === '\n') {
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = '';
      i++;
      continue;
    }

    campo += c;
    i++;
  }

  // Última fila si el archivo no termina con salto de línea.
  if (campo !== '' || fila.length > 0) {
    fila.push(campo);
    filas.push(fila);
  }

  return filas;
}

module.exports = { parsearCSV };
