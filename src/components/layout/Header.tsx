import React from 'react'
import { Button } from '../ui/Button'
import { ConnectionButton } from '../ui/ConnectionButton'
import { useToast } from '../ui/Toast'
import { useAppState } from '../../state/AppState'

export const Header: React.FC = () => {
  const { state, dispatch } = useAppState()
  const { showToast } = useToast()
  return (
    <header className="sticky top-0 z-40 flex h-16 items-center bg-bg-dark justify-end gap-3 px-4">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            showToast({ title: 'Help', message: 'Visit the docs or contact support.', variant: 'info' })
          }
        >
          Help
        </Button>
        <ConnectionButton
          walletType="Metamask"
          connectionStatus={state.walletConnections.metamask}
          onToggle={() =>
            dispatch({
              type: 'SET_WALLET_CONNECTION',
              payload: { metamask: state.walletConnections.metamask === 'connected' ? 'disconnected' : 'connected' },
            })
          }
          logoUrl="/metamask-logo.svg"
        />
        <ConnectionButton
          walletType="Namada Keychain"
          connectionStatus={state.walletConnections.namada}
          onToggle={() =>
            dispatch({
              type: 'SET_WALLET_CONNECTION',
              payload: { namada: state.walletConnections.namada === 'connected' ? 'disconnected' : 'connected' },
            })
          }
          logoUrl="/namada-logo.svg"
        />
      </div>
    </header>
  )
}

export default Header


