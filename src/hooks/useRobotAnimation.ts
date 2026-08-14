import { useRef } from 'react'
import type { MutableRefObject, RefObject } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { girarEnEjeMundo, EJE_X } from '../lib/boneUtils'
import type { MouseState } from './useMouseTracking'

/** Campo del formulario que puede tener el foco */
export type FocusField = 'email' | 'password' | 'button'

/**
 * Elemento de la interfaz que el robot debe mirar, con su posición REAL
 * en pantalla (píxeles): la cabeza se apunta geométricamente hacia ese
 * punto, igual que hacia el cursor.
 */
export type FocusTarget = { field: FocusField; px: number; py: number } | null

/** Gesto puntual del robot (asentir al iniciar sesión, negar ante un error) */
export interface RobotAction {
  type: 'nod' | 'shake'
  /** Se rellena con el tiempo del reloj de la escena en el primer frame */
  at: number
}

export interface RobotRefs {
  robot: RefObject<THREE.Group>
  /** Puede ser un grupo o un HUESO del esqueleto (se anima igual) */
  head: RefObject<THREE.Object3D>
  eyes: RefObject<THREE.Group>
  pupils: RefObject<THREE.Group>
  body: RefObject<THREE.Object3D>
  leftArm: RefObject<THREE.Object3D>
  rightArm: RefObject<THREE.Object3D>
  antenna: RefObject<THREE.Group>
  screenFlash: RefObject<THREE.Mesh>
  /** Párpados 2.5D: crecen para cubrir el ojo (inverso al parpadeo clásico) */
  eyelids?: RefObject<THREE.Group>
  /** Torso: acompaña sutilmente el giro de la cabeza */
  spine?: RefObject<THREE.Object3D>
  /** Antebrazos: codos para el saludo y balanceo natural */
  leftForearm?: RefObject<THREE.Object3D>
  rightForearm?: RefObject<THREE.Object3D>
  /** Manos: giro de "atornillado" y dedos que abren en el saludo */
  rightHand?: RefObject<THREE.Object3D>
  leftHand?: RefObject<THREE.Object3D>
}

/** Rotación de reposo del hueso: las animaciones se SUMAN a esta base */
const restOf = (o: THREE.Object3D): { x: number; y: number; z: number } =>
  (o.userData.restRot as { x: number; y: number; z: number }) ?? { x: 0, y: 0, z: 0 }

// vectores reutilizables para la puntería de la cabeza (sin crear basura)
const _ray = new THREE.Vector3()
const _target = new THREE.Vector3()
const _headPos = new THREE.Vector3()

const MAX_YAW = THREE.MathUtils.degToRad(30) // ±30° horizontal
const MAX_PITCH = THREE.MathUtils.degToRad(20) // ±20° vertical
// (moderado: girar el cuello al extremo estira la piel de la malla)
const SPINE_FOLLOW = 0.15 // el torso acompaña esta fracción del giro
// (moderado: doblar mucho el torso estira la piel de la malla)
const ACTION_DURATION = 0.9 // segundos
const BLINK_DURATION = 0.24 // parpadeo bien visible

/* Balanceo de brazos — ajusta estos valores a gusto */
const ARM_SPEED = 0.85 // velocidad (rad/s del ciclo; menor = más lento)
const ARM_SWING = 0.17 // amplitud del péndulo adelante/atrás (radianes)
const ARM_FLAP_BASE = 0.02 // apertura lateral base (separación del cuerpo)
const ARM_FLAP = 0.065 // amplitud del aleteo lateral

/*
 * Gestos divertidos aleatorios durante la espera:
 *  - spin:   da una vuelta completa sobre sí mismo con brazos en alto
 *  - hop:    da dos saltitos con los brazos abiertos
 *  - shimmy: bailecito girando el cuerpo con brazos alternados
 *  - wave:   saluda: brazo en alto y antebrazo ondeando de lado a lado
 *  - laugh:  carcajada: el cuerpo rebota y la cabeza se echa atrás
 *  - duck:   se agacha: reverencia doblando el torso
 *  - fall:   se cae de lado, rebota en el piso y se vuelve a parar
 */
