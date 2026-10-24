import { useState, type ReactNode } from 'react'
import {
  ArrowRightIcon,
  BellIcon,
  BrainCircuitIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  ConciergeBellIcon,
  HourglassIcon,
  PlayIcon,
  ShoppingCartIcon,
  TruckIcon,
  type LucideIcon,
} from 'lucide-react'
import { EstadoDatos } from '@/components/formulario'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useConsulta } from '@/hooks/use-consulta'
import { useSesion } from '@/hooks/use-sesion'
import { mensajeDeError } from '@/lib/errores'
import { fechaMasDias, formatoCantidad } from '@/lib/formato'
import { irA, type Seccion } from '@/lib/navegacion'
import { supabase } from '@/lib/supabase'
import {
  NOMBRE_TIPO_ALERTA,
  type Alerta,
  type ComandaAbierta,
  type Existencia,
  type PedidoSugerido,
  type ResumenMotor,
  type Severidad,
} from '@/lib/tipos'
import { cn } from '@/lib/utils'

const ORDEN_SEVERIDAD: Record<Severidad, number> = { ALTA: 0, MEDIA: 1, BAJA: 2 }

const BORDE_SEVERIDAD: Record<Severidad, string> = {
  ALTA: 'border-l-riesgo',
  MEDIA: 'border-l-aviso',
  BAJA: 'border-l-chart-2',
}

const ETIQUETA_SEVERIDAD: Record<Severidad, string> = {
  ALTA: 'bg-riesgo-suave text-riesgo',
  MEDIA: 'bg-aviso-suave text-[oklch(0.45_0.10_65)]',
  BAJA: 'bg-secondary text-secondary-foreground',
}

function saludo() {
  const h = new Date().getHours()
  return h < 12 ? 'Buenos días' : h < 20 ? 'Buenas tardes' : 'Buenas noches'
}

