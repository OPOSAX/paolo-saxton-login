import { useState } from 'react'
import type { FormEvent } from 'react'
import type { FocusField } from '../hooks/useRobotAnimation'

interface LoginFormProps {
  /** Entrega el campo enfocado y su elemento (para que el robot lo mire) */
  onFocusChange: (field: FocusField | null, el?: HTMLElement | null) => void
  onSubmitResult: (result: 'success' | 'error') => void
}

interface FormErrors {
  email?: string
  password?: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export default function LoginForm({ onFocusChange, onSubmitResult }: LoginFormProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [errors, setErrors] = useState<FormErrors>({})
  const [submitted, setSubmitted] = useState(false)

  const validate = (): FormErrors => {
    const next: FormErrors = {}
    if (!email.trim()) next.email = 'Ingresa tu correo electrónico'
    else if (!EMAIL_RE.test(email.trim())) next.email = 'El correo no tiene un formato válido'
    if (!password) next.password = 'Ingresa tu contraseña'
    else if (password.length < 8) next.password = 'La contraseña debe tener al menos 8 caracteres'
    return next
  }

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const next = validate()
    setErrors(next)
    if (Object.keys(next).length > 0) {
      onSubmitResult('error') // el robot niega suavemente
      return
    }
    setSubmitted(true)
    onSubmitResult('success') // el robot asiente y su pecho confirma
  }

  return (
    <div className="login-card">
      <h1 className="brand" aria-label="PAOLO SAXTON">
        <span className="brand-paolo">PAOLO</span> <span className="brand-saxton">SAXTON</span>
      </h1>
      <p className="brand-sub">Accede a tu espacio personal</p>

      <form onSubmit={handleSubmit} noValidate>
        <div className="form-field">
          <label htmlFor="login-email">Correo electrónico</label>
          <input
            id="login-email"
            type="email"
            autoComplete="email"
            placeholder="tucorreo@ejemplo.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onFocus={(e) => onFocusChange('email', e.currentTarget)}
            onBlur={() => onFocusChange(null)}
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? 'error-email' : undefined}
          />
        </div>

        <div className="form-field">
          <label htmlFor="login-password">Contraseña</label>
          <div className="password-wrap">
            <input
              id="login-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onFocus={(e) => onFocusChange('password', e.currentTarget)}
              onBlur={() => onFocusChange(null)}
              aria-invalid={!!errors.password}
              aria-describedby={errors.password ? 'error-password' : undefined}
            />
            <button
              type="button"
              className="toggle-password"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              aria-pressed={showPassword}
            >
              {showPassword ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                  <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                  <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>
        </div>

        <label className="remember">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          <span>Recordarme</span>
        </label>

        {/* Errores accesibles */}
        <div aria-live="polite" className="form-errors">
          {errors.email && (
            <p className="error-msg" id="error-email">
              {errors.email}
            </p>
          )}
          {errors.password && (
            <p className="error-msg" id="error-password">
              {errors.password}
            </p>
          )}
          {submitted && !errors.email && !errors.password && (
            <p className="success-msg">¡Bienvenido de nuevo!</p>
          )}
        </div>

        <button
          type="submit"
          className="submit-btn"
          onMouseEnter={(e) => onFocusChange('button', e.currentTarget)}
          onMouseLeave={() => onFocusChange(null)}
          onFocus={(e) => onFocusChange('button', e.currentTarget)}
          onBlur={() => onFocusChange(null)}
        >
          Iniciar sesión
        </button>
      </form>

      <p className="protected-note">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        Tus datos están protegidos
      </p>
    </div>
  )
}
