/* Krea3D - interfaz. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  /** Valor numerico de un campo; NaN si esta vacio o no es un numero. */
  const num = (id) => { const s = String($(id).value).trim(); return s === "" ? NaN : Number(s); };
  const fin = Number.isFinite;
  const MAX_IMG_PX = 16e6, MAX_IMG_SIDE = 8192;   // la rejilla nunca necesita mas detalle que esto
  let src = null;          // canvas con la imagen original (modo artistico, 8 bits)
  let srcField = null;     // campo de alturas {w,h,data} (heightmap 16 bits o STL, modo pro)
  let srcId = 0;           // cambia con cada imagen cargada
  let aspect = 1;
  let lastFiles = [];
  let lastJob = null;      // { key, name, depth } del trabajo que produjo lastFiles
  let running = false;
  let currentBad = true;

  // ---------------------------------------------------------- imagen de ejemplo
  function sampleImage() {
    const c = document.createElement("canvas"); c.width = 960; c.height = 600;
    const g = c.getContext("2d");
    const sky = g.createLinearGradient(0, 0, 0, 600);
    sky.addColorStop(0, "#3a3a3a"); sky.addColorStop(1, "#7a7a7a");
    g.fillStyle = sky; g.fillRect(0, 0, 960, 600);
    // sol con rayos
    g.save(); g.translate(640, 210);
    for (let i = 0; i < 24; i++) {
      g.rotate(Math.PI / 12); g.fillStyle = i % 2 ? "#8c8c8c" : "#9d9d9d";
      g.beginPath(); g.moveTo(0, 0); g.lineTo(330, -26); g.lineTo(330, 26); g.closePath(); g.fill();
    }
    const sun = g.createRadialGradient(0, 0, 10, 0, 0, 110);
    sun.addColorStop(0, "#ffffff"); sun.addColorStop(1, "#d9d9d9");
    g.fillStyle = sun; g.beginPath(); g.arc(0, 0, 105, 0, Math.PI * 2); g.fill();
    g.restore();
    // montañas
    const ridge = (base, amp, f, ph, col) => {
      g.fillStyle = col; g.beginPath(); g.moveTo(0, 600);
      for (let x = 0; x <= 960; x += 6) {
        const y = base - amp * (0.6 * Math.sin(x / f + ph) + 0.3 * Math.sin(x / (f * 0.37) + ph * 2) + 0.15 * Math.sin(x / (f * 0.13)));
        g.lineTo(x, y);
      }
      g.lineTo(960, 600); g.closePath(); g.fill();
    };
    ridge(360, 90, 120, 0.5, "#b4b4b4");
    ridge(430, 70, 90, 2.1, "#cfcfcf");
    ridge(500, 45, 70, 4.0, "#e8e8e8");
    // olas
    g.strokeStyle = "#5a5a5a"; g.lineWidth = 7;
    for (let k = 0; k < 3; k++) {
      g.beginPath();
      for (let x = 0; x <= 960; x += 4) g.lineTo(x, 540 + k * 22 + 8 * Math.sin(x / 26 + k));
      g.stroke();
    }
    return c;
  }

  function syncFromW() { const W = num("W"); if (fin(W) && W > 0) $("Hh").value = Math.max(1, Math.round(W / aspect)); }
  function syncFromH() { const H = num("Hh"); if (fin(H) && H > 0) $("W").value = Math.max(1, Math.round(H * aspect)); }

  function setSource(canvas, label, note) {
    src = canvas; srcField = null; srcId++; aspect = canvas.width / canvas.height;
    $("imgTag").textContent = label;
    $("imgNote").textContent = note || ""; $("imgNote").hidden = !note;
    $("iaBtn").hidden = !window.KreaDepth; $("hmSave").hidden = true; $("iaMsg").hidden = true;
    if ($("lock").checked) syncFromW();
    refresh();
  }

  /** Fuente profesional: campo de alturas real (heightmap 16 bits, STL o IA). */
  function setFieldSource(field, label, note) {
    srcField = field; src = null; srcId++; aspect = field.w / field.h;
    $("imgTag").textContent = label;
    $("imgNote").textContent = note || ""; $("imgNote").hidden = !note;
    $("iaBtn").hidden = true; $("hmSave").hidden = false;
    if ($("lock").checked) syncFromW();
    refresh();
  }

  const baseName = (file) => file.name.replace(/\.[^.]+$/, "").replace(/[^\w-]+/g, "_").slice(0, 40);
  const fmtMm = (v) => String(Math.round(v * 10) / 10);

  /** Despacho por tipo: STL -> rasterizar; PNG -> 16 bits si lo es; resto -> imagen de 8 bits. */
  function loadFile(file) {
    if (!file) return;
    const n = (file.name || "").toLowerCase();
    if (n.endsWith(".stl")) { loadStl(file); return; }
    if (n.endsWith(".png") || file.type === "image/png") { loadPng(file); return; }
    if (file.type.startsWith("image/")) { loadImageFile(file); return; }
    setGenError("Formato no reconocido. Usa un heightmap PNG de 16 bits, un modelo STL, o una imagen JPG/PNG (modo artístico).");
  }

  function loadStl(file) {
    if (file.size > 400e6) { setGenError("El STL pesa más de 400 MB: expórtalo con menos caras."); return; }
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const tris = KreaInput.parseStl(fr.result);
        const r = KreaInput.rasterizeStl(tris, 1800);
        setGenError("");
        const base = baseName(file); if (base) $("name").value = base;
        // escala real del modelo: se proponen sus medidas en mm
        if (r.sizeX >= 10) { $("W").value = Math.round(r.sizeX); if ($("lock").checked) syncFromW(); }
        if (r.sizeZ > 0.5) $("depth").value = Math.round(r.sizeZ * 10) / 10;
        setFieldSource(r, `STL · ${(tris.length / 9).toLocaleString("es")} caras`,
          `Modo profesional: modelo STL visto desde arriba (Z hacia arriba), ${fmtMm(r.sizeX)} × ${fmtMm(r.sizeY)} × ${fmtMm(r.sizeZ)} mm. ` +
          `Se han puesto el ancho y la profundidad del modelo para tallarlo a escala real; cámbialos si quieres otra medida.`);
      } catch (e) { setGenError("No se pudo leer el STL: " + (e && e.message || e)); }
    };
    fr.onerror = () => setGenError("No se pudo leer el archivo STL.");
    fr.readAsArrayBuffer(file);
  }

  function loadPng(file) {
    const fr = new FileReader();
    fr.onload = () => {
      let hm = null;
      try { hm = KreaInput.decodePng16(fr.result); }
      catch (e) { setGenError("No se pudo leer el heightmap: " + (e && e.message || e)); return; }
      if (!hm) { loadImageFile(file); return; }        // PNG normal de 8 bits: modo artistico
      setGenError("");
      const base = baseName(file); if (base) $("name").value = base;
      setFieldSource(hm, `heightmap 16 bits · ${hm.w} × ${hm.h} px`,
        "Modo profesional: heightmap de 16 bits (65.536 niveles de altura reales). Blanco = superficie, negro = fondo del tallado.");
    };
    fr.onerror = () => setGenError("No se pudo leer el archivo PNG.");
    fr.readAsArrayBuffer(file);
  }

  function loadImageFile(file) {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      URL.revokeObjectURL(url);
      const nw = im.naturalWidth, nh = im.naturalHeight;
      if (!(nw > 0 && nh > 0)) { setGenError("No se pudo leer la imagen."); return; }
      // las imagenes enormes no caben en un canvas: se reducen (la rejilla nunca usa tanto detalle)
      const k = Math.min(1, Math.sqrt(MAX_IMG_PX / (nw * nh)), MAX_IMG_SIDE / nw, MAX_IMG_SIDE / nh);
      const cw = Math.max(1, Math.round(nw * k)), ch = Math.max(1, Math.round(nh * k));
      const c = document.createElement("canvas"); c.width = cw; c.height = ch;
      const g = c.getContext("2d");
      let ok = !!g;
      if (ok) {
        try {
          g.fillStyle = "#fff"; g.fillRect(0, 0, cw, ch);
          g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
          g.drawImage(im, 0, 0, cw, ch);
          ok = g.getImageData(0, 0, 1, 1).data[3] === 255;      // canvas usable (fondo blanco opaco)
        } catch (e) { ok = false; }
      }
      if (!ok) { setGenError("La imagen es demasiado grande para este navegador. Redúcela (por ejemplo a 4000 px de lado) y vuelve a cargarla."); return; }
      setGenError("");
      const base = baseName(file);
      if (base) $("name").value = base;
      let note = "Modo artístico: el brillo de la imagen se usa como altura (claro = alto, oscuro = profundo), así que las sombras de una foto se tallan como hoyos. " +
        "Para un relieve profesional con alturas reales carga un heightmap PNG de 16 bits o un modelo STL.";
      if (k < 1) note = `Imagen muy grande (${nw} × ${nh} px): se ha reducido a ${cw} × ${ch} px para poder procesarla. ` + note;
      setSource(c, k < 1 ? `imagen 8 bits · ${nw} × ${nh} px → ${cw} × ${ch}` : `imagen 8 bits · ${nw} × ${nh} px`, note);
    };
    im.onerror = () => { URL.revokeObjectURL(url); setGenError("No se pudo leer la imagen."); };
    im.src = url;
  }

  /** Alturas 0..1 remuestreadas a w×h: campo real (16 bits / STL) o luminancia de la imagen. */
  function luminance(w, h) {
    if (srcField) return KreaInput.resample(srcField, w, h);
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.fillStyle = "#fff"; g.fillRect(0, 0, w, h);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
    g.drawImage(src, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    const lum = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) lum[i] = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255;
    return lum;
  }

  // ---------------------------------------------------------- parametros
  function params() {
    const fType = $("fType").value;
    return {
      name: ($("name").value.trim() || "mural").replace(/[^\w-]+/g, "_"),
      W: num("W"), H: num("Hh"), depth: num("depth"), thick: num("thick"), res: num("res"),
      darkHigh: $("darkHigh").checked, gamma: num("gamma"),
      blackPoint: num("blackPoint") / 100, whitePoint: num("whitePoint") / 100, smoothMm: num("smoothMm"),
      rough: { on: $("roughOn").checked, tool: { type: "flat", d: num("rD") }, stepdown: num("rStep"),
        stepoverPct: num("rOver"), allowance: num("rAllow"), feed: num("rF"), plunge: num("rFz"), rpm: Math.round(num("rS")) },
      finish: { on: $("finishOn").checked, tool: { type: fType, d: num("fD"), angle: num("fAngle") }, stepover: num("fOver"),
        dir: $("fDir").value, feed: num("fF"), plunge: num("fFz"), rpm: Math.round(num("fS")) },
      format: $("format").value, safeZ: num("safeZ"), travelZ: num("travelZ"), frame: $("frame").checked,
      tolerance: num("tolerance"), panelW: num("panelW"), panelH: num("panelH"), rapid: 5000,
    };
  }

  /** Rejilla efectiva: la misma que recibe Krea.generate (W real = w*res, H real = h*res). */
  function gridOf(p) {
    const w = Math.max(1, Math.round(p.W / p.res));
    const res = p.W / w;
    // el alto se redondea con la resolucion real, asi no se pasa un pixel entero del tecleado
    const h = Math.max(1, Math.round(p.H / res));
    return { w, h, res, W: w * res, H: h * res };
  }
  /** Division en paneles: la misma que usa Krea.generate (Krea.tiles, cortes en pixeles enteros). */
  function tilesOf(gr, p) {
    if (window.Krea && typeof Krea.tiles === "function") return Krea.tiles(gr.w, gr.h, gr.res, p.panelW, p.panelH);
    const nx = Math.max(1, Math.ceil(gr.W / p.panelW - 1e-6)), ny = Math.max(1, Math.ceil(gr.H / p.panelH - 1e-6));
    const cols = [], rows = [];
    for (let t = 0; t <= nx; t++) cols.push(Math.round(t * gr.w / nx));
    for (let t = 0; t <= ny; t++) rows.push(Math.round(t * gr.h / ny));
    return { nx, ny, cols, rows };
  }
  function panelsOf(gr, p) { const t = tilesOf(gr, p); return [t.nx, t.ny]; }

  /** Cota superior de lineas y bytes del programa mas grande (sin contar lo que quita la simplificacion,
      que depende de la imagen: el archivo real suele ser bastante menor). */
  function estimate(p, gr, nx, ny) {
    const pw = Math.ceil(gr.w / nx) * gr.res, ph = Math.ceil(gr.h / ny) * gr.res;
    let lines = 0;
    if (p.finish.on) {
      const along = p.finish.dir === "x" ? pw : ph, across = p.finish.dir === "x" ? ph : pw;
      const passes = Math.ceil(across / p.finish.stepover) + 1, pts = Math.ceil(along / gr.res) + 1;
      lines = Math.max(lines, passes * pts);
    }
    if (p.rough.on) {
      const passes = Math.ceil(ph / (p.rough.tool.d * p.rough.stepoverPct / 100)) + 1;
      const levels = Math.ceil(p.depth / p.rough.stepdown);
      lines = Math.max(lines, passes * levels * Math.ceil(pw / gr.res) * 0.3);   // solo corta donde hace falta
    }
    return { lines, bytes: lines * 25 };
  }

  const FIELDS = [
    // id, texto, regla, grupo ("rough"/"finish"/"v" = solo si esta activo)
    ["W", "Ancho (X)", ">0"], ["Hh", "Alto (Y)", ">0"], ["depth", "Profundidad máx.", ">0"],
    ["thick", "Espesor tablero", ">0"], ["res", "Resolución", ">0"], ["tolerance", "Tolerancia", ">0"],
    ["panelW", "Panel máx. X", ">0"], ["panelH", "Panel máx. Y", ">0"], ["smoothMm", "Suavizado", ">=0"],
    ["safeZ", "Z de seguridad", ">0"], ["travelZ", "Z de traslado", ">0"],
    ["rD", "Diámetro del desbaste", ">0", "rough"], ["rStep", "Paso vertical del desbaste", ">0", "rough"],
    ["rOver", "Paso lateral del desbaste", ">0", "rough"], ["rAllow", "Sobremedida", ">=0", "rough"],
    ["rF", "Avance del desbaste", ">0", "rough"], ["rFz", "Entrada del desbaste", ">0", "rough"],
    ["rS", "Husillo del desbaste", ">0", "rough"],
    ["fD", "Diámetro del acabado", ">0", "finish"], ["fAngle", "Ángulo de la V", ">0", "v"],
    ["fOver", "Paso lateral del acabado", ">0", "finish"], ["fF", "Avance del acabado", ">0", "finish"],
    ["fFz", "Entrada del acabado", ">0", "finish"], ["fS", "Husillo del acabado", ">0", "finish"],
  ];

  const PANEL_MIN = 50, PANELS_WARN = 100, PANELS_MAX = 1000;
  function check(p) {
    const a = [];
    const bad = (t, id) => {
      a.push({ bad: true, t });
      if (!id) return;
      $(id).setAttribute("aria-invalid", "true");
      const box = $(id).closest("details"); if (box) box.open = true;     // que el campo con error se vea
    };
    const warn = (t) => a.push({ t });
    for (const [id] of FIELDS) $(id).removeAttribute("aria-invalid");
    let fieldsOk = true;
    for (const [id, label, rule, grp] of FIELDS) {
      if (grp === "rough" && !p.rough.on) continue;
      if ((grp === "finish" || grp === "v") && !p.finish.on) continue;
      if (grp === "v" && p.finish.tool.type !== "v") continue;
      const v = num(id);
      if (!fin(v)) { bad(`${label}: el campo está vacío o no es un número.`, id); fieldsOk = false; }
      else if (rule === ">0" && !(v > 0)) { bad(`${label}: debe ser mayor que 0.`, id); fieldsOk = false; }
      else if (rule === ">=0" && v < 0) { bad(`${label}: no puede ser negativo.`, id); fieldsOk = false; }
    }
    if (!p.rough.on && !p.finish.on) bad("Activa al menos el desbaste o el acabado.");
    if (fin(p.safeZ) && fin(p.travelZ) && p.travelZ > 0 && p.travelZ >= p.safeZ) {
      bad("La Z de traslado debe ser menor que la Z de seguridad.", "travelZ"); fieldsOk = false;
    }
    for (const [id, label] of [["panelW", "Panel máx. X"], ["panelH", "Panel máx. Y"]]) {
      const v = p[id];
      if (fin(v) && v > 0 && v < PANEL_MIN) { bad(`${label}: como mínimo ${PANEL_MIN} mm (el panel se indica en milímetros, no en metros).`, id); fieldsOk = false; }
    }
    if (p.rough.on && p.rough.stepoverPct > 100) { bad("Paso lateral del desbaste: como máximo 100 % del diámetro.", "rOver"); fieldsOk = false; }
    if (p.finish.on && p.finish.tool.type === "v" && p.finish.tool.angle >= 180) { bad("Ángulo de la V: debe ser menor que 180°.", "fAngle"); fieldsOk = false; }
    // reglas del nucleo (las mismas que usa Krea.generate): red de seguridad si la UI no vio nada
    if (fieldsOk && window.Krea && typeof Krea.validate === "function") {
      let msgs = [];
      try { msgs = Krea.validate(p) || []; } catch (e) { msgs = []; }
      for (const m of msgs) if (!a.some((x) => x.t === m)) { a.push({ bad: true, t: m }); fieldsOk = false; }
    }
    if (!fieldsOk) return a;

    if (p.depth > p.thick - 3) warn(`La profundidad (${p.depth} mm) deja menos de 3 mm de fondo en un tablero de ${p.thick} mm.`);
    if (p.rough.on && p.rough.stepdown > p.rough.tool.d) warn("El paso vertical del desbaste es mayor que el diámetro de la fresa; es arriesgado.");
    if (p.finish.on && p.finish.stepover > p.finish.tool.d / 2) warn("El paso lateral del acabado es grande para esa fresa: quedarán surcos visibles.");
    if (p.finish.on && !p.rough.on && p.depth > 3) warn("Sin desbaste, la fresa de acabado tendrá que quitar todo el material de una pasada.");
    const cells = (p.W / p.res) * (p.H / p.res);
    if (cells > 30e6) bad(`Con ${p.res} mm/px salen ${(cells / 1e6).toFixed(0)} millones de puntos. Sube la resolución a ${Math.sqrt(p.W * p.H / 25e6).toFixed(2)} mm/px o más.`, "res");
    if (p.finish.on && p.finish.tool.d / 2 < p.res) warn("La fresa de acabado es más fina que la resolución: baja los mm/px para aprovecharla.");
    const gr = gridOf(p);
    if (Math.abs(gr.H - p.H) > 0.05) warn(`Con ${p.res} mm/px el alto real del relieve será ${gr.H.toFixed(2)} mm.`);
    const [nx, ny] = panelsOf(gr, p);
    if (nx * ny > PANELS_MAX) bad(`Salen ${nx * ny} paneles (${nx}×${ny}), demasiados programas. Revisa el tamaño máximo del panel (en mm) o el del mural.`, nx > ny ? "panelW" : "panelH");
    else if (nx * ny > PANELS_WARN) warn(`Salen ${nx * ny} paneles (${nx}×${ny}): son muchos programas. Comprueba que el panel máximo está en milímetros.`);
    const est = estimate(p, gr, nx, ny);
    if (est.bytes > 150e6) warn(`El programa más grande puede llegar a pesar hasta ${fmtSize(est.bytes)} (${fmtLines(est.lines)} líneas). Es mucho para la máquina y para el navegador: usa paneles más pequeños, sube los mm/px, el paso lateral o la tolerancia.`);
    return a;
  }

  function showAlerts(a) {
    const box = $("alerts"); box.textContent = "";
    for (const x of a) { const d = document.createElement("div"); d.className = "alert" + (x.bad ? " bad" : ""); d.textContent = x.t; box.appendChild(d); }
  }
  /** Error de la generacion / carga: queda visible hasta la siguiente accion (refresh no lo borra). */
  function setGenError(msg) { $("genErr").textContent = msg; $("genErr").hidden = !msg; }

  const fmtTime = (m) => { m = Math.max(1, Math.round(m)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`; };
  const fmtSize = (b) => b >= 1e9 ? (b / 1e9).toFixed(2) + " GB" : b > 1e6 ? (b / 1e6).toFixed(1) + " MB" : Math.max(1, Math.ceil(b / 1e3)) + " KB";
  const fmtLines = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + " M" : Math.round(n).toLocaleString("es");
  const keyOf = (p) => srcId + "|" + JSON.stringify(p);

  function updateGenButton() { $("gen").disabled = running || currentBad || (!src && !srcField); }

  // ---------------------------------------------------------- vista previa
  let prevH = null, prevW = 0, prevHh = 0;
  function refresh() {
    if (!src && !srcField) return;
    const p = params();
    const alerts = check(p);
    currentBad = alerts.some((x) => x.bad);
    showAlerts(alerts);
    updateGenButton();
    markStale();
    $("fTag").textContent = p.finish.on ? { ball: "fresa bola", flat: "fresa plana", v: "fresa en V" }[p.finish.tool.type] : "desactivado";
    $("rTag").textContent = p.rough.on ? "fresa plana" : "desactivado";
    $("fmtTag").textContent = p.format === "chaoda" ? "Chaoda" : "Genérico";
    $("fAngleBox").hidden = p.finish.tool.type !== "v";
    $("gammaV").textContent = (+p.gamma).toFixed(2);
    $("bpV").textContent = Math.round(p.blackPoint * 100);
    $("wpV").textContent = Math.round(p.whitePoint * 100);
    const sizeOk = fin(p.W) && fin(p.H) && p.W > 0 && p.H > 0;
    const gridOk = sizeOk && fin(p.res) && p.res > 0;
    const gr = gridOk ? gridOf(p) : null;
    const panOk = gr && fin(p.panelW) && fin(p.panelH) && p.panelW > 0 && p.panelH > 0;
    const TL = panOk ? tilesOf(gr, p) : null;
    const [nx, ny] = TL ? [TL.nx, TL.ny] : [1, 1];
    const sz = gr ? `${+gr.W.toFixed(1)} × ${+gr.H.toFixed(1)}` : sizeOk ? `${p.W} × ${p.H}` : "—";
    $("meta").textContent = sz === "—" ? "—" : `${sz} mm`;
    $("kSize").textContent = sz;
    $("kPanels").textContent = !panOk ? "—" : nx * ny === 1 ? "1" : `${nx * ny} (${nx}×${ny})`;
    $("kGrid").textContent = gr ? `${gr.w} × ${gr.h}` : "—";
    $("kDepth").textContent = fin(p.depth) && p.depth > 0 ? `${p.depth} mm` : "—";
    $("kOut").textContent = (!currentBad && panOk) ? "≤ " + fmtSize(estimate(p, gr, nx, ny).bytes) : "—";
    if (!sizeOk) return;

    const cv = $("cv2d");
    const maxW = 900, maxH = 560;
    const s = Math.min(maxW / p.W, maxH / p.H);
    const w = Math.max(20, Math.round(p.W * s)), h = Math.max(20, Math.round(p.H * s));
    const res = p.W / w;
    const pp = Object.assign({}, p, { smoothMm: fin(p.smoothMm) ? p.smoothMm : 0, depth: fin(p.depth) && p.depth > 0 ? p.depth : 1 });
    const lum = luminance(w, h);
    const H = Krea.prepHeight(lum, w, h, res, pp);
    prevH = H; prevW = w; prevHh = h;
    cv.width = w; cv.height = h;
    const g = cv.getContext("2d");
    const img = g.createImageData(w, h);
    Krea.hillshade(H, w, h, res, pp.depth, img.data);
    g.putImageData(img, 0, 0);
    cv.setAttribute("aria-label", `Vista previa del relieve, ${sz} mm` + (nx * ny > 1 ? `, dividido en ${nx * ny} paneles` : ""));
    if (nx * ny > 1) {
      g.save(); g.setLineDash([8, 6]); g.lineWidth = 2; g.strokeStyle = "#3bbfb5";
      g.font = "600 14px 'IBM Plex Mono', monospace"; g.fillStyle = "#ffffff";
      // cortes reales (en pixeles de la rejilla; filas contadas desde abajo) llevados a la vista previa
      const X = (c) => w * c / gr.w, Y = (r) => h * (1 - r / gr.h);
      for (let i = 1; i < nx; i++) { const x = Math.round(X(TL.cols[i])) + 0.5; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
      for (let j = 1; j < ny; j++) { const y = Math.round(Y(TL.rows[j])) + 0.5; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) g.fillText(`${j + 1}-${i + 1}`, X(TL.cols[i]) + 8, Y(TL.rows[j]) - 8);
      g.restore();
    }
    if (!$("v3d").hidden) draw3d();
  }

  // ---------------------------------------------------------- 3D
  let three = null;
  function draw3d() {
    if (!window.THREE || !prevH) return;
    const el = $("v3d");
    const p = params();
    if (!(p.W > 0 && p.H > 0)) return;
    if (!three) {
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      renderer.domElement.setAttribute("role", "img");
      renderer.domElement.setAttribute("aria-label", "Vista 3D del relieve; arrastra para girarla");
      el.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(35, 1, 1, 20000);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 0.55));
      const sun = new THREE.DirectionalLight(0xffffff, 0.9); sun.position.set(-1, 1.2, 1.4); scene.add(sun);
      const controls = THREE.OrbitControls ? new THREE.OrbitControls(camera, renderer.domElement) : null;
      if (controls) controls.enableDamping = true;
      three = { renderer, scene, camera, controls, mesh: null };
      const loop = () => {
        requestAnimationFrame(loop);
        if (el.hidden) return;
        const cw = el.clientWidth, ch = el.clientHeight;
        if (renderer.domElement.width !== Math.round(cw * renderer.getPixelRatio())) {
          renderer.setSize(cw, ch, false); camera.aspect = cw / ch; camera.updateProjectionMatrix();
        }
        controls && controls.update();
        renderer.render(scene, camera);
      };
      loop();
    }
    const sx = Math.max(2, Math.min(prevW - 1, 360)), sy = Math.max(2, Math.round(sx * prevHh / prevW));
    const geo = new THREE.PlaneGeometry(p.W, p.H, sx, sy);
    const pos = geo.attributes.position;
    for (let j = 0; j <= sy; j++) for (let i = 0; i <= sx; i++) {
      const ci = Math.min(prevW - 1, Math.round(i / sx * (prevW - 1))), rj = Math.min(prevHh - 1, Math.round(j / sy * (prevHh - 1)));
      pos.setZ(j * (sx + 1) + i, prevH[rj * prevW + ci]);
    }
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0xc9a06a, roughness: 0.85, metalness: 0 });
    if (three.mesh) { three.scene.remove(three.mesh); three.mesh.geometry.dispose(); }
    three.mesh = new THREE.Mesh(geo, mat);
    three.scene.add(three.mesh);
    three.scene.background = new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue("--stage").trim() || "#2b3237");
    const R = Math.max(p.W, p.H);
    if (!three.placed) { three.camera.position.set(-0.25 * R, -0.9 * R, 1.25 * R); three.placed = true; }
    three.camera.lookAt(0, 0, 0);
  }

  // ---------------------------------------------------------- trayectoria
  function drawPath(file) {
    if (!file) return;
    const cv = $("cvPath"), g = cv.getContext("2d");
    const [W, H] = file.size;
    const s = Math.min(900 / W, 560 / H);
    cv.width = Math.round(W * s) + 20; cv.height = Math.round(H * s) + 20;
    g.fillStyle = "#1d2226"; g.fillRect(0, 0, cv.width, cv.height);
    cv.setAttribute("aria-label", `Trayectoria de ${file.name}`);
    const depth = (lastJob && lastJob.depth) || 1;
    const step = Math.max(1, Math.floor((file.lines || 0) / 400000));
    const re = /([GXYZ])(-?[\d.]+)/g;
    let x = 0, y = 0, z = 10, G = 0, k = 0;
    g.lineWidth = 1;
    for (const part of file.parts) {
      let a = 0;
      while (a < part.length) {
        let b = part.indexOf("\r\n", a); if (b < 0) b = part.length;
        const ln = part.slice(a, b); a = b + 2;
        const kk = k++;
        let nx = x, ny = y, nz = z, any = false, m;
        re.lastIndex = 0;
        while ((m = re.exec(ln))) {
          any = true;
          const v = parseFloat(m[2]);
          if (m[1] === "G") { if (v === 0 || v === 1) G = v; }
          else if (m[1] === "X") nx = v; else if (m[1] === "Y") ny = v; else nz = v;
        }
        if (!any) continue;
        if (kk % step === 0 && (nx !== x || ny !== y)) {
          if (G === 0 || nz > 0) g.strokeStyle = "rgba(160,160,160,.25)";
          else { const t = Math.min(1, -nz / depth); g.strokeStyle = `hsl(${40 - 30 * t}, ${60 + 20 * t}%, ${75 - 45 * t}%)`; }
          g.beginPath(); g.moveTo(10 + x * s, cv.height - 10 - y * s); g.lineTo(10 + nx * s, cv.height - 10 - ny * s); g.stroke();
        }
        x = nx; y = ny; z = nz;
      }
    }
  }

  // ---------------------------------------------------------- generar
  let worker = null;
  function resetProgress(state, msg, f) {
    $("prog").hidden = state === "hidden";
    $("prog").classList.toggle("err", state === "error");
    if (f != null) $("barI").style.width = (f * 100).toFixed(1) + "%";
    if (msg != null) $("progMsg").textContent = msg;
  }
  function clearResults(msg) {
    lastFiles = []; lastJob = null;
    $("results").textContent = "";
    const e = document.createElement("p"); e.className = "empty"; e.textContent = msg; $("results").appendChild(e);
    $("tabPath").disabled = true;
    if ($("tabPath").getAttribute("aria-selected") === "true") setTab("2d");
  }

  function generate() {
    const p = params();
    const alerts = check(p);
    if (alerts.some((a) => a.bad)) { showAlerts(alerts); currentBad = true; updateGenButton(); return; }
    setGenError("");
    const gr = gridOf(p);
    const { w, h, res } = gr;
    const job = JSON.parse(JSON.stringify(p));
    const jobInfo = { key: keyOf(p), name: p.name, depth: p.depth };
    let finished = false;
    let lum;
    try { lum = luminance(w, h); }
    catch (e) { fail("No hay memoria para una rejilla de " + w + " × " + h + ". Sube los mm/px."); return; }
    running = true; updateGenButton();
    resetProgress("run", "Preparando…", 0);
    if (worker) { worker.terminate(); worker = null; }

    function fail(msg) {
      finished = true; running = false;
      if (worker) { worker.terminate(); worker = null; }
      resetProgress("error", "Error", null);
      clearResults("No se generó ningún programa. Corrige el problema y vuelve a generar.");
      setGenError("Error al calcular: " + msg);
      updateGenButton();
    }
    function done(files) {
      if (finished) return;
      finished = true; running = false;
      if (worker) { worker.terminate(); worker = null; }
      if (!Array.isArray(files) || !files.length) { finished = false; fail("no salió ningún programa; revisa los parámetros."); return; }
      // se buscan valores no finitos solo fuera de los comentarios '(...)': el titulo del NC lleva el
      // nombre del proyecto, que puede contener 'NaN', 'Infinity' o 'undefined' (p. ej. NaNo.png)
      const badFile = files.find((f) => !Array.isArray(f.parts) ||
        f.parts.some((s) => typeof s !== "string" || /NaN|Infinity|undefined/.test(s.replace(/\([^)\r\n]*\)?/g, ""))));
      if (badFile) { finished = false; fail(`el programa ${badFile.name} contiene valores no válidos (NaN/Infinity) y se ha descartado.`); return; }
      resetProgress("run", "Listo", 1);
      lastFiles = files; lastJob = jobInfo;
      showResults(files);
      updateGenButton();
    }
    function local() {
      resetProgress("run", "Calculando en la página…", null);
      setTimeout(() => {
        try {
          const H = Krea.prepHeight(lum, w, h, res, job);
          done(Krea.generate({ H, w, h, res }, job, null));
        } catch (e) { fail(String(e && e.message || e)); }
      }, 30);
    }

    try { worker = new Worker("worker.js"); }
    catch (e) { worker = null; }
    if (!worker) { local(); return; }
    worker.onmessage = (e) => {
      const m = e.data;
      if (finished) return;
      if (m.type === "progress") resetProgress("run", m.msg, m.f);
      else if (m.type === "done") done(m.files);
      else if (m.type === "error") fail(m.msg);
    };
    worker.onerror = (ev) => {
      if (finished) return;
      ev && ev.preventDefault && ev.preventDefault();
      if (worker) { worker.terminate(); worker = null; }
      local();          // lum no se transfiere: sigue intacto para el respaldo
    };
    worker.postMessage({ lum, w, h, res, p: job });
  }

  function save(name, blob) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }

  function showResults(files) {
    const box = $("results"); box.textContent = "";
    const stale = document.createElement("div"); stale.className = "alert bad stale-msg"; stale.id = "staleMsg"; stale.hidden = true;
    stale.textContent = "Los parámetros o la imagen han cambiado: estos programas ya no corresponden a lo que ves. Vuelve a generar.";
    box.appendChild(stale);
    const scroller = document.createElement("div"); scroller.className = "tscroll";
    const t = document.createElement("table");
    t.innerHTML = "<thead><tr><th>Programa</th><th>Operación</th><th>Panel</th><th>Tamaño panel</th><th>Líneas</th><th>Tiempo aprox.</th><th>Archivo</th><th></th></tr></thead>";
    const tb = document.createElement("tbody");
    files.forEach((f) => {
      const tr = document.createElement("tr");
      const td = (txt, cls) => { const c = document.createElement("td"); c.textContent = txt; if (cls) c.className = cls; tr.appendChild(c); return c; };
      td(f.name);
      const op = td(""); const pill = document.createElement("span"); pill.className = "pill" + (f.op === "desbaste" ? " r" : ""); pill.textContent = f.op; op.appendChild(pill);
      td(f.tile || "—", "num");
      td(`${Math.round(f.size[0])} × ${Math.round(f.size[1])}`, "num");
      td(f.lines.toLocaleString("es"), "num");
      td(fmtTime(f.minutes), "num");
      td(fmtSize(f.bytes != null ? f.bytes : f.parts.reduce((s, x) => s + x.length, 0)), "num");
      const act = td("");
      const v = document.createElement("button"); v.type = "button"; v.className = "btn ghost vw"; v.textContent = "Ver";
      v.setAttribute("aria-label", "Ver trayectoria de " + f.name);
      v.onclick = () => { setTab("path"); drawPath(f); };
      const d = document.createElement("button"); d.type = "button"; d.className = "btn ghost dl"; d.textContent = "Descargar";
      d.setAttribute("aria-label", "Descargar " + f.name);
      d.onclick = () => save(f.name, new Blob(f.parts, { type: "text/plain" }));
      act.style.display = "flex"; act.style.gap = "6px"; act.append(v, d);
      tb.appendChild(tr);
    });
    t.appendChild(tb); scroller.appendChild(t); box.appendChild(scroller);
    const total = files.reduce((s, f) => s + f.minutes, 0);
    const foot = document.createElement("div"); foot.className = "go"; foot.style.padding = "10px 12px";
    const sum = document.createElement("span"); sum.className = "note";
    sum.textContent = `${files.length} ${files.length === 1 ? "programa" : "programas"} · tiempo total aprox. ${fmtTime(total)}`;
    foot.appendChild(sum);
    if (files.length > 1 && window.JSZip) {
      const z = document.createElement("button"); z.type = "button"; z.className = "btn ghost dl"; z.textContent = "Descargar todo (.zip)";
      const zipName = `${lastJob.name}_nc.zip`;
      z.onclick = async () => {
        z.disabled = true; const old = z.textContent; z.textContent = "Comprimiendo…";
        try {
          const zip = new JSZip(); files.forEach((f) => zip.file(f.name, new Blob(f.parts)));
          save(zipName, await zip.generateAsync({ type: "blob", compression: "DEFLATE" }));
        } catch (e) { setGenError("No se pudo crear el .zip: " + (e && e.message || e) + ". Descarga los archivos uno a uno."); }
        z.textContent = old; z.disabled = false; markStale();
      };
      foot.appendChild(z);
    }
    box.appendChild(foot);
    $("tabPath").disabled = false;
    setTab("path"); drawPath(files[files.length - 1]);
    markStale();
  }

  /** Marca los resultados como desactualizados si los parametros ya no son los del trabajo generado. */
  function markStale() {
    if (!lastFiles.length || !lastJob) return;
    const stale = keyOf(params()) !== lastJob.key;
    $("results").classList.toggle("stale", stale);
    const m = $("staleMsg"); if (m) m.hidden = !stale;
    for (const b of $("results").querySelectorAll("button.dl, button.vw")) b.disabled = stale;
    // la trayectoria dibujada es la del trabajo viejo: no se ofrece mientras no corresponda
    $("tabPath").disabled = stale;
    if (stale && $("tabPath").getAttribute("aria-selected") === "true") setTab("2d");
  }

  // ---------------------------------------------------------- pestañas y eventos
  const TABS = [["tab2d", "v2d", "2d"], ["tab3d", "v3d", "3d"], ["tabPath", "vPath", "path"]];
  function setTab(t, focus) {
    for (const [tid, vid, key] of TABS) {
      const on = key === t;
      $(tid).setAttribute("aria-selected", on ? "true" : "false");
      $(tid).tabIndex = on ? 0 : -1;
      $(vid).hidden = !on;
      if (on && focus) $(tid).focus();
    }
    $("legend").hidden = t === "3d";
    if (t === "3d") draw3d();
  }
  $("tab2d").onclick = () => setTab("2d");
  $("tab3d").onclick = () => setTab("3d");
  $("tabPath").onclick = () => { setTab("path"); if (lastFiles.length) drawPath(lastFiles[lastFiles.length - 1]); };
  $("tablist").addEventListener("keydown", (e) => {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(e.key)) return;
    const avail = TABS.filter(([tid]) => !$(tid).disabled);
    let i = avail.findIndex(([tid]) => $(tid).getAttribute("aria-selected") === "true");
    if (e.key === "ArrowRight") i = (i + 1) % avail.length;
    else if (e.key === "ArrowLeft") i = (i - 1 + avail.length) % avail.length;
    else if (e.key === "Home") i = 0; else i = avail.length - 1;
    e.preventDefault();
    $(avail[i][0]).click(); $(avail[i][0]).focus();
  });

  let tmr = 0;
  const later = () => { clearTimeout(tmr); tmr = setTimeout(refresh, 120); };
  $("form").addEventListener("input", (e) => {
    const id = e.target.id;
    if (id === "file") return;
    if (id === "W" && $("lock").checked) syncFromW();
    if (id === "Hh" && $("lock").checked) syncFromH();
    if (id === "lock" && $("lock").checked) syncFromW();
    later();
  });
  $("form").addEventListener("change", (e) => { if (e.target.type === "checkbox" || e.target.tagName === "SELECT") later(); });
  $("form").addEventListener("submit", (e) => e.preventDefault());
  $("file").addEventListener("change", (e) => loadFile(e.target.files[0]));
  const drop = $("drop");
  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => loadFile(e.dataTransfer.files[0]));
  $("gen").onclick = generate;

  // ---------------------------------------------------------- IA de profundidad
  $("iaBtn").onclick = async () => {
    if (!src || !window.KreaDepth) return;
    const btn = $("iaBtn"), msg = $("iaMsg");
    btn.disabled = true; msg.hidden = false;
    msg.textContent = "Cargando el modelo de IA (~50 MB, solo la primera vez)…";
    const canvas = src;
    try {
      const raw = await KreaDepth.estimate(canvas, (fase, pct) => {
        msg.textContent = fase === "descarga"
          ? `Descargando el modelo de IA… ${Math.round(pct)} % (solo la primera vez; todo se calcula en tu navegador, la imagen no se sube a ningún sitio)`
          : "Calculando la profundidad…";
      });
      // al aspecto exacto de la imagen, ampliado en bilineal
      const w2 = Math.min(1024, Math.max(raw.w, canvas.width));
      const h2 = Math.max(2, Math.round(w2 * canvas.height / canvas.width));
      const field = { w: w2, h: h2, data: KreaInput.resample(raw, w2, h2) };
      msg.hidden = true;
      setFieldSource(field, `IA profundidad · ${w2} × ${h2}`,
        "Heightmap generado con IA (Depth Anything) en tu navegador: lo cercano queda alto. " +
        "Si sale al revés, marca «Invertir». Revisa la Vista 3D y, si te gusta, descarga el heightmap de 16 bits para guardarlo o retocarlo.");
    } catch (e) {
      msg.hidden = true;
      setGenError("No se pudo estimar la profundidad: " + (e && e.message || e) + ". La primera vez se necesita conexión a internet para descargar el modelo.");
    }
    btn.disabled = false;
  };

  $("hmSave").onclick = () => {
    if (!srcField) return;
    try { save(($("name").value.trim() || "mural") + "_heightmap16.png", KreaInput.encodePng16(srcField)); }
    catch (e) { setGenError("No se pudo crear el PNG de 16 bits: " + (e && e.message || e)); }
  };

  // exporta el relieve TAL COMO SE VE (con contraste, invertir y suavizado aplicados),
  // como solido en mm, para trabajarlo en otro software (Blender, Aspire, etc.)
  $("stlSave").onclick = () => {
    const p = params();
    if (!prevH) { setGenError("Carga primero una fuente para exportar el STL."); return; }
    if (!(fin(p.W) && p.W > 0 && fin(p.H) && p.H > 0 && fin(p.depth) && p.depth > 0)) {
      setGenError("Revisa el ancho, el alto y la profundidad antes de exportar el STL."); return;
    }
    try {
      const blob = KreaInput.encodeStl({ w: prevW, h: prevHh, data: prevH }, p.W, p.H, p.depth);
      save((p.name || "mural") + ".stl", blob);
    } catch (e) { setGenError("No se pudo crear el STL: " + (e && e.message || e)); }
  };

  if (/claude\.ai|claudeusercontent|anthropic/.test(location.hostname)) $("sandboxNote").hidden = false;

  setTab("2d");
  setSource(sampleImage(), "ejemplo");
})();
