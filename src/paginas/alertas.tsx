import { useEffect, useState, type FormEvent } from 'react'
import { CheckCircle2Icon } from 'lucide-react'
import { Campo, ErrorFormulario, EstadoDatos } from '@/components/formulario'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useConsulta } from '@/hooks/use-consulta'
import { mensajeDeError } from '@/lib/errores'
import { formatoFechaHora } from '@/lib/formato'
import { supabase } from '@/lib/supabase'
import { NOMBRE_TIPO_ALERTA, type Alerta, type Perfil, type Severidad } from '@/lib/tipos'

const COLUMNAS =
  'id, regla_id, tipo, entidad_tipo, entidad_id, valor, umbral, severidad, estado, mensaje, creada_en, atendida_por, atendida_en, accion_tomada'

const ORDEN_SEVERIDAD: Record<Severidad, number> = { ALTA: 0, MEDIA: 1, BAJA: 2 }

const ESTILO_SEVERIDAD: Record<Severidad, string> = {
  ALTA: 'bg-red-100 text-red-900',
  MEDIA: 'bg-amber-100 text-amber-900',
  BAJA: 'bg-sky-100 text-sky-900',
}

// Acciones de un toque por tipo de alerta (RNF-01: atender en segundos).
// Siempre queda "Otra acción" para escribirla.
const ACCIONES: Record<string, string[]> = {
  CADUCIDAD: ['Se usó primero en cocina', 'Se ofreció como plato del día', 'Se registró como merma'],
  FALTANTE: ['Se adelantó el pedido', 'Se compró a otro proveedor', 'Se ajustó el menú'],
  PROVEEDOR: ['Se habló con el proveedor', 'Se buscó un proveedor alterno'],
  FALTANTE_CRITICO: ['Se aumentó el próximo pedido', 'Se pidió a un proveedor alterno'],
  SOBRESTOCK: ['Se redujo el próximo pedido', 'Se promocionó en el menú'],
  SOBRECOMPRA: ['Se redujo el próximo pedido', 'Se usó primero en cocina'],
  SERVICIO_LENTO: ['Se priorizó la comanda', 'Se reforzó la cocina', 'Se avisó a la mesa'],
}

type Vista = 'abiertas' | 'historial'

