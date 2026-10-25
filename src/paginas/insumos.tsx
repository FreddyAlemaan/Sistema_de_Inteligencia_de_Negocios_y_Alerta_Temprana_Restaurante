import { useState, type FormEvent } from 'react'
import { PencilIcon, PlusIcon, SearchIcon } from 'lucide-react'
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
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
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
import { formatoCantidad } from '@/lib/formato'
import { supabase } from '@/lib/supabase'
import { NOMBRE_UNIDAD, type Insumo, type Proveedor, type Unidad } from '@/lib/tipos'

const COLUMNAS_INSUMO =
  'id, nombre, unidad, categoria, proveedor_id, dias_alerta_caducidad, vida_util_dias, stock_minimo, activo'

export function PaginaInsumos() {
  const { puede } = useSesion()
  const puedeEditar = puede('catalogos')
  const [busqueda, setBusqueda] = useState('')
  const [verInactivos, setVerInactivos] = useState(false)
  const [editando, setEditando] = useState<Insumo | 'nuevo' | null>(null)

  const insumos = useConsulta<Insumo[]>('insumos', () =>
    supabase.from('insumo').select(COLUMNAS_INSUMO).order('categoria').order('nombre'),
  )
  const proveedores = useConsulta<Proveedor[]>('proveedores', () =>
    supabase
      .from('proveedor')
      .select('id, nombre, lead_time_dias, contacto, activo')
      .order('nombre'),
  )

  const nombreProveedor = new Map((proveedores.datos ?? []).map((p) => [p.id, p.nombre]))
  const categorias = [...new Set((insumos.datos ?? []).map((i) => i.categoria))].sort()
  const texto = busqueda.trim().toLowerCase()
  const visibles = (insumos.datos ?? []).filter(
    (i) =>
      (verInactivos || i.activo) &&
      (!texto ||
        i.nombre.toLowerCase().includes(texto) ||
        i.categoria.toLowerCase().includes(texto)),
  )

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-64">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Buscar insumo"
            placeholder="Buscar por nombre o categoría"
            className="pl-8"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>
        <Label className="flex items-center gap-2 font-normal">
          <Checkbox checked={verInactivos} onCheckedChange={(v) => setVerInactivos(v)} />
          Mostrar inactivos
        </Label>
        {puedeEditar && (
          <Button className="ml-auto" onClick={() => setEditando('nuevo')}>
            <PlusIcon /> Nuevo insumo
          </Button>
        )}
      </div>

      <EstadoDatos error={insumos.error} desdeCopia={insumos.desdeCopia} />

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Insumo</TableHead>
            <TableHead>Categoría</TableHead>
            <TableHead>Proveedor</TableHead>
            <TableHead className="text-right">Vida útil</TableHead>
            <TableHead className="text-right">Avisar caducidad</TableHead>
            <TableHead className="text-right">Stock mínimo</TableHead>
            <TableHead>Estado</TableHead>
            {puedeEditar && <TableHead className="w-0" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {visibles.map((i) => (
            <TableRow key={i.id} className={i.activo ? '' : 'text-muted-foreground'}>
              <TableCell className="font-medium">{i.nombre}</TableCell>
              <TableCell>{i.categoria}</TableCell>
              <TableCell>
                {i.proveedor_id ? (nombreProveedor.get(i.proveedor_id) ?? '—') : '—'}
              </TableCell>
              <TableCell className="text-right">{i.vida_util_dias} d</TableCell>
              <TableCell className="text-right">{i.dias_alerta_caducidad} d antes</TableCell>
              <TableCell className="text-right">
                {formatoCantidad(i.stock_minimo)} {i.unidad}
              </TableCell>
              <TableCell>
                <Badge variant={i.activo ? 'secondary' : 'outline'}>
                  {i.activo ? 'Activo' : 'Inactivo'}
                </Badge>
              </TableCell>
              {puedeEditar && (
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Editar ${i.nombre}`}
                    onClick={() => setEditando(i)}
                  >
                    <PencilIcon />
                  </Button>
                </TableCell>
              )}
            </TableRow>
          ))}
          {!insumos.cargando && visibles.length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="text-center text-muted-foreground">
                {texto ? 'Ningún insumo coincide con la búsqueda.' : 'No hay insumos.'}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {editando && (
        <FormularioInsumo
          insumo={editando === 'nuevo' ? null : editando}
          proveedores={proveedores.datos ?? []}
          categorias={categorias}
          onCerrar={() => setEditando(null)}
          onGuardado={() => {
            setEditando(null)
            void insumos.recargar()
          }}
        />
      )}
    </div>
  )
}


function FormularioInsumo({
  insumo,
  proveedores,
  categorias,
  onCerrar,
  onGuardado,
}: {
  insumo: Insumo | null
  proveedores: Proveedor[]
  categorias: string[]
  onCerrar: () => void
  onGuardado: () => void
}) {
  const [nombre, setNombre] = useState(insumo?.nombre ?? '')
  const [unidad, setUnidad] = useState<Unidad>(insumo?.unidad ?? 'kg')
  const [categoria, setCategoria] = useState(insumo?.categoria ?? '')
  const [proveedorId, setProveedorId] = useState(String(insumo?.proveedor_id ?? ''))
  const [vidaUtil, setVidaUtil] = useState(String(insumo?.vida_util_dias ?? ''))
  const [diasAlerta, setDiasAlerta] = useState(String(insumo?.dias_alerta_caducidad ?? 2))
  const [stockMinimo, setStockMinimo] = useState(String(insumo?.stock_minimo ?? 0))
  const [activo, setActivo] = useState(insumo?.activo ?? true)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // En la lista de proveedores sólo se ofrecen los activos, salvo el ya asignado.
  const opcionesProveedor = proveedores.filter(
    (p) => p.activo || p.id === insumo?.proveedor_id,
  )

  async function guardar(evento: FormEvent) {
    evento.preventDefault()
    setGuardando(true)
    setError(null)
    const fila = {
      nombre: nombre.trim(),
      unidad,
      categoria: categoria.trim(),
      proveedor_id: proveedorId ? Number(proveedorId) : null,
      vida_util_dias: Number(vidaUtil),
      dias_alerta_caducidad: Number(diasAlerta),
      stock_minimo: Number(stockMinimo),
      activo,
    }
    const { error } = insumo
      ? await supabase.from('insumo').update(fila).eq('id', insumo.id)
      : await supabase.from('insumo').insert(fila)
    setGuardando(false)
    if (error) setError(mensajeDeError(error))
    else onGuardado()
  }

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && onCerrar()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <form onSubmit={guardar} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{insumo ? 'Editar insumo' : 'Nuevo insumo'}</DialogTitle>
            <DialogDescription>
              La vida útil y los días de aviso alimentan las reglas de caducidad y sobrestock.
            </DialogDescription>
          </DialogHeader>
          <Campo id="ins-nombre" etiqueta="Nombre">
            <Input
              id="ins-nombre"
              required
              autoFocus
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
            />
          </Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo id="ins-unidad" etiqueta="Unidad">
              <NativeSelect
                id="ins-unidad"
                className="w-full"
                value={unidad}
                onChange={(e) => setUnidad(e.target.value as Unidad)}
              >
                {(Object.keys(NOMBRE_UNIDAD) as Unidad[]).map((u) => (
                  <NativeSelectOption key={u} value={u}>
                    {NOMBRE_UNIDAD[u]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Campo>
            <Campo id="ins-categoria" etiqueta="Categoría">
              <Input
                id="ins-categoria"
                list="categorias-existentes"
                required
                value={categoria}
                onChange={(e) => setCategoria(e.target.value)}
              />
              <datalist id="categorias-existentes">
                {categorias.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Campo>
          </div>
          <Campo id="ins-proveedor" etiqueta="Proveedor habitual">
            <NativeSelect
              id="ins-proveedor"
              className="w-full"
              value={proveedorId}
              onChange={(e) => setProveedorId(e.target.value)}
            >
              <NativeSelectOption value="">Sin proveedor</NativeSelectOption>
              {opcionesProveedor.map((p) => (
                <NativeSelectOption key={p.id} value={String(p.id)}>
                  {p.nombre}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo id="ins-vida" etiqueta="Vida útil (días)" ayuda="Desde que se recibe.">
              <Input
                id="ins-vida"
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                required
                value={vidaUtil}
                onChange={(e) => setVidaUtil(e.target.value)}
              />
            </Campo>
            <Campo
              id="ins-alerta"
              etiqueta="Avisar caducidad (días)"
              ayuda="Días antes de caducar."
            >
              <Input
                id="ins-alerta"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                required
                value={diasAlerta}
                onChange={(e) => setDiasAlerta(e.target.value)}
              />
            </Campo>
          </div>
          <Campo id="ins-minimo" etiqueta={`Stock mínimo (${unidad})`}>
            <Input
              id="ins-minimo"
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              required
              value={stockMinimo}
              onChange={(e) => setStockMinimo(e.target.value)}
            />
          </Campo>
          {insumo && (
            <Label className="flex items-center gap-2 font-normal">
              <Checkbox checked={activo} onCheckedChange={(v) => setActivo(v)} />
              Insumo activo
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
