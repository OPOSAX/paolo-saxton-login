import { NodeIO } from '@gltf-transform/core'

const io = new NodeIO()
const doc = await io.read(process.argv[2])
const root = doc.getRoot()

console.log('--- MESHES ---')
for (const mesh of root.listMeshes()) {
  let verts = 0
  for (const prim of mesh.listPrimitives()) {
    verts += prim.getAttribute('POSITION')?.getCount() ?? 0
  }
  console.log(`mesh: "${mesh.getName()}" prims=${mesh.listPrimitives().length} verts=${verts}`)
}
console.log('--- NODES ---')
for (const node of root.listNodes()) {
  console.log(`node: "${node.getName()}" mesh=${node.getMesh()?.getName() ?? '-'} skin=${!!node.getSkin()}`)
}
console.log('--- MATERIALS ---')
for (const mat of root.listMaterials()) console.log(`mat: "${mat.getName()}"`)
console.log('--- TEXTURES ---')
for (const tex of root.listTextures()) {
  const img = tex.getImage()
  console.log(`tex: "${tex.getName()}" mime=${tex.getMimeType()} bytes=${img?.byteLength}`)
}
console.log('--- SKINS/ANIMS ---')
console.log(`skins=${root.listSkins().length} anims=${root.listAnimations().length}`)
