import { SafeApp } from './SafeApp'
import { MetaMaskProvider } from './useMetaMask'

export default function App() {
  return (
    <MetaMaskProvider>
      <SafeApp />
    </MetaMaskProvider>
  )
}
