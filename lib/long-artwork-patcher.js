'use strict';

/**
 * MOTOR 4 — PARCHEADOR BINARIO DUAL DE VITRINAS (`IHDR` ALTO INFINITO + `0x21` WORKSHOP)
 * =======================================================================================
 * 1. `patchPngForInfiniteHeight(pngBuffer, targetHeight)`:
 *    Modifica los 4 bytes Big-Endian de altura en el chunk `IHDR` de un archivo PNG
 *    para habilitar obras de arte verticales de alto infinito en el perfil de Steam.
 *
 * 2. `patchWorkshopHex21(fileBuffer)`:
 *    Sobrescribe el último byte de cualquier archivo GIF o PNG con `0x21` (`!`),
 *    activando el bug del Expositor de Workshop de 5 columnas sin ícono de juego.
 *
 * 3. `patchDualArtworkAndWorkshop(fileBuffer, options)`:
 *    Aplica ambos parches binarios según el formato y modo elegido.
 */
function patchPngForInfiniteHeight(pngBuffer, targetHeight = 3840, options = {}) {
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

  if (options.appendWorkshopHex21) {
    patched[patched.length - 1] = 0x21;
  }

  return {
    success: true,
    originalHeight: currentHeight,
    patchedHeight: newHeight,
    workshopHex21Applied: Boolean(options.appendWorkshopHex21),
    patchedBuffer: patched,
    message: options.appendWorkshopHex21
      ? 'PNG parcheado con éxito con el exploit IHDR de longitud infinita + byte final 0x21 de Workshop.'
      : 'PNG parcheado con éxito con el exploit IHDR de longitud infinita para Steam.'
  };
}

function patchWorkshopHex21(fileBuffer) {
  if (!Buffer.isBuffer(fileBuffer) || fileBuffer.length < 4) {
    throw new Error('Se requiere un Buffer binario válido (GIF o PNG) para aplicar el parche 0x21.');
  }
  const patched = Buffer.from(fileBuffer);
  const previousLastByte = patched[patched.length - 1];
  patched[patched.length - 1] = 0x21;
  return {
    success: true,
    previousLastByte,
    newLastByte: 0x21,
    patchedBuffer: patched,
    message: `Parche binario 0x21 aplicado en el último byte (0x${previousLastByte.toString(16).padStart(2, '0')} → 0x21) para Vitrina de Workshop de 5 columnas.`
  };
}

module.exports = { patchPngForInfiniteHeight, patchWorkshopHex21 };
