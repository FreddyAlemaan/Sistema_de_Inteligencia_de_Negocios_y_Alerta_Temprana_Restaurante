import { WifiOffIcon } from 'lucide-react'
import { useConexion } from '@/hooks/use-conexion'
import { useSesion } from '@/hooks/use-sesion'

/** Franja visible cuando no hay conexión: la app sigue con el último dato conocido. */
export function AvisoConexion() {
  const enLinea = useConexion()
  const { perfilDesdeCopia } = useSesion()
  if (enLinea && !perfilDesdeCopia) return null

  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 bg-amber-100 px-4 py-2 text-sm text-amber-900"
    >
      <WifiOffIcon className="size-4" aria-hidden="true" />
      Sin conexión. Se muestra el último dato conocido; se reintentará al volver internet.
    </div>
  )
}
