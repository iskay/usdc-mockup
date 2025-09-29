import React, { useEffect, useRef, useState } from 'react'
import { Button } from '../ui/Button'
import { SidebarButton } from '../ui/SidebarButton'
import { useToast } from '../ui/Toast'
import { useNamadaKeychain } from '../../utils/namada'
import { useAppState } from '../../state/AppState'
import { useNamadaSdk } from '../../state/NamadaSdkProvider'
import { useBalanceService } from '../../services/balanceService'
import { connectNamadaAction } from '../../features/bridge/services/bridgeActions'

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
  const { sdk, rpc, isReady } = useNamadaSdk()
  const { fetchBalances } = useBalanceService()
  const hasInProgressTx = state.transactions.some(tx => tx.status === 'submitting' || tx.status === 'pending')
  const [openConnect, setOpenConnect] = useState(false)
  const connectRef = useRef<HTMLDivElement | null>(null)
  const hasAutoReconnected = useRef(false)
  const addressesRef = useRef(state.addresses)
  const stateRef = useRef(state)
  const { connect: connectNamada, disconnect: disconnectNamada, checkConnection: checkNamada, getDefaultAccount, getAccounts: getNamadaAccounts, isAvailable: isNamadaAvailable } = useNamadaKeychain()


  useEffect(() => {
    addressesRef.current = state.addresses
    stateRef.current = state
  }, [state.addresses, state])

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (connectRef.current && !connectRef.current.contains(e.target as Node)) {
        setOpenConnect(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  // --- MetaMask + Namada integration ---
  useEffect(() => {
    if (hasAutoReconnected.current) return

    // Silent MetaMask reconnect
    ;(async () => {
      try {
        if (!window.ethereum) return
        console.log('Checking for existing MetaMask connection...')
        const accounts: string[] = await window.ethereum!.request({ method: 'eth_accounts' })
        console.log('MetaMask accounts found:', accounts)
        if (accounts && accounts.length > 0) {
          const account = accounts[0]
          console.log('MetaMask account:', account)
          console.log('Current addressesRef.current before dispatch:', addressesRef.current)
          dispatch({ type: 'SET_WALLET_CONNECTION', payload: { metamask: 'connected' } })
          const newAddresses = {
            ...addressesRef.current,
            ethereum: account,
            base: account,
            sepolia: account,
          }
          console.log('Dispatching SET_ADDRESSES with:', newAddresses)
          dispatch({
            type: 'SET_ADDRESSES',
            payload: newAddresses,
          })
          showToast({ title: 'MetaMask', message: `Reconnected: ${account.slice(0, 6)}...${account.slice(-4)}`, variant: 'success' })
          try { void fetchBalances({ kinds: ['evmUsdc'], delayMs: 250 }) } catch {}
        } else {
          console.log('No existing MetaMask connection found')
        }
      } catch (error) {
        console.log('Error checking existing MetaMask connection:', error)
      }
    })()

    // Silent Namada reconnect (wait for MetaMask to complete first)
    ;(async () => {
      try {
        // Wait a bit for MetaMask reconnect to complete
        await new Promise(resolve => setTimeout(resolve, 100))
        
        console.log('Checking for existing Namada connection...')
        const available = await isNamadaAvailable()
        if (!available) {
          console.log('Namada extension not available')
          return
        }
        
        // Fetch chain ID directly from RPC to avoid SDK initialization dependency
        const rpcUrl = import.meta.env.VITE_NAMADA_RPC_URL || 'https://rpc.testnet.siuuu.click'
        const response = await fetch(`${rpcUrl}/status`)
        if (!response.ok) {
          console.log('Failed to fetch chain ID from RPC')
          return
        }
        const data = await response.json()
        const chainId = data?.result?.node_info?.network
        if (!chainId) {
          console.log('Could not extract chain ID from RPC response')
          return
        }
        
        const connected = await checkNamada(chainId)
        if (connected) {
          console.log('Found existing Namada connection')
          await connectNamadaAction(
            { sdk, state, dispatch, showToast, getNamadaAccounts, getCurrentState: () => stateRef.current },
            {
              onSuccess: () => {
                showToast({ title: 'Namada Keychain', message: 'Reconnected', variant: 'success' })
                try { void fetchBalances({ kinds: ['namadaTransparentUsdc','namadaTransparentNam'], delayMs: 300 }) } catch {}
              }
            }
          )
        } else {
          console.log('No existing Namada connection found')
        }
      } catch (e) {
        console.log('Error checking existing Namada connection:', e)
      }
    })()

    hasAutoReconnected.current = true

    const handleAccountsChanged = (accounts: string[]) => {
      if (!accounts || accounts.length === 0) {
        dispatch({ type: 'SET_WALLET_CONNECTION', payload: { metamask: 'disconnected' } })
        dispatch({
          type: 'SET_ADDRESSES',
          payload: {
            ...addressesRef.current,
            ethereum: '',
            base: '',
            sepolia: '',
          },
        })
        // Clear EVM balances when accounts are disconnected
        dispatch({
          type: 'SET_BALANCES',
          payload: {
            ...state.balances,
            ethereum: { usdc: '--' },
            base: { usdc: '--' },
            sepolia: { usdc: '--' },
            polygon: { usdc: '--' },
            arbitrum: { usdc: '--' },
          },
        })
        showToast({ title: 'MetaMask', message: 'Disconnected', variant: 'warning' })
      } else {
        const account = accounts[0]
        dispatch({ type: 'SET_WALLET_CONNECTION', payload: { metamask: 'connected' } })
        dispatch({
          type: 'SET_ADDRESSES',
          payload: {
            ...addressesRef.current,
            ethereum: account,
            base: account,
            sepolia: account,
          },
        })
        showToast({ title: 'MetaMask', message: `Account: ${account.slice(0, 6)}...${account.slice(-4)}`, variant: 'info' })
        try { void fetchBalances({ kinds: ['evmUsdc'], delayMs: 200 }) } catch {}
      }
    }

    const handleChainChanged = () => {
      showToast({ title: 'Network Changed', message: 'MetaMask network changed', variant: 'info' })
      try { void fetchBalances({ kinds: ['evmUsdc'], delayMs: 300 }) } catch {}
    }

    window.ethereum?.on?.('accountsChanged', handleAccountsChanged)
    window.ethereum?.on?.('chainChanged', handleChainChanged)

    return () => {
      window.ethereum?.removeListener?.('accountsChanged', handleAccountsChanged)
      window.ethereum?.removeListener?.('chainChanged', handleChainChanged)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const connectMetaMask = async () => {
    try {
      if (!window.ethereum) {
        showToast({ title: 'MetaMask Not Found', message: 'Please install the MetaMask extension', variant: 'error' })
        return
      }
      dispatch({ type: 'SET_WALLET_CONNECTION', payload: { metamask: 'connecting' } })
      const accounts: string[] = await window.ethereum.request({ method: 'eth_requestAccounts' })
      if (accounts && accounts.length > 0) {
        const account = accounts[0]
        dispatch({ type: 'SET_WALLET_CONNECTION', payload: { metamask: 'connected' } })
        dispatch({
          type: 'SET_ADDRESSES',
          payload: {
            ...addressesRef.current,
            ethereum: account,
            base: account,
            sepolia: account,
          },
        })
        showToast({ title: 'MetaMask Connected', message: `Connected: ${account.slice(0, 6)}...${account.slice(-4)}`, variant: 'success' })
      } else {
        dispatch({ type: 'SET_WALLET_CONNECTION', payload: { metamask: 'disconnected' } })
      }
    } catch (err: any) {
      dispatch({ type: 'SET_WALLET_CONNECTION', payload: { metamask: 'error' } })
      showToast({ title: 'Connection Failed', message: err?.message ?? 'Unable to connect MetaMask', variant: 'error' })
    } finally {
      setOpenConnect(false)
    }
  }

  const disconnectMetaMask = async () => {
    try {
      if (window.ethereum) {
        try {
          await window.ethereum.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] as any })
          showToast({ title: 'MetaMask', message: 'Disconnected from app', variant: 'success' })
        } catch {
          showToast({ title: 'MetaMask', message: 'Disconnected locally (revoke not supported)', variant: 'info' })
        }
      }
    } finally {
      dispatch({ type: 'SET_WALLET_CONNECTION', payload: { metamask: 'disconnected' } })
      dispatch({
        type: 'SET_ADDRESSES',
        payload: {
          ...addressesRef.current,
          ethereum: '',
          base: '',
          sepolia: '',
        },
      })
      // Clear EVM balances when disconnecting
      dispatch({
        type: 'SET_BALANCES',
        payload: {
          ...state.balances,
          ethereum: { usdc: '--' },
          base: { usdc: '--' },
          sepolia: { usdc: '--' },
          polygon: { usdc: '--' },
          arbitrum: { usdc: '--' },
        },
      })
      setOpenConnect(false)
    }
  }

  const handleToggleMetaMask = () => {
    if (state.walletConnections.metamask === 'connected') {
      void disconnectMetaMask()
    } else {
      void connectMetaMask()
    }
  }

  const connectNamadaKeychain = async () => {
    try {
      await connectNamadaAction(
        { sdk, state, dispatch, showToast, getNamadaAccounts, getCurrentState: () => stateRef.current },
        {
          onSuccess: () => {
            try { void fetchBalances({ kinds: ['namadaTransparentUsdc','namadaTransparentNam'], delayMs: 500 }) } catch {}
          }
        }
      )
    } finally {
      setOpenConnect(false)
    }
  }

  const disconnectNamadaKeychain = async () => {
    try {
      await disconnectNamada()
      dispatch({ type: 'SET_WALLET_CONNECTION', payload: { namada: 'disconnected' } })
      // Clear Namada addresses to prevent balance service from fetching for old addresses
      dispatch({
        type: 'SET_ADDRESSES',
        payload: {
          ...addressesRef.current,
          namada: { transparent: '', shielded: '' },
        },
      })
      showToast({ title: 'Namada Keychain', message: 'Disconnected', variant: 'success' })
      // Reset all Namada balances on disconnect
      dispatch({ type: 'MERGE_BALANCES', payload: { namada: { usdcTransparent: '--', namTransparent: '--', usdcShielded: '--', namShielded: '--' } } })
    } catch {}
  }

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
              <i className={`text-lg ${state.walletConnections.metamask === 'connected' && state.walletConnections.namada === 'connected' ? 'fa-solid fa-plug-circle-check' : 'fa-solid fa-plug'}`} />
              <span>Connect</span>
              <span className="text-md">▾</span>
            </button>
            {openConnect ? (
              <div className="absolute right-0 mt-2 w-56 rounded-xl border border-button-text-inactive bg-button-inactive text-button-text-inactive p-1 shadow-lg z-50">
                <button
                  type="button"
                  onClick={handleToggleMetaMask}
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
                    if (state.walletConnections.namada === 'connected') {
                      void disconnectNamadaKeychain()
                    } else {
                      void connectNamadaKeychain()
                    }
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


