/**
 * Optimiza el robot de una sola pieza (sin segmentación):
 *  - deduplica y suelda vértices
 *  - simplifica la malla (reduce vértices manteniendo la silueta)
 *  - la textura JPEG se deja tal cual (ya es liviana)
 *
 * Uso: node scripts/optimize-solo.mjs <entrada.glb> <salida.glb>
 */
import { NodeIO } from '@gltf-transform/core'
import { dedup, weld, simplify, prune } from '@gltf-transform/functions'
import { MeshoptSimplifier } from 'meshoptimizer'

const [, , input, output] = process.argv
if (!input || !output) {
  console.error('Uso: node scripts/optimize-solo.mjs <entrada.glb> <salida.glb>')
  process.exit(1)
}

const io = new NodeIO()
const doc = await io.read(input)

console.log('Simplificando malla...')
await doc.transform(
  dedup(),
  weld(),
  // error bajo: conserva rasgos pequeños (cara, detalles)
  simplify({ simplifier: MeshoptSimplifier, error: 0.0004 }),
  prune(),
)

await io.write(output, doc)

const { statSync } = await import('node:fs')
const mb = (f) => (statSync(f).size / 1024 / 1024).toFixed(2)
console.log(`\n${input} (${mb(input)} MB) -> ${output} (${mb(output)} MB)`)

let totalVerts = 0
for (const mesh of doc.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    totalVerts += prim.getAttribute('POSITION')?.getCount() ?? 0
  }
}
console.log(`Vértices finales: ${totalVerts}`)
