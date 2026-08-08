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
  schema_version: 2;
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
  sections: SectionDisposition[];
  bypassed: boolean;
  bypass_reason: string | null;
  error: string | null;
}

export function writeReceipt(path: string, receipt: DeliveryReceipt): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(receipt)}\n`, "utf-8");
}
