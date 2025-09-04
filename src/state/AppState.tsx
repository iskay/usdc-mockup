import React, { createContext, useContext, useMemo, useReducer } from 'react'

export type WalletConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

// Balances per chain. EVM chains have a simple USDC balance.
// Namada has both transparent and shielded balances.
export type ChainBalances = {
  ethereum: { usdc: string }
  base: { usdc: string }
  polygon: { usdc: string }
  arbitrum: { usdc: string }
  // kept for backward compatibility in places still using "noble"
  noble?: { usdc: string }
  namada: { usdcTransparent: string; usdcShielded: string }
}

export type WalletConnections = {
  metamask: WalletConnectionStatus
  namada: WalletConnectionStatus
}

export type TxStatus = 'idle' | 'pending' | 'success' | 'error'

export type AppState = {
  balances: ChainBalances
  walletConnections: WalletConnections
  txStatus: TxStatus
  addresses: {
    ethereum: string
    base: string
    polygon: string
    arbitrum: string
    namada: { transparent: string; shielded: string }
  }
}

type AppAction =
  | { type: 'SET_BALANCES'; payload: ChainBalances }
  | { type: 'SET_WALLET_CONNECTIONS'; payload: WalletConnections }
  | { type: 'SET_WALLET_CONNECTION'; payload: Partial<WalletConnections> }
  | { type: 'SET_TX_STATUS'; payload: TxStatus }
  | { type: 'SET_ADDRESSES'; payload: AppState['addresses'] }

const initialState: AppState = {
  balances: {
    ethereum: { usdc: '1245.80' },
    base: { usdc: '890.45' },
    polygon: { usdc: '567.23' },
    arbitrum: { usdc: '342.11' },
    noble: { usdc: '1245.80' },
    namada: { usdcTransparent: '321.00', usdcShielded: '924.80' },
  },
  walletConnections: {
    metamask: 'disconnected',
    namada: 'disconnected',
  },
  txStatus: 'idle',
  addresses: {
    ethereum: '0x9F3537C9C0A2cA1B7C0cF2F7b0D0d176762AE8f1',
    base: '0x9F3537C9C0A2cA1B7C0cF2F7b0D0d176762AE8f1',
    polygon: '0x9F3537C9C0A2cA1B7C0cF2F7b0D0d176762AE8f1',
    arbitrum: '0x9F3537C9C0A2cA1B7C0cF2F7b0D0d176762AE8f1',
    namada: {
      transparent: 'tnam1qrv5y9p4u7t0z9s8x3k4hd2l6m8n0p2q4r6s8t',
      shielded: 'znam1z8y7x6w5v4u3t2s1r0q9p8o7n6m5l4k3j2h1g',
    },
  },
}

function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_BALANCES':
      return { ...state, balances: action.payload }
    case 'SET_WALLET_CONNECTIONS':
      return { ...state, walletConnections: action.payload }
    case 'SET_WALLET_CONNECTION':
      return { ...state, walletConnections: { ...state.walletConnections, ...action.payload } }
    case 'SET_TX_STATUS':
      return { ...state, txStatus: action.payload }
    case 'SET_ADDRESSES':
      return { ...state, addresses: action.payload }
    default:
      return state
  }
}

const AppStateContext = createContext<{
  state: AppState
  dispatch: React.Dispatch<AppAction>
} | null>(null)

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(reducer, initialState)
  const value = useMemo(() => ({ state, dispatch }), [state])
  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
}

export function useAppState() {
  const ctx = useContext(AppStateContext)
  if (!ctx) throw new Error('useAppState must be used within AppProvider')
  return ctx
}


