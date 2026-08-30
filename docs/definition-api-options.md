# Definition API Options for Better Bee

Researched 2026-08-29. Claims marked **[probed]** were verified by live curl from this machine that day; **[official]** means read from the vendor's own docs/pricing page; **[unverified]** means secondary source or not independently confirmed.

Better Bee's constraints (recap): client-side Tampermonkey userscript; primary transport `GM_xmlhttpRequest` with `@connect` whitelist (CORS not required), plus a page-`fetch()` fallback for broken MV3 Chrome installs that **does** require `Access-Control-Allow-Origin: *` (or an origin-reflecting equivalent). ~20–50 common English words/day/user, prefetch concurrency 2. Keys must be BYO (stored in the user's own Tampermonkey storage); no shared secret possible. Wanted per word: 1–2 senses + POS, ideally phonetic + audio.

## Executive summary and recommendation

`api.dictionaryapi.dev` (the current keyless default) returned **HTTP 522 today** (~19.5 s to fail) **[probed]** and has a multi-year history of "server down" issues plus an explicit maintainer note that AWS costs make it hard to keep running. It should be demoted from default to last-resort fallback.

**Recommended free default chain:**

1. **Datamuse (`md=d`)** as the new keyless default. No key needed until 2027-01-01 (then a free key, 100k req/day) **[official]**. Plain-text Wiktionary/WordNet definitions with POS tags and usage labels preserved, IPA available via `&ipa=1`, CORS OK (reflects any Origin) **[probed]**. No audio. Trivial to parse.
2. **Wiktionary REST** (`en.wiktionary.org/api/rest_v1/page/definition/{word}`) as secondary. No key, `ACAO: *`, Wikimedia-grade uptime, structured JSON with POS and examples **[probed]** — but definitions are HTML fragments needing sanitizing, some senses arrive as empty strings (label-only templates render empty — observed on `iota`), and no phonetics/audio. RESTBase (which serves rest_v1) is formally deprecated with no announced sunset date for this endpoint **[official]**.
3. **dictionaryapi.dev** kept as tertiary/legacy fallback only (it does return phonetics + audio URLs when up, which the free chain otherwise lacks).
4. **Merriam-Webster Collegiate (BYO key)** stays as the premium override — best phonetics + audio, 1,000 queries/day free, non-commercial use OK **[official]**. Already integrated.

Optional second BYO-key choice worth adding someday: **Wordnik** (free 100 calls/hr key; `ACAO: *` **[probed]**). Oxford, Collins, Lexicala, WordsAPI are poor fits (pricing, access model, or RapidAPI-bound keys). Note: contrary to prior belief, **Oxford's API did not stay closed — it relaunched self-serve plans on 2025-01-09**, but from £50/month billed annually, so still not BYO-casual-user material.

Implementation notes: adopting the chain means adding `@connect api.datamuse.com` and `@connect en.wiktionary.org` to the userscript header; both new sources satisfy the MV3 page-fetch CORS fallback.

---

## 1. Merriam-Webster (dictionaryapi.com) — current BYO-key option

