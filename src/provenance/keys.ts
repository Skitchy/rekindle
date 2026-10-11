import { execFileSync } from "node:child_process";
import { createHash, createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";

// Provenance signing keys and the prepared write context (plan phase 2).
// Design: docs/provenance-chain-design.md section 7. Keygen is phase 5; nothing here creates a key.

export const KEYCHAIN_SERVICE = "rekindle-provenance";
export const SECURITY_PATH = "/usr/bin/security";
export const KEYCHAIN_TIMEOUT_MS = 120_000;
export const TEST_SEED_ENV = "REKINDLE_TEST_SIGNING_SEED";

// 128 random bits as lowercase hex. Phase 5's prepare must generate exactly this format.
export const STORE_ID_PATTERN = /^[0-9a-f]{32}$/;

const SEED_BYTES = 32;
const SEED_HEX = /^[0-9a-f]{64}$/;
const LF = 0x0a;
// RFC 8410 encodings for Ed25519.
const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const SPKI_LENGTH = SPKI_PREFIX.length + 32;

export type ProvenanceKeyErrorCode =
  | "invalid_store_id"
  | "invalid_canonical_flag"
  | "keychain_timeout"
  | "keychain_failed"
  | "malformed_seed"
  | "test_seed_missing"
  | "test_seed_on_canonical"
  | "invalid_public_key";

// Messages are fixed strings. No field ever carries seed bytes, command output or the original error.
export class ProvenanceKeyError extends Error {
  readonly code: ProvenanceKeyErrorCode;
  readonly exitStatus: number | null;

  constructor(code: ProvenanceKeyErrorCode, message: string, exitStatus: number | null = null) {
    super(message);
    this.name = "ProvenanceKeyError";
    this.code = code;
    this.exitStatus = exitStatus;
  }
}

export interface WriteContext {
  key: KeyObject;
  key_id: string;
  store_id: string;
}

function checkStoreId(store_id: unknown): string {
  if (typeof store_id !== "string" || !STORE_ID_PATTERN.test(store_id)) {
    throw new ProvenanceKeyError("invalid_store_id", "store_id must be 32 lowercase hex characters");
  }
  return store_id;
}

function hexDigit(byte: number): number {
  if (byte >= 0x30 && byte <= 0x39) return byte - 0x30;
  if (byte >= 0x61 && byte <= 0x66) return byte - 0x61 + 10;
  return -1;
}

// Keychain output: exactly 64 lowercase hex bytes, optionally followed by one LF. No trim().
function seedFromOutput(output: Buffer): Buffer {
  const end = output.length > 0 && output[output.length - 1] === LF ? output.length - 1 : output.length;
  if (end !== SEED_BYTES * 2) throw new ProvenanceKeyError("malformed_seed", "keychain seed is malformed");
  const seed = Buffer.alloc(SEED_BYTES);
  for (let i = 0; i < SEED_BYTES; i++) {
    const hi = hexDigit(output[2 * i]);
    const lo = hexDigit(output[2 * i + 1]);
    if (hi < 0 || lo < 0) {
      seed.fill(0);
      throw new ProvenanceKeyError("malformed_seed", "keychain seed is malformed");
    }
    seed[i] = (hi << 4) | lo;
  }
  return seed;
}

export function loadSeed(store_id: string): Buffer {
  checkStoreId(store_id);
  let output: Buffer;
  try {
    output = execFileSync(
      SECURITY_PATH,
      ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", store_id, "-w"],
      { shell: false, timeout: KEYCHAIN_TIMEOUT_MS, stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (e: unknown) {
    // The original error can hold stdout and stderr, so only its exit status survives.
    const err = e as { code?: unknown; status?: unknown };
    const status = typeof err.status === "number" ? err.status : null;
    if (err.code === "ETIMEDOUT") {
      throw new ProvenanceKeyError("keychain_timeout", "keychain read timed out", status);
    }
    throw new ProvenanceKeyError("keychain_failed", "keychain read failed", status);
  }
  try {
    return seedFromOutput(output);
  } finally {
    output.fill(0);
  }
}

function seedFromEnv(value: string): Buffer {
  if (!SEED_HEX.test(value)) {
    throw new ProvenanceKeyError("malformed_seed", `${TEST_SEED_ENV} is malformed`);
  }
  return Buffer.from(value, "hex");
}

export function keyFromSeed(seed: Buffer): KeyObject {
  if (seed.length !== SEED_BYTES) throw new ProvenanceKeyError("malformed_seed", "seed must be 32 bytes");
  const der = Buffer.concat([PKCS8_PREFIX, seed]);
  try {
    return createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  } finally {
    der.fill(0);
  }
}

export function rawPublicKey(key: KeyObject): Buffer {
  const spki = createPublicKey(key).export({ format: "der", type: "spki" });
  if (spki.length !== SPKI_LENGTH || !spki.subarray(0, SPKI_PREFIX.length).equals(SPKI_PREFIX)) {
    throw new ProvenanceKeyError("invalid_public_key", "public key is not a raw Ed25519 key");
  }
  return spki.subarray(SPKI_PREFIX.length);
}

export function keyIdOf(key: KeyObject): string {
  return createHash("sha256").update(rawPublicKey(key)).digest("hex");
}

// Loads and validates the key once, before any lock. Canonical stores read only the keychain;
// noncanonical stores (tests, CI) read only the test seed variable.
export function prepareWriteContext(options: { store_id: string; canonical: boolean }): WriteContext {
  const store_id = checkStoreId(options.store_id);
  // The stored flag is an INTEGER column; a strict boolean keeps 1, "0" and true from meaning different things.
  if (typeof options.canonical !== "boolean") {
    throw new ProvenanceKeyError("invalid_canonical_flag", "canonical must be a boolean");
  }
  const testSeed = process.env[TEST_SEED_ENV];
  let seed: Buffer;
  if (options.canonical) {
    if (testSeed !== undefined) {
      throw new ProvenanceKeyError("test_seed_on_canonical", `${TEST_SEED_ENV} must not be set for a canonical store`);
    }
    seed = loadSeed(store_id);
  } else {
    if (testSeed === undefined) {
      throw new ProvenanceKeyError("test_seed_missing", `${TEST_SEED_ENV} is required for a noncanonical store`);
    }
    seed = seedFromEnv(testSeed);
  }
  try {
    const key = keyFromSeed(seed);
    return { key, key_id: keyIdOf(key), store_id };
  } finally {
    seed.fill(0);
  }
}
