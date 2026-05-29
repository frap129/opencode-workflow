// tests/bootstrap.test.ts
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  mkdtemp,
  rm,
  mkdir,
  writeFile,
  readdir,
  readFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  checkBootstrapStatus,
  runBootstrap,
  forceBootstrap,
  formatPartialBootstrapError,
} from "../src/bootstrap";
import { AGENT_NAMES, AGENTS_DIR, PLANS_DIR } from "../src/constants";
import type { AgentName } from "../src/constants";
import { getAgentContent } from "../src/agents";

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "wf-bootstrap-"));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe("checkBootstrapStatus", () => {
  test("returns 'needs-bootstrap' when no agent files exist", async () => {
    const result = await checkBootstrapStatus(testDir);
    expect(result.status).toBe("needs-bootstrap");
  });

  test("returns 'ready' when all agent files exist", async () => {
    const agentsDir = join(testDir, AGENTS_DIR);
    await mkdir(agentsDir, { recursive: true });
    for (const name of AGENT_NAMES) {
      await writeFile(join(agentsDir, `${name}.md`), `# ${name}`);
    }
    const result = await checkBootstrapStatus(testDir);
    expect(result.status).toBe("ready");
  });

  test("returns 'partial' when some but not all agent files exist", async () => {
    const agentsDir = join(testDir, AGENTS_DIR);
    await mkdir(agentsDir, { recursive: true });
    // Create only the first 3 agents
    for (const name of AGENT_NAMES.slice(0, 3)) {
      await writeFile(join(agentsDir, `${name}.md`), `# ${name}`);
    }
    const result = await checkBootstrapStatus(testDir);
    expect(result.status).toBe("partial");
    expect(result.missing).toHaveLength(4);
  });
});

describe("runBootstrap", () => {
  test("creates all 7 agent files when none exist", async () => {
    await runBootstrap(testDir);

    const agentsDir = join(testDir, AGENTS_DIR);
    const files = await readdir(agentsDir);
    expect(files).toHaveLength(7);
    for (const name of AGENT_NAMES) {
      const content = await readFile(join(agentsDir, `${name}.md`), "utf-8");
      expect(content.length).toBeGreaterThan(0);
    }
  });

  test("creates .opencode/plans/ directory", async () => {
    await runBootstrap(testDir);

    const plansDir = join(testDir, PLANS_DIR);
    const entries = await readdir(plansDir);
    expect(entries).toBeDefined();
  });

  test("creates .opencode/agents/ directory if missing", async () => {
    await runBootstrap(testDir);

    const agentsDir = join(testDir, AGENTS_DIR);
    const entries = await readdir(agentsDir);
    expect(entries).toHaveLength(7);
  });

  test("status is 'ready' when all files already exist (bootstrap not called)", async () => {
    const agentsDir = join(testDir, AGENTS_DIR);
    await mkdir(agentsDir, { recursive: true });
    for (const name of AGENT_NAMES) {
      await writeFile(join(agentsDir, `${name}.md`), "user-edited content");
    }

    const status = await checkBootstrapStatus(testDir);
    expect(status.status).toBe("ready");
  });

  test("cleans up on partial write failure (no partial files left)", async () => {
    // Inject a failing content generator to simulate mid-bootstrap failure
    const agentsDir = join(testDir, AGENTS_DIR);
    let callCount = 0;
    const failingGenerator = (name: string): string => {
      callCount++;
      if (callCount > 3) throw new Error("simulated write failure");
      return `---\nname: ${name}\n---\n# ${name}\n`;
    };

    await expect(runBootstrap(testDir, failingGenerator)).rejects.toThrow(
      "simulated write failure",
    );

    // Verify no agent files exist in target (all cleaned up)
    try {
      const files = await readdir(agentsDir);
      const workflowFiles = files.filter((f) => f.startsWith("workflow-"));
      expect(workflowFiles).toHaveLength(0);
    } catch {
      // Directory might not exist either — that's fine
    }

    // Verify no staging directory left behind
    const opencodeDir = join(testDir, ".opencode");
    try {
      const entries = await readdir(opencodeDir);
      expect(entries).not.toContain(".agents-staging");
    } catch {
      // .opencode dir might not exist — that's fine
    }

    // Status should still be needs-bootstrap
    const status = await checkBootstrapStatus(testDir);
    expect(status.status).toBe("needs-bootstrap");
  });

  test("refuses to run when status is not 'needs-bootstrap'", async () => {
    // Bootstrap once (succeeds)
    await runBootstrap(testDir);
    const status = await checkBootstrapStatus(testDir);
    expect(status.status).toBe("ready");

    // Attempting bootstrap again should throw
    await expect(runBootstrap(testDir)).rejects.toThrow("already bootstrapped");
  });

  test("no staging directory left behind after success", async () => {
    await runBootstrap(testDir);
    const opencodeDir = join(testDir, ".opencode");
    const entries = await readdir(opencodeDir);
    expect(entries).not.toContain(".agents-staging");
  });
});

