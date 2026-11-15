/* Krea3D - calculo pesado fuera de la pagina para que no se congele.
   Mensajes que envia: {type:"progress", f, msg}
                       {type:"done", files}   files = [{name, op, tile, origin, size, lines, minutes, bytes, parts, warnings}]
                       {type:"error", msg, errors?}   errors = lista de Krea.validate si los parametros no valen */
importScripts("core.js");

self.onmessage = (e) => {
  const { lum, w, h, res, p } = e.data;
  try {
    const errors = Krea.validate(p);
    if (errors.length) { self.postMessage({ type: "error", msg: errors.join(" "), errors }); return; }
    const H = Krea.prepHeight(lum, w, h, res, p);
    let lastT = 0;
    const files = Krea.generate({ H, w, h, res }, p, (f, msg) => {
      const now = Date.now();
      if (now - lastT > 120 || f >= 1) { lastT = now; self.postMessage({ type: "progress", f, msg }); }
    });
    self.postMessage({ type: "done", files });
  } catch (err) {
    self.postMessage({ type: "error", msg: String((err && err.message) || err) });
  }
};
