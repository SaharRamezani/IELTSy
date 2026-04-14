const enabledEl = document.getElementById("enabled");

async function load() {
  const cfg = await browser.storage.local.get(["enabled"]);
  enabledEl.checked = cfg.enabled !== false;
}

enabledEl.addEventListener("change", () => {
  browser.storage.local.set({ enabled: enabledEl.checked });
});

load();