describe("formatPartialBootstrapError", () => {
  test("produces actionable error message listing missing files", () => {
    const msg = formatPartialBootstrapError(
      ["workflow-explore", "workflow-research"],
      [
        "workflow-brainstorm",
        "workflow-plan",
        "workflow-implement",
        "workflow-programmer",
        "workflow-reviewer",
      ],
    );
    expect(msg).toContain("partial agent installation detected");
    expect(msg).toContain("workflow-explore.md");
    expect(msg).toContain("workflow-research.md");
    expect(msg).toContain("5 of 7");
    expect(msg).toContain("workflow-init");
  });
});

describe("forceBootstrap", () => {
  test("writes all 7 agent files from scratch", async () => {
    await forceBootstrap(testDir);
    const agentsDir = join(testDir, AGENTS_DIR);
    const files = await readdir(agentsDir);
    expect(files).toHaveLength(7);
    for (const name of AGENT_NAMES) {
      const content = await readFile(join(agentsDir, `${name}.md`), "utf-8");
      expect(content).toBe(getAgentContent(name));
    }
  });

  test("overwrites existing agent files", async () => {
    const agentsDir = join(testDir, AGENTS_DIR);
    await mkdir(agentsDir, { recursive: true });
    await writeFile(
      join(agentsDir, "workflow-brainstorm.md"),
      "old content",
      "utf-8",
    );

    await forceBootstrap(testDir);

    const content = await readFile(
      join(agentsDir, "workflow-brainstorm.md"),
      "utf-8",
    );
    expect(content).toBe(getAgentContent("workflow-brainstorm"));
    expect(content).not.toBe("old content");
  });

  test("creates plans directory", async () => {
    await forceBootstrap(testDir);
    const plansDir = join(testDir, PLANS_DIR);
    const stat = await readdir(plansDir);
    expect(stat).toBeDefined();
  });
});

