/**
 * Muestra la transformación del nodo y la caja del modelo, y estima hacia
 * dónde mira comparando la profundidad (Z) de la mitad frontal vs trasera.
 * Uso: node scripts/inspect-orientation.mjs <archivo.glb>
 */
import { NodeIO } from '@gltf-transform/core'

const io = new NodeIO()
const doc = await io.read(process.argv[2])

for (const node of doc.getRoot().listNodes()) {
  console.log(`node "${node.getName()}"`)
  console.log(`  t=${node.getTranslation()} r=${node.getRotation()} s=${node.getScale()}`)
}

for (const mesh of doc.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION')
    if (!pos) continue
    const n = pos.getCount()
    const min = [Infinity, Infinity, Infinity]
    const max = [-Infinity, -Infinity, -Infinity]
    const v = [0, 0, 0]
    // histograma de Y para ver dónde se concentra la masa (piso/base)
    const yHist = new Array(10).fill(0)
    for (let i = 0; i < n; i++) {
      pos.getElement(i, v)
      for (let a = 0; a < 3; a++) {
        if (v[a] < min[a]) min[a] = v[a]
        if (v[a] > max[a]) max[a] = v[a]
      }
    }
    const h = max[1] - min[1]
    for (let i = 0; i < n; i++) {
      pos.getElement(i, v)
      const bin = Math.min(9, Math.floor(((v[1] - min[1]) / h) * 10))
      yHist[bin]++
    }
    console.log(`mesh "${mesh.getName()}" verts=${n}`)
    console.log(`  min=[${min.map((x) => x.toFixed(3))}] max=[${max.map((x) => x.toFixed(3))}]`)
    console.log(`  distribución Y (abajo→arriba): ${yHist.map((c) => ((c / n) * 100).toFixed(1) + '%').join(' ')}`)
  }
}
