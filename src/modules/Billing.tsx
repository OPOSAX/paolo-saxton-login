import { useMemo, useState } from 'react'
import { loadData, saveData, uid, hoy, formatCLP, formatFecha, validaRut, formatRut, descargar } from '../lib/storage'

/* ================= Tipos ================= */

export interface Cliente {
  id: string
  rut: string
  razonSocial: string
  giro: string
  direccion: string
  comuna: string
  email: string
  telefono: string
}

export interface Servicio {
  id: string
  codigo: string
  nombre: string
  descripcion: string
  precioNeto: number
  exento: boolean
}

export interface ItemFactura {
  servicioId: string
  nombre: string
  cantidad: number
  precioNeto: number
  descuentoPct: number
  exento: boolean
}

export type EstadoFactura = 'borrador' | 'emitida' | 'pagada' | 'anulada'
export type EstadoSii = 'pendiente' | 'enviada' | 'aceptada' | 'rechazada'

export interface Pago {
  id: string
  fecha: string
  monto: number
  medio: string
  glosa: string
}

export interface Factura {
  id: string
  folio: number | null
  clienteId: string
  fechaEmision: string
  fechaVencimiento: string
  items: ItemFactura[]
  estado: EstadoFactura
  estadoSii: EstadoSii
  trackIdSii: string | null
  pagos: Pago[]
  notas: string
}

interface BillingData {
  clientes: Cliente[]
  servicios: Servicio[]
  facturas: Factura[]
  siguienteFolio: number
}

const IVA = 0.19
const KEY = 'biznet'

const vacio: BillingData = { clientes: [], servicios: [], facturas: [], siguienteFolio: 1 }

/* ============ Cálculos ============ */

function netoItem(it: ItemFactura): number {
  return it.cantidad * it.precioNeto * (1 - it.descuentoPct / 100)
}
function totales(f: Factura) {
  const afecto = f.items.filter((i) => !i.exento).reduce((s, i) => s + netoItem(i), 0)
  const exento = f.items.filter((i) => i.exento).reduce((s, i) => s + netoItem(i), 0)
  const iva = afecto * IVA
  return { afecto, exento, iva, total: afecto + iva + exento }
}
function pagado(f: Factura): number {
  return f.pagos.reduce((s, p) => s + p.monto, 0)
}
function saldo(f: Factura): number {
  return Math.max(0, totales(f).total - pagado(f))
}
function vencida(f: Factura): boolean {
  return f.estado === 'emitida' && !!f.fechaVencimiento && f.fechaVencimiento < hoy() && saldo(f) > 0
}

/* ============ Componente principal ============ */

type Tab = 'resumen' | 'facturas' | 'clientes' | 'servicios' | 'sii'

export default function Billing() {
  const [data, setDataRaw] = useState<BillingData>(() => loadData(KEY, vacio))
  const [tab, setTab] = useState<Tab>('resumen')
  const setData = (d: BillingData) => {
    setDataRaw(d)
    saveData(KEY, d)
  }

  return (
    <div>
      <div className="titulo-mod">
        <h2>Facturación Biznet</h2>
        <span className="sub">clientes · servicios · facturas · pagos · SII</span>
      </div>
      <div className="tabs">
        {(
          [
            ['resumen', 'Resumen'],
            ['facturas', 'Facturas'],
            ['clientes', 'Clientes'],
            ['servicios', 'Servicios'],
            ['sii', 'SII'],
          ] as Array<[Tab, string]>
        ).map(([id, nombre]) => (
          <button key={id} className={tab === id ? 'activo' : ''} onClick={() => setTab(id)}>
            {nombre}
          </button>
        ))}
      </div>
      {tab === 'resumen' && <Resumen data={data} />}
      {tab === 'facturas' && <Facturas data={data} setData={setData} />}
      {tab === 'clientes' && <Clientes data={data} setData={setData} />}
      {tab === 'servicios' && <Servicios data={data} setData={setData} />}
      {tab === 'sii' && <Sii data={data} />}
    </div>
  )
}

/* ============ Resumen ============ */

