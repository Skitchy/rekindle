import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { SectionDisposition } from "./budget.js";

/**
 * Delivery receipts state exactly what Rekindle DID, never what the host or
 * model did with it. `emitted` attests that bytes left this process on the
 * hook channel; `model_visible` is ALWAYS "unmeasured" here, because model
 * visibility is a measurement result (spike-style probe), not something an
 * emitter can know. Conflating the two is the failure CC-H-07 exposed.
 */
export interface DeliveryReceipt {
  schema_version: 3;
  channel: "session-start";
  client: string;
  session_source: string | null;
  session_id: string | null;
  agent_type: string | null;
  attempted_at: string;
  budget_bytes: number;
  emitted: boolean;
  emitted_bytes: number;
  model_visible: "unmeasured";
  resolved_project: string | null;
  project_resolution: string;
  project_override_registered: boolean | null;
  policy_version: number | null;
  policy_hash: string | null;
  source_record_ids: string[];
  sections: SectionDisposition[];
  bypassed: boolean;
  bypass_reason: string | null;
  error: string | null;
  /**
   * Present only when a user card is configured, so receipts for stores without
   * one are unchanged. Says which setting won and what happened to the card;
   * never the path or the text.
   */
  user_card?: {
    source: "REKINDLE_USER_CARD" | "policy";
    status: "included" | "dropped" | "empty" | "missing" | "unreadable";
  };
}

export function writeReceipt(path: string, receipt: DeliveryReceipt): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(receipt)}\n`, "utf-8");
}
