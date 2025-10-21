// Utilities to read SOL and USDC (SPL) balances for a Solana public key

export type SolanaBalanceResult = {
  solLamports: bigint;
  usdcAmountBaseUnits: bigint; // 6 decimals
};

export async function fetchSolanaBalances(params: {
  rpcUrl: string;
  ownerPubkeyBase58: string;
  usdcMintBase58: string;
}): Promise<SolanaBalanceResult> {
  // lazy import to avoid bundling in environments lacking Solana deps
  const { Connection, PublicKey } = await import('@solana/web3.js');
  const conn = new Connection(params.rpcUrl as any, { commitment: 'processed' });
  const owner = new PublicKey(params.ownerPubkeyBase58);
  const mint = new PublicKey(params.usdcMintBase58);

  const solLamports = BigInt(await conn.getBalance(owner));

  // getParsedTokenAccountsByOwner avoids Buffer decoding in browser
  const parsed = await conn.getParsedTokenAccountsByOwner(owner, { mint });
  let total = 0n;
  for (const it of parsed.value) {
    try {
      const amtStr = (it as any)?.account?.data?.parsed?.info?.tokenAmount?.amount as string | undefined;
      if (amtStr) total += BigInt(amtStr);
    } catch {}
  }

  return { solLamports, usdcAmountBaseUnits: total };
}


