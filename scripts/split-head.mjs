/**
 * Separa la cabeza (con capucha completa) del cuerpo en el GLB de una
 * sola pieza, usando el COLOR de la textura: la capucha es gris oscura y
 * la sudadera roja/naranja, así que un triángulo es cabeza si está en la
 * mitad superior o si es oscuro cerca del cuello (borde de la capucha).
 * El resultado es un GLB con dos mallas: "Head" y "Body".
 *
 * Uso: node scripts/split-head.mjs <unapieza.glb> <salida.glb>
 */
import { NodeIO } from '@gltf-transform/core'
import { prune } from '@gltf-transform/functions'
import Jimp from 'jimp'

const [, , srcPath, outPath] = process.argv
if (!srcPath || !outPath) {
  console.error('Uso: node scripts/split-head.mjs <unapieza.glb> <salida.glb>')
  process.exit(1)
}

const io = new NodeIO()
const doc = await io.read(srcPath)
const mesh0 = doc.getRoot().listMeshes()[0]
const prim = mesh0.listPrimitives()[0]
const pos = prim.getAttribute('POSITION')
const uv = prim.getAttribute('TEXCOORD_0')
const idx = prim.getIndices()
const idxArr = idx.getArray()

// textura base para leer colores; se reduce y desenfoca para que las
// manchas oscuras de la sudadera se tiñan del rojo circundante y no se
// confundan con el gris uniforme de la capucha
const mat = prim.getMaterial()
const texImage = mat.getBaseColorTexture().getImage()
const img = await Jimp.read(Buffer.from(texImage))
img.resize(1024, Jimp.AUTO)
const imgSharp = img.clone() // sin desenfocar: para cordones y ojos
img.blur(4)
const tw = img.bitmap.width
const th = img.bitmap.height

const bbMin = pos.getMin([0, 0, 0])
const bbMax = pos.getMax([0, 0, 0])
const h = bbMax[1] - bbMin[1]
// umbrales en fracción de la altura total del personaje
const SURE_HEAD_Y = bbMin[1] + h * 0.52 // por encima: siempre cabeza
const HOOD_MIN_Y = bbMin[1] + h * 0.32 // por debajo: nunca capucha
const HOOD_MAX_LUM = 150 // la capucha es gris medio-oscuro...
const HOOD_MAX_SAT = 0.25 // ...y desaturada (la tela roja no)

const v = [0, 0, 0]
const t2 = [0, 0]

/** ¿el color (desenfocado) en este vértice parece gris de capucha? */
function isDarkAt(vertIndex) {
  uv.getElement(vertIndex, t2)
  const x = Math.min(tw - 1, Math.max(0, Math.round(t2[0] * (tw - 1))))
  const y = Math.min(th - 1, Math.max(0, Math.round(t2[1] * (th - 1))))
  const c = Jimp.intToRGBA(img.getPixelColor(x, y))
  const lum = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b
  const mx = Math.max(c.r, c.g, c.b)
  const mn = Math.min(c.r, c.g, c.b)
  const sat = mx === 0 ? 0 : (mx - mn) / mx
  return lum < HOOD_MAX_LUM && sat < HOOD_MAX_SAT
}

/*
 * La cabeza se obtiene por EXPANSIÓN: se parte de los triángulos de la
 * mitad superior (seguro cabeza) y se crece a través de triángulos
 * oscuros conectados (el borde de la capucha). Otras zonas oscuras del
 * cuerpo (dobladillo, logo del pecho, manos) no están conectadas a la
 * capucha por tela oscura, así que quedan en el cuerpo.
 */
