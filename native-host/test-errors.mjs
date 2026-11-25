#!/usr/bin/env node
/**
 * Prove that a failed download surfaces curl's reason, not just an exit code.
 *
 * Before the fix, `fetch_to_file` piped curl's stderr and never read it, so the
 * reply said only "curl exit 22" — useless for deciding whether to retry, whether
 * the URL expired, or whether the network is down. This drives the real binary
 * over the real protocol against a URL that cannot resolve, and asserts the
 * reply carries a human-readable cause.
 */
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BIN = process.argv[2] || path.join(import.meta.dirname, 'target', 'release', 'omni-native-host');

function rpc(command, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(BIN, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('timed out'));
    }, timeoutMs);

    child.stdout.on('data', (c) => {
      buf = Buffer.concat([buf, c]);
      if (buf.length < 4) return;
      const len = buf.readUInt32LE(0);
      if (buf.length < 4 + len) return;
      clearTimeout(timer);
      child.kill();
      resolve(JSON.parse(buf.subarray(4, 4 + len).toString('utf8')));
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });

    const body = Buffer.from(JSON.stringify(command), 'utf8');
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32LE(body.length, 0);
    child.stdin.write(Buffer.concat([prefix, body]));
  });
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-err-'));
let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

try {
  // Point the host at a real, writable folder so the failure is the DOWNLOAD,
  // not the destination validation (which would fail earlier and mask the point).
  await rpc({ cmd: 'set_folder', path: tmp });

  // .invalid is reserved by RFC 2606 and never resolves.
  const reply = await rpc({
    cmd: 'download',
    url: 'https://omni-media-test.invalid/nope.mp4',
    filename: 'probe.mp4',
  });

  check('failed download reports ok:false', reply.ok === false, JSON.stringify(reply));
  const err = String(reply.error || '');
  check('error names the URL', err.includes('omni-media-test.invalid'), err);
  check(
    'error carries a reason beyond the exit code',
    // Either curl's text (e.g. "Could not resolve host") or the empty-file guard.
    /resolve|resolve host|not known|Could not|empty|curl exit 6/i.test(err),
    err
  );
  console.log(`\n  reply: ${err}`);

  // No partial file should survive a failed transfer.
  const leftovers = fs.readdirSync(tmp).filter((f) => f.includes('probe'));
  check('no partial file left behind', leftovers.length === 0, leftovers.join(','));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${failures === 0 ? 'PASS' : `FAIL (${failures})`}`);
process.exit(failures === 0 ? 0 : 1);
