const { compileFunction } = require('node:vm');
const { loadSource, SourceError } = require('./source');
const AsyncFunction = Object.getPrototypeOf(async () => null).constructor;

function callAsyncFunction(args, source, filename) {
  const keys = Object.keys(args);
  // The named wrapper preserves top-level await/return and reports original file lines.
  const fn = filename
    ? compileFunction(`return async function(${keys.join(',')}) {\n${source}\n};`, [], { filename, lineOffset: -1 })()
    : new AsyncFunction(...keys, source);
  return fn(...Object.values(args));
}

function createRuntimeContext(args = []) {
  return { require, args: [...args] };
}

function runScript(source, context = createRuntimeContext(), { filename } = {}) {
  return callAsyncFunction({ ...context, args: [...(context.args ?? [])] }, source, filename);
}

const usage = `Usage:
  nodbox [--] <source> [-- <arg>...]
  nodbox --file <path> [-- <arg>...]
  nodbox - [-- <arg>...]
  nodbox --help | -h

Pass JavaScript source as one argument. Use a leading -- for source beginning
with a dash, and a -- after source to pass parameters through the args array.
Use --file for a UTF-8 file or - to read UTF-8 source from stdin until EOF.
There is no implicit stdin read. Sources must be nonblank and at most 1 MiB
(1048576 UTF-8 bytes). Use ./ for file paths beginning with a dash.

Exit status: 0 success/help, 1 script/read failure, 2 invalid invocation/source.`;

class UsageError extends Error {}

function parseArgs(argv) {
  if (argv[0] === '--help' || argv[0] === '-h') {
    if (argv.length !== 1) {
      throw new UsageError('Help must be used alone.');
    }
    return { mode: 'help' };
  }

  const escaped = argv[0] === '--';
  const sourceIndex = escaped ? 1 : 0;
  const source = argv[sourceIndex];

  if (source === undefined || source.trim() === '') {
    throw new UsageError('Provide nonblank JavaScript source as one argument.');
  }
  let invocation = { mode: 'inline', source };
  let consumed = sourceIndex + 1;
  if (!escaped && source === '--file') {
    const filename = argv[1];
    if (filename === undefined || filename.trim() === '' || filename.startsWith('-')) {
      throw new UsageError('Provide a path after --file. Use ./ for file paths beginning with a dash.');
    }
    invocation = { mode: 'file', path: filename };
    consumed = 2;
  } else if (!escaped && source === '-') {
    invocation = { mode: 'stdin' };
  } else if (!escaped && source.startsWith('-')) {
    throw new UsageError(`Unknown option ${JSON.stringify(source)}. Use -- before flag-like inline source.`);
  }

  const remaining = argv.slice(consumed);
  if (remaining.length > 0 && remaining[0] !== '--') {
    throw new UsageError('Unexpected argument after source. Put -- before script parameters.');
  }
  return { ...invocation, args: remaining.slice(1) };
}

async function main(argv = process.argv) {
  let invocation;
  let loaded;
  try {
    invocation = parseArgs(argv.slice(2));
    if (invocation.mode === 'help') {
      console.log(usage);
      return;
    }
    loaded = await loadSource(invocation);
  } catch (error) {
    if (!(error instanceof UsageError) && !(error instanceof SourceError)) throw error;
    console.error(`${error.message}\n\n${usage}`);
    process.exitCode = 2;
    return;
  }

  const result = await runScript(loaded.source, createRuntimeContext(invocation.args), { filename: loaded.filename });

  if (result !== undefined) {
    console.log(result);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  createRuntimeContext,
  main,
  parseArgs,
  runScript,
};
