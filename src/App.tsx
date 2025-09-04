import { useState } from 'react'
import './App.css'
import { Sidebar } from './components/layout/Sidebar'
import { Header } from './components/layout/Header'
import BridgeForm from './features/bridge/BridgeForm'
import HistoryPage from './features/history/HistoryPage'
import SettingsPage from './features/settings/SettingsPage'

type ChainBalances = {
  [chain: string]: {
    usdc: string
  }
}

type WalletConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'
type WalletConnections = {
  metamask: WalletConnectionStatus
  namada: WalletConnectionStatus
}

function App() {
  const [activeTab, setActiveTab] = useState('bridge')
  const [balances] = useState<ChainBalances>({
    ethereum: { usdc: '1245.80' },
    noble: { usdc: '1245.80' },
    base: { usdc: '890.45' },
    polygon: { usdc: '567.23' }
  })
  const [walletConnections, setWalletConnections] = useState<WalletConnections>({
    metamask: 'disconnected',
    namada: 'disconnected',
  })

  const renderPage = () => {
    switch (activeTab) {
      case 'bridge':
        return <BridgeForm />
      case 'history':
        return <HistoryPage />
      case 'settings':
        return <SettingsPage />
      default:
        return <BridgeForm />
    }
  }

  return (
    <div className="min-h-screen bg-bg-dark">
      <div className="flex">
        <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />
        <div className="flex min-h-screen flex-1 flex-col">
          <Header />
          <main className="mx-auto w-full max-w-5xl p-4">
            {renderPage()}
          </main>
        </div>
      </div>
    </div>
  )
}

export default App
