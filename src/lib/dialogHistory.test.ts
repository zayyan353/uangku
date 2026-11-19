import { describe, expect, it } from 'vitest';
import { createDialogHistory, type HistoryWindow } from './dialogHistory';

/**
 * A browser history small enough to read: entries with a state and a hash. `back()` and
 * `forward()` land later, as in a browser, and report through `onMove` like `popstate` does.
 * A step past either end goes nowhere and reports nothing.
 */
const BASE = 'https://uangku.test/app/';

function browser(hashes: string[] = ['']) {
  const entries = hashes.map(hash => ({ state: null as unknown, hash }));
  let index = entries.length - 1;
  const timers: Array<() => void> = [];
  const moves: number[] = [];
  const calls = { back: 0, forward: 0, push: 0, replace: 0 };
  const hashOf = (url?: string | null) => (url ?? '').includes('#') ? (url ?? '').slice((url ?? '').indexOf('#')) : '';
  const self = {
    entries, calls,
    onMove: () => {},
    get index() { return index; },
    get hashes() { return entries.map(entry => entry.hash); },
    get hash() { return entries[index].hash; },
    win: {
      history: {
        get state() { return entries[index].state; },
        pushState(state: unknown, _: string, url?: string | null) { calls.push += 1; entries.splice(index + 1); entries.push({ state, hash: hashOf(url) }); index += 1; },
        replaceState(state: unknown, _: string, url?: string | null) { calls.replace += 1; entries[index] = { state, hash: hashOf(url) }; },
        back() { calls.back += 1; moves.push(-1); },
        forward() { calls.forward += 1; moves.push(1); },
      },
      location: { get href() { return BASE + entries[index].hash; } },
      setTimeout(handler: () => void) { timers.push(handler); return 0; },
    } satisfies HistoryWindow,
    /** The user's Back, Forward or a jump: lands at once and reports. */
    user(delta: number) { index = Math.max(0, Math.min(entries.length - 1, index + delta)); self.onMove(); },
    timers() { while (timers.length) timers.shift()!(); },
    /** Lands the moves the code asked for. */
    land() { while (moves.length) { const next = index + moves.shift()!; if (next >= 0 && next < entries.length) { index = next; self.onMove(); } } },
    idle() { while (timers.length || moves.length) { self.timers(); self.land(); } },
  };
  return self;
}

/** The part of App.tsx that follows the address. `busy` stands for a save that is running. */
function app(hashes?: string[]) {
  const b = browser(hashes);
  const keeper = createDialogHistory(b.win);
  const state = { page: b.hash, busy: false };
  b.onMove = () => {
    keeper.moved();
    if (b.hash === state.page) return;
    if (state.busy) keeper.showPage(BASE + state.page); else state.page = b.hash;
  };
  keeper.start();
  const go = (hash: string) => { state.page = hash; if (b.hash !== hash) keeper.showPage(BASE + hash); };
  return { b, keeper, state, go };
}

/** A dialog that closes when asked unless `dirty`; `asked` counts the requests. */
function dialog(keeper: ReturnType<typeof createDialogHistory>, dirty = false) {
  const d = { asked: 0, dirty, open: true, gone: () => {}, close() { if (d.open) { d.open = false; d.gone(); } } };
  d.gone = keeper.opened(() => { d.asked += 1; if (!d.dirty) d.close(); });
  return d;
}

