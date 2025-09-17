import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AppProvider } from './state/AppState'
import { ToastProvider, Toaster } from './components/ui/Toast'
import { NamadaSdkProvider } from './state/NamadaSdkProvider'
import { NamadaHealthCheck } from './state/NamadaHealthCheck'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <AppProvider>
        <NamadaSdkProvider>
          <App />
          <Toaster />
          <NamadaHealthCheck />
        </NamadaSdkProvider>
      </AppProvider>
    </ToastProvider>
  </StrictMode>,
)
