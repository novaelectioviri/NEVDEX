import './polyfills.js';
import './index.css';
import { fromUnits } from '@ston-fi/sdk';
import {
  APP_NAME,
  ASSET_QUERY_LIMIT,
  DEFAULT_SLIPPAGE,
  DEFAULT_SWAP_TOKEN_ADDRESS,
  NETWORK,
  POOL_QUERY_LIMIT,
  TON_ASSET_ADDRESS,
} from './constants.js';
import { initTelegramBridge } from './telegram.js';
import {
  buildSwapTxParams,
  connectedAddress,
  getStonApiClient,
  getTonConnectUI,
  onWalletChange,
  sendSwapTransaction,
  simulateSwap,
  toUnitsString,
} from './tonconnect.js';
import {
  escapeHtml,
  explainError,
  formatTokenAmount,
  formatUsd,
  shortAddress,
} from './utils.js';

const app = document.querySelector('#app');
if (!app) {
  throw new Error('Missing #app root');
}

const REFRESH_INTERVAL_MS = 90_000;
const stonApiClient = getStonApiClient();

let assets = [];
let topPools = [];
let pairPools = [];

let selectedFromAddress = TON_ASSET_ADDRESS;
let selectedToAddress = DEFAULT_SWAP_TOKEN_ADDRESS;
let offerAmount = '1';
let slippageTolerance = DEFAULT_SLIPPAGE;

let quote = null;
let quoteInputKey = '';
let pairPoolRefreshTimer = null;

let loadingAssets = false;
let loadingTopPools = false;
let loadingPairPools = false;
let loadingQuote = false;
let swapInProgress = false;

let noticeType = '';
let noticeText = '';

let tonConnectUI = null;
let tonConnectReady = false;
let tonConnectInitPromise = null;
let walletAddress = '';

initTelegramBridge();
render();
void bootstrap();

window.setInterval(() => {
  void refreshMarketData({ silent: true });
}, REFRESH_INTERVAL_MS);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    void refreshMarketData({ silent: true });
  }
});

window.addEventListener('unhandledrejection', (event) => {
  setNotice('error', `Async error: ${explainError(event.reason)}`);
  render();
});

async function bootstrap() {
  await Promise.all([
    refreshAssets(),
    refreshTopPools(),
    refreshPairPoolsBySelection(),
  ]);
  setNotice(
    'success',
    'DAO desk ready. Review quote impact first, then execute with wallet approval.',
  );
  render();
}

function normalizeAddress(value) {
  return String(value ?? '').trim();
}

function addressEq(a, b) {
  return normalizeAddress(a).toLowerCase() === normalizeAddress(b).toLowerCase();
}

function normalizeAsset(raw) {
  const decimalsRaw = raw.decimals ?? raw.meta?.decimals ?? 9;
  const decimals = Number.isFinite(Number(decimalsRaw))
    ? Number(decimalsRaw)
    : 9;
  return {
    address: normalizeAddress(raw.contractAddress),
    kind: raw.kind ?? 'Jetton',
    symbol: raw.symbol ?? raw.meta?.symbol ?? 'TOKEN',
    displayName: raw.displayName ?? raw.meta?.displayName ?? raw.symbol ?? 'Token',
    imageUrl: raw.imageUrl ?? raw.meta?.imageUrl ?? '',
    decimals,
    priceUsd: Number(raw.dexPriceUsd ?? 0),
    popularityIndex: Number(raw.popularityIndex ?? 0),
    tags: Array.isArray(raw.tags) ? raw.tags : [],
  };
}

function getAssetByAddress(address) {
  return (
    assets.find((asset) => addressEq(asset.address, address)) ?? null
  );
}

function getFromAsset() {
  return getAssetByAddress(selectedFromAddress);
}

function getToAsset() {
  return getAssetByAddress(selectedToAddress);
}

