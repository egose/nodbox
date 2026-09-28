const { createReadStream } = require('node:fs');
const path = require('node:path');

const MAX_SOURCE_BYTES = 1024 * 1024;

class SourceError extends Error {}

function checkSize(size, label) {
  if (size > MAX_SOURCE_BYTES) {
    throw new SourceError(`${label} exceeds the 1 MiB (${MAX_SOURCE_BYTES} UTF-8 bytes) source limit.`);
  }
}

function checkSource(source, label) {
  if (source.trim() === '') {
    throw new SourceError(`${label} must contain nonblank JavaScript source.`);
  }
  return source;
}

async function readSource(stream, label) {
  const buffer = Buffer.allocUnsafe(MAX_SOURCE_BYTES);
  let size = 0;
  // Read bytes, not decoded characters: UTF-8 sequences may cross chunk boundaries.
  // Throwing from the iterator destroys a Node readable, stopping oversized input.
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    checkSize(size + bytes.length, label);
    bytes.copy(buffer, size);
    size += bytes.length;
  }

  let source;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size));
  } catch {
    throw new SourceError(`${label} must be valid UTF-8.`);
  }
  return checkSource(source, label);
}

async function loadSource(invocation, { stdin = process.stdin } = {}) {
  if (invocation.mode === 'inline') {
    checkSize(Buffer.byteLength(invocation.source, 'utf8'), 'Inline source');
    return { source: checkSource(invocation.source, 'Inline source') };
  }
  if (invocation.mode !== 'file' && invocation.mode !== 'stdin') {
    throw new SourceError('Choose inline, --file <path>, or - for stdin source.');
  }

  const filename = invocation.mode === 'file' ? path.resolve(invocation.path) : undefined;
  const label = filename ? `Source file ${JSON.stringify(filename)}` : 'Stdin source';
  try {
    const stream = filename ? createReadStream(filename, { highWaterMark: 64 * 1024 }) : stdin;
    const source = await readSource(stream, label);
    return filename ? { source, filename } : { source };
  } catch (error) {
    if (error instanceof SourceError) throw error;
    throw new Error(`Cannot read ${label}: ${error.message}`, { cause: error });
  }
}

module.exports = { loadSource, MAX_SOURCE_BYTES, SourceError };
