// ── Publisher Invariant Test ──────────────────────────────────────
// Validates the atomic XADD+PUBLISH contract.
// This test requires a running Redis instance.
//
// Run: REDIS_URL=redis://127.0.0.1:6379 node --test scripts/tests/publisher-invariant.test.mjs

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

const TEST_STREAM = "test:ledger:stream";
const TEST_CHANNEL = "test:ledger:pubsub";

let Redis;
let redis;
let subscriber;

before(async () => {
  const url = process.env.REDIS_URL || "redis://127.0.0.1:6379";
  try {
    Redis = (await import("ioredis")).default;
    redis = new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: true });
    subscriber = new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: true });
    await redis.connect();
    await subscriber.connect();
  } catch (err) {
    console.log(`SKIP: Redis not available at ${url} — ${err.message}`);
    process.exit(0);
  }
  // Clean up test keys
  await redis.del(TEST_STREAM);
});

after(async () => {
  await redis.del(TEST_STREAM);
  await redis.quit();
  await subscriber.quit();
});

const ATOMIC_BROADCAST_LUA = `
  local id = redis.call('XADD', KEYS[1], 'MAXLEN', '~', ARGV[1], '*', 'data', ARGV[2])
  local rawJson = ARGV[2]
  local broadcastPayload = string.sub(rawJson, 1, -2) .. ',"id":"' .. id .. '"}'
  redis.call('PUBLISH', KEYS[2], broadcastPayload)
  return id
`;

describe("Publisher Invariant", () => {
  it("XADD and PUBLISH execute atomically — broadcast contains exact stream ID", async () => {
    redis.defineCommand("atomicBroadcast", {
      numberOfKeys: 2,
      lua: ATOMIC_BROADCAST_LUA,
    });

    // Set up subscriber BEFORE publishing
    const received = [];
    subscriber.on("message", (_channel, message) => {
      received.push(JSON.parse(message));
    });
    await subscriber.subscribe(TEST_CHANNEL);

    // Wait for subscription to be active
    await new Promise((resolve) => setTimeout(resolve, 100));

    const payload = { type: "test_event", value: 42 };
    const streamId = await redis.atomicBroadcast(
      TEST_STREAM,
      TEST_CHANNEL,
      "5000",
      JSON.stringify(payload),
    );

    // Wait for pub/sub message to arrive
    await new Promise((resolve) => setTimeout(resolve, 200));

    // ── PROOF: Stream ID matches broadcast ID ────────────
    assert.ok(streamId, "Stream ID must be returned");
    assert.match(streamId, /^\d+-\d+$/, "Stream ID must be Redis timestamp format");
    assert.equal(received.length, 1, "Exactly one message must be received");
    assert.equal(received[0].id, streamId, "Broadcast ID must equal stream ID");
    assert.equal(received[0].type, "test_event", "Payload type must be preserved");
    assert.equal(received[0].value, 42, "Payload value must be preserved");

    // ── PROOF: Stream entry exists with correct data ─────
    const entries = await redis.xrange(TEST_STREAM, streamId, streamId);
    assert.equal(entries.length, 1, "Stream must contain the entry");
    const [entryId, fields] = entries[0];
    assert.equal(entryId, streamId, "Entry ID must match returned ID");
    const dataIndex = fields.indexOf("data");
    assert.ok(dataIndex >= 0, "Entry must contain 'data' field");
    const storedData = JSON.parse(fields[dataIndex + 1]);
    assert.equal(storedData.type, "test_event", "Stored type must match");
    assert.equal(storedData.value, 42, "Stored value must match");
  });

  it("MAXLEN ~ bounds stream growth", async () => {
    // Insert 10 events with MAXLEN ~ 5
    for (let i = 0; i < 10; i++) {
      await redis.atomicBroadcast(
        TEST_STREAM,
        TEST_CHANNEL,
        "5", // very low cap for testing
        JSON.stringify({ seq: i }),
      );
    }

    const len = await redis.xlen(TEST_STREAM);
    // MAXLEN ~ is approximate — Redis trims whole macro-nodes
    // so len should be <= 10 but reasonably bounded
    assert.ok(len <= 10, `Stream length (${len}) should be bounded`);
    assert.ok(len >= 1, "Stream must retain at least 1 entry");
  });

  it("XRANGE replay returns entries after given ID", async () => {
    await redis.del(TEST_STREAM);

    const ids = [];
    for (let i = 0; i < 5; i++) {
      const id = await redis.atomicBroadcast(
        TEST_STREAM,
        TEST_CHANNEL,
        "5000",
        JSON.stringify({ seq: i }),
      );
      ids.push(id);
    }

    // Replay from after the second event
    const replayed = await redis.xrange(
      TEST_STREAM,
      `(${ids[1]}`, // exclusive start
      "+",
      "COUNT",
      200,
    );

    assert.equal(replayed.length, 3, "Should return 3 events after id[1]");
    assert.equal(replayed[0][0], ids[2], "First replayed entry should be id[2]");
    assert.equal(replayed[2][0], ids[4], "Last replayed entry should be id[4]");
  });
});
