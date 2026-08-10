import { useMemo, useState } from 'react'
import { loadData, saveData, uid, hoy, formatFecha } from '../lib/storage'

/* Módulo Investigación: guarda links de tecnologías, los describe y
 * los encuentra con búsqueda inteligente (ranking por relevancia). */

type EstadoLink = 'por-revisar' | 'estudiando' | 'dominado'

interface LinkInv {
  id: string
  url: string
  titulo: string
  descripcion: string
  categoria: string
  tags: string[]
  estado: EstadoLink
  fecha: string
  notas: string
}

const KEY = 'investigacion'

const linkVacio = (): LinkInv => ({
  id: '',
  url: '',
  titulo: '',
  descripcion: '',
  categoria: '',
  tags: [],
  estado: 'por-revisar',
  fecha: hoy(),
  notas: '',
})

/** Búsqueda inteligente: puntúa cada link según dónde aparecen los términos */
function puntuar(link: LinkInv, terminos: string[]): number {
  if (terminos.length === 0) return 1
  let score = 0
  const titulo = link.titulo.toLowerCase()
  const desc = link.descripcion.toLowerCase()
  const notas = link.notas.toLowerCase()
  const cat = link.categoria.toLowerCase()
  const tags = link.tags.join(' ').toLowerCase()
  const url = link.url.toLowerCase()
  for (const t of terminos) {
    let hallado = false
    if (titulo.includes(t)) { score += titulo.startsWith(t) ? 6 : 4; hallado = true }
    if (tags.includes(t)) { score += 4; hallado = true }
    if (cat.includes(t)) { score += 3; hallado = true }
    if (desc.includes(t)) { score += 2; hallado = true }
    if (notas.includes(t)) { score += 1.5; hallado = true }
    if (url.includes(t)) { score += 1; hallado = true }
    if (!hallado) return 0 // todos los términos deben aparecer en alguna parte
  }
  return score
}

