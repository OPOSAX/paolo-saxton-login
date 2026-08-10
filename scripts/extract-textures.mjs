import { NodeIO } from '@gltf-transform/core'
import { writeFileSync } from 'node:fs'

const io = new NodeIO()
const doc = await io.read(process.argv[2])
const outDir = process.argv[3]

const root = doc.getRoot()

root.listMaterials().forEach((mat, i) => {
  console.log(`material[${i}] ${mat.getName()}`)
  const base = mat.getBaseColorTexture()
  console.log(`  baseColor: ${base ? base.getName() || '(sin nombre)' : 'ninguna'}`)
})

root.listTextures().forEach((tex, i) => {
  const img = tex.getImage()
  if (!img) return
  const file = `${outDir}/tex-${i}-${(tex.getName() || 'sin-nombre').replace(/[^\w-]/g, '_')}.png`
  writeFileSync(file, Buffer.from(img))
  console.log(`texture[${i}] ${tex.getName()} -> ${file}`)
})

// qué material usa cada mesh
root.listMeshes().forEach((mesh) => {
  mesh.listPrimitives().forEach((prim) => {
    const mat = prim.getMaterial()
    console.log(`${mesh.getName()} -> material ${mat ? root.listMaterials().indexOf(mat) : '?'} (${mat?.getName() || ''})`)
  })
})
