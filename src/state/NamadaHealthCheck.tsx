import { useEffect } from 'react'
import { useNamadaSdk } from './NamadaSdkProvider'

export const NamadaHealthCheck: React.FC = () => {
  const { isReady, rpc, error } = useNamadaSdk()

  useEffect(() => {
    const run = async () => {
      if (!isReady || !rpc) {
        console.debug('[Namada SDK] Health check skipped (isReady=%s, hasRpc=%s)', isReady, !!rpc)
        return
      }
      try {
        const nativeToken = await rpc.queryNativeToken()
        // Include useful diagnostics in output per project lessons
        console.log('[Namada SDK] Native token:', nativeToken)
      } catch (e) {
        console.error('[Namada SDK] Health check failed:', e)
      }
    }
    run()
  }, [isReady, rpc])

  if (error) return null
  return null
}


