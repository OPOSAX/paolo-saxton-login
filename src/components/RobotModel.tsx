import { useEffect, useMemo, useRef } from 'react'
import type { MutableRefObject } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { useRobotAnimation } from '../hooks/useRobotAnimation'
import type { FocusTarget, RobotAction } from '../hooks/useRobotAnimation'
import type { MouseState } from '../hooks/useMouseTracking'

interface RobotModelProps {
  mouse: MutableRefObject<MouseState>
  focusRef: MutableRefObject<FocusTarget>
  actionRef: MutableRefObject<RobotAction | null>
  reducedMotion: boolean
}

/**
 * Robot 3D del usuario (GLB con rigging de Tripo: esqueleto humanoide de
 * 41 huesos). Las animaciones mueven los huesos directamente:
 *   - Head        → sigue al cursor, asiente y niega (el cuello se dobla
 *                   con la malla, sin costuras)
 *   - L/R_Upperarm→ balanceo de brazos y gestos
 *   - la malla "Eyes" (separada por scripts/prepare-rigged.mjs) permite
 *     apagar los ojos al pestañear y hacerlos alumbrar con la contraseña
 */

// ruta relativa: funciona igual en local y en GitHub Pages (subcarpeta)
const MODEL_URL = 'models/paolo-robot.glb'
const WORLD_H = 4.4 // altura del robot en unidades de mundo
const FLOOR_Y = -2.18

interface Rig {
  root: THREE.Group
  head: THREE.Object3D
  spine: THREE.Object3D
  body: THREE.Object3D
  leftArm: THREE.Object3D
  rightArm: THREE.Object3D
  leftForearm: THREE.Object3D
  rightForearm: THREE.Object3D
  leftHand: THREE.Object3D
  rightHand: THREE.Object3D
  leftThigh: THREE.Object3D
  rightThigh: THREE.Object3D
  leftCalf: THREE.Object3D
  rightCalf: THREE.Object3D
  leftFoot: THREE.Object3D
  rightFoot: THREE.Object3D
  eyes: THREE.Group
  pupils: THREE.Group
  antenna: THREE.Group
  flash: THREE.Mesh
}

function bboxOf(objects: THREE.Object3D[]): THREE.Box3 {
  const box = new THREE.Box3()
  objects.forEach((o) => box.expandByObject(o))
  return box
}

// vector reutilizable para proyectar huesos a pantalla (sin crear basura)
const _pv = new THREE.Vector3()

