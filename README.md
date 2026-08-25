# Nodbox

This docker container runs JavaScript code without having a dedicated docker image containing the codebase.
It takes the source code as the arguments of the docker container's `ENTRYPOINT`.

## Trust Model

Nodbox executes the provided argument as JavaScript source code inside Node.js.
That code runs with normal Node.js process access, including `require(...)`, filesystem access, network access, and environment variables that are available to the container.

Use Nodbox only with trusted code.
If you need to run untrusted or user-submitted code, use a stronger isolation boundary than this container provides.

When deploying to Kubernetes, prefer a restrictive security context such as:

- `runAsNonRoot: true`
- `allowPrivilegeEscalation: false`
- `readOnlyRootFilesystem: true`
- dropped Linux capabilities
- minimal service account permissions
- disabled or restricted network access when possible

## Example

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: nodbox
spec:
  template:
    spec:
      containers:
        - name: nodbox
          image: ghcr.io/egose/nodbox:latest
          imagePullPolicy: Always
          args:
            - |
              console.log("hello world!");
              return "200:Okay";
      restartPolicy: Never
  backoffLimit: 1
```

## Development

Run the test suite with:

```bash
npm test
```