function pickFallbackTokenAddress(excludedAddress) {
  const fallback =
    assets.find(
      (asset) =>
        !addressEq(asset.address, excludedAddress) &&
        !addressEq(asset.address, TON_ASSET_ADDRESS),
    ) ?? assets.find((asset) => !addressEq(asset.address, excludedAddress));
  return fallback?.address ?? TON_ASSET_ADDRESS;
}

function ensureSelections() {
  if (!getAssetByAddress(selectedFromAddress)) {
    selectedFromAddress = TON_ASSET_ADDRESS;
  }
  if (!getAssetByAddress(selectedToAddress)) {
    const defaultToken = getAssetByAddress(DEFAULT_SWAP_TOKEN_ADDRESS);
    selectedToAddress =
      defaultToken?.address ?? pickFallbackTokenAddress(selectedFromAddress);
  }
  if (addressEq(selectedFromAddress, selectedToAddress)) {
    selectedToAddress = pickFallbackTokenAddress(selectedFromAddress);
  }
}

function setNotice(type, text) {
  noticeType = type;
  noticeText = text;
}

function clearQuote() {
  quote = null;
  quoteInputKey = '';
}

function currentInputKey() {
  return [
    normalizeAddress(selectedFromAddress),
    normalizeAddress(selectedToAddress),
    String(offerAmount),
    String(slippageTolerance),
  ].join('|');
}

function unitsToNumber(units, decimals) {
  try {
    const result = fromUnits(BigInt(String(units ?? '0')), decimals);
    const parsed = Number(result);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

function formatFractionPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return '—';
  }
  return `${(n * 100).toFixed(2)}%`;
}

async function refreshAssets() {
  loadingAssets = true;
  render();
  try {
    const queried = await stonApiClient.queryAssets({
      condition: 'asset:default_symbol',
      sortBy: ['popularity_index:desc'],
      limit: ASSET_QUERY_LIMIT,
    });
    assets = queried
      .map((asset) => normalizeAsset(asset))
      .filter((asset) => asset.address && !asset.tags.includes('asset:blacklisted'))
      .sort((a, b) => b.popularityIndex - a.popularityIndex);

    if (!getAssetByAddress(TON_ASSET_ADDRESS)) {
      assets.unshift({
        address: TON_ASSET_ADDRESS,
        kind: 'Ton',
        symbol: 'TON',
        displayName: 'Toncoin',
        imageUrl: '',
        decimals: 9,
        priceUsd: 0,
        popularityIndex: Number.MAX_SAFE_INTEGER,
        tags: ['asset:essential'],
      });
    }

    ensureSelections();
  } catch (error) {
    setNotice('error', `Failed to load assets: ${explainError(error)}`);
  } finally {
    loadingAssets = false;
    render();
  }
}

async function refreshTopPools() {
  loadingTopPools = true;
  render();
  try {
    topPools = await stonApiClient.queryPools({
      condition: 'pool:dex_major_version:2',
      sortBy: ['popularity_index:desc'],
      limit: POOL_QUERY_LIMIT,
      dexV2: true,
    });
  } catch (error) {
    setNotice('error', `Failed to load pools: ${explainError(error)}`);
  } finally {
    loadingTopPools = false;
    render();
  }
}

async function refreshPairPoolsBySelection() {
  const fromAsset = getFromAsset();
  const toAsset = getToAsset();
  if (!fromAsset || !toAsset || addressEq(fromAsset.address, toAsset.address)) {
    pairPools = [];
    render();
    return;
  }
  loadingPairPools = true;
  render();
  try {
    pairPools = await stonApiClient.getPoolsByAssetPair({
      asset0Address: fromAsset.address,
      asset1Address: toAsset.address,
    });
  } catch {
    pairPools = [];
  } finally {
    loadingPairPools = false;
    render();
  }
}

async function refreshMarketData({ silent = false } = {}) {
  if (!silent) {
    setNotice('info', 'Refreshing market data...');
    render();
  }
  await Promise.all([refreshAssets(), refreshTopPools(), refreshPairPoolsBySelection()]);
  if (!silent) {
    setNotice('success', 'Market data updated.');
    render();
  }
}

