import { StonApiClient } from '@ston-fi/api';
import { Client, dexFactory, toUnits } from '@ston-fi/sdk';
import {
  DEFAULT_REMOTE_MANIFEST_URL,
  DEFAULT_SLIPPAGE,
  NETWORK,
  TON_ASSET_ADDRESS,
  TON_RPC_ENDPOINT,
  TONCONNECT_MANIFEST_URL,
  toSafeHttpUrl,
} from './constants.js';

const PAGE_BASE_URL = new URL('./', window.location.href);
const DEFAULT_LOCAL_MANIFEST_URL = new URL('tonconnect-manifest.json', PAGE_BASE_URL).toString();

/** @type {any | null} */
let tonConnectUI = null;
/** @type {Promise<any> | null} */
let tonConnectLoadingPromise = null;

function clearTonConnectStorage() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key?.startsWith('ton-connect-storage_') || key?.startsWith('ton-connect-ui_')) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // Some browsers can block localStorage; TonConnect can still open manually.
  }
}

function resolveManifestUrl() {
  const explicitUrl = toSafeHttpUrl(TONCONNECT_MANIFEST_URL);
  if (explicitUrl) {
    return explicitUrl;
  }

  const isLocalhost =
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const isHttpsLike =
    window.location.protocol === 'https:' || window.location.protocol === 'chrome-extension:';
  return isLocalhost || !isHttpsLike ? DEFAULT_REMOTE_MANIFEST_URL : DEFAULT_LOCAL_MANIFEST_URL;
}

/**
 * @returns {Promise<any>}
 */
export async function getTonConnectUI() {
  if (tonConnectUI) {
    return tonConnectUI;
  }
  if (!tonConnectLoadingPromise) {
    tonConnectLoadingPromise = import('@tonconnect/ui').then(({ TonConnect, TonConnectUI }) => {
      clearTonConnectStorage();
      const connector = new TonConnect({
        manifestUrl: resolveManifestUrl(),
        analytics: { mode: 'off' },
      });
      tonConnectUI = new TonConnectUI({
        connector,
        restoreConnection: false,
        analytics: { mode: 'off' },
        uiPreferences: { theme: 'SYSTEM' },
      });
      return tonConnectUI;
    });
  }
  return tonConnectLoadingPromise;
}

/**
 * @returns {string}
 */
export function connectedAddress() {
  return tonConnectUI?.wallet?.account?.address ?? '';
}

/**
 * @param {(address: string) => void} callback
 */
export function onWalletChange(callback) {
  if (!tonConnectUI) {
    return;
  }
  tonConnectUI.onStatusChange((wallet) => {
    callback(wallet?.account?.address ?? '');
  });
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
  const router = tonClient.open(dexContracts.Router.create(simulationResult.router.address));
  const proxyTon = dexContracts.pTON.create(simulationResult.router.ptonMasterAddress);
  const common = {
    userWalletAddress: params.userWalletAddress,
    offerAmount: simulationResult.offerUnits,
    minAskAmount: simulationResult.minAskUnits,
  };

  if (simulationResult.offerAddress === TON_ASSET_ADDRESS) {
    return router.getSwapTonToJettonTxParams({
      ...common,
      proxyTon,
      askJettonAddress: simulationResult.askAddress,
    });
  }
  if (simulationResult.askAddress === TON_ASSET_ADDRESS) {
    return router.getSwapJettonToTonTxParams({
      ...common,
      proxyTon,
      offerJettonAddress: simulationResult.offerAddress,
    });
  }
  return router.getSwapJettonToJettonTxParams({
    ...common,
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
  const validUntil = Math.floor(Date.now() / 1000) + 300;
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
