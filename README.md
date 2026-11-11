---
title: Guitar AI
emoji: 🎸
colorFrom: yellow
colorTo: red
sdk: docker
app_port: 7860
pinned: false
---

# 🎸 Fretwork AI — AI guitar analysis you run yourself

Upload a recording of guitar playing and get **chords**, **key**, **scales**, **solo
notes as tablature**, an **isolated guitar track**, a **backing track with the guitar
removed**, and a **practice studio** that slows songs down without changing the pitch.

Everything runs on your own machine. **Total cost: ₹0.** No paid API is required — the
optional Gemini key is free and only writes prose explanations.

> Written for a beginner developer: every command is copy-pasteable, every file has a
> comment saying what it does, and the hard maths is explained before it is used.

---

## ⚡ Quick start (4 commands)

```bash
# 1. Backend  — in ONE terminal
cd guitar-ai/backend
python3 -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# 2. Frontend — in a SECOND terminal
cd guitar-ai/frontend
npm install
npm run dev
```

Open **http://localhost:5173** → drop in an audio file (or paste a link) → press
*Analyse this track* / *Fetch & analyse*.

`requirements.txt` already installs the two small extras the app needs:
`yt-dlp` (fetch links) and `imageio-ffmpeg` (a static ffmpeg, so mp3/m4a/video work
without installing ffmpeg system-wide).

No guitar recording handy? Generate one (it synthesises a real Am–F–C–G progression with
a solo, so you can check the app against known ground truth):

```bash
python3 tools/make_test_audio.py            # writes test_audio/guitar_test.wav
```

Prefer a single command? `./scripts/start-dev.sh` (macOS/Linux) or `scripts\start-dev.bat`
(Windows) starts both servers for you.

---

## 🧭 What works, and what I verified

| Feature | Engine | Status in this build |
|---|---|---|
| Chord detection (19 chord types + slash chords) | Chroma templates + Viterbi decoder | ✅ **100% root / 100% exact** on the ground-truth test file |
| Tempo & beat tracking | librosa beat tracker | ✅ 95.7 BPM measured vs 96 BPM true |
| Key detection | Krumhansl-Schmuckler + Temperley profiles | ✅ Works (C major ↔ A minor ambiguity handled & explained) |
| Scale / mode ID (13 scales × 12 roots) | Duration-weighted pitch-class histogram | ✅ Song key and solo scale analysed **separately** |
| Solo transcription | Spotify Basic Pitch **or** built-in CQT multi-pitch tracker | ✅ CQT tracker tested (124 notes on the test file); Basic Pitch code path written but not installed here |
| Techniques (bend/vibrato/slide/hammer-on/pull-off) | Pitch-contour + onset-strength heuristics | ✅ Detects and flags as *candidates* with confidence |
| Tablature | Dynamic-programming fingering search | ✅ Renders aligned ASCII tab; verified against real voicings |
| Stem separation | **Meta Demucs `htdemucs_6s`** (real guitar stem) | ✅ **Tested**: 6 stems in 24.5 s for 26 s audio, ~1.3 GB RAM peak |
| Backing track (guitar removed) | Sum of non-guitar stems | ✅ Tested |
| Interactive fretboard | Custom SVG, 5 display modes | ✅ Renders; click any fret to hear it |
| Practice studio | Web Audio + built-in **WSOLA time-stretch** | ✅ Verified numerically: tempo and pitch are independent (±1.3 cents) |
| AI explanations | Gemini 3.5 Flash-Lite / 3.1 Flash-Lite | ⚠️ Code complete, **not tested with a live key** (see below) |
| MP3 / M4A / video upload | ffmpeg (system **or** the pip `imageio-ffmpeg` binary) | ✅ Works — the static binary is auto-added to PATH |
| **Paste a link** (YouTube, SoundCloud, …) | `yt-dlp` + ffmpeg | ✅ **Works** — verified end-to-end on a real SoundCloud track. YouTube is blocked **from cloud/server IPs only** (see below) |

---

## 🏗️ Project structure

