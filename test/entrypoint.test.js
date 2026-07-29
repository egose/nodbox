const assert = require('node:assert/strict');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const { runScript } = require('../entrypoint');

const projectRoot = path.resolve(__dirname, '..');

test('runScript supports async source', async () => {
  const result = await runScript('await Promise.resolve(); return 42;', { require });

  assert.equal(result, 42);
});

test('cli prints returned values', () => {
  const result = spawnSync(process.execPath, ['entrypoint.js', 'return "ok"'], {
    cwd: projectRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), 'ok');
  assert.equal(result.stderr, '');
});

test('cli preserves script console output without adding undefined', () => {
  const result = spawnSync(process.execPath, ['entrypoint.js', 'console.log("hello world")'], {
    cwd: projectRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), 'hello world');
  assert.equal(result.stderr, '');
});

test('cli exits non-zero when the script throws', () => {
  const result = spawnSync(process.execPath, ['entrypoint.js', 'throw new Error("boom")'], {
    cwd: projectRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Error: boom/);
});
