import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  CHAIN_TAG,
  ENTRY_FIELDS,
  MEMORY_STATE_FIELDS,
  MERKLE_TAG,
  ROTATE_TAG,
  ROTATION_STATEMENT_FIELDS,
  SESSION_STATE_FIELDS,
  STATE_TAGS,
  entryHash,
  jcs,
  merkleRoot,
  rotationMetaPayload,
  rotationStatementHash,
  sortMerkleLeaves,
  stateHash,
  type MerkleLeaf,
  type StateKind,
} from "../canonical.js";

type Row = Record<string, string | number | null>;

interface Vectors {
  states: { name: string; kind: StateKind; nonce: string; row: Row; expected_state_hash: string }[];
  entries: { name: string; entry: Row; expected_entry_hash: string }[];
  rotation: { statement: Row; payload: Row; expected_statement_hash: string; expected_payload_text: string };
  merkle: { name: string; leaves: MerkleLeaf[]; expected_root: string }[];
}

const vectors: Vectors = JSON.parse(readFileSync(new URL("./vectors.json", import.meta.url), "utf8"));

const nonceOf = (hex: string) => Buffer.from(hex, "hex");
const sha256 = (...parts: Uint8Array[]) => {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return h.digest();
};
const utf8 = (s: string) => Buffer.from(s, "utf8");

function mutate(value: string | number | null): string | number {
  if (value === null) return "x";
  if (typeof value === "number") return value + 1;
  // Change one character in place, keeping the length.
  if (value.length === 0) return "x";
  const last = value.charCodeAt(value.length - 1);
  return value.slice(0, -1) + String.fromCharCode(last === 0x41 ? 0x42 : 0x41);
}

describe("RFC 8785 vectors", () => {
  // RFC 8785 sections 3.2.2 to 3.2.4, read from https://www.rfc-editor.org/rfc/rfc8785.txt.
  const sample = JSON.parse(
    '{"numbers": [333333333.33333329, 1E30, 4.50, 2e-3, 0.000000000000000000000000001],' +
      ' "string": "\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/",' +
      ' "literals": [null, true, false]}',
  );

  it("canonicalizes the section 3.2.3 sample", () => {
    expect(jcs(sample)).toBe(
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],' +
        '"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
    );
  });

  it("produces the section 3.2.4 UTF-8 bytes", () => {
    const expected =
      "7b 22 6c 69 74 65 72 61 6c 73 22 3a 5b 6e 75 6c 6c 2c 74 72" +
      " 75 65 2c 66 61 6c 73 65 5d 2c 22 6e 75 6d 62 65 72 73 22 3a" +
      " 5b 33 33 33 33 33 33 33 33 33 2e 33 33 33 33 33 33 33 2c 31" +
      " 65 2b 33 30 2c 34 2e 35 2c 30 2e 30 30 32 2c 31 65 2d 32 37" +
      " 5d 2c 22 73 74 72 69 6e 67 22 3a 22 e2 82 ac 24 5c 75 30 30" +
      " 30 66 5c 6e 41 27 42 5c 22 5c 5c 5c 5c 5c 22 2f 22 7d";
    expect(utf8(jcs(sample)).toString("hex")).toBe(expected.replace(/ /g, ""));
  });

  it("sorts properties by UTF-16 code units (section 3.2.3)", () => {
    const input = JSON.parse(
      '{"\\u20ac": "Euro Sign", "\\r": "Carriage Return", "\\ufb33": "Hebrew Letter Dalet With Dagesh",' +
        ' "1": "One", "\\ud83d\\ude00": "Emoji: Grinning Face", "\\u0080": "Control",' +
        ' "\\u00f6": "Latin Small Letter O With Diaeresis"}',
    );
    // Read the order from the canonical text: re-parsing would move the integer-like key "1" first.
    const order = [...jcs(input).matchAll(/:"([^"]*)"/g)].map((m) => m[1]);
    expect(order).toEqual([
      "Carriage Return",
      "One",
      "Control",
      "Latin Small Letter O With Diaeresis",
      "Euro Sign",
      "Emoji: Grinning Face",
      "Hebrew Letter Dalet With Dagesh",
    ]);
  });

  // Appendix B, Table 1.
  const numberSamples: [string, string][] = [
    ["0000000000000000", "0"],
    ["8000000000000000", "0"],
    ["0000000000000001", "5e-324"],
    ["8000000000000001", "-5e-324"],
    ["7fefffffffffffff", "1.7976931348623157e+308"],
    ["ffefffffffffffff", "-1.7976931348623157e+308"],
    ["4340000000000000", "9007199254740992"],
    ["c340000000000000", "-9007199254740992"],
    ["4430000000000000", "295147905179352830000"],
    ["44b52d02c7e14af5", "9.999999999999997e+22"],
    ["44b52d02c7e14af6", "1e+23"],
    ["44b52d02c7e14af7", "1.0000000000000001e+23"],
    ["444b1ae4d6e2ef4e", "999999999999999700000"],
    ["444b1ae4d6e2ef4f", "999999999999999900000"],
    ["444b1ae4d6e2ef50", "1e+21"],
    ["3eb0c6f7a0b5ed8c", "9.999999999999997e-7"],
    ["3eb0c6f7a0b5ed8d", "0.000001"],
    ["41b3de4355555553", "333333333.3333332"],
    ["41b3de4355555554", "333333333.33333325"],
    ["41b3de4355555555", "333333333.3333333"],
    ["41b3de4355555556", "333333333.3333334"],
    ["41b3de4355555557", "333333333.33333343"],
    ["becbf647612f3696", "-0.0000033333333333333333"],
    ["43143ff3c1cb0959", "1424953923781206.2"],
  ];

  it.each(numberSamples)("serializes IEEE 754 %s as %s (Appendix B)", (bits, expected) => {
    const value = Buffer.from(bits, "hex").readDoubleBE(0);
    expect(jcs(value)).toBe(expected);
  });

  it("rejects NaN and Infinity (Appendix B note 3)", () => {
    expect(() => jcs(Buffer.from("7fffffffffffffff", "hex").readDoubleBE(0))).toThrow();
    expect(() => jcs(Buffer.from("7ff0000000000000", "hex").readDoubleBE(0))).toThrow();
  });

  it("rejects lone surrogates in keys and values", () => {
    expect(() => jcs({ a: "\ud800" })).toThrow();
    expect(() => jcs({ "\udc00": "a" })).toThrow();
  });
});

