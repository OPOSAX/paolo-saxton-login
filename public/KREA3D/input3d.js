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
    // Nivelar: muchos modelos generados vienen con la base INCLINADA (un lado alto y el
    // otro bajo); esa pendiente se come el rango de profundidad y satura un lado. Se
    // ajusta el plano medio por minimos cuadrados y se resta.
    {
      let cnt = 0, sxp = 0, syp = 0, szp = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0;
      const stepL = Math.max(1, Math.floor(acc.length / 200000));
      for (let i = 0; i < acc.length; i += stepL) {
        const z = acc[i];
        if (z === -Infinity) continue;
        const x = i % w, y = (i / w) | 0;
        cnt++; sxp += x; syp += y; szp += z;
        sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z;
      }
      if (cnt > 100) {
        // sistema 3x3 para z = a + b*x + c*y (Cramer)
        const A = [[sxx, sxy, sxp], [sxy, syy, syp], [sxp, syp, cnt]];
        const B = [sxz, syz, szp];
        const det3 = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
          - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
          + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
        const D = det3(A);
        if (Math.abs(D) > 1e-9) {
          const col = (k) => det3(A.map((row, r) => row.map((v2, c2) => (c2 === k ? B[r] : v2))));
          const b = col(0) / D, c = col(1) / D;
          for (let i = 0; i < acc.length; i++) {
            if (acc[i] !== -Infinity) acc[i] -= b * (i % w) + c * ((i / w) | 0);
          }
        }
      }
    }
    // Normalizacion por la SUPERFICIE VISIBLE, no por la caja del solido: la base de un
    // modelo solido queda debajo y no debe comerse el rango de profundidad. Percentiles
    // 0.2/99.8 para que una pua o pico suelto tampoco aplaste el relieve.
    const vals = [];
    const step = Math.max(1, Math.floor(acc.length / 400000));
    for (let i = 0; i < acc.length; i += step) if (acc[i] !== -Infinity) vals.push(acc[i]);
    vals.sort((a, b) => a - b);
    let lo = minZ, hi = maxZ;
    if (vals.length) {
      lo = vals[Math.floor(vals.length * 0.002)];
      hi = vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.998))];
    }
    const span = hi - lo > 0 ? hi - lo : 1;
    const data = new Float32Array(w * h);
    for (let i = 0; i < acc.length; i++) {
      data[i] = acc[i] === -Infinity ? 0 : Math.min(1, Math.max(0, (acc[i] - lo) / span));
    }
    return { w, h, data, sizeX: sx, sizeY: sy, sizeZ: hi - lo > 0 ? hi - lo : sz };
  }

  // ------------------------------------------------------------ remuestreo
  /** Remuestrea un campo de alturas {w,h,data} a w2×h2 promediando el area cubierta
      (sin pasar por canvas: no se pierde la precision de 16 bits). */
  function resample(src, w2, h2) {
    const sw = src.w, sh = src.h, d = src.data;
    if (sw === w2 && sh === h2) return Float32Array.from(d);
    const out = new Float32Array(w2 * h2);
    if (w2 >= sw && h2 >= sh) {
      // ampliar: bilineal (el promedio de area saldria en bloques)
      for (let y = 0; y < h2; y++) {
        const fy = (y + 0.5) * sh / h2 - 0.5;
        const b0 = Math.max(0, Math.floor(fy)), b1 = Math.min(sh - 1, b0 + 1);
        const ty = Math.min(1, Math.max(0, fy - b0));
        for (let x = 0; x < w2; x++) {
          const fx = (x + 0.5) * sw / w2 - 0.5;
          const a0 = Math.max(0, Math.floor(fx)), a1 = Math.min(sw - 1, a0 + 1);
          const tx = Math.min(1, Math.max(0, fx - a0));
          const v0 = d[b0 * sw + a0] * (1 - tx) + d[b0 * sw + a1] * tx;
          const v1 = d[b1 * sw + a0] * (1 - tx) + d[b1 * sw + a1] * tx;
          out[y * w2 + x] = v0 * (1 - ty) + v1 * ty;
        }
      }
      return out;
    }
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

  // ------------------------------------------------------------ PNG 16 bits (escritura)
  const CRC_T = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(u8) {
    let c = 0xffffffff;
    for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function chunkPng(type, data) {
    const out = new Uint8Array(8 + data.length + 4);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  }
  /** Campo {w, h, data 0..1} -> Blob PNG de 16 bits en escala de grises (blanco = alto). */
  function encodePng16(field) {
    if (!root.pako) throw new Error("no se pudo cargar el compresor (pako).");
    const { w, h, data } = field;
    const raw = new Uint8Array(h * (1 + w * 2));
    let p = 0;
    for (let y = 0; y < h; y++) {
      raw[p++] = 0;                                        // filtro 0
      for (let x = 0; x < w; x++) {
        const v = Math.max(0, Math.min(65535, Math.round(data[y * w + x] * 65535)));
        raw[p++] = v >> 8; raw[p++] = v & 255;
      }
    }
    const ihdr = new Uint8Array(13);
    const dv = new DataView(ihdr.buffer);
    dv.setUint32(0, w); dv.setUint32(4, h);
    ihdr[8] = 16; ihdr[9] = 0;                             // 16 bits, escala de grises
    return new Blob([
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      chunkPng("IHDR", ihdr),
      chunkPng("IDAT", root.pako.deflate(raw, { level: 9 })),
      chunkPng("IEND", new Uint8Array(0)),
    ], { type: "image/png" });
  }

  // ------------------------------------------------------------ STL (escritura)
  /** Campo {w, h, data} con alturas en mm (fila 0 = arriba) -> Blob STL binario SOLIDO:
      superficie + paredes + base en Z0, listo para abrir en Blender, Aspire, etc.
      sx, sy: medidas del mural en mm. zOff se suma a cada altura (para llevar -prof..0 a 0..prof). */
  function encodeStl(field, sx, sy, zOff, maxSide) {
    maxSide = maxSide || 500;
    let w = field.w, h = field.h, data = field.data;
    if (Math.max(w, h) > maxSide) {
      const w2 = w >= h ? maxSide : Math.max(2, Math.round(maxSide * w / h));
      const h2 = w >= h ? Math.max(2, Math.round(maxSide * h / w)) : maxSide;
      data = resample({ w, h, data }, w2, h2); w = w2; h = h2;
    }
    const Z = (i, j) => data[j * w + i] + zOff;
    const X = (i) => i / (w - 1) * sx, Y = (j) => sy - j / (h - 1) * sy;   // fila 0 = arriba = Y maxima
    const nt = 2 * (w - 1) * (h - 1) + 4 * (w - 1 + h - 1) + 2;
    const buf = new ArrayBuffer(84 + nt * 50);
    const dv = new DataView(buf);
    const head = "Krea3D relieve";
    for (let i = 0; i < head.length; i++) dv.setUint8(i, head.charCodeAt(i));
    dv.setUint32(80, nt, true);
    let o = 84;
    function tri(ax, ay, az, bx, by, bz, cx, cy, cz) {
      const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      dv.setFloat32(o, nx / l, true); dv.setFloat32(o + 4, ny / l, true); dv.setFloat32(o + 8, nz / l, true);
      const vs = [ax, ay, az, bx, by, bz, cx, cy, cz];
      for (let k = 0; k < 9; k++) dv.setFloat32(o + 12 + k * 4, vs[k], true);
      o += 50;
    }
    // superficie (normales hacia +Z)
    for (let j = 0; j < h - 1; j++) for (let i = 0; i < w - 1; i++) {
      tri(X(i), Y(j), Z(i, j), X(i), Y(j + 1), Z(i, j + 1), X(i + 1), Y(j + 1), Z(i + 1, j + 1));
      tri(X(i), Y(j), Z(i, j), X(i + 1), Y(j + 1), Z(i + 1, j + 1), X(i + 1), Y(j), Z(i + 1, j));
    }
    // paredes: perimetro antihorario visto desde arriba; P0->P1 arriba, Q0/Q1 abajo (Z0)
    const wall = (x0, y0, z0, x1, y1, z1) => {
      tri(x0, y0, z0, x0, y0, 0, x1, y1, 0);
      tri(x0, y0, z0, x1, y1, 0, x1, y1, z1);
    };
    for (let i = 0; i < w - 1; i++) wall(X(i), 0, Z(i, h - 1), X(i + 1), 0, Z(i + 1, h - 1));           // borde Y=0, hacia +X
    for (let j = h - 1; j > 0; j--) wall(sx, Y(j), Z(w - 1, j), sx, Y(j - 1), Z(w - 1, j - 1));        // borde X=sx, hacia +Y
    for (let i = w - 1; i > 0; i--) wall(X(i), sy, Z(i, 0), X(i - 1), sy, Z(i - 1, 0));                // borde Y=sy, hacia -X
    for (let j = 0; j < h - 1; j++) wall(0, Y(j), Z(0, j), 0, Y(j + 1), Z(0, j + 1));                  // borde X=0, hacia -Y
    // base (normal hacia -Z)
    tri(0, 0, 0, 0, sy, 0, sx, sy, 0);
    tri(0, 0, 0, sx, sy, 0, sx, 0, 0);
    return new Blob([buf], { type: "model/stl" });
  }

  root.KreaInput = { decodePng16, parseStl, rasterizeStl, resample, encodePng16, encodeStl };
})(typeof self !== "undefined" ? self : this);
