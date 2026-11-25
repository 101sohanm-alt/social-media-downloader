#!/usr/bin/env node
/**
 * Integration test for the native messaging wire protocol.
 *
 * Unit tests inside main.rs exercise the functions directly. This drives the
 * actual release binary over real stdin/stdout with Chrome's framing — a 4-byte
 * NATIVE-ENDIAN length prefix followed by JSON — which is the only way to prove
 * the process boundary works. A framing bug (wrong endianness, wrong width, a
 * flush that never happens) passes every unit test and fails here.
 *
 * Usage: node native-host/test-protocol.mjs [path-to-binary]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BIN = process.argv[2] || path.join(import.meta.dirname, 'target', 'release', 'omni-native-host');

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/**
 * Send one command and read one framed reply.
 *
 * Chrome keeps the host process alive and exchanges several messages with it,
 * so this spawns once per test for isolation but speaks the full protocol.
 */
function rpc(command, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(BIN, [], { stdio: ['pipe', 'pipe', 'pipe'] });

    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    let buffer = Buffer.alloc(0);
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`timed out after ${timeoutMs}ms; stderr: ${stderr}`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < 4) return;

      // readUInt32LE is correct here because the test machine is x86_64.
      // The host writes to_ne_bytes(); on a big-endian host this would be BE.
      const len = buffer.readUInt32LE(0);
      if (buffer.length < 4 + len) return;

      const payload = buffer.subarray(4, 4 + len).toString('utf8');
      clearTimeout(timer);
      child.stdin.end();
      child.kill();

      try {
        resolve({ json: JSON.parse(payload), raw: payload, stderr });
      } catch (e) {
        reject(new Error(`reply was not valid JSON: ${payload}`));
      }
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

async function main() {
  if (!fs.existsSync(BIN)) {
    console.error(`binary not found: ${BIN}\nRun: cd native-host && cargo build --release`);
    process.exit(1);
  }
  console.log(`Testing ${BIN}\n`);

  // --- ping ----------------------------------------------------------------
  const ping = await rpc({ cmd: 'ping' });
  check('ping answers ok:true', ping.json.ok === true, ping.json.error);
  check('ping reports platform "macos"', ping.json.platform === 'macos', ping.json.platform);
  check('ping reports a version', typeof ping.json.version === 'string' && ping.json.version.length > 0);

  // --- get_folder ----------------------------------------------------------
  const get = await rpc({ cmd: 'get_folder' });
  check('get_folder answers ok:true', get.json.ok === true, get.json.error);
  check('get_folder returns a path or null', get.json.path === null || typeof get.json.path === 'string');

  // --- set_folder validation ----------------------------------------------
  const badRel = await rpc({ cmd: 'set_folder', path: 'relative/not/absolute' });
  check('set_folder rejects a relative path', badRel.json.ok === false, JSON.stringify(badRel.json));

  const badMissing = await rpc({ cmd: 'set_folder', path: '/nonexistent/dir/for/omni/test' });
  check('set_folder rejects a missing directory', badMissing.json.ok === false, JSON.stringify(badMissing.json));

  // Save the real setting so the test can restore it.
  const original = get.json.path;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-proto-'));
  try {
    const good = await rpc({ cmd: 'set_folder', path: tmp });
    check('set_folder accepts a writable directory', good.json.ok === true, JSON.stringify(good.json));
    check('set_folder echoes the path', good.json.path === tmp, good.json.path);

    const reread = await rpc({ cmd: 'get_folder' });
    check('folder choice persists across processes', reread.json.path === tmp, reread.json.path);

    // --- traversal rejection on the real binary ---------------------------
    const traversal = await rpc({ cmd: 'download', url: 'https://example.invalid/x', filename: '///' });
    check('download rejects an unusable filename', traversal.json.ok === false, JSON.stringify(traversal.json));

    // --- unknown command --------------------------------------------------
    const unknown = await rpc({ cmd: 'definitely_not_a_command' });
    check('unknown command returns an error, not a hang', unknown.json.ok === false, JSON.stringify(unknown.json));

    // --- malformed JSON ---------------------------------------------------
    // Speak the framing but send garbage: the host must answer, not die.
    const malformed = await new Promise((resolve, reject) => {
      const child = spawn(BIN, [], { stdio: ['pipe', 'pipe', 'pipe'] });
      let buf = Buffer.alloc(0);
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('host did not answer malformed input'));
      }, 10_000);
      child.stdout.on('data', (c) => {
        buf = Buffer.concat([buf, c]);
        if (buf.length < 4) return;
        const len = buf.readUInt32LE(0);
        if (buf.length < 4 + len) return;
        clearTimeout(timer);
        child.kill();
        resolve(JSON.parse(buf.subarray(4, 4 + len).toString('utf8')));
      });
      const body = Buffer.from('{not json', 'utf8');
      const prefix = Buffer.alloc(4);
      prefix.writeUInt32LE(body.length, 0);
      child.stdin.write(Buffer.concat([prefix, body]));
    });
    check('malformed JSON yields an ok:false reply', malformed.ok === false, JSON.stringify(malformed));
  } finally {
    // Restore whatever folder was configured before the test ran.
    if (original) {
      await rpc({ cmd: 'set_folder', path: original });
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('\nIntegration test crashed:', e.message);
  process.exit(1);
});
