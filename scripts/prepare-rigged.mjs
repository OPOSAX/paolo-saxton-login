/**
 * Prepara el robot riggeado para web:
 *  - deduplica, suelda y simplifica conservando JOINTS/WEIGHTS (rigging)
 *  - separa los OJOS como malla propia (mismo skin) para poder
 *    prenderlos/apagarlos al pestañear; se detectan por color claro
 *    crema en la franja alta de la cara
 *
 * Uso: node scripts/prepare-rigged.mjs <entrada.glb> <salida.glb> [fracciónYMinOjos]
 */
import { NodeIO } from '@gltf-transform/core'
import { dedup, weld, simplify, prune } from '@gltf-transform/functions'
import { MeshoptSimplifier } from 'meshoptimizer'
import Jimp from 'jimp'

const [, , input, output, eyeFracArg] = process.argv
if (!input || !output) {
  console.error('Uso: node scripts/prepare-rigged.mjs <entrada.glb> <salida.glb> [fracciónYMinOjos]')
  process.exit(1)
}
const EYE_MIN_FRAC = eyeFracArg ? Number(eyeFracArg) : 0.7

const io = new NodeIO()
const doc = await io.read(input)

console.log('Simplificando malla (conservando rigging)...')
await doc.transform(
  dedup(),
  weld(),
  simplify({ simplifier: MeshoptSimplifier, error: 0.0004 }),
  prune(),
)

const root = doc.getRoot()
const mesh0 = root.listMeshes()[0]
const prim = mesh0.listPrimitives()[0]
console.log(`Atributos tras simplificar: [${prim.listSemantics().join(', ')}]`)
const pos = prim.getAttribute('POSITION')
const uv = prim.getAttribute('TEXCOORD_0')
const idx = prim.getIndices()
const idxArr = idx.getArray()

const bbMin = pos.getMin([0, 0, 0])
const bbMax = pos.getMax([0, 0, 0])
console.log(
  `Caja: min=[${bbMin.map((x) => x.toFixed(3))}] max=[${bbMax.map((x) => x.toFixed(3))}]`,
)
const h = bbMax[1] - bbMin[1]

// textura para detectar los ojos color crema
const mat = prim.getMaterial()
const img = await Jimp.read(Buffer.from(mat.getBaseColorTexture().getImage()))
const tw = img.bitmap.width
const th = img.bitmap.height
const t2 = [0, 0]
function isPaleVert(i) {
  uv.getElement(i, t2)
  const x = Math.min(tw - 1, Math.max(0, Math.round(t2[0] * (tw - 1))))
  const y = Math.min(th - 1, Math.max(0, Math.round(t2[1] * (th - 1))))
  const c = Jimp.intToRGBA(img.getPixelColor(x, y))
  const mx = Math.max(c.r, c.g, c.b)
  const mn = Math.min(c.r, c.g, c.b)
  const lum = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b
  // crema: claro, poco saturado, cálido (r y g por encima de b)
  return lum > 150 && (mx - mn) / Math.max(1, mx) < 0.45 && c.b <= c.g
}

const v = [0, 0, 0]
const EYE_MIN_Y = bbMin[1] + h * EYE_MIN_FRAC
const eyesIdx = []
const bodyIdx = []
let eyeMinY = Infinity
let eyeMaxY = -Infinity
for (let t = 0; t < idxArr.length; t += 3) {
  const a = idxArr[t]
  const b = idxArr[t + 1]
  const c = idxArr[t + 2]
  pos.getElement(a, v)
  let cy = v[1]
  pos.getElement(b, v)
  cy += v[1]
  pos.getElement(c, v)
  cy += v[1]
  cy /= 3
  const pale = (isPaleVert(a) ? 1 : 0) + (isPaleVert(b) ? 1 : 0) + (isPaleVert(c) ? 1 : 0)
  if (cy >= EYE_MIN_Y && pale >= 2) {
    eyesIdx.push(a, b, c)
    if (cy < eyeMinY) eyeMinY = cy
    if (cy > eyeMaxY) eyeMaxY = cy
  } else {
    bodyIdx.push(a, b, c)
  }
}
console.log(
  `Ojos: ${eyesIdx.length / 3} tris (y=[${eyeMinY.toFixed(3)}, ${eyeMaxY.toFixed(3)}]) — cuerpo: ${bodyIdx.length / 3} tris`,
)

// nodo original con el skin
const skinnedNode = root.listNodes().find((n) => n.getMesh() === mesh0)
const skin = skinnedNode.getSkin()

const buffer = root.listBuffers()[0]
function subsetMesh(name, indices) {
  const acc = doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(indices)).setBuffer(buffer)
  const p = doc.createPrimitive().setIndices(acc).setMaterial(prim.getMaterial())
  for (const sem of prim.listSemantics()) p.setAttribute(sem, prim.getAttribute(sem))
  return doc.createMesh(name).addPrimitive(p)
}

if (eyesIdx.length) {
  const parent = skinnedNode.getParentNode()
  const eyesMesh = subsetMesh('Eyes', eyesIdx)
  const eyesNode = doc.createNode('Eyes').setMesh(eyesMesh).setSkin(skin)
  parent ? parent.addChild(eyesNode) : root.getDefaultScene().addChild(eyesNode)
  // el cuerpo pasa a ser una malla nueva sin los ojos
  const bodyMesh = subsetMesh('Body', bodyIdx)
  skinnedNode.setMesh(bodyMesh).setName('Body')
  mesh0.dispose()
}
await doc.transform(prune())

await io.write(output, doc)
const { statSync } = await import('node:fs')
console.log(`${input} -> ${output} (${(statSync(output).size / 1024 / 1024).toFixed(2)} MB)`)
