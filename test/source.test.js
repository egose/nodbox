const assert = require('node:assert/strict');
const test = require('node:test');
const { spawn, spawnSync } = require('node:child_process');
const { mkdtemp, writeFile, rm } = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');

const { parseArgs, runScript } = require('../entrypoint');
const { loadSource, MAX_SOURCE_BYTES, SourceError } = require('../source');

const projectRoot = path.resolve(__dirname, '..');
const entrypoint = path.join(projectRoot, 'entrypoint.js');

async function fixture(t, contents, name = 'source with spaces.js') {
  const directory = await mkdtemp(path.join(__dirname, '.nb02-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, name);
  await writeFile(filename, contents);
  return filename;
}

function runCli(argv, { input, nodeArgs = [], cwd = projectRoot } = {}) {
  const result = spawnSync(process.execPath, [...nodeArgs, entrypoint, ...argv], {
    cwd,
    input,
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return result;
}

function assertFailure(result, status, diagnostic) {
  assert.equal(result.status, status);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, diagnostic);
  if (status === 2) assert.match(result.stderr, /Usage:/);
  else assert.doesNotMatch(result.stderr, /Usage:/);
}

function unicodeSource(size) {
  const prefix = 'return "雪"; /*';
  const suffix = '*/';
  const padding = size - Buffer.byteLength(prefix + suffix);
  return prefix + '雪'.repeat(Math.floor(padding / 3)) + ' '.repeat(padding % 3) + suffix;
}

test('parser selects file/stdin and retains the existing parameter and escape grammar', () => {
  const tokens = Object.freeze(['--file', 'a file.js', '--', 'two words', '', '--help', '-']);
  const result = parseArgs(tokens);
  assert.deepEqual(result, { mode: 'file', path: 'a file.js', args: ['two words', '', '--help', '-'] });
  result.args.push('local');
  assert.equal(tokens.length, 7);
  assert.deepEqual(parseArgs(['-', '--', '--file', '--']), { mode: 'stdin', args: ['--file', '--'] });
  assert.deepEqual(parseArgs(['--file', './-source.js']), { mode: 'file', path: './-source.js', args: [] });
  for (const source of ['--file', '-']) {
    assert.deepEqual(parseArgs(['--', source]), { mode: 'inline', source, args: [] });
  }
});

for (const argv of [
  ['--file', ''],
  ['--file', '  '],
  ['--file', '--'],
  ['--file', '--help'],
  ['--file', '-'],
  ['--file', 'missing.js', 'extra'],
  ['--file', 'missing.js', '-'],
  ['--file', 'missing.js', '--file', 'other.js'],
  ['-', '--file', 'missing.js'],
  ['--file=missing.js'],
]) {
  test(`cli rejects malformed source invocation ${JSON.stringify(argv)} before reading`, () => {
    assertFailure(runCli(argv), 2, /Provide a path|Put -- before script parameters|Unknown option/);
  });
}

test('inline, relative file, and stdin execute equivalent async UTF-8 source and parameters', async (t) => {
  const source = 'await Promise.resolve(); console.log("雪"); return JSON.stringify(args)';
  const filename = await fixture(t, source);
  const parameters = ['two words', '', '--help', '--file', '-', '--', '雪'];
  const invocations = [[source], ['--file', path.relative(projectRoot, filename)], ['-']];
  for (const argv of invocations) {
    const result = runCli([...argv, '--', ...parameters], { input: source });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, `雪\n${JSON.stringify(parameters)}\n`);
    assert.equal(result.stderr, '');
  }
});

for (const source of ['', ' \t\r\n', '\ufeff \n']) {
  test(`all source modes reject blank input ${JSON.stringify(source)}`, async (t) => {
    const filename = await fixture(t, source);
    for (const argv of [[source], ['--file', filename], ['-']]) {
      assertFailure(runCli(argv, { input: source }), 2, /nonblank/);
    }
  });
}

test('missing file and unreadable directory report I/O failures with paths', async (t) => {
  const filename = await fixture(t, 'console.log("must not execute")');
  assertFailure(runCli(['--file', `${filename}.missing`]), 1, /Cannot read Source file.*\.missing.*ENOENT/);
  assertFailure(runCli(['--file', path.dirname(filename)]), 1, /Cannot read Source file.*EISDIR/);
});

test('stdin read failure reaches executable stderr with status 1', async (t) => {
  const preload = await fixture(
    t,
    `const { Readable } = require('node:stream');
Object.defineProperty(process, 'stdin', { value: new Readable({
  read() { this.destroy(new Error('injected stdin read failure')); }
}) });`,
    'stdin-error.cjs',
  );
  assertFailure(runCli(['-'], { nodeArgs: ['--require', preload] }), 1, /Cannot read Stdin source.*injected stdin/);
});

test('loader propagates streaming I/O errors and never returns partial source', async () => {
  const stream = Readable.from(
    (async function* () {
      yield Buffer.from('console.log("must not execute")');
      throw new Error('read interrupted');
    })(),
  );
  await assert.rejects(loadSource({ mode: 'stdin' }, { stdin: stream }), (error) => {
    assert.equal(error instanceof SourceError, false);
    assert.match(error.message, /Cannot read Stdin source.*read interrupted/);
    return true;
  });
  assert.equal(stream.destroyed, true);
});

test('loader decodes UTF-8 across byte chunks and supports a UTF-8 BOM', async () => {
  const source = '\ufeffreturn "雪🙂"';
  const bytes = Buffer.from(source);
  const stream = Readable.from([...bytes].map((byte) => Buffer.from([byte])));
  const loaded = await loadSource({ mode: 'stdin' }, { stdin: stream });
  assert.equal(await runScript(loaded.source), '雪🙂');
});

for (const bytes of [Buffer.from([0xff]), Buffer.from([0xe9, 0x9b])]) {
  test(`file and stdin reject invalid UTF-8 ${bytes.toString('hex')} before execution`, async (t) => {
    const source = Buffer.concat([Buffer.from('console.log("must not execute"); //'), bytes]);
    const filename = await fixture(t, source);
    for (const argv of [['--file', filename], ['-']]) {
      assertFailure(runCli(argv, { input: source }), 2, /must be valid UTF-8/);
    }
  });
}

test('inline loader accepts exactly 1 MiB of UTF-8 bytes and rejects one byte more', async () => {
  const source = unicodeSource(MAX_SOURCE_BYTES);
  assert.equal(Buffer.byteLength(source), 1048576);
  assert.ok(source.length < MAX_SOURCE_BYTES);
  const loaded = await loadSource({ mode: 'inline', source });
  assert.equal(loaded.source, source);
  assert.equal(await runScript(loaded.source), '雪');
  await assert.rejects(loadSource({ mode: 'inline', source: source + ' ' }), SourceError);
});

test('oversized inline input maps to usage status 2 through main without OS argument-size limits', () => {
  const result = spawnSync(
    process.execPath,
    [
      '-e',
      `require('./entrypoint').main(['node', 'entrypoint.js', 'console.log("must not execute");//' + '雪'.repeat(349526)])`,
    ],
    { cwd: projectRoot, encoding: 'utf8', timeout: 5000 },
  );
  assert.ifError(result.error);
  assertFailure(result, 2, /exceeds the 1 MiB \(1048576 UTF-8 bytes\)/);
});

for (const mode of ['file', 'stdin']) {
  test(`${mode} accepts exactly 1 MiB of Unicode source and rejects one byte more`, async (t) => {
    const source = unicodeSource(MAX_SOURCE_BYTES);
    const filename = await fixture(t, source);
    const argv = mode === 'file' ? ['--file', filename] : ['-'];
    const result = runCli(argv, { input: mode === 'stdin' ? source : undefined });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '雪\n');
    assert.equal(result.stderr, '');
    await writeFile(filename, source + ' ');
    assertFailure(runCli(argv, { input: mode === 'stdin' ? source + ' ' : undefined }), 2, /exceeds the 1 MiB/);
  });
}

test('oversized stream is destroyed without waiting for EOF or executing its valid prefix', async (t) => {
  const child = spawn(process.execPath, [entrypoint, '-'], { cwd: projectRoot });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
  t.after(() => {
    clearTimeout(timeout);
    child.stdin.destroy();
    child.kill();
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
  child.stdin.on('error', (error) => assert.equal(error.code, 'EPIPE'));
  const outcome = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (status, signal) => resolve({ status, signal }));
  });
  child.stdin.write('console.log("must not execute");//' + 'x'.repeat(MAX_SOURCE_BYTES));
  // Deliberately leave the producer open: rejection must not need EOF.
  const result = await outcome;
  assert.equal(result.signal, null);
  assertFailure({ ...result, stdout, stderr }, 2, /exceeds the 1 MiB/);
});

