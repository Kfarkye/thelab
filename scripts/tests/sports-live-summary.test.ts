import test from "node:test";
import assert from "node:assert/strict";
import {
  applyLiveSnapshotToGameRecord,
  type CanonicalGameLiveSnapshot,
} from "@/lib/sports/live-snapshot";

function baseGameRecord() {
  return {
    id: "824122",
    status: "SCHEDULED",
    homeScore: null,
    awayScore: null,
    live: null,
    is_live_stale: true,
  } as Record<string, unknown>;
}

test("applies fresh live snapshot to a game record", () => {
  const snapshot: CanonicalGameLiveSnapshot = {
    gameId: "824122",
    leagueId: "mlb",
    sport: "baseball",
    status: "LIVE",
    homeScore: 4,
    awayScore: 5,
    progress: "Top 7",
    source: "mlb_statsapi",
    providerGameId: "824122",
    providerMatchId: "401815101_mlb",
    livePayload: {
      inning: 7,
      half: "TOP",
      last_updated: "2026-04-27T00:27:00.000Z",
    },
    lastSyncAt: "2026-04-27T00:27:00.000Z",
    isLiveStale: false,
  };

  const merged = applyLiveSnapshotToGameRecord(baseGameRecord(), snapshot);

  assert.equal(merged.status, "LIVE");
  assert.equal(merged.homeScore, 4);
  assert.equal(merged.awayScore, 5);
  assert.equal(merged.is_live_stale, false);
  assert.equal((merged.live as Record<string, unknown>).progress, "Top 7");
  assert.equal(merged.providerMatchId, "401815101_mlb");
});

test("keeps LIVE status but clears stale payload", () => {
  const snapshot: CanonicalGameLiveSnapshot = {
    gameId: "824122",
    leagueId: "mlb",
    sport: "baseball",
    status: "LIVE",
    homeScore: 2,
    awayScore: 1,
    progress: "Bottom 5",
    source: "mlb_statsapi",
    providerGameId: "824122",
    providerMatchId: "401815101_mlb",
    livePayload: {
      inning: 5,
      half: "BOTTOM",
      last_updated: "2026-04-26T21:00:00.000Z",
    },
    lastSyncAt: "2026-04-26T21:00:00.000Z",
    isLiveStale: true,
  };

  const merged = applyLiveSnapshotToGameRecord(baseGameRecord(), snapshot);

  assert.equal(merged.status, "LIVE");
  assert.equal(merged.live, null);
  assert.equal(merged.is_live_stale, true);
});

test("applies final snapshot and removes live payload", () => {
  const snapshot: CanonicalGameLiveSnapshot = {
    gameId: "824122",
    leagueId: "mlb",
    sport: "baseball",
    status: "FINAL",
    homeScore: 6,
    awayScore: 3,
    progress: "Final",
    source: "mlb_statsapi",
    providerGameId: "824122",
    providerMatchId: "401815101_mlb",
    livePayload: {
      last_updated: "2026-04-27T02:00:00.000Z",
    },
    lastSyncAt: "2026-04-27T02:00:00.000Z",
    isLiveStale: true,
  };

  const merged = applyLiveSnapshotToGameRecord(baseGameRecord(), snapshot);

  assert.equal(merged.status, "FINAL");
  assert.equal(merged.homeScore, 6);
  assert.equal(merged.awayScore, 3);
  assert.equal(merged.live, null);
});
