/// <reference types="vite/client" />

// Minimal MetaMask/Ethereum provider typings
declare global {
  interface EthereumProvider {
    isMetaMask?: boolean
    request: (args: { method: string; params?: any[] | object }) => Promise<any>
    on?: (event: string, handler: (...args: any[]) => void) => void
    removeListener?: (event: string, handler: (...args: any[]) => void) => void
  }

  interface Window {
    ethereum?: EthereumProvider
  }
}

export {}
