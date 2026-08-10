import { useEffect, useState } from 'react'
import { loadData, saveData } from '../lib/storage'

/* Módulo Noticias: diario tecnológico con lo mejor de Hacker News y los
 * proyectos GitHub más destacados de la semana, más accesos a foros
 * chinos con traducción. Se consultan APIs públicas directamente desde
 * el navegador y se cachean 30 minutos. */

interface Noticia {
  id: string
  titulo: string
  url: string
  fuente: string
  puntos: number
  comentariosUrl?: string
  extra?: string
}

interface CacheNoticias {
  cuando: number
  hn: Noticia[]
  gh: Noticia[]
}

const KEY_CACHE = 'noticias-cache'
const KEY_FAVS = 'noticias-favs'
const CACHE_MS = 30 * 60 * 1000

const FOROS_CHINOS: Array<{ nombre: string; desc: string; url: string }> = [
  { nombre: 'V2EX', desc: 'El foro tecnológico chino más activo: programación, startups y hardware.', url: 'https://www.v2ex.com/' },
  { nombre: '36Kr', desc: 'Noticias de startups y tecnología de China (el "TechCrunch chino").', url: 'https://36kr.com/' },
  { nombre: 'IT之家 (ITHome)', desc: 'Actualidad de tecnología de consumo, software y ciencia.', url: 'https://www.ithome.com/' },
  { nombre: 'Juejin 掘金', desc: 'Comunidad de desarrolladores: artículos técnicos de frontend, IA y más.', url: 'https://juejin.cn/' },
  { nombre: 'OSCHINA', desc: 'Portal de código abierto chino: proyectos, lanzamientos y noticias.', url: 'https://www.oschina.net/' },
]

function traducido(url: string): string {
  return `https://translate.google.com/translate?sl=zh-CN&tl=es&u=${encodeURIComponent(url)}`
}

async function cargarHN(): Promise<Noticia[]> {
  const ids: number[] = await (await fetch('https://hacker-news.firebaseio.com/v0/topstories.json')).json()
  const top = ids.slice(0, 20)
  const items = await Promise.all(
    top.map(async (id) => {
      try {
        return await (await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)).json()
      } catch {
        return null
      }
    }),
  )
  return items
    .filter((it) => it && it.title)
    .map((it) => ({
      id: 'hn' + it.id,
      titulo: it.title as string,
      url: (it.url as string) || `https://news.ycombinator.com/item?id=${it.id}`,
      fuente: 'Hacker News',
      puntos: (it.score as number) ?? 0,
      comentariosUrl: `https://news.ycombinator.com/item?id=${it.id}`,
      extra: `${it.descendants ?? 0} comentarios`,
    }))
}

async function cargarGitHub(): Promise<Noticia[]> {
  const desde = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
  const r = await fetch(
    `https://api.github.com/search/repositories?q=created:>${desde}&sort=stars&order=desc&per_page=15`,
  )
  const json = await r.json()
  return ((json.items as Array<Record<string, unknown>>) ?? []).map((it) => ({
    id: 'gh' + it.id,
    titulo: it.full_name as string,
    url: it.html_url as string,
    fuente: 'GitHub (nuevo esta semana)',
    puntos: it.stargazers_count as number,
    extra: [(it.language as string) ?? '', ((it.description as string) ?? '').slice(0, 140)].filter(Boolean).join(' · '),
  }))
}

type TabN = 'diario' | 'github' | 'chinos' | 'favoritos'

