import { useEffect, useState, type ReactNode } from 'react'
import { LogOutIcon } from 'lucide-react'
import { AvisoConexion } from '@/components/aviso-conexion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useSesion } from '@/hooks/use-sesion'
import { configuracionCompleta } from '@/lib/supabase'
import { NOMBRE_ROL, type Rol } from '@/lib/tipos'
import { PaginaCatalogos } from '@/paginas/catalogos'
import { PaginaInicio } from '@/paginas/inicio'
import { PaginaInicioSesion } from '@/paginas/inicio-sesion'
import { PaginaPerfiles } from '@/paginas/perfiles'
import { PaginaRegistro } from '@/paginas/registro'

const SECCIONES = ['inicio', 'registro', 'catalogos', 'perfiles'] as const
type Seccion = (typeof SECCIONES)[number]

// Cada rol ve su propio menú. El operativo sólo lo que usa a diario;
// los permisos reales los sigue imponiendo RLS en la base de datos.
const MENU: Record<Rol, { seccion: Seccion; etiqueta: string }[]> = {
  gerente: [
    { seccion: 'inicio', etiqueta: 'Inicio' },
    { seccion: 'registro', etiqueta: 'Registro' },
    { seccion: 'catalogos', etiqueta: 'Catálogos' },
    { seccion: 'perfiles', etiqueta: 'Usuarios' },
  ],
  operativo: [
    { seccion: 'inicio', etiqueta: 'Inicio' },
    { seccion: 'registro', etiqueta: 'Registro' },
    { seccion: 'perfiles', etiqueta: 'Mi perfil' },
  ],
}

// Navegación mínima por #hash (sin librería de rutas).
const leerSeccion = (): Seccion => {
  const hash = window.location.hash.slice(1)
  return (SECCIONES as readonly string[]).includes(hash) ? (hash as Seccion) : 'inicio'
}

function useSeccion(): [Seccion, (s: Seccion) => void] {
  const [seccion, setSeccion] = useState<Seccion>(leerSeccion)
  useEffect(() => {
    const alCambiar = () => setSeccion(leerSeccion())
    window.addEventListener('hashchange', alCambiar)
    return () => window.removeEventListener('hashchange', alCambiar)
  }, [])
  return [seccion, (s) => (window.location.hash = s)]
}

export default function App() {
  const { sesion, perfil, cargando, errorPerfil, esGerente, cerrarSesion, recargarPerfil } =
    useSesion()
  const [seccion, irA] = useSeccion()

  if (!configuracionCompleta) {
    return (
      <PantallaMensaje
        titulo="Falta la configuración"
        texto="Crea el archivo .env con VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY (ver .env.example) y reinicia."
      />
    )
  }
  if (cargando) return <PantallaMensaje titulo="SIN&AT" texto="Cargando…" />
  if (!sesion) return <PaginaInicioSesion />
  if (!perfil) {
    return (
      <PantallaMensaje
        titulo="No se pudo abrir tu perfil"
        texto={errorPerfil ?? 'Cargando perfil…'}
        acciones={
          <>
            <Button variant="outline" onClick={() => void recargarPerfil()}>
              Reintentar
            </Button>
            <Button variant="ghost" onClick={() => void cerrarSesion()}>
              Cerrar sesión
            </Button>
          </>
        }
      />
    )
  }

  const menu = MENU[perfil.rol]
  // Una sección fuera del menú del rol (p. ej. #catalogos escrito a mano) cae en Inicio.
  const visible = menu.some((m) => m.seccion === seccion) ? seccion : 'inicio'

  return (
    <div className="min-h-svh bg-muted/40">
      <AvisoConexion />
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <span className="font-heading text-lg font-semibold">SIN&amp;AT</span>
          <nav className="flex gap-1">
            {menu.map((m) => (
              <Button
                key={m.seccion}
                variant={visible === m.seccion ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => irA(m.seccion)}
              >
                {m.etiqueta}
              </Button>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-sm">{perfil.nombre}</span>
            <Badge variant={esGerente ? 'default' : 'secondary'}>{NOMBRE_ROL[perfil.rol]}</Badge>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Cerrar sesión"
              title="Cerrar sesión"
              onClick={() => void cerrarSesion()}
            >
              <LogOutIcon />
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl p-4">
        {visible === 'registro' ? (
          <PaginaRegistro />
        ) : visible === 'perfiles' ? (
          <PaginaPerfiles />
        ) : visible === 'catalogos' ? (
          <PaginaCatalogos />
        ) : (
          <PaginaInicio />
        )}
      </main>
    </div>
  )
}

function PantallaMensaje({
  titulo,
  texto,
  acciones,
}: {
  titulo: string
  texto: string
  acciones?: ReactNode
}) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-3 p-4 text-center">
      <h1 className="font-heading text-xl font-semibold">{titulo}</h1>
      <p className="max-w-sm text-sm text-muted-foreground">{texto}</p>
      {acciones && <div className="flex gap-2">{acciones}</div>}
    </main>
  )
}
