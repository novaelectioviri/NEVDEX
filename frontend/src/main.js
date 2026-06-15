import './index.css';
import { fromUnits } from '@ston-fi/sdk';
import {
  APP_NAME,
  ASSET_QUERY_LIMIT,
  DEFAULT_SLIPPAGE,
  DEFAULT_SWAP_TOKEN_ADDRESS,
  TON_ASSET_ADDRESS,
} from './constants.js';
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
import { escapeHtml, explainError, formatTokenAmount, shortAddress } from './utils.js';

const app = document.querySelector('#app');
if (!app) {
  throw new Error('Missing #app root');
}

const apiClient = getStonApiClient();

/** @type {Array<{address:string,symbol:string,name:string,decimals:number}>} */
let assets = [];
let selectedFrom = TON_ASSET_ADDRESS;
let selectedTo = DEFAULT_SWAP_TOKEN_ADDRESS;
let amount = '1';
let slippage = DEFAULT_SLIPPAGE;

/** @type {any | null} */
let quote = null;
let quoteKey = '';

let status = '';
let loadingAssets = false;
let loadingQuote = false;
let sending = false;

/** @type {any | null} */
let tonConnectUI = null;
let wallet = '';
let tonReady = false;
let tonInitPromise = null;

render();
void bootstrap();

function normalizeAddress(value) {
  return String(value ?? '').trim();
}

function sameAddress(a, b) {
  return normalizeAddress(a).toLowerCase() === normalizeAddress(b).toLowerCase();
}

function assetByAddress(address) {
  return assets.find((asset) => sameAddress(asset.address, address)) ?? null;
}

function ensureDifferentAssets() {
  if (sameAddress(selectedFrom, selectedTo)) {
    const fallback = assets.find((asset) => !sameAddress(asset.address, selectedFrom));
    if (fallback) {
      selectedTo = fallback.address;
    }
  }
}

function currentKey() {
  return [selectedFrom, selectedTo, amount, slippage].join('|');
}

function toQuoteNumber(units, decimals) {
  try {
    return Number(fromUnits(BigInt(String(units ?? '0')), decimals));
  } catch {
    return 0;
  }
}

function setStatus(text) {
  status = text;
}

async function bootstrap() {
  await Promise.all([loadAssets(), ensureTonConnect(false)]);
  setStatus('Ready.');
  render();
}

async function ensureTonConnect(openModal) {
  if (!tonReady) {
    if (!tonInitPromise) {
      tonInitPromise = (async () => {
        tonConnectUI = await getTonConnectUI();
        onWalletChange((address) => {
          wallet = address;
          render();
        });
        tonReady = true;
      })().finally(() => {
        tonInitPromise = null;
      });
    }
    await tonInitPromise;
  }

  if (openModal && tonConnectUI && !connectedAddress()) {
    await tonConnectUI.openModal();
  }

  wallet = connectedAddress();
}

function normalizeAsset(raw) {
  const decimals = Number(raw.decimals ?? raw.meta?.decimals ?? 9);
  return {
    address: normalizeAddress(raw.contractAddress),
    symbol: raw.symbol ?? raw.meta?.symbol ?? 'TOKEN',
    name: raw.displayName ?? raw.meta?.displayName ?? raw.symbol ?? 'Token',
    decimals: Number.isFinite(decimals) ? decimals : 9,
  };
}

async function loadAssets() {
  loadingAssets = true;
  render();
  try {
    const list = await apiClient.queryAssets({
      condition: 'asset:default_symbol',
      sortBy: ['popularity_index:desc'],
      limit: ASSET_QUERY_LIMIT,
    });
    assets = list
      .map(normalizeAsset)
      .filter((asset) => asset.address);

    if (!assetByAddress(TON_ASSET_ADDRESS)) {
      assets.unshift({
        address: TON_ASSET_ADDRESS,
        symbol: 'TON',
        name: 'Toncoin',
        decimals: 9,
      });
    }

    if (!assetByAddress(selectedFrom)) {
      selectedFrom = TON_ASSET_ADDRESS;
    }
    if (!assetByAddress(selectedTo)) {
      const fallback = assets.find((a) => !sameAddress(a.address, selectedFrom));
      selectedTo = fallback?.address ?? selectedFrom;
    }
    ensureDifferentAssets();
  } catch (error) {
    setStatus(`Failed to load assets: ${explainError(error)}`);
  } finally {
    loadingAssets = false;
    render();
  }
}

