import { describe, it, expect } from "vitest";
import { mcpInstructions } from "../scaffold.js";

const cfg = { mcpServers: { rekindle: { command: "npx", args: ["-y", "rekindle"] } } };

describe("mcpInstructions", () => {
  it("plain init (npm install) leads with the README's local-scope command", () => {
    const text = mcpInstructions("project", true, cfg).join("\n");
    expect(text).toContain("claude mcp add rekindle -- npx -y rekindle");
    expect(text).not.toContain("--scope user");
    expect(text).toContain("Or add it to ~/.claude.json by hand");
    expect(text).toContain('"rekindle"');
  });

  it("init --global (npm install) registers at user scope, matching where the hooks run", () => {
    const text = mcpInstructions("user", true, cfg).join("\n");
    expect(text).toContain("claude mcp add --scope user rekindle -- npx -y rekindle");
    expect(text).toContain("user scope, every project");
  });

  it("source install prints only the node JSON, since npx -y rekindle would fetch npm", () => {
    const text = mcpInstructions("user", false, { mcpServers: { rekindle: { command: "node", args: ["/build/index.js"] } } }).join("\n");
    expect(text).not.toContain("claude mcp add");
    expect(text).toContain("source install, points at this build");
    expect(text).toContain("/build/index.js");
  });
});