async function ensureTonConnectReady(openModal) {
  if (!tonConnectReady) {
    if (!tonConnectInitPromise) {
      tonConnectInitPromise = (async () => {
        tonConnectUI = await getTonConnectUI();
        tonConnectReady = true;
        walletAddress = connectedAddress();
        onWalletChange((address) => {
          walletAddress = address;
          render();
        });
      })().finally(() => {
        tonConnectInitPromise = null;
      });
    }
    await tonConnectInitPromise;
  }

  if (openModal && tonConnectUI && !connectedAddress()) {
    await tonConnectUI.openModal();
  }

  walletAddress = connectedAddress();
}

function validateSwapInputs() {
  const fromAsset = getFromAsset();
  const toAsset = getToAsset();
  if (!fromAsset || !toAsset) {
    return 'Select both assets.';
  }
  if (addressEq(fromAsset.address, toAsset.address)) {
    return 'From and To assets must be different.';
  }
  const numericAmount = Number(offerAmount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return 'Enter a valid positive amount.';
  }
  const numericSlippage = Number(slippageTolerance);
  if (!Number.isFinite(numericSlippage) || numericSlippage <= 0 || numericSlippage >= 0.5) {
    return 'Set slippage between 0 and 0.5 (e.g. 0.01 = 1%).';
  }
  return '';
}

async function handleQuote() {
  if (loadingQuote) {
    return;
  }
  const validationError = validateSwapInputs();
  if (validationError) {
    setNotice('error', validationError);
    render();
    return;
  }

  const fromAsset = getFromAsset();
  const toAsset = getToAsset();
  if (!fromAsset || !toAsset) {
    return;
  }

  let offerUnits = '';
  try {
    offerUnits = toUnitsString(offerAmount, fromAsset.decimals);
  } catch (error) {
    setNotice('error', `Invalid input amount: ${explainError(error)}`);
    render();
    return;
  }

  loadingQuote = true;
  setNotice('info', 'Requesting swap quote...');
  render();

  try {
    quote = await simulateSwap({
      offerAddress: fromAsset.address,
      askAddress: toAsset.address,
      offerUnits,
      slippageTolerance: slippageTolerance || DEFAULT_SLIPPAGE,
    });
    quoteInputKey = currentInputKey();
    setNotice('success', 'Quote updated. Check route and impact before execution.');
    await refreshPairPoolsBySelection();
  } catch (error) {
    quote = null;
    quoteInputKey = '';
    setNotice('error', `Quote failed: ${explainError(error)}`);
  } finally {
    loadingQuote = false;
    render();
  }
}

async function handleSwap() {
  if (swapInProgress) {
    return;
  }
  const validationError = validateSwapInputs();
  if (validationError) {
    setNotice('error', validationError);
    render();
    return;
  }

  try {
    await ensureTonConnectReady(true);
    if (!walletAddress) {
      setNotice('error', 'Connect wallet first.');
      render();
      return;
    }
    if (!quote || quoteInputKey !== currentInputKey()) {
      await handleQuote();
      if (!quote) {
        return;
      }
    }

    swapInProgress = true;
    setNotice('info', 'Preparing accountable on-chain execution...');
    render();

    const txParams = await buildSwapTxParams({
      userWalletAddress: walletAddress,
      simulationResult: quote,
    });
    await sendSwapTransaction({
      address: txParams.to.toString(),
      amount: txParams.value.toString(),
      payload: txParams.body?.toBoc().toString('base64'),
    });

    setNotice(
      'success',
      'Swap request sent to wallet. Confirm to finalize on-chain.',
    );
  } catch (error) {
    setNotice('error', `Swap failed: ${explainError(error)}`);
  } finally {
    swapInProgress = false;
    render();
  }
}

