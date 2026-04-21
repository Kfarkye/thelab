import test from "node:test";
import assert from "node:assert/strict";
import {
  INITIAL_LIVE_EMIT_STATE,
  mergeLiveEmitPacket,
  parseSseEventPackets,
  shouldAcceptPacket,
} from "../../src/lib/live-emit/client-runtime";
import { coerceLiveEmitPacket } from "../../src/lib/live-emit/types";

test("coerceLiveEmitPacket rejects missing session/sequence", () => {
  const missingSession = coerceLiveEmitPacket({
    id: "x",
    sequence: 1,
    type: "DELTA_UPDATE",
    payload: { timestamp: Date.now() },
  });
  assert.equal(missingSession, null);

  const missingSeq = coerceLiveEmitPacket({
    id: "x",
    session_id: "sess_1",
    type: "DELTA_UPDATE",
    payload: { timestamp: Date.now() },
  });
  assert.equal(missingSeq, null);
});

test("shouldAcceptPacket enforces session + monotonic sequence", () => {
  const state = {
    ...INITIAL_LIVE_EMIT_STATE,
    sessionId: "sess_1",
    lastSequence: 4,
  };
  const stale = coerceLiveEmitPacket({
    id: "stale",
    session_id: "sess_1",
    sequence: 4,
    type: "HEARTBEAT",
    payload: { timestamp: Date.now() },
  });
  assert.ok(stale);
  assert.equal(shouldAcceptPacket(stale, state), false);

  const wrongSession = coerceLiveEmitPacket({
    id: "wrong_session",
    session_id: "sess_2",
    sequence: 5,
    type: "HEARTBEAT",
    payload: { timestamp: Date.now() },
  });
  assert.ok(wrongSession);
  assert.equal(shouldAcceptPacket(wrongSession, state), false);

  const next = coerceLiveEmitPacket({
    id: "next",
    session_id: "sess_1",
    sequence: 5,
    type: "DELTA_UPDATE",
    payload: { componentName: "VetoGauge", props: { level: "High" }, timestamp: Date.now() },
  });
  assert.ok(next);
  assert.equal(shouldAcceptPacket(next, state), true);
});

test("mergeLiveEmitPacket applies DELTA_UPDATE diff merge", () => {
  const packet = coerceLiveEmitPacket({
    id: "delta_1",
    session_id: "sess_1",
    sequence: 1,
    type: "DELTA_UPDATE",
    payload: {
      componentName: "MatchSnapshot",
      props: { title: "Update", marketEdge: 1.2 },
      timestamp: Date.now(),
    },
  });
  assert.ok(packet);
  const merged = mergeLiveEmitPacket(INITIAL_LIVE_EMIT_STATE, packet);
  assert.equal(merged.sessionId, "sess_1");
  assert.equal(merged.lastSequence, 1);
  assert.equal(merged.componentName, "MatchSnapshot");
  assert.equal(merged.props.title, "Update");
});

test("parseSseEventPackets ignores malformed entries and reads valid packet rows", () => {
  const raw = [
    "data: not json",
    "",
    `data: ${JSON.stringify({
      id: "ok_1",
      session_id: "sess_abc",
      sequence: 1,
      type: "COMPONENT_INIT",
      payload: { componentName: "VetoGauge", timestamp: Date.now() },
    })}`,
    "",
    "data: [DONE]",
    "",
  ].join("\n");

  const parsed = parseSseEventPackets(raw);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, "ok_1");
  assert.equal(parsed[0].session_id, "sess_abc");
});

