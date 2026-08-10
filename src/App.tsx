import { useEffect, useState } from 'react'
import LoginPage from './pages/LoginPage'
import HomePage from './pages/HomePage'
import Billing from './modules/Billing'
import Research from './modules/Research'
import Writings from './modules/Writings'
import News from './modules/News'
import './styles/dashboard.css'

export type Vista = 'login' | 'home' | 'facturacion' | 'investigacion' | 'escritos' | 'noticias'

const MODULOS: Array<{ id: Vista; nombre: string }> = [
  { id: 'facturacion', nombre: 'Facturación' },
  { id: 'investigacion', nombre: 'Investigación' },
  { id: 'escritos', nombre: 'Mis Escritos' },
  { id: 'noticias', nombre: 'Noticias' },
]

export default function App() {
  const [vista, setVista] = useState<Vista>(() => {
    const guardada = sessionStorage.getItem('ps-vista') as Vista | null
    return guardada && guardada !== 'login' ? guardada : 'login'
  })

  useEffect(() => {
    sessionStorage.setItem('ps-vista', vista)
  }, [vista])

  if (vista === 'login') {
    return <LoginPage onSuccess={() => setVista('home')} />
  }

  return (
    <div className="dash-root">
      <nav className="dash-nav">
        <div className="dash-brand" onClick={() => setVista('home')}>
          PAOLO <span>SAXTON</span>
        </div>
        {MODULOS.map((m) => (
          <button
            key={m.id}
            className={`navlink${vista === m.id ? ' activo' : ''}`}
            onClick={() => setVista(m.id)}
          >
            {m.nombre}
          </button>
        ))}
        <div className="espacio" />
        <button className="navlink" onClick={() => setVista('login')}>
          Cerrar sesión
        </button>
      </nav>
      <main className="dash-main">
        {vista === 'home' && <HomePage irA={setVista} />}
        {vista === 'facturacion' && <Billing />}
        {vista === 'investigacion' && <Research />}
        {vista === 'escritos' && <Writings />}
        {vista === 'noticias' && <News />}
      </main>
    </div>
  )
}
