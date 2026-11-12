'use strict';

// Pure-JS ISO/IEC 18004 QR Code Generator (Byte Mode, ECC Level L, Versions 1..6)
// Zero external dependencies; generates crisp SVG & data:image/svg+xml;base64 URLs.

const VERSION_SPECS = [
  null,
  { size: 21, dataBytes: 19, ecBytes: 7, align: [] },
  { size: 25, dataBytes: 34, ecBytes: 10, align: [6, 18] },
  { size: 29, dataBytes: 55, ecBytes: 15, align: [6, 22] },
  { size: 33, dataBytes: 80, ecBytes: 20, align: [6, 26] },
  { size: 37, dataBytes: 108, ecBytes: 26, align: [6, 30] },
  { size: 41, dataBytes: 136, ecBytes: 18, blocks: 2, align: [6, 34] }
];

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(degree) {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    const root = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], root);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data, ecLen) {
  const gen = rsGeneratorPoly(ecLen);
  const rem = new Uint8Array(ecLen);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ rem[0];
    rem.copyWithin(0, 1);
    rem[ecLen - 1] = 0;
    if (factor !== 0) {
      for (let j = 0; j < ecLen; j++) {
        rem[j] ^= gfMul(gen[j + 1], factor);
      }
    }
  }
  return rem;
}

function bchFormatBits(ecLevelBits, maskPattern) {
  const data = ((ecLevelBits & 0x03) << 3) | (maskPattern & 0x07);
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((rem >> i) & 1) rem ^= (0x537 << (i - 10));
  }
  return ((data << 10) | rem) ^ 0x5412;
}

function buildQrMatrix(textInput) {
  const bytes = Buffer.from(String(textInput || ''), 'utf8');
  let ver = 1;
  while (ver <= 5 && bytes.length + 2 > VERSION_SPECS[ver].dataBytes) ver++;
  if (ver > 5) ver = 5;
  const spec = VERSION_SPECS[ver];
  const payload = bytes.length + 2 > spec.dataBytes ? bytes.subarray(0, spec.dataBytes - 2) : bytes;

  const bits = [];
  const pushBits = (val, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1);
  };

  // Byte mode indicator (0100) + 8-bit character count (versions 1..9)
  pushBits(0b0100, 4);
  pushBits(payload.length, 8);
  for (const b of payload) pushBits(b, 8);

  const maxBits = spec.dataBytes * 8;
  const terminator = Math.min(4, maxBits - bits.length);
  pushBits(0, terminator);
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords = new Uint8Array(spec.dataBytes);
  for (let i = 0; i < bits.length / 8; i++) {
    let byte = 0;
    for (let b = 0; b < 8; b++) byte = (byte << 1) | bits[i * 8 + b];
    codewords[i] = byte;
  }
  const padBytes = [0xec, 0x11];
  for (let i = bits.length / 8, p = 0; i < spec.dataBytes; i++, p++) {
    codewords[i] = padBytes[p & 1];
  }

  const ecWords = rsEncode(codewords, spec.ecBytes);
  const fullCodewords = new Uint8Array(spec.dataBytes + spec.ecBytes);
  fullCodewords.set(codewords, 0);
  fullCodewords.set(ecWords, spec.dataBytes);

  const size = spec.size;
  const grid = Array.from({ length: size }, () => Array(size).fill(0));
  const reserved = Array.from({ length: size }, () => new Uint8Array(size));

  const setModule = (r, c, dark, isReserved = true) => {
    if (r < 0 || r >= size || c < 0 || c >= size) return;
    grid[r][c] = dark ? 1 : 0;
    if (isReserved) reserved[r][c] = 1;
  };

  const placeFinder = (row, col) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const inOuter = r >= 0 && r <= 6 && c >= 0 && c <= 6;
        const onBorder = r === 0 || r === 6 || c === 0 || c === 6;
        const inInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        setModule(row + r, col + c, inOuter && (onBorder || inInner), true);
      }
    }
  };

  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    setModule(6, i, i % 2 === 0, true);
    setModule(i, 6, i % 2 === 0, true);
  }

  // Alignment patterns
  if (spec.align.length > 0) {
    for (const ar of spec.align) {
      for (const ac of spec.align) {
        if ((ar <= 8 && ac <= 8) || (ar <= 8 && ac >= size - 8) || (ar >= size - 8 && ac <= 8)) continue;
        for (let r = -2; r <= 2; r++) {
          for (let c = -2; c <= 2; c++) {
            const dark = Math.abs(r) === 2 || Math.abs(c) === 2 || (r === 0 && c === 0);
            setModule(ar + r, ac + c, dark, true);
          }
        }
      }
    }
  }

  // Dark module & reserve format info areas
  setModule(size - 8, 8, true, true);
  for (let i = 0; i < 9; i++) {
    if (!reserved[8][i]) reserved[8][i] = 1;
    if (!reserved[i][8]) reserved[i][8] = 1;
  }
  for (let i = 0; i < 8; i++) {
    if (!reserved[8][size - 1 - i]) reserved[8][size - 1 - i] = 1;
    if (!reserved[size - 1 - i][8]) reserved[size - 1 - i][8] = 1;
  }

  // Convert fullCodewords into bit stream
  const allBits = [];
  for (const cw of fullCodewords) {
    for (let b = 7; b >= 0; b--) allBits.push((cw >> b) & 1);
  }

  // Zigzag upward/downward placement
  let bitIdx = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      const r = upward ? (size - 1 - vert) : vert;
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        if (!reserved[r][c]) {
          const bit = bitIdx < allBits.length ? allBits[bitIdx++] : 0;
          // Mask pattern 0: (r + c) % 2 === 0
          const masked = ((r + c) % 2 === 0) ? (bit ^ 1) : bit;
          grid[r][c] = masked;
        }
      }
    }
    upward = !upward;
  }

  // Place format bits (ECC Level L = 01, Mask = 000)
  const formatBits = bchFormatBits(0b01, 0);
  for (let i = 0; i <= 5; i++) setModule(8, i, ((formatBits >> (14 - i)) & 1) === 1, true);
  setModule(8, 7, ((formatBits >> 8) & 1) === 1, true);
  setModule(8, 8, ((formatBits >> 7) & 1) === 1, true);
  setModule(7, 8, ((formatBits >> 6) & 1) === 1, true);
  for (let i = 0; i < 6; i++) setModule(5 - i, 8, ((formatBits >> (5 - i)) & 1) === 1, true);

  for (let i = 0; i < 8; i++) setModule(8, size - 1 - i, ((formatBits >> i) & 1) === 1, true);
  for (let i = 0; i < 7; i++) setModule(size - 7 + i, 8, ((formatBits >> (14 - i)) & 1) === 1, true);

  return { size, grid };
}

function generateQrSvg(textInput, { margin = 3, pixelSize = 240 } = {}) {
  const { size, grid } = buildQrMatrix(textInput);
  const total = size + margin * 2;
  let pathData = '';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (grid[r][c]) {
        pathData += `M${c + margin},${r + margin}h1v1h-1z`;
      }
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${pixelSize}" height="${pixelSize}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#ffffff" rx="2"/><path d="${pathData}" fill="#090d16"/></svg>`;
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
  return { svg, dataUrl, size };
}

module.exports = { buildQrMatrix, generateQrSvg };