const triCount = idxArr.length / 3
const triCY = new Float32Array(triCount)
const triDark = new Uint8Array(triCount)
for (let t = 0; t < triCount; t++) {
  const a = idxArr[t * 3]
  const b = idxArr[t * 3 + 1]
  const c = idxArr[t * 3 + 2]
  pos.getElement(a, v)
  let cy = v[1]
  pos.getElement(b, v)
  cy += v[1]
  pos.getElement(c, v)
  cy += v[1]
  triCY[t] = cy / 3
  const dark = (isDarkAt(a) ? 1 : 0) + (isDarkAt(b) ? 1 : 0) + (isDarkAt(c) ? 1 : 0)
  triDark[t] = dark >= 2 ? 1 : 0
}

// adyacencia por vértice soldado (las costuras de UV duplican vértices)
const keyToRep = new Map()
const rep = new Int32Array(pos.getCount())
for (let i = 0; i < pos.getCount(); i++) {
  pos.getElement(i, v)
  const key = `${Math.round(v[0] * 1e5)},${Math.round(v[1] * 1e5)},${Math.round(v[2] * 1e5)}`
  const r = keyToRep.get(key)
  if (r === undefined) {
    keyToRep.set(key, i)
    rep[i] = i
  } else {
    rep[i] = r
  }
}
const vertTris = new Map() // vértice soldado -> triángulos que lo usan
for (let t = 0; t < triCount; t++) {
  for (let k = 0; k < 3; k++) {
    const r = rep[idxArr[t * 3 + k]]
    let list = vertTris.get(r)
    if (!list) {
      list = []
      vertTris.set(r, list)
    }
    list.push(t)
  }
}

const isHeadTri = new Uint8Array(triCount)
const queue = []
for (let t = 0; t < triCount; t++) {
  if (triCY[t] >= SURE_HEAD_Y) {
    isHeadTri[t] = 1
    queue.push(t)
  }
}
while (queue.length) {
  const t = queue.pop()
  for (let k = 0; k < 3; k++) {
    const r = rep[idxArr[t * 3 + k]]
    for (const nt of vertTris.get(r)) {
      if (isHeadTri[nt]) continue
      // solo crece por la capucha: triángulos oscuros no muy abajo
      if (triDark[nt] && triCY[nt] >= HOOD_MIN_Y) {
        isHeadTri[nt] = 1
        queue.push(nt)
      }
    }
  }
}

/*
 * Dentro de la cabeza se separan además:
 *  - "Eyes": los ojos rojos brillantes (para prender/apagar al pestañear)
 * Los cordones claros que cuelgan de la capucha se pasan al CUERPO para
 * que queden quietos sobre el pecho (como en la foto de referencia) y no
 * giren tiesos con la cabeza.
 */
function sharpColorAt(vertIndex) {
  uv.getElement(vertIndex, t2)
  const x = Math.min(tw - 1, Math.max(0, Math.round(t2[0] * (tw - 1))))
  const y = Math.min(th - 1, Math.max(0, Math.round(t2[1] * (th - 1))))
  return Jimp.intToRGBA(imgSharp.getPixelColor(x, y))
}
function isEyeVert(i) {
  const c = sharpColorAt(i)
  return c.r > 140 && c.r > c.g * 1.8 && c.r > c.b * 1.8
}
function isCordVert(i) {
  const c = sharpColorAt(i)
  const lum = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b
  const mx = Math.max(c.r, c.g, c.b)
  const mn = Math.min(c.r, c.g, c.b)
  const sat = mx === 0 ? 0 : (mx - mn) / mx
  return lum > 140 && sat < 0.4
}

const CORD_MAX_Y = bbMin[1] + h * 0.58 // los cordones cuelgan bajo el mentón
const EYE_MIN_Y = bbMin[1] + h * 0.55 // los ojos están arriba en la cara

