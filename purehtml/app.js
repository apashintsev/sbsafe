/* global ethers */
;(function () {
  'use strict'

  // ============== defaults from env.js ==============
  const DEFAULTS = {
    safeAddress: window.ENV?.SAFE_ADDRESS ?? '',
    governanceProxy: window.ENV?.GOVERNANCE_PROXY_ADDRESS ?? '',
    mintLimitAccount: window.ENV?.MINT_LIMIT_ACCOUNT ?? '',
  }

  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
  const EXEC_GAS_LIMIT = 130_000n
  const TOKEN_DECIMALS = 6

  const CHAINS = {
    1: { id: 1, name: 'Ethereum', hex: '0x1' },
    11155111: { id: 11155111, name: 'Sepolia', hex: '0xaa36a7' },
  }

  const SAFE_ABI = [
    'function nonce() view returns (uint256)',
    'function getOwners() view returns (address[])',
    'function getThreshold() view returns (uint256)',
    'function approveHash(bytes32 hashToApprove)',
    'function approvedHashes(address owner, bytes32 hash) view returns (uint256)',
    'function getTransactionHash(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 _nonce) view returns (bytes32)',
    'function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) returns (bool success)',
  ]

  const GOVERNANCE_ABI = [
    'function setMintLimit(address account,uint256 limit)',
    'function actualMintLimit(address actor) view returns (uint256)',
  ]

  const governanceInterface = new ethers.Interface(GOVERNANCE_ABI)

  // ============== utils ==============
  function isSupportedChainId(chainId) {
    return chainId === 1 || chainId === 11155111
  }

  function tryChecksum(value) {
    if (!value || !ethers.isAddress(value.trim())) return null
    return value.trim()
  }

  function shortAddress(address) {
    return `${address.slice(0, 6)}…${address.slice(-4)}`
  }

  function getExplorerTxUrl(chainId, hash) {
    if (chainId === 1) return `https://etherscan.io/tx/${hash}`
    if (chainId === 11155111) return `https://sepolia.etherscan.io/tx/${hash}`
    return null
  }

  function getExplorerAddressUrl(chainId, address) {
    if (chainId === 1) return `https://etherscan.io/address/${address}`
    if (chainId === 11155111) return `https://sepolia.etherscan.io/address/${address}`
    return null
  }

  function encodeSetMintLimit(account, limit) {
    return governanceInterface.encodeFunctionData('setMintLimit', [account, limit])
  }

  function buildSafeTxParams({ governanceProxy, mintLimitAccount, limit, nonce }) {
    return {
      to: governanceProxy,
      value: 0n,
      data: encodeSetMintLimit(mintLimitAccount, limit),
      operation: 0,
      safeTxGas: 0n,
      baseGas: 0n,
      gasPrice: 0n,
      gasToken: ZERO_ADDRESS,
      refundReceiver: ZERO_ADDRESS,
      nonce,
    }
  }

  function prevalidatedSignature(ownerAddress) {
    const r = ethers.zeroPadValue(ownerAddress, 32)
    const s = '0x' + '00'.repeat(32)
    const v = '01'
    return r + s.slice(2) + v
  }

  function sortAddresses(addresses) {
    return [...addresses].sort((a, b) => {
      const aa = BigInt(a.toLowerCase())
      const bb = BigInt(b.toLowerCase())
      return aa < bb ? -1 : aa > bb ? 1 : 0
    })
  }

  function buildPrevalidatedSignatures(ownerAddresses) {
    const sorted = sortAddresses(ownerAddresses)
    return '0x' + sorted.map((addr) => prevalidatedSignature(addr).slice(2)).join('')
  }

  function pickApprovedOwnersForThreshold(approvals, threshold) {
    const approvedOwners = approvals.filter((x) => x.approved).map((x) => x.owner)
    if (BigInt(approvedOwners.length) < threshold) {
      throw new Error(
        `Недостаточно on-chain approvals: ${approvedOwners.length}/${threshold.toString()}`,
      )
    }
    return sortAddresses(approvedOwners).slice(0, Number(threshold))
  }

  function parseLimitInput(value, mode, decimals) {
    const trimmed = value.trim()
    if (!trimmed) throw new Error('Укажите лимит')
    if (mode === 'raw') {
      if (!/^\d+$/.test(trimmed)) {
        throw new Error('Лимит (raw) должен быть целым числом без пробелов')
      }
      return BigInt(trimmed)
    }
    const normalized = trimmed.replace(',', '.')
    if (!/^\d+(\.\d+)?$/.test(normalized)) {
      throw new Error('Некорректный формат human-лимита')
    }
    const [whole, fraction = ''] = normalized.split('.')
    if (fraction.length > decimals) {
      throw new Error(`Слишком много знаков после запятой (макс. ${decimals})`)
    }
    return BigInt(`${whole}${fraction.padEnd(decimals, '0')}`)
  }

  function formatRawLimit(value, decimals, human) {
    if (!human) return value.toString()
    const negative = value < 0n
    const abs = negative ? -value : value
    const raw = abs.toString().padStart(decimals + 1, '0')
    const whole = raw.slice(0, -decimals) || '0'
    const fraction = raw.slice(-decimals).replace(/0+$/, '')
    const formatted = fraction ? `${whole}.${fraction}` : whole
    return negative ? `-${formatted}` : formatted
  }

  function errMsg(e) {
    return e instanceof Error ? e.message : String(e)
  }

  // ============== DOM ==============
  const $ = (id) => document.getElementById(id)

  const els = {
    walletBar: $('wallet-bar'),
    viewDisconnected: $('view-disconnected'),
    viewNonOwner: $('view-non-owner'),
    viewApp: $('view-app'),
    mmMissing: $('mm-missing'),
    connectError: $('connect-error'),
    btnConnect: $('btn-connect'),
    nonOwnerAddr: $('non-owner-addr'),
    btnDisconnectNonOwner: $('btn-disconnect-non-owner'),
    tabCreate: $('tab-create'),
    tabSigning: $('tab-signing'),
    chainName: $('chain-name'),
    probingHint: $('probing-hint'),
    unsupportedChain: $('unsupported-chain'),
    modeBody: $('mode-body'),
    safeInput: $('safe-input'),
    governanceInput: $('governance-input'),
    mintAccountInput: $('mint-account-input'),
    safeInvalid: $('safe-invalid'),
    safeExplorer: $('safe-explorer'),
    safeMeta: $('safe-meta'),
    safeMetaStatus: $('safe-meta-status'),
    safeMetaError: $('safe-meta-error'),
    safeMetaThreshold: $('safe-meta-threshold'),
    safeMetaNonce: $('safe-meta-nonce'),
    safeMetaOwner: $('safe-meta-owner'),
    mintLimitValue: $('mint-limit-value'),
    btnRefreshInfo: $('btn-refresh-info'),
    limitInput: $('limit-input'),
    msgCreateHint: $('msg-create-hint'),
    msgSigningHint: $('msg-signing-hint'),
    reviewBox: $('review-box'),
    reviewLimit: $('review-limit'),
    reviewHash: $('review-hash'),
    reviewCalldataRow: $('review-calldata-row'),
    reviewCalldata: $('review-calldata'),
    reviewApprovalsRow: $('review-approvals-row'),
    reviewApprovals: $('review-approvals'),
    msgProbeError: $('msg-probe-error'),
    msgError: $('msg-error'),
    msgSuccess: $('msg-success'),
    msgBusy: $('msg-busy'),
    btnCreate: $('btn-create'),
    btnApprove: $('btn-approve'),
    btnExecute: $('btn-execute'),
    ownersPanel: $('owners-panel'),
    ownersCount: $('owners-count'),
    ownersList: $('owners-list'),
  }

  // ============== state ==============
  const state = {
    address: null,
    chainId: null,
    connecting: false,
    intentionallyDisconnected: false,
    mode: 'create',
    safeInfo: null,
    safeInfoError: null,
    safeInfoLoading: false,
    currentMintLimit: null,
    mintLimitError: false,
    mintLimitLoading: false,
    review: null,
    probing: false,
    probeError: null,
    busy: false,
    txConfirming: false,
    error: null,
    success: null,
    pendingHash: null,
    copiedOwner: null,
    probeTimer: null,
  }

  function getEthereum() {
    const eth = window.ethereum
    if (!eth || eth.isMetaMask === false) return null
    return eth
  }

  function getProvider() {
    const eth = getEthereum()
    if (!eth) throw new Error('MetaMask не найден')
    return new ethers.BrowserProvider(eth)
  }

  async function getSigner() {
    return getProvider().getSigner()
  }

  function isConnected() {
    return !!state.address
  }

  function isSupported() {
    return state.chainId !== null && isSupportedChainId(state.chainId)
  }

  function chainName() {
    if (state.chainId !== null && isSupportedChainId(state.chainId)) {
      return CHAINS[state.chainId].name
    }
    if (state.chainId !== null) return `Chain ${state.chainId}`
    return '—'
  }

  function limitMode() {
    const checked = document.querySelector('input[name="limitMode"]:checked')
    return checked?.value === 'human' ? 'human' : 'raw'
  }

  function isOwner() {
    if (!state.address || !state.safeInfo) return false
    return state.safeInfo.owners.some(
      (o) => o.toLowerCase() === state.address.toLowerCase(),
    )
  }

  function knownNonOwner() {
    if (!state.address || !state.safeInfo) return false
    return !isOwner()
  }

  function formReady() {
    const safe = tryChecksum(els.safeInput.value)
    const gov = tryChecksum(els.governanceInput.value)
    const mint = tryChecksum(els.mintAccountInput.value)
    if (!safe || !gov || !mint || !state.safeInfo || state.safeInfoError) return false
    try {
      parseLimitInput(els.limitInput.value, limitMode(), TOKEN_DECIMALS)
      return true
    } catch {
      return false
    }
  }

  // ============== MetaMask ==============
  async function syncWallet() {
    const eth = getEthereum()
    if (!eth) {
      state.address = null
      state.chainId = null
      render()
      return
    }
    try {
      const provider = new ethers.BrowserProvider(eth)
      const accounts = await provider.send('eth_accounts', [])
      const network = await provider.getNetwork()
      const chainId = Number(network.chainId)
      if (state.intentionallyDisconnected) {
        state.address = null
        state.chainId = chainId
      } else {
        state.address = accounts[0] ?? null
        state.chainId = chainId
      }
    } catch (e) {
      state.error = errMsg(e)
    }
    render()
    if (isConnected() && isSupported()) {
      void loadSafeInfo()
      void loadMintLimit()
      scheduleProbe()
    }
  }

  async function connect() {
    const eth = getEthereum()
    if (!eth) {
      state.error = 'MetaMask не найден. Установите расширение MetaMask.'
      render()
      return
    }
    state.intentionallyDisconnected = false
    state.connecting = true
    state.error = null
    render()
    try {
      const provider = new ethers.BrowserProvider(eth)
      await provider.send('eth_requestAccounts', [])
      const accounts = await provider.send('eth_accounts', [])
      const network = await provider.getNetwork()
      state.address = accounts[0] ?? null
      state.chainId = Number(network.chainId)
      state.connecting = false
    } catch (e) {
      state.intentionallyDisconnected = true
      state.address = null
      state.connecting = false
      state.error = errMsg(e)
    }
    render()
    if (isConnected()) {
      void loadSafeInfo()
      void loadMintLimit()
    }
  }

  async function disconnect() {
    state.intentionallyDisconnected = true
    state.address = null
    state.connecting = false
    state.error = null
    state.safeInfo = null
    state.review = null
    state.mode = 'create'
    render()
    const eth = getEthereum()
    try {
      if (eth?.request) {
        await eth.request({
          method: 'wallet_revokePermissions',
          params: [{ eth_accounts: {} }],
        })
      }
    } catch {
      // ok
    }
  }

  async function switchChain(target) {
    const eth = getEthereum()
    if (!eth?.request) throw new Error('MetaMask не найден')
    const chain = CHAINS[target]
    try {
      await eth.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: chain.hex }],
      })
    } catch (e) {
      if (e?.code === 4902) {
        throw new Error(
          `Сеть ${chain.name} не добавлена в MetaMask. Добавьте её вручную и повторите.`,
        )
      }
      throw new Error(e?.message ?? String(e))
    }
  }

  // ============== Safe / governance ==============
  async function loadSafeInfo() {
    const safeAddress = tryChecksum(els.safeInput.value)
    if (!safeAddress || !isConnected()) {
      state.safeInfo = null
      state.safeInfoError = null
      render()
      return
    }
    state.safeInfoLoading = true
    state.safeInfoError = null
    render()
    try {
      const provider = getProvider()
      const safe = new ethers.Contract(safeAddress, SAFE_ABI, provider)
      const [owners, threshold, nonce] = await Promise.all([
        safe.getOwners(),
        safe.getThreshold(),
        safe.nonce(),
      ])
      state.safeInfo = { owners, threshold, nonce }
    } catch (e) {
      state.safeInfo = null
      state.safeInfoError =
        e instanceof Error
          ? e.message
          : 'Не удалось прочитать Safe. Проверьте адрес и сеть.'
    } finally {
      state.safeInfoLoading = false
      render()
      scheduleProbe()
    }
  }

  async function loadMintLimit() {
    const governanceAddress = tryChecksum(els.governanceInput.value)
    const mintAccount = tryChecksum(els.mintAccountInput.value)
    if (!governanceAddress || !mintAccount || !isConnected()) {
      state.currentMintLimit = null
      state.mintLimitError = false
      render()
      return
    }
    state.mintLimitLoading = true
    state.mintLimitError = false
    render()
    try {
      const provider = getProvider()
      const governance = new ethers.Contract(governanceAddress, GOVERNANCE_ABI, provider)
      state.currentMintLimit = await governance.actualMintLimit(mintAccount)
    } catch {
      state.currentMintLimit = null
      state.mintLimitError = true
    } finally {
      state.mintLimitLoading = false
      render()
    }
  }

  async function loadApprovals(hash, ownerList) {
    const safeAddress = tryChecksum(els.safeInput.value)
    if (!safeAddress) return []
    const provider = getProvider()
    const safe = new ethers.Contract(safeAddress, SAFE_ABI, provider)
    return Promise.all(
      ownerList.map(async (owner) => {
        const approved = await safe.approvedHashes(owner, hash)
        return { owner, approved: approved !== 0n }
      }),
    )
  }

  async function buildReview() {
    if (!isConnected()) throw new Error('MetaMask не подключён')
    const safeAddress = tryChecksum(els.safeInput.value)
    const governanceAddress = tryChecksum(els.governanceInput.value)
    const mintAccount = tryChecksum(els.mintAccountInput.value)
    if (!safeAddress) throw new Error('Укажите корректный адрес Safe')
    if (!governanceAddress) throw new Error('Укажите корректный адрес Governance proxy')
    if (!mintAccount) throw new Error('Укажите корректный Mint limit account')
    if (!state.safeInfo) throw new Error('Не удалось прочитать Safe (owners / threshold / nonce)')
    if (state.safeInfoError) throw new Error('Адрес не похож на Gnosis Safe на этой сети')

    const provider = getProvider()
    const safe = new ethers.Contract(safeAddress, SAFE_ABI, provider)
    const nonce = await safe.nonce()
    const limit = parseLimitInput(els.limitInput.value, limitMode(), TOKEN_DECIMALS)
    const txParams = buildSafeTxParams({
      governanceProxy: governanceAddress,
      mintLimitAccount: mintAccount,
      limit,
      nonce,
    })
    const safeTxHash = await safe.getTransactionHash(
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
    )
    const approvals = await loadApprovals(safeTxHash, state.safeInfo.owners)
    if (state.safeInfo && state.safeInfo.nonce !== nonce) {
      state.safeInfo = { ...state.safeInfo, nonce }
    }
    return { txParams, safeTxHash, limit, approvals }
  }

  function applyReview(built) {
    state.review = built
    const count = built.approvals.filter((a) => a.approved).length
    state.mode = count > 0 ? 'signing' : 'create'
  }

  function scheduleProbe() {
    if (state.probeTimer) window.clearTimeout(state.probeTimer)
    state.probeTimer = window.setTimeout(() => {
      void runProbe()
    }, 450)
  }

  async function runProbe() {
    if (!isConnected() || !isSupported() || !formReady() || state.busy || state.txConfirming) {
      return
    }
    state.probing = true
    state.probeError = null
    render()
    try {
      const built = await buildReview()
      applyReview(built)
    } catch (e) {
      state.probeError = errMsg(e)
      state.review = null
      state.mode = 'create'
    } finally {
      state.probing = false
      render()
    }
  }

  async function waitAndFinish(hash) {
    state.pendingHash = hash
    state.txConfirming = true
    state.success = `Транзакция отправлена: ${shortAddress(hash)}`
    render()
    try {
      const provider = getProvider()
      const receipt = await provider.waitForTransaction(hash)
      if (receipt?.status === 1) {
        state.success = `Транзакция подтверждена: ${shortAddress(hash)}`
      } else {
        state.error = 'Транзакция завершилась с ошибкой (status ≠ 1)'
      }
      await Promise.all([loadSafeInfo(), loadMintLimit()])
      try {
        const built = await buildReview()
        applyReview(built)
      } catch {
        // optional
      }
    } finally {
      state.txConfirming = false
      state.busy = false
      render()
    }
  }

  async function handleCreateOrApprove() {
    state.error = null
    state.success = null
    state.busy = true
    render()
    try {
      if (!state.address) throw new Error('Кошелёк не подключён')
      if (!isOwner()) throw new Error('Подключённый адрес не является owner Safe')
      const safeAddress = tryChecksum(els.safeInput.value)
      if (!safeAddress) throw new Error('Укажите Safe')

      const built = await buildReview()
      applyReview(built)

      const mine = built.approvals.find(
        (a) => a.owner.toLowerCase() === state.address.toLowerCase(),
      )
      if (mine?.approved) {
        state.success = 'Этот owner уже подписал этот exact Safe tx hash on-chain.'
        state.busy = false
        render()
        return
      }

      const signer = await getSigner()
      const safe = new ethers.Contract(safeAddress, SAFE_ABI, signer)
      const tx = await safe.approveHash(built.safeTxHash)
      await waitAndFinish(tx.hash)
    } catch (e) {
      state.error = errMsg(e)
      state.busy = false
      render()
    }
  }

  async function handleExecute() {
    state.error = null
    state.success = null
    state.busy = true
    render()
    try {
      const safeAddress = tryChecksum(els.safeInput.value)
      if (!safeAddress) throw new Error('Нет Safe')
      if (!state.safeInfo) throw new Error('Threshold не загружен')

      const built = await buildReview()
      applyReview(built)

      const approvedOwners = pickApprovedOwnersForThreshold(
        built.approvals,
        state.safeInfo.threshold,
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

      const signer = await getSigner()
      const safe = new ethers.Contract(safeAddress, SAFE_ABI, signer)
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
      await waitAndFinish(tx.hash)
    } catch (e) {
      state.error = errMsg(e)
      state.busy = false
      render()
    }
  }

  // ============== render ==============
  function setHidden(el, hidden) {
    if (!el) return
    el.hidden = !!hidden
  }

  function setText(el, text) {
    if (el) el.textContent = text ?? ''
  }

  function renderWalletBar() {
    const hasMM = !!getEthereum()
    if (!isConnected()) {
      els.walletBar.innerHTML = `
        <button type="button" class="btn btn--header" id="hdr-connect"
          ${state.connecting || !hasMM ? 'disabled' : ''}>
          ${state.connecting ? 'Подключение…' : 'MetaMask'}
        </button>`
      $('hdr-connect')?.addEventListener('click', () => void connect())
      return
    }
    els.walletBar.innerHTML = `
      <span class="wallet-bar__chain">${chainName()}</span>
      <span class="wallet-bar__addr">${shortAddress(state.address)}</span>
      <button type="button" class="btn btn--header btn--header-ghost" id="hdr-disconnect">
        Отключить
      </button>`
    $('hdr-disconnect')?.addEventListener('click', () => void disconnect())
  }

  function renderViews() {
    const showDisconnected = !isConnected()
    const showNonOwner = isConnected() && knownNonOwner()
    const showApp = isConnected() && !knownNonOwner()

    setHidden(els.viewDisconnected, !showDisconnected)
    setHidden(els.viewNonOwner, !showNonOwner)
    setHidden(els.viewApp, !showApp)

    if (showDisconnected) {
      setHidden(els.mmMissing, !!getEthereum())
      if (state.error) {
        setHidden(els.connectError, false)
        setText(els.connectError, state.error)
      } else {
        setHidden(els.connectError, true)
      }
      els.btnConnect.disabled = state.connecting || !getEthereum()
      els.btnConnect.innerHTML = state.connecting
        ? '<span class="btn__spinner"></span> Подключить MetaMask'
        : 'Подключить MetaMask'
    }

    if (showNonOwner) {
      setText(els.nonOwnerAddr, state.address)
    }
  }

  function renderApp() {
    if (!isConnected() || knownNonOwner()) return

    setText(els.chainName, chainName())
    setHidden(els.probingHint, !state.probing)
    setHidden(els.unsupportedChain, isSupported())

    document.querySelectorAll('[data-chain]').forEach((btn) => {
      const id = Number(btn.getAttribute('data-chain'))
      btn.classList.toggle('chip--active', state.chainId === id)
      btn.disabled = state.busy || state.txConfirming || state.chainId === id
    })

    const signing = state.mode === 'signing'
    els.tabCreate.classList.toggle('mode-tabs__item--active', !signing)
    els.tabCreate.setAttribute('aria-selected', String(!signing))
    els.tabSigning.classList.toggle('mode-tabs__item--active', signing)
    els.tabSigning.setAttribute('aria-selected', String(signing))
    els.tabSigning.disabled = !signing
    els.modeBody.className = `mode-body mode-body--${state.mode}`

    const safeAddr = tryChecksum(els.safeInput.value)
    setHidden(els.safeInvalid, !(els.safeInput.value && !safeAddr))
    const explorer = safeAddr ? getExplorerAddressUrl(state.chainId ?? 0, safeAddr) : null
    if (explorer) {
      setHidden(els.safeExplorer, false)
      els.safeExplorer.querySelector('a').href = explorer
    } else {
      setHidden(els.safeExplorer, true)
    }

    setHidden(els.safeMeta, !els.safeInput.value.trim())
    setHidden(els.safeMetaStatus, !state.safeInfoLoading)
    if (state.safeInfoError) {
      setHidden(els.safeMetaError, false)
      setText(els.safeMetaError.querySelector('.meta-box__value'), state.safeInfoError)
    } else {
      setHidden(els.safeMetaError, true)
    }
    if (state.safeInfo) {
      setHidden(els.safeMetaThreshold, false)
      setHidden(els.safeMetaNonce, false)
      setHidden(els.safeMetaOwner, false)
      setText(
        els.safeMetaThreshold.querySelector('.meta-box__value'),
        state.safeInfo.threshold.toString(),
      )
      setText(
        els.safeMetaNonce.querySelector('.meta-box__value'),
        state.safeInfo.nonce.toString(),
      )
    } else {
      setHidden(els.safeMetaThreshold, true)
      setHidden(els.safeMetaNonce, true)
      setHidden(els.safeMetaOwner, true)
    }

    if (state.mintLimitLoading) {
      setText(els.mintLimitValue, '…')
    } else if (state.mintLimitError) {
      els.mintLimitValue.innerHTML = '<span class="badge badge--muted">нет getter / ошибка</span>'
    } else if (state.currentMintLimit !== null) {
      setText(
        els.mintLimitValue,
        formatRawLimit(state.currentMintLimit, TOKEN_DECIMALS, limitMode() === 'human'),
      )
    } else {
      setText(els.mintLimitValue, '—')
    }

    const approvedCount = state.review?.approvals.filter((a) => a.approved).length ?? 0
    const canExecute =
      !!state.safeInfo && BigInt(approvedCount) >= state.safeInfo.threshold && !!state.review
    const iAlreadyApproved = !!state.review?.approvals.find(
      (a) =>
        state.address &&
        a.owner.toLowerCase() === state.address.toLowerCase() &&
        a.approved,
    )

    setHidden(
      els.msgCreateHint,
      !(state.mode === 'create' && formReady() && !state.probing && state.review && approvedCount === 0),
    )
    setHidden(els.msgSigningHint, state.mode !== 'signing')

    if (state.review) {
      setHidden(els.reviewBox, false)
      setText(els.reviewLimit, state.review.limit.toString())
      setText(els.reviewHash, state.review.safeTxHash)
      if (signing) {
        setHidden(els.reviewCalldataRow, false)
        setHidden(els.reviewApprovalsRow, false)
        setText(els.reviewCalldata, state.review.txParams.data)
        els.reviewApprovals.innerHTML =
          `${approvedCount} / ${state.safeInfo?.threshold.toString() ?? '?'}` +
          (canExecute
            ? ' <span class="badge badge--ok">можно execute</span>'
            : ' <span class="badge badge--warn">мало подписей</span>')
      } else {
        setHidden(els.reviewCalldataRow, true)
        setHidden(els.reviewApprovalsRow, true)
      }
    } else {
      setHidden(els.reviewBox, true)
    }

    if (state.probeError) {
      setHidden(els.msgProbeError, false)
      setText(els.msgProbeError, state.probeError)
    } else {
      setHidden(els.msgProbeError, true)
    }

    if (state.error) {
      setHidden(els.msgError, false)
      setText(els.msgError, state.error)
    } else {
      setHidden(els.msgError, true)
    }

    if (state.success) {
      setHidden(els.msgSuccess, false)
      const link = state.pendingHash
        ? getExplorerTxUrl(state.chainId ?? 0, state.pendingHash)
        : null
      els.msgSuccess.innerHTML =
        state.success +
        (link
          ? ` <a class="message__link" href="${link}" target="_blank" rel="noreferrer">explorer</a>`
          : '')
    } else {
      setHidden(els.msgSuccess, true)
    }

    if (state.busy || state.txConfirming || state.probing) {
      setHidden(els.msgBusy, false)
      setText(
        els.msgBusy,
        state.txConfirming
          ? 'Ждём подтверждения в сети…'
          : state.probing
            ? 'Сверяем параметры с on-chain approveHash…'
            : 'Выполняется…',
      )
    } else {
      setHidden(els.msgBusy, true)
    }

    const locked = state.busy || state.txConfirming
    if (!signing) {
      setHidden(els.btnCreate, false)
      setHidden(els.btnApprove, true)
      setHidden(els.btnExecute, true)
      els.btnCreate.disabled =
        locked || state.probing || !isSupported() || !formReady() || !isOwner()
      els.btnCreate.title = !isOwner() ? 'Нужен owner Safe' : ''
      els.btnCreate.innerHTML =
        locked
          ? '<span class="btn__spinner"></span> Создать предложение'
          : 'Создать предложение'
    } else {
      setHidden(els.btnCreate, true)
      setHidden(els.btnApprove, false)
      setHidden(els.btnExecute, false)
      els.btnApprove.disabled =
        locked || !isOwner() || !isSupported() || iAlreadyApproved
      els.btnApprove.title = !isOwner()
        ? 'Нужен owner Safe'
        : iAlreadyApproved
          ? 'Вы уже подписали'
          : ''
      els.btnApprove.innerHTML = locked
        ? '<span class="btn__spinner btn__spinner--dark"></span> ' +
          (iAlreadyApproved ? 'Уже подписано' : 'Подписать')
        : iAlreadyApproved
          ? 'Уже подписано'
          : 'Подписать'
      els.btnExecute.disabled = locked || !isSupported() || !canExecute
      els.btnExecute.innerHTML = locked
        ? '<span class="btn__spinner"></span> Execute'
        : 'Execute'
    }

    if (signing && state.safeInfo && state.review) {
      setHidden(els.ownersPanel, false)
      setText(els.ownersCount, String(state.safeInfo.owners.length))
      els.ownersList.innerHTML = state.safeInfo.owners
        .map((owner) => {
          const you = state.address?.toLowerCase() === owner.toLowerCase()
          const approved = state.review.approvals.find(
            (a) => a.owner.toLowerCase() === owner.toLowerCase(),
          )?.approved
          const copied = state.copiedOwner?.toLowerCase() === owner.toLowerCase()
          return `<li class="owners__item">
            <span class="owners__addr${you ? ' owners__addr--you' : ''}">
              ${owner}${you ? ' · вы' : ''}
            </span>
            <div class="owners__actions">
              ${
                approved
                  ? '<span class="badge badge--ok">APPROVED</span>'
                  : '<span class="badge badge--muted">not approved</span>'
              }
              <button type="button" class="btn btn--ghost btn--compact" data-copy-owner="${owner}">
                ${copied ? 'Скопировано' : 'Копировать'}
              </button>
            </div>
          </li>`
        })
        .join('')
      els.ownersList.querySelectorAll('[data-copy-owner]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const owner = btn.getAttribute('data-copy-owner')
          void navigator.clipboard.writeText(owner).then(() => {
            state.copiedOwner = owner
            render()
            window.setTimeout(() => {
              if (state.copiedOwner?.toLowerCase() === owner.toLowerCase()) {
                state.copiedOwner = null
                render()
              }
            }, 1500)
          })
        })
      })
    } else {
      setHidden(els.ownersPanel, true)
    }
  }

  function render() {
    renderWalletBar()
    renderViews()
    renderApp()
  }

  function onFormChange(resetReview) {
    if (resetReview) {
      state.review = null
      state.mode = 'create'
      state.error = null
    }
    render()
    void loadSafeInfo()
    void loadMintLimit()
    scheduleProbe()
  }

  // ============== events ==============
  function bindEvents() {
    els.btnConnect.addEventListener('click', () => void connect())
    els.btnDisconnectNonOwner.addEventListener('click', () => void disconnect())
    els.tabCreate.addEventListener('click', () => {
      state.mode = 'create'
      state.review = null
      state.success = null
      state.error = null
      render()
    })

    document.querySelectorAll('[data-chain]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = Number(btn.getAttribute('data-chain'))
        void (async () => {
          state.error = null
          try {
            await switchChain(id)
            state.review = null
            state.mode = 'create'
          } catch (e) {
            state.error = errMsg(e)
          }
          render()
        })()
      })
    })

    els.safeInput.addEventListener('input', () => onFormChange(true))
    els.governanceInput.addEventListener('input', () => onFormChange(true))
    els.mintAccountInput.addEventListener('input', () => onFormChange(true))
    els.limitInput.addEventListener('input', () => {
      state.review = null
      state.mode = 'create'
      render()
      scheduleProbe()
    })
    document.querySelectorAll('input[name="limitMode"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        state.review = null
        state.mode = 'create'
        els.limitInput.placeholder =
          limitMode() === 'raw' ? 'например 1000000000' : 'например 1000.5'
        render()
        scheduleProbe()
      })
    })

    els.btnRefreshInfo.addEventListener('click', () => {
      void loadSafeInfo()
      void loadMintLimit()
    })
    els.btnCreate.addEventListener('click', () => void handleCreateOrApprove())
    els.btnApprove.addEventListener('click', () => void handleCreateOrApprove())
    els.btnExecute.addEventListener('click', () => void handleExecute())

    const eth = getEthereum()
    if (eth?.on) {
      eth.on('accountsChanged', (accounts) => {
        if (!Array.isArray(accounts) || accounts.length === 0) {
          state.intentionallyDisconnected = true
        }
        void syncWallet()
      })
      eth.on('chainChanged', () => void syncWallet())
    }
  }

  // ============== init ==============
  function init() {
    els.safeInput.value = DEFAULTS.safeAddress
    els.governanceInput.value = DEFAULTS.governanceProxy
    els.mintAccountInput.value = DEFAULTS.mintLimitAccount
    bindEvents()
    render()
    void syncWallet()
  }

  init()
})()
