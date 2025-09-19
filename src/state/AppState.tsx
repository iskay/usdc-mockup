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
  namada: { usdcTransparent: string; usdcShielded: string; namTransparent: string; namShielded: string }
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
  // Extended tracking for bridge/orbiter flows
  stage?: string
  namadaHash?: string
  sepoliaHash?: string
  nobleAckFound?: boolean
  nobleCctpFound?: boolean
  namadaChainId?: string
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

// Allows merging only the specific fields of a chain's balances
type PartialChainBalances = {
  [K in keyof ChainBalances]?: Partial<ChainBalances[K]>
}

type AppAction =
  | { type: 'SET_BALANCES'; payload: ChainBalances }
  | { type: 'MERGE_BALANCES'; payload: PartialChainBalances }
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
    namada: { usdcTransparent: '--', usdcShielded: '--', namTransparent: '--', namShielded: '--' },
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
      shielded: '',
    },
  },
}

function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_BALANCES':
      return { ...state, balances: action.payload }
    case 'MERGE_BALANCES': {
      const partial = action.payload
      const merged: ChainBalances = { ...state.balances } as ChainBalances
      for (const key of Object.keys(partial) as (keyof ChainBalances)[]) {
        // @ts-ignore dynamic merge per-chain
        const existing = state.balances[key] || {}
        // @ts-ignore shallow merge of per-chain object
        merged[key] = { ...existing, ...partial[key] }
      }
      return { ...state, balances: merged }
    }
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


