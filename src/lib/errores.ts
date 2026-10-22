// Traduce los errores de Supabase a mensajes claros para el personal.
export function mensajeDeError(error: unknown): string {
  const texto =
    error instanceof Error
      ? error.message
      : typeof error === 'object' && error && 'message' in error
        ? String((error as { message: unknown }).message)
        : String(error)

  if (/invalid login credentials/i.test(texto)) return 'Correo o contraseña incorrectos.'
  if (/email not confirmed/i.test(texto)) return 'Este correo todavía no está confirmado.'
  if (/failed to fetch|network|fetch failed|load failed/i.test(texto))
    return 'No hay conexión con el servidor. Revisa internet e inténtalo de nuevo.'
  if (/rate limit|too many/i.test(texto)) return 'Demasiados intentos. Espera un momento.'
  if (/row-level security|permission denied/i.test(texto))
    return 'No tienes permiso para hacer esto.'
  if (/al menos un gerente/i.test(texto)) return 'Debe quedar al menos un gerente en el sistema.'
  if (/duplicate key|unique constraint/i.test(texto)) return 'Ya existe un registro con ese nombre.'
  if (/violates check constraint/i.test(texto))
    return 'Algún valor no es válido. Revisa los números y los campos obligatorios.'
  if (/violates foreign key/i.test(texto)) return 'El registro relacionado no existe.'
  return texto || 'Ocurrió un error inesperado.'
}
