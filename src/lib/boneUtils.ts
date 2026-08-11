import * as THREE from 'three'

/*
 * Rotación de huesos alrededor de un eje DEL MUNDO.
 *
 * Los huesos de este rig tienen poses de reposo con ejes locales
 * arbitrarios (y espejados entre lado izquierdo y derecho), así que
 * sumar ángulos euler locales produce resultados distintos por hueso.
 * Girar alrededor de un eje de mundo con cuaterniones es consistente:
 * "hacia la cámara" siempre es hacia la cámara.
 */

const _qParent = new THREE.Quaternion()
const _qAxis = new THREE.Quaternion()
const _qDelta = new THREE.Quaternion()

/** Eje X del mundo: rotar en negativo lleva lo que cuelga hacia la cámara */
export const EJE_X = new THREE.Vector3(1, 0, 0)

/**
 * Aplica al hueso una rotación de `angle` radianes alrededor de `axisWorld`
 * (expresado en coordenadas de mundo), SOBRE su rotación actual del frame.
 */
export function girarEnEjeMundo(bone: THREE.Object3D, axisWorld: THREE.Vector3, angle: number): void {
  if (!bone.parent || angle === 0) return
  bone.parent.getWorldQuaternion(_qParent)
  _qAxis.setFromAxisAngle(axisWorld, angle)
  _qDelta.copy(_qParent).invert().multiply(_qAxis).multiply(_qParent)
  bone.quaternion.copy(_qDelta.multiply(bone.quaternion))
}
