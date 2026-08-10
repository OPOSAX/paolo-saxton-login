/**
 * Optimiza el robot segmentado para web:
 *  - deduplica y suelda vértices
 *  - simplifica la malla (reduce vértices manteniendo la silueta)
 *  - redimensiona texturas a 1024px (jimp, JS puro)
 *
 * Uso: node scripts/optimize-robot.mjs <entrada.glb> <salida.glb>
 */
import { NodeIO } from '@gltf-transform/core'
import { dedup, weld, simplify, prune } from '@gltf-transform/functions'
import { MeshoptSimplifier } from 'meshoptimizer'
import Jimp from 'jimp'

const [, , input, output] = process.argv
if (!input || !output) {
  console.error('Uso: node scripts/optimize-robot.mjs <entrada.glb> <salida.glb>')
  process.exit(1)
}

const io = new NodeIO()
const doc = await io.read(input)

console.log('Simplificando malla...')
await doc.transform(
  dedup(),
  weld(),
  // error bajo: conserva rasgos pequeños (ojos, detalles de la cara)
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

/*
 * Borra los ojos pintados del modelo (quedan cubiertos por los ojos 3D
 * animados de la app). Coordenadas medidas sobre el atlas a 1024px de ancho.
 */
console.log('Borrando ojos pintados...')
const EYE_PATCHES = [
  { matIndex: 0, eyes: [{ x: 28, y: 778, r: 36 }, { x: 358, y: 790, r: 38 }] },
  { matIndex: 1, eyes: [{ x: 30, y: 760, r: 36 }, { x: 348, y: 773, r: 38 }] },
]
const FACE_COLOR = Jimp.rgbaToInt(138, 143, 78, 255) // verde oliva de la cara
const FLAT_NORMAL = Jimp.rgbaToInt(128, 128, 255, 255)

async function paintCircles(texture, eyes, color) {
  if (!texture) return
  const img = await Jimp.read(trimPng(Buffer.from(texture.getImage())))
  for (const e of eyes) {
    const x0 = Math.max(0, e.x - e.r)
    const y0 = Math.max(0, e.y - e.r)
    const x1 = Math.min(img.bitmap.width - 1, e.x + e.r)
    const y1 = Math.min(img.bitmap.height - 1, e.y + e.r)
    img.scan(x0, y0, x1 - x0 + 1, y1 - y0 + 1, function (px, py, idx) {
      if ((px - e.x) ** 2 + (py - e.y) ** 2 <= e.r * e.r) {
        this.bitmap.data.writeUInt32BE(color >>> 0, idx)
      }
    })
  }
  const png = await img.getBufferAsync(Jimp.MIME_PNG)
  texture.setImage(new Uint8Array(png))
}

const materials = doc.getRoot().listMaterials()
for (const patch of EYE_PATCHES) {
  const mat = materials[patch.matIndex]
  if (!mat) continue
  await paintCircles(mat.getBaseColorTexture(), patch.eyes, FACE_COLOR)
  await paintCircles(mat.getNormalTexture(), patch.eyes, FLAT_NORMAL)
  console.log(`  material[${patch.matIndex}]: ${patch.eyes.length} ojos cubiertos`)
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
