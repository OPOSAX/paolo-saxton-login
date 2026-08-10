import { useEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'

export interface MouseState {
  /** -1 (izquierda) .. 1 (derecha) */
  x: number
  /** -1 (abajo) .. 1 (arriba) */
  y: number
  /** posición cruda en píxeles (para apuntar la cabeza con exactitud) */
  px: number
  py: number
  /** false cuando el cursor sale de la ventana */
  inside: boolean
}

/**
 * Rastrea la posición del cursor (o del toque en móvil) normalizada a [-1, 1].
 * No provoca re-renders: expone un ref mutable que se lee en cada frame.
 */
export function useMouseTracking(): MutableRefObject<MouseState> {
  const mouse = useRef<MouseState>({ x: 0, y: 0, px: 0, py: 0, inside: false })

  useEffect(() => {
    const setFromPoint = (clientX: number, clientY: number) => {
      mouse.current.x = (clientX / window.innerWidth) * 2 - 1
      mouse.current.y = -((clientY / window.innerHeight) * 2 - 1)
      mouse.current.px = clientX
      mouse.current.py = clientY
      mouse.current.inside = true
    }

    const onMouseMove = (e: MouseEvent) => setFromPoint(e.clientX, e.clientY)

    const onLeave = () => {
      mouse.current.inside = false
    }

    // En móvil: inclinación suave hacia la posición del toque
    const onTouch = (e: TouchEvent) => {
      const t = e.touches[0]
      if (t) setFromPoint(t.clientX, t.clientY)
    }

    window.addEventListener('mousemove', onMouseMove, { passive: true })
    document.documentElement.addEventListener('mouseleave', onLeave)
    window.addEventListener('blur', onLeave)
    window.addEventListener('touchstart', onTouch, { passive: true })
    window.addEventListener('touchmove', onTouch, { passive: true })
    window.addEventListener('touchend', onLeave)

    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      document.documentElement.removeEventListener('mouseleave', onLeave)
      window.removeEventListener('blur', onLeave)
      window.removeEventListener('touchstart', onTouch)
      window.removeEventListener('touchmove', onTouch)
      window.removeEventListener('touchend', onTouch)
    }
  }, [])

  return mouse
}