function onSwapInputsChanged() {
  clearQuote();
  setNotice('', '');
  render();
  if (pairPoolRefreshTimer) {
    window.clearTimeout(pairPoolRefreshTimer);
  }
  pairPoolRefreshTimer = window.setTimeout(() => {
    pairPoolRefreshTimer = null;
    void refreshPairPoolsBySelection();
  }, 220);
}

function setBuyMode() {
  const ton = getAssetByAddress(TON_ASSET_ADDRESS);
  if (ton) {
    selectedFromAddress = ton.address;
  }
  if (addressEq(selectedToAddress, selectedFromAddress)) {
    selectedToAddress = pickFallbackTokenAddress(selectedFromAddress);
  }
  onSwapInputsChanged();
}

function setSellMode() {
  const ton = getAssetByAddress(TON_ASSET_ADDRESS);
  if (ton) {
    selectedToAddress = ton.address;
  }
  if (addressEq(selectedFromAddress, selectedToAddress)) {
    selectedFromAddress = pickFallbackTokenAddress(selectedToAddress);
  }
  onSwapInputsChanged();
}

function flipAssets() {
  const from = selectedFromAddress;
  selectedFromAddress = selectedToAddress;
  selectedToAddress = from;
  ensureSelections();
  onSwapInputsChanged();
}

function render() {
  const fromAsset = getFromAsset();
  const toAsset = getToAsset();

  app.innerHTML = `
    <div class="app-shell safe-top safe-bottom min-h-screen">
      <main class="max-w-md mx-auto w-full px-4 py-2 space-y-4">
        ${renderHeader()}
        ${renderMissionPanel()}
        ${renderNotice()}
        ${renderSwapPanel(fromAsset, toAsset)}
        ${renderQuotePanel()}
        ${renderPairPoolsPanel()}
        ${renderTopPoolsPanel()}
      </main>
    </div>
  `;

  bindActions();
  void mountTonConnectButton();
}

async function mountTonConnectButton() {
  try {
    await ensureTonConnectReady(false);
    if (!tonConnectUI) {
      return;
    }
    const connectRoot = document.querySelector('#ton-connect-button');
    if (connectRoot) {
      tonConnectUI.uiOptions = {
        buttonRootId: 'ton-connect-button',
        uiPreferences: { theme: 'SYSTEM' },
      };
    }
  } catch (error) {
    console.error('TonConnect button mount failed', error);
  }
}

function renderHeader() {
  const observedLiquidity = topPools.reduce(
    (sum, pool) => sum + Number(pool.lpTotalSupplyUsd ?? 0),
    0,
  );
  const observedVolume24h = topPools.reduce(
    (sum, pool) => sum + Number(pool.volume24HUsd ?? 0),
    0,
  );

  return `
    <section class="card hero-card space-y-4">
      <div class="flex items-start justify-between gap-3">
        <div class="space-y-2">
          <p class="hero-kicker">DAO Exchange Mission</p>
          <h1 class="text-2xl font-bold">${APP_NAME}</h1>
          <p class="text-sm hero-subtitle">
            Public responsibility first: transparent liquidity, visible execution route, and
            wallet-owned consent.
          </p>
        </div>
        ${renderConnectControl()}
      </div>

      <div class="hero-pill-row">
        <span class="value-pill">Transparency by default</span>
        <span class="value-pill">Community accountability</span>
        <span class="value-pill">Self-custody execution</span>
      </div>

      <div class="hero-metrics">
        <div>
          <p class="metric-label">Observed liquidity</p>
          <p class="metric-value">${formatUsd(observedLiquidity, 0)}</p>
        </div>
        <div>
          <p class="metric-label">Observed 24h volume</p>
          <p class="metric-value">${formatUsd(observedVolume24h, 0)}</p>
        </div>
        <div>
          <p class="metric-label">Wallet status</p>
          <p class="metric-value mono">
            ${walletAddress ? shortAddress(walletAddress) : 'Not connected'}
          </p>
        </div>
      </div>

      <div class="flex items-center justify-end gap-3">
        <button class="btn-secondary" data-action="refresh-market">Refresh market</button>
      </div>

      <p class="text-xs hero-footnote">
        Network: ${NETWORK} • Data source: api.ston.fi • Execution: STON SDK + TonConnect
      </p>
    </section>
  `;
}

