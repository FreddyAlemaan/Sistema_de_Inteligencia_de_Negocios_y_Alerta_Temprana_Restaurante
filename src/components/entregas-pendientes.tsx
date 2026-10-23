import { useState } from 'react'
import { CheckIcon, TriangleAlertIcon } from 'lucide-react'
import { EstadoDatos, ErrorFormulario } from '@/components/formulario'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useConsulta } from '@/hooks/use-consulta'
import { mensajeDeError } from '@/lib/errores'
import { fechaMasDias, formatoFecha } from '@/lib/formato'
import { supabase } from '@/lib/supabase'

interface EntregaPendiente {
  id: number
  fecha_esperada: string
  proveedor: { nombre: string } | null
}

/**
 * Entregas confirmadas que aún no llegan. Quien recibe marca con un toque si
 * llegó bien o con problemas: de eso sale el cumplimiento del proveedor (TCP).
 */
export function EntregasPendientes() {
  const pendientes = useConsulta<EntregaPendiente[]>('entregas-pendientes', () =>
    supabase
      .from('entrega')
      .select('id, fecha_esperada, proveedor(nombre)')
      .is('fecha_real', null)
      .order('fecha_esperada')
      // Sin tipos generados el cliente supone una lista; proveedor es uno solo.
      .overrideTypes<EntregaPendiente[], { merge: false }>(),
  )
  const [guardando, setGuardando] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hecho, setHecho] = useState<string | null>(null)

  async function registrar(entrega: EntregaPendiente, conforme: boolean) {
    setGuardando(entrega.id)
    setError(null)
    setHecho(null)
    const { error } = await supabase.rpc('registrar_llegada', {
      p_entrega_id: entrega.id,
      p_conforme: conforme,
    })
    if (error) {
      setError(mensajeDeError(error))
    } else {
      setHecho(
        `Entrega de ${entrega.proveedor?.nombre ?? 'proveedor'} registrada ${conforme ? 'como recibida bien' : 'con problemas'}.`,
      )
      // El cumplimiento del proveedor cambió: R3 y R4 se reevalúan.
      await supabase.rpc('evaluar_reglas')
      void pendientes.recargar()
    }
    setGuardando(null)
  }

  const lista = pendientes.datos ?? []
  if (!pendientes.cargando && lista.length === 0 && !hecho && !pendientes.error) return null

  const hoy = fechaMasDias(0)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Entregas por recibir</CardTitle>
        <CardDescription>
          Cuando llegue un pedido, marca si vino completo y en buen estado. Después registra la
          recepción de cada insumo.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <EstadoDatos error={pendientes.error} desdeCopia={pendientes.desdeCopia} />
        {lista.map((e) => {
          const atrasada = e.fecha_esperada < hoy
          return (
            <div
              key={e.id}
              className="flex flex-col gap-2 rounded-lg border bg-background p-3 sm:flex-row sm:items-center"
            >
              <div className="flex flex-1 flex-wrap items-center gap-2">
                <span className="font-medium">{e.proveedor?.nombre ?? 'Proveedor'}</span>
                <span className="text-sm text-muted-foreground">
                  {e.fecha_esperada === hoy
                    ? 'llega hoy'
                    : `esperada el ${formatoFecha(e.fecha_esperada)}`}
                </span>
                {atrasada && <Badge variant="destructive">Atrasada</Badge>}
              </div>
              <div className="flex gap-2">
                <Button
                  disabled={guardando !== null || pendientes.desdeCopia}
                  onClick={() => void registrar(e, true)}
                >
                  <CheckIcon /> Llegó bien
                </Button>
                <Button
                  variant="outline"
                  disabled={guardando !== null || pendientes.desdeCopia}
                  onClick={() => void registrar(e, false)}
                >
                  <TriangleAlertIcon /> Llegó con problemas
                </Button>
              </div>
            </div>
          )
        })}
        <ErrorFormulario error={error} />
        {hecho && (
          <p role="status" className="text-sm text-emerald-700">
            {hecho}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
