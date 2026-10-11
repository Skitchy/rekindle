import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash, createPrivateKey, sign, verify } from "node:crypto";
import {
  KEYCHAIN_SERVICE,
  KEYCHAIN_TIMEOUT_MS,
  SECURITY_PATH,
  TEST_SEED_ENV,
  ProvenanceKeyError,
  keyFromSeed,
  keyIdOf,
  loadSeed,
  prepareWriteContext,
  rawPublicKey,
} from "../keys.js";

// No test may reach the real /usr/bin/security: every call hits this mock, and its default throws.
const { unmocked } = vi.hoisted(() => ({
  unmocked: () => {
    throw new Error("unmocked execFileSync call");
  },
}));
vi.mock("node:child_process", () => ({ execFileSync: vi.fn(unmocked) }));

const mockedExec = vi.mocked(execFileSync);

beforeAll(() => {
  expect(vi.isMockFunction(execFileSync)).toBe(true);
});

const STORE_ID = "0123456789abcdef0123456789abcdef";

// RFC 8032 section 7.1, read from https://www.rfc-editor.org/rfc/rfc8032.txt.
// key_id values computed separately: printf <public key hex> | xxd -r -p | shasum -a 256.
const RFC8032 = [
  {
    name: "TEST 1",
    seed: "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
    publicKey: "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
    message: "",
    signature:
      "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b",
    keyId: "21fe31dfa154a261626bf854046fd2271b7bed4b6abe45aa58877ef47f9721b9",
  },
  {
    name: "TEST 2",
    seed: "4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb",
    publicKey: "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c",
    message: "72",
    signature:
      "92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00",
    keyId: "39f713d0a644253f04529421b9f51b9b08979d08295959c4f3990ee617f5139f",
  },
  {
    name: "TEST 3",
    seed: "c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7",
    publicKey: "fc51cd8e6218a1a38da47ed00230f0580816ed13ba3303ac5deb911548908025",
    message: "af82",
    signature:
      "6291d657deec24024827e69c3abe01a30ce548a284743a445e3680d7db5ac3ac18ff9b538d16f290ae67f760984dc6594a7c15e9716ed28dc027beceea1ec40a",
    keyId: "dac073e0123bdea59dd9b3bda9cf6037f63aca82627d7abcd5c4ac29dd74003e",
  },
];

const SEED = RFC8032[0].seed;

function keychainReturns(output: string | Buffer) {
  mockedExec.mockImplementationOnce(() => (typeof output === "string" ? Buffer.from(output, "latin1") : output));
}

function keychainThrows(fields: Record<string, unknown>) {
  mockedExec.mockImplementationOnce(() => {
    throw Object.assign(new Error(`Command failed: security ... ${SEED}`), fields);
  });
}

function caught(fn: () => unknown): ProvenanceKeyError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ProvenanceKeyError);
    return e as ProvenanceKeyError;
  }
  throw new Error("expected a throw");
}

// Every own field of the error, its cause and its stack, as text, must be free of the seed.
function expectNoSeed(err: unknown, seedHex = SEED) {
  const seedBytes = Buffer.from(seedHex, "hex").toString("latin1");
  const seen: string[] = [];
  const e = err as Record<string, unknown>;
  for (const name of Object.getOwnPropertyNames(e)) seen.push(String(e[name]));
  seen.push(String(e.cause), String(e.stack), String(err));
  const text = seen.join("\n");
  expect(text).not.toContain(seedHex);
  expect(text).not.toContain(seedBytes);
  expect(e.cause).toBeUndefined();
  for (const field of ["stdout", "stderr", "output"]) expect(Object.hasOwn(e, field)).toBe(false);
}

let savedEnv: string | undefined;

beforeEach(() => {
  mockedExec.mockReset();
  mockedExec.mockImplementation(unmocked);
  savedEnv = process.env[TEST_SEED_ENV];
  delete process.env[TEST_SEED_ENV];
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env[TEST_SEED_ENV];
  else process.env[TEST_SEED_ENV] = savedEnv;
});

