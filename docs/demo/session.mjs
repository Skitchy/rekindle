#!/usr/bin/env node
// Scripted MCP tool handoff for the README demo. This is NOT a live model
// session: a small client drives the Rekindle server over stdio, the way an
// MCP host would, with fixed synthetic content.
//
// Run from a project where `rekindle init` has been run and both `rekindle`
// and `@modelcontextprotocol/sdk` are installed:
//
//   node session.mjs end    session 1: end_session stores a handoff
//   node session.mjs boot   session 2: a fresh server process, boot_report
//                           loads that handoff
//
// Each command exits non-zero if the server did not do what the demo claims.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const serverEntry = require.resolve("rekindle");

// Synthetic demo content. No real people, projects or paths.
const DEMO = {
  project: "breeze",
  checkpoint: "Finished the forecast parser; the cache layer is next.",
  decision: "Cache forecasts per city, keyed by station id, because users rarely switch cities within an hour.",
  openLoop: "Decide whether the cache TTL is per city or global.",
  constraint: "Never call the paid weather API from tests.",
};

async function connect() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    cwd: process.cwd(),
    env: { ...process.env },
    stderr: "ignore",
  });
  const client = new Client({ name: "rekindle-demo", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

function text(result) {
  const first = result.content?.find((c) => c.type === "text");
  if (!first) throw new Error("tool returned no text content");
  return first.text;
}

function fail(message) {
  console.log(`FAIL: ${message}`);
  process.exit(1);
}

async function end() {
  console.log("Session 1: end_session");
  console.log(`  checkpoint  ${DEMO.checkpoint}`);
  console.log(`  decision    ${DEMO.decision}`);
  console.log(`  open loop   ${DEMO.openLoop}`);
  console.log(`  constraint  ${DEMO.constraint}`);
  console.log("");

  const client = await connect();
  const result = await client.callTool({
    name: "end_session",
    arguments: {
      checkpoint: DEMO.checkpoint,
      decisions: [DEMO.decision],
      open_loops: [DEMO.openLoop],
      constraints: [DEMO.constraint],
      project: DEMO.project,
    },
  });
  await client.close();

  const payload = JSON.parse(text(result));
  const stored = payload.stored ?? {};
  for (const type of ["checkpoint", "decision", "open_loop", "constraint"]) {
    if (!(stored[type] >= 1)) fail(`no ${type} record stored`);
  }
  console.log(`PASS: ${payload.stored_count} records stored for session ${payload.session_id}`);
  console.log("Session over. The server process exits; nothing stays in memory.");
}

async function boot() {
  console.log("Session 2: boot_report, from a new server process");
  console.log("");

  const client = await connect();
  const result = await client.callTool({
    name: "boot_report",
    arguments: {
      identity_path: ".rekindle/identity.md",
      transcript_dir: ".rekindle/transcripts",
      project: DEMO.project,
    },
  });
  await client.close();

  const report = text(result);
  console.log(report);
  console.log("");
  if (!report.includes(DEMO.checkpoint)) fail("the report does not contain session 1's checkpoint");
  if (!report.includes(DEMO.openLoop)) fail("the report does not contain session 1's open loop");
  console.log("PASS: the new session loaded session 1's checkpoint and open loop.");
}

const command = process.argv[2];
if (command === "end") await end();
else if (command === "boot") await boot();
else {
  console.log("usage: node session.mjs end | boot");
  process.exit(2);
}