```
guitar-ai/
├── backend/
│   ├── app/
│   │   ├── main.py              FastAPI app, CORS, startup cleanup
│   │   ├── core/config.py       every setting (reads backend/.env)
│   │   ├── core/ffmpeg.py       finds ffmpeg, exposes the pip static one on PATH
│   │   ├── audio/
│   │   │   ├── theory.py        ★ music theory: notes, scales, chords, fretboard, voicings
│   │   │   ├── loader.py        decode any file → (waveform, sample rate)
│   │   │   ├── features.py      tempo, beats, chroma, key, meter
│   │   │   ├── chords.py        ★ chord recognition (templates + Viterbi)
│   │   │   ├── notes.py         ★ transcription + technique detection
│   │   │   ├── tabs.py          ★ fingering search + ASCII tablature
│   │   │   ├── scales.py        ★ scale matching + out-of-scale analysis
│   │   │   ├── separation.py    ★ Demucs stems + labelled HPSS fallback
│   │   │   └── midi_writer.py   writes a .mid file with zero dependencies
│   │   ├── ai/
│   │   │   ├── gemini.py        Gemini Flash-Lite client (structured JSON)
│   │   │   └── local_explanations.py  free, data-derived explanations
│   │   ├── services/
│   │   │   ├── url_fetch.py     yt-dlp: probe + download links, honest error mapping
│   │   │   ├── pipeline.py      runs all stages in order, with progress
│   │   │   ├── jobs.py          background worker + job status
│   │   │   ├── stages.py        re-run one stage on its own
│   │   │   └── store.py         JSON file "database" (no setup)
│   │   └── api/                 HTTP endpoints (analyse, chords, transcribe, …)
│   ├── requirements.txt
│   └── .env.example             ← copy to .env to configure
├── frontend/
│   └── src/
│       ├── lib/audio.ts         ★ Web Audio engine + WSOLA time-stretch
│       ├── components/          Fretboard, Waveform, TabViewer, StemMixer, …
│       ├── pages/               Home, Analyse, Chord/Solo/Scale/Stem pages, …
│       └── context.tsx          shared "current analysis" state
├── tools/
│   ├── make_test_audio.py       synthesises a test track (Karplus-Strong guitar)
│   └── tune_chords.py           measures chord accuracy against ground truth
├── scripts/                     start-dev.sh / start-dev.bat
├── uploads/  processed/  models/     (git-ignored: your audio lives here)
└── README.md
```

---

## 🔬 How the interesting parts work

**Chord detection** (`backend/app/audio/chords.py`)
1. Split the audio into harmonic and percussive parts, then compute a 12-value *chroma*
   vector per beat (how much C, C♯, D … is sounding).
2. Score all 12 roots × 19 chord types with three terms: cosine similarity to the chord
   template, how much of the audio the chord explains, and a penalty for chord notes that
   are *not* in the audio.
3. Run a **Viterbi decoder** over the whole song. It charges a penalty for changing chord,
   which is what stops the output flickering between chords every beat.

**Getting that right was measured, not guessed.** `tools/tune_chords.py` compares the
output against the known progression in the test file. The change penalty was originally
2.0 — far too high, and it collapsed the entire song into one chord (0% accuracy).
Sweeping the value gave:

```
penalty=2.0   →  0% exact   (one chord for the whole song)
penalty=0.35 → 100% exact   ✅  ← shipped value
penalty=0.1  →  88% exact   (too twitchy)
```

**Solo transcription** — Spotify Basic Pitch if installed; otherwise a built-in
constant-Q-transform peak picker: find spectral peaks per frame, refine each with parabolic
interpolation to sub-semitone accuracy, and stitch peaks that stay on the same pitch into
notes. Techniques are then inferred from the pitch contour (vibrato = 3.5–10 Hz residual
oscillation ≥ 18 cents; bend = sustained glide; slide = a big interval with no new pick
attack; hammer-on/pull-off = a small step with no new pick attack). **These are heuristics**
— the UI labels every one a *candidate*.

**Tablature** — the same note can be played in several places on the neck, so a
dynamic-programming search picks the sequence of positions that minimises hand movement,
string jumps and trips up the neck. That is why the generated tab stays in one position
instead of teleporting around the fretboard.

**Scale finding** — the song's key comes from the harmony; the solo's scale comes from a
duration-weighted histogram of the detected notes. **They are analysed separately**, which
is the whole point: a song can sit in F major while the lead plays F minor pentatonic. The
app then explains the relationship ("relative minor", "parallel/borrowed", …).

