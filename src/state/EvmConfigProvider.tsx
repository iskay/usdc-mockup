import React, { createContext, useContext, useEffect, useState } from 'react';
import { loadEvmChainsConfig, type EvmChainsConfig } from '../config/evmChains';

type EvmConfigContextType = {
  config: EvmChainsConfig | null;
  loading: boolean;
  error: string | null;
};

const EvmConfigContext = createContext<EvmConfigContextType>({
  config: null,
  loading: true,
  error: null,
});

export const useEvmConfig = () => {
  const context = useContext(EvmConfigContext);
  if (!context) {
    throw new Error('useEvmConfig must be used within an EvmConfigProvider');
  }
  return context;
};

type EvmConfigProviderProps = {
  children: React.ReactNode;
};

export const EvmConfigProvider: React.FC<EvmConfigProviderProps> = ({ children }) => {
  const [config, setConfig] = useState<EvmChainsConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const loadConfig = async () => {
      try {
        setLoading(true);
        setError(null);
        
        const loadedConfig = await loadEvmChainsConfig();
        
        if (mounted) {
          setConfig(loadedConfig);
          console.log('[EvmConfigProvider] Loaded config with', loadedConfig.chains.length, 'chains');
        }
      } catch (err) {
        console.error('[EvmConfigProvider] Failed to load config:', err);
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to load EVM chains configuration');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    loadConfig();

    return () => {
      mounted = false;
    };
  }, []);

  const value: EvmConfigContextType = {
    config,
    loading,
    error,
  };

  return (
    <EvmConfigContext.Provider value={value}>
      {children}
    </EvmConfigContext.Provider>
  );
};
