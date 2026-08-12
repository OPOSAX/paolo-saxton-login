import { useEffect, useRef, useState } from 'react'
import RobotScene from '../components/RobotScene'
import LoginForm from '../components/LoginForm'
import { useMouseTracking } from '../hooks/useMouseTracking'
import type { FocusField, FocusTarget, QuirkName, RobotAction } from '../hooks/useRobotAnimation'

/** Animaciones que se pueden lanzar desde el panel lateral */
const ANIMACIONES: Array<{ q: QuirkName; icono: string; nombre: string }> = [
  { q: 'wave', icono: '👋', nombre: 'Saludar' },
  { q: 'laugh', icono: '😂', nombre: 'Reír' },
  { q: 'spin', icono: '🔄', nombre: 'Vuelta' },
  { q: 'hop', icono: '🦘', nombre: 'Saltar' },
  { q: 'shimmy', icono: '🕺', nombre: 'Bailar' },
  { q: 'duck', icono: '🙇', nombre: 'Agacharse' },
  { q: 'fall', icono: '😵', nombre: 'Caerse' },
  { q: 'door', icono: '🚪', nombre: 'Puerta' },
]

interface LoginPageProps {
  /** Se llama tras un inicio de sesión exitoso (deja tiempo al gesto del robot) */
  onSuccess?: () => void
}

export default function LoginPage({ onSuccess }: LoginPageProps) {
  const mouse = useMouseTracking()
  const focusRef = useRef<FocusTarget>(null)
  const actionRef = useRef<RobotAction | null>(null)
  const quirkRef = useRef<QuirkName | null>(null)
  // el seguimiento del mouse parte APAGADO y se alterna con un clic
  const [seguirMouse, setSeguirMouse] = useState(false)
  const followRef = useRef(false)
  followRef.current = seguirMouse
  const clickInicio = useRef<{ x: number; y: number } | null>(null)
  const [reducedMotion, setReducedMotion] = useState(false)

  // Respeta prefers-reduced-motion
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReducedMotion(mq.matches)
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // guarda el campo enfocado CON su posición real en pantalla (píxeles)
  // para que el robot lo mire con la misma puntería que al cursor
  const handleFocusChange = (field: FocusField | null, el?: HTMLElement | null) => {
    if (!field || !el) {
      focusRef.current = null
      return
    }
    const r = el.getBoundingClientRect()
    focusRef.current = {
      field,
      px: r.left + r.width / 2,
      py: r.top + r.height / 2,
    }
  }

  const handleSubmitResult = (result: 'success' | 'error') => {
    actionRef.current = { type: result === 'success' ? 'nod' : 'shake', at: -1 }
    if (result === 'success' && onSuccess) {
      window.setTimeout(onSuccess, 1400) // deja que el robot asienta primero
    }
  }

  return (
    <main
      className="login-page"
      onPointerDown={(e) => {
        clickInicio.current = { x: e.clientX, y: e.clientY }
      }}
      onClick={(e) => {
        // un CLIC en zona libre alterna el seguimiento del mouse
        // (se ignoran botones, formulario y los arrastres de marioneta)
        const t = e.target as HTMLElement
        if (t.closest('button, input, a, label, .login-card')) return
        const d = clickInicio.current
        if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8) return
        setSeguirMouse((v) => !v)
      }}
    >
      <section className="robot-side" aria-hidden="true">
        <RobotScene
          mouse={mouse}
          focusRef={focusRef}
          actionRef={actionRef}
          reducedMotion={reducedMotion}
          quirkRef={quirkRef}
          followRef={followRef}
        />
      </section>
      {/* panel de animaciones seleccionables */}
      <div
        style={{
          position: 'fixed',
          left: 16,
          bottom: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 7,
          zIndex: 10,
        }}
      >
        <button
          type="button"
          onClick={() => setSeguirMouse((v) => !v)}
          title="También puedes hacer clic en cualquier zona libre de la página"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: seguirMouse ? 'rgba(79,140,255,0.28)' : 'rgba(255,255,255,0.07)',
            border: `1px solid ${seguirMouse ? 'rgba(79,140,255,0.7)' : 'rgba(255,255,255,0.14)'}`,
            backdropFilter: 'blur(10px)',
            color: '#f0f4fc',
            font: 'inherit',
            fontSize: 14,
            fontWeight: 700,
            padding: '7px 13px 7px 9px',
            borderRadius: 10,
            cursor: 'pointer',
            marginBottom: 4,
          }}
        >
          <span style={{ fontSize: 17 }}>🖱️</span> Seguir mouse: {seguirMouse ? 'Sí' : 'No'}
        </button>
        {ANIMACIONES.map((a) => (
          <button
            key={a.q}
            type="button"
            onClick={() => {
              quirkRef.current = a.q
            }}
            title={a.nombre}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: 'rgba(255,255,255,0.07)',
              border: '1px solid rgba(255,255,255,0.14)',
              backdropFilter: 'blur(10px)',
              color: '#f0f4fc',
              font: 'inherit',
              fontSize: 14,
              fontWeight: 600,
              padding: '7px 13px 7px 9px',
              borderRadius: 10,
              cursor: 'pointer',
            }}
          >
            <span style={{ fontSize: 17 }}>{a.icono}</span> {a.nombre}
          </button>
        ))}
      </div>
      <section className="form-side">
        <LoginForm onFocusChange={handleFocusChange} onSubmitResult={handleSubmitResult} />
      </section>
    </main>
  )
}
