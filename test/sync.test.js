/* Client-side sync primitives: code generation, normalisation and the capability
   check that keeps the offline/standalone build working with no backend. */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatCode, normaliseCode, generateCode, syncAvailable, isLinked
} from '../src/core/sync.js';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

test('generated codes use only the unambiguous alphabet', () => {
  for (let i = 0; i < 200; i++) {
    const code = generateCode();
    assert.equal(code.length, 20, 'code length');
    for (const ch of code) {
      assert.ok(ALPHABET.includes(ch), `character ${ch} is outside the alphabet`);
    }
    // The look-alikes must never appear: a code gets read off one screen and
    // typed into another, so O/0 and I/1/L confusion would be a support burden.
    assert.ok(!/[OIL01]/.test(code), `code ${code} contains a look-alike character`);
  }
});

test('generated codes are not repeated', () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) seen.add(generateCode());
  assert.equal(seen.size, 500, 'generateCode produced a collision in 500 draws');
});

test('the alphabet is used roughly uniformly', () => {
  // Guards the modulo-bias resampling: a naive `byte % 31` would over-represent
  // the first few characters.
  const counts = new Map();
  const draws = 2000;
  for (let i = 0; i < draws; i++) {
    for (const ch of generateCode()) counts.set(ch, (counts.get(ch) || 0) + 1);
  }
  const total = draws * 20;
  const expected = total / ALPHABET.length;
  for (const ch of ALPHABET) {
    const got = counts.get(ch) || 0;
    const ratio = got / expected;
    assert.ok(ratio > 0.8 && ratio < 1.2, `character ${ch} appeared ${ratio.toFixed(2)}x expected`);
  }
});

test('formatCode groups into readable blocks', () => {
  assert.equal(formatCode('ABCDEFGHJKMNPQRSTUVW'), 'ABCD-EFGH-JKMN-PQRS-TUVW');
  assert.equal(formatCode(''), '');
  assert.equal(formatCode(null), '');
});

test('normaliseCode accepts what a person would actually type', () => {
  const canonical = 'ABCDEFGHJKMNPQRSTUVW';
  assert.equal(normaliseCode('ABCD-EFGH-JKMN-PQRS-TUVW'), canonical, 'dashed');
  assert.equal(normaliseCode('abcd efgh jkmn pqrs tuvw'), canonical, 'lowercase with spaces');
  assert.equal(normaliseCode('  ABCDEFGHJKMNPQRSTUVW  '), canonical, 'padded');
});

test('normaliseCode rejects anything malformed', () => {
  assert.equal(normaliseCode('TOOSHORT'), null, 'short code');
  assert.equal(normaliseCode('ABCDEFGHJKMNPQRSTUVWX'), null, 'long code');
  assert.equal(normaliseCode('ABCDEFGHJKMNPQRSTUV0'), null, 'contains a zero');
  assert.equal(normaliseCode('ABCDEFGHJKMNPQRSTUVI'), null, 'contains an I');
  assert.equal(normaliseCode(null), null);
  assert.equal(normaliseCode(42), null);
  assert.equal(normaliseCode(''), null);
});

test('a generated code always round-trips through format and normalise', () => {
  for (let i = 0; i < 100; i++) {
    const code = generateCode();
    assert.equal(normaliseCode(formatCode(code)), code);
  }
});

test('sync reports itself unavailable with no http origin', () => {
  // Node has no window.location, which is the same situation as the standalone
  // file:// build. The app must stay fully usable in that state.
  assert.equal(syncAvailable(), false);
  assert.equal(isLinked(), false, 'no link without storage');
});
