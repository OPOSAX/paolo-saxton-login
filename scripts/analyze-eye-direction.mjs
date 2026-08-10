/**
 * Encuentra hacia dónde mira cada ojo: muestrea el color de la textura por
 * vértice y calcula el centroide de los vértices negros (pupila) respecto al
 * centro del ojo. Imprime el vector de mirada por mitad (izq/der).
 */
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import Jimp from 'jimp'

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const doc = await io.read(process.argv[2])
const root = doc.getRoot()

const mat = root.listMaterials()[0]
const baseTex = mat.getBaseColorTexture()

function trimPng(buffer) {
  const iend = buffer.indexOf(Buffer.from('IEND', 'ascii'))
  return iend === -1 ? buffer : buffer.subarray(0, iend + 8)
}
const img = await Jimp.read(trimPng(Buffer.from(baseTex.getImage())))
const W = img.bitmap.width
const H = img.bitmap.height

const prim = root.listMeshes()[0].listPrimitives()[0]
const pos = prim.getAttribute('POSITION')
const uv = prim.getAttribute('TEXCOORD_0')
if (!uv) {
  console.log('sin UVs')
  process.exit(1)
}

const halves = { izq: { dark: [0, 0, 0, 0], all: [0, 0, 0, 0] }, der: { dark: [0, 0, 0, 0], all: [0, 0, 0, 0] } }

const p = [0, 0, 0]
const t = [0, 0]
for (let i = 0; i < pos.getCount(); i++) {
  pos.getElement(i, p)
  uv.getElement(i, t)
  const px = Math.min(W - 1, Math.max(0, Math.round(t[0] * (W - 1))))
  const py = Math.min(H - 1, Math.max(0, Math.round(t[1] * (H - 1))))
  const c = Jimp.intToRGBA(img.getPixelColor(px, py))
  const half = p[0] < 0 ? halves.izq : halves.der
  half.all[0] += p[0]; half.all[1] += p[1]; half.all[2] += p[2]; half.all[3]++
  if (c.r < 60 && c.g < 60 && c.b < 60) {
    half.dark[0] += p[0]; half.dark[1] += p[1]; half.dark[2] += p[2]; half.dark[3]++
  }
}

for (const [name, h] of Object.entries(halves)) {
  if (!h.all[3] || !h.dark[3]) { console.log(`${name}: sin datos (dark=${h.dark[3]})`); continue }
  const cAll = h.all.slice(0, 3).map((v) => v / h.all[3])
  const cDark = h.dark.slice(0, 3).map((v) => v / h.dark[3])
  const d = cDark.map((v, i) => v - cAll[i])
  const len = Math.hypot(...d)
  console.log(`${name}: centro (${cAll.map((v) => v.toFixed(3)).join(', ')})`)
  console.log(`  pupila en (${cDark.map((v) => v.toFixed(3)).join(', ')})  [${h.dark[3]} vértices]`)
  console.log(`  dirección de mirada: (${d.map((v) => (v / len).toFixed(3)).join(', ')})`)
}
