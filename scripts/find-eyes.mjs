import { NodeIO } from '@gltf-transform/core'
import Jimp from 'jimp'

const io = new NodeIO()
const doc = await io.read(process.argv[2])
const outDir = process.argv[3]
const root = doc.getRoot()
const textures = root.listTextures()

function trimPng(buffer) {
  const iend = buffer.indexOf(Buffer.from('IEND', 'ascii'))
  return iend === -1 ? buffer : buffer.subarray(0, iend + 8)
}

root.listMaterials().forEach((mat, i) => {
  const base = mat.getBaseColorTexture()
  console.log(`material[${i}] baseColor -> texture index ${base ? textures.indexOf(base) : 'ninguna'}`)
})

// recortes alrededor de las zonas sospechosas (coordenadas en escala 1024)
const zones = [
  { name: 'a', x: 0, y: 690, w: 160, h: 180 },
  { name: 'b', x: 270, y: 690, w: 180, h: 190 },
]

for (const [mi, mat] of root.listMaterials().entries()) {
  const base = mat.getBaseColorTexture()
  if (!base) continue
  const img = await Jimp.read(trimPng(Buffer.from(base.getImage())))
  img.resize(1024, Jimp.AUTO)
  for (const z of zones) {
    const crop = img.clone().crop(z.x, z.y, z.w, z.h).resize(z.w * 3, Jimp.AUTO)
    const file = `${outDir}/mat${mi}-zona-${z.name}.png`
    await crop.writeAsync(file)
    console.log(`  ${file}`)
  }
}
