/**
 * Optimiza el robot nuevo (segmentación limpia, sin ojos que borrar):
 *  - deduplica y suelda vértices
 *  - simplifica la malla (reduce vértices manteniendo la silueta)
 *  - redimensiona texturas a 1024px
 *
 * Uso: node scripts/optimize-new.mjs <entrada.glb> <salida.glb>
 */
import { NodeIO } from '@gltf-transform/core'
import { dedup, weld, simplify, prune } from '@gltf-transform/functions'
import { MeshoptSimplifier } from 'meshoptimizer'
import Jimp from 'jimp'

const [, , input, output] = process.argv
if (!input || !output) {
  console.error('Uso: node scripts/optimize-new.mjs <entrada.glb> <salida.glb>')
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

console.log('Redimensionando texturas...')
const MAX_SIZE = 1024

/** Algunos PNG traen bytes extra tras IEND; pngjs es estricto y falla */
function trimPng(buffer) {
  const iend = buffer.indexOf(Buffer.from('IEND', 'ascii'))
  return iend === -1 ? buffer : buffer.subarray(0, iend + 8)
}

for (const texture of doc.getRoot().listTextures()) {
  const image = texture.getImage()
  if (!image) continue
  const img = await Jimp.read(trimPng(Buffer.from(image)))
  const { width, height } = img.bitmap
  if (Math.max(width, height) > MAX_SIZE) {
    img.resize(
      width >= height ? MAX_SIZE : Jimp.AUTO,
      height > width ? MAX_SIZE : Jimp.AUTO,
    )
  }
  const png = await img.getBufferAsync(Jimp.MIME_PNG)
  texture.setImage(new Uint8Array(png))
  texture.setMimeType('image/png')
  console.log(`  ${width}x${height} -> ${img.bitmap.width}x${img.bitmap.height}`)
}

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
