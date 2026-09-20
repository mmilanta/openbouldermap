import test from 'node:test'
import assert from 'node:assert/strict'
import {
  GRADE_COLORS,
  HUECO_GRADE_COLORS,
  UNKNOWN_GRADE_COLOR,
  gradeLabel,
  gradesFromTags,
  routeGradeColor
} from '../src/grades.ts'

test('Font and Hueco grades render with their own colors', () => {
  const grades = gradesFromTags({ 'climbing:grade:font': '7A', 'climbing:grade:hueco': 'V6' })
  assert.deepEqual(
    grades.map(grade => [grade.system.label, grade.value, grade.nice, grade.color]),
    [
      ['Hueco', 'V6', true, HUECO_GRADE_COLORS['V6']],
      ['Font', '7A', true, GRADE_COLORS['7A']]
    ]
  )
})

test('other scales are shown, but gray and labelled', () => {
  const grades = gradesFromTags({ 'climbing:grade:fb': '6A' })
  assert.equal(grades.length, 1)
  assert.equal(grades[0].nice, false)
  assert.equal(grades[0].color, UNKNOWN_GRADE_COLOR)
  assert.equal(gradeLabel(grades[0]), 'fb 6A')
})

test('route dot color prefers Hueco, then Font, then gray', () => {
  assert.equal(routeGradeColor({ 'climbing:grade:hueco': 'V3', 'climbing:grade:font': '6A' }), HUECO_GRADE_COLORS['V3'])
  assert.equal(routeGradeColor({ 'climbing:grade:font': '6C' }), GRADE_COLORS['6C'])
  assert.equal(routeGradeColor({ 'climbing:grade:fb': '6A' }), UNKNOWN_GRADE_COLOR)
  assert.equal(routeGradeColor({}), UNKNOWN_GRADE_COLOR)
})

test('unknown values within a known scale fall back to gray', () => {
  assert.equal(gradesFromTags({ 'climbing:grade:font': 'nonsense' })[0].color, UNKNOWN_GRADE_COLOR)
})

test('no grades yields an empty list', () => {
  assert.deepEqual(gradesFromTags({ name: 'x' }), [])
})
