/**
 * Recolorea el polerón rojo a azul eléctrico directamente en la textura
 * del GLB, conservando sombras y desgaste (se cambia el tono, no el
 * brillo). No toca: capucha gris, ojos rojos brillantes, jeans, zapatos
 * ni manos oscuras.
 *
 * Uso: node scripts/recolor-hoodie.mjs <entrada.glb> <salida.glb>
 */
import { NodeIO } from '@gltf-transform/core'
import Jimp from 'jimp'

const [, , input, output] = process.argv
if (!input || !output) {
  console.error('Uso: node scripts/recolor-hoodie.mjs <entrada.glb> <salida.glb>')
  process.exit(1)
}

const io = new NodeIO()
const doc = await io.read(input)

const HUE_BLUE = 222 // azul eléctrico

function rgbToHsv(r, g, b) {
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  const d = mx - mn
  let hue = 0
  if (d > 0) {
    if (mx === r) hue = ((g - b) / d) % 6
    else if (mx === g) hue = (b - r) / d + 2
    else hue = (r - g) / d + 4
    hue *= 60
    if (hue < 0) hue += 360
  }
  return [hue, mx === 0 ? 0 : d / mx, mx / 255]
}

function hsvToRgb(hue, s, v) {
  const c = v * s
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = v - c
  let rgb
  if (hue < 60) rgb = [c, x, 0]
  else if (hue < 120) rgb = [x, c, 0]
  else if (hue < 180) rgb = [0, c, x]
  else if (hue < 240) rgb = [0, x, c]
  else if (hue < 300) rgb = [x, 0, c]
  else rgb = [c, 0, x]
  return rgb.map((u) => Math.round((u + m) * 255))
}

/*
 * Máscara de exclusión de OJOS: los triángulos UV de la malla "Eyes"
 * (inflados 2.2x para cubrir también el halo pintado en la cara) marcan
 * píxeles que el recoloreo no debe tocar.
 */
function buildEyeMask(tw, th) {
  const mask = new Uint8Array(tw * th)
  const eyesMesh = doc.getRoot().listMeshes().find((m) => m.getName() === 'Eyes')
  if (!eyesMesh) return mask
  for (const p of eyesMesh.listPrimitives()) {
    const uvA = p.getAttribute('TEXCOORD_0')
    const ind = p.getIndices()
    if (!uvA || !ind) continue
    const arr = ind.getArray()
    const t2 = [0, 0]
    for (let t = 0; t < arr.length; t += 3) {
      const pts = []
      let cx = 0
      let cy = 0
      for (let k = 0; k < 3; k++) {
        uvA.getElement(arr[t + k], t2)
        const px = t2[0] * (tw - 1)
        const py = t2[1] * (th - 1)
        pts.push([px, py])
        cx += px / 3
        cy += py / 3
      }
      // inflar el triángulo alrededor de su centroide
      const S = 2.2
      for (const q of pts) {
        q[0] = cx + (q[0] - cx) * S
        q[1] = cy + (q[1] - cy) * S
      }
      const minX = Math.max(0, Math.floor(Math.min(pts[0][0], pts[1][0], pts[2][0])))
      const maxX = Math.min(tw - 1, Math.ceil(Math.max(pts[0][0], pts[1][0], pts[2][0])))
      const minY = Math.max(0, Math.floor(Math.min(pts[0][1], pts[1][1], pts[2][1])))
      const maxY = Math.min(th - 1, Math.ceil(Math.max(pts[0][1], pts[1][1], pts[2][1])))
      const edge = (a, b, x, y) => (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0])
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const e0 = edge(pts[0], pts[1], x, y)
          const e1 = edge(pts[1], pts[2], x, y)
          const e2 = edge(pts[2], pts[0], x, y)
          if ((e0 >= 0 && e1 >= 0 && e2 >= 0) || (e0 <= 0 && e1 <= 0 && e2 <= 0)) {
            mask[y * tw + x] = 1
          }
        }
      }
    }
  }
  return mask
}

for (const texture of doc.getRoot().listTextures()) {
  const image = texture.getImage()
  if (!image) continue
  const img = await Jimp.read(Buffer.from(image))
  const tw = img.bitmap.width
  const th = img.bitmap.height
  const eyeMask = buildEyeMask(tw, th)
  let changed = 0
  img.scan(0, 0, tw, th, function (x, y, idx) {
    if (eyeMask[y * tw + x]) return // zona de ojos: intocable
    const r = this.bitmap.data[idx]
    const g = this.bitmap.data[idx + 1]
    const b = this.bitmap.data[idx + 2]
    const [hue, s, v] = rgbToHsv(r, g, b)
    // tela roja del polerón: tono rojizo-naranja, saturación media-alta.
    const isRedFabric = (hue <= 30 || hue >= 350) && s >= 0.3 && v >= 0.16
    if (isRedFabric) {
      // mismo brillo y desgaste, tono azul; saturación reforzada
      const [nr, ng, nb] = hsvToRgb(HUE_BLUE, Math.min(1, s * 1.25), v)
      this.bitmap.data[idx] = nr
      this.bitmap.data[idx + 1] = ng
      this.bitmap.data[idx + 2] = nb
      changed++
    }
  })
  console.log(`Píxeles recoloreados: ${changed} (máscara de ojos: ${eyeMask.reduce((a, m) => a + m, 0)} px)`)
  const jpg = await img.quality(88).getBufferAsync(Jimp.MIME_JPEG)
  texture.setImage(new Uint8Array(jpg))
  texture.setMimeType('image/jpeg')
}

await io.write(output, doc)
const { statSync } = await import('node:fs')
console.log(`${output} (${(statSync(output).size / 1024 / 1024).toFixed(2)} MB)`)
