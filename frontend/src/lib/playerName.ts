/** Shorten a player name to fit a draft-board cell.
 *
 * Truncating with an ellipsis ("Jahmyr Gibbs" -> "Jah…") loses the only part
 * that identifies the player. Abbreviating the first name keeps the surname
 * whole, which is what you actually read off a board.
 */
export function abbreviateName(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length < 2) return name.trim()

  const [first, ...rest] = parts
  // Team defenses ("San Francisco 49ers") read worse abbreviated -- "S. 49ers"
  // is not a name. Keep the last token, which is the identifying one.
  if (/^\d/.test(rest[rest.length - 1])) return rest[rest.length - 1]

  return `${first[0]}. ${rest.join(' ')}`
}
