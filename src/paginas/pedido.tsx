import { useState } from 'react'
import { RefreshCwIcon, SendIcon, TriangleAlertIcon } from 'lucide-react'
import { ErrorFormulario, EstadoDatos } from '@/components/formulario'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useConsulta } from '@/hooks/use-consulta'
import { mensajeDeError } from '@/lib/errores'
import { fechaMasDias, formatoCantidad, formatoFecha, formatoNumero } from '@/lib/formato'
import { supabase } from '@/lib/supabase'
import type { PedidoSugerido } from '@/lib/tipos'

// NP(i) = CPD × (R + lead time) y Q(i) = max(0, NP − existencia) se calculan en
// la vista v_pedido_sugerido; aquí sólo se agrupan por proveedor.

/** Recomendaciones de las reglas encadenadas sobre el próximo pedido. */
type Recomendacion = 'aumentar' | 'reducir'

export function PaginaPedido() {
  const [verTodos, setVerTodos] = useState(false)

  const pedido = useConsulta<PedidoSugerido[]>('pedido-sugerido', () =>
    supabase
      .from('v_pedido_sugerido')
      .select('insumo_id, nombre, unidad, proveedor_id, proveedor, cpd, existencia, lead_time_dias, r_dias, np, q')
      .order('nombre'),
  )
  // Días hasta el próximo lunes: lo calcula la base de datos (v_cobertura).
  const proximo = useConsulta<{ dias_hasta_proximo_pedido: number }[]>('pedido-proximo', () =>
    supabase.from('v_cobertura').select('dias_hasta_proximo_pedido').limit(1),
  )
  // R4 (faltante crítico) pide aumentar; R6 (sobrecompra) pide reducir.
  const alertas = useConsulta<{ tipo: string; entidad_tipo: string; entidad_id: number }[]>(
    'pedido-alertas',
    () =>
      supabase
        .from('alerta')
        .select('tipo, entidad_tipo, entidad_id')
        .eq('estado', 'ABIERTA')
        .in('tipo', ['FALTANTE_CRITICO', 'SOBRECOMPRA']),
  )
  // SOBRECOMPRA apunta a un lote: hace falta saber de qué insumo es.
  const lotes = useConsulta<{ id: number; insumo_id: number }[]>('pedido-lotes', () =>
    supabase.from('lote').select('id, insumo_id').gt('cantidad_actual', 0),
  )

  // Pedidos ya confirmados que aún no llegan.
  const pendientes = useConsulta<{ proveedor_id: number; fecha_esperada: string }[]>(
    'pedido-entregas-pendientes',
    () =>
      supabase
        .from('entrega')
        .select('proveedor_id, fecha_esperada')
        .is('fecha_real', null)
        .order('fecha_esperada'),
  )

  const consultas = [pedido, proximo, alertas, lotes, pendientes]
  const cargando = consultas.some((c) => c.cargando)

  const insumoDeLote = new Map((lotes.datos ?? []).map((l) => [l.id, l.insumo_id]))
  const recomendacion = new Map<number, Recomendacion>()
  for (const a of alertas.datos ?? []) {
    if (a.tipo === 'FALTANTE_CRITICO' && a.entidad_tipo === 'insumo') {
      recomendacion.set(a.entidad_id, 'aumentar')
    } else if (a.tipo === 'SOBRECOMPRA' && a.entidad_tipo === 'lote') {
      const insumo = insumoDeLote.get(a.entidad_id)
      if (insumo !== undefined) recomendacion.set(insumo, 'reducir')
    }
  }

  const lista = pedido.datos ?? []
  const aPedir = lista.filter((p) => Number(p.q) > 0)
  const visibles = verTodos ? lista : lista.filter((p) => Number(p.q) > 0 || recomendacion.has(p.insumo_id))

  // Agrupado por proveedor: cada grupo es un pedido que se hace por separado.
  const grupos = new Map<number | null, PedidoSugerido[]>()
  for (const p of visibles) {
    grupos.set(p.proveedor_id, [...(grupos.get(p.proveedor_id) ?? []), p])
  }
  const llegadas = new Map<number, string[]>()
  for (const e of pendientes.datos ?? []) {
    llegadas.set(e.proveedor_id, [...(llegadas.get(e.proveedor_id) ?? []), e.fecha_esperada])
  }

  const dias = proximo.datos?.[0]?.dias_hasta_proximo_pedido
  const fechaPedido =
    dias === undefined ? null : dias === 0 ? 'hoy' : `el lunes ${formatoFecha(fechaMasDias(dias))}`

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-heading text-lg font-semibold">Pedido sugerido</h1>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          disabled={cargando}
          onClick={() => {
            for (const c of consultas) void c.recargar()
          }}
        >
          <RefreshCwIcon /> Actualizar
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {aPedir.length} {aPedir.length === 1 ? 'insumo por pedir' : 'insumos por pedir'}
            {fechaPedido && ` · pedido ${fechaPedido}`}
          </CardTitle>
          <CardDescription>
            Cantidad para cubrir la semana (revisión cada {lista[0]?.r_dias ?? 7} días) más lo que
            tarda cada proveedor en entregar, descontando lo que ya hay en almacén.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <EstadoDatos error={pedido.error} desdeCopia={pedido.desdeCopia} />
          <Label className="flex w-fit items-center gap-2 font-normal">
            <Checkbox checked={verTodos} onCheckedChange={(v) => setVerTodos(v)} />
            Ver también los insumos que no hace falta pedir
          </Label>
        </CardContent>
      </Card>

      {!cargando && grupos.size === 0 && (
        <p className="text-sm text-muted-foreground">Esta semana no hace falta pedir nada.</p>
      )}

      {[...grupos].map(([proveedorId, items]) => (
        <Card key={proveedorId ?? 'sin-proveedor'}>
          <CardHeader>
            <CardTitle>{items[0].proveedor ?? 'Sin proveedor asignado'}</CardTitle>
            <CardDescription>
              Entrega en {items[0].lead_time_dias}{' '}
              {items[0].lead_time_dias === 1 ? 'día' : 'días'} ·{' '}
              {items.filter((p) => Number(p.q) > 0).length} por pedir
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {proveedorId !== null && (
              <ConfirmarPedido
                proveedorId={proveedorId}
                llegadas={llegadas.get(proveedorId) ?? []}
                deshabilitado={pedido.desdeCopia}
                onConfirmado={() => void pendientes.recargar()}
              />
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Insumo</TableHead>
                  <TableHead className="text-right">Pedir</TableHead>
                  <TableHead className="text-right">Hay</TableHead>
                  <TableHead className="text-right">Nivel objetivo</TableHead>
                  <TableHead className="text-right">Consumo diario</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((p) => {
                  const rec = recomendacion.get(p.insumo_id)
                  return (
                    <TableRow key={p.insumo_id}>
                      <TableCell className="whitespace-normal">
                        <div className="font-medium">{p.nombre}</div>
                        {rec === 'aumentar' && (
                          <Badge className="mt-1 bg-red-100 text-red-900">
                            <TriangleAlertIcon /> Faltante crítico: proveedor poco confiable,
                            considera pedir más o a otro proveedor
                          </Badge>
                        )}
                        {rec === 'reducir' && (
                          <Badge className="mt-1 bg-amber-100 text-amber-900">
                            <TriangleAlertIcon /> Sobrecompra: hay producto que va a caducar,
                            reduce el pedido
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {Number(p.q) > 0 ? `${formatoNumero(p.q, 2)} ${p.unidad}` : '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {formatoCantidad(p.existencia)} {p.unidad}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {formatoNumero(p.np, 2)} {p.unidad}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {formatoNumero(p.cpd, 2)} {p.unidad}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

/**
 * Al confirmar, la base de datos anota una entrega esperada para hoy + el plazo
 * del proveedor. Cuando llegue, se marca en Registro y cuenta para su TCP.
 */
function ConfirmarPedido({
  proveedorId,
  llegadas,
  deshabilitado,
  onConfirmado,
}: {
  proveedorId: number
  llegadas: string[]
  deshabilitado: boolean
  onConfirmado: () => void
}) {
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirmar() {
    setGuardando(true)
    setError(null)
    const { error } = await supabase.rpc('confirmar_pedido', { p_proveedor_id: proveedorId })
    setGuardando(false)
    if (error) setError(mensajeDeError(error))
    else onConfirmado()
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          disabled={guardando || deshabilitado}
          onClick={() => void confirmar()}
        >
          <SendIcon /> {guardando ? 'Confirmando…' : 'Confirmar pedido'}
        </Button>
        {llegadas.map((f) => (
          <Badge key={f} variant="outline">
            Pedido confirmado: llega el {formatoFecha(f)}
          </Badge>
        ))}
      </div>
      <ErrorFormulario error={error} />
    </div>
  )
}
