const { spawnSync } = require('node:child_process');
const { mkdirSync, rmSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const IMAGE = 'nodbox-container-test:local';
const FIXTURE_DIR = path.join(projectRoot, '.nodbox-container-fixtures');
const FIXTURE_NAME = 'job.js';
const FIXTURE_HOST_PATH = path.join(FIXTURE_DIR, FIXTURE_NAME);
const FIXTURE_CONTAINER_PATH = '/scripts/job.js';

let failures = 0;

function log(message) {
  process.stdout.write(`${message}\n`);
}

function check(label, result, expected) {
  const statusOk = result.status === expected.status;
  const stdoutOk = expected.stdout === undefined || result.stdout === expected.stdout;
  const stdoutMatchOk = expected.stdoutMatch === undefined || expected.stdoutMatch.test(result.stdout);
  const stderrMatchOk = expected.stderrMatch === undefined || expected.stderrMatch.test(result.stderr);
  const stderrAbsentOk = expected.stderrAbsent !== true || result.stderr === '';
  const ok = statusOk && stdoutOk && stdoutMatchOk && stderrMatchOk && stderrAbsentOk;
  if (ok) {
    log(`ok - ${label}`);
  } else {
    failures += 1;
    log(`not ok - ${label}`);
    log(`  expected status=${expected.status} stdout=${JSON.stringify(expected.stdout ?? expected.stdoutMatch)}`);
    log(`  actual status=${result.status} signal=${result.signal} error=${result.error?.message ?? ''}`);
    log(`  stdout=${JSON.stringify(result.stdout)}`);
    log(`  stderr=${JSON.stringify(result.stderr)}`);
  }
  return ok;
}

function runDocker(args, options = {}) {
  const result = spawnSync('docker', args, {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 120000,
    ...options,
  });
  if (result.error) {
    failures += 1;
    log(`not ok - docker ${args.slice(0, 3).join(' ')} failed to spawn: ${result.error.message}`);
  }
  return result;
}

function main() {
  rmSync(FIXTURE_DIR, { recursive: true, force: true });
  mkdirSync(FIXTURE_DIR, { recursive: true });
  try {
    log(`building local image ${IMAGE} (no push)`);
    const build = runDocker(['build', '-t', IMAGE, '.']);
    if (build.error || build.status !== 0) {
      log(`not ok - docker build failed status=${build.status}`);
      log(build.stdout ?? '');
      log(build.stderr ?? '');
      process.exitCode = 1;
      return;
    }
    log('ok - docker build');

    check('inline source', runDocker(['run', '--rm', IMAGE, 'return 42;']), {
      status: 0,
      stdout: '42\n',
      stderrAbsent: true,
    });

    writeFileSync(FIXTURE_HOST_PATH, 'await Promise.resolve(); return JSON.stringify(args);', 'utf8');
    check(
      'file source via bind mount',
      runDocker(
        [
          'run',
          '--rm',
          '--mount',
          `type=bind,src=${FIXTURE_HOST_PATH},dst=${FIXTURE_CONTAINER_PATH},readonly`,
          IMAGE,
          '--file',
          FIXTURE_CONTAINER_PATH,
          '--',
          'hello world',
        ],
        {},
      ),
      { status: 0, stdout: '["hello world"]\n', stderrAbsent: true },
    );

    check(
      'stdin source',
      runDocker(['run', '--rm', '-i', IMAGE, '-', '--', 'hello world'], {
        input: 'return JSON.stringify(args);',
      }),
      { status: 0, stdout: '["hello world"]\n', stderrAbsent: true },
    );

    check('help exits 0', runDocker(['run', '--rm', IMAGE, '--help']), {
      status: 0,
      stdoutMatch: /Usage:/,
    });

    check('missing source is usage failure', runDocker(['run', '--rm', IMAGE]), {
      status: 2,
      stdout: '',
      stderrMatch: /Usage:/,
    });

    check('script failure exits 1 without usage', runDocker(['run', '--rm', IMAGE, 'throw new Error("boom")']), {
      status: 1,
      stdout: '',
      stderrMatch: /Error: boom/,
    });

    check(
      'script parameters preserve spaces and flags',
      runDocker(['run', '--rm', IMAGE, 'return JSON.stringify(args)', '--', 'hello world', '--verbose']),
      { status: 0, stdout: '["hello world","--verbose"]\n', stderrAbsent: true },
    );

    check(
      'image default user is non-root',
      runDocker(['run', '--rm', IMAGE, 'return process.getuid() + ":" + process.getgid()']),
      { status: 0, stdout: '1000:1000\n', stderrAbsent: true },
    );

    const hardenedArgs = [
      'run',
      '--rm',
      '--read-only',
      '--user',
      '1000:1000',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges:true',
    ];
    check(
      'hardened read-only execution succeeds',
      runDocker([...hardenedArgs, IMAGE, 'await Promise.resolve(); return "hardened-ok"']),
      { status: 0, stdout: 'hardened-ok\n', stderrAbsent: true },
    );

    const readonlyProbe = runDocker([...hardenedArgs, IMAGE, 'require("node:fs").writeFileSync("/app/probe", "x")']);
    const readonlyOk = readonlyProbe.status === 1 && /EROFS|read-only|Read-only/i.test(readonlyProbe.stderr);
    if (readonlyOk) {
      log('ok - read-only root filesystem denies writes');
    } else {
      failures += 1;
      log('not ok - read-only root filesystem denies writes');
      log(`  status=${readonlyProbe.status} stderr=${JSON.stringify(readonlyProbe.stderr)}`);
    }
  } finally {
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
  }

  if (failures > 0) {
    log(`${failures} container check(s) failed`);
    process.exitCode = 1;
  } else {
    log('all container smoke checks passed');
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
    console.error(error);
    process.exitCode = 1;
  }
}
