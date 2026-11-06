/**
 * Self-contained ISO/IEC 18004 QR Code SVG Generator (Byte Mode, Error Correction Level L)
 * Supports URLs up to 154 bytes (Versions 1 to 7) with zero external dependencies.
 */

// Version capacities for EC Level L: [totalCodewords, ecCodewordsPerBlock, numBlocks]
const VERSION_INFO = [
  null,
  [26, 7, 1],   // v1: up to 17 bytes
  [44, 10, 1],  // v2: up to 32 bytes
  [70, 15, 1],  // v3: up to 53 bytes
  [100, 20, 1], // v4: up to 78 bytes
  [134, 26, 1], // v5: up to 106 bytes
  [172, 18, 2], // v6: up to 134 bytes
  [196, 20, 2], // v7: up to 154 bytes
];

const ALIGNMENT_POSITIONS = [
  [],
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
];

// GF(256) log/exp tables for Reed-Solomon
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
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(degree) {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    const factor = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], factor);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data, ecLen) {
  const gen = rsGeneratorPoly(ecLen);
  const msg = new Uint8Array(data.length + ecLen);
  msg.set(data, 0);
  for (let i = 0; i < data.length; i++) {
    const coef = msg[i];
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) {
        msg[i + j] ^= gfMul(gen[j], coef);
      }
    }
  }
  return msg.slice(data.length);
}

function selectVersion(byteLen) {
  for (let v = 1; v <= 7; v++) {
    const [totalCw, ecCw, blocks] = VERSION_INFO[v];
    const dataCw = totalCw - ecCw * blocks;
    if (byteLen + 2 <= dataCw) return v;
  }
  return 7;
}

function encodeDataCodewords(text) {
  const utf8 = Buffer.from(text, 'utf8');
  const version = selectVersion(utf8.length);
  const [totalCw, ecCw, blocks] = VERSION_INFO[version];
  const totalDataCw = totalCw - ecCw * blocks;

  const bits = [];
  const pushBits = (val, len) => {
    for (let i = len - 1; i >= 0; i--) {
      bits.push((val >>> i) & 1);
    }
  };

  // Byte mode indicator (0100) + 8-bit length
  pushBits(0b0100, 4);
  pushBits(utf8.length, 8);
  for (const b of utf8) pushBits(b, 8);

  // Terminator (up to 4 zeros)
  const maxBits = totalDataCw * 8;
  for (let i = 0; i < 4 && bits.length < maxBits; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const dataBytes = new Uint8Array(totalDataCw);
  const byteCount = Math.min(totalDataCw, bits.length / 8);
  for (let i = 0; i < byteCount; i++) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i * 8 + j];
    dataBytes[i] = b;
  }

  const pads = [0xec, 0x11];
  for (let i = byteCount; i < totalDataCw; i++) {
    dataBytes[i] = pads[(i - byteCount) % 2];
  }

  // Split into blocks and compute Reed-Solomon EC
  const blockDataLen = totalDataCw / blocks;
  const dataBlocks = [];
  const ecBlocks = [];
  for (let b = 0; b < blocks; b++) {
    const slice = dataBytes.slice(b * blockDataLen, (b + 1) * blockDataLen);
    dataBlocks.push(slice);
    ecBlocks.push(rsEncode(slice, ecCw));
  }

  const finalCodewords = [];
  for (let i = 0; i < blockDataLen; i++) {
    for (let b = 0; b < blocks; b++) finalCodewords.push(dataBlocks[b][i]);
  }
  for (let i = 0; i < ecCw; i++) {
    for (let b = 0; b < blocks; b++) finalCodewords.push(ecBlocks[b][i]);
  }

  return { version, codewords: finalCodewords };
}

function buildMatrix(version, codewords) {
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Uint8Array(size));
  const isFunction = Array.from({ length: size }, () => new Uint8Array(size));

  const setFunctionModule = (r, c, dark) => {
    if (r >= 0 && r < size && c >= 0 && c < size) {
      modules[r][c] = dark ? 1 : 0;
      isFunction[r][c] = 1;
    }
  };

  // Finder patterns + separators
  const drawFinder = (r0, c0) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = r0 + dr;
        const c = c0 + dc;
        const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const inRing = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const inCenter = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        setFunctionModule(r, c, inOuter && (inRing || inCenter));
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    setFunctionModule(6, i, i % 2 === 0);
    setFunctionModule(i, 6, i % 2 === 0);
  }

  // Alignment patterns
  const alignPos = ALIGNMENT_POSITIONS[version];
  for (const r0 of alignPos) {
    for (const c0 of alignPos) {
      if (
        (r0 === 6 && c0 === 6) ||
        (r0 === 6 && c0 === size - 7) ||
        (r0 === size - 7 && c0 === 6)
      ) {
        continue;
      }
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          setFunctionModule(r0 + dr, c0 + dc, dark);
        }
      }
    }
  }

  // Reserve format information areas + dark module
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      isFunction[8][i] = 1;
      isFunction[i][8] = 1;
    }
  }
  for (let i = 0; i < 8; i++) {
    isFunction[8][size - 1 - i] = 1;
    isFunction[size - 1 - i][8] = 1;
  }
  setFunctionModule(size - 8, 8, true);

  // Place data bits in zigzag
  const allBits = [];
  for (const cw of codewords) {
    for (let i = 7; i >= 0; i--) allBits.push((cw >>> i) & 1);
  }

  let bitIdx = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      const r = upward ? size - 1 - vert : vert;
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        if (!isFunction[r][c]) {
          const bit = bitIdx < allBits.length ? allBits[bitIdx++] : 0;
          // Mask pattern 0: (r + c) % 2 === 0
          const masked = bit ^ ((r + c) % 2 === 0 ? 1 : 0);
          modules[r][c] = masked;
        }
      }
    }
    upward = !upward;
  }

  // Format information for EC Level L (01) and Mask 0 (000) -> 0x77c4 (bit 14 MSB .. bit 0 LSB)
  const formatBits = 0x77c4;
  const getFormatBit = (bitIndex) => ((formatBits >>> bitIndex) & 1) === 1;

  // Top-left format info: bit 0 at (0,8) down to bit 14 at (8,0)
  for (let i = 0; i <= 5; i++) setFunctionModule(i, 8, getFormatBit(i));
  setFunctionModule(7, 8, getFormatBit(6));
  setFunctionModule(8, 8, getFormatBit(7));
  setFunctionModule(8, 7, getFormatBit(8));
  for (let i = 9; i < 15; i++) setFunctionModule(8, 14 - i, getFormatBit(i));

  // Top-right (bits 0..7) and Bottom-left (bits 8..14)
  for (let i = 0; i < 8; i++) setFunctionModule(8, size - 1 - i, getFormatBit(i));
  for (let i = 8; i < 15; i++) setFunctionModule(size - 15 + i, 8, getFormatBit(i));

  return { size, modules };
}

export function generateQrCodeSvg(text, margin = 2) {
  const { version, codewords } = encodeDataCodewords(text);
  const { size, modules } = buildMatrix(version, codewords);
  const totalSize = size + margin * 2;

  let pathData = '';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (modules[r][c]) {
        pathData += `M${c + margin},${r + margin}h1v1h-1z`;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalSize} ${totalSize}" shape-rendering="crispEdges" class="w-full h-full"><rect width="${totalSize}" height="${totalSize}" fill="#FFFFFF"/><path d="${pathData}" fill="#111111"/></svg>`;
}
