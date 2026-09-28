# Nodbox

This docker container runs JavaScript code without having a dedicated docker image containing the codebase.
It takes trusted JavaScript source inline, from a mounted file, or from stdin.

## Trust Model

Nodbox executes the provided source code inside Node.js.
That code runs with normal Node.js process access, including `require(...)`, filesystem access, network access, and environment variables that are available to the container.

Use Nodbox only with trusted code.
If you need to run untrusted or user-submitted code, use a stronger isolation boundary than this container provides.

When deploying to Kubernetes, use the hardened `job.yaml` example repeated below:

- Pod and container run as numeric UID/GID `1000:1000` with `runAsNonRoot: true`, matching the `node` user in the image
- `allowPrivilegeEscalation: false`, `readOnlyRootFilesystem: true`, dropped `ALL` Linux capabilities, and `RuntimeDefault` seccomp
- `automountServiceAccountToken: false` because the script does not call the Kubernetes API
- Illustrative `resources` requests/limits, `activeDeadlineSeconds`, and `ttlSecondsAfterFinished`; tune them for the workload

This hardening restricts the container but does not sandbox Node.js: trusted scripts keep normal `require`, filesystem, network, and environment access allowed by the deployment.

## CLI usage

```text
nodbox [--] <source> [-- <arg>...]
nodbox --file <path> [-- <arg>...]
nodbox - [-- <arg>...]
nodbox --help | -h
```

Here `nodbox` means `node entrypoint.js` locally or `docker run --rm ghcr.io/egose/nodbox:latest` in Docker.
Quote the entire inline script as one shell argument. Scripts support top-level `await` and `return`, and have access to injected `require` and a fresh `args` string array.

```bash
node entrypoint.js 'await Promise.resolve(); return 42;'
node entrypoint.js 'return JSON.stringify(args)' -- 'hello world' --verbose
docker run --rm ghcr.io/egose/nodbox:latest 'console.log(args[0]); return args[1]' -- 'hello world' --verbose
```

Only tokens after the separator following source become script parameters. Spaces, empty strings, flag-like values, and further `--` tokens are preserved as passed by the shell. Without parameters, `args` is empty. Nodbox leaves `process.argv` as Node's original process arguments; use `args` for script parameters.

Use a leading `--` to escape inline source beginning with a dash; the separator after source still introduces parameters:

```bash
node entrypoint.js -- '-1; return args[0]' -- 'escaped source'
```

`--help` and `-h` must be used alone. They print help without executing source or reading stdin. Missing, empty, or whitespace-only source, unknown options, and extra values without a parameter separator produce usage diagnostics on stderr. There is no implicit stdin input: missing source fails immediately even when stdin is open.

### File and stdin sources

Use `--file <path>` for multiline scripts. Paths resolve from the current working directory; quote paths containing spaces and prefix dash-leading names with `./`. `--file` requires a path, so `--file -` is invalid; use the standalone `-` source mode for stdin. Select exactly one source mode, then use `--` for script parameters:

```bash
node entrypoint.js --file ./script.js -- 'hello world' --verbose
node entrypoint.js - -- 'hello world' --verbose < script.js

docker run --rm \
  --mount "type=bind,src=$PWD/script.js,dst=/scripts/job.js,readonly" \
  ghcr.io/egose/nodbox:latest --file /scripts/job.js -- 'hello world'
docker run --rm -i ghcr.io/egose/nodbox:latest - -- 'hello world' < script.js
```

Files and stdin must be valid UTF-8. All three source modes accept **at most 1 MiB (1,048,576 UTF-8 bytes)**, including whitespace and any UTF-8 BOM. The exact limit is accepted; one byte more is rejected before execution. Unicode characters may occupy multiple bytes. Inline source is also subject to the operating system's argument-size limit, which may be smaller. Blank or invalid UTF-8 input and oversized source produce usage errors (exit `2`). Missing/unreadable files and stdin read failures produce read errors (exit `1`) with source-specific diagnostics.

File/stdin loading uses a bounded byte buffer and stops reading as soon as the limit is exceeded, closing the source stream; a pipe producer may consequently see a broken pipe. Source is executed only after a successful complete read. UTF-8 sequences may span chunks. A UTF-8 BOM is accepted.

