# F1 Fanatics — League Tracker

A static, installable (PWA) tracker for the **F1 Fanatics** F1 Fantasy private
league (league `1583310`), 2026 season. Classic overall standings, with the
stats around them:

Five tabs in a bar docked to the bottom, each split into sub-tabs at the top:

- **League**: Standings (each row shows that manager's form over the last five
  races) · XP (the season split and everyone's XP)
- **Races**: Races (every race of the season by name; tap a finished one for
  its podium, Dream team and who scored, ‹ › through the season) · Race grid
- **Your team** (middle): Season (four figures and every round) · Team ·
  Picks (who scored for you) · Rivals (either side, head to head)
- **Trends**: Position · Gap to the leader
- **Picks**: Drivers · Constructors · Trusted (most picked across the season)

The **menu** (≡, top right) has your team (with **Change**), the **Stats**
sections (Records · Weekends · Honours · Movement · Value), **Rules** (league XP
and F1 Fantasy's scoring) and **Settings** (appearance, about the data).

Each piece of information lives in one place.

Tap any manager, round, driver or constructor for its page.

Choosing your team (top of the menu) highlights you everywhere and is saved
on that device only. **Settings** has Dark, Light and Auto themes (dark is the default),
the F1 Fantasy 2026 game rules (scoring, chips, transfers, prices, in
`rules.js`, taken from F1 Fantasy's official rules text), and the About the data page.

### The look

Standings and round winners are drawn like F1's broadcast standings graphic:
red position numbers, a bar in team colours, and the points in a red block
(gold for the leader). Round results are a podium (2–1–3) plus the rest of
the field, like F1's race-result graphic. Pictures are used for drivers and
constructors only, never for managers. **1st is always gold, 2nd silver,
3rd bronze**: standings, podiums, form chips, race-grid outlines, ranked
lists and tables (`--p1`/`--p2`/`--p3` in `styles.css`). XP is only ever
shown as XP. Tabs carry no explanatory text (no descriptions,
legends or footnotes); headings and data only. All of it has light and dark versions. Teams are shown as cards in the
style of F1 Fantasy's team builder and Team of the Week. Each round's page
has a **Dream team**: the best five drivers and two constructors of that
round, with the top driver boosted 2× and no cost cap.

Team colours come from F1 Fantasy's own image config. Driver headshots,
constructor cars and logos are mirrored into `photos/` by the **Driver
photos** workflow (`scripts/fetch-photos.js`), which runs daily and on
demand. The app never loads images from F1. Anything not mirrored yet shows
initials. The display type is Titillium Web (SIL Open Font License, in
`fonts/`).

## League XP

Set in `config.js` (`xp`) and shown under **League › XP**, on **Your
team › Overview**, on the round winners board and in Settings:

- Everyone puts in 5,000 XP → a 50,000 XP pool (10 managers).
- Each race's top scorer earns 500 XP (23 races = 11,500 XP). Tied winners share it.
- The rest, 38,500 XP, goes to the season's top three in the ratio 25 : 18 : 15:
  16,595 / 11,948 / 9,957 XP. Tied final places share the XP for the places
  they cover.

## Where the data comes from

F1 Fantasy's public feeds. No login and no API key:

| Feed | What it gives |
|---|---|
| `feeds/leaderboard/privateleague/list_1_{league}_0_1.json` | standings, each manager's current seven picks |
| `feeds/leaderboard/privateleague/list_2_{league}_{round}_1.json` | **one round's** points per manager, plus the team used in it; `403` until the round is scored |
| `feeds/drivers/{round}_en.json` | every driver and constructor: price for that round, points scored in it, whole-game selection % |
| `feeds/schedule/raceday_en.json` | the calendar (names, sprint weekends, lock times) |

**list_2 is per-race, not a running total.** This was checked against the
league on 3 November 2026: after round 19, the 19 list_2 scores added up
exactly to the list_1 total for every manager with a full history, the scores
went up and down from round to round, and round 19 alone (e.g. 192) was nothing
like the total (4,852). One manager (Karanraj) joined after round 3 and is absent from
rounds 1–3 of list_2. His scores for those rounds (204, 505, 167, from the
league's own sheet) are entered by hand in `config.js` (`manualRounds`); the
updater uses them only because they add up exactly to the 876 points F1
counts in his total, and would ignore them with a warning if they didn't.

`data.json` is built for everyone by a GitHub Action, not by a person:
`scripts/fetch-data.js` reads the feeds, `scripts/verify-data.js` checks that
the rounds add up to the standings (and that the order, picks and prices hold
together), and the file is committed and deployed to Pages in the same job.
A new commit is made only when F1's numbers change. If F1 is down or answers
with fewer rounds than are already published, the last good data stays live.

Right after a race F1 doesn't update both feeds at the same moment. If the
round scores arrive before the standings, the totals shown include the new
round. If the standings arrive first, F1's totals are shown and a banner says
the round breakdown is pending. The ⓘ sheet in the app shows the latest checks.

Not in the public feeds, so not in the tracker: money in the bank, which
driver got the DRS boost, and which chips were played. Team value means the
seven picks at that round's prices, so a one-round spike is the Limitless chip.

## The clock: what keeps it fresh

`heartbeat.yml` pokes **Update F1 data** every ten minutes for most of an
hour, then hands over to a fresh copy of itself. GitHub's own `schedule:` on
both workflows is only a backstop, because GitHub drops and delays scheduled
runs, sometimes for hours. The heartbeat also cancels any update stuck for
over 25 minutes. If no update has succeeded in 45 minutes, the heartbeat run
fails and GitHub emails the repository owner.

## One-time setup

1. **Default branch**: merge this work into `main`. The workflows and Pages
   deploy run from `main`.
2. **Pages**: Settings → Pages → Source: **GitHub Actions**. The app is then
   served at `https://<user>.github.io/f1fanatics/`.
3. **`CRON_PAT` secret**: a workflow can't start another workflow with the
   built-in `GITHUB_TOKEN`, so the heartbeat needs a personal access token.
   Create a fine-grained token with **Actions: read and write** on this
   repository, then add it under Settings → Secrets and variables → Actions →
   New repository secret, named `CRON_PAT`.
4. **Start the clock**: Actions → Heartbeat → Run workflow (or wait for the
   schedule to start it).

Actions minutes are free on a public repository. On a private one the
heartbeat uses roughly 1,500 of the 2,000 free minutes a month.

## Changing league

Edit `config.js` (`leagueId`, `leagueName`, `season`), run
`node scripts/fetch-data.js`, then `node scripts/stamp-sw.js`, and commit.

## Development

```bash
python3 -m http.server 8000   # then open http://localhost:8000/
node scripts/fetch-data.js    # refresh data.json from F1
node scripts/verify-data.js   # check it
node tests/compute.test.js    # stats engine against a real round-19 snapshot
node scripts/stamp-sw.js      # after changing any app file
```

`compute.js` holds every calculation and runs both in the browser and in
Node, so the published checks and the app always agree.

Unofficial fan project, not affiliated with Formula 1.