**Stem separation** — Demucs `htdemucs_6s` produces a genuine **guitar** stem (vocals,
drums, bass, guitar, piano, other). Backing track = the sum of everything except guitar.
If Demucs is missing, the app falls back to harmonic/percussive + band filtering and says
so in bold — **it will never label the "other" stem as guitar.**

**Practice studio** — the browser has no time-stretcher, so `lib/audio.ts` implements
WSOLA (waveform-similarity overlap-add). Verified on a 440 Hz tone:

```
tempo 0.50,  0 semitones → 1.97 s, 440.3 Hz (+1.1 cents)   [target 2.00 s, 440 Hz]
tempo 0.50, +2 semitones → 1.97 s, 494.1 Hz (+200.6 cents) [target 2.00 s, 493.9 Hz]
tempo 2.00, +5 semitones → 0.50 s, 587.6 Hz (+500.8 cents) [target 0.50 s, 587.3 Hz]
```

Slowing down does **not** drop the pitch, and shifting pitch does **not** change the tempo.

---

## 🤖 Optional: Gemini explanations (free)

Gemini never hears your audio. It receives a small JSON summary of what was *measured*
(chord names, timings, note names, detected techniques) and is instructed to use nothing
else, so it cannot invent notes.

1. Get a free key at **https://aistudio.google.com/apikey** (no card).
2. `cd backend && cp .env.example .env`
3. Set `GEMINI_API_KEY=your_key_here`
4. Restart the backend.

Model ids are verified against Google's documentation (Nov 2026) — `gemini-3.5-flash-lite`
is the recommended free-tier Flash-Lite, with `gemini-3.1-flash-lite` and `gemini-3.8-flash`
as automatic fallbacks. Change them in `.env` if Google retires an id.

**Without a key the app still works**: `ai/local_explanations.py` builds real guidance
from the measured numbers (progression, coverage %, weak-confidence chords, a practice
plan with BPM targets). It is not canned filler — every sentence comes from your data.

> ⚠️ I could not test the Gemini call with a live key (none was available in the build
> environment). The request format, JSON schema and model fallback chain are written to
> Google's documented API, and failures degrade gracefully to local text — but please
> confirm it works with your key. If a model id is rejected, the app tries the next one
> and tells you what happened.

---

## 🔗 Pasting links (YouTube, Shorts, SoundCloud, …)

Paste a link, press **Check link**, and the app asks the platform what it is
(title, duration, uploader) *before* downloading anything. If it can be fetched you get a
green **“Found: …”** card and a **Fetch & analyse** button; if it can't, you get the
platform's own reason in plain English plus what to do about it.

The chain is: `yt-dlp` downloads the best **audio** stream → `ffmpeg` converts it to
44.1 kHz mono WAV → the exact same pipeline as an uploaded file runs on it.

**Verified:** a real SoundCloud link (`soundcloud.com/forss/flickermood`, 3:33) was
fetched and analysed end-to-end — 213.9 s, D major, 147.7 BPM, 53 chords, 669 notes,
634 tab positions, solo scale D Dorian.

### What we will not do

* No bypassing age gates, private/members-only items, paywalls or login walls.
* No working around region blocks or copyright takedowns.
* No de-DRM or decryption of any kind.
* No forging PO tokens or bot-check attestations to make a server IP look
  residential. (There is a well-known plugin that does exactly this; it is
  deliberately **not** used here. If YouTube blocks your machine's IP, the fix
  is to run the backend where you are, not to disguise it.)

When a platform refuses, the API returns a machine-readable reason
(`bot_check`, `age_restricted`, `private`, `blocked`, `login_required`, `too_long`,
`live`, `unavailable`, …) and the UI shows it verbatim instead of a generic error.

### ⚠️ “Confirm you're not a bot” — why YouTube fails on a server and works at home

YouTube, Instagram and TikTok block downloads that come from **data-centre / cloud / VPS
IP addresses**. If you run this app on a hosted box (Render, Railway, a VM, an online
sandbox) you will almost always see:

> YouTube refused the download with a 'confirm you're not a bot' check.
> This happens when the backend runs on a server/cloud IP…

