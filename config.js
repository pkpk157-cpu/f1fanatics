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
    // Prize money. Everyone pays the entry; each round's top scorer takes
    // perRound (tied winners split it); what's left of the pot after every
    // round's prize goes to the season's top three in the ratio split
    // (tied places share the prizes for the places they cover).
    prizes: {
      entry: 5000,
      perRound: 500,
      split: [25, 18, 15],
      currency: "₹"
    }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = CONFIG;
  else root.F1F_CONFIG = CONFIG;
})(this);
