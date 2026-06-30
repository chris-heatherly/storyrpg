/**
 * Beat onShow consequence normalization (bite-me-g16 flag-economy fix).
 *
 * The reader engine's consequence applier (gameStore/rewindEngine) only handles the
 * canonical `{ type: 'setFlag', flag, value }`. SceneWriter frequently authors an onShow
 * flag SET using the CONDITION form `{ type: 'flag', flag, value }` (the shape the engine
 * uses to *read* a flag), so the onShow entry is a runtime NO-OP: the flag never sets, and
 * any later text-variant or payoff keyed on it can never fire — the "inert residue economy"
 * the audit found (e.g. kylie_is_hopeful, the ep1 rescue flags). It also made
 * FlagContractValidator misread the entry as a dead condition.
 *
 * This deterministic pass rewrites onShow `type:'flag'` consequences to `type:'setFlag'`,
 * preserving order and every other entry. Pure; returns the input unchanged when there is
 * nothing to fix (so it is safe to call unconditionally at assembly).
 */

export function normalizeOnShowFlagConsequences<T>(onShow: T): T {
  if (!Array.isArray(onShow)) return onShow;
  let changed = false;
  const out = onShow.map((c) => {
    if (
      c && typeof c === 'object' &&
      (c as { type?: unknown }).type === 'flag' &&
      typeof (c as { flag?: unknown }).flag === 'string'
    ) {
      changed = true;
      return { ...(c as object), type: 'setFlag' };
    }
    return c;
  });
  return (changed ? out : onShow) as T;
}
