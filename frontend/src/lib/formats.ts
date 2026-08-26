export const SEASON = '2026'

export const FORMATS = [
  { value: 'std', label: 'Standard' },
  { value: 'ppr', label: 'PPR' },
  { value: 'half_ppr', label: 'Half PPR' },
  { value: '2qb', label: '2QB / Superflex' },
  { value: 'dynasty_std', label: 'Dynasty (Std)' },
  { value: 'dynasty_ppr', label: 'Dynasty (PPR)' },
  { value: 'dynasty_half_ppr', label: 'Dynasty (Half PPR)' },
] as const

export const POSITIONS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const
export type PositionFilter = (typeof POSITIONS)[number]

/** Positions that get their own buildable rank list.
 *
 * Deliberately not POSITIONS above, which carries ALL/K/DEF -- those would
 * leak into the Build view's position picker, and neither kickers nor defenses
 * are worth ranking carefully.
 */
export const BUILD_POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const
export type BuildPosition = (typeof BUILD_POSITIONS)[number]
