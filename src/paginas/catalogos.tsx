import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useSesion } from '@/hooks/use-sesion'
import { PaginaInsumos } from '@/paginas/insumos'
import { PaginaProveedores } from '@/paginas/proveedores'

type Pestana = 'insumos' | 'proveedores'

export function PaginaCatalogos() {
  const { esGerente } = useSesion()
  const [pestana, setPestana] = useState<Pestana>('insumos')

  return (
    <Card>
      <CardHeader>
        <CardTitle>Catálogos</CardTitle>
        <CardDescription>
          {esGerente
            ? 'Para dejar de usar un insumo o proveedor, edítalo y desmarca "activo": el historial se conserva.'
            : 'Consulta de insumos y proveedores. Sólo el gerente puede modificarlos.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex gap-1" role="tablist">
          {(['insumos', 'proveedores'] as const).map((p) => (
            <Button
              key={p}
              role="tab"
              aria-selected={pestana === p}
              variant={pestana === p ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setPestana(p)}
            >
              {p === 'insumos' ? 'Insumos' : 'Proveedores'}
            </Button>
          ))}
        </div>
        {pestana === 'insumos' ? <PaginaInsumos /> : <PaginaProveedores />}
      </CardContent>
    </Card>
  )
}
