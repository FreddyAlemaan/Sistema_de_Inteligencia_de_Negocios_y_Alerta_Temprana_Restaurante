import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const clave = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const configuracionCompleta = Boolean(url && clave)

// Si falta el .env la app muestra un aviso en lugar de romperse.
export const supabase = createClient(
  url ?? 'http://configuracion-pendiente.invalid',
  clave ?? 'configuracion-pendiente',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  },
)
