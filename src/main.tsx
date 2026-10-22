import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AlertasEmergentes } from './components/alertas-emergentes'
import { Toaster } from './components/ui/sonner'
import { ProveedorSesion } from './hooks/use-sesion'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ProveedorSesion>
      <App />
      <AlertasEmergentes />
      <Toaster position="top-right" richColors closeButton expand visibleToasts={5} />
    </ProveedorSesion>
  </StrictMode>,
)
