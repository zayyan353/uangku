/**
 * Lets the browser's Back close an open dialog instead of leaving the page.
 *
 * The first dialog opened on a page adds one history entry with the page's own address; only its
 * state marks it. The page then rests on that entry, and every later dialog on the page uses it
 * again. Opening or closing a dialog by its own buttons never moves through the history, so
 * nothing here can cut across a reload or a save.
 *
 * Back on that entry lands on the page's entry below it:
 * - with a dialog open, the top dialog is asked to close the way Escape does, so a filled form
 *   still gets its discard question. A dialog that stays open goes forward onto the entry again;
 * - with no dialog open, the user meant to leave the page, so one more step back is taken.
 *
 * `history.back()` and `history.forward()` finish later, and a page address written in between
 * would land in the wrong place. Every write to the address therefore goes through `showPage`,
 * which is given the whole address (see `addressForPage`).
 */
export interface HistoryWindow {
  history: {
    readonly state: unknown;
    readonly length: number;
    pushState(data: unknown, unused: string, url?: string | null): void;
    replaceState(data: unknown, unused: string, url?: string | null): void;
    back(): void;
    forward(): void;
  };
  navigation?: { forward(): { finished: Promise<unknown> } };
  location: { readonly href: string };
  setTimeout(handler: () => void, timeout?: number): unknown;
}

/**
 * Where the current history entry is relative to the dialogs' entry:
 * `none` it is an ordinary page entry; `on` it is the dialogs' entry; `under` Back was pressed with
 * a dialog open and the dialogs' entry is the next one forward; `returning` and `leaving` are this
 * module's own `forward()` and `back()` that have not landed yet.
 */
type Where = 'none' | 'on' | 'under' | 'returning' | 'leaving';
type Mark = { uangkuDialog?: string; uangkuUnder?: string; firstPageEntry?: boolean };

export function createDialogHistory(win: HistoryWindow) {
  const open: Array<{ close: () => void }> = [];
  let where: Where = 'none';
  let token = '';
  let firstPageEntry = false;
  let serial = 0;
  let wanted: string | null = null;
  let queued = false;
  let pendingReturn: Promise<unknown> | undefined;

  const mark = (): Mark => (typeof win.history.state === 'object' && win.history.state !== null ? win.history.state : {}) as Mark;

  /** Takes the entry the address is on as it is: the dialogs' entry of some page, or an ordinary one. */
  function rest() {
    const entry = mark();
    if (entry.uangkuDialog !== undefined) {
      token = entry.uangkuDialog;
      firstPageEntry = entry.firstPageEntry === true || win.history.length === 2;
      where = 'on';
    } else where = 'none';
  }
  /** One of this module's own moves has landed. */
  function landed() {
    pendingReturn = undefined;
    rest();
    if (wanted !== null) { const url = wanted; wanted = null; if (url !== win.location.href) showPage(url); }
    schedule();
  }
  /** The state changes in the same step that reports a move, so a move that shows in the state has landed even if no event said so. */
  function catchUp() {
    // Competing Back requests can cancel Forward without a popstate. Once the form closes it no longer
    // needs that entry. Writing a new page from below will discard the obsolete forward entry.
    if (where === 'returning' && (mark().uangkuDialog === token || open.length === 0)) landed();
    if (where === 'leaving' && mark().uangkuUnder !== token) landed();
  }
  /** Return to the existing dialog entry. A classic Forward can be silently dropped when it races
   * another Back. The Navigation API reports cancellation, so we can give the still-open form an entry again. */
  function returnToDialog() {
    where = 'returning';
    try {
      if (win.navigation) {
        const finished = win.navigation.forward().finished;
        pendingReturn = finished;
        void finished.catch(() => { if (pendingReturn === finished && where === 'returning') landed(); });
      } else win.history.forward();
    } catch { landed(); }
  }
  /** Gives the open dialogs their entry. Closing one dialog and opening another in the same step changes nothing. */
  function settle() {
    queued = false;
    catchUp();
    if (where === 'returning' || where === 'leaving') return;
    if (where === 'none' && mark().uangkuDialog !== undefined) rest();
    if (open.length > 0) {
      if (where === 'none') {
        const url = win.location.href;
        const below = mark().uangkuUnder;
        try {
          // The page's entry carries the same mark, so Back can be told apart from a move to anywhere else.
          // A page entry keeps its mark: a browser allows only so many history writes in a short time.
          if (below === undefined) {
            serial += 1;
            token = `${Date.now().toString(36)}-${serial}`;
            win.history.replaceState({ uangkuUnder: token }, '', url);
          } else token = below;
          const first = win.history.length === 1;
          win.history.pushState({ uangkuDialog: token, firstPageEntry: first }, '', url);
          // pushState truncates Forward. With exactly two entries left, the one below the
          // dialog is the start of this tab, even if it had Forward entries before this push.
          if (!first && win.history.length === 2) win.history.replaceState({ uangkuDialog: token, firstPageEntry: true }, '', url);
        } catch { /* The browser refused the write (Safari: more than 100 in 30 seconds). */ }
        // A refused or dropped write leaves these dialogs without an entry; Back then leaves the page as it did before.
        if (mark().uangkuDialog === token) rest();
      } else if (where === 'under') returnToDialog();
    } else if (where === 'under') where = 'none';
  }
  function schedule() {
    if (queued) return;
    queued = true;
    win.setTimeout(settle, 0);
  }

  /**
   * Puts the page's address in the history. The dialogs' entry belongs to the page left behind: it becomes the new
   * page's entry. A browser may refuse the write (Safari allows 100 in 30 seconds); the page shown is right either
   * way and only the address lags.
   */
  function showPage(url: string) {
    catchUp();
    if (where === 'returning' || where === 'leaving') { wanted = url; return; }
    try {
      if (mark().uangkuDialog !== undefined) win.history.replaceState(null, '', url);
      else win.history.pushState(null, '', url);
    } catch { /* see above */ }
    rest();
    schedule();
  }

  function closeTop(): boolean {
    const top = open.at(-1);
    if (!top) return false;
    top.close();
    return true;
  }

  return {
    closeTop,
    /** A dialog is on screen. `close` asks it to close the way Escape does and may leave it open. Returns what to call when it is gone. */
    opened(close: () => void): () => void {
      const item = { close };
      open.push(item);
      schedule();
      return () => {
        const at = open.indexOf(item);
        if (at >= 0) open.splice(at, 1);
        schedule();
      };
    },
    showPage,
    /** A reload keeps the history: the page may start on the dialogs' entry, with no dialog open. */
    start() {
      if (where === 'none') rest();
    },
    /** Call for every `popstate` and `hashchange`, before the page follows the address. */
    moved() {
      if (where === 'returning' || where === 'leaving') { landed(); return; }
      const now = mark();
      if (where === 'on' && now.uangkuDialog !== token) {
        if (now.uangkuUnder === token && open.length === 0) {
          // Back with no dialog open: the user is leaving the page, and this entry was only a stop on the way.
          // Back from the beginning of a tab reports no event. A real step to a preceding entry
          // must land before a newly requested address can be written.
          where = firstPageEntry || win.history.length === 2 ? 'none' : 'leaving';
          win.history.back();
          return;
        }
        where = now.uangkuUnder === token ? 'under' : 'none';
        closeTop();
        schedule();
      } else if (where === 'under' && now.uangkuUnder !== token) where = 'none';
      if (where !== 'under') rest();
    },
  };
}

let shared: ReturnType<typeof createDialogHistory> | undefined;

/** The one history keeper of this window. */
export function dialogHistory() {
  return shared ??= createDialogHistory(window);
}
