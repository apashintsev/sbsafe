import { useCallback, useEffect, useMemo, useState } from 'react'
import { Contract, isAddress } from 'ethers'
import { GOVERNANCE_ABI, SAFE_ABI } from './abi'
import {
  CHAINS,
  EXEC_GAS_LIMIT,
  TOKEN_DECIMALS,
  getEnvDefaults,
  getExplorerAddressUrl,
  getExplorerTxUrl,
  shortAddress,
  tryChecksum,
  type SupportedChainId,
} from './config'
import {
  buildPrevalidatedSignatures,
  buildSafeTxParams,
  formatRawLimit,
  parseLimitInput,
  pickApprovedOwnersForThreshold,
  type OwnerApproval,
  type SafeTxParams,
} from './safe/utils'
import { useMetaMask } from './useMetaMask'

type LimitMode = 'raw' | 'human'
type ActionKind = 'create' | 'approve' | 'execute' | null
type AppMode = 'create' | 'signing'

type SafeInfo = {
  owners: string[]
  threshold: bigint
  nonce: bigint
}

type Review = {
  txParams: SafeTxParams
  safeTxHash: string
  limit: bigint
  approvals: OwnerApproval[]
}

function DisconnectedView({
  onConnect,
  connecting,
  error,
  hasMetaMask,
}: {
  onConnect: () => void
  connecting: boolean
  error: string | null
  hasMetaMask: boolean
}) {
  return (
    <section className="card card--centered">
      <div className="card__icon" aria-hidden="true">
        <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="24" cy="24" r="22" stroke="currentColor" strokeWidth="2" />
          <path
            d="M16 24h16M24 16v16"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <h2 className="card__heading">Подключите MetaMask</h2>
      <p className="card__text">
        Чтобы создать предложение setMintLimit или подписать уже существующее,
        подключите MetaMask владельца Safe.
      </p>
      {!hasMetaMask && (
        <p className="message message--error" style={{ marginBottom: 16 }}>
          MetaMask не найден. Установите расширение и обновите страницу.
        </p>
      )}
      {error && (
        <p className="message message--error" style={{ marginBottom: 16 }}>
          {error}
        </p>
      )}
      <button
        type="button"
        className="btn btn--primary btn--large"
        disabled={connecting || !hasMetaMask}
        onClick={onConnect}
      >
        {connecting ? <span className="btn__spinner" /> : null}
        Подключить MetaMask
      </button>
    </section>
  )
}