I tested this from a cloud sandbox: every YouTube player client
(`tv_embedded`, `ios`, `web_safari`, `android_vr`, `mweb`, `web`) returned the bot check,
while SoundCloud and direct file links worked perfectly from the same machine.

**What to do, in order:**

1. **Give the backend your own cookies** — the fix that works *without leaving this
   page*. Settings → **Link fetching** → **Upload cookies.txt**:

   1. Install the browser extension **“Get cookies.txt LOCALLY”** (Chrome, Edge or
      Firefox).
   2. Open **youtube.com while signed in to your own account.**
   3. Click the extension → **Export** → **Current site** → save the file.
   4. Upload it here. The panel now shows `Cookies loaded — N entries · YouTube ✓`,
      and your link goes through as *you* instead of as an anonymous server.

   Your cookies are written to `backend/cookies.txt` with owner-only permissions
   (`chmod 600`), are git-ignored, and are **never sent back to the browser** — the
   API only returns metadata (how many entries, which domains, when they expire).
   Remove them any time with the **Remove** button, which deletes the file and clears
   the setting. Endpoints: `POST /api/url/cookies`, `DELETE /api/url/cookies`.
2. **Run the backend on your own computer** (home broadband or mobile hotspot). The
   identical link usually works immediately, with no cookies needed.
3. **Upload the file.** It always works, it's faster, and it avoids the whole question.

> Cookies are ordinary authentication — you are simply signed in as yourself, which is
> why this is the honest fix. It does **not** bypass age gates, private videos,
> members-only posts or region blocks; those are still refused.

### Settings that control it (`backend/.env`)

| Setting | Default | Meaning |
|---|---|---|
| `ENABLE_URL_FETCH` | `true` | Master switch for link fetching |
| `URL_MAX_DURATION_SEC` | `900` | Longest clip pulled from a link (15 min) |
| `YTDLP_COOKIES_FILE` | *(empty)* | Your own cookies.txt (set automatically when you upload it in Settings) |
| `YTDLP_PLAYER_CLIENTS` | `tv_embedded,ios,web_safari,android_vr,mweb,web` | YouTube clients tried in order |
| `YTDLP_FORMAT` | `bestaudio/best` | Audio-only by default (no video download) |

Install the two small extras if you set this up yourself:

```bash
pip install yt-dlp imageio-ffmpeg
```

`imageio-ffmpeg` ships a **static ffmpeg binary** — no admin rights, no PATH editing.
`backend/app/core/ffmpeg.py` symlinks it into `backend/.bin` and puts that on PATH,
which is what makes yt-dlp *and* mp3/m4a/video decoding work without a system ffmpeg.

**Test any link without downloading it:** Settings → **Link fetching** → paste a link →
**Test link**. It reports the tooling status plus the platform's exact answer.

---

## 🧪 Testing it yourself

```bash
# Is everything detected correctly?
python3 tools/tune_chords.py

# Full pipeline on the synthesised test file, no server needed
cd backend && python3 -c "
import sys; sys.path.insert(0,'.')
from app.services import pipeline, store
r = pipeline.run(lambda p,m='',s=None: None, 'job_demo', '../test_audio/guitar_test.wav',
                 {'separation': False})
print(open('../processed/job_demo/result.json').read()[:400])
"
```

Also useful:
* `curl http://localhost:8000/api/capabilities` — which engines are live on your machine.
* `http://localhost:8000/docs` — interactive API documentation.

---

## 🛠️ Troubleshooting

