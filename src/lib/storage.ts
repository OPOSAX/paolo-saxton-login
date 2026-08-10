/**
 * Persistencia local simple y tipada (localStorage con prefijo).
 * Cada módulo guarda su estado completo bajo una llave propia.
 */

const PREFIX = 'paolo-saxton:'

export function loadData<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function saveData<T>(key: string, value: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // almacenamiento lleno o bloqueado: se ignora silenciosamente
  }
}

/** id corto único (suficiente para datos locales) */
export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export function hoy(): string {
  return new Date().toISOString().slice(0, 10)
}

export function formatCLP(n: number): string {
  return '$' + Math.round(n).toLocaleString('es-CL')
}

export function formatFecha(iso: string): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}-${m}-${y}`
}

/** Valida un RUT chileno (con o sin puntos, con guión) */
export function validaRut(rut: string): boolean {
  const limpio = rut.replace(/\./g, '').replace(/-/g, '').toUpperCase()
  if (limpio.length < 2) return false
  const cuerpo = limpio.slice(0, -1)
  const dv = limpio.slice(-1)
  if (!/^\d+$/.test(cuerpo)) return false
  let suma = 0
  let mult = 2
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * mult
    mult = mult === 7 ? 2 : mult + 1
  }
  const resto = 11 - (suma % 11)
  const dvCalc = resto === 11 ? '0' : resto === 10 ? 'K' : String(resto)
  return dv === dvCalc
}

export function formatRut(rut: string): string {
  const limpio = rut.replace(/\./g, '').replace(/-/g, '').toUpperCase()
  if (limpio.length < 2) return rut
  const cuerpo = limpio.slice(0, -1)
  const dv = limpio.slice(-1)
  return cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + dv
}

/** Descarga un archivo de texto generado en el navegador */
export function descargar(nombre: string, contenido: string, mime = 'text/plain'): void {
  const blob = new Blob([contenido], { type: mime + ';charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  a.click()
  URL.revokeObjectURL(url)
}
