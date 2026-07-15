import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { BrowserProvider, type Signer } from 'ethers'
import { CHAINS, isSupportedChainId, type SupportedChainId } from './config'

type MetaMaskState = {
  address: string | null
  chainId: number | null
  connecting: boolean
  error: string | null
}

type MetaMaskApi = MetaMaskState & {
  isConnected: boolean
  supported: boolean
  chainName: string
  hasMetaMask: boolean
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  switchChain: (target: SupportedChainId) => Promise<void>
  getProvider: () => BrowserProvider
  getSigner: () => Promise<Signer>
}

const MetaMaskContext = createContext<MetaMaskApi | null>(null)

function getEthereum() {
  const eth = window.ethereum
  if (!eth) return null
  if (eth.isMetaMask === false) return null
  return eth
}

async function readAccountsAndChain(provider: BrowserProvider) {
  const accounts = (await provider.send('eth_accounts', [])) as string[]
  const network = await provider.getNetwork()
  return {
    address: accounts[0] ?? null,
    chainId: Number(network.chainId),
  }
}

function useMetaMaskState(): MetaMaskApi {
  const [state, setState] = useState<MetaMaskState>({
    address: null,
    chainId: null,
    connecting: false,
    error: null,
  })

  // MetaMask часто оставляет permission — без флага sync сразу «подключает» снова
  const intentionallyDisconnected = useRef(false)

  const sync = useCallback(async () => {
    const eth = getEthereum()
    if (!eth) {
      setState((s) => ({ ...s, address: null, chainId: null }))
      return
    }
    try {
      const provider = new BrowserProvider(eth)
      const next = await readAccountsAndChain(provider)

      if (intentionallyDisconnected.current) {
        setState((s) => ({
          ...s,
          address: null,
          chainId: next.chainId,
          error: null,
        }))
        return
      }

      setState((s) => ({ ...s, ...next, error: null }))
    } catch (e) {
      setState((s) => ({
        ...s,
        error: e instanceof Error ? e.message : String(e),
      }))
    }
  }, [])

  useEffect(() => {
    void sync()
    const eth = getEthereum()
    if (!eth?.on) return

    const onAccounts = (accounts: unknown) => {
      const list = Array.isArray(accounts) ? (accounts as string[]) : []
      if (list.length === 0) {
        intentionallyDisconnected.current = true
      }
      void sync()
    }
    const onChain = () => void sync()

    eth.on('accountsChanged', onAccounts)
    eth.on('chainChanged', onChain)

    return () => {
      eth.removeListener?.('accountsChanged', onAccounts)
      eth.removeListener?.('chainChanged', onChain)
    }
  }, [sync])

  const connect = useCallback(async () => {
    const eth = getEthereum()
    if (!eth) {
      setState((s) => ({
        ...s,
        error: 'MetaMask не найден. Установите расширение MetaMask.',
      }))
      return
    }

    intentionallyDisconnected.current = false
    setState((s) => ({ ...s, connecting: true, error: null }))
    try {
      const provider = new BrowserProvider(eth)
      await provider.send('eth_requestAccounts', [])
      const next = await readAccountsAndChain(provider)
      setState((s) => ({ ...s, ...next, connecting: false, error: null }))
    } catch (e) {
      intentionallyDisconnected.current = true
      setState((s) => ({
        ...s,
        address: null,
        connecting: false,
        error: e instanceof Error ? e.message : String(e),
      }))
    }
  }, [])

  const disconnect = useCallback(async () => {
    intentionallyDisconnected.current = true
    setState((s) => ({
      ...s,
      address: null,
      connecting: false,
      error: null,
    }))

    const eth = getEthereum()
    try {
      if (eth?.request) {
        await eth.request({
          method: 'wallet_revokePermissions',
          params: [{ eth_accounts: {} }],
        })
      }
    } catch {
      // ок — UI уже отключён через intentionallyDisconnected
    }
  }, [])

  const switchChain = useCallback(async (target: SupportedChainId) => {
    const eth = getEthereum()
    if (!eth?.request) {
      throw new Error('MetaMask не найден')
    }

    const chain = CHAINS[target]
    try {
      await eth.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: chain.hex }],
      })
    } catch (e) {
      const err = e as { code?: number; message?: string }
      if (err.code === 4902) {
        throw new Error(
          `Сеть ${chain.name} не добавлена в MetaMask. Добавьте её вручную и повторите.`,
        )
      }
      throw new Error(err.message ?? String(e))
    }
  }, [])

  const getProvider = useCallback(() => {
    const eth = getEthereum()
    if (!eth) throw new Error('MetaMask не найден')
    return new BrowserProvider(eth)
  }, [])

  const getSigner = useCallback(async (): Promise<Signer> => {
    const provider = getProvider()
    return provider.getSigner()
  }, [getProvider])

  const isConnected = !!state.address
  const supported = state.chainId !== null && isSupportedChainId(state.chainId)
  const chainName =
    state.chainId !== null && isSupportedChainId(state.chainId)
      ? CHAINS[state.chainId].name
      : state.chainId !== null
        ? `Chain ${state.chainId}`
        : '—'

  return useMemo(
    () => ({
      ...state,
      isConnected,
      supported,
      chainName,
      connect,
      disconnect,
      switchChain,
      getProvider,
      getSigner,
      hasMetaMask: !!getEthereum(),
    }),
    [
      state,
      isConnected,
      supported,
      chainName,
      connect,
      disconnect,
      switchChain,
      getProvider,
      getSigner,
    ],
  )
}

export function MetaMaskProvider({ children }: { children: ReactNode }) {
  const value = useMetaMaskState()
  return createElement(MetaMaskContext.Provider, { value }, children)
}

export function useMetaMask(): MetaMaskApi {
  const ctx = useContext(MetaMaskContext)
  if (!ctx) {
    throw new Error('useMetaMask must be used within MetaMaskProvider')
  }
  return ctx
}