function validateInputs() {
  const fromAsset = assetByAddress(selectedFrom);
  const toAsset = assetByAddress(selectedTo);
  if (!fromAsset || !toAsset) {
    return 'Select both assets.';
  }
  if (sameAddress(fromAsset.address, toAsset.address)) {
    return 'Assets must be different.';
  }
  const numAmount = Number(amount);
  if (!Number.isFinite(numAmount) || numAmount <= 0) {
    return 'Enter a positive amount.';
  }
  const numSlippage = Number(slippage);
  if (!Number.isFinite(numSlippage) || numSlippage <= 0 || numSlippage >= 0.5) {
    return 'Slippage must be in range (0, 0.5).';
  }
  return '';
}

async function handleQuote() {
  if (loadingQuote) {
    return;
  }
  const error = validateInputs();
  if (error) {
    setStatus(error);
    render();
    return;
  }

  const fromAsset = assetByAddress(selectedFrom);
  const toAsset = assetByAddress(selectedTo);
  if (!fromAsset || !toAsset) {
    return;
  }

  let offerUnits = '';
  try {
    offerUnits = toUnitsString(amount, fromAsset.decimals);
  } catch (errorUnits) {
    setStatus(`Invalid amount: ${explainError(errorUnits)}`);
    render();
    return;
  }

  loadingQuote = true;
  setStatus('Requesting quote...');
  render();

  try {
    quote = await simulateSwap({
      offerAddress: fromAsset.address,
      askAddress: toAsset.address,
      offerUnits,
      slippageTolerance: slippage,
    });
    quoteKey = currentKey();
    setStatus('Quote updated.');
  } catch (errorQuote) {
    quote = null;
    quoteKey = '';
    setStatus(`Quote failed: ${explainError(errorQuote)}`);
  } finally {
    loadingQuote = false;
    render();
  }
}

async function handleSwap() {
  if (sending) {
    return;
  }
  const error = validateInputs();
  if (error) {
    setStatus(error);
    render();
    return;
  }

  try {
    await ensureTonConnect(true);
    if (!wallet) {
      setStatus('Connect wallet first.');
      render();
      return;
    }

    if (!quote || quoteKey !== currentKey()) {
      await handleQuote();
      if (!quote) {
        return;
      }
    }

    sending = true;
    setStatus('Preparing transaction...');
    render();

    const txParams = await buildSwapTxParams({
      userWalletAddress: wallet,
      simulationResult: quote,
    });

    await sendSwapTransaction({
      address: txParams.to.toString(),
      amount: txParams.value.toString(),
      payload: txParams.body?.toBoc().toString('base64'),
    });

    setStatus('Transaction sent to wallet.');
  } catch (errorSwap) {
    setStatus(`Swap failed: ${explainError(errorSwap)}`);
  } finally {
    sending = false;
    render();
  }
}

function flipAssets() {
  const from = selectedFrom;
  selectedFrom = selectedTo;
  selectedTo = from;
  ensureDifferentAssets();
  quote = null;
  quoteKey = '';
  setStatus('');
  render();
}

async function connectWallet() {
  try {
    await ensureTonConnect(true);
    render();
  } catch (error) {
    setStatus(`Wallet connect failed: ${explainError(error)}`);
    render();
  }
}

function renderQuote() {
  if (!quote) {
    return '<p class="muted">No quote yet.</p>';
  }

  const fromAsset = assetByAddress(quote.offerAddress);
  const toAsset = assetByAddress(quote.askAddress);
  const feeAsset = assetByAddress(quote.feeAddress);
  const fromSymbol = escapeHtml(fromAsset?.symbol ?? 'FROM');
  const toSymbol = escapeHtml(toAsset?.symbol ?? 'TO');
  const feeSymbol = escapeHtml(feeAsset?.symbol ?? 'FEE');
  const askAmount = toQuoteNumber(quote.askUnits, toAsset?.decimals ?? 9);
  const minReceived = toQuoteNumber(quote.minAskUnits, toAsset?.decimals ?? 9);
  const feeAmount = toQuoteNumber(quote.feeUnits, feeAsset?.decimals ?? 9);
  const impactPct = Number(quote.priceImpact ?? 0) * 100;

  return `
    <div class="quote">
      <div><span>Expected</span><strong>${formatTokenAmount(askAmount, 6)} ${toSymbol}</strong></div>
      <div><span>Min received</span><strong>${formatTokenAmount(minReceived, 6)} ${toSymbol}</strong></div>
      <div><span>Price impact</span><strong>${impactPct.toFixed(2)}%</strong></div>
      <div><span>Fee</span><strong>${formatTokenAmount(feeAmount, 6)} ${feeSymbol}</strong></div>
      <div><span>Route</span><strong>${fromSymbol} -> ${toSymbol}</strong></div>
    </div>
  `;
}

