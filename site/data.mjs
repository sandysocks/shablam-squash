import { createDemo, confirmMatch, validateScore, validatePlayedOn, STARTING_RATING } from './core.mjs';

const STORAGE_KEY = 'shablam-squash-demo-v1';
const IDENTITY_KEY = 'shablam-squash-demo-player';

export class DemoStore {
  mode = 'demo';
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    this.userId = storage?.getItem(IDENTITY_KEY) || 'demo-4';
  }
  async init() { return this; }
  async load() {
    let state;
    try { state = JSON.parse(this.storage?.getItem(STORAGE_KEY) || 'null'); } catch { /* recover a corrupt local demo */ }
    if (state?.version !== 1 || !Array.isArray(state.players) || !Array.isArray(state.matches) || !Array.isArray(state.challenges)) state = createDemo();
    if (!state.players.some(p => p.id === this.userId)) this.userId = state.players[0].id;
    this.state = state;
    return structuredClone(state);
  }
  save() { this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.state)); }
  async switchPlayer(id) {
    if (!this.state.players.some(p => p.id === id)) throw new Error('Choose a member.');
    this.userId = id;
    this.storage?.setItem(IDENTITY_KEY, id);
  }
  async join(name) {
    name = name.trim();
    if (name.length < 2 || name.length > 40) throw new Error('Use a name between 2 and 40 characters.');
    if (this.state.players.some(p => p.display_name.toLowerCase() === name.toLowerCase())) throw new Error('That name is already in the ladder.');
    const player = { id: crypto.randomUUID(), display_name: name, rating: STARTING_RATING };
    this.state.players.push(player);
    await this.switchPlayer(player.id);
    this.save();
  }
  async challenge(opponent, note) {
    if (opponent === this.userId || !this.state.players.some(p => p.id === opponent)) throw new Error('Choose another member.');
    if (note.length > 240) throw new Error('Keep your note to 240 characters.');
    if (this.state.challenges.some(c => ['open','accepted'].includes(c.status) && [c.challenger,c.opponent].includes(opponent) && [c.challenger,c.opponent].includes(this.userId))) {
      throw new Error('There is already an open challenge between you.');
    }
    this.state.challenges.unshift({ id: crypto.randomUUID(), challenger: this.userId, opponent, note: note.trim(), status: 'open', created_at: new Date().toISOString() });
    this.save();
  }
  async respond(id, action) {
    const c = this.state.challenges.find(c => c.id === id);
    if (!c || !['open','accepted'].includes(c.status)) throw new Error('This challenge is no longer open.');
    if (!((c.opponent === this.userId && c.status === 'open' && ['accepted','declined'].includes(action)) ||
      (c.challenger === this.userId && action === 'cancelled'))) throw new Error('You cannot make that change.');
    if (this.state.matches.some(m => m.challenge_id === id && m.status === 'pending')) throw new Error('Resolve the submitted result first.');
    c.status = action;
    this.save();
  }
  async submitResult({ opponent, scoreA, scoreB, bestOf, playedOn, challengeId = null }) {
    validateScore(scoreA, scoreB, bestOf);
    validatePlayedOn(playedOn);
    if (opponent === this.userId || !this.state.players.some(p => p.id === opponent)) throw new Error('Choose another member.');
    if (this.state.matches.some(m => m.status === 'pending' && [m.player_a,m.player_b].includes(this.userId) && [m.player_a,m.player_b].includes(opponent))) throw new Error('Confirm or dispute your existing result with this player first.');
    if (challengeId) {
      const c = this.state.challenges.find(c => c.id === challengeId);
      if (!c || c.status !== 'accepted' || ![c.challenger,c.opponent].includes(this.userId) || ![c.challenger,c.opponent].includes(opponent)) throw new Error('Choose an accepted challenge.');
    }
    this.state.matches.unshift({ id: crypto.randomUUID(), player_a: this.userId, player_b: opponent, score_a: scoreA, score_b: scoreB,
      best_of: bestOf, played_on: playedOn, challenge_id: challengeId, submitted_by: this.userId, status: 'pending', created_at: new Date().toISOString() });
    this.save();
  }
  async reviewResult(id, accept) {
    const m = this.state.matches.find(m => m.id === id);
    if (accept) confirmMatch(this.state, id, this.userId);
    else {
      if (!m || m.status !== 'pending' || m.submitted_by === this.userId || ![m.player_a,m.player_b].includes(this.userId)) throw new Error('Only the other player can dispute a pending result.');
      m.status = 'disputed';
    }
    this.save();
  }
  async reset() { this.state = createDemo(); this.userId = 'demo-4'; this.storage?.setItem(IDENTITY_KEY, this.userId); this.save(); }
}

export class LiveStore {
  mode = 'live';
  constructor(client) { this.client = client; this.userId = null; }
  async init() {
    const { data, error } = await this.client.auth.getSession();
    if (error) throw error;
    this.userId = data.session?.user.id ?? null;
    return this;
  }
  async load() {
    if (!this.userId) return { players: [], matches: [], challenges: [] };
    const responses = await Promise.all([
      this.readAll('players','id,display_name,rating'),
      this.readAll('matches'),
      this.readAll('challenges'),
    ]);
    return { players: responses[0], matches: responses[1], challenges: responses[2] };
  }
  async readAll(table, columns = '*') {
    const all = [], pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await this.client.from(table).select(columns).order('id').range(offset,offset+pageSize-1);
      if (error) throw error;
      all.push(...data);
      if (data.length < pageSize) return all;
    }
  }
  async rpc(name, args) { const { data, error } = await this.client.rpc(name, args); if (error) throw error; return data; }
  async signIn(email) {
    const { error } = await this.client.auth.signInWithOtp({ email, options: { emailRedirectTo: `${location.origin}${location.pathname}` } });
    if (error) throw error;
  }
  async signOut() { const { error } = await this.client.auth.signOut(); if (error) throw error; this.userId = null; }
  async join(name, invite) { return this.rpc('join_ladder', { p_name: name.trim(), p_invite: invite.trim() }); }
  async challenge(opponent, note) { return this.rpc('issue_challenge', { p_opponent: opponent, p_note: note.trim() }); }
  async respond(id, action) { return this.rpc('respond_to_challenge', { p_id: id, p_action: action }); }
  async submitResult({ opponent, scoreA, scoreB, bestOf, playedOn, challengeId = null }) {
    validateScore(scoreA, scoreB, bestOf); validatePlayedOn(playedOn);
    return this.rpc('submit_result', { p_opponent: opponent, p_score_a: scoreA, p_score_b: scoreB, p_best_of: bestOf, p_played_on: playedOn, p_challenge: challengeId });
  }
  async reviewResult(id, accept) { return this.rpc('review_result', { p_id: id, p_accept: accept }); }
}
