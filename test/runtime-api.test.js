const assert = require('node:assert/strict');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const { createRuntimeContext, runScript } = require('../entrypoint');

const projectRoot = path.resolve(__dirname, '..');

test('default context supplies runner require and a fresh empty args array', async () => {
  assert.equal(typeof createRuntimeContext().require, 'function');
  assert.deepEqual(createRuntimeContext().args, []);
  assert.equal(await runScript('return typeof require'), 'function');
  assert.equal(await runScript('return require("node:path").basename("a/b")'), 'b');
  assert.deepEqual(await runScript('return args'), []);
});

test('injected require and context bindings are honored without linking args', async () => {
  const parameters = Object.freeze(['one']);
  const context = { require: () => 'injected', marker: 7, args: parameters };
  assert.deepEqual(await runScript('return [require("anything"), marker, args.join(",")]', context), [
    'injected',
    7,
    'one',
  ]);
  assert.equal(parameters.length, 1);
  assert.deepEqual(await runScript('return [typeof require, marker, args]', { marker: 9 }), ['undefined', 9, []]);
});

test('sequential invocations do not share bindings or lexical state', async () => {
  assert.equal(await runScript('let marker = 1; return marker'), 1);
  assert.equal(await runScript('return typeof marker'), 'undefined');

  const context = createRuntimeContext(['original']);
  assert.deepEqual(await runScript('args.push("local"); return args', context), ['original', 'local']);
  assert.deepEqual(context.args, ['original']);
  assert.deepEqual(await runScript('return args', context), ['original']);
  assert.deepEqual(await runScript('return args'), []);
});

test('falsy and undefined results resolve through the reusable API', async () => {
  assert.equal(await runScript('return false'), false);
  assert.equal(await runScript('return 0'), 0);
  assert.equal(await runScript('return null'), null);
  assert.equal(await runScript('return ""'), '');
  assert.equal(await runScript('return undefined'), undefined);
});

test('syntax errors throw synchronously from runScript', () => {
  assert.throws(() => runScript('return ('), SyntaxError);
});

test('runtime throws and async rejections reject with the original error', async () => {
  await assert.rejects(runScript('throw Object.assign(new Error("failed"), { code: "E_CUSTOM" })'), (error) => {
    assert.equal(error.message, 'failed');
    assert.equal(error.code, 'E_CUSTOM');
    return true;
  });
  await assert.rejects(runScript('await Promise.reject(new Error("rejected"))'), /rejected/);
});

test('importing the runtime modules performs no execution or I/O', () => {
  const probe = spawnSync(
    process.execPath,
    [
      '-e',
      `const entrypoint = require('./entrypoint');
const source = require('./source');
if (typeof entrypoint.runScript !== 'function') throw new Error('missing runScript');
if (typeof source.loadSource !== 'function') throw new Error('missing loadSource');
console.log([typeof entrypoint.runScript, process.exitCode === undefined ? 'clean' : 'dirty'].join(':'));`,
    ],
    { cwd: projectRoot, encoding: 'utf8', timeout: 5000 },
  );
  assert.ifError(probe.error);
  assert.equal(probe.signal, null);
  assert.equal(probe.status, 0);
  assert.equal(probe.stdout, 'function:clean\n');
  assert.equal(probe.stderr, '');
});
