import React, { useEffect, useRef, useState } from 'react'
import { Button } from '../ui/Button'
import { SidebarButton } from '../ui/SidebarButton'
import { useToast } from '../ui/Toast'
import { useNamadaKeychain } from '../../utils/namada'
import { useAppState } from '../../state/AppState'
import { useNamadaSdk } from '../../state/NamadaSdkProvider'
import { ensureMaspReady, runShieldedSync, clearShieldedContext, type DatedViewingKey } from '../../utils/shieldedSync'
import { fetchBlockHeightByTimestamp } from '../../utils/indexer'

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
  const hasInProgressTx = state.transactions.some(tx => tx.status === 'submitting' || tx.status === 'pending')
  const [openConnect, setOpenConnect] = useState(false)
  const [isShieldedSyncing, setIsShieldedSyncing] = useState(false)
  const [shieldedSyncProgress, setShieldedSyncProgress] = useState<number | null>(null)
  const connectRef = useRef<HTMLDivElement | null>(null)
  const hasAutoReconnected = useRef(false)
  const addressesRef = useRef(state.addresses)
  const { connect: connectNamada, disconnect: disconnectNamada, checkConnection: checkNamada, getDefaultAccount, getAccounts: getNamadaAccounts, isAvailable: isNamadaAvailable } = useNamadaKeychain()

  // Helper: given a transparent account address, find its paired shielded account via parentId
  const resolveShieldedForTransparent = async (transparentAddr?: string): Promise<string | null> => {
    try {
      if (!transparentAddr) return null
      const accounts = (await getNamadaAccounts()) as any[]
      if (!Array.isArray(accounts)) return null
      const parent = accounts.find((a) => a?.address === transparentAddr)
      if (!parent?.id) return null
      const child = accounts.find((a) => (a?.parentId === parent.id) && typeof a?.address === 'string' && String(a?.type || '').toLowerCase().includes('shielded'))
      if (child?.address && child.address.startsWith('z')) return child.address as string
      return null
    } catch {
      return null
    }
  }

  useEffect(() => {
    addressesRef.current = state.addresses
  }, [state.addresses])

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
          showToast({ title: 'MetaMask', message: `Reconnected: ${account.slice(0, 6)}...${account.slice(-4)}`, variant: 'success' })
        } else {
          console.log('No existing MetaMask connection found')
        }
      } catch (error) {
        console.log('Error checking existing MetaMask connection:', error)
      }
    })()

    // Silent Namada reconnect
    ;(async () => {
      try {
        console.log('Checking for existing Namada connection...')
        const available = await isNamadaAvailable()
        if (!available) {
          console.log('Namada extension not available')
          return
        }
        const connected = await checkNamada()
        if (connected) {
          console.log('Found existing Namada connection')
          const acct = await getDefaultAccount()
          dispatch({ type: 'SET_WALLET_CONNECTION', payload: { namada: 'connected' } })
          if (acct?.address) {
            const shielded = await resolveShieldedForTransparent(acct.address)
            dispatch({
              type: 'SET_ADDRESSES',
              payload: {
                ...addressesRef.current,
                namada: { ...addressesRef.current.namada, transparent: acct.address, shielded: shielded || addressesRef.current.namada.shielded },
              },
            })
            console.log('Namada account:', acct, 'Shielded paired:', shielded)
          }
          showToast({ title: 'Namada Keychain', message: 'Reconnected', variant: 'success' })
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
      }
    }

    const handleChainChanged = () => {
      showToast({ title: 'Network Changed', message: 'MetaMask network changed', variant: 'info' })
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
      const available = await isNamadaAvailable()
      if (!available) {
        showToast({ title: 'Namada Keychain', message: 'Please install the Namada Keychain extension', variant: 'error' })
        return
      }
      await connectNamada()
      const connected = await checkNamada()
      if (connected) {
        const acct = await getDefaultAccount()
        dispatch({ type: 'SET_WALLET_CONNECTION', payload: { namada: 'connected' } })
        if (acct?.address) {
          const shielded = await resolveShieldedForTransparent(acct.address)
          dispatch({
            type: 'SET_ADDRESSES',
            payload: {
              ...addressesRef.current,
              namada: { ...addressesRef.current.namada, transparent: acct.address, shielded: shielded || addressesRef.current.namada.shielded },
            },
          })
        }
        showToast({ title: 'Namada Keychain', message: 'Connected', variant: 'success' })
      } else {
        showToast({ title: 'Namada Keychain', message: 'Failed to connect', variant: 'error' })
      }
    } catch (e: any) {
      showToast({ title: 'Namada Keychain', message: e?.message ?? 'Connection failed', variant: 'error' })
    } finally {
      setOpenConnect(false)
    }
  }

  const disconnectNamadaKeychain = async () => {
    try {
      await disconnectNamada()
      dispatch({ type: 'SET_WALLET_CONNECTION', payload: { namada: 'disconnected' } })
      // keep addresses; user may prefer we do not clear namada address automatically
      showToast({ title: 'Namada Keychain', message: 'Disconnected', variant: 'success' })
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


