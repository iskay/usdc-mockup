import { ethers } from 'ethers'

export const USDC_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)'
]

export const TOKEN_MESSENGER_ABI = [
  'function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken) external returns (uint64 nonce)'
]

export type DepositForBurnParams = {
  amountUsdc: string
  forwardingAddressBytes32: string
  usdcAddress: string
  tokenMessengerAddress: string
  destinationDomain: number
}

export type DepositForBurnResult = {
  txHash: string
  nonce?: string
}

export async function depositForBurnSepolia(params: DepositForBurnParams): Promise<DepositForBurnResult> {
  if (!window.ethereum) throw new Error('MetaMask not available')

  console.log('🚀 Starting depositForBurn with params:', {
    amountUsdc: params.amountUsdc,
    forwardingAddressBytes32: params.forwardingAddressBytes32,
    usdcAddress: params.usdcAddress,
    tokenMessengerAddress: params.tokenMessengerAddress,
    destinationDomain: params.destinationDomain
  })

  const provider = new ethers.BrowserProvider(window.ethereum)
  const signer = await provider.getSigner()
  const walletAddress = await signer.getAddress()
  console.log('👤 Wallet address:', walletAddress)

  const amountWei = ethers.parseUnits(params.amountUsdc, 6)
  console.log('💰 Amount in wei:', amountWei.toString())

  const usdc = new ethers.Contract(params.usdcAddress, USDC_ABI, signer)
  const tokenMessenger = new ethers.Contract(params.tokenMessengerAddress, TOKEN_MESSENGER_ABI, signer)

  // Check balance
  console.log('🔍 Checking USDC balance...')
  const balance = await usdc.balanceOf(walletAddress)
  console.log('   Balance:', ethers.formatUnits(balance, 6), 'USDC')
  if (balance < amountWei) {
    throw new Error(`Insufficient USDC balance: have ${ethers.formatUnits(balance, 6)}, need ${params.amountUsdc}`)
  }

  // Check allowance
  console.log('🔍 Checking USDC allowance...')
  const allowance = await usdc.allowance(walletAddress, params.tokenMessengerAddress)
  console.log('   Allowance:', ethers.formatUnits(allowance, 6), 'USDC')
  
  if (allowance < amountWei) {
    console.log('⚠️  Insufficient allowance, approving...')
    try {
      const approveTx = await usdc.approve(params.tokenMessengerAddress, amountWei)
      console.log('   Approve tx hash:', approveTx.hash)
      const approveReceipt = await approveTx.wait()
      console.log('   ✅ Approval confirmed in block:', approveReceipt.blockNumber)
    } catch (err: any) {
      console.error('❌ Approval failed:', err)
      throw new Error(`Approval failed: ${err.message}`)
    }
  } else {
    console.log('✅ Sufficient allowance')
  }

  // Execute depositForBurn
  console.log('🚀 Executing depositForBurn...')
  console.log('   Parameters:')
  console.log('     - amount:', amountWei.toString())
  console.log('     - destinationDomain:', params.destinationDomain)
  console.log('     - mintRecipient:', params.forwardingAddressBytes32)
  console.log('     - burnToken:', params.usdcAddress)

  try {
    const depositTx = await tokenMessenger.depositForBurn(
      amountWei,
      params.destinationDomain,
      params.forwardingAddressBytes32,
      params.usdcAddress
    )
    console.log('📋 Transaction submitted:', depositTx.hash)

    const receipt = await depositTx.wait()
    console.log('✅ Transaction confirmed in block:', receipt.blockNumber)

    let nonce: string | undefined
    try {
      const iface = new ethers.Interface(TOKEN_MESSENGER_ABI)
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog(log)
          if (parsed && parsed.name === 'DepositForBurn') {
            nonce = parsed.args?.nonce?.toString()
            console.log('   Nonce found:', nonce)
            break
          }
        } catch {}
      }
    } catch {}

    return { txHash: depositTx.hash, nonce }
  } catch (err: any) {
    console.error('❌ depositForBurn failed:', err)
    throw new Error(`depositForBurn failed: ${err.message}`)
  }
}


