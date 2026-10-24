import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

/**
 * Cuántas alertas siguen abiertas (y cuántas son de severidad alta), en vivo.
 * Alimenta el contador del menú para que el gerente no tenga que buscarlas.
 */
export function useAlertasAbiertas() {
  const [conteo, setConteo] = useState<{ total: number; altas: number } | null>(null)

  const recargar = useCallback(async () => {
    const { data, error } = await supabase.from('alerta').select('severidad').eq('estado', 'ABIERTA')
    // Sin conexión se conserva el último número conocido (RNF-06).
    if (!error && data) {
      setConteo({ total: data.length, altas: data.filter((a) => a.severidad === 'ALTA').length })
    }
  }, [])

  useEffect(() => {
    void recargar()
    const canal = supabase
      .channel('contador-alertas')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'alerta' }, () => {
        void recargar()
      })
      .subscribe()
    const alVolver = () => void recargar()
    window.addEventListener('online', alVolver)
    return () => {
      window.removeEventListener('online', alVolver)
      void supabase.removeChannel(canal)
    }
  }, [recargar])

  return conteo
}
