import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { Perfil } from '@/lib/tipos'

interface EstadoSesion {
  sesion: Session | null
  perfil: Perfil | null
  /** true mientras se resuelve la sesión guardada al abrir la app */
  cargando: boolean
  /** El perfil mostrado viene de la copia local (sin conexión) */
  perfilDesdeCopia: boolean
  errorPerfil: string | null
  esGerente: boolean
  recargarPerfil: () => Promise<void>
  cerrarSesion: () => Promise<void>
}

const ContextoSesion = createContext<EstadoSesion | null>(null)

// Copia local del perfil para seguir funcionando sin conexión (RNF-06).
// Sólo afecta lo que se muestra: los permisos reales los impone RLS.
const clavePerfil = (id: string) => `sinat.perfil.${id}`

function leerCopia(id: string): Perfil | null {
  try {
    const crudo = localStorage.getItem(clavePerfil(id))
    return crudo ? (JSON.parse(crudo) as Perfil) : null
  } catch {
    return null
  }
}

function guardarCopia(perfil: Perfil) {
  try {
    localStorage.setItem(clavePerfil(perfil.id), JSON.stringify(perfil))
  } catch {
    // almacenamiento no disponible: se sigue sin copia
  }
}

export function ProveedorSesion({ children }: { children: ReactNode }) {
  const [sesion, setSesion] = useState<Session | null>(null)
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [cargando, setCargando] = useState(true)
  const [perfilDesdeCopia, setPerfilDesdeCopia] = useState(false)
  const [errorPerfil, setErrorPerfil] = useState<string | null>(null)

  const cargarPerfil = useCallback(async (usuarioId: string) => {
    const { data, error } = await supabase
      .from('perfil')
      .select('id, nombre, rol, creado_en')
      .eq('id', usuarioId)
      .maybeSingle()

    if (error) {
      const copia = leerCopia(usuarioId)
      if (copia) {
        setPerfil(copia)
        setPerfilDesdeCopia(true)
        setErrorPerfil(null)
      } else {
        setErrorPerfil('No se pudo cargar tu perfil. Revisa la conexión.')
      }
      return
    }
    if (!data) {
      setPerfil(null)
      setErrorPerfil('Tu usuario no tiene un perfil asignado. Pide ayuda al gerente.')
      return
    }
    setPerfil(data as Perfil)
    setPerfilDesdeCopia(false)
    setErrorPerfil(null)
    guardarCopia(data as Perfil)
  }, [])

  useEffect(() => {
    let activo = true

    supabase.auth.getSession().then(async ({ data }) => {
      if (!activo) return
      setSesion(data.session)
      if (data.session) await cargarPerfil(data.session.user.id)
      if (activo) setCargando(false)
    })

    const { data: suscripcion } = supabase.auth.onAuthStateChange((evento, nuevaSesion) => {
      setSesion(nuevaSesion)
      if (!nuevaSesion) {
        setPerfil(null)
        setErrorPerfil(null)
        return
      }
      if (evento === 'SIGNED_IN' || evento === 'USER_UPDATED') {
        // Fuera del callback: supabase-js no permite esperar consultas dentro de él.
        setTimeout(() => void cargarPerfil(nuevaSesion.user.id), 0)
      }
    })

    return () => {
      activo = false
      suscripcion.subscription.unsubscribe()
    }
  }, [cargarPerfil])

  // Al volver la conexión, se actualiza el perfil si se estaba usando la copia.
  useEffect(() => {
    const alVolver = () => {
      if (sesion) void cargarPerfil(sesion.user.id)
    }
    window.addEventListener('online', alVolver)
    return () => window.removeEventListener('online', alVolver)
  }, [sesion, cargarPerfil])

  const recargarPerfil = useCallback(async () => {
    if (sesion) await cargarPerfil(sesion.user.id)
  }, [sesion, cargarPerfil])

  const cerrarSesion = useCallback(async () => {
    // scope local: cierra en este dispositivo aunque no haya conexión
    await supabase.auth.signOut({ scope: 'local' })
  }, [])

  return (
    <ContextoSesion.Provider
      value={{
        sesion,
        perfil,
        cargando,
        perfilDesdeCopia,
        errorPerfil,
        esGerente: perfil?.rol === 'gerente',
        recargarPerfil,
        cerrarSesion,
      }}
    >
      {children}
    </ContextoSesion.Provider>
  )
}

export function useSesion() {
  const contexto = useContext(ContextoSesion)
  if (!contexto) throw new Error('useSesion debe usarse dentro de <ProveedorSesion>')
  return contexto
}
