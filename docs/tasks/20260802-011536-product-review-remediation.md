# Nodbox product review and remediation

Created: 2026-09-27 01:15:36 (local timestamp)

## Objective and product context

Nodbox runs trusted asynchronous JavaScript in a small Node container without building a dedicated application image. Its primary business workflows are one-off automation and Kubernetes Jobs. Success means predictable job outcomes, practical source delivery, useful diagnostics, secure deployment defaults, and a small reusable runtime.

Implement the evidence-backed tasks below, using a **fresh sub-agent for each task, strictly sequentially**, then independently review their integration.

Scope: CLI/runtime, tests, image build context and smoke checks, CI verification, user documentation, and Kubernetes example. Non-goals: running untrusted code, a hosted scheduler, dependency installation, a general CLI framework, or new runtime dependencies.

## Analysis coverage and baseline

- Inspected `README.md`, all of `entrypoint.js`, `test/entrypoint.test.js`, `Dockerfile`, `.dockerignore`, `job.yaml`, `Makefile`, package metadata, ESLint configuration, and test/release/pre-commit workflows.
- No repository `AGENTS.md` found; initial worktree was clean. No existing `docs` directory or task backlog was present.
- Actual baseline checks from repository root: `npm test` passed 4/4; `npm exec --no -- eslint .` passed; `docker version` confirmed a working Docker daemon.
- Actual CLI probes: `node entrypoint.js` exits successfully without running useful code; `node entrypoint.js --help` produces `ReferenceError: help is not defined`.
- Baseline container build, cluster execution, dependency audit, and performance benchmark were not run. External action implementation, website, registry artifacts, and cluster policy were not inspected. This is a focused review of this small repository, not a complete supply-chain audit.

## Priorities, contracts, and execution rules

- P1: defects or missing verification that can silently invalidate automation outcomes.
- P2: practical usability, maintainability, deployment, or efficiency improvements.
- Execute NB-01 through NB-06 in order. Shared hotspots are `entrypoint.js`, `README.md`, and tests; never run agents or Docker/test mutations concurrently.
- Coordinator owns this document. Set each task `in_progress` before delegation and append **Completion evidence** only after its criteria and required checks pass. Agents report exact changes, commands, results, and remaining gaps. Failed required checks mean `blocked`, with the prerequisite documented.
- Preserve inline trusted-code execution, top-level `await`/`return`, injected `require`, output suppression for `undefined`, and nonzero exit on script failure.
- Deliberate contract changes must appear in an Unreleased section of `CHANGELOG.md`: missing/empty source becomes a usage failure; malformed or ambiguous CLI invocation becomes a usage failure; new flags must have an explicit `--` escape for inline source beginning with a flag.
- Treat `process.argv` as Node's existing process arguments; expose script-specific parameters through an injected `args` array rather than rewriting global state.

## Shared verification and definition of done

Node >=22 and installed dev dependencies are available. Docker is available at baseline. Use repository-local fixtures and remove only temporary artifacts created by your task.

- Targeted runtime checks: `node --test test/entrypoint.test.js` (or a focused new test file); full suite: `npm test`.
- Static baseline: `npm exec --no -- eslint .`; NB-04 introduces `npm run lint`.
- Use existing Prettier settings on changed supported files. Do not broadly reformat unrelated files.
- NB-05 adds a documented `npm run test:container` command that builds the actual image and runs smoke checks; no registry push.
- Final checks: `npm test`, `npm run lint`, `npm run test:container`, formatting checks for changed supported files, `git diff --check`, and acceptance-criteria review.
- Kubernetes deployment is verified structurally and by equivalent local hardened-container checks; an actual cluster is not required. Clearly report that limitation.
- Done means all tasks completed with evidence, public documentation agrees with behavior, artifact checks pass, and the coordinator has reviewed the final record. Do not report deferred ideas as delivered features.

## Tasks

### Task NB-01: Make CLI invocation explicit and pass script parameters

Status: completed

Kind: defect + improvement

Priority: P1 — missing source currently reports a successful job and common help usage executes unintended source.

Suggested agent: CLI contract implementer

Dependencies: none