export function PaginaInicio() {
  const { perfil, esGerente } = useSesion()

  const alertas = useConsulta<Pick<Alerta, 'id' | 'tipo' | 'severidad' | 'mensaje' | 'creada_en'>[]>(
    'inicio-alertas',
    () =>
      supabase
        .from('alerta')
        .select('id, tipo, severidad, mensaje, creada_en')
        .eq('estado', 'ABIERTA')
        .order('creada_en', { ascending: false }),
  )
  const comandas = useConsulta<ComandaAbierta[]>('comandas-abiertas', () =>
    supabase.rpc('comandas_abiertas'),
  )
  const entregas = useConsulta<{ fecha_esperada: string }[]>('inicio-entregas', () =>
    supabase.from('entrega').select('fecha_esperada').is('fecha_real', null),
  )
  const existencias = useConsulta<Existencia[]>('existencias', () => supabase.rpc('existencias'))
  const [fecha] = useState(() =>
    new Date().toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' }),
  )

  if (!perfil) return null

  const hoy = fechaMasDias(0)
  const listaAlertas = [...(alertas.datos ?? [])].sort(
    (a, b) => ORDEN_SEVERIDAD[a.severidad] - ORDEN_SEVERIDAD[b.severidad],
  )
  const altas = listaAlertas.filter((a) => a.severidad === 'ALTA').length
  const enCocina = (comandas.datos ?? []).filter((c) => !c.t_listo)
  const lentas = enCocina.filter((c) => c.lenta && c.servicio_en_curso).length
  const pendientes = entregas.datos ?? []
  const atrasadas = pendientes.filter((e) => e.fecha_esperada < hoy).length
  const llegaHoy = pendientes.filter((e) => e.fecha_esperada === hoy).length
  const porCaducar = (existencias.datos ?? []).filter(
    (e) => e.dias_a_caducidad !== null && e.dias_a_caducidad <= 2 && Number(e.existencia) > 0,
  ).length

  const sinConexion = [alertas, comandas, entregas, existencias].some((c) => c.desdeCopia)

  return (
    <div className="flex flex-col gap-6">
      <p className="-mt-3 text-sm text-muted-foreground">
        {saludo()}, <span className="font-medium text-foreground">{perfil.nombre}</span> · {fecha}
      </p>
      {sinConexion && <EstadoDatos error={null} desdeCopia />}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tarjeta
          icono={BellIcon}
          titulo="Alertas abiertas"
          cifra={listaAlertas.length}
          detalle={
            listaAlertas.length === 0
              ? 'Todo atendido'
              : altas > 0
                ? `${altas} de gravedad alta`
                : 'Ninguna de gravedad alta'
          }
          tono={altas > 0 ? 'riesgo' : listaAlertas.length > 0 ? 'aviso' : 'ok'}
          destino="alertas"
          retardo={0}
        />
        <Tarjeta
          icono={ConciergeBellIcon}
          titulo="Mesas en cocina"
          cifra={enCocina.length}
          detalle={
            enCocina.length === 0
              ? 'Ninguna esperando'
              : lentas > 0
                ? `${lentas} ${lentas === 1 ? 'va lenta' : 'van lentas'}`
                : 'Todas a tiempo'
          }
          tono={lentas > 0 ? 'riesgo' : 'ok'}
          destino="comandas"
          retardo={60}
        />
        <Tarjeta
          icono={TruckIcon}
          titulo="Entregas por recibir"
          cifra={pendientes.length}
          detalle={
            atrasadas > 0
              ? `${atrasadas} ${atrasadas === 1 ? 'atrasada' : 'atrasadas'}`
              : llegaHoy > 0
                ? `${llegaHoy} ${llegaHoy === 1 ? 'llega' : 'llegan'} hoy`
                : pendientes.length === 0
                  ? 'Ninguna pendiente'
                  : 'Ninguna para hoy'
          }
          tono={atrasadas > 0 ? 'aviso' : 'ok'}
          destino="registro"
          retardo={120}
        />
        <Tarjeta
          icono={HourglassIcon}
          titulo="Caducan pronto"
          cifra={porCaducar}
          detalle={porCaducar === 0 ? 'Nada en los próximos 2 días' : 'insumos en 2 días o menos'}
          tono={porCaducar > 0 ? 'aviso' : 'ok'}
          destino={esGerente ? 'tablero' : 'registro'}
          retardo={180}
        />
      </div>

      <div className={cn('grid gap-4', esGerente && 'lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]')}>
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-2">
            <div className="flex flex-col gap-1">
              <CardTitle className="text-lg">Lo más urgente</CardTitle>
              <CardDescription>Las alertas que conviene atender primero.</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => irA('alertas')}>
              Ver todas <ArrowRightIcon />
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {!alertas.cargando && listaAlertas.length === 0 && (
              <p className="flex items-center gap-2 rounded-lg bg-ok-suave px-3 py-3 text-sm text-[oklch(0.38_0.08_165)]">
                <CircleCheckIcon className="size-4" aria-hidden="true" />
                No hay alertas abiertas. Todo en orden.
              </p>
            )}
            {listaAlertas.slice(0, 4).map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => irA('alertas')}
                className={cn(
                  'group flex items-start gap-3 rounded-lg border border-l-4 bg-background px-3 py-2.5 text-left transition-colors hover:bg-accent/50',
                  BORDE_SEVERIDAD[a.severidad],
                )}
              >
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{NOMBRE_TIPO_ALERTA[a.tipo] ?? a.tipo}</span>
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[0.7rem] font-semibold',
                        ETIQUETA_SEVERIDAD[a.severidad],
                      )}
                    >
                      {a.severidad === 'ALTA' ? 'Alta' : a.severidad === 'MEDIA' ? 'Media' : 'Baja'}
                    </span>
                  </span>
                  <span className="line-clamp-2 text-sm text-muted-foreground">{a.mensaje}</span>
                </span>
                <ChevronRightIcon
                  className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </button>
            ))}
            {listaAlertas.length > 4 && (
              <p className="pt-1 text-xs text-muted-foreground">
                y {listaAlertas.length - 4} más en la bandeja de alertas.
              </p>
            )}
          </CardContent>
        </Card>

        {esGerente && <PedidoDelLunes />}
      </div>

      {esGerente && <EvaluacionMotor />}
    </div>
  )
}

