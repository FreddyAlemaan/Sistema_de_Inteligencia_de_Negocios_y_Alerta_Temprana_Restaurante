export function formatoCantidad(valor: number | string) {
  return Number(valor).toLocaleString('es', { maximumFractionDigits: 3 })
}

/** Número con a lo sumo n decimales: 3,456 → "3,5" con n = 1. */
export function formatoNumero(valor: number | string, decimales = 1) {
  return Number(valor).toLocaleString('es', { maximumFractionDigits: decimales })
}

/** "2026-10-24" → "24/10/2026" (sin desfase de zona horaria). */
export function formatoFecha(iso: string) {
  const [a, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${a}`
}

export function formatoFechaHora(iso: string) {
  return new Date(iso).toLocaleString('es', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Fecha local de hoy + n días en formato AAAA-MM-DD (para <input type="date">). */
export function fechaMasDias(dias: number) {
  const f = new Date()
  f.setDate(f.getDate() + dias)
  const mm = String(f.getMonth() + 1).padStart(2, '0')
  const dd = String(f.getDate()).padStart(2, '0')
  return `${f.getFullYear()}-${mm}-${dd}`
}
