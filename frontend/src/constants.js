export const APP_NAME = 'NEVDEX';

export const NETWORK = import.meta.env.VITE_NETWORK ?? 'mainnet';

export const TON_RPC_ENDPOINT =
  import.meta.env.VITE_TON_RPC_ENDPOINT ??
  'https://toncenter.com/api/v2/jsonRPC';

export const TON_ASSET_ADDRESS =
  import.meta.env.VITE_TON_ASSET_ADDRESS ??
  'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c';

export const DEFAULT_SWAP_TOKEN_ADDRESS =
  import.meta.env.VITE_DEFAULT_SWAP_TOKEN_ADDRESS ??
  'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs';

export const DEFAULT_SLIPPAGE = import.meta.env.VITE_DEFAULT_SLIPPAGE ?? '0.01';

export const ASSET_QUERY_LIMIT = Number(import.meta.env.VITE_ASSET_QUERY_LIMIT ?? 80);

export const TONCONNECT_MANIFEST_URL = import.meta.env.VITE_TONCONNECT_MANIFEST_URL ?? '';

export const DEFAULT_REMOTE_MANIFEST_URL =
  'https://novaelectioviri.github.io/NEVDEX/tonconnect-manifest.json';

/**
 * @param {string | undefined | null} value
 * @returns {string}
 */
export function toSafeHttpUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw || raw === 'undefined' || raw === 'null') {
    return '';
  }
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }
    return parsed.toString();
  } catch {
    return '';
  }
}