describe("RFC 8032 section 7.1 vectors", () => {
  it.each(RFC8032.map((v) => [v.name, v] as const))("%s: public key, signature and key_id", (_name, v) => {
    const key = keyFromSeed(Buffer.from(v.seed, "hex"));
    expect(rawPublicKey(key).toString("hex")).toBe(v.publicKey);
    expect(sign(null, Buffer.from(v.message, "hex"), key).toString("hex")).toBe(v.signature);
    expect(keyIdOf(key)).toBe(v.keyId);
  });

  it("key_id is SHA-256 of the raw 32-byte public key", () => {
    const key = keyFromSeed(Buffer.from(SEED, "hex"));
    const raw = rawPublicKey(key);
    expect(raw.length).toBe(32);
    expect(keyIdOf(key)).toBe(createHash("sha256").update(raw).digest("hex"));
  });

  // Fixed-byte keys of other curves (no key generation). X25519's SPKI is also 44 bytes, so only the
  // prefix check catches it; Ed448's SPKI is 69 bytes.
  it.each([
    ["X25519", "302e020100300506032b656e04220420", 32],
    ["Ed448", "3047020100300506032b6571043b0439", 57],
  ])("rejects a %s key when deriving the raw public key", (_name, prefix, length) => {
    const key = createPrivateKey({
      key: Buffer.concat([Buffer.from(prefix, "hex"), Buffer.alloc(length, 0x42)]),
      format: "der",
      type: "pkcs8",
    });
    expect(caught(() => rawPublicKey(key)).code).toBe("invalid_public_key");
    expect(caught(() => keyIdOf(key)).code).toBe("invalid_public_key");
  });

  it("rejects a seed that is not 32 bytes", () => {
    expect(caught(() => keyFromSeed(Buffer.alloc(31))).code).toBe("malformed_seed");
    expect(caught(() => keyFromSeed(Buffer.alloc(33))).code).toBe("malformed_seed");
  });
});

describe("sign and verify", () => {
  it("round-trips through a prepared context", () => {
    process.env[TEST_SEED_ENV] = SEED;
    const ctx = prepareWriteContext({ store_id: STORE_ID, canonical: false });
    const message = Buffer.from("rekindle provenance phase 2");
    const signature = sign(null, message, ctx.key);
    const publicKey = keyFromSeed(Buffer.from(SEED, "hex"));
    expect(verify(null, message, publicKey, signature)).toBe(true);
    expect(verify(null, Buffer.from("rekindle provenance phase 3"), publicKey, signature)).toBe(false);
    expect(ctx.key_id).toBe(RFC8032[0].keyId);
    expect(ctx.store_id).toBe(STORE_ID);
  });
});

describe("keychain read", () => {
  it("calls the absolute security path with exact argv and options", () => {
    keychainReturns(`${SEED}\n`);
    loadSeed(STORE_ID);
    expect(mockedExec).toHaveBeenCalledTimes(1);
    expect(mockedExec).toHaveBeenCalledWith(
      SECURITY_PATH,
      ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", STORE_ID, "-w"],
      { shell: false, timeout: KEYCHAIN_TIMEOUT_MS, stdio: ["ignore", "pipe", "pipe"] },
    );
    expect(SECURITY_PATH).toBe("/usr/bin/security");
    expect(KEYCHAIN_SERVICE).toBe("rekindle-provenance");
    expect(KEYCHAIN_TIMEOUT_MS).toBe(120000);
  });

  it("accepts the seed with no terminator", () => {
    keychainReturns(SEED);
    expect(loadSeed(STORE_ID).toString("hex")).toBe(SEED);
  });

  it("accepts the seed with exactly one LF", () => {
    keychainReturns(`${SEED}\n`);
    expect(loadSeed(STORE_ID).toString("hex")).toBe(SEED);
  });

  it.each([
    ["CR-LF", `${SEED}\r\n`],
    ["a trailing space", `${SEED} `],
    ["two LFs", `${SEED}\n\n`],
    ["a leading LF", `\n${SEED}`],
    ["uppercase hex", SEED.toUpperCase()],
    ["a non-hex character", `${SEED.slice(0, 63)}g`],
    ["31 bytes", SEED.slice(0, 62)],
    ["33 bytes", `${SEED}00`],
    ["empty output", ""],
  ])("rejects keychain output with %s", (_name, output) => {
    keychainReturns(output);
    const err = caught(() => loadSeed(STORE_ID));
    expect(err.code).toBe("malformed_seed");
    expectNoSeed(err);
  });

  it("reports a timeout as keychain_timeout, without seed bytes or captured output", () => {
    keychainThrows({ code: "ETIMEDOUT", signal: "SIGTERM", status: null, stdout: Buffer.from(SEED), stderr: Buffer.from(SEED) });
    const err = caught(() => loadSeed(STORE_ID));
    expect(err.code).toBe("keychain_timeout");
    expect(err.exitStatus).toBeNull();
    expectNoSeed(err);
  });

  // security's exit codes for a missing item or a denied prompt were not verified (running it is out of
  // scope), so every non-timeout failure maps to one code and keeps only its exit status.
  it.each([
    ["exit status 44", 44],
    ["exit status 128", 128],
    ["exit status 1", 1],
  ])("reports %s as keychain_failed with its exit status only", (_name, status) => {
    keychainThrows({ status, stdout: Buffer.from(`${SEED}\n`), stderr: Buffer.from(`error ${SEED}`), output: [null, SEED, SEED] });
    const err = caught(() => loadSeed(STORE_ID));
    expect(err.code).toBe("keychain_failed");
    expect(err.exitStatus).toBe(status);
    expectNoSeed(err);
  });

  it("reports a spawn failure as keychain_failed", () => {
    keychainThrows({ code: "ENOENT", errno: -2 });
    const err = caught(() => loadSeed(STORE_ID));
    expect(err.code).toBe("keychain_failed");
    expect(err.exitStatus).toBeNull();
  });

  it("zeroes the returned output buffer after parsing", () => {
    const output = Buffer.from(`${SEED}\n`, "latin1");
    keychainReturns(output);
    loadSeed(STORE_ID);
    expect(output.every((b) => b === 0)).toBe(true);
  });
});

