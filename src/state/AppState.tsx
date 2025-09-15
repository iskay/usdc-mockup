import React, { createContext, useContext, useMemo, useReducer } from 'react'

export type WalletConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

// Balances per chain. EVM chains have a simple USDC balance.
// Namada has both transparent and shielded balances.
export type ChainBalances = {
  ethereum: { usdc: string }
  base: { usdc: string }
  polygon: { usdc: string }
  arbitrum: { usdc: string }
  sepolia: { usdc: string }
  // kept for backward compatibility in places still using "noble"
  noble?: { usdc: string }
  namada: { usdcTransparent: string; usdcShielded: string }
}

export type WalletConnections = {
  metamask: WalletConnectionStatus
  namada: WalletConnectionStatus
}

export type TxStatus = 'idle' | 'pending' | 'success' | 'error'

export type TransactionPhase = 'submitting' | 'pending' | 'success' | 'error'
export type Transaction = {
  id: string
  kind: 'deposit' | 'send'
  amount: string
  fromChain?: string
  toChain?: string
  destination?: string
  hash?: string
  status: TransactionPhase
  createdAt: number
  updatedAt: number
}

export type AppState = {
  balances: ChainBalances
  walletConnections: WalletConnections
  txStatus: TxStatus
  transactions: Transaction[]
  addresses: {
    ethereum: string
    base: string
    polygon: string
    arbitrum: string
    sepolia: string
    namada: { transparent: string; shielded: string }
  }
}

type AppAction =
  | { type: 'SET_BALANCES'; payload: ChainBalances }
  | { type: 'SET_WALLET_CONNECTIONS'; payload: WalletConnections }
  | { type: 'SET_WALLET_CONNECTION'; payload: Partial<WalletConnections> }
  | { type: 'SET_TX_STATUS'; payload: TxStatus }
  | { type: 'SET_ADDRESSES'; payload: AppState['addresses'] }
  | { type: 'ADD_TRANSACTION'; payload: Transaction }
  | { type: 'UPDATE_TRANSACTION'; payload: { id: string; changes: Partial<Transaction> } }

const initialState: AppState = {
  balances: {
    ethereum: { usdc: '--' },
    base: { usdc: '--' },
    polygon: { usdc: '--' },
    arbitrum: { usdc: '--' },
    sepolia: { usdc: '--' },
    noble: { usdc: '--' },
    namada: { usdcTransparent: '--', usdcShielded: '924.80' },
  },
  walletConnections: {
    metamask: 'disconnected',
    namada: 'disconnected',
  },
  txStatus: 'idle',
  transactions: [],
  addresses: {
    ethereum: '',
    base: '',
    polygon: '',
    arbitrum: '',
    sepolia: '',
    namada: {
      transparent: '',
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
    case 'ADD_TRANSACTION':
      return { ...state, transactions: [action.payload, ...state.transactions] }
    case 'UPDATE_TRANSACTION':
      return {
        ...state,
        transactions: state.transactions.map((tx) =>
          tx.id === action.payload.id ? { ...tx, ...action.payload.changes, updatedAt: Date.now() } : tx
        ),
      }
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