describe("cross-implementation vectors (Python oracle, common subset)", () => {
  it.each(vectors.states.map((v) => [v.name, v] as const))("state: %s", (_name, v) => {
    expect(stateHash(v.kind, nonceOf(v.nonce), v.row)).toBe(v.expected_state_hash);
  });

  it.each(vectors.entries.map((v) => [v.name, v] as const))("entry: %s", (_name, v) => {
    expect(entryHash(v.entry)).toBe(v.expected_entry_hash);
  });

  it("rotation statement hash and payload text", () => {
    expect(rotationStatementHash(vectors.rotation.statement)).toBe(vectors.rotation.expected_statement_hash);
    expect(rotationMetaPayload(vectors.rotation.payload)).toBe(vectors.rotation.expected_payload_text);
  });

  it.each(vectors.merkle.map((v) => [v.name, v] as const))("merkle: %s", (_name, v) => {
    expect(merkleRoot(v.leaves)).toBe(v.expected_root);
  });

  it("covers every vector the oracle produced", () => {
    expect(vectors.states.length).toBe(8);
    expect(vectors.entries.length).toBe(4);
    expect(vectors.merkle.length).toBe(7);
  });
});

const memoryVector = vectors.states.find((v) => v.name === "memory basic")!;
const sessionVector = vectors.states.find((v) => v.name === "session ended")!;
const storeEntry = vectors.entries.find((v) => v.name === "memory store")!.entry;
const rotateEntry = vectors.entries.find((v) => v.name === "key_rotate")!.entry;

describe("domain separation", () => {
  it("entry_hash is SHA-256(chain tag || JCS(entry fields))", () => {
    const { signature: _s, ...fields } = { ...storeEntry, signature: "x" };
    expect(entryHash(storeEntry)).toBe(sha256(utf8(CHAIN_TAG), utf8(jcs(fields))).toString("hex"));
  });

  it("state_hash is SHA-256(kind tag || nonce || JCS(fields))", () => {
    const { id: _i, retrieval_count: _r, last_accessed: _l, ...fields } = memoryVector.row;
    const expected = sha256(utf8(STATE_TAGS.memory), nonceOf(memoryVector.nonce), utf8(jcs(fields)));
    expect(stateHash("memory", nonceOf(memoryVector.nonce), memoryVector.row)).toBe(expected.toString("hex"));
  });

  it("rotation_statement_hash uses the rotate tag, not the chain tag", () => {
    const statement = vectors.rotation.statement;
    expect(rotationStatementHash(statement)).toBe(sha256(utf8(ROTATE_TAG), utf8(jcs(statement))).toString("hex"));
    expect(rotationStatementHash(statement)).not.toBe(sha256(utf8(CHAIN_TAG), utf8(jcs(statement))).toString("hex"));
  });

  it("the tags are distinct and NUL-terminated", () => {
    const tags = [CHAIN_TAG, ROTATE_TAG, MERKLE_TAG, STATE_TAGS.memory, STATE_TAGS.session];
    expect(new Set(tags).size).toBe(tags.length);
    for (const tag of tags) expect(tag.endsWith("\x00")).toBe(true);
  });
});

