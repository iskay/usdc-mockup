import React from 'react'
import { useGaslessFeeEstimate } from '../hooks/useGaslessFeeEstimate'
import Spinner from '../../../components/ui/Spinner'

interface GaslessToggleProps {
  enabled: boolean
  onToggle: (enabled: boolean) => void
  chain: string
  amount: string
  userAddress?: string
  availableBalance: string
}

export const GaslessToggle: React.FC<GaslessToggleProps> = ({
  enabled,
  onToggle,
  chain,
  amount,
  userAddress,
  availableBalance
}) => {
  const { gasFeeEth, swapAmountUsdc, totalUsdcNeeded, isLoading, error } = useGaslessFeeEstimate(
    chain,
    amount,
    enabled,
    userAddress
  )

  // Check if user has enough USDC for gas-less transaction
  const hasEnoughUsdc = parseFloat(availableBalance) >= parseFloat(totalUsdcNeeded)
  const isDisabled = isLoading || error || !hasEnoughUsdc

  return (
    <div className="border rounded-lg p-4 bg-gray-50 dark:bg-gray-800">
      <label className="flex items-start space-x-3 cursor-pointer">
        <input 
          type="checkbox" 
          checked={enabled}
          onChange={(e) => onToggle(e.target.checked)}
          disabled={isDisabled}
          className="w-4 h-4 text-blue-600 mt-1"
        />
        <div className="flex-1">
          <div className="font-medium text-gray-900 dark:text-gray-100">
            Pay gas fees with USDC
          </div>
          <div className="text-sm text-gray-600 dark:text-gray-400">
            No ETH needed in your wallet
          </div>
          
          {enabled && (
            <div className="mt-3 space-y-2">
              {isLoading ? (
                <div className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-400">
                  <Spinner size="sm" />
                  <span>Calculating fees...</span>
                </div>
              ) : error ? (
                <div className="text-sm text-red-600 dark:text-red-400">
                  {error}
                </div>
              ) : (
                <div className="text-sm text-gray-700 dark:text-gray-300 space-y-1">
                  <div className="flex justify-between">
                    <span>Transfer amount:</span>
                    <span>{amount} USDC</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Estimated gas fee:</span>
                    <span>{gasFeeEth} ETH</span>
                  </div>
                  <div className="flex justify-between">
                    <span>USDC to swap for gas:</span>
                    <span>{swapAmountUsdc} USDC</span>
                  </div>
                  <div className="flex justify-between font-medium border-t pt-1">
                    <span>Total USDC needed:</span>
                    <span className={hasEnoughUsdc ? 'text-green-600' : 'text-red-600'}>
                      {totalUsdcNeeded} USDC
                    </span>
                  </div>
                  {!hasEnoughUsdc && (
                    <div className="text-xs text-red-600 dark:text-red-400">
                      Insufficient USDC balance. You have {availableBalance} USDC.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </label>
      
      {enabled && !isLoading && !error && (
        <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-md">
          <div className="text-sm text-blue-800 dark:text-blue-200">
            <strong>How it works:</strong> We'll automatically convert some of your USDC to ETH 
            to pay for gas fees, then complete your transfer. No manual ETH purchase needed!
          </div>
        </div>
      )}
    </div>
  )
}
