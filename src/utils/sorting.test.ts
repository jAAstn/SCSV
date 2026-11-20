/// <reference types="node" />
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildOrderRank, compareByOriginalOrder, compareBySize } from './sorting.ts'

const sizes: Record<string, number | string> = {
  a: 100,
  b: 300,
  c: 200,
  unknown: 'N/A',
}

test('compareBySize sorts large to small', () => {
  assert.deepEqual(
    ['a', 'b', 'c'].sort((a, b) => compareBySize(a, b, sizes, 'desc')),
    ['b', 'c', 'a']
  )
})

test('compareBySize sorts small to large', () => {
  assert.deepEqual(
    ['a', 'b', 'c'].sort((a, b) => compareBySize(a, b, sizes, 'asc')),
    ['a', 'c', 'b']
  )
})

test('compareBySize keeps unknown sizes last in both directions', () => {
  assert.deepEqual(
    ['unknown', 'a'].sort((a, b) => compareBySize(a, b, sizes, 'desc')),
    ['a', 'unknown']
  )
  assert.deepEqual(
    ['unknown', 'a'].sort((a, b) => compareBySize(a, b, sizes, 'asc')),
    ['a', 'unknown']
  )
})

test('compareByOriginalOrder restores the captured order', () => {
  const rank = buildOrderRank(['c', 'a', 'b'])
  assert.deepEqual(
    ['a', 'b', 'c'].sort((a, b) => compareByOriginalOrder(a, b, rank)),
    ['c', 'a', 'b']
  )
})
