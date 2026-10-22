import test from 'node:test';
import assert from 'node:assert/strict';
import { elo, validateScore, validatePlayedOn, rankPlayers, confirmMatch, createDemo, localDate, escapeHtml } from '../site/core.mjs';
import { DemoStore } from '../site/data.mjs';

function memoryStorage() {
  const map = new Map();
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) };
}
async function demo() { const store = new DemoStore(memoryStorage()); await store.init(); await store.load(); return store; }

test('equal Elo opponents transfer 16 points, preserving the total', () => {
  assert.deepEqual(elo(1200,1200,true), { ratingA:1216,ratingB:1184,changeA:16,changeB:-16 });
  assert.equal(elo(1200,1200,false).changeA,-16);
  assert.equal(elo(1200,1400,true).changeA,24);
  for (let a = 800; a <= 2000; a += 40) for (let b = 800; b <= 2000; b += 40) {
    const r = elo(a,b,true); assert.equal(r.ratingA + r.ratingB,a+b); assert.ok(r.changeA >= 0 && r.changeA <= 32);
  }
});

test('only completed best-of-three or best-of-five game scores are accepted', () => {
  for (const scores of [[3,0],[3,1],[3,2],[0,3],[1,3],[2,3]]) assert.equal(validateScore(...scores,5),true);
  for (const scores of [[2,0],[2,1],[0,2],[1,2]]) assert.equal(validateScore(...scores,3),true);
  for (const scores of [[0,0],[2,1],[3,3],[4,1],[-1,3],[3,1.5],[3,NaN]]) assert.throws(() => validateScore(...scores,5));
  assert.throws(() => validateScore(3,1,3));
  assert.throws(() => validateScore(4,0,7));
});

test('dates reject future, impossible and malformed entries', () => {
  assert.doesNotThrow(() => validatePlayedOn(localDate()));
  for (const date of ['2099-01-01','2026-02-30','2019-12-31','today','2026-13-01','2026-1-2']) assert.throws(() => validatePlayedOn(date));
});

test('seed history agrees with every player rating and preserves the Elo pool', () => {
  const s = createDemo();
  assert.equal(s.players.reduce((sum,p) => sum+p.rating,0),1200*s.players.length);
  const ratings = new Map(s.players.map(p => [p.id,1200]));
  for (const m of s.matches) {
    const r = elo(ratings.get(m.player_a),ratings.get(m.player_b),m.score_a > m.score_b);
    assert.equal(m.rating_before_a,ratings.get(m.player_a));
    assert.equal(m.rating_change_a,r.changeA);
    ratings.set(m.player_a,r.ratingA); ratings.set(m.player_b,r.ratingB);
  }
  for (const p of s.players) assert.equal(p.rating,ratings.get(p.id));
  const ranks = rankPlayers(s.players,s.matches);
  assert.equal(ranks.reduce((sum,p) => sum+p.played,0),s.matches.length*2);
  assert.equal(ranks.reduce((sum,p) => sum+p.wins,0),s.matches.length);
});

test('a challenge can be accepted only by its intended opponent', async () => {
  const s = await demo();
  await s.switchPlayer('demo-0');
  await assert.rejects(s.respond('challenge-1','accepted'), /cannot/);
  await s.switchPlayer('demo-1');
  await assert.rejects(s.respond('challenge-1','accepted'), /cannot/);
  await s.switchPlayer('demo-4');
  await s.respond('challenge-1','accepted');
  assert.equal(s.state.challenges[0].status,'accepted');
});

test('full challenge → accept → submit → opponent confirmation → rating update', async () => {
  const s = await demo();
  await s.switchPlayer('demo-7');
  await s.challenge('demo-4','A game on Friday?');
  const c = s.state.challenges[0];
  await assert.rejects(s.respond(c.id,'accepted'), /cannot/);
  await s.switchPlayer('demo-4');
  await s.respond(c.id,'accepted');
  const before = s.state.players.map(p => p.rating);
  await s.submitResult({ opponent:'demo-7',scoreA:3,scoreB:2,bestOf:5,playedOn:localDate(),challengeId:c.id });
  const m = s.state.matches[0];
  assert.deepEqual(s.state.players.map(p => p.rating),before);
  await assert.rejects(s.reviewResult(m.id,true), /other player/);
  await s.switchPlayer('demo-1');
  await assert.rejects(s.reviewResult(m.id,true), /other player/);
  await s.switchPlayer('demo-7');
  await s.reviewResult(m.id,true);
  assert.equal(m.status,'confirmed');
  assert.equal(c.status,'completed');
  assert.equal(s.state.players.reduce((sum,p) => sum+p.rating,0),before.reduce((a,b) => a+b,0));
  await assert.rejects(s.reviewResult(m.id,true), /no longer/);
});

test('disputes do not change ratings and permit a corrected submission', async () => {
  const s = await demo();
  const args = { opponent:'demo-7',scoreA:3,scoreB:1,bestOf:5,playedOn:localDate() };
  const before = s.state.players.map(p => p.rating);
  await s.submitResult(args);
  const m = s.state.matches[0];
  await assert.rejects(s.submitResult(args),/existing result/);
  await assert.rejects(s.reviewResult(m.id,false),/other player/);
  await s.switchPlayer('demo-7');
  await s.reviewResult(m.id,false);
  assert.equal(m.status,'disputed');
  assert.deepEqual(s.state.players.map(p => p.rating),before);
  await s.switchPlayer('demo-4');
  await s.submitResult({ ...args,scoreA:1,scoreB:3 });
  assert.equal(s.state.matches[0].status,'pending');
});

test('invalid challenges and result links are rejected', async () => {
  const s = await demo();
  await assert.rejects(s.challenge('demo-4',''),/another member/);
  await assert.rejects(s.challenge('missing',''),/another member/);
  await assert.rejects(s.challenge('demo-1','Rematch'),/already/);
  await assert.rejects(s.submitResult({ opponent:'demo-7',scoreA:3,scoreB:0,bestOf:5,playedOn:localDate(),challengeId:'challenge-3' }),/accepted challenge/);
});

test('new members start at 1200 and the selected member persists', async () => {
  const s = await demo();
  await s.join('New Member');
  assert.equal(s.state.players.at(-1).rating,1200);
  const another = new DemoStore(s.storage); await another.load();
  assert.equal(another.userId,s.userId);
  assert.equal(another.state.players.at(-1).display_name,'New Member');
  await assert.rejects(s.join('new member'),/already/);
});

test('HTML escapes member names and notes', () => {
  assert.equal(escapeHtml('<img src=x onerror="evil()">'), '&lt;img src=x onerror=&quot;evil()&quot;&gt;');
});
