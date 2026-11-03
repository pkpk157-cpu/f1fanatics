/* F1 Fanatics — the one place the league is named.
   Read by the app in the browser and by scripts/fetch-data.js on the runner. */
(function (root) {
  var CONFIG = {
    leagueId: "1583310",
    leagueName: "F1 Fanatics",
    season: 2026,
    // The published file the app reads. Built every ten minutes by
    // .github/workflows/update-data.yml; nobody exports anything by hand.
    dataUrl: "data.json",
    // League XP. Everyone puts in `stake`; each race's top scorer earns
    // `perRace` (tied winners share it); what's left of the pool after every
    // race goes to the season's top three in the ratio `split` (tied places
    // share the XP for the places they cover).
    xp: {
      stake: 5000,
      perRace: 500,
      split: [25, 18, 15]
    }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = CONFIG;
  else root.F1F_CONFIG = CONFIG;
})(this);
