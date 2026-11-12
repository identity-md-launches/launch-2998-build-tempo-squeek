/**
 * The optional on-chain layer: wallet connect, free sign-in, the shared leaderboard and the
 * SqueekMining.checkpoint() button. The game never waits on any of it.
 */
import { SEPOLIA, SQUEEK_MINING, shortAddress, txUrl } from './chain/config.ts';
import {
  aggregateBoard, buildScoreEvent, buildSignInMessage, fetchBoard, playerKey, publishScore, saveSignIn, storedSignIn,
  type BoardRow, type ScoreEntry, type SignIn,
} from './chain/leaderboard.ts';
import { CHECKPOINT_SELECTOR, checkReadiness, describeRevert, publicRpc } from './chain/mining.ts';
import {
  OPEN_IN, WalletError, chainId, discoverWallets, isMobileBrowser, requestAccount, signMessage, silentAccount,
  switchToSepolia, walletOptions, type WalletOption,
} from './chain/wallet.ts';
import { checksumAddress, recoverPersonalSigner } from './chain/secp256k1.ts';

export interface FinishedRun {
  score: number; round: string | null; live: boolean; seed: number; distance: number; cheese: number; perfects: number;
}

const WALLET_STORE = 'tempo-squeek.wallet.v1';
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const format = (n: number) => Math.floor(n).toLocaleString('en-US');
const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
function when(ms: number): string {
  const seconds = Math.round((ms - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return 'just now';
  if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute');
  if (abs < 86400) return relative.format(Math.round(seconds / 3600), 'hour');
  return relative.format(Math.round(seconds / 86400), 'day');
}

export function createOnchain(announce: (message: string) => void) {
  const ui = {
    button: $<HTMLButtonElement>('wallet-button'), buttonLabel: $('wallet-button-label'),
    dialog: $<HTMLDialogElement>('wallet-dialog'), dialogTitle: $('wallet-title'), body: $('wallet-body'),
    close: $<HTMLButtonElement>('close-wallet'), note: $('wallet-note'),
    hud: $('wallet-hud'),
    panel: $('run-panel'), boardLine: $('run-board-status'), checkpointBox: $('checkpoint-box'),
    checkpoint: $<HTMLButtonElement>('checkpoint-button'), switchNet: $<HTMLButtonElement>('switch-button'),
    checkpointStatus: $('checkpoint-status'),
    boardStatus: $('board-status'), boardBody: $('board-body'), boardTable: $('board-table'),
    refresh: $<HTMLButtonElement>('board-refresh'),
  };

  let wallet: WalletOption | null = null;
  let address: string | null = null;
  let chain: number | null = null;
  let signIn: SignIn | null = null;
  let pending: string | null = null;
  let rows: BoardRow[] = [];
  let ownEntries: ScoreEntry[] = [];
  let boardState: 'loading' | 'ready' | 'offline' = 'loading';
  let runAtStart: { signedIn: SignIn | null } = { signedIn: null };
  let lastRun: FinishedRun | null = null;
  let checkpointBusy = false;

  const onSepolia = () => chain === SEPOLIA.chainId;

  // ---------- header control and dialog ----------
  function renderButton(): void {
    if (address) ui.buttonLabel.textContent = shortAddress(address);
    else {
      const suffix = document.createElement('span');
      suffix.className = 'wallet-full-label';
      suffix.textContent = ' wallet';
      ui.buttonLabel.replaceChildren('Connect', suffix);
    }
    ui.button.dataset.state = address ? signIn ? 'signed' : 'connected' : 'idle';
    ui.button.setAttribute('aria-label', address ? `Wallet ${shortAddress(address)}${signIn ? ', signed in' : ''}. Open wallet options` : 'Connect wallet');
  }

  function setNote(text: string): void { ui.note.textContent = text; }

  function row(label: string, icon: string | null, onClick: () => void, busy = false): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'wallet-row';
    const mark = document.createElement('span');
    mark.className = 'wallet-mark';
    if (icon) { const img = document.createElement('img'); img.src = icon; img.width = 28; img.height = 28; img.alt = ''; mark.append(img); }
    else mark.textContent = label.charAt(0);
    mark.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.textContent = busy ? `${label} · opening…` : label;
    b.append(mark, text);
    b.disabled = pending !== null;
    b.addEventListener('click', onClick);
    return b;
  }

  function renderDialog(): void {
    // Replacing a focused wallet/sign-in row must not leave focus behind the modal.
    if (ui.dialog.open && ui.body.contains(document.activeElement)) ui.close.focus();
    ui.body.replaceChildren();
    if (!address) {
      ui.dialogTitle.textContent = 'Connect a wallet';
      const intro = document.createElement('p');
      intro.className = 'wallet-intro';
      intro.textContent = 'Optional. Connect to put your live runs on the public leaderboard. The game works without one.';
      ui.body.append(intro);
      const list = document.createElement('div');
      list.className = 'wallet-list';
      if (isMobileBrowser()) {
        for (const w of OPEN_IN) {
          const a = document.createElement('a');
          a.className = 'wallet-row';
          a.href = w.href(location.href);
          a.innerHTML = `<span class="wallet-mark" aria-hidden="true">${w.name[0]}</span><span></span>`;
          a.lastElementChild!.textContent = `Open in ${w.name}`;
          list.append(a);
        }
      }
      const options = walletOptions();
      for (const option of options) list.append(row(option.name, option.icon, () => void connect(option), pending === option.id));
      if (!options.length && !isMobileBrowser()) {
        const none = document.createElement('p');
        none.className = 'wallet-empty';
        none.textContent = 'No browser wallet found. Install one such as MetaMask, then reload. You can keep playing without one.';
        list.append(none);
      }
      ui.body.append(list);
      return;
    }
    ui.dialogTitle.textContent = 'Your wallet';
    const who = document.createElement('p');
    who.className = 'wallet-address';
    who.textContent = `${shortAddress(address)} · ${onSepolia() ? 'Ethereum Sepolia' : 'Another network'}`;
    ui.body.append(who);

    const sign = document.createElement('div');
    sign.className = 'wallet-block';
    if (signIn) {
      sign.innerHTML = '<h3>Signed in</h3><p>Your live runs from this browser go on the public leaderboard under this wallet.</p>';
    } else {
      sign.innerHTML = '<h3>Sign in to the leaderboard</h3><p>Your wallet asks you to sign one message. It is free: not a transaction, no gas, nothing to buy.</p>';
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'primary-button wallet-action';
      b.id = 'sign-in-button';
      b.textContent = pending === 'sign' ? 'Check your wallet…' : 'Sign in (free, no gas)';
      b.disabled = pending !== null;
      b.addEventListener('click', () => void doSignIn());
      sign.append(b);
    }
    ui.body.append(sign);

    if (!onSepolia()) {
      const net = document.createElement('div');
      net.className = 'wallet-block';
      net.innerHTML = '<p>Checkpoints run on Ethereum Sepolia, a free test network. Signing in works on any network.</p>';
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'secondary-button wallet-action';
      b.textContent = pending === 'switch' ? 'Check your wallet…' : 'Switch to Ethereum Sepolia';
      b.disabled = pending !== null;
      b.addEventListener('click', () => void doSwitch());
      net.append(b);
      ui.body.append(net);
    }
    const out = document.createElement('button');
    out.type = 'button';
    out.className = 'text-button';
    out.textContent = 'Disconnect';
    out.addEventListener('click', disconnect);
    ui.body.append(out);
  }

  function refreshAll(): void { renderButton(); if (ui.dialog.open) renderDialog(); renderHud(); renderRunPanel(); }

  const onAccounts = (...args: unknown[]) => {
    const list = args[0] as string[] | undefined;
    if (!list?.length) { disconnect(); return; }
    if (wallet && list[0]) void adopt(wallet, list[0]);
  };
  const onChain = (...args: unknown[]) => { chain = Number(args[0]); refreshAll(); };

  async function adopt(option: WalletOption, account: string): Promise<void> {
    if (wallet && wallet !== option) { wallet.provider.removeListener?.('accountsChanged', onAccounts); wallet.provider.removeListener?.('chainChanged', onChain); }
    if (wallet !== option) { option.provider.on?.('accountsChanged', onAccounts); option.provider.on?.('chainChanged', onChain); }
    wallet = option;
    address = checksumAddress(account);
    chain = await chainId(option.provider);
    signIn = storedSignIn(address);
    try { localStorage.setItem(WALLET_STORE, option.id); } catch { /* not remembered */ }
    refreshAll();
  }

  async function connect(option: WalletOption): Promise<void> {
    pending = option.id; setNote(''); renderDialog();
    try {
      const account = await requestAccount(option.provider);
      pending = null;
      await adopt(option, account);
      announce(`Wallet ${shortAddress(account)} connected.`);
      setNote(signIn ? '' : 'Connected. Sign in to put your runs on the leaderboard.');
    } catch (error) {
      pending = null;
      setNote(error instanceof WalletError ? error.message : 'The wallet could not connect.');
    }
    renderDialog();
  }

  function disconnect(): void {
    wallet?.provider.removeListener?.('accountsChanged', onAccounts);
    wallet?.provider.removeListener?.('chainChanged', onChain);
    wallet = null; address = null; chain = null; signIn = null;
    try { localStorage.removeItem(WALLET_STORE); } catch { /* fine */ }
    setNote('Disconnected. Your device best is still saved here.');
    announce('Wallet disconnected.');
    refreshAll();
  }

  async function doSignIn(): Promise<void> {
    if (!wallet || !address) return;
    pending = 'sign'; setNote(''); renderDialog();
    try {
      const key = playerKey();
      const message = buildSignInMessage(address, key.pubkey, new Date().toISOString());
      const signature = await signMessage(wallet.provider, address, message);
      if (recoverPersonalSigner(message, signature) !== address) throw new WalletError('That signature did not match this wallet, so it was not used.');
      signIn = { address, pubkey: key.pubkey, message, signature };
      saveSignIn(signIn);
      setNote('Signed in. Your next live run goes on the public leaderboard.');
      announce('Signed in. Your next live run goes on the public leaderboard.');
    } catch (error) {
      setNote(error instanceof WalletError ? error.message : 'Sign-in did not finish. You can try again.');
    }
    pending = null;
    refreshAll();
  }

  async function doSwitch(): Promise<boolean> {
    if (!wallet) return false;
    pending = 'switch'; setNote(''); refreshAll();
    try {
      await switchToSepolia(wallet.provider);
      chain = await chainId(wallet.provider);
      pending = null;
      refreshAll();
      if (!onSepolia()) { setNote('The wallet is still on another network. Switch to Ethereum Sepolia in the wallet.'); return false; }
      return true;
    } catch (error) {
      pending = null;
      const message = error instanceof WalletError ? error.message : 'The wallet could not switch networks.';
      setNote(message);
      refreshAll();
      if (lastRun) ui.checkpointStatus.textContent = message;
      return false;
    }
  }

  // ---------- leaderboard ----------
  function mergedRows(): BoardRow[] {
    return ownEntries.length ? aggregateBoard([...rows, ...ownEntries]) : rows;
  }

  function renderBoard(): void {
    const all = mergedRows();
    ui.boardBody.replaceChildren();
    for (const r of all.slice(0, 50)) {
      const tr = document.createElement('tr');
      if (address && r.address.toLowerCase() === address.toLowerCase()) tr.dataset.own = 'true';
      const cells = [`${r.rank}`, shortAddress(r.address), format(r.score), r.round, when(r.playedAt)];
      cells.forEach((text, i) => {
        const td = document.createElement(i === 1 ? 'th' : 'td');
        if (i === 1) { td.setAttribute('scope', 'row'); td.title = r.address; }
        if (i === 4) { const t = document.createElement('time'); t.dateTime = new Date(r.playedAt).toISOString(); t.title = new Date(r.playedAt).toLocaleString('en-US'); t.textContent = text; td.append(t); }
        else td.textContent = text;
        tr.append(td);
      });
      ui.boardBody.append(tr);
    }
    ui.boardTable.hidden = all.length === 0;
    ui.boardStatus.textContent = boardState === 'loading' ? 'Loading the board…'
      : boardState === 'offline' && !all.length ? 'The leaderboard relays could not be reached. The game still works; try Refresh later.'
      : all.length === 0 ? 'No signed runs yet. Connect a wallet, sign in for free, and finish a live run to be first.'
      : `${all.length} ${all.length === 1 ? 'wallet' : 'wallets'} on the board. Best signed live run per wallet.`;
    renderHud();
  }

  async function loadBoard(): Promise<void> {
    boardState = 'loading';
    ui.refresh.disabled = true;
    renderBoard();
    try {
      const result = await fetchBoard();
      rows = result.rows;
      boardState = result.relaysAnswered > 0 ? 'ready' : 'offline';
    } catch { boardState = 'offline'; }
    ui.refresh.disabled = false;
    renderBoard();
  }

  function renderHud(): void {
    if (!address || !signIn) { ui.hud.hidden = true; return; }
    ui.hud.hidden = false;
    const mine = mergedRows().find(r => r.address.toLowerCase() === address!.toLowerCase());
    ui.hud.textContent = mine
      ? `${shortAddress(address)} · Wallet best ${format(mine.score)} · Rank #${mine.rank}`
      : boardState === 'loading' ? `${shortAddress(address)} · Loading your rank…` : `${shortAddress(address)} · Signed in · Finish a live run to rank`;
  }

  // ---------- finished-run panel ----------
  let boardLine = '';
  function renderRunPanel(): void {
    if (!lastRun) { ui.panel.hidden = true; return; }
    ui.panel.hidden = false;
    ui.boardLine.textContent = boardLine;
    const checkpointable = lastRun.live && lastRun.round !== null;
    ui.checkpointBox.hidden = !checkpointable;
    ui.switchNet.hidden = !(address && !onSepolia());
    ui.switchNet.disabled = pending !== null;
    ui.checkpoint.disabled = checkpointBusy;
  }

  async function publish(run: FinishedRun, signed: SignIn): Promise<void> {
    boardLine = 'Saving to the public leaderboard…';
    renderRunPanel();
    try {
      // A replaceable event must never overwrite this key's best with a lower run.
      const knownBest = mergedRows().find(r => r.address.toLowerCase() === signed.address.toLowerCase());
      await loadBoard();
      const best = aggregateBoard([...mergedRows(), ...(knownBest ? [knownBest] : [])])
        .find(r => r.address.toLowerCase() === signed.address.toLowerCase());
      if (best && best.score >= run.score) {
        boardLine = `Your wallet best stays ${format(best.score)}. This run did not beat it.`;
        renderRunPanel(); announce(boardLine); return;
      }
      if (boardState === 'offline') {
        boardLine = 'The leaderboard relays could not be reached to check your best, so this run was not shared. Your device best is still saved.';
        renderRunPanel(); announce(boardLine); return;
      }
      const event = buildScoreEvent(signed, { score: run.score, round: run.round!, seed: run.seed, distance: Math.floor(run.distance), cheese: run.cheese, perfects: run.perfects });
      ownEntries.push({ address: signed.address, score: run.score, round: run.round!, playedAt: event.created_at * 1000, id: event.id });
      renderBoard();
      const stored = await publishScore(event);
      boardLine = stored > 0
        ? `Saved to the public leaderboard under ${shortAddress(signed.address)}.`
        : 'The leaderboard relays could not be reached, so this run was not shared. Your device best is still saved.';
      if (stored === 0) ownEntries = ownEntries.filter(e => e.id !== event.id);
    } catch {
      boardLine = 'This run could not be shared. Your device best is still saved.';
    }
    renderRunPanel();
    renderBoard();
    announce(boardLine);
    if (boardLine.startsWith('Saved')) window.setTimeout(() => void loadBoard(), 4000);
  }

  async function waitForReceipt(hash: string): Promise<{ status: string; blockNumber: string } | null> {
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 4000));
      for (const read of [
        () => wallet?.provider.request({ method: 'eth_getTransactionReceipt', params: [hash] }),
        () => publicRpc('eth_getTransactionReceipt', [hash]),
      ]) {
        try {
          const receipt = await read() as { status?: string; blockNumber?: string } | null;
          if (receipt?.status && receipt.blockNumber) return { status: receipt.status, blockNumber: receipt.blockNumber };
        } catch { /* try the next source */ }
      }
    }
    return null;
  }

  function showTx(text: string, hash: string): void {
    ui.checkpointStatus.replaceChildren(document.createTextNode(`${text} `));
    const a = document.createElement('a');
    a.href = txUrl(hash);
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.className = 'tx-link';
    a.textContent = `${hash.slice(0, 10)}…${hash.slice(-8)}`;
    a.setAttribute('aria-label', `View transaction ${hash} on Sepolia Etherscan`);
    ui.checkpointStatus.append(a);
  }

  async function checkpoint(): Promise<void> {
    if (!lastRun?.round || checkpointBusy) return;
    const say = (text: string) => { ui.checkpointStatus.textContent = text; announce(text); };
    if (!wallet || !address) { say('Connect a wallet and sign in first. Checkpoints are optional.'); open(); return; }
    if (!signIn) { say('Sign in first. It is free and costs no gas.'); open(); return; }
    chain = await chainId(wallet.provider);
    if (!onSepolia()) {
      refreshAll();
      say('Your wallet is on another network. Switch to Ethereum Sepolia to checkpoint this run.');
      return;
    }
    checkpointBusy = true; renderRunPanel();
    try {
      say(`Checking round ${lastRun.round} on Sepolia…`);
      const ready = await checkReadiness(lastRun.round, address);
      if (!ready.ok) { say(ready.reason); return; }
      say(`${ready.note} Confirm in your wallet. You pay a small Sepolia test-ETH fee; nothing else is sent.`);
      let hash: string;
      try {
        hash = await wallet.provider.request({ method: 'eth_sendTransaction', params: [{ from: address, to: SQUEEK_MINING, data: CHECKPOINT_SELECTOR, value: '0x0' }] }) as string;
      } catch (error) { say(describeRevert(error)); return; }
      if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) { say('The wallet did not return a transaction hash. Check the wallet activity.'); return; }
      showTx('Checkpoint sent. Waiting for Sepolia to confirm…', hash);
      announce('Checkpoint sent. Waiting for Sepolia to confirm.');
      const receipt = await waitForReceipt(hash);
      if (!receipt) showTx('Still pending on Sepolia. Follow it here:', hash);
      else if (receipt.status === '0x1') { showTx(`Checkpoint confirmed in block ${Number(receipt.blockNumber).toLocaleString('en-US')}.`, hash); announce('Checkpoint confirmed on Sepolia.'); }
      else { showTx('The checkpoint reverted on Sepolia. Nothing changed except the network fee.', hash); announce('The checkpoint reverted.'); }
    } finally {
      checkpointBusy = false;
      ui.checkpoint.textContent = 'Checkpoint this run on-chain';
      renderRunPanel();
    }
  }

  function open(): void {
    renderDialog();
    if (!ui.dialog.open) ui.dialog.showModal();
    ui.close.focus();
  }

  // ---------- wiring ----------
  ui.button.addEventListener('click', open);
  ui.close.addEventListener('click', () => ui.dialog.close());
  // Keep the game's Escape/pause and movement shortcuts out of the wallet sheet.
  ui.dialog.addEventListener('keydown', e => e.stopPropagation());
  ui.dialog.addEventListener('click', e => {
    if (e.target !== ui.dialog) return;
    const box = ui.dialog.getBoundingClientRect();
    if (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom) ui.dialog.close();
  });
  ui.dialog.addEventListener('close', () => { setNote(''); ui.button.focus(); });
  ui.refresh.addEventListener('click', () => void loadBoard());
  ui.checkpoint.addEventListener('click', () => void checkpoint());
  ui.switchNet.addEventListener('click', async () => {
    if (await doSwitch()) ui.checkpointStatus.textContent = 'Now on Ethereum Sepolia. You can checkpoint this run.';
  });

  let restoring = false;
  discoverWallets(() => {
    if (ui.dialog.open && !address) renderDialog();
    void restore();
  });
  async function restore(): Promise<void> {
    if (address || restoring) return;
    let remembered: string | null = null;
    try { remembered = localStorage.getItem(WALLET_STORE); } catch { /* none */ }
    const option = walletOptions().find(o => o.id === remembered);
    if (!option) return;
    restoring = true;
    const account = await silentAccount(option.provider);
    if (account) await adopt(option, account);
    restoring = false;
  }
  window.setTimeout(() => void restore(), 400);
  renderButton();
  void loadBoard();

  return {
    runStarted(): void { runAtStart = { signedIn: signIn }; lastRun = null; boardLine = ''; ui.checkpointStatus.textContent = ''; renderRunPanel(); },
    runReset(): void { lastRun = null; renderRunPanel(); },
    runFinished(run: FinishedRun): void {
      lastRun = run;
      ui.checkpointStatus.textContent = '';
      const signed = runAtStart.signedIn;
      if (!run.live || run.round === null) boardLine = 'SIM practice runs stay off the leaderboard and have no SqueekCore round to checkpoint.';
      else if (run.score <= 0) boardLine = 'Score some points on a live run to reach the leaderboard.';
      else if (!signed) boardLine = address ? 'Sign in (free, no gas) before your next live run to put it on the leaderboard.' : 'Connect a wallet and sign in (free, no gas) before your next live run to put it on the leaderboard.';
      else { void publish(run, signed); return; }
      renderRunPanel();
    },
  };
}