export default function Research() {
  const [links, setLinksRaw] = useState<LinkInv[]>(() => loadData(KEY, [] as LinkInv[]))
  const [busqueda, setBusqueda] = useState('')
  const [filtroTag, setFiltroTag] = useState('')
  const [filtroEstado, setFiltroEstado] = useState('todos')
  const [editando, setEditando] = useState<LinkInv | null>(null)
  const [tagsTexto, setTagsTexto] = useState('')

  const setLinks = (ls: LinkInv[]) => {
    setLinksRaw(ls)
    saveData(KEY, ls)
  }

  const todosTags = useMemo(() => {
    const m = new Map<string, number>()
    links.forEach((l) => l.tags.forEach((t) => m.set(t, (m.get(t) ?? 0) + 1)))
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18)
  }, [links])

  const resultados = useMemo(() => {
    const terminos = busqueda.toLowerCase().split(/\s+/).filter(Boolean)
    return links
      .filter((l) => (filtroEstado === 'todos' || l.estado === filtroEstado) && (!filtroTag || l.tags.includes(filtroTag)))
      .map((l) => ({ l, s: puntuar(l, terminos) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || b.l.fecha.localeCompare(a.l.fecha))
      .map((x) => x.l)
  }, [links, busqueda, filtroTag, filtroEstado])

  const abrirEditor = (l: LinkInv) => {
    setEditando(l)
    setTagsTexto(l.tags.join(', '))
  }

  const guardar = () => {
    if (!editando || !editando.url.trim()) return
    let url = editando.url.trim()
    if (!/^https?:\/\//.test(url)) url = 'https://' + url
    let titulo = editando.titulo.trim()
    if (!titulo) {
      try {
        titulo = new URL(url).hostname.replace('www.', '')
      } catch {
        titulo = url
      }
    }
    const limpio: LinkInv = {
      ...editando,
      url,
      titulo,
      tags: tagsTexto.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean),
    }
    if (limpio.id) setLinks(links.map((x) => (x.id === limpio.id ? limpio : x)))
    else setLinks([{ ...limpio, id: uid() }, ...links])
    setEditando(null)
  }

  const badge = (e: EstadoLink) =>
    e === 'dominado' ? <span className="badge verde">Dominado</span> : e === 'estudiando' ? <span className="badge amarillo">Estudiando</span> : <span className="badge gris">Por revisar</span>

  return (
    <div>
      <div className="titulo-mod">
        <h2>Investigación</h2>
        <span className="sub">{links.length} recursos guardados</span>
      </div>

      <div className="fila-filtros">
        <input
          className="campo"
          style={{ flex: 1, minWidth: 220 }}
          placeholder="Búsqueda inteligente: ej. «rigging three.js» o «api pagos»…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
        <select className="campo" value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)}>
          <option value="todos">Todos</option>
          <option value="por-revisar">Por revisar</option>
          <option value="estudiando">Estudiando</option>
          <option value="dominado">Dominados</option>
        </select>
        <button className="btn" onClick={() => abrirEditor(linkVacio())}>+ Guardar link</button>
      </div>

      {todosTags.length > 0 && (
        <div className="chips" style={{ marginBottom: 14 }}>
          {filtroTag && (
            <button className="chip" style={{ background: 'rgba(251,113,133,0.18)', color: 'var(--dash-err)' }} onClick={() => setFiltroTag('')}>
              ✕ {filtroTag}
            </button>
          )}
          {todosTags.map(([t, n]) => (
            <button key={t} className="chip" onClick={() => setFiltroTag(t === filtroTag ? '' : t)}>
              {t} · {n}
            </button>
          ))}
        </div>
      )}

      {editando && (
        <div className="panel">
          <h3>{editando.id ? 'Editar recurso' : 'Guardar nuevo link'}</h3>
          <div className="form-grid">
            <div>
              <label className="etq">URL *</label>
              <input className="campo" style={{ width: '100%' }} placeholder="https://…" value={editando.url} onChange={(e) => setEditando({ ...editando, url: e.target.value })} />
            </div>
            <div>
              <label className="etq">Título</label>
              <input className="campo" style={{ width: '100%' }} placeholder="(se completa solo si lo dejas vacío)" value={editando.titulo} onChange={(e) => setEditando({ ...editando, titulo: e.target.value })} />
            </div>
            <div>
              <label className="etq">Categoría</label>
              <input className="campo" style={{ width: '100%' }} placeholder="IA, 3D, backend…" value={editando.categoria} onChange={(e) => setEditando({ ...editando, categoria: e.target.value })} />
            </div>
            <div>
              <label className="etq">Estado</label>
              <select className="campo" style={{ width: '100%' }} value={editando.estado} onChange={(e) => setEditando({ ...editando, estado: e.target.value as EstadoLink })}>
                <option value="por-revisar">Por revisar</option>
                <option value="estudiando">Estudiando</option>
                <option value="dominado">Dominado</option>
              </select>
            </div>
          </div>
          <label className="etq">¿De qué se trata?</label>
          <textarea className="campo" style={{ width: '100%' }} rows={2} placeholder="Resumen breve para encontrarlo después" value={editando.descripcion} onChange={(e) => setEditando({ ...editando, descripcion: e.target.value })} />
          <label className="etq">Tags (separados por coma)</label>
          <input className="campo" style={{ width: '100%' }} placeholder="three.js, rigging, tutorial" value={tagsTexto} onChange={(e) => setTagsTexto(e.target.value)} />
          <label className="etq">Notas de uso</label>
          <textarea className="campo" style={{ width: '100%' }} rows={2} placeholder="Cómo aplicarlo en tus proyectos, trucos, advertencias…" value={editando.notas} onChange={(e) => setEditando({ ...editando, notas: e.target.value })} />
          <div className="acciones">
            <button className="btn" onClick={guardar} disabled={!editando.url.trim()}>Guardar</button>
            <button className="btn sec" onClick={() => setEditando(null)}>Cancelar</button>
          </div>
        </div>
      )}

      <div className="panel">
        {resultados.length === 0 ? (
          <div className="vacio">
            {links.length === 0 ? 'Guarda tu primer link de investigación.' : 'Nada coincide con esa búsqueda.'}
          </div>
        ) : (
          resultados.map((l) => (
            <div key={l.id} className="link-card">
              <div className="cab">
                <a className="tit" href={l.url} target="_blank" rel="noreferrer">{l.titulo}</a>
                {badge(l.estado)}
                {l.categoria && <span className="badge azul">{l.categoria}</span>}
                <span className="nota">{formatFecha(l.fecha)}</span>
              </div>
              {l.descripcion && <div className="desc">{l.descripcion}</div>}
              {l.notas && <div className="desc">💡 {l.notas}</div>}
              <div className="cab">
                <div className="chips">
                  {l.tags.map((t) => (
                    <button key={t} className="chip" onClick={() => setFiltroTag(t)}>{t}</button>
                  ))}
                </div>
                <div style={{ flex: 1 }} />
                <button className="btn mini sec" onClick={() => abrirEditor(l)}>Editar</button>
                <button className="btn mini peligro" onClick={() => setLinks(links.filter((x) => x.id !== l.id))}>Eliminar</button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
