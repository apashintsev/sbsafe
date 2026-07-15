import { shortAddress } from './config'
import { SafeApp } from './SafeApp'
import { MetaMaskProvider, useMetaMask } from './useMetaMask'

function WalletBar() {
  const wallet = useMetaMask()

  if (!wallet.isConnected) {
    return (
      <button
        type="button"
        className="btn btn--header"
        disabled={wallet.connecting || !wallet.hasMetaMask}
        onClick={() => void wallet.connect()}
      >
        {wallet.connecting ? 'Подключение…' : 'MetaMask'}
      </button>
    )
  }

  return (
    <div className="wallet-bar">
      <span className="wallet-bar__chain">{wallet.chainName}</span>
      <span className="wallet-bar__addr">{shortAddress(wallet.address!)}</span>
      <button
        type="button"
        className="btn btn--header btn--header-ghost"
        onClick={() => void wallet.disconnect()}
      >
        Отключить
      </button>
    </div>
  )
}

export default function App() {
  return (
    <MetaMaskProvider>
      <div className="page">
        <header className="header">
          <div className="header__inner">
            <div className="brand">
              <p className="brand__title">SB Safe</p>
              <p className="brand__subtitle">Mint limit через Gnosis Safe</p>
            </div>
            <WalletBar />
          </div>
        </header>
        <main className="main">
          <SafeApp />
        </main>
      </div>
    </MetaMaskProvider>
  )
}
