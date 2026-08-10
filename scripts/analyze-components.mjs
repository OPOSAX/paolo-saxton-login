/**
 * Componentes conexas de la malla (tras soldar vértices por posición):
 * muestra cuántas islas hay y su caja, para ver si la capucha/cabeza es
 * una cáscara separada del cuerpo.
 * Uso: node scripts/analyze-components.mjs <archivo.glb>
 */
import { NodeIO } from '@gltf-transform/core'

const io = new NodeIO()
const doc = await io.read(process.argv[2])

for (const mesh of doc.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION')
    const idx = prim.getIndices()
    if (!pos || !idx) continue
    const n = pos.getCount()
    const idxArr = idx.getArray()

    // soldadura por posición (llave cuantizada) para unir costuras de UV
    const keyToRep = new Map()
    const rep = new Int32Array(n)
    const v = [0, 0, 0]
    for (let i = 0; i < n; i++) {
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

    // union-find sobre triángulos
    const parent = new Int32Array(n)
    for (let i = 0; i < n; i++) parent[i] = i
    const find = (a) => {
      while (parent[a] !== a) {
        parent[a] = parent[parent[a]]
        a = parent[a]
      }
      return a
    }
    const union = (a, b) => {
      const ra = find(a)
      const rb = find(b)
      if (ra !== rb) parent[ra] = rb
    }
    for (let t = 0; t < idxArr.length; t += 3) {
      union(rep[idxArr[t]], rep[idxArr[t + 1]])
      union(rep[idxArr[t]], rep[idxArr[t + 2]])
    }

    // cajas por componente (por triángulos, contando vértices)
    const comps = new Map()
    for (let t = 0; t < idxArr.length; t += 3) {
      const c = find(rep[idxArr[t]])
      let e = comps.get(c)
      if (!e) {
        e = { tris: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
        comps.set(c, e)
      }
      e.tris++
      for (let k = 0; k < 3; k++) {
        pos.getElement(idxArr[t + k], v)
        for (let a = 0; a < 3; a++) {
          if (v[a] < e.min[a]) e.min[a] = v[a]
          if (v[a] > e.max[a]) e.max[a] = v[a]
        }
      }
    }
    const list = [...comps.values()].sort((a, b) => b.tris - a.tris)
    console.log(`mesh "${mesh.getName()}": ${list.length} componentes`)
    for (const e of list.slice(0, 12)) {
      console.log(
        `  tris=${e.tris} y=[${e.min[1].toFixed(3)}, ${e.max[1].toFixed(3)}] x=[${e.min[0].toFixed(3)}, ${e.max[0].toFixed(3)}] z=[${e.min[2].toFixed(3)}, ${e.max[2].toFixed(3)}]`,
      )
    }
    if (list.length > 12) console.log(`  ... y ${list.length - 12} más`)
  }
}
