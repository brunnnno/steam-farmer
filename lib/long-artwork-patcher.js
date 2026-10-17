'use strict';

/**
 * Inyecta el parche binario en el encabezado IHDR del PNG para habilitar vitrina vertical infinita en Steam
 */
function patchPngForInfiniteHeight(pngBuffer, targetHeight = 3840) {
  if (!Buffer.isBuffer(pngBuffer)) throw new Error('Se requiere un Buffer binario de imagen PNG.');

  // Validar firma mágica de PNG: 89 50 4E 47 0D 0A 1A 0A
  const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (pngBuffer.length < 24 || !pngBuffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('El archivo no es una imagen PNG válida.');
  }

  // Clonar buffer para no mutar el original
  const patched = Buffer.from(pngBuffer);

  // Buscar bloque IHDR (suele empezar en el byte 12)
  const ihdrOffset = patched.indexOf(Buffer.from('IHDR', 'ascii'));
  if (ihdrOffset === -1 || ihdrOffset + 12 > patched.length) {
    throw new Error('Encabezado IHDR no encontrado en el PNG.');
  }

  // Los bytes de altura están 8 bytes después de 'IHDR' (ancho = 4 bytes, alto = 4 bytes)
  const heightOffset = ihdrOffset + 8;

  const currentHeight = patched.readUInt32BE(heightOffset);
  const newHeight = Math.max(currentHeight, Number(targetHeight) || 3840);
  console.log(`[ArtworkPatcher] Altura original: ${currentHeight}px. Inyectando parche vertical extendido (${newHeight}px).`);

  // Inyectar altura extendida
  patched.writeUInt32BE(newHeight, heightOffset);

  return {
    success: true,
    originalHeight: currentHeight,
    patchedHeight: newHeight,
    patchedBuffer: patched,
    message: 'PNG parcheado con éxito con el exploit IHDR de longitud infinita para Steam.'
  };
}

module.exports = { patchPngForInfiniteHeight };
