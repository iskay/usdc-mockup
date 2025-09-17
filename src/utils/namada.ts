// Namada Keychain connection utilities (modeled after usdc-demo)

export interface NamadaKeychainAccount {
  address: string
  alias?: string
  publicKey?: string
  chainId?: string
  // Optional shielded fields exposed by the extension for ShieldedKeys accounts
  type?: string
  viewingKey?: string
  pseudoExtendedKey?: string
  source?: string
  timestamp?: number
  diversifierIndex?: number
}

export interface Namada {
  accounts(): Promise<readonly NamadaKeychainAccount[] | undefined>
  connect(chainId?: string): Promise<void>
  disconnect(chainId?: string): Promise<void>
  isConnected(chainId?: string): Promise<boolean | undefined>
  defaultAccount(): Promise<NamadaKeychainAccount | undefined>
  updateDefaultAccount(address: string): Promise<void>
  sign(props: any): Promise<Uint8Array[] | undefined>
  signArbitrary(props: any): Promise<any | undefined>
  verify(props: any): Promise<void>
  genDisposableKeypair(): Promise<any | undefined>
  persistDisposableKeypair(props: any): Promise<void>
  clearDisposableKeypair(props: any): Promise<void>
  version: () => string
}

declare global {
  interface Window {
    namada?: Namada
  }
}

class NamadaKeychain {
  private async getNamada(): Promise<Namada | undefined> {
    if (window.namada) return window.namada
    if (document.readyState === 'complete') return window.namada
    return new Promise<Namada | undefined>((resolve) => {
      const handler = (event: Event) => {
        if ((event.target as Document).readyState === 'complete') {
          resolve(window.namada)
          document.removeEventListener('readystatechange', handler)
        }
      }
      document.addEventListener('readystatechange', handler)
    })
  }

  async isAvailable(): Promise<boolean> {
    try {
      const namada = await this.getNamada()
      return !!namada
    } catch {
      return false
    }
  }

  async connect(chainId: string = 'namada'): Promise<void> {
    const namada = await this.getNamada()
    if (!namada) throw new Error('Namada Keychain is not available. Please install the extension.')
    try {
      await namada.connect(chainId)
    } catch (e) {
      throw new Error('Failed to connect to Namada Keychain')
    }
  }

  async disconnect(chainId: string = 'namada'): Promise<void> {
    const namada = await this.getNamada()
    if (!namada) return
    try {
      await namada.disconnect(chainId)
    } catch {
      // ignore
    }
  }

  async isConnected(chainId: string = 'namada'): Promise<boolean> {
    const namada = await this.getNamada()
    if (!namada) return false
    try {
      return !!(await namada.isConnected(chainId))
    } catch {
      return false
    }
  }

  async getAccounts(): Promise<readonly NamadaKeychainAccount[]> {
    const namada = await this.getNamada()
    if (!namada) return []
    try {
      return (await namada.accounts()) || []
    } catch {
      return []
    }
  }

  async getDefaultAccount(): Promise<NamadaKeychainAccount | null> {
    const namada = await this.getNamada()
    if (!namada) return null
    try {
      return (await namada.defaultAccount()) || null
    } catch {
      return null
    }
  }

  async getVersion(): Promise<string | null> {
    const namada = await this.getNamada()
    if (!namada) return null
    try {
      return namada.version()
    } catch {
      return null
    }
  }
}

export const useNamadaKeychain = () => {
  const keychain = new NamadaKeychain()

  const connect = async (chainId: string = 'namada') => keychain.connect(chainId)
  const disconnect = async (chainId: string = 'namada') => keychain.disconnect(chainId)
  const checkConnection = async (chainId: string = 'namada') => keychain.isConnected(chainId)
  const getAccounts = async () => keychain.getAccounts()
  const getDefaultAccount = async () => keychain.getDefaultAccount()
  const isAvailable = async () => keychain.isAvailable()

  return { keychain, connect, disconnect, checkConnection, getAccounts, getDefaultAccount, isAvailable }
}


