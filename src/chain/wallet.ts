/**
 * Browser wallets without a relay or SDK: EIP-6963 discovery for extensions, the legacy
 * window.ethereum as "Browser wallet" when nothing announces itself, and "Open in" links that
 * load this page inside a phone wallet's own browser.
 */
import { SEPOLIA } from './config.ts';
import { checksumAddress } from './secp256k1.ts';
import { toHex, utf8 } from './hash.ts';

export interface Eip1193 {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}
export interface WalletOption { id: string; name: string; icon: string | null; provider: Eip1193; }

const found = new Map<string, WalletOption>();
const listeners = new Set<() => void>();

export function discoverWallets(onChange: () => void): void {
  listeners.add(onChange);
  window.addEventListener('eip6963:announceProvider', ((event: CustomEvent) => {
    const detail = event.detail as { info?: { uuid?: string; name?: string; icon?: string; rdns?: string }; provider?: Eip1193 };
    if (!detail?.info?.name || !detail.provider) return;
    const id = detail.info.rdns || detail.info.uuid || detail.info.name;
    const icon = typeof detail.info.icon === 'string' && /^data:image\//.test(detail.info.icon) ? detail.info.icon : null;
    found.set(id, { id, name: detail.info.name, icon, provider: detail.provider });
    listeners.forEach(fn => fn());
  }) as EventListener);
  window.dispatchEvent(new Event('eip6963:requestProvider'));
}

/** Named extensions first; the bare injected provider only when none was named. */
export function walletOptions(): WalletOption[] {
  const named = [...found.values()];
  const legacy = (window as unknown as { ethereum?: Eip1193 }).ethereum;
  if (!named.length && legacy) return [{ id: 'injected', name: 'Browser wallet', icon: null, provider: legacy }];
  return named;
}

export const OPEN_IN: ReadonlyArray<{ id: string; name: string; href: (url: string) => string }> = [
  // https://docs.metamask.io/metamask-connect/evm/guides/metamask-exclusive/use-deeplinks
  { id: 'metamask', name: 'MetaMask', href: url => `https://link.metamask.io/dapp/${url.replace(/^https?:\/\//, '')}` },
  // https://docs.cdp.coinbase.com/wallet-sdk/docs/deep-link
  { id: 'coinbase', name: 'Coinbase Wallet', href: url => `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(url)}` },
  // https://docs.phantom.com/phantom-deeplinks/other-methods/browse
  { id: 'phantom', name: 'Phantom', href: url => `https://phantom.app/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(new URL(url).origin)}` },
];

export const isMobileBrowser = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) && !(window as unknown as { ethereum?: unknown }).ethereum;

export class WalletError extends Error {
  constructor(message: string, readonly code?: number) { super(message); }
}

function errorCode(error: unknown): number | undefined {
  const e = error as { code?: number; data?: { originalError?: { code?: number } } };
  return e?.code ?? e?.data?.originalError?.code;
}

export async function requestAccount(provider: Eip1193): Promise<string> {
  try {
    const accounts = await provider.request({ method: 'eth_requestAccounts' }) as string[];
    if (!accounts?.[0]) throw new WalletError('The wallet did not share an address.');
    return checksumAddress(accounts[0]);
  } catch (error) {
    if (error instanceof WalletError) throw error;
    if (errorCode(error) === 4001) throw new WalletError('Connection cancelled in the wallet. You can keep playing without one.', 4001);
    if (errorCode(error) === -32002) throw new WalletError('Your wallet already has a request open. Check the wallet window.', -32002);
    throw new WalletError('The wallet could not connect. You can keep playing without one.');
  }
}

export async function silentAccount(provider: Eip1193): Promise<string | null> {
  try {
    const accounts = await provider.request({ method: 'eth_accounts' }) as string[];
    return accounts?.[0] ? checksumAddress(accounts[0]) : null;
  } catch { return null; }
}

export async function chainId(provider: Eip1193): Promise<number | null> {
  try { return Number(await provider.request({ method: 'eth_chainId' })); } catch { return null; }
}

export async function switchToSepolia(provider: Eip1193): Promise<void> {
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: SEPOLIA.chainIdHex }] });
  } catch (error) {
    const code = errorCode(error);
    if (code === 4001) throw new WalletError('Network switch cancelled. The game still works; checkpoints need Ethereum Sepolia.', 4001);
    if (code === 4902 || /unrecognized|unknown chain|not added/i.test((error as Error)?.message ?? '')) {
      try {
        await provider.request({ method: 'wallet_addEthereumChain', params: [{
          chainId: SEPOLIA.chainIdHex, chainName: SEPOLIA.name, nativeCurrency: SEPOLIA.nativeCurrency,
          rpcUrls: [SEPOLIA.rpcUrls[0]], blockExplorerUrls: [SEPOLIA.explorer],
        }] });
        return;
      } catch (addError) {
        if (errorCode(addError) === 4001) throw new WalletError('Adding Ethereum Sepolia was cancelled.', 4001);
      }
    }
    throw new WalletError('The wallet could not switch to Ethereum Sepolia. Switch networks in the wallet, then try again.');
  }
}

export async function signMessage(provider: Eip1193, address: string, message: string): Promise<string> {
  try {
    const signature = await provider.request({ method: 'personal_sign', params: [`0x${toHex(utf8(message))}`, address] });
    if (typeof signature !== 'string') throw new Error('No signature');
    return signature;
  } catch (error) {
    if (errorCode(error) === 4001) throw new WalletError('Sign-in cancelled. Nothing was sent; you can sign in any time.', 4001);
    throw new WalletError('The wallet could not sign the message. Try again, or keep playing without signing in.');
  }
}
