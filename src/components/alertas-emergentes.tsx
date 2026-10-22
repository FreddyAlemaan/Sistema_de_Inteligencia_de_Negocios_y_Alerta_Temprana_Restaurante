import { useEffect } from 'react'
import { toast } from 'sonner'
import { useSesion } from '@/hooks/use-sesion'
import { supabase } from '@/lib/supabase'
import { NOMBRE_TIPO_ALERTA, type Alerta } from '@/lib/tipos'

// Duración en pantalla según la severidad: lo grave se queda más tiempo.
const DURACION_MS = { ALTA: 20_000, MEDIA: 10_000, BAJA: 6_000 } as const

export function mostrarAlerta(alerta: Pick<Alerta, 'tipo' | 'severidad' | 'mensaje'>) {
  const titulo = NOMBRE_TIPO_ALERTA[alerta.tipo] ?? alerta.tipo
  const opciones = { description: alerta.mensaje, duration: DURACION_MS[alerta.severidad] }
  if (alerta.severidad === 'ALTA') toast.error(titulo, opciones)
  else if (alerta.severidad === 'MEDIA') toast.warning(titulo, opciones)
  else toast.info(titulo, opciones)
}

/**
 * Muestra como aviso emergente cada alerta que el motor crea, en vivo
 * (Supabase Realtime), y al entrar un resumen de las que siguen abiertas.
 */
export function AlertasEmergentes() {
  const { sesion } = useSesion()
  const usuarioId = sesion?.user.id

  useEffect(() => {
    if (!usuarioId) return
    let activo = true

    // Resumen al iniciar sesión (una vez por sesión del navegador).
    const claveResumen = `sinat.resumen-alertas.${usuarioId}`
    let yaMostrado = false
    try {
      yaMostrado = sessionStorage.getItem(claveResumen) === '1'
    } catch {
      // sin almacenamiento: se muestra de nuevo, no pasa nada
    }
    if (!yaMostrado) {
      // Se marca antes de consultar para no duplicar el aviso si el efecto se repite.
      try {
        sessionStorage.setItem(claveResumen, '1')
      } catch {
        // ignorar
      }
      void supabase
        .from('alerta')
        .select('severidad')
        .eq('estado', 'ABIERTA')
        .then(({ data, error }) => {
          if (!activo || error || !data?.length) return
          const altas = data.filter((a) => a.severidad === 'ALTA').length
          const texto = `Hay ${data.length} ${data.length === 1 ? 'alerta abierta' : 'alertas abiertas'}`
          const detalle = altas > 0 ? `${altas} de severidad alta.` : 'Ninguna de severidad alta.'
          if (altas > 0) toast.error(texto, { description: detalle, duration: 10_000 })
          else toast.warning(texto, { description: detalle, duration: 8_000 })
        })
    }

    const canal = supabase
      .channel('alertas-nuevas')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'alerta' },
        (cambio) => mostrarAlerta(cambio.new as Alerta),
      )
      .subscribe()

    return () => {
      activo = false
      void supabase.removeChannel(canal)
    }
  }, [usuarioId])

  return null
}
