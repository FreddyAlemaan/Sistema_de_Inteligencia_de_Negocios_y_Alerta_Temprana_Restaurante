import type { ReactNode } from 'react'
import { RefreshCwIcon } from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { EstadoDatos } from '@/components/formulario'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useConsulta } from '@/hooks/use-consulta'
import { formatoCantidad, formatoNumero } from '@/lib/formato'
import { supabase } from '@/lib/supabase'
import type { Cobertura, KpiServicio, KpiSuministro, RiesgoMerma } from '@/lib/tipos'
import { cn } from '@/lib/utils'

// Los cálculos viven en las vistas de la base de datos (AGENTS.md §7);
// aquí sólo se ordenan y se presentan.

export function PaginaTablero() {
  const cobertura = useConsulta<Cobertura[]>('tablero-cobertura', () =>
    supabase
      .from('v_cobertura')
      .select(
        'insumo_id, nombre, unidad, activo, existencia, cpd, dc, dias_hasta_reposicion, riesgo_faltante',
      ),
  )
  const merma = useConsulta<RiesgoMerma[]>('tablero-qr', () =>
    supabase.rpc('riesgo_merma_lotes').gt('qr', 0).order('drc'),
  )
  const suministro = useConsulta<KpiSuministro[]>('tablero-suministro', () =>
    supabase
      .from('v_kpi_suministro')
      .select(
        'nivel, insumo_id, proveedor_id, nombre, consumo, merma, rotacion, pct_merma, entregas_totales, entregas_ok, tcp',
      ),
  )
  const servicio = useConsulta<KpiServicio[]>('tablero-servicio', () =>
    supabase
      .from('v_kpi_servicio')
      .select(
        'franja, evaluada, comandas, prom_preparacion_min, prom_total_min, uf_preparacion_min, uf_total_min',
      )
      .order('franja'),
  )
  // El umbral de cumplimiento vive en la tabla regla (R3), no en el código.
  const umbralR3 = useConsulta<{ umbral: number | null }[]>('tablero-umbral-r3', () =>
    supabase.from('regla').select('umbral').eq('codigo', 'R3'),
  )
  // Sobrestock es un hecho que dedujo el motor (R5): se lee, no se recalcula.
  const sobrestock = useConsulta<{ entidad_id: number }[]>('tablero-sobrestock', () =>
    supabase
      .from('hecho')
      .select('entidad_id')
      .eq('predicado', 'sobrestock')
      .eq('entidad_tipo', 'insumo')
      .eq('vigente', true),
  )

  const consultas = [cobertura, merma, suministro, servicio, umbralR3, sobrestock]
  const cargando = consultas.some((c) => c.cargando)

  function actualizar() {
    for (const c of consultas) void c.recargar()
  }

  const insumos = new Map((cobertura.datos ?? []).map((c) => [c.insumo_id, c]))
  const conSobrestock = new Set((sobrestock.datos ?? []).map((h) => h.entidad_id))
  const umbral = umbralR3.datos?.[0]?.umbral ?? null

  return (
    <div className="flex flex-col gap-5">
      <div className="-mt-2 flex flex-wrap items-center gap-3">
        <span className="text-sm text-muted-foreground">
          Los dos primeros indicadores son para actuar hoy; los demás muestran los últimos 30 días.
        </span>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          disabled={cargando}
          onClick={actualizar}
        >
          <RefreshCwIcon className={cn(cargando && 'animate-spin')} /> Actualizar
        </Button>
      </div>

      <Seccion titulo="Para actuar hoy">
        <IndicadorCobertura
          datos={(cobertura.datos ?? []).filter((c) => c.activo)}
          conSobrestock={conSobrestock}
          estado={<EstadoDatos error={cobertura.error} desdeCopia={cobertura.desdeCopia} />}
        />
        <IndicadorRiesgoMerma
          datos={merma.datos ?? []}
          insumos={insumos}
          estado={<EstadoDatos error={merma.error} desdeCopia={merma.desdeCopia} />}
        />
      </Seccion>

      <Seccion titulo="Cómo vamos">
        <IndicadorProveedores
          datos={(suministro.datos ?? []).filter((k) => k.nivel === 'proveedor')}
          umbral={umbral}
          estado={<EstadoDatos error={suministro.error} desdeCopia={suministro.desdeCopia} />}
        />
        <IndicadorServicio
          datos={servicio.datos ?? []}
          estado={<EstadoDatos error={servicio.error} desdeCopia={servicio.desdeCopia} />}
        />
        <IndicadorPctMerma
          datos={(suministro.datos ?? []).filter((k) => k.nivel === 'insumo')}
          insumos={insumos}
          estado={<EstadoDatos error={suministro.error} desdeCopia={suministro.desdeCopia} />}
        />
        <IndicadorRotacion
          datos={(suministro.datos ?? []).filter((k) => k.nivel === 'insumo')}
          insumos={insumos}
          estado={<EstadoDatos error={suministro.error} desdeCopia={suministro.desdeCopia} />}
        />
      </Seccion>
    </div>
  )
}