`-` consumes stdin as **source**, waiting for EOF before execution; that same stream has no runtime input left for the script. Use inline or file mode when the script itself needs stdin as **data**. Those modes leave stdin untouched. Docker needs `-i` to forward stdin in either case; a TTY (`-t`) is unnecessary.

File-mode syntax and runtime diagnostics include the resolved absolute source filename and original source line numbers. The injected `require` continues to resolve relative to the Nodbox runner (`/app/entrypoint.js` in the image), **not the source file or working directory**. For example, `require('./helper')` looks beside the runner; use an absolute path for a separately mounted helper. Node built-in modules are available. Nodbox does not install packages automatically or add runtime dependencies.

For Kubernetes, create a ConfigMap from the local script:

```bash
kubectl create configmap nodbox-source --from-file=script.js
```

In the Job's Pod spec (`spec.template.spec`), merge these source-related fields into the hardened Job configuration below.
Keep the hardened `securityContext`, `resources`, deadlines, and `automountServiceAccountToken: false` unchanged:

```yaml
containers:
  - name: nodbox
    image: ghcr.io/egose/nodbox:latest
    args: ['--file', '/scripts/script.js', '--', 'hello world']
    volumeMounts:
      - name: source
        mountPath: /scripts
        readOnly: true
volumes:
  - name: source
    configMap:
      name: nodbox-source
```

The ConfigMap key `script.js` becomes `/scripts/script.js`. Kubernetes applies its own ConfigMap size constraints in addition to Nodbox's source limit.

### Output and exit status

Script console output is preserved. Any returned value other than `undefined` is printed with Node's `console.log` formatting, including `false`, `0`, and `null`. Returning `undefined` adds no output. This is console formatting, not a JSON serialization protocol.

| Exit status | Meaning                                                       |
| ----------- | ------------------------------------------------------------- |
| `0`         | Successful script or help                                     |
| `1`         | Source read failure, or script syntax/runtime failure         |
| `2`         | Invalid invocation or source content; source was not executed |

Compatibility changes: missing/blank source now fails instead of succeeding silently; malformed or ambiguous invocations now fail instead of ignoring trailing values. Source starting with a dash now requires the leading `--` escape.

### Reusable runtime

`require('./entrypoint')` exports `runScript(source, context, { filename } = {})`, `createRuntimeContext(args = [])`, `parseArgs(tokens)`, and `main(argv = process.argv)`.
`runScript` returns the async script's promise (compilation errors can throw synchronously). Omitting its context supplies the runner's `require` and empty `args`; an explicit context retains its injected bindings and receives a fresh copy of `context.args`, or an empty array if omitted. Existing `runScript(source, context)` calls remain valid. Other context values are not deep-cloned.
The optional `filename` gives compilation/runtime diagnostics a source name; it does not change `require` resolution. `runScript` is the execution primitive and does not load or size-check source itself.
`createRuntimeContext` supplies `require` and copies the supplied parameter array. `parseArgs` accepts tokens after the Node executable and entrypoint, returning `{ mode: 'help' }`, `{ mode: 'inline', source, args }`, `{ mode: 'file', path, args }`, or `{ mode: 'stdin', args }`; invalid invocations throw. It neither executes source nor changes its input.
`require('./source')` exports `loadSource(invocation, { stdin = process.stdin } = {})`, `MAX_SOURCE_BYTES`, and `SourceError`. `loadSource` accepts a non-help parsed invocation and resolves to `{ source }` or `{ source, filename }` for a file. Its optional stdin is a Node readable byte stream; it is consumed to EOF on success or destroyed on early failure. The loader enforces the byte limit, decoding, and nonblank content, rejecting with `SourceError` for invalid content and an ordinary error with a cause for read failures. It performs no execution.
`main` handles CLI parsing, bounded source loading, usage/help output, and result printing; content/usage errors set exit status `2`, while read/script failures propagate to its caller (the executable reports them on stderr and sets exit status `1`).

## Kubernetes example

