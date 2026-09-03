/** A user's priority order over rank sources, independent of which are
 * currently checked or available.
 *
 * Kept as a plain list of refs rather than derived from selection state,
 * because the order matters even for a source that isn't selected right now
 * (or doesn't exist yet for the current scope) -- "ADP before my own list"
 * should hold whether or not either happens to be checked at the moment.
 */

/** Merge a stored order with what's actually available: known refs keep their
 * relative order, and anything new (a freshly imported dataset, a rank set
 * that didn't exist yet) is appended at the end rather than discarded. */
export function reconcileOrder(
  storedOrder: string[],
  availableRefs: string[],
): string[] {
  const available = new Set(availableRefs)
  const known = storedOrder.filter((ref) => available.has(ref))
  const knownSet = new Set(known)
  const fresh = availableRefs.filter((ref) => !knownSet.has(ref))
  return [...known, ...fresh]
}

/** Swap a ref with its neighbour. A no-op at either end of the list, or for a
 * ref the order doesn't contain. */
export function moveInOrder(
  order: string[],
  ref: string,
  direction: 'up' | 'down',
): string[] {
  const index = order.indexOf(ref)
  if (index === -1) return order
  const swapWith = direction === 'up' ? index - 1 : index + 1
  if (swapWith < 0 || swapWith >= order.length) return order

  const next = [...order]
  ;[next[index], next[swapWith]] = [next[swapWith], next[index]]
  return next
}

/** Sort items by their position in a priority order. Anything not in the
 * order (shouldn't normally happen once reconciled, but a defensive default)
 * sorts after everything that is. */
export function sortByOrder<T>(
  items: T[],
  order: string[],
  refOf: (item: T) => string,
): T[] {
  const rank = new Map(order.map((ref, i) => [ref, i]))
  return [...items].sort(
    (a, b) =>
      (rank.get(refOf(a)) ?? Number.POSITIVE_INFINITY) -
      (rank.get(refOf(b)) ?? Number.POSITIVE_INFINITY),
  )
}
