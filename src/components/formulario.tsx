import type { ReactNode } from 'react'
import { Label } from '@/components/ui/label'

/** Etiqueta + control + ayuda opcional. */
export function Campo({
  id,
  etiqueta,
  ayuda,
  children,
}: {
  id: string
  etiqueta: string
  ayuda?: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{etiqueta}</Label>
      {children}
      {ayuda && <p className="text-xs text-muted-foreground">{ayuda}</p>}
    </div>
  )
}

/** Mensaje de error o de "datos sin conexión" sobre una lista. */
export function EstadoDatos({ error, desdeCopia }: { error: string | null; desdeCopia: boolean }) {
  if (desdeCopia) {
    return (
      <p role="status" className="rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-900">
        Sin conexión: se muestra la última lista guardada.
      </p>
    )
  }
  if (error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    )
  }
  return null
}

export function ErrorFormulario({ error }: { error: string | null }) {
  if (!error) return null
  return (
    <p role="alert" className="text-sm text-destructive">
      {error}
    </p>
  )
}
