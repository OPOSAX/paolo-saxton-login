/* Krea3D - estimacion de profundidad con IA (Depth Anything small, ONNX via transformers.js).
   Todo corre en el navegador: el modelo (~50 MB) se descarga una sola vez de la CDN y queda
   en cache; la imagen nunca se sube a ningun servidor. */
(function (root) {
  "use strict";
  const CDN = "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2";
  const MODEL = "Xenova/depth-anything-small-hf";
  let pipePromise = null;

  function getPipe(onProgress) {
    if (!pipePromise) {
      pipePromise = (async () => {
        const T = await import(CDN);
        T.env.allowLocalModels = false;
        return T.pipeline("depth-estimation", MODEL, {
          quantized: true,
          progress_callback: (ev) => {
            if (ev && ev.status === "progress" && onProgress) onProgress("descarga", ev.progress || 0);
          },
        });
      })();
      pipePromise.catch(() => { pipePromise = null; });   // permite reintentar si fallo la descarga
    }
    return pipePromise;
  }

  /** canvas -> {w, h, data: Float32Array 0..1} (mas cerca de la camara = mas alto). */
  async function estimate(canvas, onProgress) {
    const pipe = await getPipe(onProgress);
    onProgress && onProgress("calculo", 100);
    const blob = await new Promise((res, rej) =>
      canvas.toBlob((b) => (b ? res(b) : rej(new Error("no se pudo leer la imagen"))), "image/png"));
    const url = URL.createObjectURL(blob);
    try {
      const out = await pipe(url);
      const t = out.predicted_depth;
      const dims = t.dims;
      const h = dims[dims.length - 2], w = dims[dims.length - 1];
      const d = t.data;
      let mn = Infinity, mx = -Infinity;
      for (let i = 0; i < w * h; i++) { const v = d[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
      const span = mx - mn || 1;
      const data = new Float32Array(w * h);
      for (let i = 0; i < w * h; i++) data[i] = (d[i] - mn) / span;   // profundidad inversa: mayor = cerca = alto
      return { w, h, data };
    } finally { URL.revokeObjectURL(url); }
  }

  root.KreaDepth = { estimate };
})(typeof self !== "undefined" ? self : this);
