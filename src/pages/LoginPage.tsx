import { useEffect, useRef, useState } from 'react'
import RobotScene from '../components/RobotScene'
import LoginForm from '../components/LoginForm'
import { useMouseTracking } from '../hooks/useMouseTracking'
import type { FocusField, FocusTarget, RobotAction } from '../hooks/useRobotAnimation'

interface LoginPageProps {
  /** Se llama tras un inicio de sesión exitoso (deja tiempo al gesto del robot) */
  onSuccess?: () => void
}

export default function LoginPage({ onSuccess }: LoginPageProps) {
  const mouse = useMouseTracking()
  const focusRef = useRef<FocusTarget>(null)
  const actionRef = useRef<RobotAction | null>(null)
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
    <main className="login-page">
      <section className="robot-side" aria-hidden="true">
        <RobotScene
          mouse={mouse}
          focusRef={focusRef}
          actionRef={actionRef}
          reducedMotion={reducedMotion}
        />
      </section>
      <section className="form-side">
        <LoginForm onFocusChange={handleFocusChange} onSubmitResult={handleSubmitResult} />
      </section>
    </main>
  )
}
