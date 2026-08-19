interface Identifiable {
  platform_player_id: string
}

/** Whether `clientY` sits past the vertical midpoint of a rect (top/height
 * from `getBoundingClientRect()`) -- i.e. the cursor is over the bottom half
 * of the hovered row. A tiny pure seam so this arithmetic is directly
 * testable with plain numbers, without needing a real DOM measurement or a
 * `DragEvent.clientY` (which jsdom doesn't actually implement). */
export function isBelowMidpoint(
  clientY: number,
  rect: { top: number; height: number },
): boolean {
  return clientY - rect.top > rect.height / 2
}

/**
 * Computes where `draggedId` would land if dropped right now, given which
 * row the cursor is over (`hoveredId`, or null for the "move to end" zone)
 * and whether the cursor is past that row's vertical midpoint (`insertAfter`).
 *
 * Meant to be called on every `dragover`, not just on drop, so the list
 * reorders live as you drag. The before/after split is also what makes
 * moving exactly one spot possible: dropping in a row's top half is a no-op
 * relative to that row (you're already right before it), so without a
 * bottom-half case there'd be no way to land just past the very next row.
 *
 * Pure and DOM-free -- the drag-and-drop UI (reading cursor position off the
 * DOM) is a thin wrapper around this.
 */
export function reorderList<T extends Identifiable>(
  list: T[],
  draggedId: string,
  hoveredId: string | null,
  insertAfter = false,
): T[] {
  const fromIndex = list.findIndex(
    (item) => item.platform_player_id === draggedId,
  )
  if (fromIndex === -1 || draggedId === hoveredId) return list

  const next = [...list]
  const [dragged] = next.splice(fromIndex, 1)

  if (hoveredId === null) {
    next.push(dragged)
    return next
  }

  const hoveredIndex = next.findIndex(
    (item) => item.platform_player_id === hoveredId,
  )
  if (hoveredIndex === -1) return list

  next.splice(insertAfter ? hoveredIndex + 1 : hoveredIndex, 0, dragged)
  return next
}
