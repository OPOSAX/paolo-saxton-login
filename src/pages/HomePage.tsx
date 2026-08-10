import type { Vista } from '../App'

interface HomeProps {
  irA: (v: Vista) => void
}

const TARJETAS: Array<{ id: Vista; icono: string; titulo: string; desc: string }> = [
  {
    id: 'facturacion',
    icono: '🧾',
    titulo: 'Facturación Biznet',
    desc: 'Clientes, servicios, facturas y pagos con seguimiento, filtros y preparación de datos para el SII.',
  },
  {
    id: 'investigacion',
    icono: '🔬',
    titulo: 'Investigación',
    desc: 'Guarda y ordena links de tecnologías con descripción, etiquetas y búsqueda inteligente.',
  },
  {
    id: 'escritos',
    icono: '✍️',
    titulo: 'Mis Escritos y Pensamientos',
    desc: 'Procesador de texto para libros, pensamientos y notas, con autoguardado y exportación.',
  },
  {
    id: 'noticias',
    icono: '📰',
    titulo: 'Noticias Interesantes',
    desc: 'Diario tecnológico: lo mejor de Hacker News, proyectos destacados de GitHub y foros chinos.',
  },
]

export default function HomePage({ irA }: HomeProps) {
  return (
    <div>
      <div className="titulo-mod">
        <h2>Tu espacio personal</h2>
        <span className="sub">elige un módulo para comenzar</span>
      </div>
      <div className="mod-grid">
        {TARJETAS.map((t) => (
          <button key={t.id} className="mod-card" onClick={() => irA(t.id)}>
            <div className="icono" aria-hidden="true">
              {t.icono}
            </div>
            <h3>{t.titulo}</h3>
            <p>{t.desc}</p>
          </button>
        ))}
      </div>
    </div>
  )
}
