// Solana wallet detection and connection utilities (Wallet Standard + injected)

type MaybeWindow = Window & typeof globalThis & { solana?: any } & { wallet?: any } & { ethereum?: any };

function getWalletStandard(): any | null {
  try {
    // Lazy require to avoid bundling if not used
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ws = require('@wallet-standard/app');
    if (!ws?.getWallets) return null;
    const { getWallets } = ws;
    const reg = getWallets();
    const list = typeof reg?.get === 'function' ? reg.get() : [];
    const hasSolanaFeature = (w: any) => {
      const feats = Object.keys(w?.features || {});
      return feats.some((k) => k.startsWith('solana:')) || feats.includes('standard:connect');
    };
    const byName = (w: any) => (String(w?.name || '').toLowerCase().includes('metamask') ? 0 : 1);
    const candidates = (list || []).filter(hasSolanaFeature).sort((a: any, b: any) => byName(a) - byName(b));
    return candidates[0] || null;
  } catch {
    return null;
  }
}

function getInjectedSolana(): any | null {
  try {
    const w = (globalThis as MaybeWindow);
    if (w?.solana && typeof w.solana === 'object') return w.solana;
    // MetaMask Solana may expose window.wallet?.solana or similar in future; probe lightly
    if ((w as any)?.wallet?.solana) return (w as any).wallet.solana;
    return null;
  } catch {
    return null;
  }
}

export async function connectSolanaWallet(): Promise<{ publicKey: string } | null> {
  // Prefer Wallet Standard
  try {
    const ws = getWalletStandard();
    if (ws?.features?.['standard:connect']) {
      const res = await ws.features['standard:connect'].connect();
      const accObj = (Array.isArray(res?.accounts) ? res.accounts[0] : null) as any;
      const addr = (accObj?.address as string) || '';
      if (addr) return { publicKey: addr };
    }
  } catch {}

  // Fallback: injected provider (MetaMask/Phantom)
  const sol = getInjectedSolana();
  if (!sol) return null;
  try {
    let pk: string | undefined;
    if (typeof sol.connect === 'function') {
      try {
        const resp = await sol.connect();
        pk = resp?.publicKey?.toString?.() || sol.publicKey?.toString?.();
      } catch {}
    }
    if (!pk) pk = sol.publicKey?.toString?.();
    if (!pk) return null;
    return { publicKey: pk };
  } catch {
    return null;
  }
}

export function isSolanaProviderDetected(): boolean {
  return !!(getWalletStandard() || getInjectedSolana());
}


