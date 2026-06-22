export function analyzeProject(scan) {
  const actions = inferActions(scan);
  const risks = inferRisks(scan, actions);
  const scorecard = buildScorecard(scan, actions, risks);

  return {
    actions,
    risks,
    scorecard,
  };
}

function inferActions(scan) {
  const actions = [];
  for (const route of scan.routes) {
    if (route.method === "GET" && route.path === "/health") continue;
    const risk = classifyRisk(route);
    actions.push({
      id: actionId(route),
      name: actionName(route),
      method: route.method,
      path: route.path,
      source: route.source,
      risk,
      payment: /quote|payment|paid|x402/i.test(route.path) || scan.summary.hasPaymentHints ? "possible" : "none",
      signing: /swap|borrow|supply|trade|wallet|transfer|sign|approve/i.test(route.path),
      auth: inferAuth(route, risk),
      confirmation: needsConfirmation(risk),
    });
  }

  if (!actions.length) {
    actions.push({
      id: "manual_action_review_needed",
      name: "Manual action review needed",
      method: "MANUAL",
      path: "n/a",
      source: "No HTTP routes detected from sampled files",
      risk: "unknown",
      payment: scan.summary.hasPaymentHints ? "possible" : "unknown",
      signing: scan.summary.hasWalletHints,
      auth: "unknown",
      confirmation: true,
    });
  }

  return actions;
}

function inferRisks(scan, actions) {
  const risks = [];
  if (!scan.summary.hasReadme) {
    risks.push("No README found. Agents need human-readable context and examples.");
  }
  if (!scan.summary.hasMcpHints) {
    risks.push("No MCP-specific docs or manifests detected.");
  }
  if (!scan.summary.hasSkillFile) {
    risks.push("No SKILL.md detected. Agents may lack a compact capability brief.");
  }
  if (!scan.summary.hasAgentActionsFile) {
    risks.push("No AGENT_ACTIONS.md detected. Action inventory is not explicitly packaged for agents.");
  }
  if (!actions.some((action) => action.risk === "read-only")) {
    risks.push("No clearly read-only action detected. Agents need a safe entry point.");
  }
  if (actions.some((action) => action.risk === "destructive") && !/approval|limit|guard/i.test(scan.readme ?? "")) {
    risks.push("Write/destructive actions appear present without obvious approval/guardrail docs.");
  }
  if (scan.summary.hasWalletHints && !/base|wallet|onchain/i.test(scan.readme ?? "")) {
    risks.push("Wallet/onchain behavior detected, but README does not clearly explain it.");
  }
  return risks;
}

function buildScorecard(scan, actions, risks) {
  const checks = [
    {
      key: "docs",
      ok: scan.summary.hasReadme,
      reason: scan.summary.hasReadme ? "README present" : "README missing",
    },
    {
      key: "agent_actions",
      ok: actions.length > 0,
      reason: actions.length > 0 ? `${actions.length} candidate actions found` : "No actions found",
    },
    {
      key: "read_only_entry",
      ok: actions.some((action) => action.risk === "read-only"),
      reason: actions.some((action) => action.risk === "read-only") ? "Read-only action detected" : "No obvious read-only action detected",
    },
    {
      key: "mcp_context",
      ok: scan.summary.hasMcpHints,
      reason: scan.summary.hasMcpHints ? "MCP hints present" : "No MCP hints detected",
    },
    {
      key: "skill_file",
      ok: scan.summary.hasSkillFile,
      reason: scan.summary.hasSkillFile ? "SKILL.md present" : "SKILL.md missing",
    },
    {
      key: "agent_actions_file",
      ok: scan.summary.hasAgentActionsFile,
      reason: scan.summary.hasAgentActionsFile ? "AGENT_ACTIONS.md present" : "AGENT_ACTIONS.md missing",
    },
    {
      key: "payment_context",
      ok: scan.summary.hasPaymentHints,
      reason: scan.summary.hasPaymentHints ? "Payment/x402 hints present" : "No payment hints detected",
    },
  ];

  const passed = checks.filter((check) => check.ok).length;
  const score = Math.round((passed / checks.length) * 100);

  return {
    score,
    status: score >= 80 ? "ready-ish" : score >= 50 ? "partial" : "early",
    checks,
    riskCount: risks.length,
  };
}

function classifyRisk(route) {
  if (route.method === "GET") return "read-only";
  if (route.method === "DELETE") return "destructive";
  if (/delete|revoke|remove|burn|withdraw|transfer/i.test(route.path)) return "destructive";
  if (/swap|trade|borrow|supply|send|pay|approve|sign/i.test(route.path)) return "wallet-signing";
  if (route.method === "POST" || route.method === "PUT" || route.method === "PATCH") return "write";
  return "unknown";
}

function inferAuth(route, risk) {
  if (route.path === "/health") return "none";
  if (/quote|public|status|health/i.test(route.path) && route.method === "GET") return "none-or-api-key";
  if (risk === "read-only") return "api-key-optional";
  return "api-key-or-human-owned-session";
}

function needsConfirmation(risk) {
  return risk === "wallet-signing" || risk === "destructive" || risk === "unknown";
}

function actionId(route) {
  return `${route.method}_${route.path}`
    .toLowerCase()
    .replace(/[:{}]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function actionName(route) {
  const words = route.path
    .replace(/[/:{}_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return `${route.method} route`;
  const label = words.map(capitalize).join(" ");
  return `${route.method} ${label}`;
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