function buildRig(scene: THREE.Group): Rig {
  // el modelo original mira hacia +X: girado queda de frente a la cámara
  scene.rotation.y = -Math.PI / 2
  scene.updateMatrixWorld(true)

  const root = new THREE.Group()
  const bobGroup = new THREE.Group() // vaivén, saltitos y giros del cuerpo
  root.add(bobGroup)
  bobGroup.add(scene)

  // ---- huesos que se animan ----
  const boneOrEmpty = (name: string): THREE.Object3D => scene.getObjectByName(name) ?? new THREE.Group()
  const head = boneOrEmpty('Head')
  const spine = boneOrEmpty('Spine02')
  const leftArm = boneOrEmpty('L_Upperarm')
  const rightArm = boneOrEmpty('R_Upperarm')
  const leftForearm = boneOrEmpty('L_Forearm')
  const rightForearm = boneOrEmpty('R_Forearm')
  const leftHand = boneOrEmpty('L_Hand')
  const rightHand = boneOrEmpty('R_Hand')
  const leftThigh = boneOrEmpty('L_Thigh')
  const rightThigh = boneOrEmpty('R_Thigh')
  const leftCalf = boneOrEmpty('L_Calf')
  const rightCalf = boneOrEmpty('R_Calf')
  const leftFoot = boneOrEmpty('L_Foot')
  const rightFoot = boneOrEmpty('R_Foot')
  // el hook anima SUMANDO a la rotación de reposo de cada hueso
  ;[head, spine, leftArm, rightArm, leftForearm, rightForearm, leftThigh, rightThigh, leftCalf, rightCalf].forEach(
    (b) => {
      b.userData.restRot = { x: b.rotation.x, y: b.rotation.y, z: b.rotation.z }
    },
  )

  // ---- mallas (cuerpo y ojos, ambas con el mismo skin) ----
  let bodySkin: THREE.Mesh | null = null
  let eyesSkin: THREE.Mesh | null = null
  scene.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    m.frustumCulled = false // la malla deformada puede salir de su caja
    if (m.name === 'Eyes') eyesSkin = m
    else bodySkin = m
  })

  const sceneBox = bboxOf([bodySkin ?? scene])
  const sceneCenter = sceneBox.getCenter(new THREE.Vector3())
  const sceneSize = sceneBox.getSize(new THREE.Vector3())

  /*
   * Ojos: material clonado que el hook atenúa al pestañear.
   */
  const eyes = new THREE.Group()
  if (eyesSkin) {
    const src = eyesSkin as THREE.Mesh
    const glowMat = (Array.isArray(src.material) ? src.material[0] : src.material).clone() as THREE.MeshStandardMaterial
    src.material = glowMat
    eyes.userData.glowMat = glowMat
    eyes.userData.glowColor = new THREE.Color('#ffffff')
  }


  // ---- pantalla del pecho: plano de confirmación ----
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(sceneSize.x * 0.3, sceneSize.y * 0.06),
    new THREE.MeshBasicMaterial({ color: '#43e88f', transparent: true, opacity: 0, toneMapped: false }),
  )
  flash.position.set(sceneCenter.x, sceneBox.min.y + sceneSize.y * 0.52, sceneBox.max.z + sceneSize.z * 0.02)
  bobGroup.add(flash)

  // grupos vacíos para que el hook conserve sus referencias
  const pupils = new THREE.Group()
  const antenna = new THREE.Group()
  eyes.add(pupils)
  bobGroup.add(eyes, antenna)

  // ---- normalizar escala y posición (los pies quedan en FLOOR_Y) ----
  // se mide SOLO la geometría del personaje: sprites y luces no cuentan
  const wholeSize = sceneSize
  const wholeCenter = sceneCenter
  const scale = WORLD_H / wholeSize.y
  root.scale.setScalar(scale)
  root.position.set(-wholeCenter.x * scale, FLOOR_Y - sceneBox.min.y * scale, -wholeCenter.z * scale)

  return {
    root,
    head,
    spine,
    body: bobGroup,
    leftArm,
    rightArm,
    leftForearm,
    rightForearm,
    leftHand,
    rightHand,
    leftThigh,
    rightThigh,
    leftCalf,
    rightCalf,
    leftFoot,
    rightFoot,
    eyes,
    pupils,
    antenna,
    flash,
  }
}