- **Auth**: per-product API key, free registration; signup form offers two key requests per account, products include Collegiate and Learner's **[official: https://dictionaryapi.com/register/index]**.
- **Free tier**: "You are allowed 1,000 queries per API Key per day." Non-commercial apps free; commercial (ad-supported/revenue) or >1,000/day requires a licensing fee **[official: https://dictionaryapi.com/info/frequently-asked-questions]**.
- **Attribution**: "All applications using Merriam-Webster APIs must feature the Merriam-Webster logo." **[official: same FAQ]** — Better Bee currently does not display the logo; worth an audit.
- **CORS**: `Access-Control-Allow-Origin: *` on `dictionaryapi.com/api/v3/...` **[probed 2026-08-29]** — page-fetch fallback works.
- **Format fit**: excellent. Collegiate JSON gives `shortdef` senses, POS (`fl`), phonetics (`hwi.prs[].mw`), and audio filenames resolvable to `media.merriam-webster.com/audio/prons/en/us/mp3/{subdir}/{file}.mp3` — all already consumed by `better_bee.user.js` (lines ~970, 1055, 1076–1083).
- **ToS fit for BYO-key client-side**: good — each user registers their own free key; Better Bee is non-commercial.
- **Risk**: low. Established commercial API, no SLA published for the free tier.

## 2. Wiktionary / Wikimedia paths

### 2a. Wiktionary REST `page/definition` (recommended secondary)

- Endpoint: `https://en.wiktionary.org/api/rest_v1/page/definition/{term}`.
- **Status 2026-08-29**: HTTP 200, `content-type: ...profile="https://www.mediawiki.org/wiki/Specs/definition/0.8.1"`, `access-control-allow-origin: *` **[probed]**.
- **Auth / limits**: none required. Wikimedia etiquette: meaningful `User-Agent` "must" be sent, requests in series, no hard read limit, back off on `ratelimited` errors **[official: https://www.mediawiki.org/wiki/API:Etiquette]**. Note: `GM_xmlhttpRequest`/page fetch cannot set a custom User-Agent from a userscript — the browser UA is sent; that is normal for in-browser clients and consistent with etiquette intent, but worth noting.
- **Format**: JSON keyed by language → array of `{partOfSpeech, definitions:[{definition, examples}]}`. Definitions are **HTML fragments** (wiki links, `<b>`, label spans) that need tag-stripping. Observed quirk on `iota`: two senses arrived as `"definition": ""` because label-only templates render empty — client must filter empties **[probed]**. No phonetics, no audio.
- **Maintenance risk**: RESTBase, the service behind `/api/rest_v1/`, "is currently being deprecated" (decision dates to 2019; migration per-endpoint, no sunset date published for `page/definition`) **[official: https://www.mediawiki.org/wiki/RESTBase, /wiki/RESTBase/deprecation]**. Endpoint is alive and current today, but treat as medium-term risk and keep it behind an abstraction.
- **License**: content CC BY-SA; fine for display with source noted.

### 2b. Wikimedia Core REST (`api.wikimedia.org/core/v1/wiktionary/en/page/{term}`)

- HTTP 200, `ACAO: *` **[probed]** — but returns **raw wikitext** (`content_model: wikitext`, `source: "{{also|Iota|...}}..."`) **[probed]**. Parsing Wiktionary wikitext client-side is a research project (that's what wiktextract exists for). **Not feasible** as a definition source. (There is no parsed-definition endpoint on api.wikimedia.org; anonymous api.wikimedia.org access is also rate-limited per Wikimedia's access policy — not further chased since the format already disqualifies it.)

### 2c. kaikki.org bulk extracts (offline/bundled option)

- Machine-readable all-of-Wiktionary extracts generated by **wiktextract**; English edition ~1.78 M senses; refreshed regularly (latest extraction 2026-08-28 from the 2026-08-05 dump); dual-licensed CC BY-SA + GFDL **[official: https://kaikki.org/dictionary/]**.
- Full English download is far too large to bundle in a 59 KB userscript. A trimmed common-words subset (Spelling Bee answers are common 4+-letter words) hosted somewhere static — or kaikki's per-word JSON files, which exist but whose URL scheme/CORS I did **[unverified]** — could make an offline-ish source. Real work; only worth it if every network option fails.

### 2d. MediaWiki Action API (parse wikitext yourself)

Feasibility only: same wikitext problem as 2b. Not viable.

## 3. Free Dictionary API (dictionaryapi.dev) — current default

- **Today**: `GET /api/v2/entries/en/iota` → **HTTP 522** after 19.5 s (Cloudflare "origin unreachable") **[probed 2026-08-29]**.
- **Track record**: repo issue titles include "website down" (2024-11), "audio server is down" (2024-05), and a cluster of "Server is down" issues through 2023 **[official: github.com/meetDeveloper/freeDictionaryAPI issues]**. Maintainer: "The API usage has been ramping up rapidly, making it difficult for me to keep the server running due to increased AWS costs." **[official: repo README]**.
- **Open source**: yes, GPL-3.0, so **self-hosting is possible** — but that converts a userscript into a service-operating commitment; it proxies Wiktionary data anyway, which the chain above reaches directly. Not recommended.
- **Format fit**: when up, it's actually the best free shape: defs + POS + phonetic text + audio URLs, no key, `ACAO: *` historically. Hence: keep as tertiary fallback, don't rely on it.

## 4. Wordnik

- **Pricing**: Free "Basic" $0 — **100 calls/hour**, for nonprofit/research use (free trial for commercial); Hobby $10/mo (1,000/hr); Pro $59/mo (20,000/hr); Enterprise $149/mo (45,000/hr) **[official: https://developer.wordnik.com/pricing]**.
- **CORS**: `ACAO: *` (observed on a 401 response to a bad key) **[probed]**.
- **Auth**: BYO key fits Better Bee's model; free-key issuance reportedly involves a manual/slow approval queue **[unverified]**.
- **Format fit**: separate endpoints for definitions (with POS and source-dictionary attribution: AHD, Wiktionary, WordNet, Century), pronunciations, and audio — 2–3 requests/word vs 1 for others.
- **Risk**: low-medium; nonprofit-run (Wordnik Society). Good candidate for a second BYO-key option; not a keyless default.

## 5. Oxford Dictionaries API

- **Not closed**: relaunched 2025-01-09 with self-serve "API Lite" and "Growing Business" plans, "start from £50 per month, billed annually"; Enterprise "from an annual fee of £5,000 per language" **[official: https://developer.oxforddictionaries.com/updates, site front page]**. Free access is a sandbox/trial only.
- **Fit**: £50/mo per user is absurd for BYO hobby use. **Ruled out**, but the "closed since 2023" belief is outdated.

## 6. WordsAPI (RapidAPI)

- Free tier **2,500 requests/day**, sold through RapidAPI; paid tiers above that **[unverified — secondary sources; wordsapi.com/pricing 404s and RapidAPI pricing pages are behind their SPA: https://rapidapi.com/wordsapi/api/wordsapi/pricing]**.
- **Fit problems**: BYO would require each user to create a RapidAPI account and ship an `X-RapidAPI-Key`; RapidAPI keys are account-wide (leak-sensitive); dataset freshness is a known community complaint **[unverified]**. Ruled out.

## 7. Datamuse (recommended new default)

- **Limits/auth**: no key required today; "up to 100,000 requests daily". **From 2027-01-01 an API key will be required in all requests** (still 100k/day per key) **[official: https://www.datamuse.com/api/]** — put a reminder in the repo to add the key plumbing (or re-check) before then.
- **Definitions**: `md=d` — "The definitions are from Wiktionary and WordNet"; inflected forms get `defHeadword` pointing at the base form **[official: same page]**.
- **POS/phonetics**: `md=p` adds POS tags; `md=r` adds ARPAbet pronunciation, `&ipa=1` switches it to IPA **[official: same page]**. **No audio.**
- **Probe** (`/words?sp=iota&md=dpr&max=1`, Origin: https://www.nytimes.com): 200; `access-control-allow-origin: https://www.nytimes.com` (origin reflected + `allow-credentials: true` — page-fetch fallback works); defs came back as clean plain text with POS prefix and usage labels intact, e.g. `"n\t(chiefly in the negative) A jot; a very small, insignificant quantity."`, plus `pron:AY0 OW1 T AH0` **[probed 2026-08-29]**. Notably it preserved the usage label that the Wiktionary REST endpoint rendered as an empty string.
- **One request per word** covers def + POS + phonetic. `sp=` does exact-spelling lookup; check `word` matches to avoid fuzzy surprises.
- **Reliability**: long-running (since ~2015), served via CloudFront **[probed: x-cache headers]**; no SLA, single-maintainer academic-adjacent service — hence keeping Wiktionary REST as fallback. Commercial-use/attribution fine print not re-verified **[unverified]**; Better Bee is non-commercial.

## 8. Cambridge / Collins / Lexicala (paid, brief)

- **Collins**: API exists (`api.collinsdictionary.com`), access via application form, no public self-serve pricing **[official: https://www.collinsdictionary.com/us/collins-api]**. Not BYO-friendly.
- **Lexicala (K Dictionaries)**: free personal plan **50 calls/day**; Premium ~$100/mo for 100k calls **[unverified — search summary of https://api.lexicala.com/plans/]**. 50/day is below Better Bee's worst-case daily need with retries; marginal.
- **Cambridge**: dictionary API is licensing-inquiry-only; no self-serve developer tier found. Ruled out.

## 9. LLM-generated definitions

One line, as agreed: BYO OpenAI/Anthropic keys could synthesize definitions, but for a dictionary feature where fidelity matters (and free lexical sources exist with CORS), it adds cost, latency, and hallucination risk for no unique benefit. Skip.

---

## Comparison table

| API | Auth | Free limit | Paid | CORS (page-fetch fallback) | Defs | POS | Phonetic | Audio | Risk |
|---|---|---|---|---|---|---|---|---|---|
| **Datamuse** | none (free key required from 2027-01-01) | 100k/day | n/a | Yes — origin reflected [probed] | Plain text (Wiktionary/WordNet) | Yes | ARPAbet/IPA | No | Low; solo-run, no SLA; 2027 key change |
| **Wiktionary REST** | none | etiquette-based, no hard read limit | n/a | Yes — `*` [probed] | HTML fragments; some empty senses | Yes | No | No | Low uptime risk; RESTBase deprecation medium-term |
| **dictionaryapi.dev** | none | unspecified | n/a | Yes — `*` (historically) | Yes | Yes | Yes | Yes | **High** — 522 today; chronic outages; hobby-funded |
| **Merriam-Webster** | BYO free key | 1,000/day/key | licensing fee | Yes — `*` [probed] | Yes (shortdef) | Yes | Yes (MW notation) | Yes (mp3) | Low; logo attribution required |
| **Wordnik** | BYO free key | 100/hr | $10–149/mo | Yes — `*` [probed] | Yes (multi-source) | Yes | Yes | Yes | Low-med; multi-request/word; slow key issuance [unverified] |
| **WordsAPI** | RapidAPI key | 2,500/day [unverified] | RapidAPI tiers | untested | Yes | Yes | Yes | No | Med; RapidAPI-bound keys, freshness doubts |
| **Oxford** | paid account | trial only | from £50/mo (annual) | untested | Yes | Yes | Yes | Yes | Ruled out on price |
| **Lexicala** | BYO free key | 50/day [unverified] | ~$100/mo | untested | Yes | Yes | Yes | ? | Marginal free quota |
| **Collins / Cambridge** | application/licensing | none | on request | untested | Yes | Yes | Yes | Yes | Not self-serve |
| **kaikki.org (bulk)** | none (download) | n/a | n/a | n/a (offline) | Yes | Yes | Yes (IPA) | links | High effort; data size |

## Probe log (2026-08-29)

```
api.dictionaryapi.dev /api/v2/entries/en/iota            → 522 (19.5s)
en.wiktionary.org/api/rest_v1/page/definition/iota       → 200, ACAO:*
api.wikimedia.org/core/v1/wiktionary/en/page/iota        → 200, ACAO:*, raw wikitext
api.datamuse.com/words?sp=iota&md=dpr (Origin: nyt)      → 200, ACAO reflected, plain-text defs
dictionaryapi.com/api/v3/.../iota?key=test (Origin: nyt) → 200, ACAO:*
api.wordnik.com/v4/word.json/iota/definitions?key=test   → 401, ACAO:*
```
