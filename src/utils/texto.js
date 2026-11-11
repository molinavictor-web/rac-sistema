// Lectura de archivos CSV con acentos correctos (2026-11-11).
//
// Antes todas las cargas leían el archivo como latin1 (ANSI). Pero algunos
// archivos (planteles de GESCOLAR, nómina del Ministerio) vienen en UTF-8:
// leídos como latin1, cada letra acentuada se convierte en dos caracteres
// raros ("GARCÍA" -> "GARCÃ\u008dA", "NUÑEZ" -> "NUÃ±EZ").
//
// decodificarArchivo: si el archivo es UTF-8 válido se lee como UTF-8; si no,
// como latin1 (el formato de siempre). Un archivo latin1 con acentos casi
// nunca es UTF-8 válido, así que la detección es confiable.
//
// repararTexto: arregla los pares raros que ya vengan dentro del propio
// archivo (cuando el que lo exportó ya lo había dañado). Solo toca la
// combinación Ã/Â + carácter de continuación, que nunca aparece en un texto
// en español normal.

const decodificadorUtf8 = new TextDecoder("utf-8", { fatal: true });

function repararTexto(texto) {
  if (typeof texto !== "string" || !/[ÂÃ]/.test(texto)) return texto;
  return texto
    .replace(/Ã([\u0080-¿])/g, (_, c) => String.fromCharCode(c.charCodeAt(0) + 0x40))
    .replace(/Â([\u0080-¿])/g, "$1")
    .replace(/ /g, " ");
}

function decodificarArchivo(buffer) {
  let texto;
  try {
    texto = decodificadorUtf8.decode(buffer);
  } catch (_) {
    texto = buffer.toString("latin1");
  }
  if (texto.charCodeAt(0) === 0xfeff) texto = texto.slice(1); // marca BOM de Excel
  return repararTexto(texto);
}

module.exports = { decodificarArchivo, repararTexto };
