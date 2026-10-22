import { useState, type FormEvent } from 'react'
import { CheckCircle2Icon } from 'lucide-react'
import { Campo, ErrorFormulario, EstadoDatos } from '@/components/formulario'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from '@/components/ui/native-select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useConsulta } from '@/hooks/use-consulta'
import { useSesion } from '@/hooks/use-sesion'
import { mensajeDeError } from '@/lib/errores'
import { fechaMasDias, formatoCantidad, formatoFecha, formatoFechaHora } from '@/lib/formato'
import { supabase } from '@/lib/supabase'
import {
  NOMBRE_TIPO,
  type Existencia,
  type Insumo,
  type Movimiento,
  type Perfil,
  type TipoMovimiento,
} from '@/lib/tipos'

const MOTIVOS_MERMA = ['Caducado', 'Mal estado', 'Dañado en el transporte', 'Error de preparación']

const DESCRIPCION_TIPO: Record<TipoMovimiento, string> = {
  ENTRADA: 'Mercancía que llega del proveedor. Se crea un lote nuevo.',
  CONSUMO: 'Lo que se usa en cocina. Sale primero del lote que caduca antes.',
  MERMA: 'Producto que se bota o se pierde. Siempre con motivo.',
}

export function PaginaRegistro() {
  const [tipo, setTipo] = useState<TipoMovimiento>('CONSUMO')
  const [insumoId, setInsumoId] = useState('')

  const insumos = useConsulta<Insumo[]>('insumos', () =>
    supabase
      .from('insumo')
      .select(
        'id, nombre, unidad, categoria, proveedor_id, dias_alerta_caducidad, vida_util_dias, stock_minimo, activo',
      )
      .order('categoria')
      .order('nombre'),
  )
  const existencias = useConsulta<Existencia[]>('existencias', () =>
    supabase.rpc('existencias'),
  )
  const movimientos = useConsulta<Movimiento[]>('movimientos-recientes', () =>
    supabase
      .from('movimiento')
      .select('id, insumo_id, lote_id, tipo, cantidad, motivo, fecha, usuario_id')
      .order('fecha', { ascending: false })
      .order('id', { ascending: false })
      .limit(15),
  )
  // RLS: el gerente recibe a todo el personal; el operativo, sólo a sí mismo.
  const perfiles = useConsulta<Pick<Perfil, 'id' | 'nombre'>[]>('nombres-perfiles', () =>
    supabase.from('perfil').select('id, nombre'),
  )

  const listaInsumos = insumos.datos ?? []
  const porId = new Map(listaInsumos.map((i) => [i.id, i]))
  const stock = new Map((existencias.datos ?? []).map((e) => [e.insumo_id, e]))
  const nombres = new Map((perfiles.datos ?? []).map((p) => [p.id, p.nombre]))

  function alRegistrar() {
    void existencias.recargar()
    void movimientos.recargar()
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Registrar</CardTitle>
            <CardDescription>{DESCRIPCION_TIPO[tipo]}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid grid-cols-3 gap-1" role="tablist">
              {(['ENTRADA', 'CONSUMO', 'MERMA'] as const).map((t) => (
                <Button
                  key={t}
                  role="tab"
                  aria-selected={tipo === t}
                  variant={tipo === t ? 'default' : 'outline'}
                  onClick={() => setTipo(t)}
                >
                  {NOMBRE_TIPO[t]}
                </Button>
              ))}
            </div>
            <FormularioMovimiento
              key={tipo}
              tipo={tipo}
              insumos={listaInsumos}
              stock={stock}
              insumoId={insumoId}
              setInsumoId={setInsumoId}
              onRegistrado={alRegistrar}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Existencias</CardTitle>
            <CardDescription>Toca un insumo para registrarlo.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <EstadoDatos error={existencias.error} desdeCopia={existencias.desdeCopia} />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Insumo</TableHead>
                  <TableHead className="text-right">Existencia</TableHead>
                  <TableHead>Próxima caducidad</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {listaInsumos
                  .filter((i) => i.activo || Number(stock.get(i.id)?.existencia ?? 0) > 0)
                  .map((i) => {
                    const e = stock.get(i.id)
                    return (
                      <TableRow
                        key={i.id}
                        className="cursor-pointer"
                        data-state={String(i.id) === insumoId ? 'selected' : undefined}
                        onClick={() => setInsumoId(String(i.id))}
                      >
                        <TableCell className="font-medium">{i.nombre}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatoCantidad(e?.existencia ?? 0)} {i.unidad}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {e?.proxima_caducidad ? (
                            <>
                              {formatoFecha(e.proxima_caducidad)}{' '}
                              <span className="text-xs">({textoDias(e.dias_a_caducidad)})</span>
                            </>
                          ) : (
                            '—'
                          )}
                        </TableCell>
                        <TableCell className="flex flex-wrap justify-end gap-1">
                          {e?.bajo_minimo && (
                            <Badge className="bg-amber-100 text-amber-900">Bajo mínimo</Badge>
                          )}
                          {Number(e?.existencia_caducada ?? 0) > 0 && (
                            <Badge variant="destructive">
                              Caducado: {formatoCantidad(e!.existencia_caducada)} {i.unidad}
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Últimos movimientos</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <EstadoDatos error={movimientos.error} desdeCopia={movimientos.desdeCopia} />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Insumo</TableHead>
                <TableHead className="text-right">Cantidad</TableHead>
                <TableHead>Motivo</TableHead>
                <TableHead>Registró</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(movimientos.datos ?? []).map((m) => {
                const insumo = porId.get(m.insumo_id)
                return (
                  <TableRow key={m.id}>
                    <TableCell className="tabular-nums">{formatoFechaHora(m.fecha)}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          m.tipo === 'MERMA'
                            ? 'destructive'
                            : m.tipo === 'ENTRADA'
                              ? 'secondary'
                              : 'outline'
                        }
                      >
                        {NOMBRE_TIPO[m.tipo]}
                      </Badge>
                    </TableCell>
                    <TableCell>{insumo?.nombre ?? `#${m.insumo_id}`}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {m.tipo === 'ENTRADA' ? '+' : '−'}
                      {formatoCantidad(m.cantidad)} {insumo?.unidad}
                    </TableCell>
                    <TableCell className="whitespace-normal text-muted-foreground">
                      {m.tipo === 'ENTRADA' ? '' : (m.motivo ?? '')}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {m.usuario_id ? (nombres.get(m.usuario_id) ?? 'Otro usuario') : 'Sistema'}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

function textoDias(dias: number | null) {
  if (dias === null) return ''
  if (dias === 0) return 'hoy'
  if (dias === 1) return 'mañana'
  return `en ${dias} días`
}

function FormularioMovimiento({
  tipo,
  insumos,
  stock,
  insumoId,
  setInsumoId,
  onRegistrado,
}: {
  tipo: TipoMovimiento
  insumos: Insumo[]
  stock: Map<number, Existencia>
  insumoId: string
  setInsumoId: (id: string) => void
  onRegistrado: () => void
}) {
  const { esGerente } = useSesion()
  const insumo = insumos.find((i) => String(i.id) === insumoId)
  const [cantidad, setCantidad] = useState('')
  const [caducidad, setCaducidad] = useState(insumo ? fechaMasDias(insumo.vida_util_dias) : '')
  const [costo, setCosto] = useState('')
  const [motivo, setMotivo] = useState(MOTIVOS_MERMA[0])
  const [otroMotivo, setOtroMotivo] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hecho, setHecho] = useState<string | null>(null)

  // Recepción sólo de insumos activos; salidas de cualquiera con existencia.
  const opciones = insumos.filter((i) =>
    tipo === 'ENTRADA' ? i.activo : i.activo || Number(stock.get(i.id)?.existencia ?? 0) > 0,
  )
  const categorias = [...new Set(opciones.map((i) => i.categoria))]

  // La fecha de caducidad propuesta sigue al insumo elegido (también al
  // elegirlo desde la tabla de existencias).
  const [insumoDeCaducidad, setInsumoDeCaducidad] = useState(insumoId)
  if (insumoDeCaducidad !== insumoId) {
    setInsumoDeCaducidad(insumoId)
    setCaducidad(insumo ? fechaMasDias(insumo.vida_util_dias) : '')
  }

  async function registrar(evento: FormEvent) {
    evento.preventDefault()
    if (!insumo) return
    const valor = Number(cantidad.replace(',', '.'))
    if (!Number.isFinite(valor) || valor <= 0) {
      setError('Escribe una cantidad mayor que cero.')
      return
    }
    setGuardando(true)
    setError(null)
    setHecho(null)
    try {
      if (tipo === 'ENTRADA') {
        const { error } = await supabase.rpc('registrar_recepcion', {
          p_insumo_id: insumo.id,
          p_cantidad: valor,
          p_fecha_caducidad: caducidad || null,
          p_costo_unitario: costo ? Number(costo.replace(',', '.')) : null,
        })
        if (error) throw error
        setHecho(
          `Recepción registrada: ${formatoCantidad(valor)} ${insumo.unidad} de ${insumo.nombre}` +
            (caducidad ? `, caduca el ${formatoFecha(caducidad)}.` : '.'),
        )
      } else {
        const motivoFinal = tipo === 'MERMA' ? (motivo === 'Otro' ? otroMotivo : motivo) : null
        const { data, error } = await supabase.rpc('registrar_salida', {
          p_insumo_id: insumo.id,
          p_tipo: tipo,
          p_cantidad: valor,
          p_motivo: motivoFinal,
        })
        if (error) throw error
        setHecho(
          `${NOMBRE_TIPO[tipo]} registrado: ${formatoCantidad(valor)} ${insumo.unidad} de ${insumo.nombre}. ` +
            `Quedan ${formatoCantidad(data as number)} ${insumo.unidad}.`,
        )
      }
      setCantidad('')
      setCosto('')
      setOtroMotivo('')
      // El motor reevalúa con el dato nuevo; sus alertas llegan como aviso emergente.
      // Si falla, el registro ya quedó guardado y pg_cron lo evaluará igual.
      await supabase.rpc('evaluar_reglas')
      onRegistrado()
    } catch (e) {
      // Los valores se conservan para reintentar con un clic (RNF-06).
      setError(mensajeDeError(e))
    } finally {
      setGuardando(false)
    }
  }

  const disponible = insumo ? stock.get(insumo.id) : undefined

  return (
    <form onSubmit={registrar} className="flex flex-col gap-4">
      <Campo id="mov-insumo" etiqueta="Insumo">
        <NativeSelect
          id="mov-insumo"
          className="w-full"
          required
          value={insumoId}
          onChange={(e) => setInsumoId(e.target.value)}
        >
          <NativeSelectOption value="">Elige un insumo…</NativeSelectOption>
          {categorias.map((c) => (
            <NativeSelectOptGroup key={c} label={c}>
              {opciones
                .filter((i) => i.categoria === c)
                .map((i) => (
                  <NativeSelectOption key={i.id} value={String(i.id)}>
                    {i.nombre}
                    {tipo !== 'ENTRADA' &&
                      ` — ${formatoCantidad(stock.get(i.id)?.existencia ?? 0)} ${i.unidad}`}
                  </NativeSelectOption>
                ))}
            </NativeSelectOptGroup>
          ))}
        </NativeSelect>
      </Campo>

      <Campo
        id="mov-cantidad"
        etiqueta={`Cantidad${insumo ? ` (${insumo.unidad})` : ''}`}
        ayuda={
          tipo !== 'ENTRADA' && disponible
            ? `Hay ${formatoCantidad(disponible.existencia)} ${insumo!.unidad} en almacén.`
            : undefined
        }
      >
        <Input
          id="mov-cantidad"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0"
          required
          value={cantidad}
          onChange={(e) => setCantidad(e.target.value)}
        />
      </Campo>

      {tipo === 'ENTRADA' && (
        <Campo
          id="mov-caducidad"
          etiqueta="Fecha de caducidad"
          ayuda={insumo ? `Propuesta según su vida útil (${insumo.vida_util_dias} días).` : undefined}
        >
          <Input
            id="mov-caducidad"
            type="date"
            min={fechaMasDias(0)}
            value={caducidad}
            onChange={(e) => setCaducidad(e.target.value)}
          />
        </Campo>
      )}

      {tipo === 'ENTRADA' && esGerente && (
        <Campo
          id="mov-costo"
          etiqueta="Costo unitario € (opcional)"
          ayuda="Si lo dejas vacío se usa el último costo conocido."
        >
          <Input
            id="mov-costo"
            inputMode="decimal"
            autoComplete="off"
            value={costo}
            onChange={(e) => setCosto(e.target.value)}
          />
        </Campo>
      )}

      {tipo === 'MERMA' && (
        <Campo id="mov-motivo" etiqueta="Motivo">
          <NativeSelect
            id="mov-motivo"
            className="w-full"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          >
            {[...MOTIVOS_MERMA, 'Otro'].map((m) => (
              <NativeSelectOption key={m} value={m}>
                {m}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {motivo === 'Otro' && (
            <Input
              aria-label="Describe el motivo"
              placeholder="Describe el motivo"
              required
              value={otroMotivo}
              onChange={(e) => setOtroMotivo(e.target.value)}
            />
          )}
        </Campo>
      )}

      <ErrorFormulario error={error} />
      {hecho && (
        <p role="status" className="flex items-start gap-2 text-sm text-emerald-700">
          <CheckCircle2Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {hecho}
        </p>
      )}

      <Button type="submit" size="lg" disabled={guardando || !insumo}>
        {guardando ? 'Guardando…' : `Registrar ${NOMBRE_TIPO[tipo].toLowerCase()}`}
      </Button>
    </form>
  )
}
