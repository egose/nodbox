# Changelog

## Unreleased

### Added

- Explicit inline CLI grammar, `--help`/`-h`, and a leading `--` escape for source beginning with a dash.
- Script parameters after a separating `--`, exposed through a fresh injected `args` string array without rewriting `process.argv`.
- UTF-8 source delivery through `--file <path>` and explicit stdin `-`, with the same script-parameter grammar as inline source. File diagnostics include the source filename and original line numbers; injected `require` remains runner-relative.
- Reusable bounded source loading, including streaming read-error diagnostics and strict UTF-8 decoding for file/stdin input. No automatic package installation or runtime dependencies.

### Changed

- Missing, empty, or whitespace-only source now produces a usage diagnostic and exits `2` instead of succeeding silently.
- Malformed or ambiguous invocations, including unknown options and extra positional values without `--`, now exit `2` without executing source. Inline source beginning with a dash requires a leading `--`.
- Help exits `0` without execution or input reads; script failures continue to exit `1`. Source read failures also exit `1`.
- Inline, file, and stdin source are limited to 1 MiB (1,048,576 UTF-8 bytes), inclusive. Oversized, blank, or invalid UTF-8 source exits `2` without execution; oversized streams stop reading immediately. Stdin is only read when explicitly selected with `-` and is consumed through EOF before execution.