Primary ownership: `entrypoint.js`, focused CLI tests, `README.md`, `CHANGELOG.md`.

Finding: `main` reads only `argv[2]`, uses an empty string when absent, and ignores remaining tokens. There is no help or argument-validation boundary. Four existing tests cover happy-path inline execution and one thrown error, not invocation failures or script parameters.

References: `entrypoint.js:17-23` (`main`); `test/entrypoint.test.js`; `README.md:23-43`.

Requirements:

1. Add a small testable parser with `--help`/`-h`, an explicit inline source mode (existing positional source), and `--` escaping. Help must not execute code or wait on input.
2. Reject missing/empty/whitespace-only source and unknown options with actionable usage diagnostics on stderr and exit 2; script failures remain exit 1. Reserve `--file` and stdin `-` for NB-02.
3. Accept script parameters after a separating `--`; reject unexplained extra positional values rather than silently ignoring them. Inject a fresh `args` string array without changing `process.argv` or breaking existing `runScript(source, context)` calls.
4. Keep parsing and execution responsibilities separate without introducing dependencies. Document grammar, output semantics, status codes, parameter examples, and compatibility changes.

Acceptance criteria:

- Inline async scripts and false/zero/null results remain correct; undefined adds no output.
- Help exits 0; missing/blank source and malformed options exit 2 without executing source; script syntax errors and async rejection exit 1.
- Parameters preserve spaces and flag-like values, and `--` allows flag-like inline source. Regression tests exercise process-level exit/output behavior and context isolation.

Verification: targeted runtime tests, `npm test`, ESLint, and changed-file formatting.

Completion evidence:

- Changed: `entrypoint.js`, `test/entrypoint.test.js`, `README.md`, new `CHANGELOG.md`.
- Delivered: testable `parseArgs`, help, usage exit 2, script exit 1, explicit argument separator/escape, fresh injected `args`, unchanged process arguments, documented contracts and compatibility notes.
- Verified by isolated agent `ses_f1e0f8f60ffe9t6iBMoolK1G7H`: `node --test test/entrypoint.test.js` and `npm test` each passed 40/40; `npm exec --no -- eslint .`, changed-file Prettier check, and `git diff --check` passed.
- npm checks used repository-local config/cache/TMPDIR overrides; task-owned caches removed. File/stdin delivery proceeds in NB-02.

### Task NB-02: Support mounted-file and stdin source delivery with bounded reads

Status: completed

Kind: improvement

Priority: P2 — inline-only source is awkward for multiline jobs, ConfigMaps, and shell quoting; unbounded source loading would introduce avoidable memory growth.

Suggested agent: source-input implementer

Dependencies: NB-01

Primary ownership: CLI/source-loader code, focused source tests, `Dockerfile` only if new runtime modules need copying, `README.md`, `CHANGELOG.md`.

Finding: `main` accepts source only through `argv[2]`. The only documented source transport is a YAML argument block. No source-loader abstraction or I/O failure tests exist.

References: `entrypoint.js:17-19`; `Dockerfile:7`; `README.md:3-4,23-43`.

Requirements:

1. Add `--file <path>` and explicit `-` for UTF-8 stdin, retaining NB-01 parameter grammar. Do not read stdin implicitly when source is absent.
2. Bound source size to a documented 1 MiB of UTF-8 bytes across inline/file/stdin paths; reject oversized input before execution and stop streaming once the bound is exceeded. Reject blank input consistently.
3. Keep source loading reusable/testable; report missing/unreadable files and stdin read errors with useful diagnostics and no execution. Define I/O failure exit status separately from malformed invocation (exit 1 versus 2).
4. File mode supplies a meaningful source filename for stack traces. Explicitly document whether injected `require` resolves from the runner or source file and preserve the existing runner-relative behavior unless evidence warrants a change.
5. Document local, `docker run -i`, and mounted-file/ConfigMap workflows, and distinguish source stdin from runtime stdin. Add no runtime dependencies or automatic package installation.

Acceptance criteria:

- Inline, file, and piped stdin execute equivalent async code and parameters; errors reach stderr with nonzero status.
- Tests cover missing file, invalid invocation, empty inputs, Unicode byte-size boundary, oversized streaming input, and filename-bearing syntax/runtime diagnostics.
- Docker includes all required runtime modules; help and missing-source failures never wait for stdin.

Verification: focused source tests and full runtime suite, ESLint, changed-file formatting; artifact integration is verified in NB-05/NB-06.

Completion evidence:

- Changed: `entrypoint.js`, `source.js` (new), `test/source.test.js` (new), `test/entrypoint.test.js`, `Dockerfile`, `README.md`, `CHANGELOG.md`; removed task-owned `.nb02-check/`.
- Delivered: `--file`/`-` modes, 1 MiB UTF-8 bound across all modes with early stream destroy, exit 2 usage/content vs exit 1 read/script, filename-bearing diagnostics, runner-relative `require`, no implicit stdin read.
- Verified by isolated agent `ses_f1e07de55ffe3ECjEWTRCBEqRS`: `npm test` 72/72 pass; `npm exec --no -- eslint .` pass; Prettier check pass after one line-wrap fix; `git diff --check` pass; help/missing-source probes exit without waiting on open stdin.
- Limitation: container build/run agreement deferred to NB-05/NB-06.

### Task NB-03: Turn deployment guidance into a bounded, hardened Job example

Status: completed

Kind: improvement

Priority: P2 — users are likely to copy the sample Job, which omits the restrictions recommended by the same README and has no deadline or resource budget.

Suggested agent: deployment/documentation implementer

Dependencies: NB-02

Primary ownership: `job.yaml`, Kubernetes examples and operational guidance in `README.md`.

Finding: README recommends non-root, read-only filesystem and dropped capabilities but neither its YAML nor `job.yaml` configures them. `job.yaml` also has no resource requests/limits, job deadline, cleanup policy, or disabled service-account token mount. Arbitrary trusted scripts can hang or leave costly resources running.

References: `README.md:14-21,25-43`; `job.yaml:5-19`; `Dockerfile:9` (`USER node`).

Requirements:

1. Align both examples with numeric non-root UID/GID compatible with the image, `allowPrivilegeEscalation: false`, read-only root, dropped capabilities, RuntimeDefault seccomp, and disabled service-account token automount.
2. Provide clearly illustrative resource requests/limits, `activeDeadlineSeconds`, and `ttlSecondsAfterFinished`; retain understandable retry behavior and explain idempotency for retried side effects.
3. Explain logs, exit-status troubleshooting, credentials through explicit environment/Secret wiring, trusted-code scope, networking as a deployment policy, and an optional writable mount when a script requires it.
4. Explain that deadline enforcement belongs to the orchestrator and that asynchronous execution alone does not bound CPU loops. Keep docs/examples consistent and avoid implying sandboxing or exactly-once execution.

Acceptance criteria:

- YAML parses and the Job settings match the guidance; README and checked-in manifest do not contradict each other.
- Equivalent Docker restrictions successfully execute the sample async code and demonstrate the configured non-root identity and read-only root filesystem.
- All resource/deadline values are described as example sizing, with cluster validation explicitly distinguished from local checks.

Verification: local YAML parsing if available (otherwise a repository-local validation method), `docker build` and hardened `docker run` probes, changed-file formatting. No cluster required.

Completion evidence:

- Changed: `job.yaml`, `README.md` Kubernetes guidance.
- Delivered: numeric 1000:1000 non-root, `allowPrivilegeEscalation:false`, read-only root, drop ALL, RuntimeDefault seccomp, `automountServiceAccountToken:false`, illustrative resources/deadlines/TTL, idempotency and troubleshooting docs.
- Verified by isolated agent `ses_f1e0521fbffeq7cBjqJGWQweom`: YAML parsed and README/Job fields match; `docker build` success; hardened `docker run` sample exits 0, UID/GID 1000:1000, read-only EROFS probe fails as expected; Prettier and `git diff --check` pass; image removed.
- Limitation: no cluster; quotas/PodSecurity/NetworkPolicy require cluster validation.

### Task NB-04: Restore useful static checks and runtime API regression coverage

Status: completed

