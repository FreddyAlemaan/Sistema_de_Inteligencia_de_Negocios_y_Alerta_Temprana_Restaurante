import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { mensajeDeError } from '@/lib/errores'
import { supabase } from '@/lib/supabase'

export function PaginaInicioSesion() {
  const [correo, setCorreo] = useState('')
  const [contrasena, setContrasena] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function entrar(evento: FormEvent) {
    evento.preventDefault()
    setEnviando(true)
    setError(null)
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: correo.trim(),
        password: contrasena,
      })
      if (error) setError(mensajeDeError(error))
    } catch (e) {
      setError(mensajeDeError(e))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">SIN&amp;AT</CardTitle>
          <CardDescription>Vila Baleia · Alerta temprana</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={entrar} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="correo">Correo</Label>
              <Input
                id="correo"
                type="email"
                autoComplete="username"
                required
                autoFocus
                value={correo}
                onChange={(e) => setCorreo(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="contrasena">Contraseña</Label>
              <Input
                id="contrasena"
                type="password"
                autoComplete="current-password"
                required
                value={contrasena}
                onChange={(e) => setContrasena(e.target.value)}
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" size="lg" disabled={enviando}>
              {enviando ? 'Entrando…' : 'Entrar'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
