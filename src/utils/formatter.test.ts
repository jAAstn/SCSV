/// <reference types="node" />
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { FileFormatter } from './formatter.ts'

test('formatSteamSize uses decimal units like Steam', () => {
  assert.equal(FileFormatter.formatSteamSize(970_350_000), '970.350 MB')
  assert.equal(FileFormatter.formatSteamSize(1_500_000_000), '1.500 GB')
  assert.equal(FileFormatter.formatSteamSize(1_024), '1.02 KB')
  assert.equal(FileFormatter.formatSteamSize(999), '999 B')
})

test('formatSteamSizeWithUnit forces MB or GB', () => {
  assert.equal(FileFormatter.formatSteamSizeWithUnit(970_350_000, false), '970.35 MB')
  assert.equal(FileFormatter.formatSteamSizeWithUnit(970_350_000, true), '0.97 GB')
})