describe("field-mutation sensitivity over the fixed v1 field lists", () => {
  it.each([...MEMORY_STATE_FIELDS])("memory state changes when %s changes", (field) => {
    const base = stateHash("memory", nonceOf(memoryVector.nonce), memoryVector.row);
    const changed = { ...memoryVector.row, [field]: mutate(memoryVector.row[field]) };
    expect(stateHash("memory", nonceOf(memoryVector.nonce), changed)).not.toBe(base);
  });

  it.each([...SESSION_STATE_FIELDS])("session state changes when %s changes", (field) => {
    const base = stateHash("session", nonceOf(sessionVector.nonce), sessionVector.row);
    const changed = { ...sessionVector.row, [field]: mutate(sessionVector.row[field]) };
    expect(stateHash("session", nonceOf(sessionVector.nonce), changed)).not.toBe(base);
  });

  it("state changes when one nonce byte changes", () => {
    const nonce = nonceOf(memoryVector.nonce);
    const flipped = Buffer.from(nonce);
    flipped[31] ^= 0x01;
    expect(stateHash("memory", flipped, memoryVector.row)).not.toBe(stateHash("memory", nonce, memoryVector.row));
  });

  it("memory and session tags give different hashes for the same nonce", () => {
    const nonce = nonceOf(memoryVector.nonce);
    const shared = Object.fromEntries(SESSION_STATE_FIELDS.map((f) => [f, null]));
    const sessionHash = stateHash("session", nonce, shared);
    const plain = sha256(utf8(STATE_TAGS.memory), nonce, utf8(jcs(shared))).toString("hex");
    expect(sessionHash).not.toBe(plain);
  });

  it.each([...ENTRY_FIELDS])("entry_hash changes when %s changes", (field) => {
    const changed = { ...storeEntry, [field]: mutate(storeEntry[field]) };
    expect(entryHash(changed)).not.toBe(entryHash(storeEntry));
  });

  it.each([...ROTATION_STATEMENT_FIELDS])("rotation_statement_hash changes when %s changes", (field) => {
    const statement = vectors.rotation.statement;
    const changed = { ...statement, [field]: mutate(statement[field]) };
    expect(rotationStatementHash(changed)).not.toBe(rotationStatementHash(statement));
  });
});

describe("excluded fields do not move the hash", () => {
  it("memory retrieval_count, last_accessed and id are operational or bound elsewhere", () => {
    const base = stateHash("memory", nonceOf(memoryVector.nonce), memoryVector.row);
    for (const [field, value] of [
      ["retrieval_count", 999],
      ["last_accessed", "2030-01-01 00:00:00"],
      ["id", "another-id"],
    ] as const) {
      const changed = { ...memoryVector.row, [field]: value };
      expect(stateHash("memory", nonceOf(memoryVector.nonce), changed)).toBe(base);
    }
  });

  it("changing the outer signature does NOT change entry_hash", () => {
    const signedA = { ...storeEntry, signature: "aa".repeat(64) };
    const signedB = { ...storeEntry, signature: "bb".repeat(64) };
    expect(entryHash(signedA)).toBe(entryHash(storeEntry));
    expect(entryHash(signedB)).toBe(entryHash(signedA));
  });

  it("a stored entry_hash value does not feed back into entry_hash", () => {
    expect(entryHash({ ...storeEntry, entry_hash: "ff".repeat(32) })).toBe(entryHash(storeEntry));
  });
});

