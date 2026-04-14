(() => {
  const api = typeof browser !== "undefined" ? browser : (typeof chrome !== "undefined" ? chrome : null);
  console.info("[IELTSy] content.js loaded on", location.href);
  if (typeof IELTSY_WORDS === "undefined") {
    console.error("[IELTSy] IELTSY_WORDS is not defined — words.js did not load before content.js");
    return;
  }
  console.info("[IELTSy] dictionary ready, entries:", IELTSY_WORDS.size);

  const DEBOUNCE_MS = 400;
  const MIN_LENGTH = 3;
  const state = {
    enabled: true,
    timers: new WeakMap(),
    overlays: new WeakMap(),
    lastText: new WeakMap()
  };

  if (api && api.storage && api.storage.local) {
    try {
      api.storage.local.get(["enabled"]).then((cfg) => {
        if (cfg && cfg.enabled !== undefined) state.enabled = cfg.enabled;
      }, (err) => console.warn("[IELTSy] storage.get failed:", err));
    } catch (e) {
      console.warn("[IELTSy] storage.get threw:", e);
    }
    try {
      api.storage.onChanged.addListener((changes) => {
        if (changes.enabled) {
          state.enabled = changes.enabled.newValue;
          if (!state.enabled) clearAllOverlays();
        }
      });
    } catch (e) {}
  }

  function showLoadBanner() {
    if (window.top !== window) return;
    try {
      const b = document.createElement("div");
      b.className = "ielsy-load-banner";
      b.textContent = `IELTSy active on ${location.hostname || "this page"}`;
      (document.body || document.documentElement).appendChild(b);
      setTimeout(() => b.remove(), 2500);
    } catch (e) {}
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", showLoadBanner, { once: true });
  } else {
    showLoadBanner();
  }

  function actualTarget(e) {
    if (typeof e.composedPath === "function") {
      const path = e.composedPath();
      if (path && path.length) return path[0];
    }
    return e.target;
  }

  function isEditable(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.tagName === "TEXTAREA") return true;
    if (el.tagName === "INPUT") {
      const t = (el.type || "text").toLowerCase();
      return ["text", "search", "email", "url", "tel", ""].includes(t);
    }
    if (el.isContentEditable) return true;
    return false;
  }

  function getText(el) {
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") return el.value;
    return el.textContent || "";
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function scheduleCheck(el) {
    if (!state.enabled) return;
    clearTimeout(state.timers.get(el));
    const id = setTimeout(() => runCheck(el), DEBOUNCE_MS);
    state.timers.set(el, id);
  }

  function runCheck(el) {
    try {
      const text = getText(el);
      if (!text || text.length < MIN_LENGTH) {
        removeOverlay(el);
        return;
      }
      const matches = IELTSY_WORDS.scan(text);
      console.debug("[IELTSy] scanned", text.length, "chars,", matches.length, "matches");
      renderMatches(el, text, matches);
    } catch (e) {
      console.error("[IELTSy] runCheck error:", e);
    }
  }

  function removeOverlay(el) {
    const ov = state.overlays.get(el);
    if (!ov) return;
    if (ov.onScroll) el.removeEventListener("scroll", ov.onScroll);
    if (ov.root && ov.root.parentNode) ov.root.parentNode.removeChild(ov.root);
    state.overlays.delete(el);
  }

  function clearAllOverlays() {
    document.querySelectorAll(".ielsy-mirror, .ielsy-ce-overlay, .ielsy-panel").forEach((n) => n.remove());
  }

  function renderMatches(el, text, matches) {
    removeOverlay(el);
    if (!matches.length) return;
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      renderMirror(el, text, matches);
    } else if (el.isContentEditable) {
      renderContentEditableUnderlines(el, matches);
    }
  }

  // ---------- Textarea / input: mirror div approach ----------

  const MIRROR_PROPS = [
    "direction", "fontFamily", "fontSize", "fontWeight", "fontStyle", "fontVariant",
    "fontStretch", "fontKerning", "lineHeight", "letterSpacing", "wordSpacing",
    "textAlign", "textIndent", "textTransform", "whiteSpace", "wordWrap",
    "overflowWrap", "tabSize",
    "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
    "borderTopStyle", "borderRightStyle", "borderBottomStyle", "borderLeftStyle",
    "boxSizing"
  ];

  function renderMirror(el, text, matches) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const cs = window.getComputedStyle(el);

    const mirror = document.createElement("div");
    mirror.className = "ielsy-mirror";
    for (const p of MIRROR_PROPS) {
      try { mirror.style[p] = cs[p]; } catch (e) {}
    }
    mirror.style.position = "fixed";
    mirror.style.left = r.left + "px";
    mirror.style.top = r.top + "px";
    mirror.style.width = r.width + "px";
    mirror.style.height = r.height + "px";
    mirror.style.overflow = "hidden";
    mirror.style.margin = "0";
    mirror.style.color = "transparent";
    mirror.style.backgroundColor = "transparent";
    mirror.style.borderColor = "transparent";
    mirror.style.pointerEvents = "none";
    mirror.style.zIndex = "2147483646";
    if (el.tagName === "INPUT") {
      mirror.style.whiteSpace = "pre";
      mirror.style.overflowWrap = "normal";
    } else {
      mirror.style.whiteSpace = "pre-wrap";
      mirror.style.overflowWrap = "break-word";
    }

    const inner = document.createElement("div");
    inner.className = "ielsy-mirror-inner";
    inner.style.transform = `translate(${-el.scrollLeft}px, ${-el.scrollTop}px)`;
    inner.style.willChange = "transform";

    const sorted = [...matches].sort((a, b) => a.offset - b.offset);
    const dedup = [];
    let lastEnd = 0;
    for (const m of sorted) {
      if (m.offset < lastEnd) continue;
      dedup.push(m);
      lastEnd = m.offset + m.length;
    }

    let html = "";
    let idx = 0;
    for (const m of dedup) {
      html += escapeHtml(text.slice(idx, m.offset));
      html += `<span class="ielsy-hl" data-offset="${m.offset}" data-length="${m.length}">${escapeHtml(m.original)}</span>`;
      idx = m.offset + m.length;
    }
    html += escapeHtml(text.slice(idx));
    // preserve trailing newline visually
    if (text.endsWith("\n")) html += " ";
    inner.innerHTML = html;

    mirror.appendChild(inner);
    document.body.appendChild(mirror);

    inner.querySelectorAll(".ielsy-hl").forEach((span) => {
      span.style.pointerEvents = "auto";
      span.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        e.preventDefault();
        const offset = Number(span.dataset.offset);
        const length = Number(span.dataset.length);
        const match = dedup.find((mm) => mm.offset === offset && mm.length === length);
        if (match) openMatchPanel(el, match, span.getBoundingClientRect());
      });
    });

    const onScroll = () => {
      inner.style.transform = `translate(${-el.scrollLeft}px, ${-el.scrollTop}px)`;
    };
    el.addEventListener("scroll", onScroll);

    state.overlays.set(el, { root: mirror, inner, matches: dedup, kind: "mirror", onScroll });
  }

  // ---------- contenteditable: Range-based underline divs ----------

  function renderContentEditableUnderlines(el, matches) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let total = 0;
    let node;
    while ((node = walker.nextNode())) {
      nodes.push({ node, start: total });
      total += node.nodeValue.length;
    }
    if (!nodes.length) return;

    const overlay = document.createElement("div");
    overlay.className = "ielsy-ce-overlay";
    overlay.style.position = "fixed";
    overlay.style.left = "0";
    overlay.style.top = "0";
    overlay.style.width = "0";
    overlay.style.height = "0";
    overlay.style.pointerEvents = "none";
    overlay.style.zIndex = "2147483646";

    const sorted = [...matches].sort((a, b) => a.offset - b.offset);
    const dedup = [];
    let lastEnd = 0;
    for (const m of sorted) {
      if (m.offset < lastEnd) continue;
      dedup.push(m);
      lastEnd = m.offset + m.length;
    }

    for (const m of dedup) {
      const range = rangeForOffsets(nodes, m.offset, m.offset + m.length);
      if (!range) continue;
      const rects = range.getClientRects();
      for (const rect of rects) {
        if (rect.width === 0 || rect.height === 0) continue;
        const u = document.createElement("div");
        u.className = "ielsy-underline";
        u.style.position = "fixed";
        u.style.left = rect.left + "px";
        u.style.top = (rect.bottom - 2) + "px";
        u.style.width = rect.width + "px";
        u.style.pointerEvents = "auto";
        u.addEventListener("mousedown", (e) => {
          e.stopPropagation();
          e.preventDefault();
          openMatchPanel(el, m, rect);
        });
        overlay.appendChild(u);
      }
    }

    document.body.appendChild(overlay);
    state.overlays.set(el, { root: overlay, matches: dedup, kind: "ce" });
  }

  function rangeForOffsets(nodes, start, end) {
    try {
      const range = document.createRange();
      let startSet = false;
      for (const n of nodes) {
        const nStart = n.start;
        const nEnd = n.start + n.node.nodeValue.length;
        if (!startSet && nStart <= start && start <= nEnd) {
          range.setStart(n.node, start - nStart);
          startSet = true;
        }
        if (startSet && nStart <= end && end <= nEnd) {
          range.setEnd(n.node, end - nStart);
          return range;
        }
      }
    } catch (e) {
      console.warn("[IELTSy] rangeForOffsets failed:", e);
    }
    return null;
  }

  // ---------- Panel ----------

  function openMatchPanel(el, match, rect) {
    document.querySelectorAll(".ielsy-panel").forEach((n) => n.remove());
    const panel = document.createElement("div");
    panel.className = "ielsy-panel";
    panel.style.position = "fixed";
    panel.style.zIndex = "2147483647";
    panel.style.left = Math.max(8, Math.min(window.innerWidth - 260, rect.left)) + "px";
    panel.style.top = (rect.bottom + 6) + "px";

    const header = document.createElement("div");
    header.className = "ielsy-panel-header";
    header.textContent = match.original;
    panel.appendChild(header);

    const sub = document.createElement("div");
    sub.className = "ielsy-sub";
    sub.textContent = "Upgrade to a C1–C2 alternative:";
    panel.appendChild(sub);

    const row = document.createElement("div");
    row.className = "ielsy-reps";
    match.replacements.forEach((rep) => {
      const b = document.createElement("button");
      b.className = "ielsy-rep";
      b.textContent = rep.value;
      b.addEventListener("click", () => {
        applySingleReplacement(el, match, rep.value);
        panel.remove();
        scheduleCheck(el);
      });
      row.appendChild(b);
    });
    panel.appendChild(row);

    const close = document.createElement("button");
    close.className = "ielsy-close";
    close.textContent = "Dismiss";
    close.addEventListener("click", () => panel.remove());
    panel.appendChild(close);

    document.body.appendChild(panel);

    const outside = (ev) => {
      if (!panel.contains(ev.target)) {
        panel.remove();
        document.removeEventListener("mousedown", outside, true);
      }
    };
    setTimeout(() => document.addEventListener("mousedown", outside, true), 0);
  }

  function applySingleReplacement(el, match, replacement) {
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      const before = el.value.slice(0, match.offset);
      const after = el.value.slice(match.offset + match.length);
      el.value = before + replacement + after;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.focus();
      try {
        const caret = match.offset + replacement.length;
        el.setSelectionRange(caret, caret);
      } catch (e) {}
    } else if (el.isContentEditable) {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const nodes = [];
      let total = 0;
      let node;
      while ((node = walker.nextNode())) {
        nodes.push({ node, start: total });
        total += node.nodeValue.length;
      }
      const range = rangeForOffsets(nodes, match.offset, match.offset + match.length);
      if (range) {
        range.deleteContents();
        range.insertNode(document.createTextNode(replacement));
        el.normalize();
        el.dispatchEvent(new InputEvent("input", { bubbles: true }));
      }
    }
  }

  // ---------- Events & lifecycle ----------

  function onInput(e) {
    const el = actualTarget(e);
    if (!isEditable(el)) return;
    scheduleCheck(el);
  }

  function onFocusIn(e) {
    const el = actualTarget(e);
    if (isEditable(el)) scheduleCheck(el);
  }

  function refreshVisibleOverlays() {
    document.querySelectorAll("textarea, input, [contenteditable='true'], [contenteditable='']").forEach((el) => {
      if (state.overlays.has(el)) scheduleCheck(el);
    });
  }

  let resizeTimer = null;
  function onScrollResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(refreshVisibleOverlays, 80);
  }

  document.addEventListener("input", onInput, true);
  document.addEventListener("focusin", onFocusIn, true);
  window.addEventListener("scroll", onScrollResize, true);
  window.addEventListener("resize", onScrollResize, true);

  function collectAllEditables(root, out) {
    try {
      const fields = root.querySelectorAll("textarea, input, [contenteditable='true'], [contenteditable='']");
      fields.forEach((el) => out.push(el));
      const all = root.querySelectorAll("*");
      for (const el of all) {
        if (el.shadowRoot) collectAllEditables(el.shadowRoot, out);
      }
    } catch (e) {}
  }

  function scanExistingFields() {
    const out = [];
    collectAllEditables(document, out);
    console.info("[IELTSy] initial scan found", out.length, "candidate fields (incl. shadow DOM)");
    out.forEach((el) => {
      if (isEditable(el) && getText(el) && getText(el).length >= MIN_LENGTH) {
        scheduleCheck(el);
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scanExistingFields, { once: true });
  } else {
    scanExistingFields();
  }
})();