const QUIRKS = ['spin', 'hop', 'shimmy', 'wave', 'laugh', 'duck', 'fall'] as const
type Quirk = (typeof QUIRKS)[number]
/** Nombre de gesto que puede dispararse desde la interfaz */
export type QuirkName = Quirk
const QUIRK_DURATION: Record<Quirk, number> = {
  spin: 1.7,
  hop: 1.4,
  shimmy: 2.0,
  wave: 2.2,
  laugh: 1.8,
  duck: 1.7,
  fall: 2.8,
}
const QUIRK_MIN_GAP = 6 // segundos mínimos entre gestos
const QUIRK_MAX_GAP = 14

const lerp = THREE.MathUtils.lerp
const clamp = THREE.MathUtils.clamp

export function useRobotAnimation(
  refs: RobotRefs,
  mouse: MutableRefObject<MouseState>,
  focusRef: MutableRefObject<FocusTarget>,
  actionRef: MutableRefObject<RobotAction | null>,
  reducedMotion: boolean,
  /** Gesto solicitado desde la interfaz (se consume y se limpia) */
  quirkRef?: MutableRefObject<QuirkName | null>,
  /** Si es false, la cabeza NO sigue al mouse (se activa con clic) */
  followRef?: MutableRefObject<boolean>,
) {
  // Estado suavizado entre frames (no provoca renders)
  const s = useRef({
    yaw: 0,
    pitch: 0,
    tilt: 0,
    lid: 1,
    pupX: 0,
    pupY: 0,
    nextBlink: 2.5,
    blinkStart: -10,
    quirk: null as Quirk | null,
    quirkStart: 0,
    nextQuirk: 5,
  })

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime
    const st = s.current
    const k = 1 - Math.exp(-delta * 5) // factor de interpolación estable

    // ---- 1. Objetivo de mirada: apuntar EXACTO al punto en pantalla ----
    // Se proyecta el píxel del cursor (o del campo enfocado) a un punto
    // del mundo 3D delante del robot y se calculan los ángulos reales de
    // la cabeza hacia ese punto: la cabeza "lo mira" de verdad.
    const focus = focusRef.current
    let lookX = 0
    let lookY = 0
    let tiltTarget = 0
    let lidTarget = 1
    let targetYaw = 0
    let targetPitch = 0

    let px: number | null = null
    let py = 0
    if (focus) {
      px = focus.px
      py = focus.py
      if (focus.field === 'email') tiltTarget = 0.08 // curiosidad leve
      else if (focus.field === 'password') tiltTarget = -0.05
    } else if (mouse.current.inside && (followRef?.current ?? true)) {
      px = mouse.current.px
      py = mouse.current.py
    }
    // sin seguimiento activo (o mouse fuera) y sin foco: mira al centro

    if (px !== null && refs.head.current) {
      const camera = state.camera
      const rect = state.gl.domElement.getBoundingClientRect()
      // píxel → NDC del canvas (puede quedar fuera de [-1,1] si el punto
      // está sobre el formulario: la dirección sigue siendo la correcta)
      const ndcX = ((px - rect.left) / rect.width) * 2 - 1
      const ndcY = -(((py - rect.top) / rect.height) * 2 - 1)
      lookX = clamp(ndcX, -1, 1)
      lookY = clamp(ndcY, -1, 1)
      // rayo de la cámara a través del píxel
      _ray.set(ndcX, ndcY, 0.5).unproject(camera).sub(camera.position).normalize()
      // punto del rayo sobre un plano vertical delante del robot
      refs.head.current.getWorldPosition(_headPos)
      const planeZ = _headPos.z + (camera.position.z - _headPos.z) * 0.45
      const sRay = (planeZ - camera.position.z) / (_ray.z || -1e-6)
      _target.copy(camera.position).addScaledVector(_ray, sRay)
      // ángulos de la cabeza hacia el punto (el robot mira hacia +Z)
      _target.sub(_headPos)
      targetYaw = clamp(Math.atan2(_target.x, _target.z), -MAX_YAW, MAX_YAW)
      targetPitch = clamp(
        Math.atan2(_target.y, Math.hypot(_target.x, _target.z)),
        -MAX_PITCH,
        MAX_PITCH,
      )
    }

    // ---- 2. Gesto activo (asentir / negar) ----
    let actPitch = 0
    let actYaw = 0
    let flash = 0
    const action = actionRef.current
    if (action && !reducedMotion) {
      if (action.at < 0) action.at = t
      const p = (t - action.at) / ACTION_DURATION
      if (p >= 1) {
        actionRef.current = null
      } else {
        const env = Math.sin(Math.PI * p) // entra y sale suave
        if (action.type === 'nod') {
          // el asentimiento arranca bajando la cabeza (X negativa = abajo)
          actPitch = -Math.sin(p * Math.PI * 2.5) * 0.3 * env
          flash = env // confirmación en la pantalla del pecho
        } else {
          actYaw = Math.sin(p * Math.PI * 3) * 0.26 * env
        }
      }
    } else if (action && reducedMotion) {
      // Con movimiento reducido solo mostramos la confirmación del pecho
      if (action.at < 0) action.at = t
      const p = (t - action.at) / ACTION_DURATION
      if (p >= 1) actionRef.current = null
      else if (action.type === 'nod') flash = Math.sin(Math.PI * p)
    }

    // ---- 2b. Gesto divertido aleatorio (solo en espera) ----
    let qHeadYaw = 0
    let qHeadPitch = 0
    let qHeadRoll = 0
    let qBodyY = 0
    let qBodyRotY = 0
    let qArmLX = 0
    let qArmLZ = 0
    let qArmRX = 0
    let qArmRZ = 0
    let qForeRX = 0
    let qForeRZ = 0
    let qForeRY = 0
    let qHandRY = 0
    let qSpineX = 0
    let qBodyRotX = 0
    let qWaveRaise = 0 // alza del brazo HACIA LA CÁMARA (eje de mundo)
    let qLookDamp = 0 // 1 = ignora el cursor y mira al frente (saludo)
    let qHandOpen = 0 // 0 = puño, 1 = dedos abiertos (pulso del saludo)
    if (!reducedMotion) {
      // gesto pedido desde la interfaz: arranca de inmediato
      if (quirkRef?.current) {
        st.quirk = quirkRef.current
        st.quirkStart = t
        quirkRef.current = null
      }
      // solo arranca un gesto si el robot está tranquilo (sin foco ni gesto de login)
      if (!st.quirk && !action && !focus && t >= st.nextQuirk) {
        st.quirk = QUIRKS[Math.floor(Math.random() * QUIRKS.length)]
        st.quirkStart = t
      }
      if (st.quirk) {
        const p = (t - st.quirkStart) / QUIRK_DURATION[st.quirk]
        if (p >= 1 || action) {
          // un nod/shake del formulario interrumpe el gesto
          const previo = st.quirk
          st.quirk = null
          st.nextQuirk = t + QUIRK_MIN_GAP + Math.random() * (QUIRK_MAX_GAP - QUIRK_MIN_GAP)
          // el baile remata con una reverencia
          if (previo === 'shimmy' && !action) {
            st.quirk = 'duck'
            st.quirkStart = t
          }
        } else {
          const env = Math.sin(Math.PI * p) // entra y sale suave
          // durante cualquier gesto la cabeza deja de seguir al cursor:
          // las animaciones se ven limpias
          qLookDamp = env
          if (st.quirk === 'spin') {
            // vuelta completa con los BRAZOS EN ALTO y un brinquito
            const e = p * p * (3 - 2 * p) // easing suave, termina en 360°
            qBodyRotY = Math.PI * 2 * e
            qBodyY = env * 0.05
            qArmLZ = env * 1.5
            qArmRZ = -env * 1.5
          } else if (st.quirk === 'hop') {
            // dos saltitos con los brazos abiertos (amplitud contenida:
            // el grupo está escalado y un salto grande saca al robot de
            // la pantalla)
            // 0.075: en el pico del salto la antena queda dentro del
            // encuadre (hallazgo del revisor visual)
            qBodyY = Math.abs(Math.sin(p * Math.PI * 3)) * 0.075 * env
            qHeadPitch = env * 0.08 // mirada alegre hacia arriba
            qHeadRoll = Math.sin(p * Math.PI * 3) * 0.06 * env
            qArmLZ = env * 0.6
            qArmRZ = -env * 0.6
          } else if (st.quirk === 'shimmy') {
            // baile animado pero sin estirar la piel: el cuerpo COMPLETO
            // gira (no dobla), brazos al ritmo y saltitos
            // (al terminar remata con una reverencia)
            qBodyRotY = Math.sin(p * Math.PI * 8) * 0.22 * env
            qHeadRoll = Math.sin(p * Math.PI * 8 + 1) * 0.12 * env
            qBodyY = Math.abs(Math.sin(p * Math.PI * 8)) * 0.04 * env
            qArmLX = Math.sin(p * Math.PI * 8) * 0.35 * env
            qArmRX = -Math.sin(p * Math.PI * 8) * 0.35 * env
            qArmLZ = (0.25 + Math.sin(p * Math.PI * 8) * 0.2) * env
            qArmRZ = -(0.25 - Math.sin(p * Math.PI * 8) * 0.2) * env
          } else if (st.quirk === 'wave') {
            // saluda AL FRENTE: brazo apuntando a la pantalla (rotación en
            // eje de mundo), la mano girando como atornillando y la
            // CABEZA mirando al frente (ignora el cursor mientras saluda)
            // AMBOS brazos al frente (alza moderada: no estira el hombro)
            qWaveRaise = env * 1.1
            qArmRZ = -env * 0.2
            qArmLZ = env * 0.2
            const twist = Math.sin(p * Math.PI * 7) * env
            qForeRY = twist * 0.5
            qHandRY = twist * 0.6
            // las manos ABREN y CIERRAN los dedos al ritmo del saludo
            qHandOpen = (0.5 + 0.5 * Math.sin(p * Math.PI * 7 + Math.PI / 2)) * env
            // la cabeza se mueve levemente, viva, mientras saluda
            qHeadRoll = (-0.05 + Math.sin(p * Math.PI * 3) * 0.08) * env
            qHeadPitch = Math.sin(p * Math.PI * 2) * 0.06 * env
            qLookDamp = env
          } else if (st.quirk === 'laugh') {
            // carcajada: el cuerpo rebota y la cabeza se echa atrás
            qBodyY = Math.abs(Math.sin(p * Math.PI * 6)) * 0.03 * env
            qHeadPitch = env * 0.16
            qArmLZ = env * 0.25
            qArmRZ = -env * 0.25
          } else if (st.quirk === 'duck') {
            // se agacha: reverencia moderada (doblar mucho el torso
            // estira la piel de la malla), cabeza abajo y brazos atrás
            qSpineX = -env * 0.42
            qHeadPitch = -env * 0.32
            qArmLZ = env * 0.25
            qArmRZ = -env * 0.25
          } else if (st.quirk === 'fall') {
            // se cae DE ESPALDAS girando sobre los pies (hacia el fondo,
            // así queda entero en cámara), rebota, queda tendido y se
            // vuelve a parar
            const caida = 1.45
            let ang
            if (p < 0.26) {
              const q = p / 0.26
              ang = caida * q * q // acelera al caer
            } else if (p < 0.36) {
              ang = caida - Math.sin(((p - 0.26) / 0.1) * Math.PI) * 0.14 // rebote
            } else if (p < 0.6) {
              ang = caida // tendido en el piso
            } else {
              const q = (p - 0.6) / 0.4
              ang = caida * (1 - q * q * (3 - 2 * q)) // se incorpora suave
            }
            qBodyRotX = -ang
            // manotea mientras cae
            const flail = p < 0.36 ? Math.sin(p * Math.PI * 9) * 0.5 : 0
            qArmLZ = flail + ang * 0.45
            qArmRZ = -flail - ang * 0.45
            qHeadPitch = ang * 0.3 // intenta levantar la cabeza
          }
        }
      }
    }

    // ---- 3. Animación de espera (idle) ----
    let idleBob = 0
    let idleTilt = 0
    let idleAntenna = 0
    let idleArm = 0
    let idleHeadPitch = 0
    if (!reducedMotion) {
      // vaivén SOLO hacia arriba: los pies nunca se hunden bajo el piso
      idleBob = (Math.sin(t * 1.1) * 0.5 + 0.5) * 0.028
      // inclinación ocasional y muy lenta de la cabeza
      idleTilt = 0.07 * Math.sin(t * 0.4) * Math.pow(Math.sin(t * 0.09) * 0.5 + 0.5, 3)
      idleHeadPitch = Math.sin(t * 0.7) * 0.02
      idleAntenna = Math.sin(t * 2.0) * 0.09
      idleArm = Math.sin(t * 1.1 + 1) * 0.05
    }

    // ---- 4. Suavizado (lerp) ----
    const followScale = reducedMotion ? 0.35 : 1 // con motion reducido, casi estático
    // la cabeza sigue al cursor con más reacción que el resto del cuerpo
    // (en este esqueleto, rotación X positiva = cabeza ARRIBA — validado
    // en vivo: el objetivo con cursor arriba debe ser positivo)
    const kf = 1 - Math.exp(-delta * 10)
    st.yaw = lerp(st.yaw, targetYaw * followScale, kf)
    st.pitch = lerp(st.pitch, targetPitch * followScale, kf)
    st.tilt = lerp(st.tilt, tiltTarget, k)
    st.lid = lerp(st.lid, lidTarget, k)
    // mirada normalizada (-1..1); cada globo ocular rota hacia el objetivo
    st.pupX = lerp(st.pupX, lookX, k * 1.6)
    st.pupY = lerp(st.pupY, lookY, k * 1.6)

    // ---- 5. Parpadeo frecuente (a veces doble) ----
    let blinkScale = 1
    if (!reducedMotion) {
      if (t >= st.nextBlink) {
        st.blinkStart = t
        // 25% de las veces parpadea dos veces seguidas
        st.nextBlink = t + (Math.random() < 0.25 ? 0.35 : 1.4 + Math.random() * 2)
      }
      const bp = (t - st.blinkStart) / BLINK_DURATION
      if (bp >= 0 && bp <= 1) {
        blinkScale = 1 - Math.sin(bp * Math.PI) * 0.92
      }
    }

    // ---- 6. Aplicar a los grupos ----
    const { head, eyes, pupils, body, leftArm, rightArm, antenna, screenFlash, eyelids } = refs
    const { spine, leftForearm, rightForearm } = refs

    // durante el saludo la cabeza mira al frente (amortigua el cursor)
    const efYaw = st.yaw * (1 - qLookDamp)
    const efPitch = st.pitch * (1 - qLookDamp)
    if (head.current) {
      const hr = restOf(head.current)
      head.current.rotation.y = hr.y + efYaw + actYaw + qHeadYaw
      head.current.rotation.x = hr.x + efPitch + actPitch + idleHeadPitch + qHeadPitch
      head.current.rotation.z = hr.z + st.tilt + idleTilt + qHeadRoll
    }
    // el torso acompaña una fracción del giro: seguimiento más corporal
    if (spine?.current) {
      const sr = restOf(spine.current)
      spine.current.rotation.y = sr.y + efYaw * SPINE_FOLLOW
      spine.current.rotation.x = sr.x + efPitch * SPINE_FOLLOW * 0.5 + qSpineX
      spine.current.rotation.z = sr.z + st.tilt * 0.4
    }
    const openness = blinkScale * st.lid // 1 = ojo abierto, 0 = cerrado
    const glowMat = eyes.current?.userData.glowMat as THREE.MeshBasicMaterial | undefined
    if (glowMat) {
      // pestañeo: los ojos se oscurecen casi a negro (párpado cerrado)
      const base = (eyes.current!.userData.glowColor as THREE.Color) ?? glowMat.color
      const g = 0.02 + 0.98 * openness
      glowMat.color.copy(base).multiplyScalar(g)
    }
    if (eyelids?.current) {
      // modo 2.5D: el párpado baja cubriendo el ojo de la imagen
      eyelids.current.scale.y = clamp(1 - openness, 0.0001, 1)
    } else if (eyes.current) {
      eyes.current.scale.y = Math.max(0.08, openness)
    }
    if (pupils.current) {
      // los hijos de "pupils" son los pivotes de cada globo ocular
      const gazeYaw = st.pupX * 0.35
      const gazePitch = -st.pupY * 0.22
      for (const eyePivot of pupils.current.children) {
        eyePivot.rotation.y = gazeYaw
        eyePivot.rotation.x = gazePitch
      }
    }
    if (body.current) {
      body.current.position.y = idleBob + qBodyY
      body.current.rotation.y = qBodyRotY
      body.current.rotation.x = qBodyRotX // caída de espaldas sobre los pies
    }
    // balanceo de brazos: péndulo alternado + aleteo lateral visible de frente
    const armSwing = reducedMotion ? 0 : Math.sin(t * ARM_SPEED) * ARM_SWING
    const armFlap = reducedMotion
      ? 0
      : ARM_FLAP_BASE + (Math.sin(t * ARM_SPEED + 0.9) * 0.5 + 0.5) * ARM_FLAP
    // IMPORTANTE: se restablecen los TRES ejes cada frame — las
    // rotaciones por cuaternión (saludo/marioneta) dejan residuos en el
    // euler del hueso que de otro modo se acumulan
    if (leftArm.current) {
      const lr = restOf(leftArm.current)
      leftArm.current.rotation.x = lr.x + armSwing + qArmLX
      leftArm.current.rotation.y = lr.y
      leftArm.current.rotation.z = lr.z - armFlap + qArmLZ
    }
    if (rightArm.current) {
      const rr = restOf(rightArm.current)
      rightArm.current.rotation.x = rr.x - armSwing + qArmRX
      rightArm.current.rotation.y = rr.y
      rightArm.current.rotation.z = rr.z + armFlap + qArmRZ
    }
    // antebrazos: leve flexión de codo en contrafase (brazos más vivos)
    const elbow = reducedMotion ? 0 : 0.1 + Math.sin(t * ARM_SPEED + 2.1) * 0.08
    if (leftForearm?.current) {
      const fr = restOf(leftForearm.current)
      leftForearm.current.rotation.x = fr.x + elbow - armSwing * 0.5
      leftForearm.current.rotation.y = fr.y + qForeRY // atornillado (saludo)
      leftForearm.current.rotation.z = fr.z
    }
    if (rightForearm?.current) {
      const fr = restOf(rightForearm.current)
      rightForearm.current.rotation.x = fr.x + elbow + armSwing * 0.5 + qForeRX
      rightForearm.current.rotation.z = fr.z + qForeRZ
      rightForearm.current.rotation.y = fr.y + qForeRY // giro de atornillado
    }
    // manos: muñeca atornillando y dedos que abren/cierran (escala del
    // hueso: X/Z son el ancho de la mano, Y corre a lo largo del brazo)
    for (const mano of [refs.rightHand?.current, refs.leftHand?.current]) {
      if (!mano) continue
      const hr2 = restOf(mano)
      mano.rotation.y = hr2.y + qHandRY
      mano.scale.set(1 + qHandOpen * 0.4, 1 - qHandOpen * 0.08, 1 + qHandOpen * 0.4)
    }
    // saludo frontal: alza AMBOS brazos hacia la cámara girando en eje
    // de mundo (independiente de la pose local de cada hueso)
    if (qWaveRaise > 0) {
      if (rightArm.current) girarEnEjeMundo(rightArm.current, EJE_X, -qWaveRaise)
      if (rightForearm?.current) girarEnEjeMundo(rightForearm.current, EJE_X, -qWaveRaise * 0.3)
      if (leftArm.current) girarEnEjeMundo(leftArm.current, EJE_X, -qWaveRaise)
      if (leftForearm?.current) girarEnEjeMundo(leftForearm.current, EJE_X, -qWaveRaise * 0.3)
    }
    if (antenna.current) {
      // la antena oscila y además reacciona al giro de la cabeza
      antenna.current.rotation.z = idleAntenna - st.yaw * 0.6
      antenna.current.rotation.x = -st.pitch * 0.4
    }
    if (screenFlash.current) {
      const mat = screenFlash.current.material as THREE.MeshBasicMaterial
      mat.opacity = flash * 0.85
      const sc = 1 + flash * 0.08
      screenFlash.current.scale.set(sc, sc, 1)
    }
  })
}