The checked-in `job.yaml` is the canonical example. It matches this manifest:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: nodbox
spec:
  # Illustrative bounds: stop a hung job and clean up the finished object.
  # Tune both values for the workload and cluster policy.
  activeDeadlineSeconds: 300
  ttlSecondsAfterFinished: 600
  # Retry at most once. A retry re-executes the script from the start,
  # so side effects must be idempotent; there is no exactly-once execution.
  backoffLimit: 1
  template:
    spec:
      restartPolicy: Never
      # This workload does not call the Kubernetes API.
      automountServiceAccountToken: false
      enableServiceLinks: false
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        runAsGroup: 1000
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: nodbox
          image: ghcr.io/egose/nodbox:latest
          imagePullPolicy: Always
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            runAsNonRoot: true
            runAsUser: 1000
            runAsGroup: 1000
            capabilities:
              drop:
                - ALL
            seccompProfile:
              type: RuntimeDefault
          # Illustrative sizing only. Measure the script and set requests/limits
          # that fit the workload, namespace quota, and cluster policy.
          resources:
            requests:
              cpu: 100m
              memory: 64Mi
            limits:
              cpu: 500m
              memory: 256Mi
          args:
            - |
              await Promise.resolve();
              console.log("hello world!");
              return "200:Okay";
```

### Operating the Job

Resources and deadlines are example sizing, not tuned recommendations. `requests: { cpu: 100m, memory: 64Mi }` and `limits: { cpu: 500m, memory: 256Mi }` let the scheduler place the Pod and cap a misbehaving script; adjust them from measured usage and namespace quotas. `activeDeadlineSeconds: 300` lets the Job controller terminate Pods that run longer than five minutes, and `ttlSecondsAfterFinished: 600` removes the finished Job after ten minutes to avoid costly leftovers. Validate quotas, limit ranges, and PodSecurity admission in a real cluster; local `docker build`/`docker run` checks below cannot validate cluster policy. No cluster is required for those local checks.

Retries re-run the whole script. With `restartPolicy: Never` and `backoffLimit: 1`, Kubernetes may start the Pod up to twice after a failure. Plan for at-least-once Pod execution: make external side effects idempotent with keys, check-before-write, or naturally repeatable operations. Do not assume exactly-once execution.

Troubleshoot with logs and Job status:

```bash
kubectl logs job/nodbox
kubectl describe job nodbox
kubectl get job nodbox -o jsonpath='{.status.conditions}'
```

Exit statuses match the CLI table: `0` is success, `1` is a source-read or script syntax/runtime failure, and `2` is invalid invocation or source content. A `DeadlineExceeded` condition means `activeDeadlineSeconds` fired; increase the bound only if the workload legitimately needs longer, or fix the hanging script.

Pass credentials only through explicit environment or Secret wiring, never in the image or inline `args`. For example, mount a Secret as environment variables and read it with `process.env`:

```yaml
containers:
  - name: nodbox
    env:
      - name: API_TOKEN
        valueFrom:
          secretKeyRef:
            name: nodbox-credentials
            key: token
```

Use ConfigMaps for non-secret script source as shown above, and Secrets only for sensitive values with minimal RBAC.

Networking is a deployment policy, not a code property. Restrict egress with a `NetworkPolicy` or namespace defaults when the script does not need network access, and leave network open only for scripts that explicitly require it. The container hardening above does not block network calls by itself.

The root filesystem is read-only. If a script must write scratch data, add an explicit writable mount alongside the hardened settings:

```yaml
containers:
  - name: nodbox
    volumeMounts:
      - name: scratch
        mountPath: /tmp
volumes:
  - name: scratch
    emptyDir: {}
```

Deadline enforcement belongs to the orchestrator. `activeDeadlineSeconds` terminates the Pod from outside Kubernetes; asynchronous execution alone does not bound a synchronous CPU loop inside Node.js, and Nodbox has no in-process timeout. Locally, wrap `docker run` with an external deadline such as `timeout 300 docker run ...`.

## Development

Prerequisites: Node.js `>=22` with installed dev dependencies, and a working Docker daemon for container checks.

Run the host test suite (Docker-independent) with:

```bash
npm test
```

Run static checks with:

```bash
npm run lint
```

Build the local image and run the shipped-container smoke checks (inline, file, stdin, help/usage, script failure, arguments, and hardened non-root/read-only execution) with:

```bash
npm run test:container
```

`test:container` builds `nodbox-container-test:local` locally without pushing, uses `--rm` containers and a repository-local fixture directory that is removed even on failure, and overwrites the same image tag on repeat runs. No startup-performance claim is made; the build-context allowlist in `.dockerignore` only reduces transferred files.
