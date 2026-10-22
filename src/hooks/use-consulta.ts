import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { mensajeDeError } from '@/lib/errores'

interface Resultado<T> {
  data: T | null
  error: unknown
}

/**
 * Lee datos de Supabase guardando una copia local (RNF-06): si no hay
 * conexión se muestra el último dato conocido y se reintenta al volver internet.
 */
export function useConsulta<T>(clave: string, consultar: () => PromiseLike<Resultado<T>>) {
  const claveCopia = `sinat.copia.${clave}`
  const [datos, setDatos] = useState<T | null>(() => leerCopia<T>(claveCopia))
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [desdeCopia, setDesdeCopia] = useState(false)
  const consultaRef = useRef(consultar)
  useLayoutEffect(() => {
    consultaRef.current = consultar
  })

  const recargar = useCallback(async () => {
    let resultado: Resultado<T>
    try {
      resultado = await consultaRef.current()
    } catch (e) {
      resultado = { data: null, error: e }
    }
    if (resultado.error) {
      const copia = leerCopia<T>(claveCopia)
      if (copia !== null) {
        setDatos(copia)
        setDesdeCopia(true)
      }
      setError(mensajeDeError(resultado.error))
    } else {
      setDatos(resultado.data)
      setDesdeCopia(false)
      setError(null)
      guardarCopia(claveCopia, resultado.data)
    }
    setCargando(false)
  }, [claveCopia])

  // Se actualiza al abrir, al volver internet y al volver a la pestaña,
  // para ver lo que otros registraron desde otro dispositivo.
  useEffect(() => {
    void recargar()
    const alVolver = () => void recargar()
    const alMostrar = () => {
      if (document.visibilityState === 'visible') void recargar()
    }
    window.addEventListener('online', alVolver)
    document.addEventListener('visibilitychange', alMostrar)
    return () => {
      window.removeEventListener('online', alVolver)
      document.removeEventListener('visibilitychange', alMostrar)
    }
  }, [recargar])

  return { datos, cargando, error, desdeCopia, recargar }
}

function leerCopia<T>(clave: string): T | null {
  try {
    const crudo = localStorage.getItem(clave)
    return crudo ? (JSON.parse(crudo) as T) : null
  } catch {
    return null
  }
}

function guardarCopia(clave: string, valor: unknown) {
  try {
    localStorage.setItem(clave, JSON.stringify(valor))
  } catch {
    // sin almacenamiento local: se sigue sin copia
  }
}
