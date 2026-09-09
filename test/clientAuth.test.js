/* The client-side session module. Node has no `location` and no `fetch` target,
   which is the same situation as the standalone file:// build — so this suite is
   really asking one question: does the app stay whole with no backend at all? */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  authAvailable, session, isSignedIn, currentUser, authConfigured,
  loadSession, withPassword, signOut, googleUrl, startGoogle,
  consumeRedirectResult, onAuthChange
} from '../src/core/auth.js';

test('auth reports itself unavailable with no http origin', () => {
  assert.equal(authAvailable(), false);
  assert.equal(isSignedIn(), false);
  assert.equal(currentUser(), null);
});

test('loading a session with no backend settles as signed out', async () => {
  const state = await loadSession(true);
  assert.equal(state.signedIn, false);
  assert.equal(state.loaded, true, 'loaded, so the UI shows a real answer, not a spinner');
  assert.equal(authConfigured(), false, 'no provider is offered that could not work');
  assert.equal(session().signedIn, false);
});

test('sign-in attempts fail cleanly rather than throwing', async () => {
  // A failed sign-in is an ordinary outcome. Throwing here would take down
  // whatever screen called it, which is never the right trade for a login form.
  const res = await withPassword('signin', 'someone@example.com', 'a-long-password');
  assert.equal(res.ok, false);
  assert.equal(res.error, 'unavailable');

  const out = await signOut();
  assert.equal(out.ok, false);
  assert.equal(startGoogle('#/test'), false, 'no navigation is attempted');
});

test('googleUrl only ever carries a same-document hash route', () => {
  assert.equal(googleUrl('#/test'), `/api/auth/google?next=${encodeURIComponent('#/test')}`);
  // Anything that is not a hash route is replaced, not passed through: this is
  // the value that decides where the browser lands after the redirect.
  for (const hostile of ['https://evil.example', '//evil.example', '/absolute', null, 42]) {
    assert.equal(
      googleUrl(hostile),
      `/api/auth/google?next=${encodeURIComponent('#/')}`,
      `rejected: ${String(hostile)}`
    );
  }
});

test('consumeRedirectResult is a no-op with no location', () => {
  assert.equal(consumeRedirectResult(), null);
});

test('listeners are notified and can be removed', async () => {
  let calls = 0;
  const off = onAuthChange(() => { calls += 1; });
  await loadSession(true);
  assert.equal(calls, 1);
  off();
  await loadSession(true);
  assert.equal(calls, 1, 'a removed listener stops hearing about changes');

  // A listener that throws must not stop the others from being told.
  let reached = false;
  const offBad = onAuthChange(() => { throw new Error('listener exploded'); });
  const offGood = onAuthChange(() => { reached = true; });
  await loadSession(true);
  assert.equal(reached, true);
  offBad();
  offGood();
});

test('onAuthChange ignores anything that is not a function', () => {
  const off = onAuthChange(null);
  assert.equal(typeof off, 'function');
  off();
});
