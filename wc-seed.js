#!/usr/bin/env node
/**
 * World Cup 2026 — Spanner Data Seeder
 * Seeds: Tournament, 16 Venues, 12 Groups, 48 Teams, TeamTournamentState
 * Source: FIFA.com draw (Dec 5, 2025) + confirmed qualifiers (Mar 31, 2026)
 */

const { Spanner } = require("@google-cloud/spanner");
const crypto = require("crypto");

const PROJECT_ID = "workflowos-a0fbf";
const INSTANCE_ID = "game-data";
const DATABASE_ID = "worldcupdb";

const spanner = new Spanner({ projectId: PROJECT_ID });
const db = spanner.instance(INSTANCE_ID).database(DATABASE_ID);

const uid = () => crypto.randomUUID();
const TOURNAMENT_ID = "wc-2026";
// Use COMMIT_TIMESTAMP for columns with allow_commit_timestamp=true
const NOW = Spanner.COMMIT_TIMESTAMP;

// ── 16 Venues ────────────────────────────────────────────────────────
const VENUES = [
  { id: "v-metlife",     country: "USA",    city: "East Rutherford", state: "New Jersey",   stadium: "MetLife Stadium",              lat: 40.8128, lng: -74.0742, alt: 5,    temp: 26, hum: 65, tz: "America/New_York",       cap: 82500, roof: "open" },
  { id: "v-sofi",        country: "USA",    city: "Inglewood",       state: "California",   stadium: "SoFi Stadium",                 lat: 33.9535, lng: -118.3390, alt: 30,   temp: 22, hum: 55, tz: "America/Los_Angeles",    cap: 70000, roof: "fixed" },
  { id: "v-att",         country: "USA",    city: "Arlington",       state: "Texas",        stadium: "AT&T Stadium",                 lat: 32.7473, lng: -97.0945,  alt: 184,  temp: 33, hum: 55, tz: "America/Chicago",        cap: 94000, roof: "retractable" },
  { id: "v-nrg",         country: "USA",    city: "Houston",         state: "Texas",        stadium: "NRG Stadium",                  lat: 29.6847, lng: -95.4107,  alt: 15,   temp: 32, hum: 75, tz: "America/Chicago",        cap: 72000, roof: "retractable" },
  { id: "v-hardrock",    country: "USA",    city: "Miami Gardens",   state: "Florida",      stadium: "Hard Rock Stadium",            lat: 25.9580, lng: -80.2389,  alt: 3,    temp: 31, hum: 78, tz: "America/New_York",       cap: 65000, roof: "open" },
  { id: "v-mercedes",    country: "USA",    city: "Atlanta",         state: "Georgia",      stadium: "Mercedes-Benz Stadium",        lat: 33.7554, lng: -84.4010,  alt: 320,  temp: 30, hum: 68, tz: "America/New_York",       cap: 75000, roof: "retractable" },
  { id: "v-gillette",    country: "USA",    city: "Foxborough",      state: "Massachusetts", stadium: "Gillette Stadium",             lat: 42.0909, lng: -71.2643,  alt: 50,   temp: 24, hum: 60, tz: "America/New_York",       cap: 65000, roof: "open" },
  { id: "v-arrowhead",   country: "USA",    city: "Kansas City",     state: "Missouri",     stadium: "Arrowhead Stadium",            lat: 39.0489, lng: -94.4839,  alt: 280,  temp: 30, hum: 65, tz: "America/Chicago",        cap: 73000, roof: "open" },
  { id: "v-lincoln",     country: "USA",    city: "Philadelphia",    state: "Pennsylvania", stadium: "Lincoln Financial Field",       lat: 39.9008, lng: -75.1676,  alt: 10,   temp: 28, hum: 65, tz: "America/New_York",       cap: 69000, roof: "open" },
  { id: "v-lumen",       country: "USA",    city: "Seattle",         state: "Washington",   stadium: "Lumen Field",                  lat: 47.5952, lng: -122.3316, alt: 5,    temp: 20, hum: 55, tz: "America/Los_Angeles",    cap: 69000, roof: "open" },
  { id: "v-levis",       country: "USA",    city: "Santa Clara",     state: "California",   stadium: "Levi's Stadium",               lat: 37.4033, lng: -121.9694, alt: 15,   temp: 24, hum: 50, tz: "America/Los_Angeles",    cap: 71000, roof: "open" },
  { id: "v-bmo",         country: "Canada", city: "Toronto",         state: "Ontario",      stadium: "BMO Field",                    lat: 43.6335, lng: -79.4186,  alt: 80,   temp: 24, hum: 60, tz: "America/Toronto",        cap: 45000, roof: "open" },
  { id: "v-bcplace",     country: "Canada", city: "Vancouver",       state: "British Columbia", stadium: "BC Place",                 lat: 49.2768, lng: -123.1117, alt: 5,    temp: 19, hum: 55, tz: "America/Vancouver",      cap: 54000, roof: "retractable" },
  { id: "v-azteca",      country: "Mexico", city: "Mexico City",     state: "CDMX",         stadium: "Estadio Azteca",               lat: 19.3029, lng: -99.1505,  alt: 2240, temp: 22, hum: 50, tz: "America/Mexico_City",    cap: 83000, roof: "open" },
  { id: "v-akron",       country: "Mexico", city: "Guadalajara",     state: "Jalisco",      stadium: "Estadio Akron",                lat: 20.6818, lng: -103.4625, alt: 1566, temp: 28, hum: 45, tz: "America/Mexico_City",    cap: 48000, roof: "open" },
  { id: "v-bbva",        country: "Mexico", city: "Monterrey",       state: "Nuevo León",   stadium: "Estadio BBVA",                 lat: 25.6715, lng: -100.2461, alt: 540,  temp: 33, hum: 55, tz: "America/Monterrey",      cap: 53500, roof: "open" },
];