type Tono = 'ok' | 'aviso' | 'riesgo'

const ESTILO_TONO: Record<Tono, { icono: string; punto: string }> = {
  ok: { icono: 'bg-ok-suave text-ok', punto: 'bg-ok' },
  aviso: { icono: 'bg-aviso-suave text-[oklch(0.52_0.12_65)]', punto: 'bg-aviso' },
  riesgo: { icono: 'bg-riesgo-suave text-riesgo', punto: 'bg-riesgo animate-pulse' },
}

/** Tarjeta resumen que lleva directo a la sección donde se resuelve. */
function Tarjeta({
  icono: Icono,
  titulo,
  cifra,
  detalle,
  tono,
  destino,
  retardo,
}: {
  icono: LucideIcon
  titulo: string
  cifra: number
  detalle: string
  tono: Tono
  destino: Seccion
  retardo: number
}) {
  const estilo = ESTILO_TONO[tono]
  return (
    <button
      type="button"
      onClick={() => irA(destino)}
      style={{ animationDelay: `${retardo}ms` }}
      className="group flex flex-col gap-3 rounded-xl bg-card p-4 text-left ring-1 ring-foreground/10 transition-all duration-500 animate-in fade-in slide-in-from-bottom-2 fill-mode-both hover:-translate-y-0.5 hover:shadow-md hover:ring-primary/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <span className="flex items-center justify-between">
        <span className={cn('grid size-9 place-items-center rounded-lg', estilo.icono)}>
          <Icono className="size-[1.1rem]" aria-hidden="true" />
        </span>
        <span className={cn('size-2 rounded-full', estilo.punto)} aria-hidden="true" />
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-sm text-muted-foreground">{titulo}</span>
        <span className="font-heading text-4xl leading-none font-semibold tabular-nums">{cifra}</span>
      </span>
      <span className="flex items-center justify-between gap-2 text-sm">
        <span>{detalle}</span>
        <ArrowRightIcon
          className="size-4 text-muted-foreground opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100"
          aria-hidden="true"
        />
      </span>
    </button>
  )
}