test('loader stops requesting chunks immediately after exceeding the byte bound', async () => {
  let reads = 0;
  let closed = false;
  const stream = Readable.from(
    (async function* () {
      try {
        for (let index = 0; index < 100; index++) {
          reads++;
          yield Buffer.alloc(64 * 1024, 32);
        }
      } finally {
        closed = true;
      }
    })(),
    { objectMode: false, highWaterMark: 1 },
  );
  await assert.rejects(loadSource({ mode: 'stdin' }, { stdin: stream }), SourceError);
  // A Node Readable may prefetch one chunk beyond the 17 consumed chunks.
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(reads <= 18, `unexpected read count: ${reads}`);
  assert.equal(stream.destroyed, true);
  assert.equal(closed, true);
});

for (const [label, source, diagnostic] of [
  ['syntax error', 'await Promise.resolve();\nconst value = ;', /SyntaxError/],
  ['runtime error', 'await Promise.resolve();\nthrow new Error("file failed")', /Error: file failed/],
]) {
  test(`file ${label} reports the absolute filename and original source line`, async (t) => {
    const filename = await fixture(t, source);
    const result = runCli(['--file', path.basename(filename)], { cwd: path.dirname(filename) });
    assertFailure(result, 1, diagnostic);
    assert.ok(result.stderr.includes(`${filename}:2`), result.stderr);
  });
}

test('file require resolves relative to the runner, with parameters and process.argv preserved', async (t) => {
  const source = `const runtime = require('./entrypoint');
await Promise.resolve();
return JSON.stringify({ hasRunner: typeof runtime.runScript === 'function', args, argv: process.argv.slice(2) });`;
  const filename = await fixture(t, source);
  const argv = ['--file', path.basename(filename), '--', 'two words', '--flag'];
  const result = runCli(argv, { cwd: path.dirname(filename) });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), { hasRunner: true, args: ['two words', '--flag'], argv });
});

test('inline and file modes leave stdin available to the executing script', async (t) => {
  const source = 'return require("node:fs").readFileSync(0, "utf8")';
  const filename = await fixture(t, source);
  for (const argv of [[source], ['--file', filename]]) {
    const result = runCli(argv, { input: 'runtime input 雪' });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, 'runtime input 雪\n');
    assert.equal(result.stderr, '');
  }
});

test('stdin source is fully consumed before execution', () => {
  const result = runCli(['-'], {
    input: 'return JSON.stringify({ ended: process.stdin.readableEnded, remaining: process.stdin.read() })',
  });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), { ended: true, remaining: null });
});
