/* F1 Fantasy 2026 game rules, as shown in the app's Settings sheet.

   Taken from F1 Fantasy's own rules text (fantasy.formula1.com/en/game-rules,
   served from feeds/translations/web/en.json) on 3 November 2026. Where that
   text holds two versions of a table (pit stops), the one matching F1's
   "What's new for 2026" note is used. Update this file if F1 changes a rule;
   nothing else depends on it. */
(function (root) {
  var RULES = {
    source: "https://fantasy.formula1.com/en/game-rules",
    checked: "3 November 2026",
    sections: [
      {
        title: "Your team",
        rows: [
          ["Line-up", "5 drivers + 2 constructors"],
          ["Cost cap", "$100m"],
          ["Boost", "Pick one driver each race to score 2× points"],
          ["Teams per player", "Up to 3"],
          ["Creating a team after the lock deadline", "−10"]
        ]
      },
      {
        title: "Transfers",
        rows: [
          ["Free transfers", "2 before each race"],
          ["Each extra transfer", "−10"],
          ["Unused free transfer", "1 carries over to the next race (doesn't build up)"],
          ["Before your first race", "Unlimited, within the cost cap"]
        ],
        notes: ["Transfers count the net change from your previous race line-up, so undoing a transfer gives it back."]
      },
      {
        title: "Chips",
        intro: "Six chips, each usable once a season, one per race. Autopilot, x3 Boost and No Negative are available from the start; the other three unlock after your first race.",
        rows: [
          ["Limitless", "Unlimited transfers and no cost cap for one race; your original team comes back afterwards"],
          ["Wildcard", "Unlimited transfers within the cost cap until the next lock"],
          ["Final Fix", "One change between Qualifying and the Grand Prix; the outgoing driver keeps the points already scored"],
          ["Autopilot", "The 2× Boost moves to your highest-scoring driver"],
          ["x3 Boost", "One driver scores 3× for the weekend"],
          ["No Negative", "No negative points in any scoring category all weekend (transfer penalties still apply)"]
        ]
      },
      {
        title: "Qualifying — drivers",
        rows: [
          ["Pole (1st)", "10"], ["2nd", "9"], ["3rd", "8"], ["4th", "7"], ["5th", "6"],
          ["6th", "5"], ["7th", "4"], ["8th", "3"], ["9th", "2"], ["10th", "1"],
          ["11th–22nd", "0"],
          ["Not classified / no time in Q1", "−5"],
          ["Disqualified", "−5, and −5 more to the constructor"]
        ]
      },
      {
        title: "Qualifying — constructors",
        intro: "Both drivers' qualifying points, plus:",
        rows: [
          ["Neither driver reaches Q2", "−1"],
          ["One driver reaches Q2", "+1"],
          ["Both drivers reach Q2", "+3"],
          ["One driver reaches Q3", "+5"],
          ["Both drivers reach Q3", "+10"]
        ]
      },
      {
        title: "Sprint",
        rows: [
          ["1st", "8"], ["2nd", "7"], ["3rd", "6"], ["4th", "5"], ["5th", "4"], ["6th", "3"], ["7th", "2"], ["8th", "1"],
          ["9th–22nd", "0"],
          ["Positions gained", "+1 each"],
          ["Positions lost", "−1 each (max −10)"],
          ["Overtakes", "+1 each"],
          ["Fastest lap", "+5"],
          ["Not classified", "−10"],
          ["Disqualified", "−10, and −10 more to the constructor"]
        ],
        notes: ["Constructors score both drivers' Sprint points."]
      },
      {
        title: "Grand Prix",
        rows: [
          ["1st", "25"], ["2nd", "18"], ["3rd", "15"], ["4th", "12"], ["5th", "10"],
          ["6th", "8"], ["7th", "6"], ["8th", "4"], ["9th", "2"], ["10th", "1"],
          ["11th–22nd", "0"],
          ["Positions gained", "+1 each"],
          ["Positions lost", "−1 each"],
          ["Overtakes", "+1 each"],
          ["Fastest lap", "+10"],
          ["Driver of the Day", "+10 (driver only)"],
          ["Not classified", "−20"],
          ["Disqualified", "−20, and −10 more to the constructor"]
        ],
        notes: [
          "Positions gained and lost count from the official starting grid, not qualifying. Unclassified drivers get the penalty instead of lost positions.",
          "An overtake counts when it's a legal on-track pass of a car that isn't pitting, broken down or going unreasonably slowly."
        ]
      },
      {
        title: "Constructors — Grand Prix",
        intro: "Both drivers' race points (except Driver of the Day), plus points for their fastest pit stop of the race:",
        rows: [
          ["Over 3.0s", "0"],
          ["2.50–2.99s", "+2"],
          ["2.20–2.49s", "+5"],
          ["2.00–2.19s", "+10"],
          ["Under 2.0s", "+20"],
          ["Fastest pit stop of the race", "+5 bonus"],
          ["New world record (1.80s, McLaren, Qatar 2023)", "+15 bonus"]
        ],
        notes: ["No pit stop points in Sprints."]
      },
      {
        title: "Prices",
        rows: [
          ["When they change", "After each race; fixed until the next"],
          ["What moves them", "Average Fantasy score over the last three Grands Prix"],
          ["Range", "$3m to $34m"]
        ]
      }
    ]
  };
  if (typeof module !== "undefined" && module.exports) module.exports = RULES;
  else root.F1F_RULES = RULES;
})(this);