export function PaginaAlertas() {
  const [vista, setVista] = useState<Vista>('abiertas')
  const [atendiendo, setAtendiendo] = useState<Alerta | null>(null)

  const abiertas = useConsulta<Alerta[]>('alertas-abiertas', () =>
    supabase
      .from('alerta')
      .select(COLUMNAS)
      .eq('estado', 'ABIERTA')
      .order('creada_en', { ascending: false }),
  )
  const historial = useConsulta<Alerta[]>('alertas-historial', () =>
    supabase
      .from('alerta')
      .select(COLUMNAS)
      .neq('estado', 'ABIERTA')
      .order('creada_en', { ascending: false })
      .limit(50),
  )
  // RLS: el gerente recibe a todo el personal; el operativo, sólo a sí mismo.
  const perfiles = useConsulta<Pick<Perfil, 'id' | 'nombre'>[]>('nombres-perfiles', () =>
    supabase.from('perfil').select('id, nombre'),
  )
  const nombres = new Map((perfiles.datos ?? []).map((p) => [p.id, p.nombre]))

  const recargarAbiertas = abiertas.recargar
  const recargarHistorial = historial.recargar

  // En vivo: alertas nuevas del motor y las que atienden otros usuarios.
  useEffect(() => {
    const canal = supabase
      .channel('bandeja-alertas')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'alerta' }, () => {
        void recargarAbiertas()
        void recargarHistorial()
      })
      .subscribe()
    return () => {
      void supabase.removeChannel(canal)
    }
  }, [recargarAbiertas, recargarHistorial])

  const listaAbiertas = [...(abiertas.datos ?? [])].sort(
    (a, b) => ORDEN_SEVERIDAD[a.severidad] - ORDEN_SEVERIDAD[b.severidad],
  )

  function alAtender() {
    setAtendiendo(null)
    void recargarAbiertas()
    void recargarHistorial()
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid w-fit grid-cols-2 gap-1" role="tablist">
        <Button
          role="tab"
          aria-selected={vista === 'abiertas'}
          variant={vista === 'abiertas' ? 'default' : 'outline'}
          onClick={() => setVista('abiertas')}
        >
          Abiertas ({listaAbiertas.length})
        </Button>
        <Button
          role="tab"
          aria-selected={vista === 'historial'}
          variant={vista === 'historial' ? 'default' : 'outline'}
          onClick={() => setVista('historial')}
        >
          Historial
        </Button>
      </div>

      {vista === 'abiertas' ? (
        <Card>
          <CardHeader>
            <CardTitle>Alertas abiertas</CardTitle>
            <CardDescription>
              Primero las más graves. Al atender una, indica qué se hizo: queda en el historial.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <EstadoDatos error={abiertas.error} desdeCopia={abiertas.desdeCopia} />
            {!abiertas.cargando && listaAbiertas.length === 0 && (
              <p className="flex items-center gap-2 text-sm text-emerald-700">
                <CheckCircle2Icon className="size-4" aria-hidden="true" />
                No hay alertas abiertas.
              </p>
            )}
            {listaAbiertas.map((a) => (
              <div
                key={a.id}
                className="flex flex-col gap-2 rounded-lg border bg-background p-3 sm:flex-row sm:items-start"
              >
                <div className="flex flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className={ESTILO_SEVERIDAD[a.severidad]}>
                      {a.severidad.toLowerCase()}
                    </Badge>
                    <span className="font-medium">{NOMBRE_TIPO_ALERTA[a.tipo] ?? a.tipo}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {formatoFechaHora(a.creada_en)}
                    </span>
                  </div>
                  <p className="text-sm">{a.mensaje}</p>
                </div>
                <Button
                  className="w-full sm:w-auto"
                  disabled={abiertas.desdeCopia}
                  onClick={() => setAtendiendo(a)}
                >
                  Atender
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Historial</CardTitle>
            <CardDescription>
              Las últimas 50 alertas atendidas o resumidas por una alerta encadenada.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <EstadoDatos error={historial.error} desdeCopia={historial.desdeCopia} />
            {!historial.cargando && (historial.datos ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">Todavía no hay alertas en el historial.</p>
            )}
            {(historial.datos ?? []).map((a) => (
              <div key={a.id} className="flex flex-col gap-1 rounded-lg border bg-background p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={ESTILO_SEVERIDAD[a.severidad]}>
                    {a.severidad.toLowerCase()}
                  </Badge>
                  <span className="font-medium">{NOMBRE_TIPO_ALERTA[a.tipo] ?? a.tipo}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {formatoFechaHora(a.creada_en)}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">{a.mensaje}</p>
                {a.estado === 'ATENDIDA' ? (
                  <p className="text-sm">
                    <span className="font-medium">Atendida</span>
                    {a.atendida_en && ` el ${formatoFechaHora(a.atendida_en)}`} por{' '}
                    {a.atendida_por ? (nombres.get(a.atendida_por) ?? 'otro usuario') : '—'}:{' '}
                    {a.accion_tomada}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground italic">
                    Resumida en una alerta encadenada (faltante crítico o sobrecompra).
                  </p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {atendiendo && (
        <FormularioAtencion
          alerta={atendiendo}
          onCerrar={() => setAtendiendo(null)}
          onAtendida={alAtender}
        />
      )}
    </div>
  )
}

function FormularioAtencion({
  alerta,
  onCerrar,
  onAtendida,
}: {
  alerta: Alerta
  onCerrar: () => void
  onAtendida: () => void
}) {
  const sugeridas = ACCIONES[alerta.tipo] ?? []
  const [accion, setAccion] = useState(sugeridas[0] ?? 'Otra')
  const [otra, setOtra] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function guardar(evento: FormEvent) {
    evento.preventDefault()
    setGuardando(true)
    setError(null)
    const { error } = await supabase.rpc('atender_alerta', {
      p_alerta_id: alerta.id,
      p_accion: accion === 'Otra' ? otra : accion,
    })
    setGuardando(false)
    if (error) setError(mensajeDeError(error))
    else onAtendida()
  }

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && onCerrar()}>
      <DialogContent>
        <form onSubmit={guardar} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Atender: {NOMBRE_TIPO_ALERTA[alerta.tipo] ?? alerta.tipo}</DialogTitle>
            <DialogDescription>{alerta.mensaje}</DialogDescription>
          </DialogHeader>
          <Campo id="atencion-accion" etiqueta="¿Qué se hizo?">
            <div id="atencion-accion" className="flex flex-col gap-1" role="radiogroup">
              {[...sugeridas, 'Otra'].map((s) => (
                <Button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={accion === s}
                  variant={accion === s ? 'secondary' : 'ghost'}
                  className="justify-start"
                  onClick={() => setAccion(s)}
                >
                  {s === 'Otra' ? 'Otra acción…' : s}
                </Button>
              ))}
            </div>
            {accion === 'Otra' && (
              <Input
                aria-label="Describe la acción"
                placeholder="Describe la acción"
                required
                autoFocus
                value={otra}
                onChange={(e) => setOtra(e.target.value)}
              />
            )}
          </Campo>
          <ErrorFormulario error={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCerrar}>
              Cancelar
            </Button>
            <Button type="submit" disabled={guardando}>
              {guardando ? 'Guardando…' : 'Marcar como atendida'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