function Resumen({ data }: { data: BillingData }) {
  const mes = hoy().slice(0, 7)
  const emitidasMes = data.facturas.filter((f) => f.estado !== 'borrador' && f.estado !== 'anulada' && f.fechaEmision.startsWith(mes))
  const facturadoMes = emitidasMes.reduce((s, f) => s + totales(f).total, 0)
  const porCobrar = data.facturas.filter((f) => f.estado === 'emitida').reduce((s, f) => s + saldo(f), 0)
  const nVencidas = data.facturas.filter(vencida).length
  const nBorradores = data.facturas.filter((f) => f.estado === 'borrador').length

  const porCliente = new Map<string, number>()
  for (const f of data.facturas) {
    if (f.estado === 'borrador' || f.estado === 'anulada') continue
    porCliente.set(f.clienteId, (porCliente.get(f.clienteId) ?? 0) + totales(f).total)
  }
  const top = [...porCliente.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)

  return (
    <div>
      <div className="kpis">
        <div className="kpi">
          <div className="nombre">Facturado este mes</div>
          <div className="valor">{formatCLP(facturadoMes)}</div>
        </div>
        <div className="kpi">
          <div className="nombre">Por cobrar</div>
          <div className="valor">{formatCLP(porCobrar)}</div>
        </div>
        <div className="kpi">
          <div className="nombre">Facturas vencidas</div>
          <div className="valor" style={{ color: nVencidas ? 'var(--dash-err)' : undefined }}>{nVencidas}</div>
        </div>
        <div className="kpi">
          <div className="nombre">Borradores</div>
          <div className="valor">{nBorradores}</div>
        </div>
      </div>
      <div className="panel">
        <h3>Top clientes</h3>
        {top.length === 0 ? (
          <div className="vacio">Aún no hay facturación registrada.</div>
        ) : (
          <table className="tabla">
            <tbody>
              {top.map(([cid, monto]) => (
                <tr key={cid}>
                  <td>{data.clientes.find((c) => c.id === cid)?.razonSocial ?? '(cliente eliminado)'}</td>
                  <td style={{ textAlign: 'right' }}>{formatCLP(monto)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

/* ============ Clientes ============ */

const clienteVacio = (): Cliente => ({
  id: '',
  rut: '',
  razonSocial: '',
  giro: '',
  direccion: '',
  comuna: '',
  email: '',
  telefono: '',
})

function Clientes({ data, setData }: { data: BillingData; setData: (d: BillingData) => void }) {
  const [busqueda, setBusqueda] = useState('')
  const [editando, setEditando] = useState<Cliente | null>(null)
  const [errorRut, setErrorRut] = useState('')

  const lista = data.clientes.filter((c) => {
    const q = busqueda.toLowerCase()
    return !q || c.razonSocial.toLowerCase().includes(q) || c.rut.includes(q) || c.giro.toLowerCase().includes(q)
  })

  const guardar = () => {
    if (!editando) return
    if (!editando.razonSocial.trim()) return
    if (!validaRut(editando.rut)) {
      setErrorRut('RUT inválido (revisa el dígito verificador)')
      return
    }
    setErrorRut('')
    const limpio = { ...editando, rut: formatRut(editando.rut) }
    if (limpio.id) {
      setData({ ...data, clientes: data.clientes.map((c) => (c.id === limpio.id ? limpio : c)) })
    } else {
      setData({ ...data, clientes: [...data.clientes, { ...limpio, id: uid() }] })
    }
    setEditando(null)
  }

  const eliminar = (id: string) => {
    if (data.facturas.some((f) => f.clienteId === id)) {
      alert('No se puede eliminar: el cliente tiene facturas asociadas.')
      return
    }
    setData({ ...data, clientes: data.clientes.filter((c) => c.id !== id) })
  }

  return (
    <div>
      <div className="fila-filtros">
        <input
          className="campo"
          style={{ flex: 1, minWidth: 200 }}
          placeholder="Buscar por razón social, RUT o giro…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
        <button className="btn" onClick={() => setEditando(clienteVacio())}>
          + Nuevo cliente
        </button>
      </div>

      {editando && (
        <div className="panel">
          <h3>{editando.id ? 'Editar cliente' : 'Nuevo cliente'}</h3>
          <div className="form-grid">
            <div>
              <label className="etq">RUT *</label>
              <input className="campo" style={{ width: '100%' }} placeholder="76.543.210-K" value={editando.rut} onChange={(e) => setEditando({ ...editando, rut: e.target.value })} />
              {errorRut && <div className="error-inline">{errorRut}</div>}
            </div>
            <div>
              <label className="etq">Razón social *</label>
              <input className="campo" style={{ width: '100%' }} value={editando.razonSocial} onChange={(e) => setEditando({ ...editando, razonSocial: e.target.value })} />
            </div>
            <div>
              <label className="etq">Giro</label>
              <input className="campo" style={{ width: '100%' }} value={editando.giro} onChange={(e) => setEditando({ ...editando, giro: e.target.value })} />
            </div>
            <div>
              <label className="etq">Dirección</label>
              <input className="campo" style={{ width: '100%' }} value={editando.direccion} onChange={(e) => setEditando({ ...editando, direccion: e.target.value })} />
            </div>
            <div>
              <label className="etq">Comuna</label>
              <input className="campo" style={{ width: '100%' }} value={editando.comuna} onChange={(e) => setEditando({ ...editando, comuna: e.target.value })} />
            </div>
            <div>
              <label className="etq">Email</label>
              <input className="campo" style={{ width: '100%' }} value={editando.email} onChange={(e) => setEditando({ ...editando, email: e.target.value })} />
            </div>
            <div>
              <label className="etq">Teléfono</label>
              <input className="campo" style={{ width: '100%' }} value={editando.telefono} onChange={(e) => setEditando({ ...editando, telefono: e.target.value })} />
            </div>
          </div>
          <div className="acciones">
            <button className="btn" onClick={guardar} disabled={!editando.razonSocial.trim() || !editando.rut.trim()}>
              Guardar
            </button>
            <button className="btn sec" onClick={() => { setEditando(null); setErrorRut('') }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      <div className="panel tabla-scroll">
        {lista.length === 0 ? (
          <div className="vacio">Sin clientes todavía. Crea el primero para poder facturar.</div>
        ) : (
          <table className="tabla">
            <thead>
              <tr>
                <th>RUT</th>
                <th>Razón social</th>
                <th>Giro</th>
                <th>Contacto</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lista.map((c) => (
                <tr key={c.id}>
                  <td>{c.rut}</td>
                  <td>
                    <strong>{c.razonSocial}</strong>
                    <div className="nota">{[c.direccion, c.comuna].filter(Boolean).join(', ')}</div>
                  </td>
                  <td>{c.giro || '—'}</td>
                  <td>
                    {c.email && <div>{c.email}</div>}
                    {c.telefono && <div className="nota">{c.telefono}</div>}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn mini sec" onClick={() => setEditando(c)}>Editar</button>{' '}
                    <button className="btn mini peligro" onClick={() => eliminar(c.id)}>Eliminar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

/* ============ Servicios ============ */

const servicioVacio = (): Servicio => ({ id: '', codigo: '', nombre: '', descripcion: '', precioNeto: 0, exento: false })

function Servicios({ data, setData }: { data: BillingData; setData: (d: BillingData) => void }) {
  const [busqueda, setBusqueda] = useState('')
  const [editando, setEditando] = useState<Servicio | null>(null)

  const lista = data.servicios.filter((s) => {
    const q = busqueda.toLowerCase()
    return !q || s.nombre.toLowerCase().includes(q) || s.codigo.toLowerCase().includes(q)
  })

  const guardar = () => {
    if (!editando || !editando.nombre.trim()) return
    if (editando.id) {
      setData({ ...data, servicios: data.servicios.map((s) => (s.id === editando.id ? editando : s)) })
    } else {
      setData({ ...data, servicios: [...data.servicios, { ...editando, id: uid() }] })
    }
    setEditando(null)
  }

  return (
    <div>
      <div className="fila-filtros">
        <input className="campo" style={{ flex: 1, minWidth: 200 }} placeholder="Buscar servicio…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        <button className="btn" onClick={() => setEditando(servicioVacio())}>+ Nuevo servicio</button>
      </div>

      {editando && (
        <div className="panel">
          <h3>{editando.id ? 'Editar servicio' : 'Nuevo servicio'}</h3>
          <div className="form-grid">
            <div>
              <label className="etq">Código</label>
              <input className="campo" style={{ width: '100%' }} placeholder="SRV-001" value={editando.codigo} onChange={(e) => setEditando({ ...editando, codigo: e.target.value })} />
            </div>
            <div>
              <label className="etq">Nombre *</label>
              <input className="campo" style={{ width: '100%' }} value={editando.nombre} onChange={(e) => setEditando({ ...editando, nombre: e.target.value })} />
            </div>
            <div>
              <label className="etq">Precio neto (CLP)</label>
              <input className="campo" style={{ width: '100%' }} type="number" min={0} value={editando.precioNeto || ''} onChange={(e) => setEditando({ ...editando, precioNeto: Number(e.target.value) })} />
            </div>
            <div>
              <label className="etq">Tipo</label>
              <select className="campo" style={{ width: '100%' }} value={editando.exento ? 'exento' : 'afecto'} onChange={(e) => setEditando({ ...editando, exento: e.target.value === 'exento' })}>
                <option value="afecto">Afecto a IVA</option>
                <option value="exento">Exento</option>
              </select>
            </div>
          </div>
          <label className="etq">Descripción</label>
          <textarea className="campo" style={{ width: '100%' }} rows={2} value={editando.descripcion} onChange={(e) => setEditando({ ...editando, descripcion: e.target.value })} />
          <div className="acciones">
            <button className="btn" onClick={guardar} disabled={!editando.nombre.trim()}>Guardar</button>
            <button className="btn sec" onClick={() => setEditando(null)}>Cancelar</button>
          </div>
        </div>
      )}

      <div className="panel tabla-scroll">
        {lista.length === 0 ? (
          <div className="vacio">Sin servicios. Define tu catálogo para agregarlos a las facturas.</div>
        ) : (
          <table className="tabla">
            <thead>
              <tr><th>Código</th><th>Servicio</th><th>Precio neto</th><th>Tipo</th><th></th></tr>
            </thead>
            <tbody>
              {lista.map((s) => (
                <tr key={s.id}>
                  <td>{s.codigo || '—'}</td>
                  <td>
                    <strong>{s.nombre}</strong>
                    {s.descripcion && <div className="nota">{s.descripcion}</div>}
                  </td>
                  <td>{formatCLP(s.precioNeto)}</td>
                  <td>{s.exento ? <span className="badge gris">Exento</span> : <span className="badge azul">Afecto</span>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn mini sec" onClick={() => setEditando(s)}>Editar</button>{' '}
                    <button className="btn mini peligro" onClick={() => setData({ ...data, servicios: data.servicios.filter((x) => x.id !== s.id) })}>Eliminar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

/* ============ Facturas ============ */

function badgeEstado(f: Factura) {
  if (f.estado === 'borrador') return <span className="badge gris">Borrador</span>
  if (f.estado === 'anulada') return <span className="badge gris">Anulada</span>
  if (f.estado === 'pagada') return <span className="badge verde">Pagada</span>
  if (vencida(f)) return <span className="badge rojo">Vencida</span>
  return <span className="badge amarillo">Emitida</span>
}

function badgeSii(f: Factura) {
  if (f.estadoSii === 'aceptada') return <span className="badge verde">SII aceptada</span>
  if (f.estadoSii === 'enviada') return <span className="badge azul">SII enviada</span>
  if (f.estadoSii === 'rechazada') return <span className="badge rojo">SII rechazada</span>
  return <span className="badge gris">SII pendiente</span>
}

function Facturas({ data, setData }: { data: BillingData; setData: (d: BillingData) => void }) {
  const [busqueda, setBusqueda] = useState('')
  const [filtroEstado, setFiltroEstado] = useState('todas')
  const [filtroCliente, setFiltroCliente] = useState('todos')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [abierta, setAbierta] = useState<string | null>(null)
  const [creando, setCreando] = useState(false)

  const lista = useMemo(() => {
    return data.facturas
      .filter((f) => {
        if (filtroEstado === 'vencidas') return vencida(f)
        if (filtroEstado !== 'todas' && f.estado !== filtroEstado) return false
        if (filtroCliente !== 'todos' && f.clienteId !== filtroCliente) return false
        if (desde && f.fechaEmision < desde) return false
        if (hasta && f.fechaEmision > hasta) return false
        const q = busqueda.toLowerCase()
        if (q) {
          const cli = data.clientes.find((c) => c.id === f.clienteId)
          const texto = `${f.folio ?? ''} ${cli?.razonSocial ?? ''} ${cli?.rut ?? ''} ${f.notas} ${f.items.map((i) => i.nombre).join(' ')}`.toLowerCase()
          if (!texto.includes(q)) return false
        }
        return true
      })
      .sort((a, b) => (b.fechaEmision + b.id).localeCompare(a.fechaEmision + a.id))
  }, [data, busqueda, filtroEstado, filtroCliente, desde, hasta])

  const exportarCsv = () => {
    const filas = [['Folio', 'Cliente', 'RUT', 'Emision', 'Vencimiento', 'Neto', 'IVA', 'Total', 'Pagado', 'Saldo', 'Estado', 'SII']]
    for (const f of lista) {
      const c = data.clientes.find((x) => x.id === f.clienteId)
      const t = totales(f)
      filas.push([
        String(f.folio ?? ''),
        c?.razonSocial ?? '',
        c?.rut ?? '',
        f.fechaEmision,
        f.fechaVencimiento,
        String(Math.round(t.afecto + t.exento)),
        String(Math.round(t.iva)),
        String(Math.round(t.total)),
        String(Math.round(pagado(f))),
        String(Math.round(saldo(f))),
        f.estado,
        f.estadoSii,
      ])
    }
    descargar('facturas-biznet.csv', filas.map((r) => r.map((x) => `"${x.replace(/"/g, '""')}"`).join(';')).join('\n'), 'text/csv')
  }

  const facturaAbierta = data.facturas.find((f) => f.id === abierta)

  return (
    <div>
      <div className="fila-filtros">
        <input className="campo" style={{ flex: 1, minWidth: 180 }} placeholder="Buscar folio, cliente, servicio…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        <select className="campo" value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)}>
          <option value="todas">Todas</option>
          <option value="borrador">Borradores</option>
          <option value="emitida">Emitidas</option>
          <option value="vencidas">Vencidas</option>
          <option value="pagada">Pagadas</option>
          <option value="anulada">Anuladas</option>
        </select>
        <select className="campo" value={filtroCliente} onChange={(e) => setFiltroCliente(e.target.value)}>
          <option value="todos">Todos los clientes</option>
          {data.clientes.map((c) => (
            <option key={c.id} value={c.id}>{c.razonSocial}</option>
          ))}
        </select>
        <input className="campo" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} title="Desde" />
        <input className="campo" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} title="Hasta" />
        <button className="btn sec" onClick={exportarCsv}>Exportar CSV</button>
        <button className="btn" onClick={() => setCreando(true)}>+ Nueva factura</button>
      </div>

      {creando && (
        <NuevaFactura
          data={data}
          onCancelar={() => setCreando(false)}
          onCrear={(f) => {
            setData({ ...data, facturas: [...data.facturas, f] })
            setCreando(false)
            setAbierta(f.id)
          }}
        />
      )}

      {facturaAbierta && (
        <DetalleFactura
          data={data}
          factura={facturaAbierta}
          onCerrar={() => setAbierta(null)}
          onActualizar={(f) => setData({
            ...data,
            facturas: data.facturas.map((x) => (x.id === f.id ? f : x)),
            siguienteFolio: f.folio && f.folio >= data.siguienteFolio ? f.folio + 1 : data.siguienteFolio,
          })}
        />
      )}

      <div className="panel tabla-scroll">
        {lista.length === 0 ? (
          <div className="vacio">No hay facturas con estos filtros.</div>
        ) : (
          <table className="tabla">
            <thead>
              <tr><th>Folio</th><th>Cliente</th><th>Emisión</th><th>Total</th><th>Saldo</th><th>Estado</th><th>SII</th></tr>
            </thead>
            <tbody>
              {lista.map((f) => {
                const c = data.clientes.find((x) => x.id === f.clienteId)
                return (
                  <tr key={f.id} onClick={() => setAbierta(f.id)} style={{ cursor: 'pointer' }}>
                    <td>{f.folio ?? '—'}</td>
                    <td><strong>{c?.razonSocial ?? '(sin cliente)'}</strong></td>
                    <td>{formatFecha(f.fechaEmision)}</td>
                    <td>{formatCLP(totales(f).total)}</td>
                    <td>{formatCLP(saldo(f))}</td>
                    <td>{badgeEstado(f)}</td>
                    <td>{badgeSii(f)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

/* ---- creación de factura ---- */

function NuevaFactura({ data, onCrear, onCancelar }: { data: BillingData; onCrear: (f: Factura) => void; onCancelar: () => void }) {
  const [clienteId, setClienteId] = useState(data.clientes[0]?.id ?? '')
  const [fechaEmision, setFechaEmision] = useState(hoy())
  const [dias, setDias] = useState(30)
  const [items, setItems] = useState<ItemFactura[]>([])
  const [notas, setNotas] = useState('')

  const agregarItem = (servicioId: string) => {
    const s = data.servicios.find((x) => x.id === servicioId)
    if (!s) return
    setItems([...items, { servicioId: s.id, nombre: s.nombre, cantidad: 1, precioNeto: s.precioNeto, descuentoPct: 0, exento: s.exento }])
  }

  const factura: Factura = {
    id: uid(),
    folio: null,
    clienteId,
    fechaEmision,
    fechaVencimiento: new Date(new Date(fechaEmision + 'T12:00:00').getTime() + dias * 86400000).toISOString().slice(0, 10),
    items,
    estado: 'borrador',
    estadoSii: 'pendiente',
    trackIdSii: null,
    pagos: [],
    notas,
  }
  const t = totales(factura)

  if (data.clientes.length === 0 || data.servicios.length === 0) {
    return (
      <div className="panel">
        <h3>Nueva factura</h3>
        <p className="nota">Para facturar necesitas al menos un cliente y un servicio en el catálogo.</p>
        <div className="acciones"><button className="btn sec" onClick={onCancelar}>Cerrar</button></div>
      </div>
    )
  }

  return (
    <div className="panel">
      <h3>Nueva factura (borrador)</h3>
      <div className="form-grid">
        <div>
          <label className="etq">Cliente</label>
          <select className="campo" style={{ width: '100%' }} value={clienteId} onChange={(e) => setClienteId(e.target.value)}>
            {data.clientes.map((c) => (
              <option key={c.id} value={c.id}>{c.razonSocial} — {c.rut}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="etq">Fecha de emisión</label>
          <input className="campo" style={{ width: '100%' }} type="date" value={fechaEmision} onChange={(e) => setFechaEmision(e.target.value)} />
        </div>
        <div>
          <label className="etq">Plazo de pago</label>
          <select className="campo" style={{ width: '100%' }} value={dias} onChange={(e) => setDias(Number(e.target.value))}>
            <option value={0}>Contado</option>
            <option value={15}>15 días</option>
            <option value={30}>30 días</option>
            <option value={60}>60 días</option>
          </select>
        </div>
        <div>
          <label className="etq">Agregar servicio</label>
          <select className="campo" style={{ width: '100%' }} value="" onChange={(e) => e.target.value && agregarItem(e.target.value)}>
            <option value="">— elegir del catálogo —</option>
            {data.servicios.map((s) => (
              <option key={s.id} value={s.id}>{s.nombre} ({formatCLP(s.precioNeto)})</option>
            ))}
          </select>
        </div>
      </div>

      {items.length > 0 && (
        <div className="tabla-scroll" style={{ marginTop: 12 }}>
          <table className="tabla">
            <thead>
              <tr><th>Servicio</th><th>Cant.</th><th>Precio neto</th><th>Desc. %</th><th>Subtotal</th><th></th></tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i}>
                  <td>{it.nombre}{it.exento && <span className="badge gris" style={{ marginLeft: 6 }}>Exento</span>}</td>
                  <td><input className="campo" style={{ width: 70 }} type="number" min={1} value={it.cantidad} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, cantidad: Number(e.target.value) } : x)))} /></td>
                  <td><input className="campo" style={{ width: 110 }} type="number" min={0} value={it.precioNeto} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, precioNeto: Number(e.target.value) } : x)))} /></td>
                  <td><input className="campo" style={{ width: 70 }} type="number" min={0} max={100} value={it.descuentoPct} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, descuentoPct: Number(e.target.value) } : x)))} /></td>
                  <td>{formatCLP(netoItem(it))}</td>
                  <td><button className="btn mini peligro" onClick={() => setItems(items.filter((_, j) => j !== i))}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <label className="etq">Notas</label>
      <input className="campo" style={{ width: '100%' }} value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Observaciones internas u orden de compra" />

      <p className="nota" style={{ marginTop: 12 }}>
        Neto {formatCLP(t.afecto)} · Exento {formatCLP(t.exento)} · IVA 19% {formatCLP(t.iva)} · <strong style={{ color: 'var(--dash-text)' }}>Total {formatCLP(t.total)}</strong>
      </p>
      <div className="acciones">
        <button className="btn" disabled={items.length === 0} onClick={() => onCrear(factura)}>Guardar borrador</button>
        <button className="btn sec" onClick={onCancelar}>Cancelar</button>
      </div>
    </div>
  )
}

/* ---- detalle / ciclo de vida ---- */

function DetalleFactura({ data, factura, onActualizar, onCerrar }: {
  data: BillingData
  factura: Factura
  onActualizar: (f: Factura) => void
  onCerrar: () => void
}) {
  const c = data.clientes.find((x) => x.id === factura.clienteId)
  const t = totales(factura)
  const [monto, setMonto] = useState(0)
  const [medio, setMedio] = useState('Transferencia')

  const emitir = () => {
    onActualizar({
      ...factura,
      estado: 'emitida',
      folio: factura.folio ?? data.siguienteFolio,
      estadoSii: 'enviada',
      trackIdSii: 'TRK-' + Date.now().toString().slice(-8),
    })
  }

  const registrarPago = () => {
    if (monto <= 0) return
    const pagos = [...factura.pagos, { id: uid(), fecha: hoy(), monto, medio, glosa: '' }]
    const f = { ...factura, pagos }
    onActualizar(saldo(f) <= 0 ? { ...f, estado: 'pagada' } : f)
    setMonto(0)
  }

  return (
    <div className="panel">
      <div className="fila-filtros" style={{ marginBottom: 6 }}>
        <h3 style={{ margin: 0 }}>
          Factura {factura.folio ? `N° ${factura.folio}` : '(borrador)'} — {c?.razonSocial}
        </h3>
        {badgeEstado(factura)} {badgeSii(factura)}
        <div style={{ flex: 1 }} />
        <button className="btn mini sec" onClick={onCerrar}>Cerrar</button>
      </div>
      <p className="nota">
        {c?.rut} · {c?.giro || 'sin giro'} · Emisión {formatFecha(factura.fechaEmision)} · Vence {formatFecha(factura.fechaVencimiento)}
        {factura.trackIdSii && <> · Track SII <strong>{factura.trackIdSii}</strong></>}
      </p>

      <div className="tabla-scroll">
        <table className="tabla">
          <thead><tr><th>Detalle</th><th>Cant.</th><th>Precio</th><th>Desc.</th><th style={{ textAlign: 'right' }}>Subtotal</th></tr></thead>
          <tbody>
            {factura.items.map((it, i) => (
              <tr key={i}>
                <td>{it.nombre}</td>
                <td>{it.cantidad}</td>
                <td>{formatCLP(it.precioNeto)}</td>
                <td>{it.descuentoPct ? it.descuentoPct + '%' : '—'}</td>
                <td style={{ textAlign: 'right' }}>{formatCLP(netoItem(it))}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={4} style={{ textAlign: 'right', color: 'var(--dash-dim)' }}>Neto + Exento / IVA / Total</td>
              <td style={{ textAlign: 'right' }}>
                {formatCLP(t.afecto + t.exento)} / {formatCLP(t.iva)} / <strong>{formatCLP(t.total)}</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {factura.pagos.length > 0 && (
        <>
          <label className="etq">Pagos registrados</label>
          <table className="tabla">
            <tbody>
              {factura.pagos.map((p) => (
                <tr key={p.id}>
                  <td>{formatFecha(p.fecha)}</td>
                  <td>{p.medio}</td>
                  <td style={{ textAlign: 'right' }}>{formatCLP(p.monto)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={2} style={{ color: 'var(--dash-dim)' }}>Saldo pendiente</td>
                <td style={{ textAlign: 'right' }}><strong>{formatCLP(saldo(factura))}</strong></td>
              </tr>
            </tbody>
          </table>
        </>
      )}

      <div className="acciones">
        {factura.estado === 'borrador' && (
          <button className="btn" onClick={emitir}>Emitir (folio {data.siguienteFolio}) y enviar al SII</button>
        )}
        {factura.estado === 'emitida' && factura.estadoSii === 'enviada' && (
          <button className="btn sec" onClick={() => onActualizar({ ...factura, estadoSii: 'aceptada' })}>
            Marcar aceptada por SII
          </button>
        )}
        {factura.estado === 'emitida' && (
          <>
            <input className="campo" style={{ width: 140 }} type="number" min={0} placeholder="Monto pago" value={monto || ''} onChange={(e) => setMonto(Number(e.target.value))} />
            <select className="campo" value={medio} onChange={(e) => setMedio(e.target.value)}>
              <option>Transferencia</option>
              <option>Efectivo</option>
              <option>Tarjeta</option>
              <option>Cheque</option>
            </select>
            <button className="btn" onClick={registrarPago} disabled={monto <= 0}>Registrar pago</button>
          </>
        )}
        {factura.estado !== 'anulada' && factura.estado !== 'pagada' && (
          <button className="btn peligro" onClick={() => onActualizar({ ...factura, estado: 'anulada' })}>Anular</button>
        )}
        <button
          className="btn sec"
          onClick={() => descargar(`factura-${factura.folio ?? 'borrador'}.json`, JSON.stringify({ documento: 'FACTURA ELECTRONICA (33)', emisor: 'Biznet', receptor: c, factura, totales: t }, null, 2), 'application/json')}
        >
          Exportar datos (JSON DTE)
        </button>
      </div>
    </div>
  )
}

/* ============ SII ============ */

function Sii({ data }: { data: BillingData }) {
  const enviadas = data.facturas.filter((f) => f.estadoSii !== 'pendiente')
  return (
    <div>
      <div className="panel">
        <h3>Integración con el SII</h3>
        <p className="nota">
          La emisión real de DTE (facturas electrónicas) requiere un <strong>certificado digital</strong> y la
          autorización del SII, cosas que viven fuera de esta app local. Este módulo deja todo preparado: cada
          factura genera sus datos completos (emisor, receptor con RUT validado, detalle, neto, IVA 19% y total)
          exportables como JSON para tu facturador, y aquí puedes hacer el <strong>seguimiento</strong> del estado
          de cada envío con su track ID.
        </p>
        <div className="acciones">
          <a className="btn" href="https://homer.sii.cl/" target="_blank" rel="noreferrer">Abrir portal MiSII</a>
          <a className="btn sec" href="https://www.sii.cl/servicios_online/1039-.html" target="_blank" rel="noreferrer">Facturación electrónica SII</a>
        </div>
      </div>
      <div className="panel tabla-scroll">
        <h3>Seguimiento de envíos</h3>
        {enviadas.length === 0 ? (
          <div className="vacio">Aún no hay facturas enviadas al SII.</div>
        ) : (
          <table className="tabla">
            <thead><tr><th>Folio</th><th>Cliente</th><th>Track ID</th><th>Estado SII</th></tr></thead>
            <tbody>
              {enviadas.map((f) => (
                <tr key={f.id}>
                  <td>{f.folio}</td>
                  <td>{data.clientes.find((x) => x.id === f.clienteId)?.razonSocial}</td>
                  <td>{f.trackIdSii}</td>
                  <td>{badgeSii(f)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
