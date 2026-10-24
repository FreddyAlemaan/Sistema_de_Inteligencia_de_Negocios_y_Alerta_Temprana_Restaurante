import {
  BellIcon,
  BookOpenIcon,
  ChartColumnIcon,
  ClipboardPenIcon,
  ConciergeBellIcon,
  HouseIcon,
  ShoppingCartIcon,
  UsersIcon,
  type LucideIcon,
} from 'lucide-react'
import type { Rol } from '@/lib/tipos'

export const SECCIONES = [
  'inicio',
  'alertas',
  'comandas',
  'tablero',
  'pedido',
  'registro',
  'catalogos',
  'perfiles',
] as const
export type Seccion = (typeof SECCIONES)[number]

export interface InfoSeccion {
  etiqueta: string
  icono: LucideIcon
  /** Título grande de la página */
  titulo: string
  /** Para qué sirve, en una frase: que nadie se pierda */
  descripcion: string
}

export const INFO: Record<Seccion, InfoSeccion> = {
  inicio: {
    etiqueta: 'Inicio',
    icono: HouseIcon,
    titulo: 'Hoy en Vila Baleia',
    descripcion: 'Lo que pide atención ahora mismo. Toca cualquier tarjeta para ir directo.',
  },
  alertas: {
    etiqueta: 'Alertas',
    icono: BellIcon,
    titulo: 'Alertas',
    descripcion: 'Avisos del sistema ordenados por gravedad. Atiende cada uno indicando qué se hizo.',
  },
  comandas: {
    etiqueta: 'Comandas',
    icono: ConciergeBellIcon,
    titulo: 'Comandas',
    descripcion: 'Abre la mesa al tomar el pedido, toca "Listo" cuando sale de cocina y "Cerrar" al cobrar.',
  },
  tablero: {
    etiqueta: 'Tablero',
    icono: ChartColumnIcon,
    titulo: 'Tablero de indicadores',
    descripcion: 'Cómo va el restaurante: existencias, pérdidas, proveedores y tiempos de servicio.',
  },
  pedido: {
    etiqueta: 'Pedido',
    icono: ShoppingCartIcon,
    titulo: 'Pedido sugerido',
    descripcion: 'Qué pedir el lunes y cuánto, calculado con el consumo real de cada insumo.',
  },
  registro: {
    etiqueta: 'Registro',
    icono: ClipboardPenIcon,
    titulo: 'Registro de inventario',
    descripcion: 'Anota lo que llega, lo que se usa en cocina y lo que se pierde.',
  },
  catalogos: {
    etiqueta: 'Catálogos',
    icono: BookOpenIcon,
    titulo: 'Catálogos',
    descripcion: 'Insumos y proveedores con los que trabaja el restaurante.',
  },
  perfiles: {
    etiqueta: 'Usuarios',
    icono: UsersIcon,
    titulo: 'Usuarios',
    descripcion: 'Quién usa el sistema y con qué rol.',
  },
}

// Cada rol ve su propio menú, agrupado por tarea. El operativo sólo lo que usa
// a diario; los permisos reales los sigue imponiendo RLS en la base de datos.
export const MENU: Record<Rol, { grupo: string; secciones: Seccion[] }[]> = {
  gerente: [
    { grupo: 'Hoy', secciones: ['inicio', 'alertas', 'comandas'] },
    { grupo: 'Inventario', secciones: ['registro', 'pedido'] },
    { grupo: 'Análisis', secciones: ['tablero'] },
    { grupo: 'Ajustes', secciones: ['catalogos', 'perfiles'] },
  ],
  operativo: [
    { grupo: 'Hoy', secciones: ['inicio', 'alertas', 'comandas'] },
    { grupo: 'Inventario', secciones: ['registro'] },
    { grupo: 'Cuenta', secciones: ['perfiles'] },
  ],
}

export const etiquetaPara = (seccion: Seccion, rol: Rol) =>
  seccion === 'perfiles' && rol === 'operativo' ? 'Mi perfil' : INFO[seccion].etiqueta

/** Navegación mínima por #hash (sin librería de rutas). */
export function irA(seccion: Seccion) {
  window.location.hash = seccion
}

export function leerSeccion(): Seccion {
  const hash = window.location.hash.slice(1)
  return (SECCIONES as readonly string[]).includes(hash) ? (hash as Seccion) : 'inicio'
}
