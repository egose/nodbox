// inspired by [actions/github-script](https://github.com/actions/github-script).
const AsyncFunction = Object.getPrototypeOf(async () => null).constructor;

function callAsyncFunction(args, source) {
  const fn = new AsyncFunction(...Object.keys(args), source);
  return fn(...Object.values(args));
}

function createRuntimeContext() {
  return { require };
}

function runScript(source, args = createRuntimeContext()) {
  return callAsyncFunction(args, source);
}

async function main(argv = process.argv) {
  const script = argv.length > 2 ? argv[2] : '';
  const result = await runScript(script, createRuntimeContext());

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
  runScript,
};
