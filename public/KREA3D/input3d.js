/* Krea3D - fuentes profesionales de altura: heightmap PNG de 16 bits y modelos STL.
   Un canvas del navegador aplasta todo a 8 bits (256 niveles), asi que el PNG de
   16 bits se decodifica a mano (pako para el zlib). El STL se rasteriza visto
   desde arriba (Z hacia arriba) conservando las medidas reales en mm. */
(function (root) {
  "use strict";

  // ------------------------------------------------------------ PNG 16 bits
  /** Devuelve {w, h, data: Float32Array 0..1} si el PNG es de 16 bits, o null si es
      un PNG normal de 8 bits (que se carga como imagen). Lanza Error si esta roto. */
  function decodePng16(buf) {
    const u8 = new Uint8Array(buf);
    const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
    if (u8.length < 8) return null;
    for (let i = 0; i < 8; i++) if (u8[i] !== SIG[i]) return null;
    const dv = new DataView(buf);
    let pos = 8, w = 0, h = 0, bitDepth = 0, colorType = 0, interlace = 0;
    const idat = [];
    while (pos + 8 <= u8.length) {
      const len = dv.getUint32(pos);
      const type = String.fromCharCode(u8[pos + 4], u8[pos + 5], u8[pos + 6], u8[pos + 7]);
      const dataStart = pos + 8;
      if (dataStart + len > u8.length) break;
      if (type === "IHDR") {
        w = dv.getUint32(dataStart); h = dv.getUint32(dataStart + 4);
        bitDepth = u8[dataStart + 8]; colorType = u8[dataStart + 9];
        interlace = u8[dataStart + 12];
      } else if (type === "IDAT") idat.push(u8.subarray(dataStart, dataStart + len));
      else if (type === "IEND") break;
      pos = dataStart + len + 4;
    }
    if (bitDepth !== 16) return null;                       // PNG normal: no es asunto nuestro
    if (![0, 2, 4, 6].includes(colorType)) return null;     // paleta u otros: imposible en 16 bits
    if (interlace !== 0) throw new Error("el PNG de 16 bits está entrelazado (Adam7); guárdalo sin entrelazar.");
    if (!(w > 0 && h > 0)) throw new Error("cabecera PNG no válida.");
    if (w * h > 36e6) throw new Error(`heightmap demasiado grande (${w} × ${h} px); redúcelo a unos 6000 px de lado.`);
    if (!root.pako) throw new Error("no se pudo cargar el descompresor (pako); revisa la conexión.");
    let total = 0; for (const c of idat) total += c.length;
    const comp = new Uint8Array(total);
    { let o = 0; for (const c of idat) { comp.set(c, o); o += c.length; } }
    const raw = root.pako.inflate(comp);
    const ch = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : 4;
    const bpp = ch * 2, stride = w * bpp;
    if (raw.length < h * (stride + 1)) throw new Error("el PNG de 16 bits está incompleto.");
    const data = new Float32Array(w * h);
    let prev = null, p = 0;
    let line = new Uint8Array(stride);
    for (let y = 0; y < h; y++) {
      const filter = raw[p++];
      for (let x = 0; x < stride; x++) {
        const rv = raw[p + x];
        const a = x >= bpp ? line[x - bpp] : 0;
        const b = prev ? prev[x] : 0;
        const c = prev && x >= bpp ? prev[x - bpp] : 0;
        let v;
        if (filter === 0) v = rv;
        else if (filter === 1) v = rv + a;
        else if (filter === 2) v = rv + b;
        else if (filter === 3) v = rv + ((a + b) >> 1);
        else if (filter === 4) {
          const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
          v = rv + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
        } else throw new Error("filtro PNG desconocido (" + filter + ").");
        line[x] = v & 255;
      }
      p += stride;
      for (let x = 0; x < w; x++) {
        const o = x * bpp;
        let v16;
        if (ch >= 3) {
          const r = (line[o] << 8) | line[o + 1], g = (line[o + 2] << 8) | line[o + 3], b2 = (line[o + 4] << 8) | line[o + 5];
          v16 = 0.2126 * r + 0.7152 * g + 0.0722 * b2;
        } else v16 = (line[o] << 8) | line[o + 1];
        data[y * w + x] = v16 / 65535;
      }
      const t = prev || new Uint8Array(stride);
      prev = line; line = t;                               // intercambio sin asignar memoria nueva
    }
    return { w, h, data };
  }

  // ------------------------------------------------------------ STL
  /** Triangulos del STL (binario o ASCII) como Float32Array de 9*n (xyz de los 3 vertices). */
  function parseStl(buf) {
    const u8 = new Uint8Array(buf);
    if (u8.length >= 84) {
      const n = new DataView(buf).getUint32(80, true);
      if (84 + n * 50 === u8.length) {                     // binario: cuadra el tamano exacto
        if (n > 8e6) throw new Error(`el STL tiene ${n.toLocaleString("es")} caras; demasiadas (máximo 8 millones).`);
        const dv = new DataView(buf);
        const tris = new Float32Array(n * 9);
        for (let i = 0; i < n; i++) {
          const o = 84 + i * 50 + 12;                      // se salta la normal
          for (let k = 0; k < 9; k++) tris[i * 9 + k] = dv.getFloat32(o + k * 4, true);
        }
        return tris;
      }
    }
    const txt = new TextDecoder().decode(u8);
    if (!/^\s*solid/i.test(txt)) throw new Error("no parece un STL válido (ni binario ni ASCII).");
    const nums = [];
    const re = /vertex\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)/g;
    let m;
    while ((m = re.exec(txt))) nums.push(+m[1], +m[2], +m[3]);
    if (!nums.length || nums.length % 9) throw new Error("STL ASCII incompleto.");
    return Float32Array.from(nums);
  }

  /** Rasteriza el STL visto desde ARRIBA (Z hacia arriba): en cada celda queda la Z mas alta.
      Devuelve {w, h, data: Float32Array 0..1 (fila 0 = arriba), sizeX, sizeY, sizeZ} en mm. */
  function rasterizeStl(tris, maxSide) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < tris.length; i += 3) {
      const x = tris[i], y = tris[i + 1], z = tris[i + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    const sx = maxX - minX, sy = maxY - minY, sz = maxZ - minZ;
    if (!(sx > 0 && sy > 0)) throw new Error("el modelo no tiene extensión en XY visto desde arriba.");
    const w = sx >= sy ? maxSide : Math.max(2, Math.round(maxSide * sx / sy));
    const h = sx >= sy ? Math.max(2, Math.round(maxSide * sy / sx)) : maxSide;
    const acc = new Float32Array(w * h).fill(-Infinity);
    const X = (x) => (x - minX) / sx * (w - 1);
    const Y = (y) => (maxY - y) / sy * (h - 1);            // fila 0 = arriba (Y mayor)
    for (let t = 0; t < tris.length; t += 9) {
      const x1 = X(tris[t]), y1 = Y(tris[t + 1]), z1 = tris[t + 2];
      const x2 = X(tris[t + 3]), y2 = Y(tris[t + 4]), z2 = tris[t + 5];
      const x3 = X(tris[t + 6]), y3 = Y(tris[t + 7]), z3 = tris[t + 8];
      const den = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3);
      if (Math.abs(den) < 1e-12) continue;                 // cara vertical: no aporta vista superior
      const xa = Math.max(0, Math.ceil(Math.min(x1, x2, x3) - 1e-9));
      const xb = Math.min(w - 1, Math.floor(Math.max(x1, x2, x3) + 1e-9));
      const ya = Math.max(0, Math.ceil(Math.min(y1, y2, y3) - 1e-9));
      const yb = Math.min(h - 1, Math.floor(Math.max(y1, y2, y3) + 1e-9));
      for (let py = ya; py <= yb; py++) {
        for (let px = xa; px <= xb; px++) {
          const l1 = ((y2 - y3) * (px - x3) + (x3 - x2) * (py - y3)) / den;
          if (l1 < -1e-9) continue;
          const l2 = ((y3 - y1) * (px - x3) + (x1 - x3) * (py - y3)) / den;
          if (l2 < -1e-9) continue;
          const l3 = 1 - l1 - l2;
          if (l3 < -1e-9) continue;
          const z = l1 * z1 + l2 * z2 + l3 * z3;
          const o = py * w + px;
          if (z > acc[o]) acc[o] = z;
        }
      }
    }
    const data = new Float32Array(w * h);
    const dz = sz > 0 ? sz : 1;
    for (let i = 0; i < acc.length; i++) data[i] = acc[i] === -Infinity ? 0 : (acc[i] - minZ) / dz;
    return { w, h, data, sizeX: sx, sizeY: sy, sizeZ: sz };
  }

  // ------------------------------------------------------------ remuestreo
  /** Remuestrea un campo de alturas {w,h,data} a w2×h2 promediando el area cubierta
      (sin pasar por canvas: no se pierde la precision de 16 bits). */
  function resample(src, w2, h2) {
    const sw = src.w, sh = src.h, d = src.data;
    if (sw === w2 && sh === h2) return Float32Array.from(d);
    const out = new Float32Array(w2 * h2);
    for (let y = 0; y < h2; y++) {
      const y0 = y * sh / h2, y1 = (y + 1) * sh / h2;
      const b0 = Math.floor(y0), b1 = Math.min(sh - 1, Math.ceil(y1) - 1);
      for (let x = 0; x < w2; x++) {
        const x0 = x * sw / w2, x1 = (x + 1) * sw / w2;
        const a0 = Math.floor(x0), a1 = Math.min(sw - 1, Math.ceil(x1) - 1);
        let s = 0, wt = 0;
        for (let b = b0; b <= b1; b++) {
          const fy = Math.min(b + 1, y1) - Math.max(b, y0);
          if (fy <= 0) continue;
          const o = b * sw;
          for (let a = a0; a <= a1; a++) {
            const fx = Math.min(a + 1, x1) - Math.max(a, x0);
            if (fx <= 0) continue;
            s += d[o + a] * fx * fy; wt += fx * fy;
          }
        }
        out[y * w2 + x] = wt > 0 ? s / wt : 0;
      }
    }
    return out;
  }

  root.KreaInput = { decodePng16, parseStl, rasterizeStl, resample };
})(typeof self !== "undefined" ? self : this);