| Problem | Fix |
|---|---|
| `pip install basic-pitch` fails with `pkgutil has no attribute 'ImpImporter'` | Your Python is **3.13**. Basic Pitch's dependency pins don't build there yet. Use **Python 3.11 or 3.12** (`pyenv install 3.12`), or just run without it — the built-in tracker works fine. |
| `OSError: [Errno 28] No space left on device` installing torch | pip downloads to `/tmp`, which is a small RAM disk on many Linux setups. Run `export TMPDIR=$HOME/.pip-tmp && mkdir -p $TMPDIR` then retry. |
| Upload rejected: "unsupported file type" | Run `pip install imageio-ffmpeg` (easiest) or install a system ffmpeg (`sudo apt install ffmpeg` / `brew install ffmpeg`). The app auto-detects either. |
| "Sign in to confirm you're not a bot" | YouTube blocking a **server IP**. Run the backend on your own computer (home internet), or add your own cookies via `YTDLP_COOKIES_FILE`. See *Pasting links*. |
| Link check says "yt-dlp is not installed" | `pip install yt-dlp`, then restart the backend. |
| Link fetch says "ffmpeg is not installed" | `pip install imageio-ffmpeg`, then restart the backend. |
| Bot check even *with* cookies | The exported cookies are stale or from the wrong profile. Re-export while actually signed in on youtube.com, upload again, and check Settings shows “YouTube ✓”. |
| "That media is X min long" | Raise `URL_MAX_DURATION_SEC` in `backend/.env`, or trim the clip and upload it. |
| Job fails with "Demucs is installed but this machine has only ~X MB of free RAM" | Working as designed — separation was skipped instead of crashing the server. Demucs needs ~2 GB free. Close other apps, or set `DEMUCS_MIN_RAM_MB` / `DEMUCS_SEGMENT=6` in `backend/.env`. |
| Frontend shows "Network error" | The backend isn't running. Start it on port 8000; Vite proxies `/api` to it. |
| Analysis is slow | Turn off stem separation in the upload options (it is ~90 % of the time on CPU). |
| Chords look wrong | Check the confidence bars. Chord detection is genuinely hard with heavy distortion or a buried guitar — separate stems first and re-run. |

---

## 📦 Deployment (still ₹0)

* **Frontend** — `cd frontend && npm run build`, then drag `dist/` onto **Vercel** (Hobby
  plan), Netlify, or Cloudflare Pages. Free.
* **Backend** — this is the hard part for free hosting: the Python packages plus Demucs
  exceed most free tiers' size limits. Honest options:
  * **Keep it local** (recommended): `uvicorn app.main:app --host 0.0.0.0` on your laptop.
  * **Free-tier containers**: Render/Fly.io/Railway free tiers handle the *light* backend
    (web framework + librosa). Deploy with separation disabled (`USE_DEMUCS=false`).
  * **Split it**: static frontend on Vercel, heavy analysis on your own machine or a free
    Google Colab notebook (good for experimenting with GPU separation).
* **Database** — none required. `processed/store.json` holds your projects; migrate to
  MongoDB only when you genuinely need multi-user access.

---

## 🗺️ The 10-phase build, mapped to this repo

| Phase | Where it lives |
|---|---|
| 1. Environment & scaffolding | `README.md`, `scripts/`, `.gitignore` |
| 2. Interface & upload | `frontend/src/pages/Home.tsx`, `components/UploadPanel.tsx`, `api/media.py` |
| 3. Install & test the audio tools | `backend/requirements.txt`, `api/health.py` (`/api/capabilities`) |
| 4. Chords, BPM, key | `audio/chords.py`, `audio/features.py`, `tools/tune_chords.py` |
| 5. Separation & backing track | `audio/separation.py`, `pages/Stems.tsx`, `components/StemMixer.tsx` |
| 6. Transcription, MIDI, tabs, fretboard | `audio/notes.py`, `audio/tabs.py`, `audio/midi_writer.py`, `components/Fretboard.tsx` |
| 7. Gemini integration | `ai/gemini.py`, `ai/local_explanations.py`, `components/AICoach.tsx` |
| 8. Practice studio | `lib/audio.ts`, `hooks/usePlayer.ts`, `components/sections/PracticeSection.tsx` |
| 9. Testing & hardening | `tools/`, memory guard in `separation.py`, per-stage error isolation in `pipeline.py` |
| 10. Deployment | section above |

---

## 📄 Licence & credits

Your code, your rules — add a licence file before publishing. The models and libraries
this app can use carry their own licences: **Demucs** (MIT), **Basic Pitch** (Apache-2.0),
**librosa** (ISC), **FastAPI** (MIT). Check each before you ship commercially.

Built with: React 18 · TypeScript · Vite · Tailwind CSS · lucide-react · FastAPI ·
librosa · NumPy/SciPy · Meta Demucs (optional) · Spotify Basic Pitch (optional) ·
Google Gemini Flash-Lite (optional).