describe("rotation inner signatures", () => {
  const statement = vectors.rotation.statement;
  const payload = vectors.rotation.payload;

  it.each(["old_signature", "new_signature"])(
    "changing %s changes the final entry_hash but NOT rotation_statement_hash",
    (field) => {
      const changedPayload = { ...payload, [field]: mutate(payload[field]) };

      // The statement both keys sign omits the inner signatures, so it cannot move.
      const withOld = { ...statement, old_signature: payload.old_signature, new_signature: payload.new_signature };
      const withNew = {
        ...statement,
        old_signature: changedPayload.old_signature,
        new_signature: changedPayload.new_signature,
      };
      expect(rotationStatementHash(withNew)).toBe(rotationStatementHash(withOld));
      expect(rotationStatementHash(withNew)).toBe(rotationStatementHash(statement));

      // The complete meta_payload carries them, so the final entry_hash must move.
      const newText = rotationMetaPayload(changedPayload);
      expect(newText).not.toBe(rotationMetaPayload(payload));
      expect(entryHash({ ...rotateEntry, meta_payload: newText })).not.toBe(entryHash(rotateEntry));
    },
  );

  it("the vector rotate entry carries the payload text built from the vector payload", () => {
    expect(rotateEntry.meta_payload).toBe(rotationMetaPayload(payload));
  });
});

describe("values are hashed as stored (no NFC normalization)", () => {
  const nfc = vectors.states.find((v) => v.name === "memory NFC e-acute")!;
  const nfd = vectors.states.find((v) => v.name === "memory NFD e + combining acute")!;

  it("NFC and NFD forms of the same text hash differently", () => {
    expect(nfd.row.content).not.toBe(nfc.row.content);
    expect((nfd.row.content as string).normalize("NFC")).toBe(nfc.row.content);
    expect(stateHash("memory", nonceOf(nfd.nonce), nfd.row)).not.toBe(stateHash("memory", nonceOf(nfc.nonce), nfc.row));
  });

  it("non-NFC text is hashed byte for byte as stored", () => {
    const fields = { ...nfd.row };
    delete fields.id;
    delete fields.retrieval_count;
    delete fields.last_accessed;
    const expected = sha256(utf8(STATE_TAGS.memory), nonceOf(nfd.nonce), utf8(jcs(fields))).toString("hex");
    expect(stateHash("memory", nonceOf(nfd.nonce), nfd.row)).toBe(expected);
    expect(utf8(jcs(fields)).includes(Buffer.from([0x65, 0xcc, 0x81]))).toBe(true);
  });
});

describe("strict inputs", () => {
  const nonce = nonceOf(memoryVector.nonce);

  it("rejects an unexpected field rather than ignoring it", () => {
    expect(() => stateHash("memory", nonce, { ...memoryVector.row, mood: "x" })).toThrow(/unexpected field mood/);
    expect(() => entryHash({ ...storeEntry, extra: 1 })).toThrow(/unexpected field extra/);
    expect(() => rotationMetaPayload({ ...vectors.rotation.payload, seq: 1 })).toThrow(/unexpected field seq/);
  });

  it("rejects a missing or undefined field", () => {
    const { content: _c, ...missing } = memoryVector.row;
    expect(() => stateHash("memory", nonce, missing)).toThrow(/missing field content/);
    expect(() => entryHash({ ...storeEntry, prev_hash: undefined as unknown as null })).toThrow(/missing field prev_hash/);
  });

  it("rejects booleans, floats and unsafe integers", () => {
    expect(() => stateHash("memory", nonce, { ...memoryVector.row, authorization_verified: true as unknown as number })).toThrow();
    expect(() => stateHash("memory", nonce, { ...memoryVector.row, importance: 5.5 })).toThrow();
    expect(() => entryHash({ ...storeEntry, seq: 2 ** 53 })).toThrow();
    expect(() => entryHash({ ...storeEntry, seq: 2n as unknown as number })).toThrow();
  });

  it("rejects a nonce that is not 32 bytes", () => {
    expect(() => stateHash("memory", Buffer.alloc(31), memoryVector.row)).toThrow(/32 bytes/);
    expect(() => stateHash("memory", Buffer.alloc(33), memoryVector.row)).toThrow(/32 bytes/);
  });

  it("rejects an unknown state kind", () => {
    expect(() => stateHash("journal" as StateKind, nonce, memoryVector.row)).toThrow(/unknown state kind/);
  });

  it("rejects a lone surrogate in a stored value", () => {
    expect(() => stateHash("memory", nonce, { ...memoryVector.row, content: "a\ud800" })).toThrow();
  });
});

