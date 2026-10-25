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
      {/* Debajo de la barra superior del móvil, para no tapar Alertas ni el menú */}
      <Toaster
        position="top-right"
        offset={{ top: 24, right: 24 }}
        mobileOffset={{ top: 72 }}
        richColors
        closeButton
        expand
        visibleToasts={5}
      />
    </ProveedorSesion>
  </StrictMode>,
)
