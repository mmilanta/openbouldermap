// Fontainebleau (bouldering) grade -> color, green (easy) -> red (hard).
// Mirrors requirements.md §7. Unknown grades render gray.

export type RGB = string

// Canonical uppercase Font grades as they appear (or should appear) in the
// `climbing:grade:font` OSM tag.
export const GRADE_COLORS: Record<string, RGB> = {
  '1': '#2e7d32', '2': '#2e7d32', '3': '#2e7d32', '3+': '#2e7d32',
  '4': '#43a047', '4+': '#43a047',
  '5A': '#7cb342', '5A+': '#7cb342', '5B': '#7cb342', '5B+': '#7cb342',
  '5C': '#c0ca33', '5C+': '#c0ca33', '6A': '#c0ca33',
  '6A+': '#fdd835', '6B': '#fdd835',
  '6B+': '#ffb300', '6C': '#ffb300',
  '6C+': '#fb8c00', '7A': '#fb8c00',
  '7A+': '#f4511e', '7B': '#f4511e',
  '7B+': '#e53935', '7C': '#e53935',
  '7C+': '#b71c1c', '8A': '#b71c1c', '8A+': '#b71c1c',
  '8B': '#b71c1c', '8B+': '#b71c1c', '8C': '#b71c1c', '8C+': '#b71c1c',
  '9A': '#b71c1c'
}

export const UNKNOWN_GRADE_COLOR = '#9e9e9e'

export function gradeColor(grade?: string | null): RGB {
  if (!grade) return UNKNOWN_GRADE_COLOR
  return GRADE_COLORS[grade.toUpperCase()] ?? UNKNOWN_GRADE_COLOR
}

// Build a MapLibre `match` expression that maps the (uppercased) font grade
// property to a color, defaulting to the unknown color.
export function gradeColorExpression(propertyName: string) {
  const inputs: string[] = []
  const labels: RGB[] = []
  for (const [g, c] of Object.entries(GRADE_COLORS)) {
    inputs.push(g)
    labels.push(c)
  }
  // match expects: [match, input, label1, output1, ..., default]
  return ['match', ['upcase', ['get', propertyName]], ...inputs, ...labels, UNKNOWN_GRADE_COLOR]
}
