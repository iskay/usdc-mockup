export interface GaslessConfig {
  chainId: number
  sellToken: string  // USDC address
  buyToken: string   // Native ETH
  sellAmount: string
  taker: string
  actionsString?: string
  actions?: Array<{
    type: 'contractCall'
    target: string
    calldata: string
    value: string
  }>
}

export interface GaslessPrice {
  buyAmount: string
  minBuyAmount: string
  sellAmount: string
  sellToken: string
  buyToken: string
  fees: {
    gasFee: {
      amount: string
      token: string
      type: string
    }
    zeroExFee: {
      amount: string
      token: string
      type: string
    }
  }
  liquidityAvailable: boolean
  allowanceTarget: string
  issues: {
    allowance: {
      actual: string
      spender: string
    }
  }
}

export interface GaslessQuote {
  tradeHash?: string
  approval?: {
    type: string
    hash: string
    eip712: {
      types: any
      domain: any
      message: any
      primaryType: string
    }
  }
  trade: {
    type: string
    hash: string
    eip712: {
      types: any
      domain: any
      message: any
      primaryType: string
    }
  }
  buyAmount: string
  minBuyAmount: string
  sellAmount: string
  sellToken: string
  buyToken: string
  fees: {
    gasFee: {
      amount: string
      token: string
      type: string
    }
    zeroExFee: {
      amount: string
      token: string
      type: string
    }
  }
  liquidityAvailable: boolean
}

export interface GaslessStatus {
  status: 'pending' | 'confirmed' | 'failed'
  tradeHash: string
  ethReceived?: string
  usdcSwapped?: string
}

export class GaslessApiService {
  private baseUrl: string
  
  constructor() {
    // Use your existing backend for all environments
    this.baseUrl = import.meta.env.VITE_BACKEND_BASE || 'http://localhost:8080'
  }
  
  async getPrice(params: GaslessConfig): Promise<GaslessPrice> {
    const searchParams = new URLSearchParams({
      chainId: params.chainId.toString(),
      sellToken: params.sellToken,
      buyToken: params.buyToken,
      sellAmount: params.sellAmount,
      taker: params.taker,
    })
    
    if (params.actionsString) {
      searchParams.set('actions', params.actionsString)
    } else if (params.actions) {
      searchParams.set('actions', JSON.stringify(params.actions))
    }
    
    const response = await fetch(`${this.baseUrl}/api/gasless/price?${searchParams.toString()}`)
    if (!response.ok) {
      let errorText = ''
      try { 
        const err = await response.json()
        // Backend returns { error: ..., message: "0x API error: ..." }
        errorText = err?.message || err?.error || ''
      } catch {}
      throw new Error(errorText || 'Price fetch failed')
    }
    return response.json()
  }
  
  async getQuote(params: GaslessConfig): Promise<GaslessQuote> {
    const searchParams = new URLSearchParams({
      chainId: params.chainId.toString(),
      sellToken: params.sellToken,
      buyToken: params.buyToken,
      sellAmount: params.sellAmount,
      taker: params.taker,
    })
    
    if (params.actionsString) {
      searchParams.set('actions', params.actionsString)
    } else if (params.actions) {
      searchParams.set('actions', JSON.stringify(params.actions))
    }
    
    const response = await fetch(`${this.baseUrl}/api/gasless/quote?${searchParams.toString()}`)
    if (!response.ok) {
      let errorText = ''
      try { 
        const err = await response.json()
        // Backend returns { error: ..., message: "0x API error: ..." }
        errorText = err?.message || err?.error || ''
      } catch {}
      throw new Error(errorText || 'Quote fetch failed')
    }
    return response.json()
  }
  
  async submitTransaction(payload: any): Promise<{ tradeHash: string }> {
    const response = await fetch(`${this.baseUrl}/api/gasless/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    if (!response.ok) {
      let errorText = ''
      try { 
        const err = await response.json()
        // Backend returns { error: ..., message: "0x API error: ..." }
        errorText = err?.message || err?.error || ''
      } catch {}
      throw new Error(errorText || 'Submit failed')
    }
    return response.json()
  }
  
  async checkStatus(tradeHash: string): Promise<GaslessStatus> {
    const response = await fetch(`${this.baseUrl}/api/gasless/status/${tradeHash}`)
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.message || 'Status check failed')
    }
    return response.json()
  }
}

// Singleton instance
export const gaslessApiService = new GaslessApiService()