describe("store_id format", () => {
  it.each([
    ["31 characters", STORE_ID.slice(0, 31)],
    ["33 characters", `${STORE_ID}0`],
    ["uppercase", STORE_ID.toUpperCase()],
    ["a dash", `${STORE_ID.slice(0, 31)}-`],
    ["an argv-looking value", "-w"],
    ["empty", ""],
  ])("rejects %s before any keychain call", (_name, storeId) => {
    expect(caught(() => loadSeed(storeId)).code).toBe("invalid_store_id");
    expect(caught(() => prepareWriteContext({ store_id: storeId, canonical: true })).code).toBe("invalid_store_id");
    expect(mockedExec).not.toHaveBeenCalled();
  });
});

describe("prepareWriteContext", () => {
  it("canonical: reads the keychain once and derives the key", () => {
    keychainReturns(`${SEED}\n`);
    const ctx = prepareWriteContext({ store_id: STORE_ID, canonical: true });
    expect(mockedExec).toHaveBeenCalledTimes(1);
    expect(ctx.key_id).toBe(RFC8032[0].keyId);
    expect(ctx.store_id).toBe(STORE_ID);
  });

  it("canonical: throws when the test seed variable is set, before any keychain call", () => {
    process.env[TEST_SEED_ENV] = SEED;
    const err = caught(() => prepareWriteContext({ store_id: STORE_ID, canonical: true }));
    expect(err.code).toBe("test_seed_on_canonical");
    expect(mockedExec).not.toHaveBeenCalled();
    expectNoSeed(err);
  });

  it("canonical: an empty test seed variable still counts as set", () => {
    process.env[TEST_SEED_ENV] = "";
    expect(caught(() => prepareWriteContext({ store_id: STORE_ID, canonical: true })).code).toBe("test_seed_on_canonical");
  });

  it("canonical: a keychain failure fails closed", () => {
    keychainThrows({ status: 44 });
    expect(caught(() => prepareWriteContext({ store_id: STORE_ID, canonical: true })).code).toBe("keychain_failed");
  });

  it("noncanonical: uses the test seed variable and never calls the keychain", () => {
    process.env[TEST_SEED_ENV] = RFC8032[1].seed;
    const ctx = prepareWriteContext({ store_id: STORE_ID, canonical: false });
    expect(ctx.key_id).toBe(RFC8032[1].keyId);
    expect(mockedExec).not.toHaveBeenCalled();
  });

  it("noncanonical: a missing test seed variable fails closed", () => {
    expect(caught(() => prepareWriteContext({ store_id: STORE_ID, canonical: false })).code).toBe("test_seed_missing");
    expect(mockedExec).not.toHaveBeenCalled();
  });

  it.each([
    ["uppercase hex", SEED.toUpperCase()],
    ["a trailing LF", `${SEED}\n`],
    ["31 bytes", SEED.slice(0, 62)],
    ["33 bytes", `${SEED}00`],
    ["a non-hex character", `${SEED.slice(0, 63)}g`],
    ["empty", ""],
  ])("noncanonical: rejects a test seed with %s", (_name, value) => {
    process.env[TEST_SEED_ENV] = value;
    const err = caught(() => prepareWriteContext({ store_id: STORE_ID, canonical: false }));
    expect(err.code).toBe("malformed_seed");
    expectNoSeed(err);
    expect(mockedExec).not.toHaveBeenCalled();
  });

  it.each([1, 0, "true", null])("rejects a non-boolean canonical flag (%s)", (flag) => {
    const err = caught(() => prepareWriteContext({ store_id: STORE_ID, canonical: flag as unknown as boolean }));
    expect(err.code).toBe("invalid_canonical_flag");
    expect(mockedExec).not.toHaveBeenCalled();
  });

  it("one context signs a batch with exactly one keychain read", () => {
    keychainReturns(`${SEED}\n`);
    const ctx = prepareWriteContext({ store_id: STORE_ID, canonical: true });
    const publicKey = keyFromSeed(Buffer.from(SEED, "hex"));
    for (let i = 0; i < 5; i++) {
      const message = Buffer.from(`event ${i}`);
      expect(verify(null, message, publicKey, sign(null, message, ctx.key))).toBe(true);
    }
    expect(mockedExec).toHaveBeenCalledTimes(1);
  });
});
