import { NodeIO } from '@gltf-transform/core'

const io = new NodeIO()
const doc = await io.read(process.argv[2])

for (const mesh of doc.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION')
    if (!pos) continue
    const min = pos.getMin([])
    const max = pos.getMax([])
    const c = min.map((v, i) => ((v + max[i]) / 2).toFixed(3))
    const s = min.map((v, i) => (max[i] - v).toFixed(3))
    console.log(
      `${mesh.getName().padEnd(28)} centro:(${c.join(', ')})  tam:(${s.join(', ')})  verts:${pos.getCount()}`
    )
  }
}
