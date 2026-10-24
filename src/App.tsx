import { useEffect, useState, type ReactNode } from 'react'
import { LogOutIcon, MenuIcon, WavesIcon, XIcon } from 'lucide-react'
import { AvisoConexion } from '@/components/aviso-conexion'
import { Button } from '@/components/ui/button'
import { useAlertasAbiertas } from '@/hooks/use-alertas-abiertas'
import { useSesion } from '@/hooks/use-sesion'
import {
  INFO,
  MENU,
  etiquetaPara,
  irA,
  leerSeccion,
  type Seccion,
} from '@/lib/navegacion'
import { configuracionCompleta } from '@/lib/supabase'
import { NOMBRE_ROL, type Perfil } from '@/lib/tipos'
import { cn } from '@/lib/utils'
import { PaginaAlertas } from '@/paginas/alertas'
import { PaginaCatalogos } from '@/paginas/catalogos'
import { PaginaComandas } from '@/paginas/comandas'
import { PaginaInicio } from '@/paginas/inicio'
import { PaginaInicioSesion } from '@/paginas/inicio-sesion'
import { PaginaPedido } from '@/paginas/pedido'
import { PaginaPerfiles } from '@/paginas/perfiles'
import { PaginaRegistro } from '@/paginas/registro'
import { PaginaTablero } from '@/paginas/tablero'

function useSeccion(): Seccion {
  const [seccion, setSeccion] = useState<Seccion>(leerSeccion)
  useEffect(() => {
    const alCambiar = () => {
      setSeccion(leerSeccion())
      window.scrollTo({ top: 0 })
    }
    window.addEventListener('hashchange', alCambiar)
    return () => window.removeEventListener('hashchange', alCambiar)
  }, [])
  return seccion
}

const PAGINAS: Record<Seccion, () => ReactNode> = {
  inicio: () => <PaginaInicio />,
  alertas: () => <PaginaAlertas />,
  comandas: () => <PaginaComandas />,
  tablero: () => <PaginaTablero />,
  pedido: () => <PaginaPedido />,
  registro: () => <PaginaRegistro />,
  catalogos: () => <PaginaCatalogos />,
  perfiles: () => <PaginaPerfiles />,
}

export default function App() {
  const { sesion, perfil, cargando, errorPerfil, cerrarSesion, recargarPerfil } = useSesion()
  const seccion = useSeccion()

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

  return <Aplicacion perfil={perfil} seccion={seccion} onSalir={() => void cerrarSesion()} />
}

function Aplicacion({
  perfil,
  seccion,
  onSalir,
}: {
  perfil: Perfil
  seccion: Seccion
  onSalir: () => void
}) {
  const [menuAbierto, setMenuAbierto] = useState(false)
  const alertas = useAlertasAbiertas()

  // Una sección fuera del menú del rol (p. ej. #catalogos escrito a mano) cae en Inicio.
  const permitidas = MENU[perfil.rol].flatMap((g) => g.secciones)
  const visible = permitidas.includes(seccion) ? seccion : 'inicio'
  const info = INFO[visible]

  function elegir(s: Seccion) {
    irA(s)
    setMenuAbierto(false)
  }

  const menu = (
    <MenuLateral
      perfil={perfil}
      visible={visible}
      alertas={alertas}
      onElegir={elegir}
      onSalir={onSalir}
    />
  )

  return (
    <div className="min-h-svh lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
      {/* Escritorio: menú siempre a la vista */}
      <aside className="sticky top-0 hidden h-svh lg:block">{menu}</aside>

      {/* Móvil: barra superior + menú desplegable */}
      <header className="sticky top-0 z-30 flex items-center gap-3 bg-sidebar px-4 py-3 text-sidebar-foreground lg:hidden">
        <Marca />
        <button
          type="button"
          onClick={() => elegir('alertas')}
          className="ml-auto"
          aria-label={`${alertas?.total ?? 0} alertas abiertas`}
        >
          <ContadorAlertas alertas={alertas} />
        </button>
        <Button
          variant="ghost"
          size="icon"
          className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          aria-label="Abrir menú"
          onClick={() => setMenuAbierto(true)}
        >
          <MenuIcon />
        </Button>
      </header>
      {menuAbierto && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <button
            type="button"
            aria-label="Cerrar menú"
            className="absolute inset-0 bg-black/40 animate-in fade-in"
            onClick={() => setMenuAbierto(false)}
          />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] animate-in slide-in-from-left duration-200">
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-3 right-3 z-10 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              aria-label="Cerrar menú"
              onClick={() => setMenuAbierto(false)}
            >
              <XIcon />
            </Button>
            {menu}
          </div>
        </div>
      )}

      <div className="min-w-0">
        <AvisoConexion />
        <main
          key={visible}
          className="mx-auto max-w-6xl px-4 py-6 duration-300 animate-in fade-in slide-in-from-bottom-1 lg:px-8 lg:py-9"
        >
          <header className="mb-6 flex flex-col gap-1.5">
            <h1 className="font-heading text-[1.75rem] leading-tight font-semibold tracking-tight lg:text-[2.1rem]">
              {info.titulo}
            </h1>
            <p className="max-w-2xl text-sm text-muted-foreground lg:text-base">
              {info.descripcion}
            </p>
          </header>
          {PAGINAS[visible]()}
        </main>
      </div>
    </div>
  )
}