// ── 12 Groups ────────────────────────────────────────────────────────
const GROUPS = [
  { code: "A", name: "Group A", city: "Mexico City" },
  { code: "B", name: "Group B", city: "Toronto" },
  { code: "C", name: "Group C", city: "Los Angeles" },
  { code: "D", name: "Group D", city: "Houston" },
  { code: "E", name: "Group E", city: "Atlanta" },
  { code: "F", name: "Group F", city: "Philadelphia" },
  { code: "G", name: "Group G", city: "Seattle" },
  { code: "H", name: "Group H", city: "Dallas" },
  { code: "I", name: "Group I", city: "Miami" },
  { code: "J", name: "Group J", city: "Kansas City" },
  { code: "K", name: "Group K", city: "San Francisco" },
  { code: "L", name: "Group L", city: "Boston" },
];

// ── 48 Teams (FIFA.com confirmed draw + Mar 31 qualifiers) ──────────
// Source: [1] fifa.com, [8] fifa.com draw results
const TEAMS = [
  // Group A
  { code: "MEX", name: "Mexico",               conf: "CONCACAF", rank: 15, pot: 1, group: "A", titles: 0 },
  { code: "RSA", name: "South Africa",          conf: "CAF",      rank: 62, pot: 4, group: "A", titles: 0 },
  { code: "KOR", name: "South Korea",           conf: "AFC",      rank: 22, pot: 3, group: "A", titles: 0 },
  { code: "CZE", name: "Czechia",               conf: "UEFA",     rank: 37, pot: 3, group: "A", titles: 0 },
  // Group B
  { code: "CAN", name: "Canada",                conf: "CONCACAF", rank: 42, pot: 1, group: "B", titles: 0 },
  { code: "BIH", name: "Bosnia and Herzegovina", conf: "UEFA",    rank: 57, pot: 4, group: "B", titles: 0 },
  { code: "QAT", name: "Qatar",                 conf: "AFC",      rank: 68, pot: 4, group: "B", titles: 0 },
  { code: "SUI", name: "Switzerland",            conf: "UEFA",     rank: 19, pot: 2, group: "B", titles: 0 },
  // Group C
  { code: "BRA", name: "Brazil",                conf: "CONMEBOL", rank: 5,  pot: 1, group: "C", titles: 5 },
  { code: "MAR", name: "Morocco",               conf: "CAF",      rank: 14, pot: 2, group: "C", titles: 0 },
  { code: "HAI", name: "Haiti",                 conf: "CONCACAF", rank: 83, pot: 4, group: "C", titles: 0 },
  { code: "SCO", name: "Scotland",              conf: "UEFA",     rank: 45, pot: 3, group: "C", titles: 0 },
  // Group D
  { code: "USA", name: "United States",         conf: "CONCACAF", rank: 11, pot: 1, group: "D", titles: 0 },
  { code: "PAR", name: "Paraguay",              conf: "CONMEBOL", rank: 52, pot: 3, group: "D", titles: 0 },
  { code: "AUS", name: "Australia",             conf: "AFC",      rank: 25, pot: 3, group: "D", titles: 0 },
  { code: "TUR", name: "Türkiye",               conf: "UEFA",     rank: 32, pot: 2, group: "D", titles: 0 },
  // Group E
  { code: "GER", name: "Germany",               conf: "UEFA",     rank: 8,  pot: 1, group: "E", titles: 4 },
  { code: "CUW", name: "Curaçao",               conf: "CONCACAF", rank: 105,pot: 4, group: "E", titles: 0 },
  { code: "CIV", name: "Côte d'Ivoire",         conf: "CAF",      rank: 38, pot: 3, group: "E", titles: 0 },
  { code: "ECU", name: "Ecuador",               conf: "CONMEBOL", rank: 30, pot: 2, group: "E", titles: 0 },
  // Group F
  { code: "NED", name: "Netherlands",           conf: "UEFA",     rank: 3,  pot: 1, group: "F", titles: 0 },
  { code: "JPN", name: "Japan",                 conf: "AFC",      rank: 12, pot: 2, group: "F", titles: 0 },
  { code: "SWE", name: "Sweden",                conf: "UEFA",     rank: 46, pot: 3, group: "F", titles: 0 },
  { code: "TUN", name: "Tunisia",               conf: "CAF",      rank: 39, pot: 4, group: "F", titles: 0 },
  // Group G
  { code: "BEL", name: "Belgium",               conf: "UEFA",     rank: 6,  pot: 1, group: "G", titles: 0 },
  { code: "EGY", name: "Egypt",                 conf: "CAF",      rank: 33, pot: 3, group: "G", titles: 0 },
  { code: "IRN", name: "IR Iran",               conf: "AFC",      rank: 31, pot: 3, group: "G", titles: 0 },
  { code: "NZL", name: "New Zealand",           conf: "OFC",      rank: 93, pot: 4, group: "G", titles: 0 },
  // Group H
  { code: "ESP", name: "Spain",                 conf: "UEFA",     rank: 2,  pot: 1, group: "H", titles: 1 },
  { code: "CPV", name: "Cabo Verde",            conf: "CAF",      rank: 67, pot: 4, group: "H", titles: 0 },
  { code: "KSA", name: "Saudi Arabia",          conf: "AFC",      rank: 56, pot: 3, group: "H", titles: 0 },
  { code: "URU", name: "Uruguay",               conf: "CONMEBOL", rank: 9,  pot: 2, group: "H", titles: 2 },
  // Group I
  { code: "FRA", name: "France",                conf: "UEFA",     rank: 4,  pot: 1, group: "I", titles: 2 },
  { code: "SEN", name: "Senegal",               conf: "CAF",      rank: 21, pot: 2, group: "I", titles: 0 },
  { code: "IRQ", name: "Iraq",                  conf: "AFC",      rank: 61, pot: 4, group: "I", titles: 0 },
  { code: "NOR", name: "Norway",                conf: "UEFA",     rank: 44, pot: 3, group: "I", titles: 0 },
  // Group J
  { code: "ARG", name: "Argentina",             conf: "CONMEBOL", rank: 1,  pot: 1, group: "J", titles: 3 },
  { code: "ALG", name: "Algeria",               conf: "CAF",      rank: 36, pot: 3, group: "J", titles: 0 },
  { code: "AUT", name: "Austria",               conf: "UEFA",     rank: 23, pot: 2, group: "J", titles: 0 },
  { code: "JOR", name: "Jordan",                conf: "AFC",      rank: 70, pot: 4, group: "J", titles: 0 },
  // Group K
  { code: "POR", name: "Portugal",              conf: "UEFA",     rank: 7,  pot: 1, group: "K", titles: 0 },
  { code: "COL", name: "Colombia",              conf: "CONMEBOL", rank: 10, pot: 2, group: "K", titles: 0 },
  { code: "UZB", name: "Uzbekistan",            conf: "AFC",      rank: 55, pot: 4, group: "K", titles: 0 },
  { code: "COD", name: "DR Congo",              conf: "CAF",      rank: 51, pot: 3, group: "K", titles: 0 },
  // Group L
  { code: "ENG", name: "England",               conf: "UEFA",     rank: 13, pot: 1, group: "L", titles: 1 },
  { code: "CRO", name: "Croatia",               conf: "UEFA",     rank: 16, pot: 2, group: "L", titles: 0 },
  { code: "GHA", name: "Ghana",                 conf: "CAF",      rank: 48, pot: 3, group: "L", titles: 0 },
  { code: "PAN", name: "Panama",                conf: "CONCACAF", rank: 54, pot: 4, group: "L", titles: 0 },
];