// clasificación por triángulo: 0 = cuerpo, 1 = cabeza, 2 = ojos
const triClass = new Uint8Array(triCount)
const triCord = new Uint8Array(triCount) // votos de color de cordón (0-3)
const triCX = new Float32Array(triCount)
const triCZ = new Float32Array(triCount)
for (let t = 0; t < triCount; t++) {
  const a = idxArr[t * 3]
  const b = idxArr[t * 3 + 1]
  const c = idxArr[t * 3 + 2]
  // centroide (para restricciones de posición)
  pos.getElement(a, v)
  let cx = v[0]
  let cz = v[2]
  pos.getElement(b, v)
  cx += v[0]
  cz += v[2]
  pos.getElement(c, v)
  cx += v[0]
  cz += v[2]
  triCX[t] = cx / 3
  triCZ[t] = cz / 3
  triCord[t] = (isCordVert(a) ? 1 : 0) + (isCordVert(b) ? 1 : 0) + (isCordVert(c) ? 1 : 0)

  if (!isHeadTri[t]) {
    triClass[t] = 0
    continue
  }
  const cy = triCY[t]
  const eyeVotes = (isEyeVert(a) ? 1 : 0) + (isEyeVert(b) ? 1 : 0) + (isEyeVert(c) ? 1 : 0)
  /*
   * Franja central del pecho (delante, bajo la cara): aquí conviven el
   * borde de la capucha, los cordones y la tela roja. Solo lo gris
   * oscuro de capucha/cara sigue a la cabeza; cordones y tela roja se
   * quedan quietos en el cuerpo. Evita esquirlas flotantes al girar.
   * Tope al 58%: bajo la cara, lejos del halo rojo de los ojos.
   */
  const inCordStrip = triCX[t] > 0.02 && Math.abs(triCZ[t]) < 0.1 && cy <= bbMin[1] + h * 0.58
  // los ojos solo existen en la cara delantera; el rojo brillante de la
  // parte trasera (cuello del polerón) no debe colarse aquí
  if (eyeVotes >= 2 && cy >= EYE_MIN_Y && triCX[t] > 0.05) {
    triClass[t] = 2
  } else if (inCordStrip) {
    const darkVotes = (isDarkAt(a) ? 1 : 0) + (isDarkAt(b) ? 1 : 0) + (isDarkAt(c) ? 1 : 0)
    triClass[t] = darkVotes >= 2 ? 1 : 0
  } else if (triCord[t] >= 2 && cy <= CORD_MAX_Y && triCX[t] > 0.02) {
    // cx > 0: mitad delantera (el modelo original mira a +X)
    triClass[t] = 0
  } else {
    triClass[t] = 1
  }
}

/*
 * Los cordones "reclaman" su tramo superior: desde los triángulos de
 * cordón ya asignados al cuerpo se crece por conectividad hacia los
 * triángulos claros que quedaron en la cabeza (el anclaje del cordón en
 * la capucha), para que el cordón COMPLETO quede quieto en el polerón.
 * Las motas de pintura clara de la capucha no se tocan: no están
 * conectadas a los cordones por tela clara.
 */
const CORD_TOP_Y = bbMin[1] + h * 0.72
const cordQueue = []
for (let t = 0; t < triCount; t++) {
  if (triClass[t] === 0 && triCord[t] >= 2 && triCX[t] > 0.02 && Math.abs(triCZ[t]) < 0.12) {
    cordQueue.push(t)
  }
}
let claimed = 0
while (cordQueue.length) {
  const t = cordQueue.pop()
  for (let k = 0; k < 3; k++) {
    const r = rep[idxArr[t * 3 + k]]
    for (const nt of vertTris.get(r)) {
      if (triClass[nt] !== 1) continue
      if (triCord[nt] >= 1 && triCY[nt] <= CORD_TOP_Y && triCX[nt] > 0.02) {
        triClass[nt] = 0
        claimed++
        cordQueue.push(nt)
      }
    }
  }
}

/*
 * Pulcritud de la cabeza: nada que no sea capucha puede colgar de ella.
 * Criterio adaptativo: se mide el color promedio real de la capucha
 * (zona alta, capucha segura) y el rojo del polerón (pecho delantero), y
 * cada triángulo de la cabeza se queda solo si su color desenfocado está
 * más cerca de la capucha que del rojo. Además, nada puede colgar por
 * debajo del borde delantero.
 */
