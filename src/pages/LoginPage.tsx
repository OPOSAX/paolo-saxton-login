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
]

interface LoginPageProps {
  /** Se llama tras un inicio de sesión exitoso (deja tiempo al gesto del robot) */
  onSuccess?: () => void
}

/* Links personales (completar con las URLs reales) */
const LINKEDIN_URL = ''
const LIBRO_URL = ''

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
      <section className="robot-side">
        <div className="robot-lienzo" aria-hidden="true">
          <RobotScene
            mouse={mouse}
            focusRef={focusRef}
            actionRef={actionRef}
            reducedMotion={reducedMotion}
            quirkRef={quirkRef}
            followRef={followRef}
          />
        </div>
        {/* panel de animaciones seleccionables (queda dentro del área del robot) */}
        <div className="panel-animaciones">
          <button
            type="button"
            className={`boton-anim boton-seguir${seguirMouse ? ' activo' : ''}`}
            onClick={() => setSeguirMouse((v) => !v)}
            title="Seguir mouse (también puedes hacer clic en cualquier zona libre)"
          >
            <span className="icono">🖱️</span>
            <span className="etiqueta">Seguir mouse: {seguirMouse ? 'Sí' : 'No'}</span>
          </button>
          {ANIMACIONES.map((a) => (
            <button
              key={a.q}
              type="button"
              className="boton-anim"
              onClick={() => {
                quirkRef.current = a.q
              }}
              title={a.nombre}
            >
              <span className="icono">{a.icono}</span>
              <span className="etiqueta">{a.nombre}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="form-side">
        <div className="form-columna">
          <LoginForm onFocusChange={handleFocusChange} onSubmitResult={handleSubmitResult} />
          <aside className="sobre-mi">
            <h2 className="sobre-mi-titulo">Sobre mí</h2>
            <p className="sobre-mi-texto">
              Soy <strong>Paolo Saxton</strong>: tecnólogo chileno, apasionado por la
              inteligencia artificial y por ponerla a prueba. Autor de{' '}
              <em>«El arte de darle problemas a la IA»</em>, un libro sobre cómo desafiar
              a los modelos de IA para sacarles lo mejor.
            </p>
            <div className="sobre-mi-links">
              {LINKEDIN_URL && (
                <a href={LINKEDIN_URL} target="_blank" rel="noopener noreferrer" className="sobre-mi-link">
                  <span className="icono">💼</span> LinkedIn
                </a>
              )}
              {LIBRO_URL && (
                <a href={LIBRO_URL} target="_blank" rel="noopener noreferrer" className="sobre-mi-link">
                  <span className="icono">📕</span> Mi libro en Amazon
                </a>
              )}
            </div>
          </aside>
        </div>
      </section>
    </main>
  )
}
