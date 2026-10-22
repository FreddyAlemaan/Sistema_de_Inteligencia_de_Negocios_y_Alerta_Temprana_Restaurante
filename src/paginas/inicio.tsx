import { useState } from 'react'
import { PlayIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useSesion } from '@/hooks/use-sesion'
import { mensajeDeError } from '@/lib/errores'
import { supabase } from '@/lib/supabase'
import { NOMBRE_ROL, type ResumenMotor } from '@/lib/tipos'

export function PaginaInicio() {
  const { perfil, esGerente } = useSesion()
  if (!perfil) return null

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Hola, {perfil.nombre}</CardTitle>
          <CardDescription>Entraste como {NOMBRE_ROL[perfil.rol].toLowerCase()}.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
          {esGerente ? (
            <p>
              Administras los catálogos, los usuarios y la configuración del motor de reglas, y ves
              los costos de cada lote.
            </p>
          ) : (
            <p>
              Registra las recepciones, consumos y mermas del día. Las alertas aparecerán como aviso
              en la esquina superior derecha.
            </p>
          )}
          <p>Los módulos se irán habilitando en las próximas entregas.</p>
        </CardContent>
      </Card>
      {esGerente && <EvaluacionMotor />}
    </div>
  )
}

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
    <Card>
      <CardHeader>
        <CardTitle>Motor de reglas</CardTitle>
        <CardDescription>
          Se evalúa solo cada 10 minutos y después de cada registro. Puedes forzar una evaluación
          para ver el encadenamiento paso a paso.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Button className="w-fit" onClick={() => void evaluar()} disabled={ejecutando}>
          <PlayIcon /> {ejecutando ? 'Evaluando…' : 'Evaluar ahora'}
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {resumen && (
          <div className="flex flex-col gap-3 text-sm">
            <p>
              {resumen.iteraciones} {resumen.iteraciones === 1 ? 'vuelta' : 'vueltas'} hasta el punto
              fijo · {resumen.hechos_nuevos} hechos nuevos · {resumen.hechos_retractados} retirados
              · {resumen.hechos_vigentes} vigentes · {resumen.alertas_emitidas} alertas nuevas ·{' '}
              {resumen.alertas_suprimidas} suprimidas por una encadenada
              {resumen.mermas_automaticas > 0 &&
                ` · ${resumen.mermas_automaticas} lotes vencidos pasados a merma`}
            </p>
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
          </div>
        )}
      </CardContent>
    </Card>
  )
}
