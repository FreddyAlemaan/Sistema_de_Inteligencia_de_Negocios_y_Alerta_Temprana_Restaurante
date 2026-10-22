export type Rol = 'gerente' | 'operativo'

export interface Perfil {
  id: string
  nombre: string
  rol: Rol
  creado_en: string
}

export const NOMBRE_ROL: Record<Rol, string> = {
  gerente: 'Gerente',
  operativo: 'Operativo',
}

export interface Proveedor {
  id: number
  nombre: string
  lead_time_dias: number
  contacto: string | null
  activo: boolean
}

export type Unidad = 'kg' | 'l' | 'ud'

export const NOMBRE_UNIDAD: Record<Unidad, string> = {
  kg: 'Kilogramos (kg)',
  l: 'Litros (l)',
  ud: 'Unidades (ud)',
}

export interface Existencia {
  insumo_id: number
  existencia: number
  existencia_caducada: number
  lotes_con_stock: number
  proxima_caducidad: string | null
  dias_a_caducidad: number | null
  bajo_minimo: boolean
}

export type TipoMovimiento = 'ENTRADA' | 'CONSUMO' | 'MERMA'

export const NOMBRE_TIPO: Record<TipoMovimiento, string> = {
  ENTRADA: 'Recepción',
  CONSUMO: 'Consumo',
  MERMA: 'Merma',
}

export interface Movimiento {
  id: number
  insumo_id: number
  lote_id: number | null
  tipo: TipoMovimiento
  cantidad: number
  motivo: string | null
  fecha: string
  usuario_id: string | null
}

export type Severidad = 'BAJA' | 'MEDIA' | 'ALTA'
export type EstadoAlerta = 'ABIERTA' | 'ATENDIDA' | 'SUPRIMIDA'

export interface Alerta {
  id: number
  regla_id: number
  tipo: string
  entidad_tipo: 'lote' | 'insumo' | 'proveedor' | 'comanda'
  entidad_id: number
  valor: number | null
  umbral: number | null
  severidad: Severidad
  estado: EstadoAlerta
  mensaje: string
  creada_en: string
  atendida_por: string | null
  atendida_en: string | null
  accion_tomada: string | null
}

export const NOMBRE_TIPO_ALERTA: Record<string, string> = {
  CADUCIDAD: 'Caducidad próxima',
  FALTANTE: 'Riesgo de faltante',
  PROVEEDOR: 'Proveedor poco confiable',
  FALTANTE_CRITICO: 'Faltante crítico',
  SOBRESTOCK: 'Sobrestock',
  SOBRECOMPRA: 'Sobrecompra',
}

export interface ResumenMotor {
  iteraciones: number
  hechos_nuevos: number
  hechos_retractados: number
  hechos_vigentes: number
  alertas_emitidas: number
  alertas_suprimidas: number
  mermas_automaticas: number
  activaciones: { iteracion: number; regla: string; entidad: string; severidad: Severidad }[]
}

export interface Insumo {
  id: number
  nombre: string
  unidad: Unidad
  categoria: string
  proveedor_id: number | null
  dias_alerta_caducidad: number
  vida_util_dias: number
  stock_minimo: number
  activo: boolean
}