Kind: improvement

Priority: P2 — `no-undef` is disabled globally, hiding accidental undefined references, and the reusable API has almost no contract coverage.

Suggested agent: maintainability/testability implementer

Dependencies: NB-03

Primary ownership: `eslint.config.mjs`, `package.json`, reusable-runtime tests, small runtime corrections only where exposed by tests.

Finding: ESLint recommended checks are weakened by a global `no-undef: off`; `runScript` has one async success test with an explicitly supplied context. Default `require`, import side effects, falsy results, and synchronous versus async failure contracts are not well specified/tested.

References: `eslint.config.mjs:13-16`; `package.json:6-10`; `entrypoint.js:4-15,26-37`; `test/entrypoint.test.js:10-14`.

Requirements:

1. Enable undefined-variable detection with appropriate Node/CommonJS globals for runtime and tests and ESM globals for config files; avoid broad suppression and new runtime dependencies.
2. Add a non-mutating `npm run lint` command. Demonstrate that a deliberate undefined identifier is rejected using lint stdin or another no-persistent-artifact probe.
3. Add meaningful reusable-API tests for default/injected require/context, independence across invocations, import-without-execution, and error propagation. Reuse NB-01/NB-02 coverage rather than duplicate it.
4. Keep helper boundaries small and document exported APIs if their contracts have expanded. Do not introduce abstractions without a demonstrated caller or testability benefit.

Acceptance criteria:

- Full lint passes and an undefined-variable probe fails for the intended reason.
- API behavior is exercised independently of the CLI; existing CLI/source contracts remain covered and passing.
- No new runtime dependency or import-time execution/I/O is introduced.

Verification: `npm test`, `npm run lint`, deliberate negative lint probe, changed-file formatting.

Completion evidence:

- Changed: `eslint.config.mjs`, `package.json` (`lint` script), new `test/runtime-api.test.js`.
- Delivered: per-pattern globals with `no-undef` enabled, non-mutating lint, 7 API contract tests, no new runtime deps or import-time I/O.
- Verified by isolated agent `ses_f1e0221e6ffeWo06SEpzo13N0s`: `npm test` 79/79 pass; `npm run lint` pass; stdin negative probe fails on `no-undef`; Prettier and `git diff --check` pass.
- Note: explicit context without `require` intentionally has no `require`; omitted context supplies runner `require`.

### Task NB-05: Verify the shipped container in CI and minimize its build context

Status: completed

Kind: improvement

Priority: P1 — the shipped product is a Docker image, but current CI tests only host Node execution and does not run for pull requests.

Suggested agent: artifact/CI implementer

Dependencies: NB-04

Primary ownership: `.dockerignore`, `Dockerfile` as needed, `.github/workflows/test.yml`, repository-local container smoke harness, `package.json`, development docs.

Finding: `.dockerignore` excludes only `node_modules/`, allowing repository history and unrelated tooling into build context. Test workflow triggers only on push, names its test step “Install release tools,” and never builds/runs the actual image. Runtime modules introduced by earlier tasks need artifact verification.

References: `.dockerignore:1`; `Dockerfile`; `.github/workflows/test.yml:3,10,22-23`; `.github/workflows/release.yaml:30-36`.

Requirements:

1. Minimize build context using a maintainable runtime-file allowlist (plus build files as needed). Measure included file count/byte size before and after with repository-local tooling or Docker context evidence; claim no unmeasured startup speedup.
2. Add a reproducible `npm run test:container` smoke harness that builds a local image and tests inline, file, stdin, help/usage failure, script failure, arguments, and hardened non-root/read-only execution. No image push; clean up task-owned containers/fixtures in failure paths.
3. Keep container checks explicit so ordinary `npm test` does not require Docker. Use unique names or robust cleanup to support repeatability.
4. Run host tests, non-mutating lint, and actual container smoke tests on push and pull_request with read-only repository permissions. Correct misleading job/step names. Preserve the existing pinned action style and avoid unrelated release changes.
5. Document prerequisites and commands. If Node test discovery would find the smoke harness, place/name it so host tests remain Docker-independent.

Acceptance criteria:

