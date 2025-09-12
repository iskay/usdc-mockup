import { useState } from 'react'
import './App.css'
import { Header } from './components/layout/Header'
import { Footer } from './components/layout/Footer'
import BridgeForm from './features/bridge/BridgeForm'
import HistoryPage from './features/history/HistoryPage'
import SettingsPage from './features/settings/SettingsPage'
import { CircleBg, PixelBg } from './components/layout/Pixels'

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
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_80%_20%,_#13343f_0%,_#0e2730_50%,_#0c151a_100%)] flex flex-col relative overflow-hidden">
      <Header activeTab={activeTab} onTabChange={setActiveTab} />
      <div className="bg-dot-grid fixed inset-0 z-[1] mt-2" />
      <PixelBg />
      <CircleBg />
      <main className="mx-auto w-full max-w-5xl p-4 pt-12 flex-1 z-[10]">
        {renderPage()}
      </main>
      <Footer />
    </div>
  )
}

export default App