describe("Merkle rules", () => {
  const leafHash = (l: MerkleLeaf) =>
    sha256(utf8(MERKLE_TAG), Buffer.from([0x00]), utf8(jcs([l.kind, l.target_id, l.state_hash])));
  const nodeHash = (a: Buffer, b: Buffer) => sha256(utf8(MERKLE_TAG), Buffer.from([0x01]), a, b);
  const leaf = (kind: StateKind, target_id: string, c: string): MerkleLeaf => ({
    kind,
    target_id,
    state_hash: c.repeat(64),
  });

  it("the empty root is SHA-256(tag || 0x02)", () => {
    expect(merkleRoot([])).toBe(sha256(utf8(MERKLE_TAG), Buffer.from([0x02])).toString("hex"));
  });

  it("a single leaf's root is its leaf hash", () => {
    const l = leaf("memory", "m-1", "a");
    expect(merkleRoot([l])).toBe(leafHash(l).toString("hex"));
  });

  it("three leaves split 2 + 1 (RFC 6962), never duplicating the last node", () => {
    const [a, b, c] = [leaf("memory", "a", "1"), leaf("memory", "b", "2"), leaf("memory", "c", "3")];
    const expected = nodeHash(nodeHash(leafHash(a), leafHash(b)), leafHash(c));
    expect(merkleRoot([c, a, b])).toBe(expected.toString("hex"));
    const duplicated = nodeHash(nodeHash(leafHash(a), leafHash(b)), nodeHash(leafHash(c), leafHash(c)));
    expect(merkleRoot([a, b, c])).not.toBe(duplicated.toString("hex"));
  });

  it("five leaves split 4 + 1", () => {
    const ls = ["a", "b", "c", "d", "e"].map((t, i) => leaf("memory", t, String(i)));
    const h = ls.map(leafHash);
    const expected = nodeHash(nodeHash(nodeHash(h[0], h[1]), nodeHash(h[2], h[3])), h[4]);
    expect(merkleRoot(ls)).toBe(expected.toString("hex"));
  });

  it("the root does not depend on input order", () => {
    const ls = vectors.merkle.find((v) => v.name === "7 leaves")!.leaves;
    expect(merkleRoot([...ls].reverse())).toBe(merkleRoot(ls));
  });

  it("orders by kind, then target_id, by UTF-8 bytes", () => {
    const sorted = sortMerkleLeaves([
      leaf("session", "a", "1"),
      leaf("memory", "m-1", "2"),
      leaf("memory", "M-0", "3"),
      leaf("memory", "\u{1F600}", "4"),
      leaf("memory", "דּ", "5"),
    ]);
    // U+FB33 (UTF-8 EF ...) precedes U+1F600 (UTF-8 F0 ...), the reverse of UTF-16 order.
    expect(sorted.map((l) => `${l.kind}:${l.target_id}`)).toEqual([
      "memory:M-0",
      "memory:m-1",
      "memory:דּ",
      "memory:\u{1F600}",
      "session:a",
    ]);
  });

  it("changing any leaf field changes the root", () => {
    const ls = vectors.merkle.find((v) => v.name === "5 leaves")!.leaves;
    const root = merkleRoot(ls);
    expect(merkleRoot([{ ...ls[0], state_hash: "f".repeat(64) }, ...ls.slice(1)])).not.toBe(root);
    expect(merkleRoot([{ ...ls[0], target_id: ls[0].target_id + "x" }, ...ls.slice(1)])).not.toBe(root);
    expect(merkleRoot([{ ...ls[0], kind: ls[0].kind === "memory" ? "session" : "memory" }, ...ls.slice(1)])).not.toBe(root);
  });

  it("rejects duplicates, unknown kinds, empty target ids and malformed state hashes", () => {
    expect(() => merkleRoot([leaf("memory", "a", "1"), leaf("memory", "a", "2")])).toThrow(/duplicate/);
    expect(() => merkleRoot([{ kind: "journal" as StateKind, target_id: "a", state_hash: "1".repeat(64) }])).toThrow(/unknown kind/);
    expect(() => merkleRoot([leaf("memory", "", "1")])).toThrow(/non-empty/);
    expect(() => merkleRoot([{ kind: "memory", target_id: "a", state_hash: "A".repeat(64) }])).toThrow(/64 lowercase hex/);
    expect(() => merkleRoot([{ kind: "memory", target_id: "a", state_hash: "1".repeat(63) }])).toThrow(/64 lowercase hex/);
  });
});
