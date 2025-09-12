import React, { useEffect, useRef, useState } from 'react'
import { Button } from '../ui/Button'
import { SidebarButton } from '../ui/SidebarButton'
import { useToast } from '../ui/Toast'
import { useAppState } from '../../state/AppState'

type NavItem = { label: string; icon: string; key: string }

const nav: NavItem[] = [
  { label: 'Deposit/Send', icon: '/rocket.svg', key: 'bridge' },
  { label: 'My Transactions', icon: '/history.svg', key: 'history' },
  // { label: 'Settings', icon: 'fas fa-cog', key: 'settings' },
]

export type HeaderProps = {
  activeTab: string
  onTabChange: (tab: string) => void
}

export const Header: React.FC<HeaderProps> = ({ activeTab, onTabChange }) => {
  const { state, dispatch } = useAppState()
  const { showToast } = useToast()
  const hasInProgressTx = state.transactions.some(tx => tx.status === 'submitting' || tx.status === 'pending')
  const [openConnect, setOpenConnect] = useState(false)
  const connectRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (connectRef.current && !connectRef.current.contains(e.target as Node)) {
        setOpenConnect(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  return (
    <header className="sticky top-0 z-40 flex h-20 items-center bg-header-bg justify-between px-16 border-b-2 border-header-border">
      {/* Left side - Logo and Navigation */}
      <div className="flex items-center justify-between gap-8 w-full">
        <div className="flex items-center gap-3 text-lg text-title font-bold">
          <div className="w-8 h-8 bg-[#e7bc59] flex justify-center items-center rounded-md">
            <div className="w-4 h-4 bg-[#01daab] rounded-sm"></div>
          </div>
          <span className="text-xl">USDC.delivery</span>
          <div className="ml-2 font-normal text-xs text-header-bg bg-[#b4a744] px-2 py-1 rounded-full">v0.1</div>
        </div>
        <nav className="flex items-center gap-2">
          <Button
            variant="help"
            size="xs"
            onClick={() =>
              showToast({ title: 'Help', message: 'Visit the docs or contact support.', variant: 'info' })
            }
          >
            Help
          </Button>
                      {nav.map((n) => {
              const isHistory = n.key === 'history'
              const isActive = activeTab === n.key
              const iconStyle: React.CSSProperties = {
                WebkitMaskImage: `url(${n.icon})`,
                maskImage: `url(${n.icon})`,
                WebkitMaskRepeat: 'no-repeat',
                maskRepeat: 'no-repeat',
                WebkitMaskPosition: 'center',
                maskPosition: 'center',
                WebkitMaskSize: 'contain',
                maskSize: 'contain',
              }
              const iconElement = (
                <span
                  style={iconStyle}
                  className={`inline-block h-6 w-6 bg-current ${isHistory && hasInProgressTx ? 'animate-bounce' : ''} ${isActive ? 'text-button-text-active' : 'text-button-text-inactive'}`}
                />
              )

              return (
                <SidebarButton
                  key={n.key}
                  text={n.label}
                  icon={iconElement}
                  active={activeTab === n.key}
                  onClick={() => onTabChange(n.key)}
                />
              )
            })}

          {/* Connect dropdown */}
          <div className="relative" ref={connectRef}>
            <button
              type="button"
              onClick={() => setOpenConnect((v) => !v)}
              className="flex items-center gap-3 rounded-2xl px-6 py-2 text-md font-medium transition-colors bg-button-inactive text-button-text-inactive border border-button-text-inactive"
            >
              <i className="fa-solid fa-plug text-lg" />
              <span>Connect</span>
              <span className="text-md">▾</span>
            </button>
            {openConnect ? (
              <div className="absolute right-0 mt-2 w-56 rounded-xl border border-button-text-inactive bg-button-inactive text-button-text-inactive p-1 shadow-lg z-50">
                <button
                  type="button"
                  onClick={() => {
                    dispatch({
                      type: 'SET_WALLET_CONNECTION',
                      payload: { metamask: state.walletConnections.metamask === 'connected' ? 'disconnected' : 'connected' },
                    })
                    setOpenConnect(false)
                  }}
                  className="flex w-full items-center justify-between gap-3 rounded-xl px-2 py-2 text-left text-sm hover:bg-button-active/10"
                >
                  <span className="inline-flex items-center gap-2">
                    <img src="/metamask-logo.svg" alt="" className="h-4 w-4" />
                    <span>Metamask</span>
                  </span>
                  {state.walletConnections.metamask === 'connected' ? (
                    <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  ) : null}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    dispatch({
                      type: 'SET_WALLET_CONNECTION',
                      payload: { namada: state.walletConnections.namada === 'connected' ? 'disconnected' : 'connected' },
                    })
                    setOpenConnect(false)
                  }}
                  className="flex w-full items-center justify-between gap-3 rounded-xl px-2 py-2 text-left text-sm hover:bg-button-active/10"
                >
                  <span className="inline-flex items-center gap-2">
                    <img src="/namada-logo.svg" alt="" className="h-4 w-4" />
                    <span>Namada Keychain</span>
                  </span>
                  {state.walletConnections.namada === 'connected' ? (
                    <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  ) : null}
                </button>
              </div>
            ) : null}
          </div>
        </nav>
      </div>
    </header>
  )
}

export default Header