describe('MW-113b dialog history', () => {
  it('gives the first dialog on a page one entry at the same address', () => {
    const { b, keeper } = app(['', '#/transaksi']);
    dialog(keeper);
    b.idle();
    expect([b.hashes, b.index]).toEqual([['', '#/transaksi', '#/transaksi'], 2]);
  });

  it('closes the dialog on Back and stays on the page', () => {
    const { b, keeper, state } = app(['', '#/transaksi']);
    const d = dialog(keeper);
    b.idle();
    b.user(-1);
    b.idle();
    expect([d.asked, d.open, b.index, state.page]).toEqual([1, false, 1, '#/transaksi']);
    expect(b.calls.back + b.calls.forward).toBe(0);
    // The next Back leaves the page like before the dialog was opened.
    b.user(-1);
    b.idle();
    expect([b.index, state.page]).toEqual([0, '']);
  });

  it('returns to the entry it has when the dialog stays open, without adding one', () => {
    const { b, keeper, state } = app(['', '#/transaksi']);
    const d = dialog(keeper, true);
    b.idle();
    const pushed = b.calls.push;
    b.user(-1);
    b.idle();
    expect([d.asked, d.open, b.index, b.entries.length, b.calls.push - pushed, b.calls.forward]).toEqual([1, true, 2, 3, 0, 1]);
    // Every further Back asks again; once the form lets go, the dialog closes and the page stays.
    b.user(-1);
    b.idle();
    expect([d.asked, b.index]).toEqual([2, 2]);
    d.dirty = false;
    b.user(-1);
    b.idle();
    expect([d.asked, d.open, b.index, state.page]).toEqual([3, false, 1, '#/transaksi']);
  });

  it('never moves through the history when a dialog opens or closes by itself', () => {
    const { b, keeper, state } = app(['', '#/dompet']);
    for (let round = 0; round < 3; round += 1) {
      const d = dialog(keeper);
      b.idle();
      d.close();
      b.idle();
    }
    // One entry for all three, written once; nothing was pending that a reload could run into.
    expect([b.calls.back, b.calls.forward, b.calls.push, b.calls.replace, b.entries.length, state.page]).toEqual([0, 0, 1, 1, 3, '#/dompet']);
    // Back with no dialog open means leaving the page: the dialogs' entry is only a stop on the way.
    b.user(-1);
    b.idle();
    expect([b.index, state.page, b.calls.back]).toEqual([0, '', 1]);
  });

  it('uses the same entry when a dialog is replaced by another in the same step', () => {
    const { b, keeper } = app();
    const first = dialog(keeper);
    b.idle();
    const before = { ...b.calls };
    first.close();
    const second = dialog(keeper);
    b.idle();
    expect(b.calls).toEqual(before);
    b.user(-1);
    b.idle();
    expect([second.asked, second.open, b.index]).toEqual([1, false, 0]);
  });

  it('goes back onto the entry when Back closes one dialog and another opens in its place', () => {
    const { b, keeper } = app();
    const first = dialog(keeper);
    b.idle();
    let second: ReturnType<typeof dialog> | undefined;
    first.gone = (gone => () => { gone(); second = dialog(keeper); })(first.gone);
    b.user(-1);
    b.idle();
    expect([first.open, second?.open, b.index, b.entries.length]).toEqual([false, true, 1, 2]);
  });

  it('closes only the top dialog of two', () => {
    const { b, keeper } = app();
    const below = dialog(keeper);
    const above = dialog(keeper);
    b.idle();
    expect(b.entries.length).toBe(2);
    b.user(-1);
    b.idle();
    expect([above.open, below.open, below.asked, b.index]).toEqual([false, true, 0, 1]);
    b.user(-1);
    b.idle();
    expect([below.open, b.index]).toEqual([false, 0]);
  });

  it('rests on the entry after Forward or a reload, and one Back still leaves the page', () => {
    const { b, keeper, state } = app(['', '#/dompet']);
    dialog(keeper);
    b.idle();
    b.user(-1);
    b.idle();
    expect(b.index).toBe(1);
    b.user(1);
    b.idle();
    expect([b.index, state.page, b.calls.back]).toEqual([2, '#/dompet', 0]);
    // A reload starts without the dialog, on the same entry, and moves nowhere.
    const reloaded = createDialogHistory(b.win);
    b.onMove = () => { reloaded.moved(); if (b.hash !== state.page) state.page = b.hash; };
    reloaded.start();
    b.idle();
    expect([b.index, b.calls.back + b.calls.forward]).toEqual([2, 0]);
    // A dialog opened now uses the entry that is there.
    const d = dialog(reloaded);
    b.idle();
    expect(b.entries.length).toBe(3);
    b.user(-1);
    b.idle();
    expect([d.open, b.index, state.page]).toEqual([false, 1, '#/dompet']);
    b.user(1);
    b.idle();
    b.user(-1);
    b.idle();
    expect([b.index, state.page]).toEqual([0, '']);
  });

  it('hands its entry to the new page when the page changes', () => {
    // With the dialog closing in the same step.
    const closing = app(['', '#/dompet']);
    const first = dialog(closing.keeper);
    closing.b.idle();
    first.close();
    closing.go('#/impor');
    closing.b.idle();
    expect([closing.b.hashes, closing.b.index, closing.state.page]).toEqual([['', '#/dompet', '#/impor'], 2, '#/impor']);
    expect(closing.b.entries[2].state).toBeNull();
    closing.b.user(-1);
    closing.b.idle();
    expect([closing.b.index, closing.state.page]).toEqual([1, '#/dompet']);
    // With a dialog that stays open: it gets an entry on the new page.
    const staying = app();
    const second = dialog(staying.keeper, true);
    staying.b.idle();
    staying.go('#/transaksi');
    staying.b.idle();
    expect([staying.b.hashes, staying.b.index]).toEqual([['', '#/transaksi', '#/transaksi'], 2]);
    staying.b.user(-1);
    staying.b.idle();
    expect([second.asked, staying.b.index, staying.state.page]).toEqual([1, 2, '#/transaksi']);
  });

  it('writes a page address only after its own move has landed', () => {
    const { b, keeper, state, go } = app(['', '#/dompet']);
    const d = dialog(keeper, true);
    b.idle();
    b.user(-1);
    b.timers();
    // The dialog is on its way forward onto its entry when the page changes.
    expect(b.calls.forward).toBe(1);
    go('#/impor');
    b.idle();
    expect([b.hashes, state.page, d.open]).toEqual([['', '#/dompet', '#/impor', '#/impor'], '#/impor', true]);
  });

  it('puts the address back when Back is pressed while a save is running', () => {
    const { b, keeper, state } = app(['', '#/dompet']);
    const d = dialog(keeper);
    b.idle();
    d.close();
    b.idle();
    state.busy = true;
    b.user(-1);
    b.idle();
    expect([state.page, b.hash, b.hashes]).toEqual(['#/dompet', '#/dompet', ['', '#/dompet']]);
  });

  it('asks the dialog and follows the address when the user jumps further than one entry', () => {
    const { b, keeper, state } = app(['', '#/dompet', '#/transaksi']);
    const d = dialog(keeper, true);
    b.idle();
    b.user(-2);
    b.idle();
    // The dialog is still open on the page the user went to and has an entry there.
    expect([d.asked, state.page, b.hashes, b.index]).toEqual([1, '#/dompet', ['', '#/dompet', '#/dompet'], 2]);
  });

  it('writes the mark below only once per page entry, and survives a refused write', () => {
    const { b, keeper, state } = app(['', '#/dompet']);
    for (let round = 0; round < 2; round += 1) { const d = dialog(keeper); b.idle(); b.user(-1); b.idle(); expect(d.open).toBe(false); }
    expect([b.calls.replace, b.calls.push]).toEqual([1, 2]);
    // The browser refuses: the dialog has no entry, nothing throws, and Back leaves the page as before.
    const push = b.win.history.pushState;
    b.win.history.pushState = () => { throw new Error('SecurityError'); };
    const refused = dialog(keeper, true);
    b.idle();
    expect(b.index).toBe(1);
    b.user(-1);
    b.idle();
    expect([refused.asked, state.page, b.index]).toEqual([0, '', 0]);
    // Once writes work again the open dialog gets its entry with the next change.
    b.win.history.pushState = push;
    const next = dialog(keeper);
    b.idle();
    expect([b.index, b.entries.length]).toEqual([1, 2]);
  });

  it('is not stuck after stepping back from the first entry of a tab', () => {
    const { b, keeper, state } = app();
    const first = dialog(keeper);
    b.idle();
    first.close();
    b.idle();
    // Back lands on the page's entry; the step after it goes nowhere and reports nothing.
    b.user(-1);
    b.idle();
    expect([b.index, state.page, b.calls.back]).toEqual([0, '', 1]);
    const second = dialog(keeper);
    b.idle();
    expect([b.index, b.entries.length]).toEqual([1, 2]);
    b.user(-1);
    b.idle();
    expect([second.open, b.index]).toEqual([false, 0]);
  });
});
