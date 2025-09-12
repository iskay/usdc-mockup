import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AppProvider } from './state/AppState'
import { ToastProvider, Toaster } from './components/ui/Toast'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <AppProvider>
        <App />
        <Toaster />
      </AppProvider>
    </ToastProvider>
  </StrictMode>,
)