function renderMissionPanel() {
  return `
    <section class="card mission-card space-y-3">
      <div class="flex items-center justify-between gap-2">
        <h2 class="text-sm font-semibold uppercase tracking-wide">Public Responsibility Charter</h2>
        <span class="pill consensus">DAO ethics</span>
      </div>
      <div class="mission-grid">
        <p>1. Trade routes are inspectable before any wallet signature.</p>
        <p>2. Market intelligence is sourced from open STON.fi data endpoints.</p>
        <p>3. Users keep custody: execution only happens after explicit wallet approval.</p>
      </div>
    </section>
  `;
}

function renderNotice() {
  if (!noticeText) {
    return '';
  }
  const cls =
    noticeType === 'error'
      ? 'status-banner error'
      : noticeType === 'success'
        ? 'status-banner success'
        : 'status-banner info';
  return `<section class="${cls}">${escapeHtml(noticeText)}</section>`;
}

function renderConnectControl() {
  return '<div class="ton-connect-host"><div id="ton-connect-button"></div></div>';
}

function renderSwapPanel(fromAsset, toAsset) {
  const options = assets
    .map(
      (asset) => `
      <option value="${asset.address}">
        ${escapeHtml(asset.symbol)} — ${escapeHtml(asset.displayName)}
      </option>
    `,
    )
    .join('');

  const swapDisabled =
    swapInProgress || loadingQuote || loadingAssets || !fromAsset || !toAsset;

  return `
    <section class="card space-y-3">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold">Responsible Swap Desk</h2>
        <div class="flex items-center gap-2">
          <button class="btn-secondary" data-action="set-buy">Buy</button>
          <button class="btn-secondary" data-action="set-sell">Sell</button>
        </div>
      </div>
      <p class="text-xs panel-note">
        Select a pair, inspect impact, then execute only if the route matches community standards.
      </p>

      <div>
        <label class="input-label" for="swap-from">From</label>
        <select id="swap-from" class="input-field" ${
          loadingAssets ? 'disabled' : ''
        }>
          ${options}
        </select>
      </div>

      <div>
        <label class="input-label" for="offer-amount">Amount</label>
        <input
          id="offer-amount"
          class="input-field"
          type="number"
          min="0"
          step="0.000001"
          value="${escapeHtml(offerAmount)}"
          placeholder="1.0"
        />
      </div>

      <button class="btn-secondary w-full" data-action="flip-assets">Flip Pair</button>

      <div>
        <label class="input-label" for="swap-to">To</label>
        <select id="swap-to" class="input-field" ${
          loadingAssets ? 'disabled' : ''
        }>
          ${options}
        </select>
      </div>

      <div>
        <label class="input-label" for="swap-slippage">Slippage tolerance (fraction)</label>
        <input
          id="swap-slippage"
          class="input-field"
          type="number"
          min="0.001"
          max="0.5"
          step="0.001"
          value="${escapeHtml(String(slippageTolerance))}"
        />
        <p class="text-xs mt-1" style="color: var(--hint)">
          0.01 = 1%, 0.005 = 0.5%
        </p>
      </div>

      <div class="grid grid-cols-2 gap-2">
        <button class="btn-secondary" data-action="get-quote" ${
          loadingQuote ? 'disabled' : ''
        }>
          ${loadingQuote ? 'Quoting...' : 'Review Quote'}
        </button>
        <button class="btn-primary" data-action="swap" ${
          swapDisabled ? 'disabled' : ''
        }>
          ${swapInProgress ? 'Sending...' : 'Execute Swap'}
        </button>
      </div>
    </section>
  `;
}

