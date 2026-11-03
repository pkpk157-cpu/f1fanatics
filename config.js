/* F1 Fanatics — the one place the league is named.
   Read by the app in the browser and by scripts/fetch-data.js on the runner. */
(function (root) {
  var CONFIG = {
    leagueId: "1583310",
    leagueName: "F1 Fanatics",
    season: 2026,
    // The published file the app reads. Built every ten minutes by
    // .github/workflows/update-data.yml; nobody exports anything by hand.
    dataUrl: "data.json"
  };
  if (typeof module !== "undefined" && module.exports) module.exports = CONFIG;
  else root.F1F_CONFIG = CONFIG;
})(this);
