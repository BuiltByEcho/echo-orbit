export async function polishAnalysis(scan, analysis, options = {}) {
  const mode = options.aiMode ?? "off";
  if (mode === "off") {
    return { analysis, warnings: [] };
  }

  const payload = compactPayload(scan, analysis);
  const result = mode === "local"
    ? await callLocalModel(payload)
    : await callByoModel(payload);

  if (!result.ok) {
    return {
      analysis,
      warnings: [`AI polish skipped: ${result.error}`],
    };
  }

  return {
    analysis: applyPolish(analysis, result.value),
    warnings: [],
  };
}

function compactPayload(scan, analysis) {
  return {
    project: scan.projectName,
    description: scan.packageJson?.description ?? "",
    actions: analysis.actions.map((action) => ({
      id: action.id,
      name: action.name,
      method: action.method,
      path: action.path,
      risk: action.risk,
      auth: action.auth,
      payment: action.payment,
      signing: action.signing,
      confirmation: action.confirmation,
      source: action.source,
    })),
    risks: analysis.risks,
  };
}

async function callLocalModel(payload) {
  const endpoint = process.env.ORBIT_LOCAL_AI_ENDPOINT ?? "http://127.0.0.1:11434/api/chat";
  const model = process.env.ORBIT_AI_MODEL ?? "llama3.1";
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        messages: buildMessages(payload),
        format: "json",
      }),
    });
    if (!response.ok) return { ok: false, error: `local model returned HTTP ${response.status}` };
    const data = await response.json();
    return parseModelJson(data.message?.content ?? data.response ?? "");
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function callByoModel(payload) {
  const endpoint = process.env.ORBIT_AI_ENDPOINT ?? "https://api.openai.com/v1/chat/completions";
  const apiKey = process.env.ORBIT_AI_API_KEY ?? process.env.OPENAI_API_KEY;
  const model = process.env.ORBIT_AI_MODEL ?? "gpt-4.1-mini";
  if (!apiKey) {
    return { ok: false, error: "set ORBIT_AI_API_KEY or OPENAI_API_KEY for --ai byo" };
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: buildMessages(payload),
        response_format: { type: "json_object" },
      }),
    });
    if (!response.ok) return { ok: false, error: `BYO model returned HTTP ${response.status}` };
    const data = await response.json();
    return parseModelJson(data.choices?.[0]?.message?.content ?? "");
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function buildMessages(payload) {
  return [
    {
      role: "system",
      content: [
        "You polish an agent-facing MCP action package.",
        "Return strict JSON only.",
        "Do not invent routes.",
        "Keep names short, concrete, and safe.",
      ].join(" "),
    },
    {
      role: "user",
      content: JSON.stringify({
        task: "Improve action names/descriptions and adjust risk/confirmation only when clearly justified.",
        schema: {
          actions: [
            {
              id: "string",
              name: "string",
              description: "string",
              risk: "read-only|write|wallet-signing|destructive|unknown",
              confirmation: true,
            },
          ],
          risks: ["string"],
        },
        package: payload,
      }),
    },
  ];
}

function parseModelJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, error: "model did not return valid JSON" };
  }
}

function applyPolish(analysis, polish) {
  if (!polish || !Array.isArray(polish.actions)) return analysis;
  const byId = new Map(polish.actions.map((action) => [action.id, action]));
  const actions = analysis.actions.map((action) => {
    const update = byId.get(action.id);
    if (!update) return action;
    return {
      ...action,
      name: cleanString(update.name) || action.name,
      description: cleanString(update.description) || action.description,
      risk: cleanRisk(update.risk) ?? action.risk,
      confirmation: typeof update.confirmation === "boolean" ? update.confirmation : action.confirmation,
    };
  });

  return {
    ...analysis,
    actions,
    risks: Array.isArray(polish.risks) ? polish.risks.filter((risk) => typeof risk === "string") : analysis.risks,
  };
}

function cleanString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length < 180 ? trimmed : null;
}

function cleanRisk(value) {
  return ["read-only", "write", "wallet-signing", "destructive", "unknown"].includes(value) ? value : null;
}
