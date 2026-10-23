import type { ReactNode } from 'react'
import { RefreshCwIcon } from 'lucide-react'
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
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-heading text-lg font-semibold">Tablero de indicadores</h1>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          disabled={cargando}
          onClick={actualizar}
        >
          <RefreshCwIcon /> Actualizar
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
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
        <IndicadorProveedores
          datos={(suministro.datos ?? []).filter((k) => k.nivel === 'proveedor')}
          umbral={umbral}
          estado={<EstadoDatos error={suministro.error} desdeCopia={suministro.desdeCopia} />}
        />
        <IndicadorServicio
          datos={servicio.datos ?? []}
          estado={<EstadoDatos error={servicio.error} desdeCopia={servicio.desdeCopia} />}
        />
      </div>
    </div>
  )
}

// -----------------------------------------------------------------------------
// Piezas comunes
// -----------------------------------------------------------------------------

function Indicador({
  numero,
  titulo,
  descripcion,
  cifra,
  detalleCifra,
  estado,
  children,
}: {
  numero: number
  titulo: string
  descripcion: string
  cifra: string
  detalleCifra: string
  estado: ReactNode
  children: ReactNode
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span className="text-muted-foreground">{numero}.</span> {titulo}
        </CardTitle>
        <CardDescription>{descripcion}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {estado}
        <p className="flex items-baseline gap-2">
          <span className="font-heading text-3xl font-semibold tabular-nums">{cifra}</span>
          <span className="text-sm text-muted-foreground">{detalleCifra}</span>
        </p>
        <ul className="flex flex-col gap-2.5">{children}</ul>
      </CardContent>
    </Card>
  )
}

type Tono = 'riesgo' | 'aviso' | 'normal'

const COLOR_BARRA: Record<Tono, string> = {
  riesgo: 'bg-red-500',
  aviso: 'bg-amber-500',
  normal: 'bg-emerald-500',
}

