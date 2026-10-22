import { useCallback, useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useSesion } from '@/hooks/use-sesion'
import { mensajeDeError } from '@/lib/errores'
import { supabase } from '@/lib/supabase'
import { NOMBRE_ROL, type Perfil, type Rol } from '@/lib/tipos'

// RLS decide qué filas llegan: el operativo sólo recibe la suya,
// el gerente recibe todas.
export function PaginaPerfiles() {
  const { perfil: yo, esGerente, recargarPerfil } = useSesion()
  const [perfiles, setPerfiles] = useState<Perfil[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const { data, error } = await supabase
      .from('perfil')
      .select('id, nombre, rol, creado_en')
      .order('nombre')
    if (error) setError(mensajeDeError(error))
    else {
      setPerfiles(data as Perfil[])
      setError(null)
    }
    setCargando(false)
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  async function guardar(id: string, cambios: Partial<Pick<Perfil, 'nombre' | 'rol'>>) {
    const { error } = await supabase.from('perfil').update(cambios).eq('id', id)
    if (error) {
      setError(mensajeDeError(error))
      return false
    }
    setError(null)
    await cargar()
    if (id === yo?.id) await recargarPerfil()
    return true
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{esGerente ? 'Usuarios' : 'Mi perfil'}</CardTitle>
        <CardDescription>
          {esGerente
            ? 'Cambia el nombre o el rol del personal. Los usuarios nuevos se crean en el panel de Supabase.'
            : 'Puedes cambiar el nombre con el que apareces en los registros.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {cargando && perfiles.length === 0 ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {perfiles.map((p) => (
              <FilaPerfil
                key={p.id}
                perfil={p}
                esYo={p.id === yo?.id}
                puedeCambiarRol={esGerente}
                onGuardar={guardar}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function FilaPerfil({
  perfil,
  esYo,
  puedeCambiarRol,
  onGuardar,
}: {
  perfil: Perfil
  esYo: boolean
  puedeCambiarRol: boolean
  onGuardar: (id: string, cambios: Partial<Pick<Perfil, 'nombre' | 'rol'>>) => Promise<boolean>
}) {
  const [nombre, setNombre] = useState(perfil.nombre)
  const [guardando, setGuardando] = useState(false)
  const nombreCambiado = nombre.trim() !== perfil.nombre && nombre.trim().length > 0

  async function ejecutar(cambios: Partial<Pick<Perfil, 'nombre' | 'rol'>>) {
    setGuardando(true)
    const ok = await onGuardar(perfil.id, cambios)
    if (!ok) setNombre(perfil.nombre)
    setGuardando(false)
  }

  return (
    <li className="flex flex-wrap items-center gap-2 py-3">
      <form
        className="flex min-w-48 flex-1 items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (nombreCambiado) void ejecutar({ nombre: nombre.trim() })
        }}
      >
        <Input
          aria-label="Nombre"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          disabled={guardando}
        />
        {nombreCambiado && (
          <Button type="submit" size="sm" disabled={guardando}>
            Guardar
          </Button>
        )}
      </form>
      {esYo && <Badge variant="outline">Tú</Badge>}
      {puedeCambiarRol ? (
        <NativeSelect
          aria-label="Rol"
          value={perfil.rol}
          disabled={guardando}
          onChange={(e) => void ejecutar({ rol: e.target.value as Rol })}
        >
          <NativeSelectOption value="operativo">{NOMBRE_ROL.operativo}</NativeSelectOption>
          <NativeSelectOption value="gerente">{NOMBRE_ROL.gerente}</NativeSelectOption>
        </NativeSelect>
      ) : (
        <Badge variant="secondary">{NOMBRE_ROL[perfil.rol]}</Badge>
      )}
    </li>
  )
}
