# F1 Fanatics — League Tracker

A static, installable (PWA) tracker for the **F1 Fanatics** F1 Fantasy private
league (league `1583310`), 2026 season. Classic overall standings, with the
stats around them:

Five tabs in a bar docked to the bottom, each split into sub-tabs at the top:

- **League**: one board with a **Points / XP** switch on it (no sub-tabs; the
  choice is remembered). Points: the standings podium and everyone else, with
  form over the last five races, places moved and the gap to the leader. XP:
  the same board in XP order showing total XP only, then a table of each
  manager's race wins (shared noted), race XP, the season XP their place is on
  track for (or how far off 3rd they are) and total, then the pool, race XP,
  races left and season XP
- **Races**: Races (every race of the season: its number with the date (and
  sprint) beneath, and under the name the round's top three as F1-style codes,
  e.g. 1 VOH 2 PUR 3 KAP; tap a finished one for
  its podium, Dream team and who scored, ‹ › through the season) · Race grid
- **Your team** (middle): Season (four figures and every round) · Team ·
  Picks (who scored for you) · Rivals (either side, head to head)
- **Trends**: Position · Points (running total) · Gap to the leader. Fully
  zoomed out, every race fits on screen, numbered and named vertically along the
  bottom; zoom in on both axes (pinch, trackpad pinch, or + / −) and scroll.
  The names below pick which lines are highlighted, each in its own colour
  (the leader and you to start with); **All** highlights everyone
- **GP** (its label is the weekend's three letters, e.g. MEX): the last race
  weekend until the next one locks, then the next. Your team for that weekend
  with its points, your total (live while a session runs, provisional once it
  ends, final once F1 scores the round, with your place in the round), and
  every session: practice (and sprint qualifying) with where your drivers
  finished; qualifying, sprint and race with each pick's points and finishing
  position, marked Live, Provisional or Final

The **menu** (≡, top right) has your team (with **Change**), the **Stats**
sections (Records · Weekends · Honours · Movement · Value), **Picks**
(Drivers · Constructors · Trusted, most picked across the season), **Rules** (league XP
and F1 Fantasy's scoring) and **Settings** (appearance, about the data).

Each piece of information lives in one place.

Tap any manager, round, driver or constructor for its page. A manager's page has **Compare**:
you and them side by side, both teams for any race (chosen from a list,
shared picks dimmed so the differences stand out, each pick's points and
both round scores), **Form** (points each race as paired bars and league
position as two lines, scrolling sideways from the latest race), then the
season in numbers with the better side lit.

Managers are shown with their initials in a circle, in a colour of their own,
wherever they're listed. Choosing your team (top of the menu) marks you
everywhere with a small red **YOU** tag and a red ring on your circle and is saved on that device only. **Settings** has Dark, Light and Auto themes (dark is the default),
the F1 Fantasy 2026 game rules (scoring, chips, transfers, prices, in
`rules.js`, taken from F1 Fantasy's official rules text), and the About the data page.

### Motion

`motion.js` adds the movement: pages slide in from the side you're heading to
and their parts cascade in; the podium rises 2-1-3 and its numerals pop; points
and XP count up; Trends lines draw themselves and Compare's bars grow; the
bottom bar's red highlight and the Points / XP thumb glide; sheets spring up,
close with an animation and can be swiped down; tappable things press in (with
a tiny vibration on Android); the header gains depth as the page scrolls; a
light sweeps across 1st place now and then. Only transform and opacity are
animated, and all of it switches off when the phone asks for reduced motion.

### The look

Standings, XP and round results are drawn like F1's race-result graphic: a
podium (2–1–3) with big numerals, then the rest of the field. Pictures are used for drivers and
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

Set in `config.js` (`xp`) and shown on the **League** board (switch to **XP**), on **Your
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
| `feeds/schedule/raceday_en.json` | the calendar (names, sprint weekends, lock times, each scored session's times and live state) |
| `feeds/popup/playerstats_{id}.json` | each driver's and constructor's points and finishing position per scored session (qualifying, sprint, race), read around race weekends only |
| OpenF1 `api.openf1.org` | every session of the weekend and, after each practice / sprint qualifying, where each driver finished (F1 Fantasy doesn't score practice) |

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

`heartbeat.yml` pokes **Update F1 data** every ten minutes (every three while
a qualifying, sprint or race is on, `scripts/session-live.js`) for most of an
hour, then hands over to a fresh copy of itself. GitHub's own `schedule:` on
both workflows is only a backstop, because GitHub drops and delays scheduled
runs, sometimes for hours. The heartbeat also cancels any update stuck for
over 25 minutes. If no update has succeeded in 45 minutes, the heartbeat run
fails and GitHub emails the repository owner. It stops by itself three days after
the season's last race (`scripts/season-over.js`).

Every deploy to Pages (a push to `main`, new data, new photos) ships the
newest `main` and only after the source checks and engine tests pass.

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

Actions minutes are free on a public repository. The heartbeat keeps one
runner busy around the clock, so on a private repository it would need a paid
plan.

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