async function seed() {
  console.log("🏆 Seeding World Cup 2026 data into Spanner...");

  await db.runTransactionAsync(async (transaction) => {
    // 1. Tournament
    console.log("  → Tournament...");
    transaction.upsert("Tournament", [{
      TournamentID: TOURNAMENT_ID,
      Slug: "world-cup-2026",
      Name: "FIFA World Cup 2026",
      Year: 2026,
      FormatVersion: "48-team",
      Phase: "pre-tournament",
      HostCountries: JSON.stringify(["United States", "Mexico", "Canada"]),
      HostCities: JSON.stringify(VENUES.map(v => v.city)),
      CreatedAt: NOW,
      UpdatedAt: NOW,
    }]);

    // 2. Venues
    console.log("  → 16 Venues...");
    transaction.upsert("Venue", VENUES.map(v => ({
      VenueID: v.id,
      Country: v.country,
      City: v.city,
      StateProvince: v.state,
      StadiumName: v.stadium,
      Latitude: Spanner.float(v.lat),
      Longitude: Spanner.float(v.lng),
      AltitudeM: Spanner.float(v.alt),
      TypicalTempC: Spanner.float(v.temp),
      TypicalHumidityPct: Spanner.float(v.hum),
      Timezone: v.tz,
      Capacity: v.cap,
      RoofType: v.roof,
      SurfaceType: "grass",
      CreatedAt: NOW,
      UpdatedAt: NOW,
    })));

    // 3. Groups
    console.log("  → 12 Groups...");
    transaction.upsert("WCGroup", GROUPS.map(g => ({
      GroupID: `wc-2026-group-${g.code.toLowerCase()}`,
      TournamentID: TOURNAMENT_ID,
      GroupCode: g.code,
      DisplayName: g.name,
      HostCity: g.city,
      CreatedAt: NOW,
      UpdatedAt: NOW,
    })));

    // 4. Teams
    console.log("  → 48 Teams...");
    transaction.upsert("Team", TEAMS.map(t => ({
      TeamID: `wc-2026-${t.code.toLowerCase()}`,
      TournamentID: TOURNAMENT_ID,
      FifaCode: t.code,
      Name: t.name,
      Slug: t.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, ""),
      Confederation: t.conf,
      FifaRanking: t.rank,
      Pot: t.pot,
      GroupCode: t.group,
      FlagUri: `https://flagcdn.com/w80/${t.code.toLowerCase().slice(0,2)}.png`,
      HeadCoach: null,
      AverageAge: Spanner.float(27.0),
      SquadDepthScore: null,
      WorldCupTitles: t.titles,
      CreatedAt: NOW,
      UpdatedAt: NOW,
    })));

    // 5. TeamTournamentState (initial — all zeros)
    console.log("  → 48 TeamTournamentState (initial)...");
    transaction.upsert("TeamTournamentState", TEAMS.map(t => ({
      TeamTournamentStateID: `wc-2026-state-${t.code.toLowerCase()}`,
      TournamentID: TOURNAMENT_ID,
      TeamID: `wc-2026-${t.code.toLowerCase()}`,
      GroupID: `wc-2026-group-${t.group.toLowerCase()}`,
      Played: 0,
      Won: 0,
      Drawn: 0,
      Lost: 0,
      Points: 0,
      GoalDifference: 0,
      GoalsScored: 0,
      GoalsAgainst: 0,
      FairPlayScore: 0,
      YellowCards: 0,
      RedCards: 0,
      CurrentPositionInGroup: null,
      CurrentlyAdvancing: false,
      CurrentPathProbability: null,
      CreatedAt: NOW,
      UpdatedAt: NOW,
    })));

    await transaction.commit();
  });

  console.log("✅ Seeded: 1 tournament, 16 venues, 12 groups, 48 teams, 48 states");
  await db.close();
  process.exit(0);
}

seed().catch(err => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});

