const assert = require('node:assert/strict');
const test = require('node:test');
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');

const { createRuntimeContext, parseArgs, runScript } = require('../entrypoint');

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

function runCli(argv) {
  const result = spawnSync(process.execPath, ['entrypoint.js', ...argv], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return result;
}

test('parser returns explicit modes and preserves parameters without mutating input', () => {
  assert.deepEqual(parseArgs(['--help']), { mode: 'help' });
  assert.deepEqual(parseArgs(['-h']), { mode: 'help' });
  assert.deepEqual(parseArgs(['return 1']), { mode: 'inline', source: 'return 1', args: [] });
  assert.deepEqual(parseArgs(['return 1', '--']), { mode: 'inline', source: 'return 1', args: [] });

  const tokens = Object.freeze(['--', '-1; return args', '--', 'two words', '', '--help', '--']);
  const parsed = parseArgs(tokens);
  assert.deepEqual(parsed, {
    mode: 'inline',
    source: '-1; return args',
    args: ['two words', '', '--help', '--'],
  });
  parsed.args.push('local mutation');
  assert.equal(tokens.length, 7);
  assert.throws(() => parseArgs(['return 1', 'extra']), /Put -- before script parameters/);
});

const invalidInvocations = [
  ['missing source', [], /Provide nonblank/],
  ['empty source', [''], /Provide nonblank/],
  ['whitespace source', [' \t\n'], /Provide nonblank/],
  ['escape without source', ['--'], /Provide nonblank/],
  ['escaped blank source', ['--', '  '], /Provide nonblank/],
  ['unknown long option', ['--unknown'], /Unknown option.*Use --/],
  ['unknown short option', ['-x'], /Unknown option.*Use --/],
  ['file input without path', ['--file'], /Provide a path/],
  ['stdin input with extra value', ['-', 'extra'], /Put -- before script parameters/],
  ['extra positional value', ['console.log("executed")', 'extra'], /Put -- before script parameters/],
  ['option after source', ['console.log("executed")', '--unknown'], /Put -- before script parameters/],
  ['help after source', ['console.log("executed")', '--help'], /Put -- before script parameters/],
  ['source after help', ['--help', 'console.log("executed")'], /Help must be used alone/],
  ['parameters after short help', ['-h', '--', 'value'], /Help must be used alone/],
  ['extra escaped value', ['--', 'console.log("executed")', 'extra'], /Put -- before script parameters/],
];

for (const [label, argv, diagnostic] of invalidInvocations) {
  test(`cli rejects ${label} without executing source`, () => {
    const result = runCli(argv);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, diagnostic);
    assert.match(result.stderr, /Usage:/);
  });
}

for (const option of ['--help', '-h']) {
  test(`cli ${option} prints help successfully`, () => {
    const result = runCli([option]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Usage:/);
    assert.match(result.stdout, /-- <arg>/);
    assert.equal(result.stderr, '');
  });
}

for (const [label, argv, status] of [
  ['help', ['--help'], 0],
  ['short help', ['-h'], 0],
  ['missing source', [], 2],
]) {
  test(`cli ${label} exits while stdin remains open`, async () => {
    const child = spawn(process.execPath, ['entrypoint.js', ...argv], {
      cwd: projectRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdout.resume();
    child.stderr.resume();
    const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
    try {
      const outcome = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code, signal) => resolve({ code, signal }));
      });
      assert.deepEqual(outcome, { code: status, signal: null });
    } finally {
      clearTimeout(timeout);
      child.stdin.destroy();
      child.kill();
    }
  });
}

for (const [source, output] of [
  ['await Promise.resolve(); return 42', '42\n'],
  ['return false', 'false\n'],
  ['return 0', '0\n'],
  ['return null', 'null\n'],
  ['return undefined', ''],
  ['return JSON.stringify(args)', '[]\n'],
]) {
  test(`cli preserves result semantics for ${source}`, () => {
    const result = runCli([source]);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, output);
    assert.equal(result.stderr, '');
  });
}

for (const [label, source, diagnostic] of [
  ['syntax error', 'return (', /SyntaxError/],
  ['async rejection', 'await Promise.reject(new Error("rejected"))', /Error: rejected/],
  ['script-specified error status', 'throw Object.assign(new Error("failed"), { exitCode: 2 })', /Error: failed/],
]) {
  test(`cli reports ${label} as script failure`, () => {
    const result = runCli([source]);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, diagnostic);
    assert.doesNotMatch(result.stderr, /Usage:/);
  });
}

test('cli parameters preserve spaces, empty strings, and flag-like values', () => {
  const parameters = ['two words', '', '--help', '-h', '--file', '-', '--', '雪'];
  const result = runCli(['return JSON.stringify(args)', '--', ...parameters]);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), parameters);
});

test('cli leading escape permits flag-like source with parameters', () => {
  const result = runCli(['--', '-1; return args[0]', '--', 'escaped']);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'escaped\n');
  assert.equal(result.stderr, '');
});

test('cli escaped help token is source rather than a help request', () => {
  const result = runCli(['--', '--help']);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /ReferenceError/);
});

test('cli leaves process.argv intact even when a script mutates args', () => {
  const source = 'args.push("local"); return JSON.stringify({ argv: process.argv.slice(2), args })';
  const tokens = [source, '--', 'two words', '--flag'];
  const result = runCli(tokens);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), { argv: tokens, args: ['two words', '--flag', 'local'] });
});

test('runtime contexts and script invocations own fresh parameter arrays', async () => {
  const parameters = ['original'];
  const context = createRuntimeContext(parameters);
  const otherContext = createRuntimeContext(parameters);
  assert.notEqual(context.args, parameters);
  assert.notEqual(context.args, otherContext.args);
  const originalArgv = [...process.argv];
  const result = await runScript('args.push("local"); await Promise.resolve(); return args', context);
  assert.deepEqual(result, ['original', 'local']);
  assert.deepEqual(context.args, ['original']);
  assert.deepEqual(otherContext.args, ['original']);
  assert.deepEqual(parameters, ['original']);
  assert.deepEqual(await runScript('return args', context), ['original']);
  assert.deepEqual(await runScript('args.push("default"); return args'), ['default']);
  assert.deepEqual(await runScript('return args'), []);
  assert.deepEqual(process.argv, originalArgv);
});

test('runScript preserves explicit context bindings and copies explicit args', async () => {
  const context = Object.freeze({ require: () => 'injected', value: 7, args: Object.freeze(['parameter']) });
  assert.deepEqual(await runScript('return [require("custom"), value, args.pop()]', context), [
    'injected',
    7,
    'parameter',
  ]);
  assert.deepEqual(context.args, ['parameter']);
  assert.deepEqual(await runScript('return [value, args]', { value: 9 }), [9, []]);
});
