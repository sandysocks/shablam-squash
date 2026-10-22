export const STARTING_RATING = 1200;
export const K_FACTOR = 32;

export function elo(ratingA, ratingB, aWon) {
  if (![ratingA, ratingB].every(Number.isFinite) || typeof aWon !== 'boolean') {
    throw new Error('Please supply two ratings and a winner.');
  }
  const expected = 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
  const change = Math.round(K_FACTOR * ((aWon ? 1 : 0) - expected));
  return { ratingA: ratingA + change, ratingB: ratingB - change, changeA: change, changeB: -change };
}

export function validateScore(a, b, bestOf = 5) {
  if (![3, 5].includes(bestOf)) throw new Error('Choose best of three or best of five.');
  const target = Math.ceil(bestOf / 2);
  if (![a, b].every(Number.isInteger) || a < 0 || b < 0 ||
      !((a === target && b < target) || (b === target && a < target))) {
    throw new Error(`A best-of-${bestOf} match must finish ${target}–0${target === 3 ? ', 3–1 or 3–2' : ' or 2–1'} (either player can win).`);
  }
  return true;
}

export function localDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function validatePlayedOn(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) ||
      new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value ||
      value > localDate() || value < '2020-01-01') {
    throw new Error('Choose a valid match date between 1 January 2020 and today.');
  }
}

export function rankPlayers(players, matches) {
  return players.map(player => {
    const played = matches.filter(m => m.status === 'confirmed' && [m.player_a, m.player_b].includes(player.id))
      .sort((a, b) => a.confirmed_at.localeCompare(b.confirmed_at));
    const won = m => (m.player_a === player.id ? m.score_a > m.score_b : m.score_b > m.score_a);
    const wins = played.filter(won).length;
    return { ...player, played: played.length, wins, losses: played.length - wins,
      form: played.slice(-5).map(m => won(m) ? 'W' : 'L'),
      lastChange: played.length ? (played.at(-1).player_a === player.id ? played.at(-1).rating_change_a : -played.at(-1).rating_change_a) : 0,
    };
  }).sort((a, b) => b.rating - a.rating || b.wins - a.wins || a.display_name.localeCompare(b.display_name));
}

export function confirmMatch(state, matchId, actorId) {
  const match = state.matches.find(m => m.id === matchId);
  if (!match || match.status !== 'pending') throw new Error('This result is no longer awaiting confirmation.');
  if (![match.player_a, match.player_b].includes(actorId) || match.submitted_by === actorId) {
    throw new Error('The other player must confirm this result.');
  }
  const a = state.players.find(p => p.id === match.player_a);
  const b = state.players.find(p => p.id === match.player_b);
  const result = elo(a.rating, b.rating, match.score_a > match.score_b);
  match.rating_before_a = a.rating;
  match.rating_before_b = b.rating;
  match.rating_change_a = result.changeA;
  match.status = 'confirmed';
  match.confirmed_at = new Date().toISOString();
  a.rating = result.ratingA;
  b.rating = result.ratingB;
  if (match.challenge_id) {
    const challenge = state.challenges.find(c => c.id === match.challenge_id);
    if (challenge) challenge.status = 'completed';
  }
  return result;
}

export function initials(name) {
  return name.trim().split(/\s+/).map(word => [...word][0]).slice(0, 2).join('').toUpperCase();
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function createDemo() {
  const names = ['Beatrice Cole', 'Henry Wells', 'Freddie Clarke', 'Eleanor Reed', 'Arthur Blake', 'Margot Ellis', 'Toby Hughes', 'Florence Shaw'];
  const state = { version: 1, players: names.map((display_name, i) => ({ id: `demo-${i}`, display_name, rating: STARTING_RATING })), matches: [], challenges: [] };
  const fixtures = [[0,1,3,1],[2,3,3,2],[4,5,1,3],[6,7,3,0],[0,2,3,2],[1,4,3,1],[3,6,3,2],[5,7,3,1],
    [0,3,3,0],[2,5,3,1],[1,6,3,2],[4,7,3,1],[0,5,3,2],[2,1,3,1],[3,4,2,3],[6,5,1,3],
    [0,6,3,0],[1,7,3,1],[2,4,3,2],[3,5,3,1],[0,4,2,3],[2,7,3,0],[1,5,3,2],[3,6,3,1]];
  fixtures.forEach(([a,b,score_a,score_b], i) => {
    const when = new Date(Date.now() - (fixtures.length - i) * 86400000);
    const match = { id: `seed-${i}`, player_a: `demo-${a}`, player_b: `demo-${b}`, score_a, score_b, best_of: 5,
      played_on: localDate(when), submitted_by: `demo-${a}`, status: 'pending', created_at: when.toISOString() };
    state.matches.push(match);
    confirmMatch(state, match.id, `demo-${b}`);
    match.confirmed_at = when.toISOString();
  });
  state.challenges = [
    { id: 'challenge-1', challenger: 'demo-1', opponent: 'demo-4', status: 'open', note: 'A friendly rematch this weekend?', created_at: new Date().toISOString() },
    { id: 'challenge-2', challenger: 'demo-2', opponent: 'demo-0', status: 'accepted', note: 'Time to put that unbeaten streak to the test.', created_at: new Date().toISOString() },
    { id: 'challenge-3', challenger: 'demo-4', opponent: 'demo-5', status: 'accepted', note: 'Tuesday evening, if that suits?', created_at: new Date().toISOString() },
  ];
  return state;
}
