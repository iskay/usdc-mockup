// Solana transaction send and status polling utilities

export async function sendSolanaTransaction(params: {
  rpcUrl: string
  ownerPubkeyBase58: string
  instructions: { programId: string; keys: { pubkey: string; isSigner: boolean; isWritable: boolean }[]; data: number[] }[]
  signWithEventAccount?: { publicKey: string; secret: number[] }
}): Promise<{ signature: string }> {
  const { Connection, PublicKey, Transaction, Keypair } = await import('@solana/web3.js')
  const conn = new Connection(params.rpcUrl as any, { commitment: 'confirmed' })

  const tx = new Transaction()
  const owner = new PublicKey(params.ownerPubkeyBase58)
  const { blockhash } = await conn.getLatestBlockhash()
  tx.feePayer = owner
  tx.recentBlockhash = blockhash
  for (const ix of params.instructions) {
    tx.add({
      programId: new PublicKey(ix.programId),
      keys: ix.keys.map(k => ({ pubkey: new PublicKey(k.pubkey), isSigner: k.isSigner, isWritable: k.isWritable })),
      data: Buffer.from(ix.data),
    } as any)
  }

  // Optionally sign with the event account first (payer signs in wallet)
  if (params.signWithEventAccount) {
    const kp = Keypair.fromSecretKey(Uint8Array.from(params.signWithEventAccount.secret))
    tx.partialSign(kp)
  }

  // Request wallet signature (Wallet Standard/injected should intercept via window.solana)
  const w: any = (globalThis as any)
  const sol = (w?.solana || (w?.wallet?.solana)) as any
  if (!sol || typeof sol.signTransaction !== 'function') throw new Error('Solana wallet not available for signing')
  const signed = await sol.signTransaction(tx)
  const raw = signed.serialize()
  const sig = await conn.sendRawTransaction(raw)
  return { signature: sig }
}

export async function pollSolanaTransaction(params: {
  rpcUrl: string
  signature: string
  timeoutMs?: number
  intervalMs?: number
}): Promise<{ confirmed: boolean; err?: any }> {
  const { Connection } = await import('@solana/web3.js')
  const conn = new Connection(params.rpcUrl as any, { commitment: 'confirmed' })
  const timeoutAt = Date.now() + (params.timeoutMs ?? 5 * 60 * 1000)
  const interval = params.intervalMs ?? 3000
  while (Date.now() < timeoutAt) {
    try {
      const res = await conn.getSignatureStatus(params.signature, { searchTransactionHistory: true })
      const status = (res?.value as any)?.confirmationStatus || (res?.value as any)?.confirmationStatus
      const err = (res?.value as any)?.err
      if (status === 'confirmed' || status === 'finalized') return { confirmed: true }
      if (err) return { confirmed: false, err }
    } catch {}
    await new Promise(r => setTimeout(r, interval))
  }
  return { confirmed: false }
}