function renderQuotePanel() {
  if (!quote) {
    return `
      <section class="card">
        <h3 class="font-semibold">Execution Preview</h3>
        <p class="text-sm mt-2" style="color: var(--hint)">
          Enter pair and amount, then click "Review Quote".
        </p>
      </section>
    `;
  }

  const askAsset = getAssetByAddress(quote.askAddress);
  const offerAsset = getAssetByAddress(quote.offerAddress);
  const feeAsset = getAssetByAddress(quote.feeAddress);
  const askDecimals = askAsset?.decimals ?? 9;
  const feeDecimals = feeAsset?.decimals ?? 9;

  const askAmount = unitsToNumber(quote.askUnits, askDecimals);
  const minAskAmount = unitsToNumber(quote.minAskUnits, askDecimals);
  const feeAmount = unitsToNumber(quote.feeUnits, feeDecimals);
  const forwardGasTon = unitsToNumber(quote.gasParams?.forwardGas ?? '0', 9);
  const estGasTon = unitsToNumber(
    quote.gasParams?.estimatedGasConsumption ?? '0',
    9,
  );

  return `
    <section class="card space-y-2">
      <h3 class="font-semibold">Execution Preview</h3>
      <p class="text-sm">
        ${formatTokenAmount(Number(offerAmount), 6)} ${escapeHtml(
          offerAsset?.symbol ?? 'FROM',
        )} -> ${formatTokenAmount(askAmount, 6)} ${escapeHtml(
          askAsset?.symbol ?? 'TO',
        )}
      </p>
      <p class="text-xs" style="color: var(--hint)">
        Min received: ${formatTokenAmount(minAskAmount, 6)} ${escapeHtml(
          askAsset?.symbol ?? 'TO',
        )}
      </p>
      <p class="text-xs" style="color: var(--hint)">
        Price impact: ${formatFractionPercent(quote.priceImpact)}
      </p>
      <p class="text-xs" style="color: var(--hint)">
        Protocol fee: ${formatTokenAmount(feeAmount, 6)} ${escapeHtml(
          feeAsset?.symbol ?? 'fee token',
        )} (${formatFractionPercent(quote.feePercent)})
      </p>
      <p class="text-xs" style="color: var(--hint)">
        Route: router v${quote.router.majorVersion}.${quote.router.minorVersion} • pool ${shortAddress(
          quote.poolAddress,
        )}
      </p>
      <p class="text-xs" style="color: var(--hint)">
        Gas estimate: forward ${formatTokenAmount(forwardGasTon, 4)} TON, total ${formatTokenAmount(
          estGasTon,
          4,
        )} TON
      </p>
      <p class="text-xs quote-check">
        Responsibility checks: route disclosed, min received protected, wallet signature required.
      </p>
    </section>
  `;
}

function renderPoolRows(pools) {
  return pools
    .map((pool) => {
      const token0 = getAssetByAddress(pool.token0Address);
      const token1 = getAssetByAddress(pool.token1Address);
      return `
        <tr>
          <td>${escapeHtml(token0?.symbol ?? shortAddress(pool.token0Address))}/${escapeHtml(
            token1?.symbol ?? shortAddress(pool.token1Address),
          )}</td>
          <td>${formatUsd(pool.lpTotalSupplyUsd ?? 0, 0)}</td>
          <td>${formatUsd(pool.volume24HUsd ?? 0, 0)}</td>
          <td>${formatFractionPercent(pool.apy30D ?? 0)}</td>
        </tr>
      `;
    })
    .join('');
}