// -----------------------------------------------------------------------------
// Piezas comunes
// -----------------------------------------------------------------------------

function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="flex items-center gap-3 text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
        {titulo}
        <span className="h-px flex-1 bg-border" aria-hidden="true" />
      </h2>
      <div className="grid gap-4 md:grid-cols-2">{children}</div>
    </section>
  )
}

type Tono = 'riesgo' | 'aviso' | 'normal'

const COLOR_TONO: Record<Tono, string> = {
  riesgo: 'var(--riesgo)',
  aviso: 'var(--aviso)',
  normal: 'var(--chart-1)',
}

function Indicador({
  numero,
  titulo,
  descripcion,
  cifra,
  detalleCifra,
  tono = 'normal',
  estado,
  children,
}: {
  numero: number
  titulo: string
  descripcion: string
  cifra: string
  detalleCifra: string
  tono?: Tono
  estado: ReactNode
  children: ReactNode
}) {
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <span className="grid size-6 place-items-center rounded-full bg-secondary font-sans text-xs font-semibold text-secondary-foreground">
            {numero}
          </span>
          {titulo}
        </CardTitle>
        <CardDescription>{descripcion}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {estado}
        <p className="flex items-baseline gap-2">
          <span
            className={cn(
              'font-heading text-4xl leading-none font-semibold tabular-nums',
              tono === 'riesgo' && 'text-riesgo',
              tono === 'aviso' && 'text-[oklch(0.55_0.12_65)]',
            )}
          >
            {cifra}
          </span>
          <span className="text-sm text-muted-foreground">{detalleCifra}</span>
        </p>
        {children}
      </CardContent>
    </Card>
  )
}

const COLOR_BARRA: Record<Tono, string> = {
  riesgo: 'bg-riesgo',
  aviso: 'bg-aviso',
  normal: 'bg-ok',
}

/** Fila de una lista para actuar: nombre, valor y una barra de progreso. */
function Fila({
  nombre,
  valor,
  detalle,
  fraccion,
  tono,
  marca,
  extra,
}: {
  nombre: string
  valor: string
  detalle?: string
  fraccion: number
  tono: Tono
  marca?: number
  extra?: ReactNode
}) {
  const ancho = Math.max(0, Math.min(1, fraccion)) * 100
  return (
    <li className="flex flex-col gap-1.5 rounded-lg border bg-background px-3 py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
        <span className="font-medium">{nombre}</span>
        {extra}
        <span className="ml-auto font-semibold tabular-nums">{valor}</span>
      </div>
      <div className="relative h-1.5 rounded-full bg-muted">
        <div className={cn('h-1.5 rounded-full', COLOR_BARRA[tono])} style={{ width: `${ancho}%` }} />
        {marca !== undefined && (
          <div
            className="absolute -top-1 h-3.5 w-0.5 rounded bg-foreground/50"
            style={{ left: `${Math.max(0, Math.min(1, marca)) * 100}%` }}
            aria-hidden="true"
          />
        )}
      </div>
      {detalle && <p className="text-xs text-muted-foreground">{detalle}</p>}
    </li>
  )
}

function Vacio({ texto }: { texto: string }) {
  return <p className="text-sm text-muted-foreground">{texto}</p>
}