function render() {
  const fromOptions = assets
    .map(
      (asset) =>
        `<option value="${escapeHtml(asset.address)}">${escapeHtml(asset.symbol)} - ${escapeHtml(asset.name)}</option>`,
    )
    .join('');
  const walletLabel = wallet ? shortAddress(wallet) : 'Connect';

  app.innerHTML = `
    <main class="container">
      <header class="header">
        <h1>${APP_NAME}</h1>
        <p class="muted">Minimal TON swap interface on STON.fi</p>
      </header>

      <section class="panel">
        <div class="row space-between">
          <span class="label">Wallet</span>
          <button class="button button-ghost" id="connect-wallet">
            ${escapeHtml(walletLabel)}
          </button>
        </div>
      </section>

      <section class="panel">
        <label class="label" for="from-asset">From</label>
        <select id="from-asset" ${loadingAssets ? 'disabled' : ''}>${fromOptions}</select>

        <label class="label" for="amount-input">Amount</label>
        <input id="amount-input" type="number" min="0" step="0.000001" value="${amount}" />

        <div class="row center">
          <button class="button button-ghost" id="flip-assets">Flip</button>
        </div>

        <label class="label" for="to-asset">To</label>
        <select id="to-asset" ${loadingAssets ? 'disabled' : ''}>${fromOptions}</select>

        <label class="label" for="slippage-input">Slippage (fraction)</label>
        <input id="slippage-input" type="number" min="0.001" max="0.5" step="0.001" value="${slippage}" />

        <div class="actions">
          <button class="button button-ghost" id="refresh-assets" ${loadingAssets ? 'disabled' : ''}>
            ${loadingAssets ? 'Loading...' : 'Refresh assets'}
          </button>
          <button class="button" id="get-quote" ${loadingQuote ? 'disabled' : ''}>
            ${loadingQuote ? 'Quoting...' : 'Get quote'}
          </button>
          <button class="button" id="send-swap" ${sending ? 'disabled' : ''}>
            ${sending ? 'Sending...' : 'Swap'}
          </button>
        </div>
      </section>

      <section class="panel">
        <h2>Quote</h2>
        ${renderQuote()}
      </section>

      <p class="status">${escapeHtml(status || ' ')}</p>
    </main>
  `;

  bind();
}

function bind() {
  const fromSelect = document.querySelector('#from-asset');
  if (fromSelect instanceof HTMLSelectElement) {
    fromSelect.value = selectedFrom;
    fromSelect.addEventListener('change', () => {
      selectedFrom = fromSelect.value;
      ensureDifferentAssets();
      quote = null;
      quoteKey = '';
      render();
    });
  }

  const toSelect = document.querySelector('#to-asset');
  if (toSelect instanceof HTMLSelectElement) {
    toSelect.value = selectedTo;
    toSelect.addEventListener('change', () => {
      selectedTo = toSelect.value;
      ensureDifferentAssets();
      quote = null;
      quoteKey = '';
      render();
    });
  }

  const amountInput = document.querySelector('#amount-input');
  if (amountInput instanceof HTMLInputElement) {
    amountInput.addEventListener('input', () => {
      amount = amountInput.value.trim();
      quote = null;
      quoteKey = '';
    });
  }

  const slippageInput = document.querySelector('#slippage-input');
  if (slippageInput instanceof HTMLInputElement) {
    slippageInput.addEventListener('input', () => {
      slippage = slippageInput.value.trim() || DEFAULT_SLIPPAGE;
      quote = null;
      quoteKey = '';
    });
  }

  document.querySelector('#refresh-assets')?.addEventListener('click', () => {
    void loadAssets();
  });
  document.querySelector('#get-quote')?.addEventListener('click', () => {
    void handleQuote();
  });
  document.querySelector('#send-swap')?.addEventListener('click', () => {
    void handleSwap();
  });
  document.querySelector('#flip-assets')?.addEventListener('click', () => {
    flipAssets();
  });
  document.querySelector('#connect-wallet')?.addEventListener('click', () => {
    void connectWallet();
  });
}
