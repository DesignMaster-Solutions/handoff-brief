import { test } from 'node:test';
import assert from 'node:assert/strict';

// The page resolver must build under ESM: @forge/resolver is CJS (exports.default).
test('index.js loads and exports the resolver and both Rovo actions', async () => {
  const mod = await import('../src/index.js');
  assert.equal(typeof mod.handler, 'function');
  assert.equal(typeof mod.prepareHandoff, 'function');
  assert.equal(typeof mod.publishHandoffPage, 'function');
});

test('an action without a person asks for one instead of throwing', async () => {
  const { prepareHandoff } = await import('../src/index.js');
  assert.match((await prepareHandoff({})).error, /who is leaving/);
});
