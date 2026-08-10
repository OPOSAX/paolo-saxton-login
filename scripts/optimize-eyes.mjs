/**
 * Optimiza el modelo de ojos: simplifica malla y reduce texturas a 512px
 * (los ojos ocupan poca pantalla).
 *
 * Uso: node scripts/optimize-eyes.mjs <entrada.glb> <salida.glb>
 */
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, weld, simplify, prune } from '@gltf-transform/functions'
import { MeshoptSimplifier } from 'meshoptimizer'
import Jimp from 'jimp'

const [, , input, output] = process.argv

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const doc = await io.read(input)

console.log('Simplificando malla...')
await doc.transform(
  dedup(),
  weld(),
  simplify({ simplifier: MeshoptSimplifier, error: 0.001 }),
  prune(),
)

console.log('Redimensionando texturas...')
const MAX_SIZE = 512

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
    img.resize(width >= height ? MAX_SIZE : Jimp.AUTO, height > width ? MAX_SIZE : Jimp.AUTO)
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
