import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { CheckCircle2Icon, ChefHatIcon, ReceiptIcon } from 'lucide-react'
import { Campo, ErrorFormulario, EstadoDatos } from '@/components/formulario'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useConsulta } from '@/hooks/use-consulta'
import { mensajeDeError } from '@/lib/errores'
import { formatoNumero } from '@/lib/formato'
import { supabase } from '@/lib/supabase'
import type { ComandaAbierta } from '@/lib/tipos'

// Cada cuánto se refrescan los minutos y se revisa la regla de servicio lento.
const REFRESCO_MS = 30_000

const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })

export function PaginaComandas() {
  const abiertas = useConsulta<ComandaAbierta[]>('comandas-abiertas', () =>
    supabase.rpc('comandas_abiertas'),
  )
  const [guardando, setGuardando] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  // En vivo: mientras la pantalla está abierta se revisa R7 y se actualizan
  // los minutos. Si falla, pg_cron la revisa igual cada minuto.
  const recargar = abiertas.recargar
  useEffect(() => {
    const revisar = async () => {
      await supabase.rpc('evaluar_servicio')
      void recargar()
    }
    void revisar()
    const intervalo = window.setInterval(() => void revisar(), REFRESCO_MS)
    return () => window.clearInterval(intervalo)
  }, [recargar])

  async function avanzar(comanda: ComandaAbierta) {
    setGuardando(comanda.id)
    setError(null)
    const { error } = comanda.t_listo
      ? await supabase.rpc('cerrar_comanda', { p_comanda_id: comanda.id })
      : await supabase.rpc('marcar_listo', { p_comanda_id: comanda.id })
    if (error) setError(mensajeDeError(error))
    else void recargar()
    setGuardando(null)
  }

  const lista = abiertas.datos ?? []
  const enCocina = lista.filter((c) => !c.t_listo)
  const enMesa = lista.filter((c) => c.t_listo)

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
      <Card className="h-fit">
        <CardHeader>
          <CardTitle>Abrir mesa</CardTitle>
          <CardDescription>
            Al tomar el pedido. La hora se guarda sola; luego basta tocar "Listo" y "Cerrar".
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FormularioApertura desdeCopia={abiertas.desdeCopia} onAbierta={() => void recargar()} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Mesas abiertas</CardTitle>
          <CardDescription>
            Se marca en rojo la mesa que lleva en cocina más de lo normal para esta franja (el
            tiempo que no supera el 85 % de las comandas).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <EstadoDatos error={abiertas.error} desdeCopia={abiertas.desdeCopia} />
          {!abiertas.cargando && lista.length === 0 && (
            <p className="text-sm text-muted-foreground">No hay mesas abiertas.</p>
          )}
          {enCocina.length > 0 && (
            <Grupo titulo={`En cocina (${enCocina.length})`}>
              {enCocina.map((c) => (
                <FilaComanda
                  key={c.id}
                  comanda={c}
                  bloqueada={guardando !== null || abiertas.desdeCopia}
                  onAvanzar={() => void avanzar(c)}
                />
              ))}
            </Grupo>
          )}
          {enMesa.length > 0 && (
            <Grupo titulo={`Servidas, por cobrar (${enMesa.length})`}>
              {enMesa.map((c) => (
                <FilaComanda
                  key={c.id}
                  comanda={c}
                  bloqueada={guardando !== null || abiertas.desdeCopia}
                  onAvanzar={() => void avanzar(c)}
                />
              ))}
            </Grupo>
          )}
          <ErrorFormulario error={error} />
        </CardContent>
      </Card>
    </div>
  )
}

function Grupo({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-muted-foreground">{titulo}</h3>
      {children}
    </section>
  )
}

function FilaComanda({
  comanda: c,
  bloqueada,
  onAvanzar,
}: {
  comanda: ComandaAbierta
  bloqueada: boolean
  onAvanzar: () => void
}) {
  const minutos = Math.floor(Number(c.minutos_preparacion))
  return (
    <div
      className={`flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center ${
        c.lenta && c.servicio_en_curso
          ? 'border-l-4 border-riesgo/40 border-l-riesgo bg-riesgo-suave'
          : 'bg-background'
      }`}
    >
      <div className="flex flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">Mesa {c.mesa}</span>
          <span className="text-sm text-muted-foreground">
            {c.comensales} {c.comensales === 1 ? 'comensal' : 'comensales'} · abierta a las{' '}
            {hora(c.t_apertura)}
          </span>
          {!c.servicio_en_curso && (
            <Badge variant="outline">
              {c.franja ? 'De un servicio anterior' : 'Fuera de servicio'}
            </Badge>
          )}
        </div>
        <p className="text-sm">
          {c.t_listo ? (
            <>Salió de cocina a las {hora(c.t_listo)}, en {minutos} min.</>
          ) : (
            <>
              <span className="tabular-nums">{minutos} min</span> en cocina
              {c.uf_preparacion_min !== null && (
                <span className="text-muted-foreground">
                  {' '}
                  · lo normal es hasta {formatoNumero(c.uf_preparacion_min, 0)} min
                </span>
              )}
              {c.lenta && c.servicio_en_curso && (
                <Badge variant="destructive" className="ml-2">
                  Lenta
                </Badge>
              )}
            </>
          )}
        </p>
      </div>
      <Button
        variant={c.t_listo ? 'outline' : 'default'}
        size="lg"
        disabled={bloqueada}
        onClick={onAvanzar}
      >
        {c.t_listo ? (
          <>
            <ReceiptIcon /> Cerrar mesa
          </>
        ) : (
          <>
            <ChefHatIcon /> Listo
          </>
        )}
      </Button>
    </div>
  )
}

function FormularioApertura({
  desdeCopia,
  onAbierta,
}: {
  desdeCopia: boolean
  onAbierta: () => void
}) {
  const [mesa, setMesa] = useState('')
  const [comensales, setComensales] = useState('2')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hecho, setHecho] = useState<string | null>(null)

  async function abrir(evento: FormEvent) {
    evento.preventDefault()
    const personas = Number(comensales)
    if (!Number.isInteger(personas) || personas < 1) {
      setError('Indica cuántos comensales hay en la mesa.')
      return
    }
    setGuardando(true)
    setError(null)
    setHecho(null)
    const { error } = await supabase.rpc('abrir_comanda', {
      p_mesa: mesa,
      p_comensales: personas,
    })
    if (error) {
      // Los valores se conservan para reintentar con un clic (RNF-06).
      setError(mensajeDeError(error))
    } else {
      setHecho(`Mesa ${mesa.trim()} abierta.`)
      setMesa('')
      setComensales('2')
      onAbierta()
    }
    setGuardando(false)
  }

  return (
    <form onSubmit={abrir} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <Campo id="com-mesa" etiqueta="Mesa">
          <Input
            id="com-mesa"
            autoComplete="off"
            placeholder="Ej. 5"
            required
            value={mesa}
            onChange={(e) => setMesa(e.target.value)}
          />
        </Campo>
        <Campo id="com-comensales" etiqueta="Comensales">
          <Input
            id="com-comensales"
            inputMode="numeric"
            autoComplete="off"
            required
            value={comensales}
            onChange={(e) => setComensales(e.target.value)}
          />
        </Campo>
      </div>
      <ErrorFormulario error={error} />
      {hecho && (
        <p role="status" className="flex items-start gap-2 text-sm text-emerald-700">
          <CheckCircle2Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {hecho}
        </p>
      )}
      <Button type="submit" size="lg" disabled={guardando || desdeCopia}>
        {guardando ? 'Guardando…' : 'Abrir mesa'}
      </Button>
    </form>
  )
}
