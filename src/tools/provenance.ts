import { z } from "zod";

export const writeProvenanceSchema = z.object({
  client: z.string().min(1).describe("Client performing the write, for attribution only."),
  thread_id: z.string().min(1).describe("Calling thread or session identifier."),
  request_id: z.string().min(1).describe("Unique caller request identifier."),
  author_identity: z.string().min(1).describe("Claimed writer identity; attribution, not authentication."),
  authorization_reference: z.string().min(1).describe("Caller-supplied authority reference. Stored as unverified and never treated as authorization."),
});