export default function RobotModel({ mouse, focusRef, actionRef, reducedMotion }: RobotModelProps) {
  const gltf = useGLTF(MODEL_URL)
  const rig = useMemo(() => buildRig(gltf.scene), [gltf.scene])

  const robotRef = useRef<THREE.Group>(null!)
  const headRef = useRef<THREE.Object3D>(null!)
  const spineRef = useRef<THREE.Object3D>(null!)
  const eyesRef = useRef<THREE.Group>(null!)
  const pupilsRef = useRef<THREE.Group>(null!)
  const bodyRef = useRef<THREE.Object3D>(null!)
  const leftArmRef = useRef<THREE.Object3D>(null!)
  const rightArmRef = useRef<THREE.Object3D>(null!)
  const leftForearmRef = useRef<THREE.Object3D>(null!)
  const rightForearmRef = useRef<THREE.Object3D>(null!)
  const antennaRef = useRef<THREE.Group>(null!)
  const flashRef = useRef<THREE.Mesh>(null!)

  headRef.current = rig.head
  spineRef.current = rig.spine
  eyesRef.current = rig.eyes
  pupilsRef.current = rig.pupils
  bodyRef.current = rig.body
  leftArmRef.current = rig.leftArm
  rightArmRef.current = rig.rightArm
  leftForearmRef.current = rig.leftForearm
  rightForearmRef.current = rig.rightForearm
  antennaRef.current = rig.antenna
  flashRef.current = rig.flash

  useRobotAnimation(
    {
      robot: robotRef,
      head: headRef,
      spine: spineRef,
      eyes: eyesRef,
      pupils: pupilsRef,
      body: bodyRef,
      leftArm: leftArmRef,
      rightArm: rightArmRef,
      leftForearm: leftForearmRef,
      rightForearm: rightForearmRef,
      antenna: antennaRef,
      screenFlash: flashRef,
    },
    mouse,
    focusRef,
    actionRef,
    reducedMotion,
  )

  /*
   * Interacción con el puntero:
   *  - agarrar un BRAZO (cerca del codo o la mano) lo levanta como
   *    marioneta; al soltarlo cae con física de péndulo y rebota
   *  - arrastrar en cualquier otra parte gira la tornamesa
   */
  const spin = useRef({ angle: 0, vel: 0, dragging: false, lastX: 0 })
  const puppet = useRef({
    L: { angle: 0, vel: 0, grabbed: false },
    R: { angle: 0, vel: 0, grabbed: false },
    LL: { angle: 0, vel: 0, grabbed: false }, // pierna izquierda
    RL: { angle: 0, vel: 0, grabbed: false }, // pierna derecha
    px: 0,
    py: 0,
    // puntos de agarre en pantalla [x, y] (codo/mano y rodilla/pie)
    ptsL: [] as Array<[number, number]>,
    ptsR: [] as Array<[number, number]>,
    ptsLL: [] as Array<[number, number]>,
    ptsRL: [] as Array<[number, number]>,
    shL: [0, 0] as [number, number],
    shR: [0, 0] as [number, number],
    hipL: [0, 0] as [number, number],
    hipR: [0, 0] as [number, number],
    grabRadius: 50,
  })
  const { gl } = useThree()
  useEffect(() => {
    const el = gl.domElement
    const down = (e: PointerEvent) => {
      const pu = puppet.current
      pu.px = e.clientX
      pu.py = e.clientY
      const near = (pts: Array<[number, number]>) =>
        pts.some(([x, y]) => Math.hypot(e.clientX - x, e.clientY - y) < pu.grabRadius)
      if (near(pu.ptsL)) {
        pu.L.grabbed = true
      } else if (near(pu.ptsR)) {
        pu.R.grabbed = true
      } else if (near(pu.ptsLL)) {
        pu.LL.grabbed = true
      } else if (near(pu.ptsRL)) {
        pu.RL.grabbed = true
      } else {
        spin.current.dragging = true
        spin.current.lastX = e.clientX
        spin.current.vel = 0
      }
      el.setPointerCapture(e.pointerId)
      el.style.cursor = 'grabbing'
    }
    const move = (e: PointerEvent) => {
      const pu = puppet.current
      pu.px = e.clientX
      pu.py = e.clientY
      const s = spin.current
      if (!s.dragging) return
      const dx = e.clientX - s.lastX
      s.lastX = e.clientX
      s.angle += dx * 0.012
      s.vel = dx * 0.012
    }
    const up = () => {
      spin.current.dragging = false
      puppet.current.L.grabbed = false
      puppet.current.R.grabbed = false
      puppet.current.LL.grabbed = false
      puppet.current.RL.grabbed = false
      el.style.cursor = 'grab'
    }
    el.style.cursor = 'grab'
    el.style.touchAction = 'none'
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [gl])

  useFrame((frameState, delta) => {
    // ---- tornamesa ----
    const s = spin.current
    if (!s.dragging) {
      // inercia del giro con frenado progresivo
      s.angle += s.vel
      s.vel *= Math.exp(-delta * 1.8)
      // al agotarse el impulso, vuelve suave a mirar al frente
      if (Math.abs(s.vel) < 0.003) {
        s.angle = THREE.MathUtils.euclideanModulo(s.angle + Math.PI, Math.PI * 2) - Math.PI
        s.angle *= Math.exp(-delta * 2.2)
      }
    }
    if (robotRef.current) robotRef.current.rotation.y = s.angle

    // ---- marioneta de brazos ----
    const pu = puppet.current
    const rect = gl.domElement.getBoundingClientRect()
    pu.grabRadius = Math.max(40, rect.height * 0.07)
    const proj = (o: THREE.Object3D): [number, number] => {
      _pv.setFromMatrixPosition(o.matrixWorld).project(frameState.camera)
      return [rect.left + ((_pv.x + 1) / 2) * rect.width, rect.top + ((1 - _pv.y) / 2) * rect.height]
    }
    pu.ptsL = [proj(rig.leftForearm), proj(rig.leftHand)]
    pu.ptsR = [proj(rig.rightForearm), proj(rig.rightHand)]
    pu.ptsLL = [proj(rig.leftCalf), proj(rig.leftFoot)]
    pu.ptsRL = [proj(rig.rightCalf), proj(rig.rightFoot)]
    pu.shL = proj(rig.leftArm)
    pu.shR = proj(rig.rightArm)
    pu.hipL = proj(rig.leftThigh)
    pu.hipR = proj(rig.rightThigh)

    const clamp = THREE.MathUtils.clamp
    const updateArm = (
      a: { angle: number; vel: number; grabbed: boolean },
      sh: [number, number],
      side: 1 | -1,
      maxA = 2.75,
    ) => {
      if (a.grabbed) {
        // ángulo del pivote hacia el puntero (0 = extremidad colgando)
        const target = clamp(Math.atan2((pu.px - sh[0]) * side, pu.py - sh[1]), -0.25, maxA)
        const prev = a.angle
        a.angle += (target - a.angle) * (1 - Math.exp(-delta * 22))
        a.vel = (a.angle - prev) / Math.max(delta, 1e-3)
      } else if (Math.abs(a.angle) > 0.0005 || Math.abs(a.vel) > 0.0005) {
        // caída de marioneta: gravedad de resorte con rebote amortiguado
        a.vel += (-30 * a.angle - 3.4 * a.vel) * delta
        a.angle += a.vel * delta
      } else {
        a.angle = 0
        a.vel = 0
      }
    }
    updateArm(pu.L, pu.shL, 1)
    updateArm(pu.R, pu.shR, -1)
    // las piernas suben hasta ~125° (más sería un split imposible)
    updateArm(pu.LL, pu.hipL, 1, 2.2)
    updateArm(pu.RL, pu.hipR, -1, 2.2)
    // brazos: se SUMA a lo que el hook ya aplicó este frame (corre antes)
    rig.leftArm.rotation.z += pu.L.angle
    rig.rightArm.rotation.z -= pu.R.angle
    // el codo acompaña un poco: cuelga con naturalidad
    rig.leftForearm.rotation.x += pu.L.angle * 0.12
    rig.rightForearm.rotation.x += pu.R.angle * 0.12
    // piernas: el hook no las toca, se fija sobre la pose de reposo
    const restZ = (o: THREE.Object3D) =>
      (o.userData.restRot as { z: number } | undefined)?.z ?? 0
    const restX = (o: THREE.Object3D) =>
      (o.userData.restRot as { x: number } | undefined)?.x ?? 0
    rig.leftThigh.rotation.z = restZ(rig.leftThigh) + pu.LL.angle
    rig.rightThigh.rotation.z = restZ(rig.rightThigh) - pu.RL.angle
    // la rodilla cuelga doblándose levemente
    rig.leftCalf.rotation.x = restX(rig.leftCalf) + pu.LL.angle * 0.15
    rig.rightCalf.rotation.x = restX(rig.rightCalf) + pu.RL.angle * 0.15
  })

  return (
    <group ref={robotRef}>
      <primitive object={rig.root} />
      {/* piso: plataforma circular donde se para el robot */}
      <mesh position={[0, FLOOR_Y - 0.09, 0]}>
        <cylinderGeometry args={[1.7, 1.95, 0.18, 48]} />
        <meshStandardMaterial color="#16305c" metalness={0.35} roughness={0.55} />
      </mesh>
      <mesh position={[0, FLOOR_Y + 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1.7, 48]} />
        <meshStandardMaterial color="#1d3d73" metalness={0.3} roughness={0.5} />
      </mesh>
      {/* aro de acento en el borde de la plataforma */}
      <mesh position={[0, FLOOR_Y + 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.52, 1.62, 48]} />
        <meshBasicMaterial color="#4f8cff" transparent opacity={0.55} toneMapped={false} />
      </mesh>
    </group>
  )
}

useGLTF.preload(MODEL_URL)