- Host and shipped-container behavior agree for all source modes and exit statuses.
- Recorded context measurement shows unrelated files excluded; no runtime module needed by the image is omitted.
- Workflow configuration contains pull-request coverage and the same successfully executed local verification commands.
- Harness failures return nonzero and task-owned temporary artifacts do not remain.

Verification: `npm test`, `npm run lint`, `npm run test:container`, context-size evidence, workflow/YAML review and formatting.

Completion evidence:

- Changed: `.dockerignore` allowlist, new `scripts/container-smoke.js`, `package.json` (`test:container`), `.github/workflows/test.yml`, `README.md` dev docs.
- Delivered: 35→4 files / ~199k→6.5k B context, local image contains only `entrypoint.js`+`source.js`, explicit Docker-independent `npm test`, PR+push CI with read-only permissions and container smoke.
- Verified by isolated agent `ses_f1dfc6ecaffekK63veAQTZx5RI`: `npm test` 79/79; `npm run lint` pass; `npm run test:container` pass; Prettier and `git diff --check` pass; fixtures cleaned, no push.
- Limitation: docker context byte message not meaningful; cluster validation still outstanding.

### Task NB-06: Independently review integrated behavior and completion evidence

Status: completed

Kind: investigation

Priority: P1 — ensure sequential changes fulfill the whole plan and preserve the small product's contracts.

Suggested agent: fresh independent integration reviewer (not any implementation session)

Dependencies: NB-01, NB-02, NB-03, NB-04, NB-05

Primary ownership: integrated diff review, verification results; report corrections to coordinator before any material expansion.

Finding: CLI, source loader, image packaging, examples, and CI share contracts that individual task tests may not fully cover.

References: this task file, all implementation diffs, final runtime/docs/tests/workflow files.

Requirements:

1. Review every acceptance criterion against code, tests, and recorded evidence. Check negative/alternate input paths, input bounds, API encapsulation, diagnostics, docs, container contents, and cleanup behavior.
2. Run all shared final verification commands and inspect final worktree/diff. Use adversarial but bounded probes where coverage is missing. Do not launch sub-agents.
3. Report any concrete defect and resolve minor in-scope integration errors with regression coverage. Larger findings must be returned for an explicit follow-up task, not buried in completion evidence.
4. Confirm all previous tasks have valid completion evidence, record limitations honestly, and give the coordinator a final pass/fail recommendation.

Acceptance criteria:

- All required final checks pass and each earlier criterion is accounted for.
- No known unresolved defect prevents the agreed workflows; any deferred idea has rationale and residual risk.
- Coordinator can mark the complete task file done from concrete evidence rather than agent assertions alone.

Verification: shared final checks and independent criterion-by-criterion review.

Completion evidence:

- Reviewed by isolated agent `ses_f1df30449ffePAyEawL0cqZvmK` with no code edits: `npm test` 79/79 pass; `npm run lint` pass with negative `no-undef` probe failing as intended; `npm run test:container` pass (10 smoke checks including hardened non-root/read-only); Prettier check pass; `git diff --check` pass; no leftover fixtures.
- Criterion review: NB-01–NB-05 each re-probed and pass; prior test-count growth 40→72→79 consistent; README Job matches `job.yaml`; image contains only `entrypoint.js`+`source.js`.
- Recommendation: PASS with no blocking defects and no follow-up required. Residual limits: no real cluster validation, no supply-chain audit, no perf benchmark.

## Consequential deferrals

- Untrusted-code sandboxing is outside the documented trusted-code product boundary; container hardening does not remove Node filesystem/network/process access.
- In-process execution timeout is deferred: a timer cannot preempt synchronous JavaScript, while a worker/process isolation redesign would expand the runtime significantly. This plan supplies orchestrator deadlines and resource limits; local users must provide their own execution deadline.
- Dependency installation, scheduling, structured result protocols, and retry orchestration are not established product requirements. Existing Node console formatting and Kubernetes job controls remain the contract; adding services here would undermine the tiny runner's purpose.
- No startup-performance claim is made without measurement. This plan measures only build-context reduction and bounds newly introduced source reads.
