// Browser checks for the on-chain layer against the production export.
// A mock EIP-6963 wallet signs with `cast wallet sign` (Foundry) using a public documentation key,
// the Nostr relays are replaced by one in-memory relay shared by two browser contexts, and the
// Sepolia RPC answers are mocked so every unhappy path can be reached deterministically.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { preview } from './preview.mjs';

const require = createRequire(process.env.TEMPO_TEST_TOOLCHAIN
  ? resolve(process.env.TEMPO_TEST_TOOLCHAIN, 'package.json') : new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');
const API = 'https://api.squeekchain.com/v1/status';
const KEY = '0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318'; // web3.js documentation key
const ADDRESS = '0x2c7536E3605D9C16a7a3D7b1898e529396a65c23';
const out = 'test/scratch/onchain';
await mkdir(`${out}/shots`, { recursive: true });
const word = n => BigInt(n).toString(16).padStart(64, '0');
const payload = { measurement: { rpmMilli: 60000, freshness: 'online' }, oracle: { latestClosure: { lastRound: '253' } }, builder: { anchor: { settledThroughRound: '252' } } };
let settledThrough = 200;
const relayEvents = [];
const results = [];
const errors = [];

async function check(name, fn) {
  try { await fn(); results.push({ name, passed: true }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, passed: false, detail: String(error.stack ?? error) }); console.error(`FAIL ${name}: ${error.message}`); }
}

async function setup(context) {
  await context.routeWebSocket(/^wss:\/\//, ws => {
    ws.onMessage(raw => {
      const msg = JSON.parse(String(raw));
      if (msg[0] === 'EVENT') { if (!relayEvents.some(e => e.id === msg[1].id)) relayEvents.push(msg[1]); ws.send(JSON.stringify(['OK', msg[1].id, true, ''])); }
      if (msg[0] === 'REQ') { for (const e of relayEvents) ws.send(JSON.stringify(['EVENT', msg[1], e])); ws.send(JSON.stringify(['EOSE', msg[1]])); }
    });
  });
  await context.route(API, r => r.fulfill({ json: payload }));
  await context.route(/sepolia/, async r => {
    const body = r.request().postDataJSON();
    const data = body.params?.[0]?.data;
    let result = '0x';
    if (body.method === 'eth_call') {
      if (data === '0x83d0e1d7') result = `0x${word(settledThrough)}`;
      else if (data === '0x001c856f') result = `0x${word(0)}${word(254)}${word(1)}`;
      else if (data === '0xc19d93fb') result = `0x${[5, 252, 17, 0, 6493, 0, 1, 1, 0, 1].map(word).join('')}`;
    }
    await r.fulfill({ json: { jsonrpc: '2.0', id: body.id, result } });
  });
}

