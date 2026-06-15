import {
  DEFAULT_SLIPPAGE,
  NETWORK,
  sanitizeOptionalUrl,
  TON_ASSET_ADDRESS,
  TON_RPC_ENDPOINT,
  TONCONNECT_MANIFEST_URL,
} from './constants.js';
import { StonApiClient } from '@ston-fi/api';
import { Client, dexFactory, toUnits } from '@ston-fi/sdk';

const DEFAULT_REMOTE_MANIFEST_URL =
  'https://novaelectioviri.github.io/NEVDEX/tonconnect-manifest.json';
const DEFAULT_REMOTE_WALLETS_LIST_URL =
  'https://novaelectioviri.github.io/NEVDEX/wallets-v2.json';
const TONCONNECT_STORAGE_MIGRATION_KEY = 'nevdex-tonconnect-storage-v2-cleared';

function resolveManifestUrl() {
  const explicitManifestUrl = sanitizeOptionalUrl(TONCONNECT_MANIFEST_URL);
  if (explicitManifestUrl) {
    return explicitManifestUrl;
  }

  const protocol = window.location.protocol;
  const isLocalhost =
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1';
  const isUnsafeProtocol = protocol !== 'https:' && protocol !== 'chrome-extension:';

  if (isLocalhost || isUnsafeProtocol) {
    return DEFAULT_REMOTE_MANIFEST_URL;
  }

  return new URL('./tonconnect-manifest.json', window.location.href.split('#')[0]).toString();
}

const manifestUrl = resolveManifestUrl();

function resolveWalletsListSource() {
  const protocol = window.location.protocol;
  const isLocalhost =
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1';
  const isUnsafeProtocol = protocol !== 'https:' && protocol !== 'chrome-extension:';

  if (isLocalhost || isUnsafeProtocol) {
    return DEFAULT_REMOTE_WALLETS_LIST_URL;
  }

  return new URL('./wallets-v2.json', window.location.href.split('#')[0]).toString();
}

const walletsListSource = resolveWalletsListSource();

function clearLegacyTonConnectStorageOnce() {
  try {
    if (localStorage.getItem(TONCONNECT_STORAGE_MIGRATION_KEY) === '1') {
      return;
    }

    const exactKeys = [
      'ton-connect-storage_bridge-connection',
      'ton-connect-ui_wallet-info',
      'ton-connect-ui_last-selected-wallet-info',
      'ton-connect-ui_preferred-wallet',
    ];
    for (const key of exactKeys) {
      localStorage.removeItem(key);
    }

    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (!key) {
        continue;
      }
      if (key.startsWith('ton-connect-storage_http-bridge-gateway::')) {
        localStorage.removeItem(key);
      }
    }

    localStorage.setItem(TONCONNECT_STORAGE_MIGRATION_KEY, '1');
  } catch {
    // Ignore localStorage access errors in hardened browsers.
  }
}

/** @type {any | null} */
let tonConnectUI = null;

/** @type {Promise<any> | null} */
let tonConnectLoadingPromise = null;

/**
 * @returns {Promise<any>}
 */
export async function getTonConnectUI() {
  if (!tonConnectUI) {
    clearLegacyTonConnectStorageOnce();
    if (!tonConnectLoadingPromise) {
      tonConnectLoadingPromise = import('@tonconnect/ui').then(({ TonConnect, TonConnectUI }) => {
        const connector = new TonConnect({
          manifestUrl,
          walletsListSource,
          analytics: { mode: 'off' },
        });
        tonConnectUI = new TonConnectUI({
          connector,
          // Avoid aggressive bridge reconnect loops on page load in browsers/networks
          // where wallet bridge SSE is blocked; connect explicitly on user action.
          restoreConnection: false,
          analytics: { mode: 'off' },
          uiPreferences: {
            theme: 'SYSTEM',
          },
        });
        return tonConnectUI;
      });
    }
    await tonConnectLoadingPromise;
  }
  return tonConnectUI;
}

/**
 * @returns {string}
 */
export function connectedAddress() {
  const wallet = tonConnectUI?.wallet;
  return wallet?.account?.address ?? '';
}

/**
 * @param {(address: string) => void} callback
 */
export function onWalletChange(callback) {
  if (!tonConnectUI) {
    return;
  }
  const ui = tonConnectUI;
  ui.onStatusChange((wallet) => {
    callback(wallet?.account?.address ?? '');
  });
}

/**
 * Tries to re-sync wallet state from bridge/storage.
 * Useful when wallet confirms connection but status event is delayed.
 * @returns {Promise<string>}
 */
export async function syncWalletSession() {
  const ui = await getTonConnectUI();
  try {
    await ui.connector?.restoreConnection?.();
  } catch {
    // Ignore bridge restore errors; caller handles empty address.
  }
  return connectedAddress();
}

/**
 * @returns {StonApiClient}
 */
export function getStonApiClient() {
  return new StonApiClient();
}

/**
 * @returns {Client}
 */
function getStonTonClient() {
  return new Client({ endpoint: TON_RPC_ENDPOINT });
}

/**
 * @param {{
 *   offerAddress: string;
 *   askAddress: string;
 *   offerUnits: string;
 *   slippageTolerance?: string;
 * }} params
 */
export async function simulateSwap(params) {
  const client = getStonApiClient();
  return client.simulateSwap({
    offerAddress: params.offerAddress,
    askAddress: params.askAddress,
    offerUnits: params.offerUnits,
    slippageTolerance: params.slippageTolerance ?? DEFAULT_SLIPPAGE,
    dexV2: true,
  });
}

/**
 * @param {string} amount
 * @param {number} decimals
 * @returns {string}
 */
export function toUnitsString(amount, decimals) {
  return toUnits(String(amount), decimals).toString();
}

/**
 * @param {{
 *   userWalletAddress: string;
 *   simulationResult: any;
 * }} params
 */
export async function buildSwapTxParams(params) {
  const { simulationResult } = params;
  const tonClient = getStonTonClient();
  const dexContracts = dexFactory(simulationResult.router);
  const router = tonClient.open(
    dexContracts.Router.create(simulationResult.router.address),
  );
  const proxyTon = dexContracts.pTON.create(
    simulationResult.router.ptonMasterAddress,
  );
  const shared = {
    userWalletAddress: params.userWalletAddress,
    offerAmount: simulationResult.offerUnits,
    minAskAmount: simulationResult.minAskUnits,
  };
  if (simulationResult.offerAddress === TON_ASSET_ADDRESS) {
    return router.getSwapTonToJettonTxParams({
      ...shared,
      proxyTon,
      askJettonAddress: simulationResult.askAddress,
    });
  }
  if (simulationResult.askAddress === TON_ASSET_ADDRESS) {
    return router.getSwapJettonToTonTxParams({
      ...shared,
      proxyTon,
      offerJettonAddress: simulationResult.offerAddress,
    });
  }
  return router.getSwapJettonToJettonTxParams({
    ...shared,
    offerJettonAddress: simulationResult.offerAddress,
    askJettonAddress: simulationResult.askAddress,
  });
}

/**
 * @param {{
 *   address: string;
 *   amount: string;
 *   payload?: string;
 * }} message
 */
export async function sendSwapTransaction(message) {
  const ui = await getTonConnectUI();
  const validUntil = Math.floor(Date.now() / 1000) + 5 * 60;
  await ui.sendTransaction({
    validUntil,
    network: NETWORK === 'testnet' ? '-3' : '-239',
    messages: [
      {
        address: message.address,
        amount: message.amount,
        payload: message.payload,
      },
    ],
  });
}