function OwnersSigningBlock({
  owners,
  approvals,
  walletAddress,
  copiedOwner,
  onCopy,
}: {
  owners: string[]
  approvals: OwnerApproval[]
  walletAddress: string | null
  copiedOwner: string | null
  onCopy: (owner: string) => void
}) {
  return (
    <div className="stack--tight owners-panel">
      <h3 className="section-title" style={{ fontSize: '1rem', marginBottom: 4 }}>
        Статус подписания ({owners.length})
      </h3>
      <ul className="owners">
        {owners.map((owner) => {
          const you = walletAddress?.toLowerCase() === owner.toLowerCase()
          const approved = approvals.find(
            (a) => a.owner.toLowerCase() === owner.toLowerCase(),
          )?.approved
          const copied = copiedOwner?.toLowerCase() === owner.toLowerCase()
          return (
            <li key={owner} className="owners__item">
              <span className={`owners__addr${you ? ' owners__addr--you' : ''}`}>
                {owner}
                {you ? ' · вы' : ''}
              </span>
              <div className="owners__actions">
                {approved ? (
                  <span className="badge badge--ok">APPROVED</span>
                ) : (
                  <span className="badge badge--muted">not approved</span>
                )}
                <button
                  type="button"
                  className="btn btn--ghost btn--compact"
                  onClick={() => onCopy(owner)}
                >
                  {copied ? 'Скопировано' : 'Копировать'}
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function SafeApp() {
  const wallet = useMetaMask()
  const envDefaults = useMemo(() => getEnvDefaults(), [])

  const [safeInput, setSafeInput] = useState(envDefaults.safeAddress ?? '')
  const [governanceInput, setGovernanceInput] = useState(
    envDefaults.governanceProxy ?? '',
  )
  const [mintAccountInput, setMintAccountInput] = useState(
    envDefaults.mintLimitAccount ?? '',
  )
  const [limitInput, setLimitInput] = useState('')
  const [limitMode, setLimitMode] = useState<LimitMode>('raw')

  const [safeInfo, setSafeInfo] = useState<SafeInfo | null>(null)
  const [safeInfoError, setSafeInfoError] = useState<string | null>(null)
  const [safeInfoLoading, setSafeInfoLoading] = useState(false)

  const [currentMintLimit, setCurrentMintLimit] = useState<bigint | null>(null)
  const [mintLimitError, setMintLimitError] = useState(false)
  const [mintLimitLoading, setMintLimitLoading] = useState(false)

  const [mode, setMode] = useState<AppMode>('create')
  const [review, setReview] = useState<Review | null>(null)
  const [probing, setProbing] = useState(false)
  const [probeError, setProbeError] = useState<string | null>(null)

  const [action, setAction] = useState<ActionKind>(null)
  const [busy, setBusy] = useState(false)
  const [txConfirming, setTxConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [pendingHash, setPendingHash] = useState<string | null>(null)
  const [copiedOwner, setCopiedOwner] = useState<string | null>(null)

  const safeAddress = tryChecksum(safeInput)
  const governanceAddress = tryChecksum(governanceInput)
  const mintAccount = tryChecksum(mintAccountInput)

  const isOwner = useMemo(() => {
    if (!wallet.address || !safeInfo) return false
    return safeInfo.owners.some((o) => o.toLowerCase() === wallet.address!.toLowerCase())
  }, [wallet.address, safeInfo])

  const { isConnected, getProvider, chainId: walletChainId } = wallet

  const formReady = useMemo(() => {
    if (!safeAddress || !governanceAddress || !mintAccount || !safeInfo) return false
    if (safeInfoError) return false
    try {
      parseLimitInput(limitInput, limitMode, TOKEN_DECIMALS)
      return true
    } catch {
      return false
    }
  }, [
    safeAddress,
    governanceAddress,
    mintAccount,
    safeInfo,
    safeInfoError,
    limitInput,
    limitMode,
  ])

  const loadSafeInfo = useCallback(async () => {
    if (!safeAddress || !isConnected) {
      setSafeInfo(null)
      setSafeInfoError(null)
      return
    }

    setSafeInfoLoading(true)
    setSafeInfoError(null)
    try {
      const provider = getProvider()
      const safe = new Contract(safeAddress, SAFE_ABI, provider)
      const [owners, threshold, nonce] = await Promise.all([
        safe.getOwners() as Promise<string[]>,
        safe.getThreshold() as Promise<bigint>,
        safe.nonce() as Promise<bigint>,
      ])
      setSafeInfo({ owners, threshold, nonce })
    } catch (e) {
      setSafeInfo(null)
      setSafeInfoError(
        e instanceof Error
          ? e.message
          : 'Не удалось прочитать Safe. Проверьте адрес и сеть.',
      )
    } finally {
      setSafeInfoLoading(false)
    }
  }, [safeAddress, isConnected, getProvider, walletChainId])

  const loadMintLimit = useCallback(async () => {
    if (!governanceAddress || !mintAccount || !isConnected) {
      setCurrentMintLimit(null)
      setMintLimitError(false)
      return
    }

    setMintLimitLoading(true)
    setMintLimitError(false)
    try {
      const provider = getProvider()
      const governance = new Contract(governanceAddress, GOVERNANCE_ABI, provider)
      const limit = (await governance.actualMintLimit(mintAccount)) as bigint
      setCurrentMintLimit(limit)
    } catch {
      setCurrentMintLimit(null)
      setMintLimitError(true)
    } finally {
      setMintLimitLoading(false)
    }
  }, [governanceAddress, mintAccount, isConnected, getProvider, walletChainId])

  useEffect(() => {
    void loadSafeInfo()
  }, [loadSafeInfo])

  useEffect(() => {
    void loadMintLimit()
  }, [loadMintLimit])

  const loadApprovals = useCallback(
    async (hash: string, ownerList: readonly string[]): Promise<OwnerApproval[]> => {
      if (!safeAddress) return []
      const provider = getProvider()
      const safe = new Contract(safeAddress, SAFE_ABI, provider)

      return Promise.all(
        ownerList.map(async (owner) => {
          const approved = (await safe.approvedHashes(owner, hash)) as bigint
          return { owner, approved: approved !== 0n }
        }),
      )
    },
    [safeAddress, getProvider],
  )

  const buildReview = useCallback(async (): Promise<Review> => {
    if (!isConnected) throw new Error('MetaMask не подключён')
    if (!safeAddress) throw new Error('Укажите корректный адрес Safe')
    if (!governanceAddress) throw new Error('Укажите корректный адрес Governance proxy')
    if (!mintAccount) throw new Error('Укажите корректный Mint limit account')
    if (!safeInfo) throw new Error('Не удалось прочитать Safe (owners / threshold / nonce)')
    if (safeInfoError) throw new Error('Адрес не похож на Gnosis Safe на этой сети')

    const provider = getProvider()
    const safe = new Contract(safeAddress, SAFE_ABI, provider)

    const nonce = (await safe.nonce()) as bigint
    const limit = parseLimitInput(limitInput, limitMode, TOKEN_DECIMALS)

    const txParams = buildSafeTxParams({
      governanceProxy: governanceAddress,
      mintLimitAccount: mintAccount,
      limit,
      nonce,
    })

    const safeTxHash = (await safe.getTransactionHash(
      txParams.to,
      txParams.value,
      txParams.data,
      txParams.operation,
      txParams.safeTxGas,
      txParams.baseGas,
      txParams.gasPrice,
      txParams.gasToken,
      txParams.refundReceiver,
      txParams.nonce,
    )) as string

    const approvals = await loadApprovals(safeTxHash, safeInfo.owners)
    setSafeInfo((info) => {
      if (!info || info.nonce === nonce) return info
      return { ...info, nonce }
    })
    return { txParams, safeTxHash, limit, approvals }
  }, [
    isConnected,
    safeAddress,
    governanceAddress,
    mintAccount,
    safeInfo,
    safeInfoError,
    getProvider,
    limitInput,
    limitMode,
    loadApprovals,
  ])

  const applyReview = useCallback((built: Review) => {
    setReview(built)
    const count = built.approvals.filter((a) => a.approved).length
    if (count > 0) {
      setMode('signing')
    } else {
      setMode('create')
    }
  }, [])

  // Auto-probe: when all args are ready, detect existing on-chain proposal
  useEffect(() => {
    if (!isConnected || !wallet.supported || !formReady || busy || txConfirming) {
      return
    }

    let cancelled = false
    const timer = window.setTimeout(() => {
      void (async () => {
        setProbing(true)
        setProbeError(null)
        try {
          const built = await buildReview()
          if (cancelled) return
          applyReview(built)
        } catch (e) {
          if (cancelled) return
          setProbeError(e instanceof Error ? e.message : String(e))
          setReview(null)
          setMode('create')
        } finally {
          if (!cancelled) setProbing(false)
        }
      })()
    }, 450)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [
    isConnected,
    wallet.supported,
    formReady,
    busy,
    txConfirming,
    buildReview,
    applyReview,
    // re-probe when these inputs change (buildReview already depends on them,
    // but walletChainId / nonce refresh should also trigger)
    safeInput,
    governanceInput,
    mintAccountInput,
    limitInput,
    limitMode,
    walletChainId,
    safeInfo?.nonce,
  ])

  async function waitAndFinish(hash: string) {
    setPendingHash(hash)
    setTxConfirming(true)
    setSuccess(`Транзакция отправлена: ${shortAddress(hash)}`)
    try {
      const provider = getProvider()
      const receipt = await provider.waitForTransaction(hash)
      if (receipt?.status === 1) {
        setSuccess(`Транзакция подтверждена: ${shortAddress(hash)}`)
      } else {
        setError('Транзакция завершилась с ошибкой (status ≠ 1)')
      }
      await Promise.all([loadSafeInfo(), loadMintLimit()])
      try {
        const built = await buildReview()
        applyReview(built)
      } catch {
        // optional
      }
    } finally {
      setTxConfirming(false)
      setBusy(false)
      setAction(null)
    }
  }

  async function handleCreateOrApprove() {
    setError(null)
    setSuccess(null)
    setAction(mode === 'signing' ? 'approve' : 'create')
    setBusy(true)
    try {
      if (!wallet.address) throw new Error('Кошелёк не подключён')
      if (!isOwner) throw new Error('Подключённый адрес не является owner Safe')
      if (!safeAddress) throw new Error('Укажите Safe')

      const built = await buildReview()
      applyReview(built)

      const mine = built.approvals.find(
        (a) => a.owner.toLowerCase() === wallet.address!.toLowerCase(),
      )
      if (mine?.approved) {
        setSuccess('Этот owner уже подписал этот exact Safe tx hash on-chain.')
        setBusy(false)
        setAction(null)
        return
      }

      const signer = await wallet.getSigner()
      const safe = new Contract(safeAddress, SAFE_ABI, signer)
      const tx = await safe.approveHash(built.safeTxHash)
      await waitAndFinish(tx.hash as string)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
      setAction(null)
    }
  }

  async function handleExecute() {
    setError(null)
    setSuccess(null)
    setAction('execute')
    setBusy(true)
    try {
      if (!safeAddress) throw new Error('Нет Safe')
      if (!safeInfo) throw new Error('Threshold не загружен')

      const built = await buildReview()
      applyReview(built)

      const approvedOwners = pickApprovedOwnersForThreshold(
        built.approvals,
        safeInfo.threshold,
      )
      const signatures = buildPrevalidatedSignatures(approvedOwners)

      const provider = getProvider()
      try {
        await provider.call({
          from: safeAddress,
          to: built.txParams.to,
          data: built.txParams.data,
          value: built.txParams.value,
        })
      } catch {
        throw new Error(
          'Прямой вызов setMintLimit от имени Safe ревертнётся. Проверьте права Safe и параметры account/limit.',
        )
      }

      const signer = await wallet.getSigner()
      const safe = new Contract(safeAddress, SAFE_ABI, signer)
      const tx = await safe.execTransaction(
        built.txParams.to,
        built.txParams.value,
        built.txParams.data,
        built.txParams.operation,
        built.txParams.safeTxGas,
        built.txParams.baseGas,
        built.txParams.gasPrice,
        built.txParams.gasToken,
        built.txParams.refundReceiver,
        signatures,
        { gasLimit: EXEC_GAS_LIMIT },
      )
      await waitAndFinish(tx.hash as string)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
      setAction(null)
    }
  }

  async function handleSwitchChain(target: SupportedChainId) {
    setError(null)
    try {
      await wallet.switchChain(target)
      setReview(null)
      setMode('create')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  function copyOwner(owner: string) {
    void navigator.clipboard.writeText(owner).then(() => {
      setCopiedOwner(owner)
      window.setTimeout(() => {
        setCopiedOwner((prev) =>
          prev?.toLowerCase() === owner.toLowerCase() ? null : prev,
        )
      }, 1500)
    })
  }

  function resetToCreate() {
    setMode('create')
    setReview(null)
    setSuccess(null)
    setError(null)
  }

  if (!wallet.isConnected) {
    return (
      <DisconnectedView
        onConnect={() => void wallet.connect()}
        connecting={wallet.connecting}
        error={wallet.error}
        hasMetaMask={wallet.hasMetaMask}
      />
    )
  }

  const approvedCount = review?.approvals.filter((a) => a.approved).length ?? 0
  const canExecute =
    !!safeInfo && BigInt(approvedCount) >= safeInfo.threshold && !!review
  const iAlreadyApproved = !!review?.approvals.find(
    (a) =>
      wallet.address &&
      a.owner.toLowerCase() === wallet.address.toLowerCase() &&
      a.approved,
  )

  const chainId = wallet.chainId ?? 0
  const explorerSafe = safeAddress ? getExplorerAddressUrl(chainId, safeAddress) : null
  const pendingExplorer = pendingHash ? getExplorerTxUrl(chainId, pendingHash) : null

  return (
    <section className="card">
      <div className="stack">
        <div>
          <div className="mode-tabs" role="tablist" aria-label="Режим">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'create'}
              className={`mode-tabs__item${mode === 'create' ? ' mode-tabs__item--active' : ''}`}
              onClick={resetToCreate}
            >
              Создание
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'signing'}
              className={`mode-tabs__item${mode === 'signing' ? ' mode-tabs__item--active' : ''}`}
              disabled={mode !== 'signing'}
              title={
                mode !== 'signing'
                  ? 'Появится автоматически, если по этим параметрам уже есть approveHash'
                  : undefined
              }
            >
              Подписание
            </button>
          </div>
          <p className="field__hint" style={{ marginBottom: 8 }}>
            Сеть: <strong>{wallet.chainName}</strong>
            {probing ? ' · проверяем предложение…' : null}
          </p>
          <div className="field__inline-options">
            {([1, 11155111] as const).map((id) => (
              <button
                key={id}
                type="button"
                className={`chip chip--btn${wallet.chainId === id ? ' chip--active' : ''}`}
                disabled={busy || txConfirming || wallet.chainId === id}
                onClick={() => void handleSwitchChain(id)}
              >
                {CHAINS[id].name}
              </button>
            ))}
          </div>
          {!wallet.supported && (
            <p className="message message--error" style={{ marginTop: 12 }}>
              Выберите Ethereum Mainnet или Sepolia в MetaMask.
            </p>
          )}
        </div>

        <div className={`mode-body mode-body--${mode}`}>
          <div className="stack">
            <label className="field">
              <span className="field__label">Адрес Safe</span>
              <input
                className="field__input field__input--mono"
                placeholder="0x… (из .env или вручную)"
                value={safeInput}
                onChange={(e) => {
                  setSafeInput(e.target.value)
                  setReview(null)
                  setMode('create')
                }}
                spellCheck={false}
              />
              {safeInput && !isAddress(safeInput.trim()) && (
                <p className="field__hint" style={{ color: '#b91c1c' }}>
                  Некорректный адрес
                </p>
              )}
              {explorerSafe && (
                <p className="field__hint">
                  <a
                    href={explorerSafe}
                    target="_blank"
                    rel="noreferrer"
                    className="message__link"
                  >
                    Открыть Safe в explorer
                  </a>
                </p>
              )}
            </label>

            <label className="field">
              <span className="field__label">Governance proxy</span>
              <input
                className="field__input field__input--mono"
                placeholder="0x… (из .env или вручную)"
                value={governanceInput}
                onChange={(e) => {
                  setGovernanceInput(e.target.value)
                  setReview(null)
                  setMode('create')
                }}
                spellCheck={false}
              />
            </label>

            <label className="field">
              <span className="field__label">Mint limit account</span>
              <input
                className="field__input field__input--mono"
                placeholder="0x… account для setMintLimit"
                value={mintAccountInput}
                onChange={(e) => {
                  setMintAccountInput(e.target.value)
                  setReview(null)
                  setMode('create')
                }}
                spellCheck={false}
              />
            </label>
          </div>

          {safeAddress && (
            <dl className="meta-box">
              {safeInfoLoading && (
                <div className="meta-box__row">
                  <dt className="meta-box__label">Статус</dt>
                  <dd className="meta-box__value">Загрузка…</dd>
                </div>
              )}
              {safeInfoError && (
                <div className="meta-box__row">
                  <dt className="meta-box__label">Ошибка</dt>
                  <dd className="meta-box__value" style={{ color: '#b91c1c' }}>
                    {safeInfoError}
                  </dd>
                </div>
              )}
              {safeInfo && (
                <>
                  <div className="meta-box__row">
                    <dt className="meta-box__label">Threshold</dt>
                    <dd className="meta-box__value">{safeInfo.threshold.toString()}</dd>
                  </div>
                  <div className="meta-box__row">
                    <dt className="meta-box__label">Nonce</dt>
                    <dd className="meta-box__value meta-box__value--mono">
                      {safeInfo.nonce.toString()}
                    </dd>
                  </div>
                  <div className="meta-box__row">
                    <dt className="meta-box__label">Ваш статус</dt>
                    <dd className="meta-box__value">
                      {isOwner ? (
                        <span className="badge badge--ok">owner</span>
                      ) : (
                        <span className="badge badge--warn">не owner</span>
                      )}
                    </dd>
                  </div>
                </>
              )}
              <div className="meta-box__row">
                <dt className="meta-box__label">Текущий actualMintLimit</dt>
                <dd className="meta-box__value meta-box__value--mono">
                  {mintLimitLoading && '…'}
                  {!mintLimitLoading && mintLimitError && (
                    <span className="badge badge--muted">нет getter / ошибка</span>
                  )}
                  {!mintLimitLoading &&
                    !mintLimitError &&
                    currentMintLimit !== null &&
                    formatRawLimit(
                      currentMintLimit,
                      TOKEN_DECIMALS,
                      limitMode === 'human',
                    )}
                </dd>
              </div>
              <div className="btn-row">
                <button
                  type="button"
                  className="btn btn--ghost btn--compact"
                  onClick={() => {
                    void loadSafeInfo()
                    void loadMintLimit()
                  }}
                >
                  Обновить info
                </button>
              </div>
            </dl>
          )}

          <div className="stack">
            <div className="field">
              <span className="field__label">Единицы лимита</span>
              <div className="field__inline-options">
                <label className="chip">
                  <input
                    type="radio"
                    name="limitMode"
                    checked={limitMode === 'raw'}
                    onChange={() => {
                      setLimitMode('raw')
                      setReview(null)
                      setMode('create')
                    }}
                  />
                  Raw
                </label>
                <label className="chip">
                  <input
                    type="radio"
                    name="limitMode"
                    checked={limitMode === 'human'}
                    onChange={() => {
                      setLimitMode('human')
                      setReview(null)
                      setMode('create')
                    }}
                  />
                  Human ({TOKEN_DECIMALS} decimals)
                </label>
              </div>
            </div>

            <label className="field">
              <span className="field__label">Новый лимит</span>
              <input
                className="field__input field__input--mono"
                placeholder={
                  limitMode === 'raw' ? 'например 1000000000' : 'например 1000.5'
                }
                value={limitInput}
                onChange={(e) => {
                  setLimitInput(e.target.value)
                  setReview(null)
                  setMode('create')
                }}
              />
            </label>
          </div>

          {mode === 'create' && formReady && !probing && review && approvedCount === 0 && (
            <p className="message message--info">
              Предложения с этими параметрами ещё нет. Можно создать первую подпись
              (approveHash).
            </p>
          )}

          {mode === 'signing' && (
            <p className="message message--info mode-enter">
              Найдено существующее предложение: уже есть on-chain approveHash. Можно
              подписать или исполнить.
            </p>
          )}

          {review && (
            <dl className="meta-box">
              <div className="meta-box__row">
                <dt className="meta-box__label">Limit raw</dt>
                <dd className="meta-box__value meta-box__value--mono">
                  {review.limit.toString()}
                </dd>
              </div>
              <div className="meta-box__row">
                <dt className="meta-box__label">Safe tx hash</dt>
                <dd className="meta-box__value meta-box__value--mono">{review.safeTxHash}</dd>
              </div>
              {mode === 'signing' && (
                <>
                  <div className="meta-box__row">
                    <dt className="meta-box__label">Calldata</dt>
                    <dd className="meta-box__value meta-box__value--mono">
                      {review.txParams.data}
                    </dd>
                  </div>
                  <div className="meta-box__row">
                    <dt className="meta-box__label">Approvals</dt>
                    <dd className="meta-box__value">
                      {approvedCount} / {safeInfo?.threshold.toString() ?? '?'}
                      {canExecute ? (
                        <>
                          {' '}
                          <span className="badge badge--ok">можно execute</span>
                        </>
                      ) : (
                        <>
                          {' '}
                          <span className="badge badge--warn">мало подписей</span>
                        </>
                      )}
                    </dd>
                  </div>
                </>
              )}
            </dl>
          )}

          {probeError && <p className="message message--error">{probeError}</p>}
          {error && <p className="message message--error">{error}</p>}
          {success && (
            <p className="message message--success">
              {success}
              {pendingExplorer && (
                <>
                  {' '}
                  <a
                    className="message__link"
                    href={pendingExplorer}
                    target="_blank"
                    rel="noreferrer"
                  >
                    explorer
                  </a>
                </>
              )}
            </p>
          )}
          {(busy || txConfirming || probing) && (
            <p className="message message--info">
              {txConfirming
                ? 'Ждём подтверждения в сети…'
                : probing
                  ? 'Сверяем параметры с on-chain approveHash…'
                  : 'Выполняется…'}
            </p>
          )}

          <div className="btn-row btn-row--end">
            {mode === 'create' ? (
              <button
                type="button"
                className="btn btn--primary"
                disabled={
                  busy ||
                  txConfirming ||
                  probing ||
                  !wallet.supported ||
                  !formReady ||
                  !isOwner
                }
                onClick={() => void handleCreateOrApprove()}
                title={!isOwner ? 'Нужен owner Safe' : undefined}
              >
                {(action === 'create' || action === 'approve') && (busy || txConfirming) ? (
                  <span className="btn__spinner" />
                ) : null}
                Создать предложение
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="btn btn--secondary"
                  disabled={
                    busy ||
                    txConfirming ||
                    !isOwner ||
                    !wallet.supported ||
                    iAlreadyApproved
                  }
                  onClick={() => void handleCreateOrApprove()}
                  title={
                    !isOwner
                      ? 'Нужен owner Safe'
                      : iAlreadyApproved
                        ? 'Вы уже подписали'
                        : undefined
                  }
                >
                  {(action === 'approve' || action === 'create') &&
                  (busy || txConfirming) ? (
                    <span className="btn__spinner btn__spinner--dark" />
                  ) : null}
                  {iAlreadyApproved ? 'Уже подписано' : 'Подписать'}
                </button>
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={busy || txConfirming || !wallet.supported || !canExecute}
                  onClick={() => void handleExecute()}
                >
                  {action === 'execute' && (busy || txConfirming) ? (
                    <span className="btn__spinner" />
                  ) : null}
                  Execute
                </button>
              </>
            )}
          </div>
        </div>

        {mode === 'signing' && safeInfo && review && (
          <OwnersSigningBlock
            owners={safeInfo.owners}
            approvals={review.approvals}
            walletAddress={wallet.address}
            copiedOwner={copiedOwner}
            onCopy={copyOwner}
          />
        )}
      </div>
    </section>
  )
}