function blurColorAt(vertIndex) {
  uv.getElement(vertIndex, t2)
  const x = Math.min(tw - 1, Math.max(0, Math.round(t2[0] * (tw - 1))))
  const y = Math.min(th - 1, Math.max(0, Math.round(t2[1] * (th - 1))))
  return Jimp.intToRGBA(img.getPixelColor(x, y))
}
const hoodMean = [0, 0, 0]
const redMean = [0, 0, 0]
let hoodN = 0
let redN = 0
for (let t = 0; t < triCount; t++) {
  const a = idxArr[t * 3]
  if (triClass[t] === 1 && triCY[t] > bbMin[1] + h * 0.8) {
    const c = blurColorAt(a)
    hoodMean[0] += c.r
    hoodMean[1] += c.g
    hoodMean[2] += c.b
    hoodN++
  } else if (triClass[t] === 0 && triCX[t] > 0.05 && triCY[t] > bbMin[1] + h * 0.36 && triCY[t] < bbMin[1] + h * 0.46) {
    const c = blurColorAt(a)
    redMean[0] += c.r
    redMean[1] += c.g
    redMean[2] += c.b
    redN++
  }
}
for (let k = 0; k < 3; k++) {
  hoodMean[k] /= Math.max(1, hoodN)
  redMean[k] /= Math.max(1, redN)
}
console.log(
  `Color capucha: rgb(${hoodMean.map((x) => x.toFixed(0))}) — color polerón: rgb(${redMean.map((x) => x.toFixed(0))})`,
)
function isRedVert(i) {
  const c = blurColorAt(i)
  const dHood = (c.r - hoodMean[0]) ** 2 + (c.g - hoodMean[1]) ** 2 + (c.b - hoodMean[2]) ** 2
  const dRed = (c.r - redMean[0]) ** 2 + (c.g - redMean[1]) ** 2 + (c.b - redMean[2]) ** 2
  return dRed < dHood
}
let fringe = 0
for (let t = 0; t < triCount; t++) {
  if (triClass[t] !== 1) continue
  const a = idxArr[t * 3]
  const b = idxArr[t * 3 + 1]
  const c = idxArr[t * 3 + 2]
  const redVotes = (isRedVert(a) ? 1 : 0) + (isRedVert(b) ? 1 : 0) + (isRedVert(c) ? 1 : 0)
  const lowFront = triCX[t] > 0.02 && triCY[t] < bbMin[1] + h * 0.52
  // atrás la capucha termina más arriba: piso duro que corta la pelusa
  // del cuello del polerón (rojo en sombra que engaña al clasificador)
  const lowBack = triCX[t] <= 0.02 && triCY[t] < bbMin[1] + h * 0.605
  // en el borde inferior de la capucha basta UN voto rojo: los
  // triángulos frontera no dejan restos colgando
  const lowEdge = triCY[t] < bbMin[1] + h * 0.62
  if (redVotes >= 2 || (redVotes >= 1 && lowEdge) || lowFront || lowBack) {
    triClass[t] = 0
    fringe++
  }
}
console.log(`Pulcritud: ${fringe} triángulos que colgaban de la cabeza pasan al cuerpo`)

/*
 * Limpieza final: nada de esquirlas sueltas. La cabeza conserva SOLO su
 * componente conexa principal (capucha + cara); cualquier isla suelta
 * clasificada como cabeza pasa al cuerpo (eran los restos que colgaban).
 * Y al revés: islas pequeñas del cuerpo incrustadas en la zona alta de
 * la capucha pasan a la cabeza (motas que quedarían flotando al girar).
 */
