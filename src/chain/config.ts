/**
 * Every on-chain and shared-state setting in one place.
 * Addresses were read from the public Squeekchain API (`/v1/core` and `/v1/economy/state`,
 * release core-sepolia-20261103) and the Squeekchain developer docs. Sepolia testnet only.
 */
export const SEPOLIA = {
  chainId: 11155111,
  chainIdHex: '0xaa36a7',
  name: 'Ethereum Sepolia',
  nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: [
    'https://ethereum-sepolia-rpc.publicnode.com',
    'https://sepolia.drpc.org',
    'https://1rpc.io/sepolia',
  ],
  explorer: 'https://sepolia.etherscan.io',
} as const;

/** SqueekMining proxy: anyone may call checkpoint(), the caller pays gas and receives nothing. */
export const SQUEEK_MINING = '0x2dccb11fcc2defdd188555e45acb52231e82e218';
/** SqueekCore proxy: settledThroughRound() says which rounds have settled on Sepolia. */
export const SQUEEK_CORE = '0xfd6c166d4b8e2962e65746a13e5a0797cd4de0c4';

/**
 * The public leaderboard is shared through open Nostr relays: every visitor reads the same
 * signed score events, and no server of this site exists to hold or lose them.
 */
export const RELAYS = [
  'wss://relay.primal.net',
  'wss://relay.nostr.net',
  'wss://offchain.pub',
  'wss://relay.snort.social',
  'wss://nostr.oxtr.dev',
  'wss://nos.lol',
  'wss://relay.damus.io',
] as const;
export const BOARD_KIND = 30078;
export const BOARD_TAG = 'tempo-squeek-board-v1';
/** Scores above this are impossible in a 90-second run and are ignored. */
export const MAX_PLAUSIBLE_SCORE = 5_000_000;

export const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
export const txUrl = (hash: string) => `${SEPOLIA.explorer}/tx/${hash}`;
export const addressUrl = (address: string) => `${SEPOLIA.explorer}/address/${address}`;