const dias = (n: number) => (n === 1 ? '1 día' : `${formatoNumero(n)} días`)

// --- Gráficos (Recharts) ------------------------------------------------------

const EJE = { fontSize: 12, fill: 'var(--muted-foreground)' }

interface Barra {
  nombre: string
  valor: number
  tono: Tono
  etiqueta: string
  ayuda?: string
}

/** Barras horizontales: una por fila, con su valor escrito al final. */
function BarrasHorizontales({
  datos,
  maximo,
  referencia,
  textoReferencia,
}: {
  datos: Barra[]
  maximo?: number
  referencia?: number
  textoReferencia?: string
}) {
  const alto = datos.length * 38 + (referencia !== undefined ? 34 : 14)
  return (
    <div style={{ height: alto }} className="-ml-2">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={datos}
          layout="vertical"
          margin={{ top: referencia !== undefined ? 20 : 0, right: 64, bottom: 0, left: 0 }}
          barCategoryGap={9}
        >
          <XAxis type="number" hide domain={[0, maximo ?? 'auto']} />
          <YAxis
            type="category"
            dataKey="nombre"
            width={128}
            tick={EJE}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: string) => (v.length > 18 ? `${v.slice(0, 17)}…` : v)}
          />
          <Tooltip
            cursor={{ fill: 'var(--muted)' }}
            content={({ active, payload }) => {
              const b = active ? (payload?.[0]?.payload as Barra | undefined) : undefined
              return b ? <Globo titulo={b.nombre} lineas={[b.etiqueta, b.ayuda]} /> : null
            }}
          />
          <Bar dataKey="valor" radius={[0, 6, 6, 0]} isAnimationActive animationDuration={700}>
            {datos.map((d) => (
              <Cell key={d.nombre} fill={COLOR_TONO[d.tono]} />
            ))}
            <LabelList
              dataKey="etiqueta"
              position="right"
              style={{ fontSize: 12, fontWeight: 600, fill: 'var(--foreground)' }}
            />
          </Bar>
          {referencia !== undefined && (
            <ReferenceLine
              x={referencia}
              stroke="var(--foreground)"
              strokeOpacity={0.5}
              strokeDasharray="4 3"
              label={{ value: textoReferencia, position: 'top', fontSize: 11, fill: 'var(--muted-foreground)' }}
            />
          )}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function Globo({ titulo, lineas }: { titulo: string; lineas: (string | undefined)[] }) {
  return (
    <div className="rounded-lg bg-popover px-3 py-2 text-xs shadow-lg ring-1 ring-foreground/10">
      <p className="mb-0.5 font-semibold text-foreground">{titulo}</p>
      {lineas.filter(Boolean).map((l) => (
        <p key={l} className="text-muted-foreground">
          {l}
        </p>
      ))}
    </div>
  )
}

// -----------------------------------------------------------------------------
// 1. Días de cobertura — DC(i) = existencia / CPD(i)
// -----------------------------------------------------------------------------

