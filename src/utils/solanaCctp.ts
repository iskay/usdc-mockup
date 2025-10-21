// Solana CCTP: Build depositForBurn instruction and send transaction

export type SolanaDepositForBurnParams = {
  rpcUrl: string
  ownerPubkeyBase58: string
  amountUsdcDisplay: string // e.g., '1.23'
  mintRecipientHex32: `0x${string}` // 32-byte hex for Noble forwarding address
  destinationDomain: number // Noble=4 for mainnet
}

export type BuiltInstruction = {
  programId: string
  keys: { pubkey: string; isSigner: boolean; isWritable: boolean }[]
  data: number[]
}

export type BuildDepositForBurnResult = {
  instructions: BuiltInstruction[]
  eventAccount: string
  eventAccountSecret: number[]
  rentCostLamports: number
  simLogs?: string[]
  simErr?: any
}

export async function buildSolanaDepositForBurn(params: SolanaDepositForBurnParams): Promise<BuildDepositForBurnResult> {
  const { Connection, PublicKey, Keypair, SystemProgram, Transaction } = await import('@solana/web3.js')
  const bs58 = await import('bs58')

  const { SOLANA_MAINNET } = await import('../config/solana')

  const connection = new Connection(params.rpcUrl as any, { commitment: 'confirmed' })
  const owner = new PublicKey(params.ownerPubkeyBase58)
  const TOKEN_MESSENGER_MINTER_PROGRAM = new PublicKey(SOLANA_MAINNET.contracts.tokenMessengerMinter)
  const MESSAGE_TRANSMITTER_PROGRAM = new PublicKey(SOLANA_MAINNET.contracts.messageTransmitter)
  const USDC_MINT = new PublicKey(SOLANA_MAINNET.contracts.usdc)

  const amountMicroUsdc = BigInt(Math.round(Number(params.amountUsdcDisplay) * 1e6))

  // Derive PDAs (mirrors usdc.delivery)
  const [tokenMessenger] = PublicKey.findProgramAddressSync([Buffer.from('token_messenger')], TOKEN_MESSENGER_MINTER_PROGRAM)
  const [messageTransmitter] = PublicKey.findProgramAddressSync([Buffer.from('message_transmitter')], MESSAGE_TRANSMITTER_PROGRAM)
  const [tokenMinter] = PublicKey.findProgramAddressSync([Buffer.from('token_minter')], TOKEN_MESSENGER_MINTER_PROGRAM)
  const [localToken] = PublicKey.findProgramAddressSync([Buffer.from('local_token'), Buffer.from(USDC_MINT.toBytes())], TOKEN_MESSENGER_MINTER_PROGRAM)
  const [userTokenAccount] = PublicKey.findProgramAddressSync([
    Buffer.from(owner.toBytes()),
    Buffer.from(new PublicKey(SOLANA_MAINNET.contracts.tokenProgram || 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA').toBytes()),
    Buffer.from(USDC_MINT.toBytes()),
  ], new PublicKey(SOLANA_MAINNET.contracts.associatedTokenProgram || 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'))
  const [custodyTokenAccount] = PublicKey.findProgramAddressSync([Buffer.from('custody'), Buffer.from(USDC_MINT.toBytes())], TOKEN_MESSENGER_MINTER_PROGRAM)
  const [eventAuthority] = PublicKey.findProgramAddressSync([Buffer.from('__event_authority')], TOKEN_MESSENGER_MINTER_PROGRAM)
  const [authorityPda] = PublicKey.findProgramAddressSync([Buffer.from('sender_authority')], TOKEN_MESSENGER_MINTER_PROGRAM)

  // Remote TokenMessenger (Noble) placeholder; optionally configurable
  const remoteTokenMessenger = new PublicKey('HazwI3jFQtLKcZugh7HFXPkpDeso7DQaMR9Ks4afh3j')

  // Event account for MessageSent storage
  const eventAccount = Keypair.generate()

  // Build instruction data: Anchor discriminator + amount(8 LE) + domain(4 LE) + recipient(32)
  const discriminator = Buffer.from([215, 60, 61, 46, 114, 55, 128, 176]) // depositForBurn
  const amountBuffer = Buffer.alloc(8)
  amountBuffer.writeBigUInt64LE(amountMicroUsdc, 0)
  const destinationDomainBuffer = Buffer.alloc(4)
  destinationDomainBuffer.writeUInt32LE(params.destinationDomain, 0)
  const hexToBytes = (hex: string): Uint8Array => {
    const h = hex.replace(/^0x/, '')
    if (h.length !== 64) throw new Error('mintRecipient must be 32-byte hex')
    const out = new Uint8Array(32)
    for (let i = 0; i < 32; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16)
    return out
  }
  const mintRecipient = new PublicKey(hexToBytes(params.mintRecipientHex32))

  const instructionData = Buffer.concat([
    discriminator,
    amountBuffer,
    destinationDomainBuffer,
    Buffer.from(mintRecipient.toBytes()),
  ])

  const ix = {
    programId: TOKEN_MESSENGER_MINTER_PROGRAM.toString(),
    keys: [
      { pubkey: owner.toString(), isSigner: true, isWritable: false },
      { pubkey: owner.toString(), isSigner: true, isWritable: true },
      { pubkey: authorityPda.toString(), isSigner: false, isWritable: false },
      { pubkey: userTokenAccount.toString(), isSigner: false, isWritable: true },
      { pubkey: messageTransmitter.toString(), isSigner: false, isWritable: true },
      { pubkey: tokenMessenger.toString(), isSigner: false, isWritable: false },
      { pubkey: remoteTokenMessenger.toString(), isSigner: false, isWritable: false },
      { pubkey: tokenMinter.toString(), isSigner: false, isWritable: false },
      { pubkey: localToken.toString(), isSigner: false, isWritable: true },
      { pubkey: USDC_MINT.toString(), isSigner: false, isWritable: true },
      { pubkey: custodyTokenAccount.toString(), isSigner: false, isWritable: true },
      { pubkey: (eventAccount.publicKey).toString(), isSigner: true, isWritable: true },
      { pubkey: MESSAGE_TRANSMITTER_PROGRAM.toString(), isSigner: false, isWritable: false },
      { pubkey: TOKEN_MESSENGER_MINTER_PROGRAM.toString(), isSigner: false, isWritable: false },
      { pubkey: (SOLANA_MAINNET.contracts.tokenProgram as string), isSigner: false, isWritable: false },
      { pubkey: (SystemProgram.programId).toString(), isSigner: false, isWritable: false },
      { pubkey: eventAuthority.toString(), isSigner: false, isWritable: false },
      { pubkey: TOKEN_MESSENGER_MINTER_PROGRAM.toString(), isSigner: false, isWritable: false },
    ],
    data: Array.from(instructionData),
  } as BuiltInstruction

  // Create event account rent ix
  const eventAccountSize = 1232
  const rentExemptBalance = await connection.getMinimumBalanceForRentExemption(eventAccountSize)
  const createEventIx = SystemProgram.createAccount({
    fromPubkey: owner,
    newAccountPubkey: eventAccount.publicKey,
    lamports: rentExemptBalance,
    space: eventAccountSize,
    programId: MESSAGE_TRANSMITTER_PROGRAM,
  })

  // Simulate for logs
  let simLogs: string[] | undefined
  let simErr: any
  try {
    const { blockhash } = await connection.getLatestBlockhash()
    const simTx = new Transaction()
    simTx.feePayer = owner
    simTx.recentBlockhash = blockhash
    // Convert createEventIx to serializable form for simulateTransaction via partialSign
    simTx.add(createEventIx as any)
    ;(simTx as any).add({ programId: ix.programId, keys: ix.keys.map(k => ({ ...k, pubkey: new PublicKey(k.pubkey) })), data: Buffer.from(ix.data) })
    simTx.partialSign(eventAccount)
    const sim = await connection.simulateTransaction(simTx)
    simLogs = (sim as any)?.value?.logs || undefined
    simErr = (sim as any)?.value?.err || undefined
  } catch {}

  return {
    instructions: [
      {
        programId: createEventIx.programId.toString(),
        keys: createEventIx.keys.map(k => ({ pubkey: k.pubkey.toString(), isSigner: k.isSigner, isWritable: k.isWritable })),
        data: Array.from(createEventIx.data),
      },
      ix,
    ],
    eventAccount: eventAccount.publicKey.toString(),
    eventAccountSecret: Array.from(eventAccount.secretKey),
    rentCostLamports: rentExemptBalance,
    simLogs,
    simErr,
  }
}