function renderPairPoolsPanel() {
  const fromAsset = getFromAsset();
  const toAsset = getToAsset();
  return `
    <section class="card space-y-2">
      <div class="flex items-center justify-between">
        <h3 class="font-semibold">Community Liquidity by Pair</h3>
        <button class="btn-secondary" data-action="refresh-pair-pools">Reload</button>
      </div>
      <p class="text-xs" style="color: var(--hint)">
        Pair: ${escapeHtml(fromAsset?.symbol ?? 'FROM')} / ${escapeHtml(
          toAsset?.symbol ?? 'TO',
        )}
      </p>
      ${
        loadingPairPools
          ? '<p class="text-sm" style="color: var(--hint)">Loading pair pools...</p>'
          : pairPools.length
            ? `
        <table class="dex-table">
          <thead>
            <tr>
              <th>Pool</th>
              <th>Liquidity</th>
              <th>24h Vol</th>
              <th>APY 30d</th>
            </tr>
          </thead>
          <tbody>
            ${renderPoolRows(pairPools.slice(0, 10))}
          </tbody>
        </table>
      `
            : '<p class="text-sm" style="color: var(--hint)">No pools found for selected pair.</p>'
      }
    </section>
  `;
}

function renderTopPoolsPanel() {
  return `
    <section class="card space-y-2">
      <div class="flex items-center justify-between">
        <h3 class="font-semibold">Open Market Accountability Feed</h3>
        <button class="btn-secondary" data-action="refresh-top-pools">Reload</button>
      </div>
      ${
        loadingTopPools
          ? '<p class="text-sm" style="color: var(--hint)">Loading top pools...</p>'
          : topPools.length
            ? `
        <table class="dex-table">
          <thead>
            <tr>
              <th>Pool</th>
              <th>Liquidity</th>
              <th>24h Vol</th>
              <th>APY 30d</th>
            </tr>
          </thead>
          <tbody>
            ${renderPoolRows(topPools)}
          </tbody>
        </table>
      `
            : '<p class="text-sm" style="color: var(--hint)">No pool data.</p>'
      }
    </section>
  `;
}

function bindActions() {
  const fromSelect = document.querySelector('#swap-from');
  if (fromSelect instanceof HTMLSelectElement) {
    fromSelect.value = selectedFromAddress;
    fromSelect.addEventListener('change', () => {
      selectedFromAddress = fromSelect.value;
      ensureSelections();
      onSwapInputsChanged();
    });
  }

  const toSelect = document.querySelector('#swap-to');
  if (toSelect instanceof HTMLSelectElement) {
    toSelect.value = selectedToAddress;
    toSelect.addEventListener('change', () => {
      selectedToAddress = toSelect.value;
      ensureSelections();
      onSwapInputsChanged();
    });
  }

  const amountInput = document.querySelector('#offer-amount');
  if (amountInput instanceof HTMLInputElement) {
    amountInput.addEventListener('input', () => {
      offerAmount = amountInput.value.trim();
      onSwapInputsChanged();
    });
  }

  const slippageInput = document.querySelector('#swap-slippage');
  if (slippageInput instanceof HTMLInputElement) {
    slippageInput.addEventListener('input', () => {
      slippageTolerance = slippageInput.value.trim() || DEFAULT_SLIPPAGE;
      onSwapInputsChanged();
    });
  }

  document.querySelector('[data-action="refresh-market"]')?.addEventListener('click', () => {
    void refreshMarketData();
  });
  document.querySelector('[data-action="refresh-pair-pools"]')?.addEventListener('click', () => {
    void refreshPairPoolsBySelection();
  });
  document.querySelector('[data-action="refresh-top-pools"]')?.addEventListener('click', () => {
    void refreshTopPools();
  });
  document.querySelector('[data-action="flip-assets"]')?.addEventListener('click', () => {
    flipAssets();
  });
  document.querySelector('[data-action="set-buy"]')?.addEventListener('click', () => {
    setBuyMode();
  });
  document.querySelector('[data-action="set-sell"]')?.addEventListener('click', () => {
    setSellMode();
  });
  document.querySelector('[data-action="get-quote"]')?.addEventListener('click', () => {
    void handleQuote();
  });
  document.querySelector('[data-action="swap"]')?.addEventListener('click', () => {
    void handleSwap();
  });
}
