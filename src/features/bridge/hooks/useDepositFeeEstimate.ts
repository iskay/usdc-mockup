import { useEffect, useState } from 'react'
import { estimateDepositFeesUSD } from '../../../utils/evmFee'
import { getUsdcAddress, getTokenMessengerAddress } from '../../../utils/chain'

export function useDepositFeeEstimate(chain: string, amount: string, address: string) {
  const [depositFeeEst, setDepositFeeEst] = useState<string | null>(null)

  useEffect(() => {
    const handle = window.setTimeout(async () => {
      try {
        console.info('[DepositFeeEst][hook] start', { chain, amount, address })
        const tokenMessenger = getTokenMessengerAddress(chain)
        const usdcAddr = getUsdcAddress(chain)
        if (!tokenMessenger || !usdcAddr) { console.warn('[DepositFeeEst][hook] missing config', { tokenMessenger: !!tokenMessenger, usdcAddr: !!usdcAddr }); setDepositFeeEst(null); return }
        if (!(window as any).ethereum) { console.warn('[DepositFeeEst][hook] no ethereum provider'); setDepositFeeEst(null); return }
        const accounts: string[] = await (window as any).ethereum.request?.({ method: 'eth_accounts' })
        if (!accounts || accounts.length === 0) { console.warn('[DepositFeeEst][hook] no accounts; connect metamask to enable estimates'); setDepositFeeEst(null); return }

        let nobleRegistered = false
        try {
          const channelId = import.meta.env.VITE_NOBLE_TO_NAMADA_CHANNEL || 'channel-136'
          const lcdUrl = import.meta.env.VITE_NOBLE_LCD_URL
          if (address && lcdUrl) {
            const url = `${lcdUrl}/noble/forwarding/v1/address/${channelId}/${address}/`
            console.info('[DepositFeeEst][hook] Noble exists check', { url })
            const res = await fetch(url)
            if (res.ok) {
              const data = await res.json()
              nobleRegistered = !!data?.exists
              console.info('[DepositFeeEst][hook] Noble exists result', data)
            }
          }
        } catch (e) { console.warn('[DepositFeeEst][hook] Noble exists check failed', e) }

        const est = await estimateDepositFeesUSD({ amountUsdc: amount || '0', usdcAddress: usdcAddr, tokenMessengerAddress: tokenMessenger, chainKey: chain })
        const total = nobleRegistered ? (est.totalUsd - est.nobleRegUsd) : est.totalUsd
        console.info('[DepositFeeEst][hook] result', { ...est, nobleRegistered, displayedTotal: total })
        setDepositFeeEst(`$${total.toFixed(4)}`)
      } catch (e) {
        console.warn('[DepositFeeEst][hook] estimation failed', e)
        setDepositFeeEst(null)
      }
    }, 500)
    return () => window.clearTimeout(handle)
  }, [chain, amount, address])

  return depositFeeEst
}


