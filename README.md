# IELTSy Writer — Firefox Extension

A Firefox extension that scans any text field (`<textarea>`, text `<input>`, or `contenteditable`) for simple A1–B2 words and suggests C1–C2 replacements. Built for IELTS writing practice — turns "help" into `assist / aid / facilitate`, "big" into `substantial / considerable / enormous`, etc.

Runs entirely locally from a built-in dictionary — no network, no API, no data leaves your browser.

## Load it in Firefox (temporary install)

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…**
3. Pick [manifest.json](manifest.json)
4. Type in any text field. After ~400ms a purple badge appears in the bottom-right corner of the field showing how many A1–B2 words were found. Click it to see each word and its C1–C2 alternatives. Click a suggestion to replace all occurrences of that word in the field.

Toggle on/off from the toolbar popup.

## Files

- [manifest.json](manifest.json) — MV3 manifest
- [words.js](words.js) — the A1–B2 → C1–C2 dictionary and scanner
- [content.js](content.js) — detects fields, debounces input, renders badge + panel
- [content.css](content.css) — badge and panel styles
- [popup.html](popup.html) / [popup.js](popup.js) — toolbar popup (enable toggle)

## Extending the dictionary

Edit `DICT` in [words.js](words.js). Each entry is `"simple": ["advanced1", "advanced2", "advanced3"]`. The scanner is case-insensitive and preserves the original case (`Help` → `Assist`, `HELP` → `ASSIST`).

## Caveats

- **Context matters.** Words like `like`, `kind`, `hard`, `short` have multiple meanings; the panel warns you to check before replacing. The scanner doesn't do POS tagging.
- **Whole-word matches only** — `help` matches but `helpful` and `helping` do not. Adding inflected forms means expanding the dictionary or adding a lightweight stemmer.
- **No inflection-aware replacement.** Replacing `running` with `sprinting` isn't supported; only base-form entries in the dictionary.
