import React from 'react'

type WalletConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export type ConnectionButtonProps = {
  walletType: string
  connectionStatus: WalletConnectionStatus
  onToggle: () => void
  logoUrl?: string
}

export const ConnectionButton: React.FC<ConnectionButtonProps> = ({
  walletType,
  connectionStatus,
  onToggle,
  logoUrl = '/ethereum-logo.svg'
}) => {
  const isConnected = connectionStatus === 'connected'
  const buttonText = isConnected ? walletType : `Connect`

  return (
    <button
      type="button"
      onClick={onToggle}
      className="inline-flex items-center gap-2 rounded-md font-semibold border border-muted-fg/50 bg-foreground/20 px-3 py-2 text-sm text-foreground hover:bg-foreground/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-green"
    >
      <img src={logoUrl} alt="" className="h-4 w-4" />
      <span>{buttonText}</span>
      {isConnected && (
        <div className="h-2 w-2 rounded-full bg-emerald-400"></div>
      )}
    </button>
  )
}

export default ConnectionButton
