const LT_ENDPOINT = "https://api.languagetool.org/v2/check";

async function checkGrammar(text, language) {
  if (!text || !text.trim()) return { matches: [] };

  const body = new URLSearchParams();
  body.set("text", text);
  body.set("language", language || "en-US");
  body.set("level", "default");
  body.set("enabledOnly", "false");

  try {
    const res = await fetch(LT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });
    if (!res.ok) {
      console.warn("[IELTSy/bg] LT HTTP", res.status);
      return { error: `HTTP ${res.status}`, matches: [] };
    }
    const data = await res.json();
    const matches = (data.matches || []).map((m) => ({
      offset: m.offset,
      length: m.length,
      original: text.slice(m.offset, m.offset + m.length),
      message: m.message || "Grammar suggestion",
      shortMessage: m.shortMessage || "",
      replacements: (m.replacements || []).slice(0, 6).map((r) => ({ value: r.value })),
      kind: "grammar"
    }));
    return { matches };
  } catch (e) {
    console.warn("[IELTSy/bg] LT fetch failed:", e);
    return { error: String(e), matches: [] };
  }
}

const api = typeof browser !== "undefined" ? browser : chrome;

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "CHECK_GRAMMAR") return false;
  checkGrammar(msg.text, msg.language).then(sendResponse);
  return true;
});

console.info("[IELTSy/bg] background loaded");
