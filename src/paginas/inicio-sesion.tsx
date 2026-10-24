import { useState, type FormEvent } from 'react'
import { BellIcon, ConciergeBellIcon, HourglassIcon, WavesIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { mensajeDeError } from '@/lib/errores'
import { supabase } from '@/lib/supabase'

export function PaginaInicioSesion() {
  const [correo, setCorreo] = useState('')
  const [contrasena, setContrasena] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function entrar(evento: FormEvent) {
    evento.preventDefault()
    setEnviando(true)
    setError(null)
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: correo.trim(),
        password: contrasena,
      })
      if (error) setError(mensajeDeError(error))
    } catch (e) {
      setError(mensajeDeError(e))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <main className="grid min-h-svh lg:grid-cols-[1.1fr_1fr]">
      {/* Panel de marca: el mar de Madeira */}
      <section className="relative hidden overflow-hidden bg-sidebar p-12 text-sidebar-foreground lg:flex lg:flex-col">
        <Olas />
        <div className="relative flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-full bg-sidebar-primary text-sidebar-primary-foreground">
            <WavesIcon className="size-6" aria-hidden="true" />
          </span>
          <span className="font-heading text-2xl font-semibold text-sidebar-accent-foreground">
            SIN&amp;AT
          </span>
        </div>
        <div className="relative mt-auto flex max-w-md flex-col gap-6">
          <h1 className="font-heading text-5xl leading-[1.05] font-semibold tracking-tight text-sidebar-accent-foreground">
            Ver venir el problema
            <span className="text-sidebar-primary"> antes </span>
            de que llegue.
          </h1>
          <p className="text-base text-sidebar-foreground/80">
            Alerta temprana de inventario y servicio para Vila Baleia: caducidades, faltantes,
            proveedores y tiempos de cocina, en un solo lugar.
          </p>
          <ul className="flex flex-col gap-3 text-sm">
            {[
              { icono: HourglassIcon, texto: 'Sabe hoy cuánto se va a perder de cada lote' },
              { icono: BellIcon, texto: 'Avisa y explica por qué pasa, no sólo qué pasa' },
              { icono: ConciergeBellIcon, texto: 'Vigila en vivo el tiempo de cada mesa' },
            ].map(({ icono: Icono, texto }) => (
              <li key={texto} className="flex items-center gap-3">
                <span className="grid size-8 place-items-center rounded-lg bg-sidebar-accent text-sidebar-primary">
                  <Icono className="size-4" aria-hidden="true" />
                </span>
                {texto}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Formulario */}
      <section className="flex items-center justify-center p-6">
        <div className="flex w-full max-w-sm flex-col gap-8 duration-500 animate-in fade-in slide-in-from-bottom-2">
          <div className="flex flex-col gap-2">
            <span className="grid size-11 place-items-center rounded-full bg-primary text-primary-foreground lg:hidden">
              <WavesIcon className="size-6" aria-hidden="true" />
            </span>
            <h2 className="font-heading text-3xl font-semibold tracking-tight">Bienvenido</h2>
            <p className="text-sm text-muted-foreground">
              Entra con el correo y la contraseña que te dio el gerente.
            </p>
          </div>
          <form onSubmit={entrar} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="correo">Correo</Label>
              <Input
                id="correo"
                type="email"
                autoComplete="username"
                className="h-11 bg-card"
                required
                autoFocus
                value={correo}
                onChange={(e) => setCorreo(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="contrasena">Contraseña</Label>
              <Input
                id="contrasena"
                type="password"
                autoComplete="current-password"
                className="h-11 bg-card"
                required
                value={contrasena}
                onChange={(e) => setContrasena(e.target.value)}
              />
            </div>
            {error && (
              <p role="alert" className="rounded-lg bg-riesgo-suave px-3 py-2 text-sm text-riesgo">
                {error}
              </p>
            )}
            <Button type="submit" size="lg" className="h-11 text-base" disabled={enviando}>
              {enviando ? 'Entrando…' : 'Entrar'}
            </Button>
          </form>
          <p className="text-xs text-muted-foreground">Vila Baleia · Sistema de alerta temprana</p>
        </div>
      </section>
    </main>
  )
}

/** Líneas de olas que se mueven despacio al fondo del panel. */
function Olas() {
  return (
    <svg
      className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 w-full opacity-[0.14]"
      viewBox="0 0 600 400"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {Array.from({ length: 9 }, (_, i) => (
        <path
          key={i}
          d={`M0 ${120 + i * 32} Q 75 ${100 + i * 32} 150 ${120 + i * 32} T 300 ${120 + i * 32} T 450 ${120 + i * 32} T 600 ${120 + i * 32}`}
          fill="none"
          stroke="var(--sidebar-primary)"
          strokeWidth="1.5"
        >
          <animateTransform
            attributeName="transform"
            type="translate"
            values={`0 0; ${i % 2 ? -30 : 30} 0; 0 0`}
            dur={`${9 + i}s`}
            repeatCount="indefinite"
          />
        </path>
      ))}
    </svg>
  )
}