function IndicadorCobertura({
  datos,
  conSobrestock,
  estado,
}: {
  datos: Cobertura[]
  conSobrestock: Set<number>
  estado: ReactNode
}) {
  const enRiesgo = datos
    .filter((c) => c.riesgo_faltante)
    .sort((a, b) => Number(a.dc) - Number(b.dc))
  const sobrestock = datos.filter((c) => conSobrestock.has(c.insumo_id))
  const resto = datos.length - enRiesgo.length - sobrestock.length

  return (
    <Indicador
      numero={1}
      titulo="Días de cobertura"
      descripcion="Para cuántos días alcanza lo que hay, frente a lo que tarda en llegar el próximo pedido. La raya marca cuándo llega."
      cifra={String(enRiesgo.length)}
      detalleCifra={`de ${datos.length} insumos en riesgo de faltante`}
      tono={enRiesgo.length > 0 ? 'riesgo' : 'normal'}
      estado={estado}
    >
      <ul className="flex flex-col gap-2">
        {enRiesgo.map((c) => (
          <Fila
            key={c.insumo_id}
            nombre={c.nombre}
            valor={dias(Number(c.dc))}
            detalle={`Lo próximo llega en ${dias(c.dias_hasta_reposicion)}. Hay ${formatoCantidad(c.existencia)} ${c.unidad}.`}
            fraccion={Number(c.dc) / c.dias_hasta_reposicion}
            marca={1}
            tono="riesgo"
          />
        ))}
        {sobrestock.map((c) => (
          <Fila
            key={c.insumo_id}
            nombre={c.nombre}
            valor={c.dc === null ? '—' : dias(Number(c.dc))}
            detalle={`Hay ${formatoCantidad(c.existencia)} ${c.unidad}: mucho más de lo que se alcanza a usar.`}
            fraccion={1}
            tono="aviso"
            extra={<Badge className="bg-aviso-suave text-[oklch(0.45_0.10_65)]">Sobrestock</Badge>}
          />
        ))}
      </ul>
      {resto > 0 && (
        <Vacio
          texto={`${resto} ${resto === 1 ? 'insumo tiene' : 'insumos tienen'} cobertura suficiente.`}
        />
      )}
    </Indicador>
  )
}

// -----------------------------------------------------------------------------
// 2. Cantidad en riesgo de merma — QR(l) = max(0, cantidad − CPD × DRC)
// -----------------------------------------------------------------------------

