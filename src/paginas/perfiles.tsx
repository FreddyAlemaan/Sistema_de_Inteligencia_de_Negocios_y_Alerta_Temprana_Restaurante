import { useCallback, useEffect, useState } from 'react'
import {
  BookOpenIcon,
  ChartColumnIcon,
  ChevronDownIcon,
  ClipboardPenIcon,
  ConciergeBellIcon,
  ShieldCheckIcon,
  ShoppingCartIcon,
  type LucideIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'
import { useSesion } from '@/hooks/use-sesion'
import { mensajeDeError } from '@/lib/errores'
import { supabase } from '@/lib/supabase'
import { NOMBRE_ROL, PERMISOS, type Perfil, type Permiso, type Rol } from '@/lib/tipos'
import { cn } from '@/lib/utils'

const ICONO_PERMISO: Record<Permiso, LucideIcon> = {
  comandas: ConciergeBellIcon,
  registro: ClipboardPenIcon,
  tablero: ChartColumnIcon,
  pedido: ShoppingCartIcon,
  catalogos: BookOpenIcon,
}

// Colores de avatar: se elige siempre el mismo para cada persona.
const COLORES_AVATAR = [
  'bg-[oklch(0.9_0.05_250)] text-[oklch(0.35_0.1_255)]',
  'bg-[oklch(0.9_0.06_165)] text-[oklch(0.35_0.08_165)]',
  'bg-[oklch(0.92_0.07_80)] text-[oklch(0.42_0.1_65)]',
  'bg-[oklch(0.9_0.05_20)] text-[oklch(0.42_0.12_25)]',
  'bg-[oklch(0.9_0.05_300)] text-[oklch(0.38_0.1_300)]',
]

function colorAvatar(id: string) {
  let suma = 0
  for (const c of id) suma = (suma + c.charCodeAt(0)) % 997
  return COLORES_AVATAR[suma % COLORES_AVATAR.length]
}

function iniciales(nombre: string) {
  const partes = nombre.trim().split(/\s+/).filter(Boolean)
  const letras = partes.length > 1 ? partes[0][0] + partes[partes.length - 1][0] : (partes[0] ?? '?').slice(0, 2)
  return letras.toUpperCase()
}

type Cambios = Partial<Pick<Perfil, 'nombre' | 'rol'>>

// RLS decide qué filas llegan: el operativo sólo recibe la suya,
// el gerente recibe todas.
export function PaginaPerfiles() {
  const { perfil: yo, esGerente, recargarPerfil } = useSesion()
  const [perfiles, setPerfiles] = useState<Perfil[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [abierto, setAbierto] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const { data, error } = await supabase
      .from('perfil')
      .select('id, nombre, rol, permisos, creado_en')
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

  async function despues(id: string, error: Parameters<typeof mensajeDeError>[0] | null) {
    if (error) {
      setError(mensajeDeError(error))
      return false
    }
    setError(null)
    await cargar()
    if (id === yo?.id) await recargarPerfil()
    return true
  }

  async function guardar(id: string, cambios: Cambios) {
    const { error } = await supabase.from('perfil').update(cambios).eq('id', id)
    return despues(id, error)
  }

  async function guardarPermisos(id: string, permisos: Permiso[]) {
    // Se muestra el cambio al instante; si la base lo rechaza, se recarga.
    setPerfiles((lista) => lista.map((p) => (p.id === id ? { ...p, permisos } : p)))
    const { error } = await supabase.rpc('asignar_permisos', { p_perfil_id: id, p_permisos: permisos })
    return despues(id, error)
  }

  // El operativo sólo se ve a sí mismo: su tarjeta abierta directamente.
  const visibles = esGerente ? perfiles : perfiles.filter((p) => p.id === yo?.id)

  return (
    <Card>
      <CardHeader>
        <CardTitle>{esGerente ? 'Personal' : 'Mi perfil'}</CardTitle>
        <CardDescription>
          {esGerente
            ? 'Toca una persona para cambiar su nombre, su rol y lo que puede hacer. Los usuarios nuevos se crean en el panel de Supabase.'
            : 'Puedes cambiar el nombre con el que apareces en los registros. Lo que puedes hacer lo decide el gerente.'}
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
          <ul className="flex flex-col gap-2.5">
            {visibles.map((p) => (
              <TarjetaPerfil
                key={p.id}
                perfil={p}
                esYo={p.id === yo?.id}
                esGerente={esGerente}
                abierta={!esGerente || abierto === p.id}
                onAlternar={esGerente ? () => setAbierto((a) => (a === p.id ? null : p.id)) : undefined}
                onGuardar={guardar}
                onPermisos={guardarPermisos}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function TarjetaPerfil({
  perfil,
  esYo,
  esGerente,
  abierta,
  onAlternar,
  onGuardar,
  onPermisos,
}: {
  perfil: Perfil
  esYo: boolean
  esGerente: boolean
  abierta: boolean
  /** Sin esto la tarjeta no se puede plegar (vista del operativo) */
  onAlternar?: () => void
  onGuardar: (id: string, cambios: Cambios) => Promise<boolean>
  onPermisos: (id: string, permisos: Permiso[]) => Promise<boolean>
}) {
  const [nombre, setNombre] = useState(perfil.nombre)
  const [guardando, setGuardando] = useState(false)
  const nombreCambiado = nombre.trim() !== perfil.nombre && nombre.trim().length > 0
  const idCuerpo = `perfil-${perfil.id}`
  const esOperativo = perfil.rol === 'operativo'
  const encendidos = perfil.permisos.length

  async function ejecutar(accion: () => Promise<boolean>) {
    setGuardando(true)
    const ok = await accion()
    if (!ok) setNombre(perfil.nombre)
    setGuardando(false)
  }

  function alternarPermiso(permiso: Permiso, encendido: boolean) {
    const nuevos = encendido
      ? [...perfil.permisos, permiso]
      : perfil.permisos.filter((p) => p !== permiso)
    void ejecutar(() => onPermisos(perfil.id, nuevos))
  }

  const cabecera = (
    <>
      <span
        className={cn(
          'grid size-11 shrink-0 place-items-center rounded-full font-heading text-base font-semibold',
          colorAvatar(perfil.id),
        )}
        aria-hidden="true"
      >
        {iniciales(perfil.nombre)}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium">{perfil.nombre}</span>
          {esYo && <Badge variant="outline">Tú</Badge>}
        </span>
        <span className="text-sm text-muted-foreground">
          {NOMBRE_ROL[perfil.rol]}
          {' · '}
          {esOperativo
            ? `${encendidos} de ${PERMISOS.length} permisos`
            : 'puede todo'}
        </span>
      </span>
    </>
  )

  return (
    <li
      className={cn(
        'overflow-hidden rounded-xl border bg-background transition-shadow',
        abierta && onAlternar && 'shadow-sm ring-1 ring-primary/15',
      )}
    >
      {onAlternar ? (
        <button
          type="button"
          onClick={onAlternar}
          aria-expanded={abierta}
          aria-controls={idCuerpo}
          className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          {cabecera}
          <ChevronDownIcon
            className={cn(
              'size-5 shrink-0 text-muted-foreground transition-transform duration-200',
              abierta && 'rotate-180',
            )}
            aria-hidden="true"
          />
        </button>
      ) : (
        <div className="flex items-center gap-3 px-4 py-3">{cabecera}</div>
      )}

      {abierta && (
        <div
          id={idCuerpo}
          className="flex flex-col gap-5 border-t bg-card/60 px-4 py-4 duration-200 animate-in fade-in slide-in-from-top-1"
        >
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
            <form
              className="flex flex-col gap-1.5"
              onSubmit={(e) => {
                e.preventDefault()
                if (nombreCambiado) void ejecutar(() => onGuardar(perfil.id, { nombre: nombre.trim() }))
              }}
            >
              <Label htmlFor={`${idCuerpo}-nombre`}>Nombre</Label>
              <div className="flex gap-2">
                <Input
                  id={`${idCuerpo}-nombre`}
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  disabled={guardando}
                />
                {nombreCambiado && (
                  <Button type="submit" disabled={guardando}>
                    Guardar
                  </Button>
                )}
              </div>
            </form>
            {esGerente && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${idCuerpo}-rol`}>Rol</Label>
                <NativeSelect
                  id={`${idCuerpo}-rol`}
                  className="w-full"
                  value={perfil.rol}
                  disabled={guardando}
                  onChange={(e) =>
                    void ejecutar(() => onGuardar(perfil.id, { rol: e.target.value as Rol }))
                  }
                >
                  <NativeSelectOption value="operativo">{NOMBRE_ROL.operativo}</NativeSelectOption>
                  <NativeSelectOption value="gerente">{NOMBRE_ROL.gerente}</NativeSelectOption>
                </NativeSelect>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">
              {esGerente ? 'Qué puede hacer' : 'Lo que puedes hacer'}
            </span>
            {esOperativo ? (
              <ul className="flex flex-col divide-y rounded-lg border bg-background">
                {PERMISOS.map(({ permiso, nombre: titulo, descripcion }) => {
                  const Icono = ICONO_PERMISO[permiso]
                  const encendido = perfil.permisos.includes(permiso)
                  const idInterruptor = `${idCuerpo}-${permiso}`
                  return (
                    <li key={permiso} className="flex items-center gap-3 px-3 py-3">
                      <span
                        className={cn(
                          'grid size-9 shrink-0 place-items-center rounded-lg transition-colors',
                          encendido ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                        )}
                        aria-hidden="true"
                      >
                        <Icono className="size-[1.1rem]" />
                      </span>
                      <label htmlFor={idInterruptor} className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="text-sm font-medium">{titulo}</span>
                        <span className="text-xs text-muted-foreground">{descripcion}</span>
                      </label>
                      <Switch
                        id={idInterruptor}
                        checked={encendido}
                        disabled={!esGerente || guardando}
                        onCheckedChange={(valor) => alternarPermiso(permiso, valor)}
                      />
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="flex items-center gap-2 rounded-lg bg-muted px-3 py-3 text-sm text-muted-foreground">
                <ShieldCheckIcon className="size-4 shrink-0" aria-hidden="true" />
                El gerente puede usar todo el sistema, incluidos costos y ajustes del motor.
              </p>
            )}
          </div>
        </div>
      )}
    </li>
  )
}