/** Lo que hay que pedir el próximo lunes, agrupado por proveedor (sólo gerente). */
function PedidoDelLunes() {
  const pedido = useConsulta<PedidoSugerido[]>('pedido-sugerido', () =>
    supabase
      .from('v_pedido_sugerido')
      .select('insumo_id, nombre, unidad, proveedor_id, proveedor, cpd, existencia, lead_time_dias, r_dias, np, q')
      .order('nombre'),
  )
  const aPedir = (pedido.datos ?? []).filter((p) => Number(p.q) > 0)
  const porProveedor = new Map<string, PedidoSugerido[]>()
  for (const p of aPedir) {
    const clave = p.proveedor ?? 'Sin proveedor'
    porProveedor.set(clave, [...(porProveedor.get(clave) ?? []), p])
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <CardTitle className="text-lg">Pedido del lunes</CardTitle>
          <CardDescription>
            {aPedir.length === 0
              ? 'Por ahora no hace falta pedir nada.'
              : `${aPedir.length} ${aPedir.length === 1 ? 'insumo' : 'insumos'} a pedir.`}
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => irA('pedido')}>
          <ShoppingCartIcon /> Abrir
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <EstadoDatos error={pedido.error} desdeCopia={pedido.desdeCopia} />
        {[...porProveedor].map(([proveedor, items]) => (
          <div key={proveedor} className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {proveedor}
            </span>
            <ul className="flex flex-col gap-1">
              {items.slice(0, 4).map((p) => (
                <li key={p.insumo_id} className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="truncate">{p.nombre}</span>
                  <span className="shrink-0 font-medium tabular-nums">
                    {formatoCantidad(Number(p.q).toFixed(1))} {p.unidad}
                  </span>
                </li>
              ))}
              {items.length > 4 && (
                <li className="text-xs text-muted-foreground">y {items.length - 4} más</li>
              )}
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

/**
 * Para el gerente (y la defensa del Trabajo de Grado): ver el razonamiento del
 * motor paso a paso. Va plegado para no estorbar el uso diario.
 */
function EvaluacionMotor() {
  const [ejecutando, setEjecutando] = useState(false)
  const [resumen, setResumen] = useState<ResumenMotor | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function evaluar() {
    setEjecutando(true)
    setError(null)
    const { data, error } = await supabase.rpc('evaluar_reglas')
    if (error) setError(mensajeDeError(error))
    else setResumen(data as ResumenMotor)
    setEjecutando(false)
  }

  const vueltas = resumen
    ? [...new Set(resumen.activaciones.map((a) => a.iteracion))].sort((a, b) => a - b)
    : []

  return (
    <details className="group rounded-xl bg-card ring-1 ring-foreground/10">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3.5 [&::-webkit-details-marker]:hidden">
        <span className="grid size-9 place-items-center rounded-lg bg-secondary text-secondary-foreground">
          <BrainCircuitIcon className="size-[1.1rem]" aria-hidden="true" />
        </span>
        <span className="flex flex-col">
          <span className="font-heading font-medium">Cómo razona el sistema</span>
          <span className="text-sm text-muted-foreground">
            El motor revisa todo solo cada 10 minutos. Aquí puedes verlo deducir paso a paso.
          </span>
        </span>
        <ChevronRightIcon
          className="ml-auto size-4 text-muted-foreground transition-transform group-open:rotate-90"
          aria-hidden="true"
        />
      </summary>
      <div className="flex flex-col gap-3 border-t px-4 py-4 text-sm">
        <Button className="w-fit" onClick={() => void evaluar()} disabled={ejecutando}>
          <PlayIcon /> {ejecutando ? 'Evaluando…' : 'Evaluar ahora'}
        </Button>
        {error && <p className="text-destructive">{error}</p>}
        {resumen && (
          <>
            <div className="flex flex-wrap gap-2">
              <Dato valor={resumen.iteraciones} texto={resumen.iteraciones === 1 ? 'vuelta' : 'vueltas'} />
              <Dato valor={resumen.hechos_nuevos} texto="hechos nuevos" />
              <Dato valor={resumen.hechos_retractados} texto="retirados" />
              <Dato valor={resumen.hechos_vigentes} texto="vigentes" />
              <Dato valor={resumen.alertas_emitidas} texto="alertas nuevas" />
              <Dato valor={resumen.alertas_suprimidas} texto="explicadas por una encadenada" />
              {resumen.mermas_automaticas > 0 && (
                <Dato valor={resumen.mermas_automaticas} texto="lotes vencidos a merma" />
              )}
            </div>
            {vueltas.map((v) => (
              <div key={v} className="flex flex-wrap items-center gap-1.5">
                <span className="w-16 text-muted-foreground">Vuelta {v}</span>
                {resumen.activaciones
                  .filter((a) => a.iteracion === v)
                  .map((a, i) => (
                    <Badge
                      key={i}
                      variant={a.regla === 'R4' || a.regla === 'R6' ? 'default' : 'outline'}
                      title={`Severidad ${a.severidad.toLowerCase()}`}
                    >
                      {a.regla} · {a.entidad}
                    </Badge>
                  ))}
              </div>
            ))}
            {resumen.activaciones.length === 0 && (
              <p className="text-muted-foreground">Ninguna regla se cumple en este momento.</p>
            )}
          </>
        )}
      </div>
    </details>
  )
}

function Dato({ valor, texto }: { valor: ReactNode; texto: string }) {
  return (
    <span className="rounded-lg bg-muted px-2.5 py-1.5">
      <span className="font-heading font-semibold tabular-nums">{valor}</span>{' '}
      <span className="text-muted-foreground">{texto}</span>
    </span>
  )
}