function IndicadorRiesgoMerma({
  datos,
  insumos,
  estado,
}: {
  datos: RiesgoMerma[]
  insumos: Map<number, Cobertura>
  estado: ReactNode
}) {
  return (
    <Indicador
      numero={2}
      titulo="Cantidad en riesgo de merma"
      descripcion="Lo que se va a botar de cada lote si se sigue consumiendo al ritmo actual. Se sabe hoy, antes de que caduque."
      cifra={String(datos.length)}
      detalleCifra={datos.length === 1 ? 'lote con pérdida prevista' : 'lotes con pérdida prevista'}
      tono={datos.length > 0 ? 'aviso' : 'normal'}
      estado={estado}
    >
      {datos.length === 0 && <Vacio texto="Ningún lote tiene pérdida prevista." />}
      <ul className="flex flex-col gap-2">
        {datos.map((q) => {
          const insumo = insumos.get(q.insumo_id)
          const unidad = insumo?.unidad ?? ''
          return (
            <Fila
              key={q.lote_id}
              nombre={`${insumo?.nombre ?? `Insumo #${q.insumo_id}`} · lote ${q.lote_id}`}
              valor={`${formatoCantidad(Number(q.qr).toFixed(2))} ${unidad}`}
              detalle={`De ${formatoCantidad(q.cantidad_actual)} ${unidad}; caduca ${
                q.drc === 0 ? 'hoy' : q.drc === 1 ? 'mañana' : `en ${q.drc} días`
              }.`}
              fraccion={Number(q.qr) / Number(q.cantidad_actual)}
              tono={q.drc <= 3 ? 'riesgo' : 'aviso'}
            />
          )
        })}
      </ul>
    </Indicador>
  )
}

// -----------------------------------------------------------------------------
// 3. % de merma — merma / (existencia inicial + entradas) × 100, 30 días
// -----------------------------------------------------------------------------

function IndicadorPctMerma({
  datos,
  insumos,
  estado,
}: {
  datos: KpiSuministro[]
  insumos: Map<number, Cobertura>
  estado: ReactNode
}) {
  const conMerma = datos
    .filter((k) => Number(k.pct_merma ?? 0) > 0)
    .sort((a, b) => Number(b.pct_merma) - Number(a.pct_merma))

  return (
    <Indicador
      numero={3}
      titulo="Porcentaje de merma"
      descripcion="Qué parte de lo que hubo de cada insumo se perdió en los últimos 30 días."
      cifra={String(conMerma.length)}
      detalleCifra={conMerma.length === 1 ? 'insumo con merma' : 'insumos con merma'}
      tono={conMerma.length > 0 ? 'aviso' : 'normal'}
      estado={estado}
    >
      {conMerma.length === 0 ? (
        <Vacio texto="No hubo merma en los últimos 30 días." />
      ) : (
        <BarrasHorizontales
          datos={conMerma.map((k) => ({
            nombre: k.nombre,
            valor: Number(k.pct_merma),
            tono: 'aviso',
            etiqueta: `${formatoNumero(Number(k.pct_merma))} %`,
            ayuda: `Se perdieron ${formatoCantidad(k.merma ?? 0)} ${insumos.get(k.insumo_id!)?.unidad ?? ''}`,
          }))}
        />
      )}
    </Indicador>
  )
}

// -----------------------------------------------------------------------------
// 4. Rotación — consumo / existencia promedio, 30 días
// -----------------------------------------------------------------------------

function IndicadorRotacion({
  datos,
  insumos,
  estado,
}: {
  datos: KpiSuministro[]
  insumos: Map<number, Cobertura>
  estado: ReactNode
}) {
  const conRotacion = datos
    .filter((k) => k.rotacion !== null && insumos.get(k.insumo_id!)?.activo !== false)
    .sort((a, b) => Number(a.rotacion) - Number(b.rotacion))
  const lentos = conRotacion.slice(0, 6)

  return (
    <Indicador
      numero={4}
      titulo="Rotación de inventario"
      descripcion="Cuántas veces se renovó la existencia en 30 días. Los que menos rotan inmovilizan dinero y tienden a caducar."
      cifra={lentos[0] ? formatoNumero(Number(lentos[0].rotacion)) : '—'}
      detalleCifra={lentos[0] ? `la más baja: ${lentos[0].nombre}` : 'sin movimientos'}
      estado={estado}
    >
      {lentos.length > 0 && (
        <BarrasHorizontales
          datos={lentos.map((k) => ({
            nombre: k.nombre,
            valor: Number(k.rotacion),
            tono: Number(k.rotacion) < 1 ? 'aviso' : 'normal',
            etiqueta: `${formatoNumero(Number(k.rotacion))} veces`,
            ayuda: Number(k.rotacion) < 1 ? 'Ni una renovación completa en 30 días' : undefined,
          }))}
          referencia={1}
          textoReferencia="1 vez"
        />
      )}
      {conRotacion.length > lentos.length && (
        <Vacio texto={`Se muestran los ${lentos.length} que menos rotan de ${conRotacion.length}.`} />
      )}
    </Indicador>
  )
}

// -----------------------------------------------------------------------------
// 5. Cumplimiento de proveedores — TCP(p)
// -----------------------------------------------------------------------------

function IndicadorProveedores({
  datos,
  umbral,
  estado,
}: {
  datos: KpiSuministro[]
  umbral: number | null
  estado: ReactNode
}) {
  const evaluados = datos
    .filter((k) => k.tcp !== null)
    .sort((a, b) => Number(a.tcp) - Number(b.tcp))
  const bajo = umbral === null ? [] : evaluados.filter((k) => Number(k.tcp) < Number(umbral))

  return (
    <Indicador
      numero={5}
      titulo="Cumplimiento de proveedores"
      descripcion="Entregas que llegaron a tiempo y en buen estado, sobre el total. La raya marca el mínimo aceptable."
      cifra={String(bajo.length)}
      detalleCifra={
        umbral === null
          ? `de ${evaluados.length} proveedores`
          : `de ${evaluados.length} proveedores bajo el ${formatoNumero(Number(umbral), 0)} %`
      }
      tono={bajo.length > 0 ? 'riesgo' : 'normal'}
      estado={estado}
    >
      {evaluados.length === 0 ? (
        <Vacio texto="Todavía no hay entregas registradas." />
      ) : (
        <BarrasHorizontales
          datos={evaluados.map((k) => ({
            nombre: k.nombre,
            valor: Number(k.tcp),
            tono: bajo.includes(k) ? 'riesgo' : 'normal',
            etiqueta: `${formatoNumero(Number(k.tcp), 0)} %`,
            ayuda: `${k.entregas_ok} de ${k.entregas_totales} entregas a tiempo y conformes`,
          }))}
          maximo={100}
          referencia={umbral === null ? undefined : Number(umbral)}
          textoReferencia={umbral === null ? undefined : `mínimo ${formatoNumero(Number(umbral), 0)} %`}
        />
      )}
    </Indicador>
  )
}

// -----------------------------------------------------------------------------
// 6. Tiempos de servicio — promedio frente a Uf (percentil 85) por franja
// -----------------------------------------------------------------------------

function IndicadorServicio({ datos, estado }: { datos: KpiServicio[]; estado: ReactNode }) {
  const franjas = datos.filter((s) => s.evaluada)
  const fuera = datos.find((s) => !s.evaluada)
  const total = franjas.reduce((n, s) => n + Number(s.comandas), 0)
  const minutos = (n: number | null) => (n === null ? '—' : `${formatoNumero(Number(n), 0)} min`)

  const filas = franjas.map((s) => ({
    franja: s.franja,
    comandas: Number(s.comandas),
    promedio: s.prom_preparacion_min === null ? null : Number(s.prom_preparacion_min),
    uf: s.uf_preparacion_min === null ? null : Number(s.uf_preparacion_min),
    promTotal: s.prom_total_min,
    ufTotal: s.uf_total_min,
  }))

  return (
    <Indicador
      numero={6}
      titulo="Tiempos de servicio"
      descripcion="Minutos hasta que el plato sale de cocina: el promedio frente a lo normal (Uf, el tiempo que no supera el 85 % de las comandas)."
      cifra={String(total)}
      detalleCifra={total === 1 ? 'comanda evaluada' : 'comandas evaluadas'}
      estado={estado}
    >
      {franjas.length === 0 ? (
        <Vacio texto="Todavía no hay comandas en las franjas de servicio." />
      ) : (
        <>
          <div className="h-52 -ml-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={filas} margin={{ top: 18, right: 8, bottom: 0, left: 0 }} barGap={4}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="franja" tick={EJE} tickLine={false} axisLine={false} />
                <YAxis tick={EJE} tickLine={false} axisLine={false} width={44} unit=" m" />
                <Tooltip
                  cursor={{ fill: 'var(--muted)' }}
                  content={({ active, payload }) => {
                    const f = active ? (payload?.[0]?.payload as (typeof filas)[number] | undefined) : undefined
                    return f ? (
                      <Globo
                        titulo={`${f.franja} · ${f.comandas} comandas`}
                        lineas={[
                          `Preparación: ${minutos(f.promedio)} de promedio, normal hasta ${minutos(f.uf)}`,
                          `De abrir a cerrar: ${minutos(f.promTotal)}, normal hasta ${minutos(f.ufTotal)}`,
                        ]}
                      />
                    ) : null
                  }}
                />
                <Legend
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: 12, color: 'var(--muted-foreground)' }}
                />
                <Bar dataKey="promedio" name="Promedio" fill="var(--chart-1)" radius={[6, 6, 0, 0]}>
                  <LabelList
                    dataKey="promedio"
                    position="top"
                    formatter={(v) => (typeof v === 'number' ? formatoNumero(v, 0) : '')}
                    style={{ fontSize: 12, fontWeight: 600, fill: 'var(--foreground)' }}
                  />
                </Bar>
                <Bar dataKey="uf" name="Lo normal (Uf)" fill="var(--chart-2)" radius={[6, 6, 0, 0]}>
                  <LabelList
                    dataKey="uf"
                    position="top"
                    formatter={(v) => (typeof v === 'number' ? formatoNumero(v, 0) : '')}
                    style={{ fontSize: 12, fontWeight: 600, fill: 'var(--foreground)' }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2">
            {filas.map((f) => (
              <li key={f.franja} className="rounded-lg bg-muted px-3 py-2 text-xs">
                <span className="font-semibold">{f.franja}</span>
                <span className="text-muted-foreground">
                  {' '}
                  · de abrir a cerrar {minutos(f.promTotal)} (normal hasta {minutos(f.ufTotal)})
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {fuera && (
        <Vacio
          texto={`${fuera.comandas} ${Number(fuera.comandas) === 1 ? 'comanda quedó' : 'comandas quedaron'} fuera de las franjas y no se evalúan.`}
        />
      )}
    </Indicador>
  )
}
