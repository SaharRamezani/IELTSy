(() => {
  const api = typeof browser !== "undefined" ? browser : (typeof chrome !== "undefined" ? chrome : null);
  console.info("[IELTSy] content.js loaded on", location.href);
  if (typeof IELTSY_WORDS === "undefined") {
    console.error("[IELTSy] IELTSY_WORDS is not defined — words.js did not load before content.js");
    return;
  }
  console.info("[IELTSy] dictionary ready, entries:", IELTSY_WORDS.size);

  // Clear any stale overlays left over from a previous content-script instance
  // (e.g., after reloading the temporary add-on without reloading the page).
  try {
    document
      .querySelectorAll(".ielsy-mirror, .ielsy-ce-overlay, .ielsy-panel, .ielsy-load-banner")
      .forEach((n) => n.remove());
  } catch (e) {}

  const VOCAB_DEBOUNCE_MS = 120;
  const GRAMMAR_DEBOUNCE_MS = 900;
  const MIN_LENGTH = 3;
  const GRAMMAR_LANG = "en-US";
  const state = {
    enabled: true,
    vocabTimers: new WeakMap(),
    grammarTimers: new WeakMap(),
    overlays: new WeakMap(),
    vocabCache: new WeakMap(),   // { text, matches }
    grammarCache: new WeakMap(), // { text, matches }
    inflightGrammar: new WeakMap(),
    lastFingerprint: new WeakMap()
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

  function disableNativeSpellcheck(el) {
    try {
      if (el.spellcheck !== false) el.spellcheck = false;
      if (el.getAttribute && el.getAttribute("spellcheck") !== "false") {
        el.setAttribute("spellcheck", "false");
      }
    } catch (e) {}
  }

  function scheduleCheck(el) {
    if (!state.enabled) return;
    disableNativeSpellcheck(el);
    clearTimeout(state.vocabTimers.get(el));
    clearTimeout(state.grammarTimers.get(el));
    const vId = setTimeout(() => runVocabCheck(el), VOCAB_DEBOUNCE_MS);
    state.vocabTimers.set(el, vId);
    const gId = setTimeout(() => runGrammarCheck(el), GRAMMAR_DEBOUNCE_MS);
    state.grammarTimers.set(el, gId);
  }

  function runVocabCheck(el) {
    try {
      const text = getText(el);
      if (!text || text.length < MIN_LENGTH) {
        state.vocabCache.delete(el);
        state.grammarCache.delete(el);
        removeOverlay(el);
        state.lastFingerprint.delete(el);
        return;
      }
      const cached = state.vocabCache.get(el);
      if (!cached || cached.text !== text) {
        const matches = IELTSY_WORDS.scan(text).map((m) => ({ ...m, kind: "vocab" }));
        state.vocabCache.set(el, { text, matches });
      }
      renderCombined(el, text);
    } catch (e) {
      console.error("[IELTSy] runVocabCheck error:", e);
    }
  }

  async function runGrammarCheck(el) {
    try {
      const text = getText(el);
      if (!text || text.length < MIN_LENGTH) return;
      const cached = state.grammarCache.get(el);
      if (cached && cached.text === text) {
        renderCombined(el, text);
        return;
      }
      if (!api || !api.runtime || !api.runtime.sendMessage) return;
      if (state.inflightGrammar.get(el) === text) return;
      state.inflightGrammar.set(el, text);
      let grammarMatches = [];
      try {
        const resp = await api.runtime.sendMessage({
          type: "CHECK_GRAMMAR",
          text,
          language: GRAMMAR_LANG
        });
        if (resp && Array.isArray(resp.matches)) grammarMatches = resp.matches;
        else if (resp && resp.error) console.warn("[IELTSy] grammar error:", resp.error);
      } catch (e) {
        console.warn("[IELTSy] grammar check failed:", e);
      }
      if (state.inflightGrammar.get(el) === text) state.inflightGrammar.delete(el);
      state.grammarCache.set(el, { text, matches: grammarMatches });
      if (getText(el) !== text) return;
      renderCombined(el, text);
    } catch (e) {
      console.error("[IELTSy] runGrammarCheck error:", e);
    }
  }

  function renderCombined(el, text) {
    const v = state.vocabCache.get(el);
    const g = state.grammarCache.get(el);
    const vocabMatches = v && v.text === text ? v.matches : [];
    const grammarMatches = g && g.text === text ? g.matches : [];
    const allMatches = [...grammarMatches, ...vocabMatches];
    const fp = fingerprint(text, allMatches);
    if (state.lastFingerprint.get(el) === fp) return;
    state.lastFingerprint.set(el, fp);
    renderMatches(el, text, allMatches);
  }

  function fingerprint(text, matches) {
    const parts = matches
      .map((m) => `${m.kind}:${m.offset}:${m.length}`)
      .sort()
      .join("|");
    return `${text.length}#${parts}`;
  }

  function removeOverlay(el) {
    const ov = state.overlays.get(el);
    if (ov) {
      if (ov.onScroll) {
        try { el.removeEventListener("scroll", ov.onScroll); } catch (e) {}
      }
      if (ov.root && ov.root.parentNode) ov.root.parentNode.removeChild(ov.root);
      state.overlays.delete(el);
    }
    state.lastFingerprint.delete(el);
    // Defensive: also remove any stray overlays in the DOM that target this
    // element but are no longer referenced by state.overlays, and sweep any
    // whose target element has been detached from the DOM.
    document.querySelectorAll(".ielsy-mirror, .ielsy-ce-overlay").forEach((n) => {
      const target = n._ielsyTarget;
      if (target === el) {
        n.remove();
      } else if (target && !target.isConnected) {
        n.remove();
      }
    });
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
    mirror._ielsyTarget = el;
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
      const kindClass = m.kind === "grammar" ? "ielsy-hl-grammar" : "ielsy-hl-vocab";
      html += `<span class="ielsy-hl ${kindClass}" data-offset="${m.offset}" data-length="${m.length}">${escapeHtml(m.original)}</span>`;
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
    overlay._ielsyTarget = el;
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
        u.className = "ielsy-underline " + (m.kind === "grammar" ? "ielsy-underline-grammar" : "ielsy-underline-vocab");
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
    if (match.kind === "grammar") header.classList.add("ielsy-header-grammar");
    header.textContent = match.original;
    panel.appendChild(header);

    const sub = document.createElement("div");
    sub.className = "ielsy-sub";
    sub.textContent = match.kind === "grammar"
      ? (match.message || "Grammar suggestion")
      : "Upgrade to a C1–C2 alternative:";
    panel.appendChild(sub);

    if (match.kind === "grammar" && (!match.replacements || !match.replacements.length)) {
      const none = document.createElement("div");
      none.className = "ielsy-none";
      none.textContent = "No automatic fix — edit manually.";
      panel.appendChild(none);
    }

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