describe("getAgentContent", () => {
  test("all 7 agents return non-empty content", () => {
    for (const name of AGENT_NAMES) {
      const content = getAgentContent(name);
      expect(content.length).toBeGreaterThan(50);
    }
  });

  test("each agent content includes the agent name in frontmatter", () => {
    for (const name of AGENT_NAMES) {
      const content = getAgentContent(name);
      expect(content).toContain(`name: ${name}`);
    }
  });

  test("each agent content starts with valid frontmatter", () => {
    for (const name of AGENT_NAMES) {
      const content = getAgentContent(name);
      expect(content.startsWith("---\n")).toBe(true);
      const parts = content.split("---");
      expect(parts.length).toBeGreaterThanOrEqual(3);
    }
  });

  test("all agents deny the task tool", () => {
    const orchestrators: AgentName[] = [
      "workflow-brainstorm",
      "workflow-plan",
      "workflow-implement",
    ];
    for (const name of orchestrators) {
      const content = getAgentContent(name);
      expect(content).toContain("task: deny");
    }
  });

  test("orchestrator agents deny built-in navigation and meta tools", () => {
    const orchestrators: AgentName[] = [
      "workflow-brainstorm",
      "workflow-plan",
      "workflow-implement",
    ];
    for (const name of orchestrators) {
      const content = getAgentContent(name);
      expect(content).toContain("read: deny");
      expect(content).toContain("glob: deny");
      expect(content).toContain("grep: deny");
      expect(content).toContain("lsp: deny");
      expect(content).toContain("webfetch: deny");
      expect(content).toContain("websearch: deny");
      expect(content).toContain("mcp_*: deny");
    }
  });

  test("subagents do not deny navigation tools", () => {
    const subagents: AgentName[] = [
      "workflow-explore",
      "workflow-research",
      "workflow-programmer",
      "workflow-reviewer",
    ];
    for (const name of subagents) {
      const content = getAgentContent(name);
      expect(content).not.toContain("read: deny");
      expect(content).not.toContain("glob: deny");
      expect(content).not.toContain("grep: deny");
      expect(content).not.toContain("lsp: deny");
    }
  });

  test("orchestrator agents are mode: primary", () => {
    const orchestrators: AgentName[] = [
      "workflow-brainstorm",
      "workflow-plan",
      "workflow-implement",
    ];
    for (const name of orchestrators) {
      const content = getAgentContent(name);
      expect(content).toContain("mode: primary");
    }
  });

  test("subagents are mode: subagent", () => {
    const subagents: AgentName[] = [
      "workflow-explore",
      "workflow-research",
      "workflow-programmer",
      "workflow-reviewer",
    ];
    for (const name of subagents) {
      const content = getAgentContent(name);
      expect(content).toContain("mode: subagent");
    }
  });

  test("brainstorm agent references its available tools", () => {
    const content = getAgentContent("workflow-brainstorm");
    expect(content).toContain("explore");
    expect(content).toContain("research");
    expect(content).toContain("write_spec");
    expect(content).toContain("review_spec");
    expect(content).toContain("read_spec");
    // Should instruct not to write code
    expect(content).toMatch(
      /do not.*(?:write|edit|create).*(?:code|implementation)/i,
    );
  });

  test("plan agent references its available tools", () => {
    const content = getAgentContent("workflow-plan");
    expect(content).toContain("read_spec");
    expect(content).toContain("write_plan");
    expect(content).toContain("review_plan");
    expect(content).toContain("read_plan");
    // Should instruct not to write code
    expect(content).toMatch(
      /do not.*(?:write|edit|create).*(?:code|implementation)/i,
    );
  });

  test("implement agent references its available tools", () => {
    const content = getAgentContent("workflow-implement");
    expect(content).toContain("programmer");
    expect(content).toContain("read_plan");
    expect(content).toContain("explore");
    expect(content).toContain("research");
  });

  test("explore subagent is read-only and non-mutating", () => {
    const content = getAgentContent("workflow-explore");
    expect(content).toMatch(/read.only/i);
    expect(content).toMatch(/do not.*(?:edit|create|delete)/i);
  });

  test("research subagent is non-mutating", () => {
    const content = getAgentContent("workflow-research");
    expect(content).toMatch(/research|gather|context/i);
    expect(content).toMatch(/do not.*(?:edit|modify|create|delete)/i);
    // Must not have implementation-oriented instructions
    expect(content).not.toMatch(/implement.*code/i);
  });

  test("programmer subagent allows implementation", () => {
    const content = getAgentContent("workflow-programmer");
    expect(content).toMatch(/implement|code|edit/i);
    // Should reference testing
    expect(content).toMatch(/test/i);
  });

  test("reviewer subagent is read-only and review-oriented", () => {
    const content = getAgentContent("workflow-reviewer");
    expect(content).toMatch(/review|critique|feedback/i);
    expect(content).toContain("read_spec");
    expect(content).toContain("read_plan");
    expect(content).toMatch(/do not.*(?:edit|create|write)/i);
  });
});
