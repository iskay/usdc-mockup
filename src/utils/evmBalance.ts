import { ethers } from 'ethers'

// Minimal USDC ERC20 ABI
const USDC_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)'
]

export type SupportedChainKey = 'ethereum' | 'base' | 'polygon' | 'arbitrum' | 'sepolia'

// Known USDC contracts per network (mainnets and testnets)
const NETWORKS: Record<SupportedChainKey, {
  chainIdHex: string
  name: string
  usdcAddress: string
  addChainParams?: {
    chainName: string
    nativeCurrency: { name: string; symbol: string; decimals: number }
    rpcUrls: string[]
    blockExplorerUrls?: string[]
  }
}> = {
  ethereum: {
    chainIdHex: '0x1',
    name: 'Ethereum',
    usdcAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    addChainParams: {
      chainName: 'Ethereum Mainnet',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: ['https://cloudflare-eth.com'],
      blockExplorerUrls: ['https://etherscan.io'],
    },
  },
  base: {
    chainIdHex: '0x2105',
    name: 'Base',
    usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    addChainParams: {
      chainName: 'Base Mainnet',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: ['https://mainnet.base.org'],
      blockExplorerUrls: ['https://basescan.org'],
    },
  },
  polygon: {
    chainIdHex: '0x89',
    name: 'Polygon',
    usdcAddress: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
    addChainParams: {
      chainName: 'Polygon Mainnet',
      nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 },
      rpcUrls: ['https://polygon-rpc.com', 'https://polygon.llamarpc.com'],
      blockExplorerUrls: ['https://polygonscan.com'],
    },
  },
  arbitrum: {
    chainIdHex: '0xa4b1',
    name: 'Arbitrum One',
    usdcAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    addChainParams: {
      chainName: 'Arbitrum One',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: ['https://arb1.arbitrum.io/rpc'],
      blockExplorerUrls: ['https://arbiscan.io'],
    },
  },
  sepolia: {
    chainIdHex: '0xaa36a7',
    name: 'Sepolia',
    usdcAddress: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', // USDC on Sepolia
    addChainParams: {
      chainName: 'Sepolia',
      nativeCurrency: { name: 'Sepolia Ether', symbol: 'SEPETH', decimals: 18 },
      rpcUrls: ['https://rpc.sepolia.org'],
      blockExplorerUrls: ['https://sepolia.etherscan.io'],
    },
  },
}

export async function getCurrentChainIdHex(): Promise<string> {
  if (!window.ethereum) throw new Error('MetaMask not available')
  const chainId: string = await window.ethereum.request({ method: 'eth_chainId' })
  console.debug('[EVM] eth_chainId ->', chainId)
  return chainId
}

export function getNetworkByKey(key: string) {
  return (NETWORKS as Record<string, (typeof NETWORKS)[SupportedChainKey]>)[key]
}

export async function fetchUsdcBalanceForSelectedChain(
  chainKey: string,
  accountAddress: string,
): Promise<{ formattedBalance: string; symbol: string; networkName: string }> {
  if (!window.ethereum) throw new Error('MetaMask not available')

  // Validate address format
  if (!accountAddress || accountAddress.length < 42 || !accountAddress.startsWith('0x')) {
    throw new Error(`Invalid address: ${accountAddress}`)
  }

  const network = getNetworkByKey(chainKey)
  if (!network) throw new Error(`Unsupported chain: ${chainKey}`)

  const currentChainId = await getCurrentChainIdHex()
  console.debug('[EVM] Selected chain:', chainKey, 'Expected chainIdHex:', network.chainIdHex, 'Current:', currentChainId)
  if (currentChainId.toLowerCase() !== network.chainIdHex.toLowerCase()) {
    console.warn('[EVM] Chain mismatch. Attempting auto-switch to', network.chainIdHex)
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: network.chainIdHex }],
      })
    } catch (switchError: any) {
      console.warn('[EVM] wallet_switchEthereumChain failed:', switchError)
      // 4902: Unrecognized chain ID
      const needsAdd = switchError?.code === 4902 || /unrecognized|not added/i.test(String(switchError?.message ?? ''))
      if (needsAdd && network.addChainParams) {
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: network.chainIdHex,
              chainName: network.addChainParams.chainName,
              nativeCurrency: network.addChainParams.nativeCurrency,
              rpcUrls: network.addChainParams.rpcUrls,
              blockExplorerUrls: network.addChainParams.blockExplorerUrls,
            }],
          })
          // try switching again after adding
          await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: network.chainIdHex }] })
        } catch (addErr) {
          console.error('[EVM] wallet_addEthereumChain failed:', addErr)
          throw new Error(`Unable to add/switch to ${network.name}. Please switch manually in MetaMask.`)
        }
      } else {
        throw new Error(`Please switch MetaMask to ${network.name} (expected ${network.chainIdHex}, got ${currentChainId})`)
      }
    }

    // Re-check after attempted switch
    const afterChainId = await getCurrentChainIdHex()
    console.debug('[EVM] After switch, chainId:', afterChainId)
    if (afterChainId.toLowerCase() !== network.chainIdHex.toLowerCase()) {
      throw new Error(`Network switch to ${network.name} did not take effect (expected ${network.chainIdHex}, got ${afterChainId})`)
    }
  }

  const provider = new ethers.BrowserProvider(window.ethereum)
  try {
    const net = await provider.getNetwork()
    // ethers v6 returns bigint chainId
    console.debug('[EVM] Provider.getNetwork():', { chainId: net.chainId.toString(), name: net.name })
  } catch (e) {
    console.debug('[EVM] provider.getNetwork() failed:', e)
  }
  const usdc = new ethers.Contract(network.usdcAddress, USDC_ABI, provider)
  const [rawBalance, decimals, symbol] = await Promise.all([
    usdc.balanceOf(accountAddress),
    usdc.decimals(),
    usdc.symbol(),
  ])
  const raw = Number(ethers.formatUnits(rawBalance, decimals))
  const formattedBalance = (raw === 0 ? 0 : raw).toFixed(2)
  return { formattedBalance, symbol, networkName: network.name }
}


