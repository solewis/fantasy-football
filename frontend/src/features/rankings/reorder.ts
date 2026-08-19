interface Identifiable {
  platform_player_id: string
}

/** Moves `draggedId` to sit just before `targetId` (or to the very end, if
 * `targetId` is null -- "insert before some id" can't otherwise express
 * "last position"), preserving everything else's relative order. Pure and
 * DOM-free so it's cheap to test thoroughly on its own -- the drag-and-drop
 * UI is a thin wrapper around it. */
export function reorderList<T extends Identifiable>(
  list: T[],
  draggedId: string,
  targetId: string | null,
): T[] {
  const draggedIndex = list.findIndex(
    (item) => item.platform_player_id === draggedId,
  )
  if (draggedIndex === -1 || draggedId === targetId) return list

  const next = [...list]
  const [dragged] = next.splice(draggedIndex, 1)

  if (targetId === null) {
    next.push(dragged)
    return next
  }

  const insertAt = next.findIndex(
    (item) => item.platform_player_id === targetId,
  )
  if (insertAt === -1) return list

  next.splice(insertAt, 0, dragged)
  return next
}
