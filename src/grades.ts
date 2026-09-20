// Boulder route grades.
//
// The app renders two scales with their own colors: Fontainebleau
// (`climbing:grade:font`) and Hueco / V (`climbing:grade:hueco`). No grade is
// ever converted into another scale; the two color tables below just happen to
// share the same green→red ramp, which is a purely visual choice. Any other
// `climbing:grade:*` scale (e.g. `fb`, `uiaa`, `french`) is shown in neutral
// gray so it is still visible without pretending to understand it.

export type RGB = string

export const UNKNOWN_GRADE_COLOR = '#9e9e9e'

// Canonical uppercase Font grades as they appear (or should appear) in the
// `climbing:grade:font` OSM tag.
export const GRADE_COLORS: Record<string, RGB> = {
  '1': '#2e7d32', '2': '#2e7d32', '3': '#2e7d32', '3+': '#2e7d32',
  '4': '#43a047', '4+': '#43a047',
  '5': '#7cb342', '5+': '#7cb342',
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

// Canonical uppercase Hueco (V) grades.
export const HUECO_GRADE_COLORS: Record<string, RGB> = {
  'VB': '#2e7d32', 'V0-': '#2e7d32', 'V0': '#43a047', 'V0+': '#43a047',
  'V1': '#7cb342', 'V1+': '#7cb342',
  'V2': '#7cb342', 'V2+': '#7cb342',
  'V3': '#c0ca33', 'V3+': '#c0ca33',
  'V4': '#fdd835', 'V4+': '#fdd835',
  'V5': '#ffb300', 'V5+': '#ffb300',
  'V6': '#fb8c00', 'V6+': '#fb8c00',
  'V7': '#f4511e', 'V7+': '#f4511e',
  'V8': '#e53935', 'V8+': '#e53935',
  'V9': '#b71c1c', 'V9+': '#b71c1c',
  'V10': '#b71c1c', 'V11': '#b71c1c', 'V12': '#b71c1c', 'V13': '#b71c1c',
  'V14': '#b71c1c', 'V15': '#b71c1c', 'V16': '#b71c1c', 'V17': '#b71c1c'
}

export interface GradeSystem {
  key: string
  label: string
  // Present only for the scales we color; absent scales fall back to gray.
  colors?: Record<string, RGB>
}

// Accepted values for the two editable scales. These are the canonical OSM
// values, so validation rejects anything else instead of writing junk tags.
export const FONT_GRADES: string[] = [
  '1', '2', '3', '3+', '4', '4+', '5', '5+',
  '5A', '5A+', '5B', '5B+', '5C', '5C+',
  '6A', '6A+', '6B', '6B+', '6C', '6C+',
  '7A', '7A+', '7B', '7B+', '7C', '7C+',
  '8A', '8A+', '8B', '8B+', '8C', '8C+', '9A'
]

export const HUECO_GRADES: string[] = [
  'VB', 'V0-', 'V0', 'V0+',
  'V1', 'V1+', 'V2', 'V2+', 'V3', 'V3+', 'V4', 'V4+', 'V5', 'V5+',
  'V6', 'V6+', 'V7', 'V7+', 'V8', 'V8+', 'V9', 'V9+',
  'V10', 'V11', 'V12', 'V13', 'V14', 'V15', 'V16', 'V17'
]

export const GRADE_VALUES: Record<string, string[]> = {
  'climbing:grade:font': FONT_GRADES,
  'climbing:grade:hueco': HUECO_GRADES
}

export function gradeSuggestions(tagKey: string): string[] {
  return GRADE_VALUES[tagKey] ?? []
}

export function isValidGrade(tagKey: string, value: string): boolean {
  return gradeSuggestions(tagKey).includes(value.trim().toUpperCase())
}

// Order matters: the first matching colored system drives the route dot color.
export const GRADE_SYSTEMS: GradeSystem[] = [
  { key: 'climbing:grade:hueco', label: 'Hueco', colors: HUECO_GRADE_COLORS },
  { key: 'climbing:grade:font', label: 'Font', colors: GRADE_COLORS },
  { key: 'climbing:grade:fb', label: 'fb' },
  { key: 'climbing:grade:uiaa', label: 'UIAA' },
  { key: 'climbing:grade:french', label: 'French' },
  { key: 'climbing:grade:saxon', label: 'Saxon' },
  { key: 'climbing:grade:polish', label: 'Polish' },
  { key: 'climbing:grade:yds_class', label: 'YDS' },
  { key: 'climbing:grade:norwegian', label: 'Norwegian' }
]

export interface Grade {
  system: GradeSystem
  value: string
  color: RGB
  // True for the two first-class scales (Hueco, Font); false for gray scales.
  nice: boolean
}

export function gradeSystemColor(system: GradeSystem, value: string): RGB {
  if (!system.colors) return UNKNOWN_GRADE_COLOR
  return system.colors[value.toUpperCase()] ?? UNKNOWN_GRADE_COLOR
}

/** Color for a tag key/value pair, gray for scales we do not color. */
export function gradeColorForTag(tagKey: string, value: string): RGB {
  const system = GRADE_SYSTEMS.find(candidate => candidate.key === tagKey)
  return system ? gradeSystemColor(system, value) : UNKNOWN_GRADE_COLOR
}

/** Every grade present on a tag bag, in GRADE_SYSTEMS order. */
export function gradesFromTags(tags: Record<string, any>): Grade[] {
  const grades: Grade[] = []
  for (const system of GRADE_SYSTEMS) {
    const raw = tags[system.key]
    if (raw === undefined || raw === null) continue
    const value = String(raw).trim()
    if (!value) continue
    grades.push({ system, value, color: gradeSystemColor(system, value), nice: !!system.colors })
  }
  return grades
}

/** Human-readable chip text: bare value for nice scales, labelled otherwise. */
export function gradeLabel(grade: Grade): string {
  return grade.nice ? grade.value : `${grade.system.label} ${grade.value}`
}

/** Route dot color: Hueco, then Font, then gray. Purely visual, no conversion. */
export function routeGradeColor(tags: Record<string, any>): RGB {
  for (const system of GRADE_SYSTEMS) {
    if (!system.colors) continue
    const raw = tags[system.key]
    if (raw === undefined || raw === null || !String(raw).trim()) continue
    return gradeSystemColor(system, String(raw))
  }
  return UNKNOWN_GRADE_COLOR
}

/** Font-only color helper, kept for callers that only deal in Font grades. */
export function gradeColor(grade?: string | null): RGB {
  if (!grade) return UNKNOWN_GRADE_COLOR
  return GRADE_COLORS[grade.toUpperCase()] ?? UNKNOWN_GRADE_COLOR
}

function matchExpression(property: string, colors: Record<string, RGB>): any[] {
  const expr: any[] = ['match', ['upcase', ['get', property]]]
  for (const [grade, color] of Object.entries(colors)) expr.push(grade, color)
  expr.push(UNKNOWN_GRADE_COLOR)
  return expr
}

/** MapLibre expression mapping a Font grade property to a color. */
export function gradeColorExpression(propertyName: string) {
  return matchExpression(propertyName, GRADE_COLORS)
}

/** MapLibre expression: Hueco color, else Font color, else unknown gray. */
export function routeGradeColorExpression() {
  return [
    'case',
    ['has', 'climbing:grade:hueco'], matchExpression('climbing:grade:hueco', HUECO_GRADE_COLORS),
    ['has', 'climbing:grade:font'], matchExpression('climbing:grade:font', GRADE_COLORS),
    UNKNOWN_GRADE_COLOR
  ]
}
