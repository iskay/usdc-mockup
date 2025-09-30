export interface GaslessError {
  title: string
  message: string
  action?: string
}

export const GaslessErrorMessages: Record<string, GaslessError> = {
  INSUFFICIENT_USDC: {
    title: "Not enough USDC",
    message: "You need at least {amount} USDC to complete this transaction. The system needs some USDC for gas fees and some for the actual transfer.",
    action: "Add more USDC to your wallet or reduce the transfer amount"
  },
  GAS_PRICE_SPIKE: {
    title: "Network congestion detected",
    message: "Gas prices have increased. We're automatically adjusting the amount needed for fees.",
    action: "This may take a moment longer than usual"
  },
  SWAP_FAILED: {
    title: "Gas conversion failed",
    message: "We couldn't convert your USDC to ETH for gas fees. This might be due to network congestion.",
    action: "Try again in a few minutes or consider adding some ETH to your wallet as backup"
  },
  API_KEY_NOT_CONFIGURED: {
    title: "Gas-less transactions unavailable",
    message: "Gas-less transactions are not available at the moment. Please use ETH for gas fees.",
    action: "Try again later or use the traditional ETH gas option"
  },
  INVALID_CHAIN: {
    title: "Unsupported network",
    message: "Gas-less transactions are not supported on this network.",
    action: "Switch to Base, Ethereum, or another supported network"
  },
  INSUFFICIENT_LIQUIDITY: {
    title: "Insufficient liquidity",
    message: "There's not enough liquidity to convert your USDC to ETH at the moment.",
    action: "Try a smaller amount or try again later"
  },
  NETWORK_ERROR: {
    title: "Network error",
    message: "There was a problem connecting to the gas-less service.",
    action: "Check your internet connection and try again"
  }
}

export function getUserFriendlyError(error: any): GaslessError {
  const errorMessage = error?.message || error?.toString() || ''
  
  // Check for specific error patterns
  if (errorMessage.includes('0x API key not configured')) {
    return GaslessErrorMessages.API_KEY_NOT_CONFIGURED
  }
  
  if (errorMessage.includes('Invalid chain ID')) {
    return GaslessErrorMessages.INVALID_CHAIN
  }
  
  if (errorMessage.includes('liquidity')) {
    return GaslessErrorMessages.INSUFFICIENT_LIQUIDITY
  }
  
  if (errorMessage.includes('network') || errorMessage.includes('fetch')) {
    return GaslessErrorMessages.NETWORK_ERROR
  }
  
  if (errorMessage.includes('insufficient') || errorMessage.includes('balance')) {
    return GaslessErrorMessages.INSUFFICIENT_USDC
  }
  
  // Default error
  return {
    title: "Transaction failed",
    message: errorMessage || "An unexpected error occurred during the gas-less transaction.",
    action: "Please try again or contact support if the problem persists"
  }
}

export function formatUsdc(amount: string | number): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount
  return (num / 1e6).toFixed(4)
}

export function formatEth(amount: string | number): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount
  return (num / 1e18).toFixed(6)
}
