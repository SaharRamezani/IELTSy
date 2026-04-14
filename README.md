# IELTSy Writer — Firefox Extension

A Firefox extension that helps with IELTS writing by doing two things in any text field:

1. **Checks your grammar** — underlines mistakes in red, with a fix on click (powered by [LanguageTool](https://languagetool.org/)).
2. **Upgrades simple A1–B2 words** — underlines them in purple and suggests C1–C2 alternatives (runs locally from a built-in dictionary).

## Screenshots

**Grammar fix** — "this" flagged for not starting with an uppercase letter:

![Grammar fix](pics/Screenshot%20from%202026-04-15%2001-00-08.png)

**Vocabulary upgrade** — "know" suggested as `comprehend / recognise / grasp`:

![Vocab upgrade](pics/Screenshot%20from%202026-04-15%2001-00-20.png)

**Spelling fix** — "goo" corrected to "good":

![Spelling fix](pics/Screenshot%20from%202026-04-15%2001-00-32.png)

**Missing verb** — "This a new test." suggests inserting "is":

![Missing verb](pics/Screenshot%20from%202026-04-15%2001-05-17.png)

## Install (temporary)

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…**
3. Pick [manifest.json](manifest.json)
4. Start typing in any text field. After ~800ms, mistakes get red wavy underlines and simple words get purple ones. Click an underline to see the suggestion — click a suggestion to apply it.

The toolbar icon has an on/off toggle.

## Project structure

```
IELTSy/
├── manifest.json            MV3 manifest
├── README.md
├── pics/                    screenshots used in this README
└── src/
    ├── background/
    │   └── background.js    proxies grammar checks to LanguageTool
    ├── content/
    │   ├── content.js       detects fields, draws underlines, panel logic
    │   ├── content.css      underline and panel styles
    │   └── dictionary.js    A1–B2 → C1–C2 word list (~280 entries)
    └── popup/
        ├── popup.html
        ├── popup.css
        └── popup.js         toolbar popup (enable toggle)
```

## Notes

- **Privacy:** vocabulary checks run locally. Grammar checks send your text to LanguageTool's public API — don't use on sensitive content.
- **Rate limit:** LanguageTool's free endpoint allows ~20 requests/min. Heavy writing may hit it; self-host LanguageTool and change `LT_ENDPOINT` in [src/background/background.js](src/background/background.js) if needed.
- **Adding words:** edit `DICT` in [src/content/dictionary.js](src/content/dictionary.js). Entries are `"simple": ["advanced1", "advanced2", "advanced3"]`.
