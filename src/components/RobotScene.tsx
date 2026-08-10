import { Suspense, useEffect, useState } from 'react'
import type { MutableRefObject } from 'react'
import { Canvas } from '@react-three/fiber'
import RobotModel from './RobotModel'
import type { FocusTarget, RobotAction } from '../hooks/useRobotAnimation'
import type { MouseState } from '../hooks/useMouseTracking'

interface RobotSceneProps {
  mouse: MutableRefObject<MouseState>
  focusRef: MutableRefObject<FocusTarget>
  actionRef: MutableRefObject<RobotAction | null>
  reducedMotion: boolean
}

function isWebGLAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext('webgl2') || canvas.getContext('webgl'))
    )
  } catch {
    return false
  }
}

export default function RobotScene({ mouse, focusRef, actionRef, reducedMotion }: RobotSceneProps) {
  const [webgl] = useState<boolean>(() => isWebGLAvailable())
  const [frameloop, setFrameloop] = useState<'always' | 'never'>('always')

  // Pausa la animación cuando la pestaña no está visible
  useEffect(() => {
    const onVisibility = () => setFrameloop(document.hidden ? 'never' : 'always')
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  if (!webgl) {
    // Fallback estático si WebGL no está disponible
    return (
      <div className="robot-fallback-wrap">
        <img
          className="robot-fallback"
          src="images/paolo-robot-reference.jpg"
          alt="Robot asistente de PAOLO SAXTON"
        />
      </div>
    )
  }

  return (
    <Canvas
      className="robot-canvas"
      flat
      frameloop={frameloop}
      dpr={[1, 1.5]}
      camera={{ position: [0, 0, 7.4], fov: 40 }}
      gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
      onCreated={({ camera }) => camera.lookAt(0, 0, 0)}
    >
      <ambientLight intensity={0.95} />
      <directionalLight position={[3.5, 5, 5]} intensity={1.1} />
      <directionalLight position={[-4, 2, -2]} intensity={0.45} />
      <Suspense fallback={null}>
        <RobotModel
          mouse={mouse}
          focusRef={focusRef}
          actionRef={actionRef}
          reducedMotion={reducedMotion}
        />
      </Suspense>
    </Canvas>
  )
}