function componentsOf(classId) {
  const comp = new Int32Array(triCount).fill(-1)
  const comps = []
  for (let t = 0; t < triCount; t++) {
    if (triClass[t] !== classId || comp[t] !== -1) continue
    const tris = []
    const stack = [t]
    comp[t] = comps.length
    while (stack.length) {
      const u = stack.pop()
      tris.push(u)
      for (let k = 0; k < 3; k++) {
        const r = rep[idxArr[u * 3 + k]]
        for (const nt of vertTris.get(r)) {
          if (triClass[nt] !== classId || comp[nt] !== -1) continue
          comp[nt] = comps.length
          stack.push(nt)
        }
      }
    }
    let minY = Infinity
    let maxY = -Infinity
    for (const u of tris) {
      if (triCY[u] < minY) minY = triCY[u]
      if (triCY[u] > maxY) maxY = triCY[u]
    }
    comps.push({ tris, minY, maxY })
  }
  comps.sort((p, q) => q.tris.length - p.tris.length)
  return comps
}

const headComps = componentsOf(1)
let headStray = 0
for (let i = 1; i < headComps.length; i++) {
  for (const u of headComps[i].tris) triClass[u] = 0
  headStray += headComps[i].tris.length
}
const bodyComps = componentsOf(0)
let bodyStray = 0
for (let i = 1; i < bodyComps.length; i++) {
  const cpt = bodyComps[i]
  // solo islas pequeñas metidas en la zona alta (capucha); los cordones
  // son grandes y bajan hasta el pecho, no se tocan
  if (cpt.tris.length < 400 && cpt.minY >= bbMin[1] + h * 0.55) {
    for (const u of cpt.tris) triClass[u] = 1
    bodyStray += cpt.tris.length
  }
}
console.log(`Limpieza: ${headComps.length - 1} islas de cabeza al cuerpo (${headStray} tris), ${bodyStray} tris del cuerpo a la cabeza`)

const headIdx = []
const bodyIdx = []
const eyesIdx = []
for (let t = 0; t < triCount; t++) {
  const target = triClass[t] === 2 ? eyesIdx : triClass[t] === 1 ? headIdx : bodyIdx
  target.push(idxArr[t * 3], idxArr[t * 3 + 1], idxArr[t * 3 + 2])
}
console.log(
  `Triángulos: cabeza=${headIdx.length / 3} cuerpo=${bodyIdx.length / 3} ojos=${eyesIdx.length / 3} (anclaje de cordones reclamado: ${claimed})`,
)

let hMinY = Infinity
for (let t = 0; t < headIdx.length; t++) {
  pos.getElement(headIdx[t], v)
  if (v[1] < hMinY) hMinY = v[1]
}
console.log(
  `La capucha llega hasta y=${hMinY.toFixed(3)} (${(((hMinY - bbMin[1]) / h) * 100).toFixed(0)}% de la altura)`,
)

// ---- escribir GLB con las mallas "Head" y "Body" ----
const buffer = doc.getRoot().listBuffers()[0]
function subsetMesh(name, indices) {
  const acc = doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(indices)).setBuffer(buffer)
  const p = doc.createPrimitive().setIndices(acc).setMaterial(prim.getMaterial())
  for (const sem of prim.listSemantics()) p.setAttribute(sem, prim.getAttribute(sem))
  return doc.createMesh(name).addPrimitive(p)
}
const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]
scene.addChild(doc.createNode('Head').setMesh(subsetMesh('Head', headIdx)))
scene.addChild(doc.createNode('Body').setMesh(subsetMesh('Body', bodyIdx)))
if (eyesIdx.length) scene.addChild(doc.createNode('Eyes').setMesh(subsetMesh('Eyes', eyesIdx)))
for (const node of doc.getRoot().listNodes()) {
  if (node.getMesh() === mesh0) node.dispose()
}
mesh0.dispose()
await doc.transform(prune())

await io.write(outPath, doc)
const { statSync } = await import('node:fs')
console.log(`${outPath} (${(statSync(outPath).size / 1024 / 1024).toFixed(2)} MB)`)