/** Fila con nombre, valor y una barra horizontal simple (sin librería de gráficos). */
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
    <li className="flex flex-col gap-1">
      <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
        <span className="font-medium">{nombre}</span>
        {extra}
        <span className="ml-auto tabular-nums">{valor}</span>
      </div>
      <div className="relative h-2 rounded-full bg-muted">
        <div
          className={cn('h-2 rounded-full', COLOR_BARRA[tono])}
          style={{ width: `${ancho}%` }}
        />
        {marca !== undefined && (
          <div
            className="absolute -top-1 h-4 w-0.5 bg-foreground/60"
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
  return <li className="text-sm text-muted-foreground">{texto}</li>
}

const dias = (n: number) => (n === 1 ? '1 día' : `${formatoNumero(n)} días`)

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
      descripcion="Para cuántos días alcanza la existencia al ritmo de consumo actual, frente a lo que tarda en llegar el próximo pedido."
      cifra={String(enRiesgo.length)}
      detalleCifra={`de ${datos.length} insumos en riesgo de faltante`}
      estado={estado}
    >
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
          extra={<Badge className="bg-amber-100 text-amber-900">Sobrestock</Badge>}
        />
      ))}
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
      estado={estado}
    >
      {datos.length === 0 && <Vacio texto="Ningún lote tiene pérdida prevista." />}
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
  const maximo = Math.max(...conMerma.map((k) => Number(k.pct_merma)), 1)

  return (
    <Indicador
      numero={3}
      titulo="Porcentaje de merma"
      descripcion="Qué parte de lo que hubo de cada insumo se perdió en los últimos 30 días."
      cifra={String(conMerma.length)}
      detalleCifra={conMerma.length === 1 ? 'insumo con merma' : 'insumos con merma'}
      estado={estado}
    >
      {conMerma.length === 0 && <Vacio texto="No hubo merma en los últimos 30 días." />}
      {conMerma.map((k) => {
        const unidad = insumos.get(k.insumo_id!)?.unidad ?? ''
        return (
          <Fila
            key={k.insumo_id}
            nombre={k.nombre}
            valor={`${formatoNumero(Number(k.pct_merma))} %`}
            detalle={`Se perdieron ${formatoCantidad(k.merma ?? 0)} ${unidad}.`}
            fraccion={Number(k.pct_merma) / maximo}
            tono="aviso"
          />
        )
      })}
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
  const maximo = Math.max(...conRotacion.map((k) => Number(k.rotacion)), 1)
  const lentos = conRotacion.slice(0, 5)

  return (
    <Indicador
      numero={4}
      titulo="Rotación de inventario"
      descripcion="Cuántas veces se renovó la existencia en 30 días. Los que menos rotan inmovilizan dinero y tienden a caducar."
      cifra={lentos[0] ? formatoNumero(Number(lentos[0].rotacion)) : '—'}
      detalleCifra={lentos[0] ? `la más baja: ${lentos[0].nombre}` : 'sin movimientos'}
      estado={estado}
    >
      {lentos.map((k) => (
        <Fila
          key={k.insumo_id}
          nombre={k.nombre}
          valor={`${formatoNumero(Number(k.rotacion))} veces`}
          fraccion={Number(k.rotacion) / maximo}
          tono={Number(k.rotacion) < 1 ? 'aviso' : 'normal'}
        />
      ))}
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
      descripcion="Entregas que llegaron a tiempo y conformes, sobre el total de entregas."
      cifra={String(bajo.length)}
      detalleCifra={
        umbral === null
          ? `de ${evaluados.length} proveedores`
          : `de ${evaluados.length} proveedores bajo el ${formatoNumero(Number(umbral), 0)} %`
      }
      estado={estado}
    >
      {evaluados.length === 0 && <Vacio texto="Todavía no hay entregas registradas." />}
      {evaluados.map((k) => (
        <Fila
          key={k.proveedor_id}
          nombre={k.nombre}
          valor={`${formatoNumero(Number(k.tcp), 0)} %`}
          detalle={`${k.entregas_ok} de ${k.entregas_totales} entregas a tiempo y conformes.`}
          fraccion={Number(k.tcp) / 100}
          marca={umbral === null ? undefined : Number(umbral) / 100}
          tono={bajo.includes(k) ? 'riesgo' : 'normal'}
        />
      ))}
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

  return (
    <Indicador
      numero={6}
      titulo="Tiempos de servicio"
      descripcion="Tiempo promedio por franja frente a su umbral Uf: el tiempo que no supera el 85 % de las comandas."
      cifra={String(total)}
      detalleCifra={total === 1 ? 'comanda evaluada' : 'comandas evaluadas'}
      estado={estado}
    >
      {franjas.length === 0 && <Vacio texto="Todavía no hay comandas en las franjas de servicio." />}
      {franjas.map((s) => (
        <li key={s.franja} className="flex flex-col gap-2">
          <span className="text-sm font-semibold">
            {s.franja} <span className="font-normal text-muted-foreground">· {s.comandas} comandas</span>
          </span>
          <ul className="flex flex-col gap-2.5 pl-2">
            <Fila
              nombre="Preparación"
              valor={`${minutos(s.prom_preparacion_min)} / Uf ${minutos(s.uf_preparacion_min)}`}
              fraccion={Number(s.prom_preparacion_min) / Number(s.uf_preparacion_min || 1)}
              marca={1}
              tono="normal"
            />
            <Fila
              nombre="Total (de abrir a cerrar la comanda)"
              valor={`${minutos(s.prom_total_min)} / Uf ${minutos(s.uf_total_min)}`}
              fraccion={Number(s.prom_total_min) / Number(s.uf_total_min || 1)}
              marca={1}
              tono="normal"
            />
          </ul>
        </li>
      ))}
      {fuera && (
        <Vacio
          texto={`${fuera.comandas} ${Number(fuera.comandas) === 1 ? 'comanda quedó' : 'comandas quedaron'} fuera de las franjas y no se evalúan.`}
        />
      )}
    </Indicador>
  )
}
