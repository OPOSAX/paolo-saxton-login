/* Krea3D - nucleo de calculo: imagen -> relieve -> trayectorias -> G-code.
   Se usa en el navegador (pagina y worker) y en Node (pruebas). Sin dependencias. */
(function (root) {
  "use strict";

  // ------------------------------------------------------------ imagen -> alturas
  function boxBlur(a, w, h, r) {
    if (r < 1) return a;
    const tmp = new Float32Array(a.length), out = new Float32Array(a.length);
    const k = 2 * r + 1;
    for (let y = 0; y < h; y++) {               // horizontal
      const o = y * w; let s = 0;
      for (let x = -r; x <= r; x++) s += a[o + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[o + x] = s / k;
        s += a[o + Math.min(w - 1, x + r + 1)] - a[o + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {               // vertical
      let s = 0;
      for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = s / k;
        s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
    }
    return out;
  }

  /** lum: Float32Array 0..1 (0 = negro). Devuelve Z en mm (0 = cara del tablero, negativo = tallado). */
  function prepHeight(lum, w, h, res, p) {
    let v = new Float32Array(lum.length);
    const bp = p.blackPoint || 0, wp = p.whitePoint == null ? 1 : p.whitePoint;
    const g = p.gamma || 1;
    for (let i = 0; i < lum.length; i++) {
      let t = (lum[i] - bp) / Math.max(1e-6, wp - bp);
      t = Math.min(1, Math.max(0, t));
      if (p.darkHigh) t = 1 - t;               // oscuro = alto
      v[i] = Math.pow(t, g);
    }
    // realce del relieve (unsharp de alturas): amplifica las formas locales
    // (caras, pliegues, musculos) sin cambiar la profundidad total
    const boost = p.boost || 0;
    if (boost > 0) {
      const rb = Math.max(1, Math.round(12 / res));
      let base = boxBlur(v, w, h, rb);
      base = boxBlur(base, w, h, rb);
      const out = new Float32Array(v.length);
      for (let i = 0; i < v.length; i++) {
        const t = v[i] + boost * (v[i] - base[i]);
        out[i] = t < 0 ? 0 : t > 1 ? 1 : t;
      }
      v = out;
    }
    const r = Math.round((p.smoothMm || 0) / res);
    if (r >= 1) { v = boxBlur(v, w, h, r); v = boxBlur(v, w, h, r); }
    const H = new Float32Array(v.length);
    for (let i = 0; i < v.length; i++) H[i] = -p.depth * (1 - v[i]);
    return H;
  }


  // ------------------------------------------------------------ herramienta
  /**
   * Modelo de la fresa. prof(d) = cuanto sube la superficie de la fresa respecto a la punta a una
   * distancia horizontal d del eje (d < r). fprime da la derivada de f(q) = Hpix - prof(d(q)) a lo largo
   * de una recta, con d = hypot(dx, dy) y dx' = s (pendiente de dx, -1, 0 o +1).
   */
  function toolModel(tool) {
    const r = tool.d / 2;
    const type = tool.type === "ball" ? "ball" : tool.type === "v" ? "v" : "flat";
    const T = Math.tan((tool.angle || 90) * Math.PI / 360);
    let prof;
    if (type === "ball") prof = (d) => r - Math.sqrt(Math.max(0, r * r - d * d));
    else if (type === "v") prof = (d) => d / T;
    else prof = () => 0;
    function fprime(dx, dy, s) {
      if (type === "flat" || s === 0) return 0;
      if (type === "ball") {
        const q = r * r - dx * dx - dy * dy;
        return q < 1e-12 ? NaN : -dx * s / Math.sqrt(q);       // NaN = tangente vertical (no sirve)
      }
      const d = Math.hypot(dx, dy);
      return d < 1e-12 ? -s / T : -dx * s / (T * d);
    }
    return { r, type, T, prof, fprime };
  }

  /**
   * Material que existe en el tablero de un panel. Pixel (c, b): columna c, fila b contada desde ABAJO.
   * Fuera del rango del panel no hay material (el tablero se corta al tamano del panel), salvo en los
   * bordes exteriores del mural con marco: ahi se supone tablero a Z0.
   */
  function makeBoard(H, w, h, inc) {
    const { cLo, cHi, bLo, bHi } = inc;
    return function pix(c, b) {
      if (c < cLo || c > cHi || b < bLo || b > bHi) return -Infinity;
      if (c < 0 || b < 0 || c >= w || b >= h) return 0;
      return H[(h - 1 - b) * w + c];
    };
  }

  /**
   * Calculo exacto de una pasada recta (a lo largo de X o de Y) con la fresa real contra pixeles cuadrados.
   * Muestras en los centros de pixel kA..kB (indice a lo largo). Para cada muestra da la Z minima segura
   * (d) y, para cada tramo entre dos muestras, eleva el extremo bajo lo justo para que la recta (G1)
   * entre ambas no muerda el relieve en ningun punto intermedio. Cada muestra tiene Z de llegada (zin)
   * y de salida (zout); si difieren mucho se baja/sube en vertical en la muestra (escalon).
   * Demostracion (resumen): con muestras en todos los centros de pixel y cortes en las aristas, la
   * distancia a cada pixel es afin y monotona en cada medio tramo, y f = H - prof(d) es concava para
   * bola y V (constante para plana). Una funcion concava queda por debajo de sus tangentes, asi que
   * U = min(max f, tangentes en los extremos) es una cota superior lineal a trozos y la Z minima del
   * extremo bajo sale en los vertices de U (funcion lineal-fraccional monotona en cada trozo).
   */
  function lineSolver(o) {
    const { res, TM, pix, alongX, kA, kB, theta } = o;
    const zFloor = o.zFloor == null ? -Infinity : o.zFloor;
    const r = TM.r, n = Math.ceil(r / res + 0.5) + 1;
    const N = kB - kA + 1, aS = kA - n - 1, aLen = N + 2 * (n + 1);
    const OFF = n + 2, TL = 2 * OFF + 1, half = res / 2;

    const Lv = new Float64Array(3), Ls = new Float64Array(3), Lq = new Float64Array(3), cand = new Float64Array(6);
    let nL = 0;
    const U = (q) => { let u = Infinity; for (let t = 0; t < nL; t++) { const v = Lv[t] + Ls[t] * (q - Lq[t]); if (v < u) u = v; } return u; };
    function halfReq(val, dy, i, qa, qb, zh) {
      const pc = i * res;
      let dxA = Math.max(0, Math.abs(qa - pc) - half), dxB = Math.max(0, Math.abs(qb - pc) - half);
      const s = (dxB - dxA) / (qb - qa);
      const dxs = Math.sqrt(r * r - dy * dy);
      const inA = dxA < dxs, inB = dxB < dxs;
      if (!inA && !inB) return -Infinity;
      if (!inA) { qa = qa + (dxs - dxA) / s; dxA = dxs; }
      else if (!inB) { qb = qa + (dxs - dxA) / s; dxB = dxs; }
      const fA = val - TM.prof(Math.min(r, Math.hypot(dxA, dy))), fB = val - TM.prof(Math.min(r, Math.hypot(dxB, dy)));
      const sA = TM.fprime(dxA, dy, s), sB = TM.fprime(dxB, dy, s);
      nL = 0;
      Lv[0] = Math.max(fA, fB); Ls[0] = 0; Lq[0] = qa; nL = 1;
      if (sA === sA) { Lv[nL] = fA; Ls[nL] = sA; Lq[nL] = qa; nL++; }       // sA === sA: no es NaN
      if (sB === sB) { Lv[nL] = fB; Ls[nL] = sB; Lq[nL] = qb; nL++; }
      let nc = 0;
      cand[nc++] = qa; cand[nc++] = qb;
      for (let a = 0; a < nL; a++) for (let b = a + 1; b < nL; b++) {
        const ds = Ls[a] - Ls[b];
        if (Math.abs(ds) < 1e-15) continue;
        const q = (Lv[b] - Ls[b] * Lq[b] - Lv[a] + Ls[a] * Lq[a]) / ds;
        if (q > qa && q < qb) cand[nc++] = q;
      }
      let best = -Infinity;
      for (let c = 0; c < nc; c++) {
        const q = cand[c], wq = 1 - q / res;
        let req;
        if (wq < 1e-9) {                          // en el extremo alto: limite
          const u = U(res);
          if (zh - u > 1e-9) continue;
          let sl = -Infinity;
          for (let t = 0; t < nL; t++) { const v = Lv[t] + Ls[t] * (res - Lq[t]); if (v <= u + 1e-9 && Ls[t] > sl) sl = Ls[t]; }
          req = zh - sl * res;
        } else req = zh - (zh - U(q)) / wq;
        if (req > best) best = req;
      }
      return best;
    }

    return function solve(fv) {
      const p0 = Math.floor((fv - r) / res) - 1, p1 = Math.floor((fv + r) / res) + 1;
      const rows = [];
      for (let p = p0; p <= p1; p++) {
        const dy = Math.max(0, Math.abs((p + 0.5) * res - fv) - half);
        if (dy >= r) continue;
        const V = new Float64Array(aLen); let any = false;
        for (let t = 0; t < aLen; t++) {
          const a = aS + t, v = alongX ? pix(a, p) : pix(p, a);
          V[t] = v; if (v !== -Infinity) any = true;
        }
        if (!any) continue;
        const dzC = new Float64Array(TL), dzE = new Float64Array(TL);
        let m = 0;
        for (let i = -OFF; i <= OFF; i++) {
          const dc = Math.hypot(Math.max(0, Math.abs(i) * res - half), dy);
          dzC[i + OFF] = dc < r ? TM.prof(dc) : Infinity;
          if (dc < r && Math.abs(i) > m) m = Math.abs(i);
          const de = Math.hypot(Math.max(0, Math.abs(i - 0.5) * res - half), dy);
          dzE[i + OFF] = de < r ? TM.prof(de) : Infinity;
        }
        const dzM1 = new Float64Array(TL), dzM2 = new Float64Array(TL);   // min en cada medio tramo
        for (let t = 0; t < TL; t++) { dzM1[t] = Math.min(dzC[t], dzE[t]); dzM2[t] = t ? Math.min(dzE[t], dzC[t - 1]) : Infinity; }
        rows.push({ dy, V, dzC, dzE, dzM1, dzM2, m });
      }
      if (!rows.length) return null;
      // Z minima en cada muestra
      const d = new Float64Array(N).fill(-Infinity);
      for (const R of rows) {
        const { V, dzC, m } = R;
        for (let k = 0; k < N; k++) {
          let best = d[k];
          const base = k + n + 1;
          for (let i = -m; i <= m; i++) { const z = V[base + i] - dzC[i + OFF]; if (z > best) best = z; }
          d[k] = best;
        }
      }
      let first = 0, last = N - 1;
      while (first < N && d[first] === -Infinity) first++;
      while (last >= 0 && d[last] === -Infinity) last--;
      if (first > last) return null;
      for (let k = first; k <= last; k++) {
        if (d[k] === -Infinity) d[k] = -1e9;   // no ocurre (zona convexa)
        // suelo: en el sobrepaso de uniones y bordes sin marco no hay material bajo el centro y la punta
        // bajaria por debajo del fondo del relieve (V estrecha, bola grande) y tallaria el tablero de
        // debajo. Una pieza entera nunca baja de -depth, asi que limitar ahi no deja mas material que ella.
        if (d[k] < zFloor) d[k] = zFloor;
      }
      const zin = Float64Array.from(d), zout = Float64Array.from(d);
      if (o.dilate) {
        // modo rapido (desbaste): Z constante por tramo = max de sus extremos (cota monotona) ->
        // cada muestra toma el maximo de ella y sus vecinas. Seguro; deja como mucho un tramo de mas.
        for (let k = first; k <= last; k++) {
          let z = d[k];
          if (k > first && d[k - 1] > z) z = d[k - 1];
          if (k < last && d[k + 1] > z) z = d[k + 1];
          zin[k] = zout[k] = z;
        }
        return { first, last, d, zin, zout };
      }
      // tramos: elevar el extremo bajo lo justo
      for (let k = first; k < last; k++) {
        const za = d[k], zb = d[k + 1];
        if (Math.abs(za - zb) < 1e-9) continue;     // recta horizontal: segura (cota monotona)
        const rising = za < zb, zl = rising ? za : zb, zh = rising ? zb : za;
        const lowT = (rising ? k : k + 1) + n + 1, dir = rising ? 1 : -1;
        let zr = zl;
        for (let ri = 0; ri < rows.length; ri++) {
          const R = rows[ri], V = R.V, dzM1 = R.dzM1, dzM2 = R.dzM2, m = R.m, dy = R.dy;
          for (let i = -m - 1; i <= m + 1; i++) {
            const val = V[lowT + dir * i];
            if (val === -Infinity) continue;
            if (val - dzM1[i + OFF] > zr + 1e-12) { const q = halfReq(val, dy, i, 0, half, zh); if (q > zr) zr = q; }
            if (val - dzM2[i + OFF] > (zr + zh) * 0.5 + 1e-12) { const q = halfReq(val, dy, i, half, res, zh); if (q > zr) zr = q; }
          }
        }
        if (zr > zl) {
          if (zr > zh) zr = zh;                     // nunca hace falta mas (cota monotona)
          if (rising) zout[k] = zr; else zin[k + 1] = zr;
        }
      }
      for (let k = first; k <= last; k++) {
        if (zin[k] !== zout[k] && Math.abs(zin[k] - zout[k]) <= theta) zin[k] = zout[k] = Math.max(zin[k], zout[k]);
      }
      return { first, last, d, zin, zout };
    };
  }

  /**
   * Puntos (s, z) de un trozo de pasada [ka..kb], en el sentido de corte. Incluye escalones verticales.
   * En los extremos del trozo el tramo anterior/siguiente no se recorre, asi que se baja a la Z minima
   * propia de la muestra (d) y despues se sube en vertical a la Z de salida (y al reves al final). Sin
   * esto, la primera/ultima muestra se quedaba a la Z elevada por su tramo y no tallaba lo que le toca
   * (esquinas de panel y bordes sin marco).
   */
  function linePoints(Lr, ka, kb, rev, sOf, zmap) {
    const S = [], Z = [];
    const push = (k, z) => {
      const zz = zmap(z);
      if (S.length && S[S.length - 1] === sOf(k) && Z[Z.length - 1] === zz) return;   // repetido
      S.push(sOf(k)); Z.push(zz);
    };
    if (ka === kb) { push(ka, Lr.d[ka]); return { S, Z }; }
    const k0 = rev ? kb : ka, k1 = rev ? ka : kb, st = rev ? -1 : 1;
    const zIn = rev ? Lr.zout : Lr.zin, zOut = rev ? Lr.zin : Lr.zout;   // llegada / salida en el sentido de corte
    for (let k = k0; ; k += st) {
      if (k === k0) { push(k, Lr.d[k]); push(k, zOut[k]); }
      else if (k === k1) { push(k, zIn[k]); push(k, Lr.d[k]); break; }
      else { push(k, zIn[k]); push(k, zOut[k]); }
    }
    return { S, Z };
  }

  /** Simplifica por trozos (los escalones verticales se conservan). Devuelve indices a emitir. */
  function simplifyPath(S, Z, rev, tolLo, tolHi) {
    const out = [];
    let a = 0;
    const n = S.length;
    while (a < n) {
      let b = a;
      while (b + 1 < n && S[b + 1] !== S[b]) b++;
      const s = new Float64Array(b - a + 1), z = new Float64Array(b - a + 1);
      for (let i = a; i <= b; i++) { s[i - a] = rev ? -S[i] : S[i]; z[i - a] = Z[i]; }
      const keep = simplify(s, z, tolLo, tolHi);
      for (const q of keep) out.push(q + a);
      a = b + 1;
    }
    return out;
  }

  // ------------------------------------------------------------ simplificacion
  /** Quita puntos alineados - algoritmo de "manga". La recta final queda entre z - tolLo y z + tolHi
      en cada punto quitado (s estrictamente creciente). */
  function simplify(s, z, tolLo, tolHi) {
    if (tolHi == null) tolHi = tolLo;
    const n = s.length;
    if (n <= 2) return Array.from({ length: n }, (_, i) => i);
    const keep = [0];
    let a = 0, lo = -Infinity, hi = Infinity;
    for (let i = 1; i < n; i++) {
      const sl = (z[i] - z[a]) / (s[i] - s[a]);
      if (sl < lo - 1e-12 || sl > hi + 1e-12) { a = i - 1; keep.push(a); lo = -Infinity; hi = Infinity; }
      const d = s[i] - s[a];
      const l2 = (z[i] - tolLo - z[a]) / d, h2 = (z[i] + tolHi - z[a]) / d;
      if (l2 > lo) lo = l2;
      if (h2 < hi) hi = h2;
    }
    if (keep[keep.length - 1] !== n - 1) keep.push(n - 1);
    return keep;
  }

  // ------------------------------------------------------------ escritor G-code
  function fnum(v) {
    v = Math.round(v * 1000) / 1000;
    if (Math.abs(v) < 5e-4) return "0";
    let s = v.toFixed(3).replace(/0+$/, "");
    if (s.startsWith("0.")) s = s.slice(1);
    else if (s.startsWith("-0.")) s = "-" + s.slice(2);
    return s;
  }

  const CHUNK = 200000;          // lineas por bloque de texto (evita 'Invalid string length')

  class Writer {
    constructor(o) {
      this.o = o; this.L = []; this.parts = []; this.count = 0; this.bytes = 0;
      this.n = 10; this.first = true;
      this.st = { G: null, X: null, Y: null, Z: null, F: null };
      this.x = 0; this.y = 0; this.z = null;
      this.tCut = 0; this.tRapid = 0; this.dist = 0;
    }
    raw(s) {
      this.L.push(s); this.count++;
      if (this.L.length >= CHUNK) this.flush();
    }
    flush() {
      if (!this.L.length) return;
      const t = this.L.join("\r\n") + "\r\n";
      this.parts.push(t); this.bytes += t.length; this.L = [];
    }
    line(s) {
      if (this.o.format === "chaoda") { this.raw("N" + this.n + " " + s); this.n++; }
      else this.raw(s);
    }
    header(title) {
      if (this.o.format === "chaoda") {
        this.line("G90");
        this.line("S" + this.o.rpm + " M3");
      } else {
        this.raw("(" + String(title).replace(/[^\x20-\x7e]/g, "_").replace(/[()]/g, "") + ")");
        this.raw("G21 G90 G17");
        // subir antes de arrancar el husillo y antes de cualquier XY
        this.move(0, null, null, this.o.safeZ);
        this.raw("M3 S" + this.o.rpm);
        // G4 P = segundos en GRBL, LinuxCNC y Mach3 (configuracion por defecto)
        this.raw("(G4 P3 = pausa de 3 s para que el husillo llegue a regimen. En Mach3 con G04 en ms usar G4 P3000)");
        this.raw("G4 P3");
      }
    }
    move(g, x, y, z, feed) {
      const words = [];
      const nx = x == null ? this.x : x, ny = y == null ? this.y : y, nz = z == null ? this.z : z;
      for (const [k, v] of [["X", x], ["Y", y], ["Z", z]]) {
        if (v == null) continue;
        const fv = fnum(v);
        if (this.st[k] !== fv) { words.push(k + fv); this.st[k] = fv; }
      }
      if (!words.length) return;
      const d = Math.hypot(nx - this.x, ny - this.y, (nz == null || this.z == null) ? 0 : nz - this.z);
      const out = [];
      const gs = "G" + g;
      if (this.first) {
        this.first = false; out.push(gs);
        if (this.o.format === "chaoda") out.push("G54");
        this.st.G = gs;
      } else if (this.st.G !== gs) { out.push(gs); this.st.G = gs; }
      out.push(...words);
      if (g === 1 && feed != null) {
        const ff = String(Math.round(feed));
        if (this.st.F !== ff) { out.push("F" + ff); this.st.F = ff; }
        this.tCut += d / feed;
      } else if (g === 0) this.tRapid += d / (this.o.rapid || 5000);
      this.dist += d;
      this.line(out.join(" "));
      this.x = nx; this.y = ny; this.z = nz;
    }
    /** Ir a (x,y) por encima del material. El primer movimiento sube primero a la Z de seguridad. */
    travel(x, y) {
      if (this.z == null) this.move(0, null, null, this.o.safeZ);
      else if (this.z < this.o.travelZ - 1e-6) this.move(0, null, null, this.o.travelZ);
      this.move(0, x, y);
    }
    /** Bajar en vertical: en rapido hasta la Z de traslado y despues al avance de entrada. */
    plunge(z) {
      if (this.z > this.o.travelZ + 1e-6 && z < this.o.travelZ) this.move(0, null, null, this.o.travelZ);
      this.move(1, null, null, z, this.o.plunge);
    }
    cut(x, y, z) {
      const dxy = Math.hypot(x - this.x, y - this.y), dz = z - this.z;
      const f = (dz < 0 && -dz > dxy) ? this.o.plunge : this.o.feed;   // bajada fuerte -> avance de entrada
      this.move(1, x, y, z, f);
    }
    lift() { this.move(0, null, null, this.o.travelZ); }
    end() {
      this.move(0, null, null, this.o.safeZ);
      if (this.o.format === "chaoda") {
        this.line("G53 Z0"); this.line("G0 M05"); this.line("M30"); this.raw("%");
      } else { this.raw("M5"); this.raw("M30"); }
      this.flush();
    }
  }

  // ------------------------------------------------------------ validacion
  /** Devuelve la lista de errores (vacia si todo bien). Mensajes en espanol para mostrar al usuario. */
  function validate(p) {
    const e = [];
    if (!p || typeof p !== "object") return ["Faltan los parametros."];
    const fin = (v) => typeof v === "number" && Number.isFinite(v);
    const pos = (v) => fin(v) && v > 0;
    if (p.W !== undefined && !pos(p.W)) e.push("El ancho del mural debe ser un numero mayor que 0.");
    if (p.H !== undefined && !pos(p.H)) e.push("El alto del mural debe ser un numero mayor que 0.");
    if (p.res !== undefined && !pos(p.res)) e.push("La resolucion (mm/px) debe ser un numero mayor que 0.");
    if (!pos(p.depth)) e.push("La profundidad debe ser un numero mayor que 0.");
    if (!pos(p.panelW) || !pos(p.panelH)) e.push("El tamano maximo de panel (ancho y alto) debe ser mayor que 0.");
    if (pos(p.res) && pos(p.panelW) && pos(p.panelH) && (p.panelW < p.res - 1e-9 || p.panelH < p.res - 1e-9))
      e.push("El tamano maximo de panel no puede ser menor que un pixel (" + (Math.round(p.res * 1000) / 1000) + " mm).");
    if (p.thick !== undefined && p.thick !== null && p.thick !== "") {
      if (!pos(p.thick)) e.push("El espesor del tablero debe ser un numero mayor que 0.");
      else if (pos(p.depth) && p.depth > p.thick) e.push("La profundidad no puede ser mayor que el espesor del tablero.");
    }
    if (!fin(p.safeZ)) e.push("La Z de seguridad debe ser un numero.");
    if (!pos(p.travelZ)) e.push("La Z de traslado debe ser mayor que 0 (por encima de la cara del tablero).");
    if (fin(p.safeZ) && fin(p.travelZ) && p.travelZ >= p.safeZ) e.push("La Z de traslado debe ser menor que la Z de seguridad.");
    if (p.tolerance !== undefined && !(fin(p.tolerance) && p.tolerance >= 0)) e.push("La tolerancia debe ser un numero mayor o igual que 0.");
    if (p.rapid !== undefined && !pos(p.rapid)) e.push("El avance rapido debe ser mayor que 0.");
    const R = p.rough || {}, F = p.finish || {};
    if (!R.on && !F.on) e.push("Activa al menos el desbaste o el acabado.");
    if (R.on) {
      if (!R.tool || !pos(R.tool.d)) e.push("Desbaste: el diametro de la fresa debe ser mayor que 0.");
      if (!pos(R.stepdown)) e.push("Desbaste: el paso vertical debe ser mayor que 0.");
      if (!pos(R.stepoverPct)) e.push("Desbaste: el paso lateral (%) debe ser mayor que 0.");
      if (!pos(R.feed)) e.push("Desbaste: el avance de corte debe ser mayor que 0.");
      if (!pos(R.plunge)) e.push("Desbaste: el avance de entrada debe ser mayor que 0.");
      if (!pos(R.rpm)) e.push("Desbaste: las revoluciones deben ser mayores que 0.");
      if (R.allowance !== undefined && !(fin(R.allowance) && R.allowance >= 0)) e.push("Desbaste: la sobremedida debe ser un numero mayor o igual que 0.");
    }
    if (F.on) {
      const t = F.tool || {};
      if (!pos(t.d)) e.push("Acabado: el diametro de la fresa debe ser mayor que 0.");
      if (!["ball", "flat", "v"].includes(t.type)) e.push("Acabado: tipo de fresa desconocido.");
      if (t.type === "v" && !(fin(t.angle) && t.angle > 0 && t.angle < 180)) e.push("Acabado: el angulo de la fresa en V debe estar entre 0 y 180 grados.");
      if (!pos(F.stepover)) e.push("Acabado: el paso lateral debe ser mayor que 0.");
      if (!pos(F.feed)) e.push("Acabado: el avance de corte debe ser mayor que 0.");
      if (!pos(F.plunge)) e.push("Acabado: el avance de entrada debe ser mayor que 0.");
      if (!pos(F.rpm)) e.push("Acabado: las revoluciones deben ser mayores que 0.");
      if (F.dir !== undefined && F.dir !== "x" && F.dir !== "y") e.push("Acabado: la direccion de pasada debe ser X o Y.");
    }
    return e;
  }

  // ------------------------------------------------------------ paneles
  /**
   * Division en paneles con cortes en pixeles enteros (ningun pixel se reparte entre dos paneles).
   * Como los cortes van en pixeles enteros, un panel no siempre puede medir exactamente panelW: se admite
   * que pase de panelW (o panelH) MENOS DE UN PIXEL (cap = mayor numero de pixeles con cap*res < panelW+res),
   * y se usa el MINIMO numero de paneles que cumple eso, repartiendo los pixeles por igual (los paneles
   * difieren como mucho en 1 px). Asi no se anade un panel entero por una fraccion de pixel, tambien con
   * 3 o mas paneles y cuando el alto/ancho real (pixeles*res) pasa un poco del tecleado.
   * Ejemplos con panel 1200x2400: 2400 mm a 0.7 mm/px (3429 px) -> 2 paneles de 1715 y 1714 px
   * (1200.35 y 1199.65 mm); 3600 mm a 0.7 (5143 px) -> 3 paneles (el mayor 1200.47 mm); alto 2400.11 mm
   * a 0.33 mm/px -> 1 fila.
   * cols/rows: indices de corte (filas contadas desde abajo). Requiere panelW, panelH >= res.
   */
  function tiles(w, h, res, panelW, panelH) {
    const cap = (L) => Math.max(1, Math.floor(L / res + 1 - 1e-6));
    const nx = Math.min(w, Math.max(1, Math.ceil(w / cap(panelW))));
    const ny = Math.min(h, Math.max(1, Math.ceil(h / cap(panelH))));
    const cols = [], rows = [];
    for (let t = 0; t <= nx; t++) cols.push(Math.round(t * w / nx));
    for (let t = 0; t <= ny; t++) rows.push(Math.round(t * h / ny));
    return { nx, ny, cols, rows };
  }

  // ------------------------------------------------------------ trayectorias
  /**
   * Posiciones de las pasadas entre a0 y a1 sobre una rejilla GLOBAL (multiplos de step desde el origen
   * del mural), para que las pasadas de paneles vecinos y las de una pieza entera coincidan y la union
   * quede igual. exact0/exact1: anadir el extremo exacto (bordes con marco, donde no se sobrepasa).
   */
  function linePositions(a0, a1, step, exact0, exact1) {
    if (!(step > 0) || !Number.isFinite(step)) throw new Error("Paso no valido: debe ser mayor que 0.");
    const out = [];
    if (exact0) out.push(a0);
    for (let k = Math.ceil(a0 / step - 1e-9); k * step <= a1 + 1e-9; k++) {
      const v = k * step;
      if (exact0 && v <= a0 + 1e-6) continue;
      if (exact1 && v >= a1 - 1e-6) break;
      out.push(v);
    }
    if (exact1 || !out.length) out.push(a1);
    return out;
  }

  /**
   * Genera los programas.
   * g = { H, w, h, res } relieve (fila 0 = arriba de la imagen)
   * p = parametros (ver app.js y validate)
   * Devuelve [{name, op, tile, origin:[x0,y0], size:[w,h], lines, minutes, bytes, parts, warnings}]
   * warnings: lista de avisos en espanol (normalmente vacia), campo opcional para la interfaz.
   * parts: bloques de texto (CRLF, cada uno terminado en CRLF); parts.join('') es el .nc completo.
   * Lanza Error (mensaje en espanol) si los parametros no son validos.
   *
   * Paneles: cortes en pixeles enteros (tiles). Cada panel se calcula solo con su material: se supone el
   * tablero cortado al tamano del panel. En las uniones entre paneles, y en los bordes del mural sin marco,
   * el centro de la fresa sobrepasa el borde hasta su radio (coordenadas desde -r hasta tamano+r) para
   * dejar el borde igual que en una pieza entera. Con marco, en los bordes exteriores no se sobrepasa
   * (coordenadas dentro de 0..tamano) y el material de fuera cuenta como tablero a Z0.
   * Las pasadas caen en una rejilla global (multiplos del paso), las mismas en todos los paneles.
   * Inicio seguro: antes de cualquier XY se sube a la Z de seguridad (chaoda: 'N12 G0 G54 Z..').
   */
  function generate(g, p, progress) {
    const errs = validate(p);
    if (!g || !(g.w >= 1) || !(g.h >= 1) || !(g.res > 0) || !Number.isFinite(g.res) || !g.H || g.H.length !== g.w * g.h)
      errs.push("Relieve no valido.");
    else if (p.panelW > 0 && p.panelH > 0 && (p.panelW < g.res - 1e-9 || p.panelH < g.res - 1e-9) &&
      !errs.some((m) => m.startsWith("El tamano maximo de panel no puede")))
      errs.push("El tamano maximo de panel no puede ser menor que un pixel (" + (Math.round(g.res * 1000) / 1000) + " mm).");
    if (errs.length) throw new Error(errs.join(" "));
    const { H, w, h, res } = g;
    const TL = tiles(w, h, res, p.panelW, p.panelH);
    const { nx, ny } = TL;
    const files = [];
    const ops = [];
    if (p.rough && p.rough.on) ops.push("desbaste");
    if (p.finish && p.finish.on) ops.push("acabado");
    const totalJobs = ops.length * nx * ny;
    const tol = p.tolerance == null ? 0.02 : p.tolerance;
    let job = 0;

    for (let ty = 0; ty < ny; ty++) for (let tx = 0; tx < nx; tx++) {
      const C0 = TL.cols[tx], C1 = TL.cols[tx + 1], B0 = TL.rows[ty], B1 = TL.rows[ty + 1];
      const x0 = C0 * res, x1 = C1 * res, y0 = B0 * res, y1 = B1 * res;
      const outer = { L: tx === 0, R: tx === nx - 1, B: ty === 0, T: ty === ny - 1 };
      const fr = !!p.frame;
      const pix = makeBoard(H, w, h, {
        cLo: outer.L && fr ? -Infinity : C0, cHi: outer.R && fr ? Infinity : C1 - 1,
        bLo: outer.B && fr ? -Infinity : B0, bHi: outer.T && fr ? Infinity : B1 - 1,
      });
      const tileName = (nx * ny > 1) ? `_panel${ty + 1}-${tx + 1}` : "";
      for (const op of ops) {
        const T = op === "desbaste" ? p.rough : p.finish;
        const tool = op === "desbaste" ? { type: "flat", d: T.tool.d } : T.tool;
        const TM = toolModel(tool), r = TM.r;
        const wr = new Writer({ format: p.format, rpm: T.rpm, feed: T.feed, plunge: T.plunge,
          safeZ: p.safeZ, travelZ: p.travelZ, rapid: p.rapid });
        const title = `Krea3D ${p.name || ""} ${op}${tileName}`;
        wr.header(title);
        const alongX = op === "desbaste" || p.finish.dir !== "y";
        // la fresa sobrepasa las uniones entre paneles (y los bordes sin marco) hasta su radio,
        // para que el borde quede igual que en una pieza entera
        const ov = (side) => (outer[side] && fr) ? 0 : r;
        const ext = (o) => o > 0 ? Math.ceil(o / res + 0.5) - 1 : 0;
        const step = op === "desbaste" ? T.tool.d * T.stepoverPct / 100 : T.stepover;
        let kA, kB, fixed;
        if (alongX) { kA = C0 - ext(ov("L")); kB = C1 - 1 + ext(ov("R")); fixed = linePositions(y0 - ov("B"), y1 + ov("T"), step, !ov("B"), !ov("T")); }
        else { kA = B0 - ext(ov("B")); kB = B1 - 1 + ext(ov("T")); fixed = linePositions(x0 - ov("L"), x1 + ov("R"), step, !ov("L"), !ov("R")); }
        const sOf = (k) => (kA + k + 0.5) * res;                  // coordenada absoluta a lo largo
        const XY = (s, fv) => alongX ? [s - x0, fv - y0] : [fv - x0, s - y0];
        // Escalones verticales menores que theta se funden subiendo al mayor de los dos: deja hasta theta
        // (0.2 mm) de material de mas en esos puntos, nunca muerde. Decision de diseno: con 0.1 mm el
        // acabado con fresa en V saca el doble de lineas. Por eso un panel y una pieza entera pueden
        // diferir hasta ~0.2 mm en puntos sueltos (no solo en uniones).
        // Ademas, en relieves muy irregulares (ruido de pixel a pixel) queda algo de material de mas junto a
        // las uniones aunque theta fuera 0: lineSolver sube el extremo bajo de cada tramo para no morder, y
        // junto a la union la muestra vecina de un panel puede estar mas baja que en la pieza entera (hay
        // menos material fuera del panel), lo que obliga a subir mas el otro extremo. Medido: hasta ~0.18 mm
        // con theta 0 y ~0.25 mm con theta 0.2 (ruido, V25 d10, 0.8 mm/px); en relieves suaves (conos,
        // crestas, cuencos) es 0. Siempre es material de mas, nunca muerde, y queda por debajo de la cresta
        // entre pasadas en esos casos.
        const theta = Math.max(0.2, 2 * tol);
        const solve = lineSolver({ res, TM, pix, alongX, kA, kB, theta, zFloor: -p.depth, dilate: op === "desbaste" });
        // Z minima en un rectangulo (enlaces entre pasadas), exacta para pixeles cuadrados
        const dropRect = (xa, xb, ya, yb) => {
          let m = -Infinity;
          const c0 = Math.floor((xa - r) / res), c1 = Math.floor((xb + r) / res);
          const b0 = Math.floor((ya - r) / res), b1 = Math.floor((yb + r) / res);
          for (let b = b0; b <= b1; b++) {
            const gy = Math.max(0, b * res - yb, ya - (b + 1) * res);
            if (gy >= r) continue;
            for (let c = c0; c <= c1; c++) {
              const gx = Math.max(0, c * res - xb, xa - (c + 1) * res), dd = Math.hypot(gx, gy);
              if (dd >= r) continue;
              const v = pix(c, b);
              if (v === -Infinity) continue;
              const z = v - TM.prof(dd);
              if (z > m) m = z;
            }
          }
          return m;
        };

        if (op === "desbaste") {
          const allow = T.allowance || 0;
          // simplificacion del desbaste: puede bajar como mucho la mitad de la sobremedida (nunca por
          // debajo de la superficie final) y subir hasta 0.08 mm
          const tolLoR = Math.min(0.05, allow / 2);
          const sols = fixed.map((fv, i) => {
            if (i % 8 === 0) progress && progress((job + 0.3 * i / fixed.length) / totalJobs, `Desbaste${tileName}: calculando`);
            return solve(fv);
          });
          const levels = [];
          for (let z = -T.stepdown; z > -p.depth + 1e-6; z -= T.stepdown) levels.push(z);
          levels.push(-p.depth);
          let prev = 0;
          levels.forEach((L, li) => {
            progress && progress((job + 0.3 + 0.7 * li / levels.length) / totalJobs, `Desbaste${tileName}: nivel ${fnum(L)} mm`);
            const zmap = (z) => Math.max(L, z + allow);
            let nl = 0;
            fixed.forEach((fv, i) => {
              const Lr = sols[i];
              if (!Lr) return;
              const rev = nl++ % 2 === 1;
              const runs = [];
              let st = -1;
              for (let k = Lr.first; k <= Lr.last + 1; k++) {
                const inRun = k <= Lr.last && Lr.d[k] + allow < prev - 1e-3;
                if (inRun && st < 0) st = k;
                if (!inRun && st >= 0) { runs.push([st, k - 1]); st = -1; }
              }
              if (rev) runs.reverse();
              for (const [ka, kb] of runs) {
                const { S, Z } = linePoints(Lr, ka, kb, rev, sOf, zmap);
                const keep = simplifyPath(S, Z, rev, tolLoR, 0.08);
                const [sx, sy] = XY(S[0], fv);
                wr.travel(sx, sy); wr.plunge(Z[0]);
                for (let q = 1; q < keep.length; q++) { const [cx, cy] = XY(S[keep[q]], fv); wr.cut(cx, cy, Z[keep[q]]); }
                wr.lift();
              }
            });
            prev = L;
          });
        } else {
          let last = null, nl = 0;
          const ident = (z) => z;
          fixed.forEach((fv, i) => {
            if (i % 8 === 0) progress && progress((job + i / fixed.length) / totalJobs, `Acabado${tileName}: pasada ${i + 1}/${fixed.length}`);
            const Lr = solve(fv);
            if (!Lr) return;
            const rev = nl++ % 2 === 1;
            const { S, Z } = linePoints(Lr, Lr.first, Lr.last, rev, sOf, ident);
            const keep = simplifyPath(S, Z, rev, tol, tol);
            const [sx, sy] = XY(S[0], fv);
            if (last == null) { wr.travel(sx, sy); wr.plunge(Z[0]); }
            else {
              // enlace entre pasadas: recto, por encima de todo lo que haya en el rectangulo que barre
              const [px, py] = [wr.x + x0, wr.y + y0], qx = sx + x0, qy = sy + y0;
              const zr = dropRect(Math.min(px, qx), Math.max(px, qx), Math.min(py, qy), Math.max(py, qy));
              const zc = Math.max(wr.z, Z[0], zr);
              if (zc > wr.z + 1e-6) wr.cut(wr.x, wr.y, zc);
              wr.cut(sx, sy, zc);
              if (Z[0] < zc - 1e-6) wr.cut(sx, sy, Z[0]);
            }
            for (let q = 1; q < keep.length; q++) { const [cx, cy] = XY(S[keep[q]], fv); wr.cut(cx, cy, Z[keep[q]]); }
            last = fv;
          });
        }
        wr.end();
        job++;
        files.push({
          name: `${p.name}_${op}${tileName}.nc`, op, tile: tileName ? `${ty + 1}-${tx + 1}` : "",
          origin: [x0, y0], size: [x1 - x0, y1 - y0],
          lines: wr.count, bytes: wr.bytes, parts: wr.parts,
          minutes: (wr.tCut + wr.tRapid) * 1.15,       // +15% por aceleraciones
          // aviso (campo opcional): programa sin ningun corte, p. ej. con marco y una fresa que no cabe
          warnings: wr.tCut > 0 ? [] : [`${op === "desbaste" ? "Desbaste" : "Acabado"}${tileName ? " panel " + (ty + 1) + "-" + (tx + 1) : ""}: no hay nada que cortar (la fresa no cabe en el relieve o no hay material por encima del fondo). El programa solo sube y termina.`],
        });
      }
    }
    progress && progress(1, "Listo");
    return files;
  }

  // ------------------------------------------------------------ sombreado para la vista previa
  function hillshade(H, w, h, res, depth, rgba) {
    const L = [-0.55, 0.55, 0.63];
    const ex = 2.5;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const zl = H[y * w + Math.max(0, x - 1)], zr = H[y * w + Math.min(w - 1, x + 1)];
      const zu = H[Math.max(0, y - 1) * w + x], zd = H[Math.min(h - 1, y + 1) * w + x];
      const dx = (zr - zl) / (2 * res) * ex, dy = (zu - zd) / (2 * res) * ex;
      const nl = Math.hypot(dx, dy, 1);
      let s = (-dx * L[0] - dy * L[1] + L[2]) / nl;
      s = Math.max(0, Math.min(1, s * 1.25));
      const t = depth > 0 ? 1 + H[i] / depth : 1;          // 1 = superficie
      const base = [176 + 50 * t, 140 + 48 * t, 98 + 44 * t];  // tono MDF/madera
      const o = i * 4;
      rgba[o] = base[0] * (0.35 + 0.75 * s); rgba[o + 1] = base[1] * (0.35 + 0.75 * s);
      rgba[o + 2] = base[2] * (0.35 + 0.75 * s); rgba[o + 3] = 255;
    }
  }


  const api = { boxBlur, prepHeight, toolModel, makeBoard, lineSolver, simplify, fnum, Writer, validate, tiles, generate, hillshade };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Krea = api;
})(typeof self !== "undefined" ? self : this);
