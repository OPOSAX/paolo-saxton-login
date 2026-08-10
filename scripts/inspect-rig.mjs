/**
 * Inspección de un GLB con rigging: mallas, esqueleto (jerarquía de
 * huesos con posiciones), skins y animaciones.
 * Uso: node scripts/inspect-rig.mjs <archivo.glb>
 */
import { NodeIO } from '@gltf-transform/core'

const io = new NodeIO()
const doc = await io.read(process.argv[2])
const root = doc.getRoot()

console.log('--- MESHES ---')
for (const mesh of root.listMeshes()) {
  let verts = 0
  for (const prim of mesh.listPrimitives()) {
    verts += prim.getAttribute('POSITION')?.getCount() ?? 0
    const semantics = prim.listSemantics().join(', ')
    console.log(`mesh "${mesh.getName()}" verts=${verts} attrs=[${semantics}]`)
  }
}

console.log('--- SKINS ---')
for (const skin of root.listSkins()) {
  console.log(`skin "${skin.getName()}" joints=${skin.listJoints().length}`)
}

console.log('--- JERARQUÍA DE NODOS ---')
const printed = new Set()
function printNode(node, depth) {
  if (printed.has(node)) return
  printed.add(node)
  const t = node.getTranslation().map((x) => x.toFixed(3))
  const mesh = node.getMesh()
  const skin = node.getSkin()
  console.log(
    `${'  '.repeat(depth)}${node.getName()} t=[${t}]${mesh ? ` mesh=${mesh.getName()}` : ''}${skin ? ' [skinned]' : ''}`,
  )
  for (const child of node.listChildren()) printNode(child, depth + 1)
}
for (const scene of root.listScenes()) {
  for (const node of scene.listChildren()) printNode(node, 0)
}

console.log('--- ANIMACIONES ---')
for (const anim of root.listAnimations()) {
  const channels = anim.listChannels()
  const targets = [...new Set(channels.map((c) => `${c.getTargetNode()?.getName()}.${c.getTargetPath()}`))]
  console.log(`anim "${anim.getName()}" canales=${channels.length}: ${targets.slice(0, 12).join(', ')}${targets.length > 12 ? '...' : ''}`)
}

console.log('--- TEXTURAS ---')
for (const tex of root.listTextures()) {
  console.log(`tex "${tex.getName()}" mime=${tex.getMimeType()} bytes=${tex.getImage()?.byteLength}`)
}
