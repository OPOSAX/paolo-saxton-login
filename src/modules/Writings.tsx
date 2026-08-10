import { useEffect, useRef, useState } from 'react'
import { loadData, saveData, uid, descargar } from '../lib/storage'

/* Módulo Mis Escritos: procesador de texto para libros, pensamientos y
 * notas, con autoguardado local y exportación. */

type TipoDoc = 'libro' | 'pensamiento' | 'nota'

interface Doc {
  id: string
  titulo: string
  tipo: TipoDoc
  html: string
  actualizado: number
}

const KEY = 'escritos'

function palabras(html: string): number {
  const texto = html.replace(/<[^>]+>/g, ' ')
  return texto.split(/\s+/).filter(Boolean).length
}

export default function Writings() {
  const [docs, setDocsRaw] = useState<Doc[]>(() => loadData(KEY, [] as Doc[]))
  const [activoId, setActivoId] = useState<string | null>(docs[0]?.id ?? null)
  const [busqueda, setBusqueda] = useState('')
  const [guardado, setGuardado] = useState(true)
  const areaRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<number | null>(null)

  const setDocs = (ds: Doc[]) => {
    setDocsRaw(ds)
    saveData(KEY, ds)
  }

  const activo = docs.find((d) => d.id === activoId) ?? null

  // carga el contenido en el editor al cambiar de documento
  useEffect(() => {
    if (areaRef.current) {
      areaRef.current.innerHTML = activo?.html ?? ''
      setGuardado(true)
    }
  }, [activoId]) // eslint-disable-line react-hooks/exhaustive-deps

  const autoguardar = () => {
    setGuardado(false)
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      if (!areaRef.current || !activoId) return
      const html = areaRef.current.innerHTML
      setDocs(
        loadData(KEY, [] as Doc[]).map((d) => (d.id === activoId ? { ...d, html, actualizado: Date.now() } : d)),
      )
      setGuardado(true)
    }, 700)
  }

  const crear = (tipo: TipoDoc) => {
    const d: Doc = {
      id: uid(),
      titulo: tipo === 'libro' ? 'Nuevo libro' : tipo === 'pensamiento' ? 'Nuevo pensamiento' : 'Nueva nota',
      tipo,
      html: '',
      actualizado: Date.now(),
    }
    setDocs([d, ...docs])
    setActivoId(d.id)
  }

  const cmd = (comando: string, valor?: string) => {
    document.execCommand(comando, false, valor)
    areaRef.current?.focus()
    autoguardar()
  }

  const lista = docs
    .filter((d) => {
      const q = busqueda.toLowerCase()
      return !q || d.titulo.toLowerCase().includes(q) || d.html.toLowerCase().includes(q)
    })
    .sort((a, b) => b.actualizado - a.actualizado)

  const iconoTipo = (t: TipoDoc) => (t === 'libro' ? '📖' : t === 'pensamiento' ? '💭' : '📝')

  return (
    <div>
      <div className="titulo-mod">
        <h2>Mis Escritos y Pensamientos</h2>
        <span className="sub">{docs.length} documentos · autoguardado {guardado ? '✓' : '…'}</span>
      </div>

      <div className="escritos-layout">
        <div className="panel">
          <div className="acciones" style={{ marginTop: 0, marginBottom: 10 }}>
            <button className="btn mini" onClick={() => crear('libro')}>+ Libro</button>
            <button className="btn mini" onClick={() => crear('pensamiento')}>+ Pensamiento</button>
            <button className="btn mini" onClick={() => crear('nota')}>+ Nota</button>
          </div>
          <input className="campo" style={{ width: '100%', marginBottom: 10 }} placeholder="Buscar en todo…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
          <div className="doc-lista">
            {lista.length === 0 && <div className="vacio">Nada por aquí aún.</div>}
            {lista.map((d) => (
              <div key={d.id} className={`doc-item${d.id === activoId ? ' activo' : ''}`} onClick={() => setActivoId(d.id)}>
                <div className="t">{iconoTipo(d.tipo)} {d.titulo}</div>
                <div className="m">
                  {palabras(d.html)} palabras · {new Date(d.actualizado).toLocaleDateString('es-CL')}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          {!activo ? (
            <div className="vacio">Crea o selecciona un documento para escribir.</div>
          ) : (
            <>
              <input
                className="campo"
                style={{ width: '100%', fontSize: 19, fontWeight: 700, marginBottom: 10 }}
                value={activo.titulo}
                onChange={(e) => setDocs(docs.map((d) => (d.id === activo.id ? { ...d, titulo: e.target.value, actualizado: Date.now() } : d)))}
              />
              <div className="editor-toolbar">
                <button title="Negrita" onClick={() => cmd('bold')}><b>B</b></button>
                <button title="Cursiva" onClick={() => cmd('italic')}><i>I</i></button>
                <button title="Subrayado" onClick={() => cmd('underline')}><u>U</u></button>
                <button title="Título" onClick={() => cmd('formatBlock', '<h1>')}>H1</button>
                <button title="Subtítulo" onClick={() => cmd('formatBlock', '<h2>')}>H2</button>
                <button title="Párrafo" onClick={() => cmd('formatBlock', '<p>')}>¶</button>
                <button title="Cita" onClick={() => cmd('formatBlock', '<blockquote>')}>❝</button>
                <button title="Lista" onClick={() => cmd('insertUnorderedList')}>• Lista</button>
                <button title="Lista numerada" onClick={() => cmd('insertOrderedList')}>1. Lista</button>
                <div style={{ flex: 1 }} />
                <button
                  onClick={() =>
                    descargar(
                      `${activo.titulo}.html`,
                      `<!doctype html><meta charset="utf-8"><title>${activo.titulo}</title><body style="max-width:720px;margin:40px auto;font-family:Georgia,serif;line-height:1.7">${activo.html}</body>`,
                      'text/html',
                    )
                  }
                >
                  Exportar
                </button>
                <button
                  className="peligro"
                  style={{ color: 'var(--dash-err)' }}
                  onClick={() => {
                    if (confirm(`¿Eliminar "${activo.titulo}"? Esta acción no se puede deshacer.`)) {
                      const restantes = docs.filter((d) => d.id !== activo.id)
                      setDocs(restantes)
                      setActivoId(restantes[0]?.id ?? null)
                    }
                  }}
                >
                  Eliminar
                </button>
              </div>
              <div
                ref={areaRef}
                className="editor-area"
                contentEditable
                suppressContentEditableWarning
                onInput={autoguardar}
                data-placeholder="Escribe aquí…"
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