export default function News() {
  const [tab, setTab] = useState<TabN>('diario')
  const [cache, setCache] = useState<CacheNoticias | null>(() => loadData<CacheNoticias | null>(KEY_CACHE, null))
  const [favs, setFavsRaw] = useState<Noticia[]>(() => loadData(KEY_FAVS, [] as Noticia[]))
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')

  const setFavs = (f: Noticia[]) => {
    setFavsRaw(f)
    saveData(KEY_FAVS, f)
  }

  const refrescar = async (forzar = false) => {
    if (!forzar && cache && Date.now() - cache.cuando < CACHE_MS) return
    setCargando(true)
    setError('')
    try {
      const [hn, gh] = await Promise.all([cargarHN(), cargarGitHub()])
      const nuevo = { cuando: Date.now(), hn, gh }
      setCache(nuevo)
      saveData(KEY_CACHE, nuevo)
    } catch {
      setError('No se pudieron cargar las noticias (¿sin conexión o límite de API?). Intenta de nuevo en unos minutos.')
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => {
    void refrescar()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const esFav = (n: Noticia) => favs.some((f) => f.id === n.id)
  const toggleFav = (n: Noticia) => {
    setFavs(esFav(n) ? favs.filter((f) => f.id !== n.id) : [{ ...n }, ...favs])
  }

  const ListaNoticias = ({ items }: { items: Noticia[] }) => (
    <div className="panel">
      {items.length === 0 && <div className="vacio">{cargando ? 'Cargando…' : 'Sin noticias todavía.'}</div>}
      {items.map((n, i) => (
        <div key={n.id} className="noticia">
          <div className="num">{i + 1}.</div>
          <div style={{ flex: 1 }}>
            <a className="tit" href={n.url} target="_blank" rel="noreferrer">{n.titulo}</a>
            <div className="meta">
              ▲ {n.puntos.toLocaleString('es-CL')} · {n.fuente}
              {n.extra && <> · {n.extra}</>}
              {n.comentariosUrl && (
                <> · <a href={n.comentariosUrl} target="_blank" rel="noreferrer">discusión</a></>
              )}
            </div>
          </div>
          <button className="btn mini sec" title={esFav(n) ? 'Quitar de favoritos' : 'Guardar en favoritos'} onClick={() => toggleFav(n)}>
            {esFav(n) ? '★' : '☆'}
          </button>
        </div>
      ))}
    </div>
  )

  return (
    <div>
      <div className="titulo-mod">
        <h2>Noticias Interesantes</h2>
        <span className="sub">
          {cache ? `actualizado ${new Date(cache.cuando).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}` : 'tu diario tecnológico'}
        </span>
        <div style={{ flex: 1 }} />
        <button className="btn sec mini" onClick={() => refrescar(true)} disabled={cargando}>
          {cargando ? 'Actualizando…' : '↻ Actualizar'}
        </button>
      </div>

      <div className="tabs">
        {(
          [
            ['diario', 'Diario (Hacker News)'],
            ['github', 'GitHub destacados'],
            ['chinos', 'Foros chinos'],
            ['favoritos', `Favoritos (${favs.length})`],
          ] as Array<[TabN, string]>
        ).map(([id, nombre]) => (
          <button key={id} className={tab === id ? 'activo' : ''} onClick={() => setTab(id)}>
            {nombre}
          </button>
        ))}
      </div>

      {error && <div className="panel" style={{ color: 'var(--dash-err)' }}>{error}</div>}

      {tab === 'diario' && <ListaNoticias items={cache?.hn ?? []} />}
      {tab === 'github' && <ListaNoticias items={cache?.gh ?? []} />}
      {tab === 'favoritos' && (
        favs.length === 0 ? (
          <div className="panel"><div className="vacio">Marca noticias con ☆ para armar tu colección.</div></div>
        ) : (
          <ListaNoticias items={favs} />
        )
      )}
      {tab === 'chinos' && (
        <div className="panel">
          <p className="nota" style={{ marginTop: 0 }}>
            Los foros chinos no permiten leerse directo desde el navegador (bloquean peticiones externas), así que
            aquí tienes los mejores con un clic directo y otro <strong>traducido al español</strong> vía Google Translate.
          </p>
          {FOROS_CHINOS.map((f) => (
            <div key={f.url} className="link-card">
              <div className="cab">
                <a className="tit" href={f.url} target="_blank" rel="noreferrer">{f.nombre}</a>
                <a className="chip" href={traducido(f.url)} target="_blank" rel="noreferrer">🌐 leer en español</a>
              </div>
              <div className="desc">{f.desc}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
