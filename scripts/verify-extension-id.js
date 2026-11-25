#!/usr/bin/env node
// Verify: (1) the shipping manifest is valid JSON, (2) the pinned "key"
// derives exactly the extension ID the installer will put in allowed_origins.
//
// The extension ID is NOT arbitrary: Chrome derives it from the SHA-256 of the
// DER-encoded public key, rendered as a-p. If the installer and the manifest
// disagree, Chrome silently refuses to launch the native host and the only
// symptom is "Specified native messaging host not found".
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const EXPECTED_ID = 'jddkdffbpaddbipcicajehacdogcdagg';

/** Chrome maps each hex nibble 0-f onto the letters a-p. */
export function extensionIdFromKey(base64Der) {
  const hex = crypto
    .createHash('sha256')
    .update(Buffer.from(base64Der, 'base64'))
    .digest('hex')
    .slice(0, 32);
  return hex.replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));
}

const manifestPath = path.join(here, '..', 'public', 'manifest.json');

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
} catch (e) {
  console.error('manifest JSON: INVALID —', e.message);
  process.exit(1);
}
console.log('manifest JSON : VALID');

if (!manifest.key) {
  console.error('manifest has no "key" — the extension ID would be path-derived, so');
  console.error('moving the project folder would change it and break allowed_origins.');
  process.exit(1);
}

const id = extensionIdFromKey(manifest.key);
const ok = id === EXPECTED_ID;
console.log('derived id    :', id);
console.log('expected id   :', EXPECTED_ID);
console.log('match         :', ok);

if (!ok) {
  console.error('\nThe installer would register a different ID than the manifest declares.');
  process.exit(1);
}
process.exit(0);