const server = await preview();
const browser = await chromium.launch({ headless: true });
try {
  const ctxA = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await setup(ctxA);
  const page = await ctxA.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.exposeFunction('__castSign', hex => execFileSync('cast', ['wallet', 'sign', '--private-key', KEY, Buffer.from(hex.slice(2), 'hex').toString('utf8')]).toString().trim());
  await page.clock.install({ time: new Date() });
  await page.addInitScript(([address]) => {
    let chain = '0x1';
    let sends = 0;
    const listeners = {};
    const provider = {
      on: (e, fn) => { (listeners[e] ??= []).push(fn); },
      removeListener: () => {},
      request: async ({ method, params }) => {
        window.__calls = [...(window.__calls ?? []), method];
        if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [address.toLowerCase()];
        if (method === 'eth_chainId') return chain;
        if (method === 'wallet_switchEthereumChain') { chain = params[0].chainId; (listeners.chainChanged ?? []).forEach(fn => fn(chain)); return null; }
        if (method === 'personal_sign') return window.__castSign(params[0]);
        if (method === 'eth_sendTransaction') {
          sends++;
          window.__lastTx = params[0];
          if (sends === 1) throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
          return `0x${'ab'.repeat(32)}`;
        }
        if (method === 'eth_getTransactionReceipt') return { status: '0x1', blockNumber: '0xb8deb9' };
        throw new Error(`unsupported ${method}`);
      },
    };
    const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info: { uuid: 'test', name: 'Test Wallet', icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>', rdns: 'test.wallet' }, provider }) }));
    window.addEventListener('eip6963:requestProvider', announce);
    announce();
  }, [ADDRESS]);
  await page.goto(server.url);
  await page.clock.runFor(500);
  const advance = async ms => { while (ms > 0) { const d = Math.min(ms, 1000); await page.clock.runFor(d); await page.waitForTimeout(5); ms -= d; } };

  await check('connect wallet and sign in for free', async () => {
    await page.click('#wallet-button');
    await page.getByRole('button', { name: 'Test Wallet' }).click();
    await page.waitForFunction(() => document.querySelector('#wallet-button-label').textContent.includes('0x2c75'));
    assert.match(await page.locator('#wallet-body').textContent(), /free: not a transaction, no gas/);
    await page.click('#sign-in-button');
    await page.waitForFunction(() => document.querySelector('#wallet-body').textContent.includes('Signed in'));
    assert.ok((await page.evaluate(() => window.__calls)).includes('personal_sign'));
    assert.ok(!(await page.evaluate(() => window.__calls)).includes('eth_sendTransaction'));
    await page.screenshot({ path: `${out}/shots/signed-in-390.png` });
    await page.click('#close-wallet');
    assert.match(await page.locator('#wallet-hud').textContent(), /0x2c75…5c23/);
  });

  await check('a finished signed live run is published and shows best and rank on the HUD', async () => {
    await page.click('#start-button');
    await advance(92_000);
    await page.waitForFunction(() => document.querySelector('#overlay-title').textContent.match(/Run complete|personal best/));
    await advance(1000);
    await page.waitForFunction(() => document.querySelector('#run-board-status').textContent.startsWith('Saved'));
    assert.equal(relayEvents.length, 1);
    assert.match(await page.locator('#wallet-hud').textContent(), /Wallet best [\d,]+ · Rank #1/);
    assert.match(await page.locator('#board-body').textContent(), /0x2c75…5c23/);
  });

  await check('wrong network, not settled, rejection and success', async () => {
    await page.click('#checkpoint-button');
    await page.waitForFunction(() => /another network/.test(document.querySelector('#checkpoint-status').textContent));
    assert.ok(await page.locator('#switch-button').isVisible());
    await page.click('#switch-button');
    await page.waitForFunction(() => /Now on Ethereum Sepolia/.test(document.querySelector('#checkpoint-status').textContent));
    await page.click('#checkpoint-button');
    await page.waitForFunction(() => /has not settled/.test(document.querySelector('#checkpoint-status').textContent));
    settledThrough = 300;
    await page.click('#checkpoint-button');
    await page.waitForFunction(() => /rejected the transaction/.test(document.querySelector('#checkpoint-status').textContent));
    assert.equal(await page.locator('#start-button').isEnabled(), true, 'game stays usable after a rejection');
    await page.click('#checkpoint-button');
    await page.waitForFunction(() => /Checkpoint sent/.test(document.querySelector('#checkpoint-status').textContent));
    const tx = await page.evaluate(() => window.__lastTx);
    assert.equal(tx.to, '0x2dccb11fcc2defdd188555e45acb52231e82e218');
    assert.equal(tx.data, '0xc2c4c5c1');
    await advance(5000);
    await page.waitForFunction(() => /Checkpoint confirmed/.test(document.querySelector('#checkpoint-status').textContent));
    assert.equal(await page.locator('#checkpoint-status a').getAttribute('href'), `https://sepolia.etherscan.io/tx/0x${'ab'.repeat(32)}`);
    await page.locator('#run-panel').screenshot({ path: `${out}/shots/checkpoint-390.png` });
  });

  await check('a second visitor without a wallet sees the same board', async () => {
    const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await setup(ctxB);
    const other = await ctxB.newPage();
    other.on('pageerror', e => errors.push(e.message));
    await other.goto(server.url);
    await other.waitForFunction(() => document.querySelector('#board-body').textContent.includes('0x2c75…5c23'), null, { timeout: 15000 });
    assert.equal(await other.locator('#wallet-button-label').textContent(), 'Connect wallet');
    assert.equal(await other.locator('#wallet-hud').isHidden(), true);
    await other.locator('#leaderboard').screenshot({ path: `${out}/shots/board-1440.png` });
    await ctxB.close();
  });

  await check('a forged score event is ignored', async () => {
    const forged = { ...relayEvents[0], content: relayEvents[0].content.replace(/"score":\d+/, '"score":4999999') };
    relayEvents.push(forged);
    await page.click('#board-refresh');
    await advance(1000);
    await page.waitForFunction(() => !document.querySelector('#board-refresh').disabled);
    assert.ok(!(await page.locator('#board-body').textContent()).includes('4,999,999'));
  });

  await check('no page errors', async () => assert.deepEqual(errors, []));
  await ctxA.close();
} finally {
  await browser.close();
  await server.close();
  await writeFile(`${out}/results.json`, JSON.stringify(results, null, 2));
}
const failed = results.filter(r => !r.passed).length;
console.log(`${results.length - failed}/${results.length} on-chain browser checks passed`);
process.exit(failed ? 1 : 0);