function Marca() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid size-9 place-items-center rounded-full bg-sidebar-primary text-sidebar-primary-foreground">
        <WavesIcon className="size-5" aria-hidden="true" />
      </span>
      <span className="flex flex-col leading-none">
        <span className="font-heading text-lg font-semibold tracking-tight text-sidebar-accent-foreground">
          SIN&amp;AT
        </span>
        <span className="text-[0.7rem] tracking-wide text-sidebar-foreground/70">
          Vila Baleia · alerta temprana
        </span>
      </span>
    </div>
  )
}

function ContadorAlertas({
  alertas,
  className,
}: {
  alertas: { total: number; altas: number } | null
  className?: string
}) {
  if (!alertas || alertas.total === 0) return null
  return (
    <span
      className={cn(
        'inline-flex min-w-6 items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums',
        alertas.altas > 0
          ? 'bg-riesgo text-white'
          : 'bg-sidebar-primary text-sidebar-primary-foreground',
        className,
      )}
      title={
        alertas.altas > 0
          ? `${alertas.total} abiertas, ${alertas.altas} de severidad alta`
          : `${alertas.total} abiertas`
      }
    >
      {alertas.total}
    </span>
  )
}

function MenuLateral({
  perfil,
  visible,
  alertas,
  onElegir,
  onSalir,
}: {
  perfil: Perfil
  visible: Seccion
  alertas: { total: number; altas: number } | null
  onElegir: (s: Seccion) => void
  onSalir: () => void
}) {
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="px-5 pt-6 pb-5">
        <Marca />
      </div>
      <nav className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 pb-4" aria-label="Menú principal">
        {MENU[perfil.rol].map((g) => (
          <div key={g.grupo} className="flex flex-col gap-0.5">
            <span className="px-3 pb-1 text-[0.68rem] font-semibold tracking-[0.14em] text-sidebar-foreground/50 uppercase">
              {g.grupo}
            </span>
            {g.secciones.map((s) => {
              const Icono = INFO[s].icono
              const activa = s === visible
              return (
                <button
                  key={s}
                  type="button"
                  aria-current={activa ? 'page' : undefined}
                  onClick={() => onElegir(s)}
                  className={cn(
                    'relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
                    activa
                      ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                      : 'hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
                  )}
                >
                  {activa && (
                    <span
                      className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-sidebar-primary"
                      aria-hidden="true"
                    />
                  )}
                  <Icono className="size-[1.1rem] shrink-0" aria-hidden="true" />
                  {etiquetaPara(s, perfil.rol)}
                  {s === 'alertas' && <ContadorAlertas alertas={alertas} className="ml-auto" />}
                </button>
              )
            })}
          </div>
        ))}
      </nav>
      <div className="flex items-center gap-3 border-t border-sidebar-border px-5 py-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-sidebar-accent font-heading text-sm font-semibold text-sidebar-accent-foreground">
          {perfil.nombre.trim().charAt(0).toUpperCase()}
        </span>
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-sm font-medium text-sidebar-accent-foreground">
            {perfil.nombre}
          </span>
          <span className="text-xs text-sidebar-foreground/70">{NOMBRE_ROL[perfil.rol]}</span>
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          aria-label="Cerrar sesión"
          title="Cerrar sesión"
          onClick={onSalir}
        >
          <LogOutIcon />
        </Button>
      </div>
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
      <h1 className="font-heading text-2xl font-semibold">{titulo}</h1>
      <p className="max-w-sm text-sm text-muted-foreground">{texto}</p>
      {acciones && <div className="flex gap-2">{acciones}</div>}
    </main>
  )
}
