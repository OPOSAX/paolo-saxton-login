import { useEffect, useMemo, useRef } from 'react'
import type { MutableRefObject } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { useRobotAnimation } from '../hooks/useRobotAnimation'
import type { FocusTarget, RobotAction, QuirkName } from '../hooks/useRobotAnimation'
import { girarEnEjeMundo, EJE_X } from '../lib/boneUtils'
import type { MouseState } from '../hooks/useMouseTracking'

interface RobotModelProps {
  mouse: MutableRefObject<MouseState>
  focusRef: MutableRefObject<FocusTarget>
  actionRef: MutableRefObject<RobotAction | null>
  reducedMotion: boolean
  quirkRef?: MutableRefObject<QuirkName | null>
  followRef?: MutableRefObject<boolean>
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
  ;[
    head,
    spine,
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
  ].forEach((b) => {
    b.userData.restRot = { x: b.rotation.x, y: b.rotation.y, z: b.rotation.z }
  })

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

export default function RobotModel({
  mouse,
  focusRef,
  actionRef,
  reducedMotion,
  quirkRef,
  followRef,
}: RobotModelProps) {
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
  const rightHandRef = useRef<THREE.Object3D>(null!)
  const leftHandRef = useRef<THREE.Object3D>(null!)
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
  rightHandRef.current = rig.rightHand
  leftHandRef.current = rig.leftHand
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
      rightHand: rightHandRef,
      leftHand: leftHandRef,
      antenna: antennaRef,
      screenFlash: flashRef,
    },
    mouse,
    focusRef,
    actionRef,
    reducedMotion,
    quirkRef,
    followRef,
  )

  /*
   * Interacción con el puntero:
   *  - agarrar un BRAZO (cerca del codo o la mano) lo levanta como
   *    marioneta; al soltarlo cae con física de péndulo y rebota
   *  - arrastrar en cualquier otra parte gira la tornamesa
   */
  const spin = useRef({ angle: 0, vel: 0, dragging: false, lastX: 0 })
  const puppet = useRef({
    // angZ = elevación lateral · angX = extensión hacia la pantalla
    L: { angZ: 0, velZ: 0, angX: 0, velX: 0, grabbed: false },
    R: { angZ: 0, velZ: 0, angX: 0, velX: 0, grabbed: false },
    LL: { angZ: 0, velZ: 0, angX: 0, velX: 0, grabbed: false }, // pierna izq
    RL: { angZ: 0, velZ: 0, angX: 0, velX: 0, grabbed: false }, // pierna der
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
    interface Limb {
      angZ: number
      velZ: number
      angX: number
      velX: number
      grabbed: boolean
    }
    const updateLimb = (a: Limb, sh: [number, number], side: 1 | -1, maxZ: number, maxX: number) => {
      if (a.grabbed) {
        /*
         * Dos ejes desde el mismo gesto: arrastrar HACIA AFUERA eleva la
         * extremidad de lado (Z); arrastrar HACIA EL CENTRO del cuerpo la
         * estira HACIA LA PANTALLA (X). La mezcla es continua.
         */
        const dxOut = (pu.px - sh[0]) * side
        const dyDown = pu.py - sh[1]
        const alza = clamp(Math.atan2(Math.abs(dxOut), dyDown), -0.2, 2.75)
        const lado = 0.5 + 0.5 * Math.tanh(dxOut / 60)
        const targetZ = clamp(alza * lado, -0.2, maxZ)
        const targetX = clamp(alza * (1 - lado), 0, maxX)
        const k = 1 - Math.exp(-delta * 22)
        const pz = a.angZ
        a.angZ += (targetZ - a.angZ) * k
        a.velZ = (a.angZ - pz) / Math.max(delta, 1e-3)
        const pxv = a.angX
        a.angX += (targetX - a.angX) * k
        a.velX = (a.angX - pxv) / Math.max(delta, 1e-3)
      } else if (
        Math.abs(a.angZ) > 0.0005 || Math.abs(a.velZ) > 0.0005 ||
        Math.abs(a.angX) > 0.0005 || Math.abs(a.velX) > 0.0005
      ) {
        // caída de marioneta: gravedad de resorte con rebote amortiguado
        a.velZ += (-30 * a.angZ - 3.4 * a.velZ) * delta
        a.angZ += a.velZ * delta
        a.velX += (-30 * a.angX - 3.4 * a.velX) * delta
        a.angX += a.velX * delta
      } else {
        a.angZ = 0
        a.velZ = 0
        a.angX = 0
        a.velX = 0
      }
    }
    // frontal: hombro hasta ~63°; el codo completa el resto para que el
    // antebrazo quede totalmente hacia adelante
    updateLimb(pu.L, pu.shL, 1, 2.75, 1.1)
    updateLimb(pu.R, pu.shR, -1, 2.75, 1.1)
    // las piernas suben hasta ~125° y solo de lado (eje frontal sin probar)
    updateLimb(pu.LL, pu.hipL, 1, 2.2, 0)
    updateLimb(pu.RL, pu.hipR, -1, 2.2, 0)
    // brazos: se SUMA a lo que el hook ya aplicó este frame (corre antes)
    rig.leftArm.rotation.z += pu.L.angZ
    rig.rightArm.rotation.z -= pu.R.angZ
    // el codo acompaña la elevación lateral
    rig.leftForearm.rotation.x += pu.L.angZ * 0.12
    rig.rightForearm.rotation.x += pu.R.angZ * 0.12
    // alcance FRONTAL: giro en eje de mundo (consistente en ambos brazos);
    // el codo dobla para que el antebrazo apunte a la cámara
    if (pu.L.angX > 0.001) {
      girarEnEjeMundo(rig.leftArm, EJE_X, -pu.L.angX)
      girarEnEjeMundo(rig.leftForearm, EJE_X, -pu.L.angX * 0.45)
    }
    if (pu.R.angX > 0.001) {
      girarEnEjeMundo(rig.rightArm, EJE_X, -pu.R.angX)
      girarEnEjeMundo(rig.rightForearm, EJE_X, -pu.R.angX * 0.45)
    }
    // piernas: el hook no las toca, se fija sobre la pose de reposo
    const restZ = (o: THREE.Object3D) =>
      (o.userData.restRot as { z: number } | undefined)?.z ?? 0
    const restX = (o: THREE.Object3D) =>
      (o.userData.restRot as { x: number } | undefined)?.x ?? 0
    rig.leftThigh.rotation.z = restZ(rig.leftThigh) + pu.LL.angZ
    rig.rightThigh.rotation.z = restZ(rig.rightThigh) - pu.RL.angZ
    // la rodilla cuelga doblándose levemente
    rig.leftCalf.rotation.x = restX(rig.leftCalf) + pu.LL.angZ * 0.15
    rig.rightCalf.rotation.x = restX(rig.rightCalf) + pu.RL.angZ * 0.15
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
