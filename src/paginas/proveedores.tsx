import { useState, type FormEvent } from 'react'
import { PencilIcon, PlusIcon } from 'lucide-react'
import { Campo, ErrorFormulario, EstadoDatos } from '@/components/formulario'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
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
import { useSesion } from '@/hooks/use-sesion'
import { mensajeDeError } from '@/lib/errores'
import { supabase } from '@/lib/supabase'
import type { Proveedor } from '@/lib/tipos'

export function PaginaProveedores() {
  const { esGerente } = useSesion()
  const [verInactivos, setVerInactivos] = useState(false)
  // null = cerrado · 'nuevo' = alta · Proveedor = edición
  const [editando, setEditando] = useState<Proveedor | 'nuevo' | null>(null)

  const { datos, cargando, error, desdeCopia, recargar } = useConsulta<Proveedor[]>(
    'proveedores',
    () =>
      supabase
        .from('proveedor')
        .select('id, nombre, lead_time_dias, contacto, activo')
        .order('nombre'),
  )
  const proveedores = (datos ?? []).filter((p) => verInactivos || p.activo)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Label className="flex items-center gap-2 font-normal">
          <Checkbox checked={verInactivos} onCheckedChange={(v) => setVerInactivos(v)} />
          Mostrar inactivos
        </Label>
        {esGerente && (
          <Button className="ml-auto" onClick={() => setEditando('nuevo')}>
            <PlusIcon /> Nuevo proveedor
          </Button>
        )}
      </div>

      <EstadoDatos error={error} desdeCopia={desdeCopia} />

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nombre</TableHead>
            <TableHead className="text-right">Plazo de entrega</TableHead>
            <TableHead>Contacto</TableHead>
            <TableHead>Estado</TableHead>
            {esGerente && <TableHead className="w-0" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {proveedores.map((p) => (
            <TableRow key={p.id} className={p.activo ? '' : 'text-muted-foreground'}>
              <TableCell className="font-medium">{p.nombre}</TableCell>
              <TableCell className="text-right">
                {p.lead_time_dias} {p.lead_time_dias === 1 ? 'día' : 'días'}
              </TableCell>
              <TableCell className="whitespace-normal">{p.contacto ?? '—'}</TableCell>
              <TableCell>
                <Badge variant={p.activo ? 'secondary' : 'outline'}>
                  {p.activo ? 'Activo' : 'Inactivo'}
                </Badge>
              </TableCell>
              {esGerente && (
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Editar ${p.nombre}`}
                    onClick={() => setEditando(p)}
                  >
                    <PencilIcon />
                  </Button>
                </TableCell>
              )}
            </TableRow>
          ))}
          {!cargando && proveedores.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground">
                No hay proveedores.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {editando && (
        <FormularioProveedor
          proveedor={editando === 'nuevo' ? null : editando}
          onCerrar={() => setEditando(null)}
          onGuardado={() => {
            setEditando(null)
            void recargar()
          }}
        />
      )}
    </div>
  )
}

function FormularioProveedor({
  proveedor,
  onCerrar,
  onGuardado,
}: {
  proveedor: Proveedor | null
  onCerrar: () => void
  onGuardado: () => void
}) {
  const [nombre, setNombre] = useState(proveedor?.nombre ?? '')
  const [plazo, setPlazo] = useState(String(proveedor?.lead_time_dias ?? 1))
  const [contacto, setContacto] = useState(proveedor?.contacto ?? '')
  const [activo, setActivo] = useState(proveedor?.activo ?? true)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function guardar(evento: FormEvent) {
    evento.preventDefault()
    setGuardando(true)
    setError(null)
    const fila = {
      nombre: nombre.trim(),
      lead_time_dias: Number(plazo),
      contacto: contacto.trim() || null,
      activo,
    }
    const { error } = proveedor
      ? await supabase.from('proveedor').update(fila).eq('id', proveedor.id)
      : await supabase.from('proveedor').insert(fila)
    setGuardando(false)
    if (error) setError(mensajeDeError(error))
    else onGuardado()
  }

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && onCerrar()}>
      <DialogContent>
        <form onSubmit={guardar} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{proveedor ? 'Editar proveedor' : 'Nuevo proveedor'}</DialogTitle>
            <DialogDescription>
              El plazo de entrega se usa para calcular el riesgo de faltante y el pedido sugerido.
            </DialogDescription>
          </DialogHeader>
          <Campo id="prov-nombre" etiqueta="Nombre">
            <Input
              id="prov-nombre"
              required
              autoFocus
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
            />
          </Campo>
          <Campo
            id="prov-plazo"
            etiqueta="Plazo de entrega (días)"
            ayuda="Días entre hacer el pedido y recibirlo."
          >
            <Input
              id="prov-plazo"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              required
              value={plazo}
              onChange={(e) => setPlazo(e.target.value)}
            />
          </Campo>
          <Campo id="prov-contacto" etiqueta="Contacto (opcional)">
            <Input
              id="prov-contacto"
              placeholder="Persona, teléfono o correo"
              value={contacto}
              onChange={(e) => setContacto(e.target.value)}
            />
          </Campo>
          {proveedor && (
            <Label className="flex items-center gap-2 font-normal">
              <Checkbox checked={activo} onCheckedChange={(v) => setActivo(v)} />
              Proveedor activo
            </Label>
          )}
          <ErrorFormulario error={error} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCerrar}>
              Cancelar
            </Button>
            <Button type="submit" disabled={guardando}>
              {guardando ? 'Guardando…' : 'Guardar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
