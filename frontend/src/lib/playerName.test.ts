import { describe, expect, it } from 'vitest'

import { abbreviateName } from './playerName'

describe('abbreviateName', () => {
  it.each([
    ['Jahmyr Gibbs', 'J. Gibbs'],
    ['Drake London', 'D. London'],
    ["Ja'Marr Chase", 'J. Chase'],
    // Multi-part surnames stay whole -- the surname is the identifying part.
    ['Amon-Ra St. Brown', 'A. St. Brown'],
    ['Marvin Harrison Jr.', 'M. Harrison Jr.'],
    // A single token has nothing to abbreviate.
    ['Chase', 'Chase'],
    ['  Bijan   Robinson  ', 'B. Robinson'],
  ])('%s -> %s', (input, expected) => {
    expect(abbreviateName(input)).toBe(expected)
  })

  it('keeps team defenses readable', () => {
    // "S. 49ers" is not a name.
    expect(abbreviateName('San Francisco 49ers')).toBe('49ers')
  })
})
