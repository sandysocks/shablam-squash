import { rankPlayers, initials, escapeHtml as e, localDate } from './core.mjs';
import { DemoStore, LiveStore } from './data.mjs';

const $ = selector => document.querySelector(selector);
const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const config = window.SHABLAM_CONFIG || {};
const modal = $('#modal');
let store, state = { players: [], matches: [], challenges: [] }, view = 'ladder', search = '', visibleCount = 20;
let toastTimer, refreshPromise;
const nameOf = id => state.players.find(p => p.id === id)?.display_name || 'Former member';
const me = () => state.players.find(p => p.id === store?.userId);
const memberIds = c => [c.challenger, c.opponent];
const dateLabel = value => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' }).format(new Date(value.length === 10 ? `${value}T12:00:00Z` : value));
const badge = (text, type = '') => `<span class="badge ${e(type)}">${e(text)}</span>`;
const empty = (heading, text) => `<div class="empty-state"><h3>${e(heading)}</h3><p>${e(text)}</p></div>`;

function notify(message, error = false) {
  const toast = $('#toast');
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.toggle('error', error);
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, error ? 7000 : 5000);
}

function showModal(title, content) {
  $('#modal-content').innerHTML = `<h2 id="modal-title">${e(title)}</h2>${content}`;
  if (!modal.open) modal.showModal();
}

function formMessage(form, message, success = false) {
  const el = form.querySelector('.form-message');
  el.textContent = message;
  el.classList.toggle('success', success);
  el.hidden = false;
}

const messageArea = '<p class="form-message" role="alert" hidden></p>';
const playerOptions = (selected = '') => state.players.filter(p => p.id !== store.userId).sort((a,b) => a.display_name.localeCompare(b.display_name))
  .map(p => `<option value="${e(p.id)}" ${selected === p.id ? 'selected' : ''}>${e(p.display_name)} · ${p.rating}</option>`).join('');

function requireMember() {
  if (me()) return true;
  openAccount();
  return false;
}

function openChallenge(opponent = '') {
  if (!requireMember()) return;
  if (state.players.length < 2) { notify('Invite another friend to the ladder first.'); return; }
  showModal('Throw down the gauntlet.', `<p class="intro">Any player. Any rating. A good match starts with a friendly challenge.</p>
    <form id="challenge-form"><label for="opponent">Your opponent</label><select id="opponent" name="opponent" required><option value="">Choose a club member</option>${playerOptions(opponent)}</select>
    <label for="note">A note for your opponent <span class="form-hint">(optional)</span></label><textarea id="note" name="note" maxlength="240" placeholder="Fancy a game this weekend?"></textarea>
    <p class="form-hint">Agree a court and time between yourselves. Your challenge will appear on the club board.</p>${messageArea}<button class="button button-primary" type="submit">Issue the challenge ${icon('arrow')}</button></form>`);
}

function openResult(opponent = '', challengeId = '') {
  if (!requireMember()) return;
  if (state.players.length < 2) { notify('Invite another friend to the ladder first.'); return; }
  showModal('For the club records.', `<p class="intro">Played a match? Enter the games won by each player. Your opponent confirms it before ratings change.</p>
    <form id="result-form"><input type="hidden" name="challengeId" value="${e(challengeId)}"><label for="result-opponent">Your opponent</label><select name="opponent" id="result-opponent" required ${challengeId ? 'aria-describedby="linked-challenge"' : ''}><option value="">Choose a club member</option>${playerOptions(opponent)}</select>
    ${challengeId ? '<p class="form-hint" id="linked-challenge">Linked to your accepted challenge. Keep the selected opponent.</p>' : ''}
    <div class="form-row"><div><label for="best-of">Match format</label><select name="bestOf" id="best-of"><option value="5">Best of five games</option><option value="3">Best of three games</option></select></div><div><label for="played-on">Date played</label><input type="date" id="played-on" name="playedOn" value="${localDate()}" min="2020-01-01" max="${localDate()}" required></div></div>
    <div class="form-row"><div><label for="score-a">Your games won</label><input name="scoreA" id="score-a" type="number" inputmode="numeric" min="0" max="3" step="1" placeholder="3" required></div><div><label for="score-b">Opponent’s games won</label><input name="scoreB" id="score-b" type="number" inputmode="numeric" min="0" max="3" step="1" placeholder="1" required></div></div>
    <p class="form-hint">Best of five: first to 3 games. Best of three: first to 2.</p>${messageArea}<button type="submit" class="button button-primary">Submit for confirmation ${icon('arrow')}</button></form>`);
}

function openRules() {
  showModal('A few club customs.', `<p class="intro">An open ladder. A fair rating. A reason to book the next court.</p><ol class="rules-list">
    <li><strong>Challenge anyone.</strong> There are no divisions or restrictions on who you play. Accept a challenge on the board, then arrange the court and time yourselves.</li>
    <li><strong>Play best of five.</strong> Or agree best of three before starting. Enter the number of games won, rather than individual rally points.</li>
    <li><strong>Both players agree.</strong> One records the score; the other confirms or disputes it. A disputed result has no effect. Submit a corrected result once you agree.</li>
    <li><strong>Start at 1,200 Elo.</strong> A win adds points; a loss removes the same amount. The opponent’s rating determines how many. The K-factor is 32.</li>
    <li><strong>Upsets are rewarded.</strong> A win against a higher rated opponent earns more. The match winner matters; the game margin does not.</li>
    <li><strong>Keep it sporting.</strong> Ratings update in confirmation order, using both players’ current ratings. New members appear immediately; ties use wins, then name.</li></ol>
    <div class="rules-example">Two players rated 1,200: winner +16, loser −16.<br>A 1,200 player beats a 1,400 player: winner +24, loser −24.</div><button class="button button-primary" data-action="close">Splendid. Let’s play. ${icon('racket')}</button>`);
}

function openAccount() {
  if (store.mode === 'demo') {
    showModal('Welcome to the club.', `<p class="intro">You’re in the demonstration club. Names and matches are fictional; changes stay in this browser.</p>
      <form id="switch-form"><label for="demo-player">Try the site as a member</label><select id="demo-player" name="player">${state.players.map(p => `<option value="${e(p.id)}" ${p.id === store.userId ? 'selected' : ''}>${e(p.display_name)}</option>`).join('')}</select>${messageArea}<button class="button button-primary" type="submit">Enter the club ${icon('arrow')}</button></form>
      <hr class="modal-divider"><form id="join-form"><label for="join-name">Or add yourself to the demo</label><input id="join-name" name="name" placeholder="Your name" minlength="2" maxlength="40" required autocomplete="name">${messageArea}<button class="button button-outline" type="submit">Join the demo ladder ${icon('plus')}</button></form>
      <button type="button" class="small-action danger" data-action="reset">Reset demonstration data…</button>`);
  } else if (!store.userId) {
    showModal('The members’ entrance.', `<p class="intro">Sign in by email. We’ll send a link to bring you straight back to the club.</p><form id="signin-form"><label for="email">Email address</label><input id="email" name="email" type="email" autocomplete="email" required placeholder="you@example.com">${messageArea}<button class="button button-primary" type="submit">Send my sign-in link ${icon('arrow')}</button></form><p class="form-hint">New member? Sign in first, then enter the club invitation code.</p>`);
  } else if (!me()) {
    showModal('A place on the ladder.', `<p class="intro">You’re signed in. Use the invitation code from a friend to join Shablam Squash.</p><form id="join-form"><label for="join-name">Your name on the ladder</label><input id="join-name" name="name" autocomplete="name" minlength="2" maxlength="40" required><label for="invite-code">Club invitation code</label><input id="invite-code" name="invite" autocomplete="off" required maxlength="200">${messageArea}<button class="button button-primary" type="submit">Join the club ${icon('arrow')}</button></form><button class="small-action" data-action="signout">Sign out</button>`);
  } else {
    const ranked = rankPlayers(state.players, state.matches);
    const player = ranked.find(p => p.id === store.userId);
    showModal('Your place in the club.', `<div class="account-summary"><strong>${e(player.display_name)}</strong><p>No. ${ranked.findIndex(p => p.id === player.id) + 1} · ${player.rating.toLocaleString('en-GB')} Elo · ${player.played} matches played</p></div><p class="intro">Your identity is linked to your email. Only you can issue your challenges and confirm your opponents’ results.</p><button class="button button-primary" data-action="invite">Invite a friend ${icon('arrow')}</button><button class="small-action" data-action="signout">Sign out</button>`);
  }
}

function openInvite() {
  if (store.mode === 'demo') {
    showModal('Room for your friends.', `<p class="intro">The demonstration lives in this browser. Try adding a member, or connect the shared club before inviting friends.</p><p class="form-hint">The project README has the GitHub Pages and database setup. Once connected, friends sign in by email and join with your private invitation code.</p><button class="button button-primary" data-action="account">Add a demo member ${icon('plus')}</button>`);
    return;
  }
  if (!requireMember()) return;
  showModal('A new face at the club.', `<p class="intro">Share the club link with a friend. Give them the invitation code separately so they can join after signing in.</p><label for="club-link">The club link</label><input id="club-link" value="${e(`${location.origin}${location.pathname}`)}" readonly><button class="button button-primary" data-action="copy-link">Copy club link ${icon('arrow')}</button><p class="form-hint">Ask your organiser for the invitation code. It is kept out of the public website.</p>`);
}

function render() {
  const ranked = rankPlayers(state.players, state.matches);
  const openChallenges = state.challenges.filter(c => c.status === 'open');
  const activeChallenges = state.challenges.filter(c => ['open','accepted'].includes(c.status));
  $('#nav-count').textContent = activeChallenges.length;
  const player = me();
  $('#member-button').innerHTML = `<span class="avatar avatar-small">${player ? e(initials(player.display_name)) : 'S'}</span><span>${player ? e(player.display_name.split(' ')[0]) : 'Sign in'}</span><span class="member-chevron">⌄</span>`;
  const banner = $('#mode-banner');
  banner.hidden = false;
  if (store.mode === 'demo') banner.innerHTML = `<span><strong>A peek inside the club.</strong> Demo data · saved in this browser only.</span><button data-action="account">Switch member ${icon('chevron')}</button>`;
  else if (!player) banner.innerHTML = `<span>${store.userId ? 'You’re signed in. Join with your club invitation code to see the ladder.' : 'The club ladder is for members. Sign in to see the rankings and join the next match.'}</span><button data-action="account">${store.userId ? 'Join the ladder' : 'Members’ entrance'}</button>`;
  else { banner.hidden = true; banner.innerHTML = ''; }
  $('#stats-strip').innerHTML = `<div><span class="stat-label">IN THE CLUB</span><strong>${state.players.length}<small>${state.players.length === 1 ? 'member' : 'members'}</small></strong></div><div><span class="stat-label">ON THE RECORD</span><strong>${state.matches.filter(m => m.status === 'confirmed').length}<small>matches played</small></strong></div><div><span class="stat-label">THE GAUNTLET IS DOWN</span><strong>${openChallenges.length}<small>open challenges</small></strong></div><div><span class="stat-label">TOP OF THE LADDER</span><strong class="leader-name"><span class="leader-crown">${icon('crown')}</span>${ranked.length ? e(ranked[0].display_name.split(' ')[0] + ' ' + ranked[0].display_name.split(' ').slice(1).map(n => n[0] + '.').join(' ')) : 'A place awaits'}</strong></div>`;
  renderBoard();
  renderNotices();
}

function renderBoard() {
  const headings = { ladder: ['THE CURRENT PECKING ORDER', 'The club ladder'], challenges: ['A FRIENDLY CALL TO COURT', 'The challenge board'], ledger: ['EVERY RIVALRY HAS A HISTORY', 'The match ledger'] };
  $('#board-kicker').textContent = headings[view][0];
  $('#board-heading').innerHTML = `${headings[view][1]}<span>.</span>`;
  document.querySelectorAll('[data-view]').forEach(b => { if (b.closest('.view-tabs')) { b.classList.toggle('selected', b.dataset.view === view); b.setAttribute('aria-pressed', b.dataset.view === view); } });
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === view));
  const content = $('#board-content');
  if (store.mode === 'live' && !me()) {
    content.innerHTML = `${empty('A club among friends.', 'Sign in and use your invitation code to take your place.')}<button class="button button-primary" style="display:flex;margin:0 auto 24px" data-action="account">${store.userId ? 'Join the club' : 'Sign in to the club'} ${icon('arrow')}</button>`;
    return;
  }
  if (view === 'ladder') content.innerHTML = renderLadder();
  if (view === 'challenges') content.innerHTML = renderChallenges();
  if (view === 'ledger') content.innerHTML = renderLedger();
  $('#board-footer-text').textContent = view === 'ladder' ? 'Elo ratings · Starting at 1,200 · K-factor 32' : view === 'ledger' ? 'Only confirmed results affect the ladder.' : 'Any member. Any opponent. Your next good game.';
}

function renderLadder() {
  const ranked = rankPlayers(state.players, state.matches);
  const filtered = ranked.filter(p => p.display_name.toLowerCase().includes(search));
  if (!filtered.length) return empty('No one by that name.', 'Try another search or invite your first opponent.');
  return `<table class="ladder-table"><caption class="sr-only" style="position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)">Club members ordered by Elo rating</caption><thead><tr><th scope="col">Rank</th><th scope="col">Player</th><th scope="col">Elo</th><th scope="col" class="hide-mobile">P</th><th scope="col" class="hide-mobile">W / L</th><th scope="col">Form</th><th scope="col"><span class="sr-only">Challenge</span></th></tr></thead><tbody>${filtered.map(p => {
    const rank = ranked.findIndex(r => r.id === p.id) + 1;
    return `<tr class="${p.id === store.userId ? 'is-me' : ''}"><td class="rank">${rank === 1 ? `<span style="color:var(--gold)" title="Ladder leader">${icon('crown')}</span>` : String(rank).padStart(2,'0')}</td><td><div class="player-cell"><span class="avatar" aria-hidden="true">${e(initials(p.display_name))}</span><span class="player-name">${e(p.display_name)}${p.id === store.userId ? '<span class="you-label">YOU</span>' : ''}</span></div></td><td class="rating">${p.rating.toLocaleString('en-GB')}${p.played ? `<span class="rating-delta ${p.lastChange < 0 ? 'negative' : ''}">${p.lastChange >= 0 ? '+' : '−'}${Math.abs(p.lastChange)} last match</span>` : '<span class="rating-delta">New member</span>'}</td><td class="hide-mobile">${p.played}</td><td class="hide-mobile">${p.wins} / ${p.losses}</td><td><div class="form-dots" aria-label="Last five matches, oldest first: ${p.form.join(', ') || 'none'}">${p.form.length ? p.form.map(r => `<span class="form-dot ${r === 'L' ? 'loss' : ''}" aria-hidden="true">${r}</span>`).join('') : '—'}</div></td><td>${p.id === store.userId ? '<span class="self-label">You</span>' : `<button class="table-challenge" data-action="challenge" data-player="${e(p.id)}" aria-label="Challenge ${e(p.display_name)}"><span class="challenge-word">Challenge</span>${icon('racket')}</button>`}</td></tr>`;
  }).join('')}</tbody></table>`;
}

function challengeActions(c) {
  if (!memberIds(c).includes(store.userId)) return '';
  const pending = state.matches.some(m => m.challenge_id === c.id && m.status === 'pending');
  if (pending) return `<button class="text-button" data-view="ledger">Result awaiting confirmation ${icon('arrow')}</button>`;
  const button = (label, action, primary = false) => `<button class="button ${primary ? 'button-primary' : 'button-outline'}" data-action="respond" data-id="${e(c.id)}" data-response="${action}">${label}</button>`;
  let html = '';
  if (c.status === 'open' && c.opponent === store.userId) html += button('Accept challenge', 'accepted', true) + button('Decline', 'declined');
  if (c.status === 'accepted') html += `<button class="button button-primary" data-action="result" data-player="${e(c.challenger === store.userId ? c.opponent : c.challenger)}" data-id="${e(c.id)}">Record result ${icon('plus')}</button>`;
  if (['open','accepted'].includes(c.status) && c.challenger === store.userId) html += button('Withdraw', 'cancelled');
  return html;
}

function renderChallenges() {
  const list = state.challenges.filter(c => ['open','accepted'].includes(c.status) && `${nameOf(c.challenger)} ${nameOf(c.opponent)}`.toLowerCase().includes(search));
  list.sort((a,b) => Number(memberIds(b).includes(store.userId)) - Number(memberIds(a).includes(store.userId)) || b.created_at.localeCompare(a.created_at));
  if (!list.length) return empty('The court is yours.', search ? 'No challenges match your search.' : 'Issue a challenge to get the next rivalry under way.');
  return list.map(c => `<article class="board-card"><div class="board-card-top"><h3>${e(nameOf(c.challenger))}<span class="versus">v.</span>${e(nameOf(c.opponent))}</h3>${badge(c.status === 'accepted' ? 'Game on' : 'Challenge issued', c.status === 'open' ? 'open' : '')}</div>${c.note ? `<p class="note">“${e(c.note)}”</p>` : ''}<p class="meta">Issued ${dateLabel(c.created_at)}${memberIds(c).includes(store.userId) ? ' · Your challenge' : ''}</p><div class="actions">${challengeActions(c)}</div></article>`).join('');
}

function reviewButtons(m) {
  if (m.status !== 'pending') return '';
  if (m.submitted_by === store.userId) return '<p class="meta">Waiting for your opponent to confirm.</p>';
  if (![m.player_a,m.player_b].includes(store.userId)) return '';
  return `<div class="ledger-controls"><button class="button button-primary" data-action="review" data-id="${e(m.id)}" data-accept="true">Confirm result ${icon('check')}</button><button class="button button-outline" data-action="dispute" data-id="${e(m.id)}">Dispute score</button></div>`;
}

function renderLedger() {
  const list = state.matches.filter(m => `${nameOf(m.player_a)} ${nameOf(m.player_b)}`.toLowerCase().includes(search));
  list.sort((a,b) => Number(b.status === 'pending') - Number(a.status === 'pending') || (b.confirmed_at || b.created_at).localeCompare(a.confirmed_at || a.created_at));
  if (!list.length) return empty('A clean page in the ledger.', search ? 'No matches found. Try another name.' : 'Record your first match to start the story.');
  const pending = list.filter(m => m.status === 'pending' && m.submitted_by !== store.userId && [m.player_a,m.player_b].includes(store.userId));
  return (pending.length ? `<div class="pending-callout"><strong>${pending.length} result${pending.length > 1 ? 's' : ''} for your attention.</strong>Confirm the score below to update the ladder.</div>` : '') + list.slice(0,visibleCount).map(m => {
    const winnerId = m.score_a > m.score_b ? m.player_a : m.player_b;
    const delta = m.rating_change_a ?? 0;
    const change = id => (id === m.player_a ? delta : -delta);
    return `<article class="board-card"><div class="board-card-top"><div class="ledger-players"><h3 class="${winnerId === m.player_a ? 'ledger-winner' : ''}">${e(nameOf(m.player_a))}</h3><span class="score">${m.score_a}–${m.score_b}</span><h3 class="${winnerId === m.player_b ? 'ledger-winner' : ''}">${e(nameOf(m.player_b))}</h3></div>${badge(m.status === 'pending' ? 'To confirm' : m.status === 'disputed' ? 'Disputed' : 'Confirmed', m.status === 'confirmed' ? '' : 'pending')}</div><p class="meta">${dateLabel(m.played_on)} · Best of ${m.best_of}${m.status === 'confirmed' ? ` · ${e(nameOf(winnerId).split(' ')[0])} ${change(winnerId) >= 0 ? '+' : ''}${change(winnerId)} Elo` : m.status === 'disputed' ? ' · Ratings unchanged. Agree the score and submit again.' : ' · Ratings unchanged until confirmed'}</p>${reviewButtons(m)}</article>`;
  }).join('') + (list.length > visibleCount ? '<button class="load-more" data-action="more">Show more matches</button>' : '');
}

function renderNotices() {
  const awaiting = state.matches.filter(m => m.status === 'pending' && m.submitted_by !== store.userId && [m.player_a,m.player_b].includes(store.userId));
  const challenges = state.challenges.filter(c => ['open','accepted'].includes(c.status)).sort((a,b) => Number(memberIds(b).includes(store.userId)) - Number(memberIds(a).includes(store.userId)) || b.created_at.localeCompare(a.created_at)).slice(0,3);
  let html = awaiting.length ? `<article class="notice"><div class="notice-meta">${badge('Your attention', 'pending')}</div><h3>${awaiting.length} result${awaiting.length > 1 ? 's' : ''} awaiting your confirmation.</h3><div class="notice-action"><button class="text-button" data-view="ledger">Review the score ${icon('arrow')}</button></div></article>` : '';
  html += challenges.slice(0,awaiting.length ? 2 : 3).map(c => `<article class="notice"><div class="notice-meta">${badge(c.status === 'open' ? 'Gauntlet thrown' : 'Game on', c.status === 'open' ? 'open' : '')}<span class="notice-date">${dateLabel(c.created_at)}</span></div><h3>${e(nameOf(c.challenger))}<span class="versus"> → </span>${e(nameOf(c.opponent))}</h3>${c.note ? `<p>“${e(c.note)}”</p>` : ''}<div class="notice-action"><button class="text-button" data-view="challenges">${memberIds(c).includes(store.userId) ? 'View your challenge' : 'View challenge'} ${icon('arrow')}</button></div></article>`).join('');
  $('#notices').innerHTML = html || '<article class="notice"><h3>A quiet moment at the club.</h3><p>Be the first to issue a friendly challenge.</p></article>';
}

function changeView(next, scroll = true) {
  if (!['ladder','challenges','ledger'].includes(next)) next = 'ladder';
  view = next; search = ''; visibleCount = 20; $('#search').value = '';
  history.replaceState(null, '', `#${view}`);
  renderBoard();
  if (scroll) $('.main-board').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function refresh() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    let identity;
    do {
      identity = store.userId;
      const loaded = await store.load();
      if (identity === store.userId) state = loaded;
      // Discard an in-flight read if the member signs out or changes identity.
    } while (identity !== store.userId);
    render();
  })().finally(() => { refreshPromise = null; });
  return refreshPromise;
}

async function mutate(button, fn, message) {
  button.disabled = true;
  try { await fn(); await refresh(); if (message) notify(message); }
  catch (error) { notify(error.message || 'Something went wrong. Please try again.', true); }
  finally { button.disabled = false; }
}

document.addEventListener('click', async event => {
  const nav = event.target.closest('[data-nav]');
  if (nav) { event.preventDefault(); changeView(nav.dataset.nav); return; }
  const viewButton = event.target.closest('[data-view]');
  if (viewButton) { changeView(viewButton.dataset.view); return; }
  const b = event.target.closest('[data-action]');
  if (!b || !store) return;
  const { action, player = '', id = '' } = b.dataset;
  if (action === 'close') modal.close();
  if (action === 'challenge') openChallenge(player);
  if (action === 'result') openResult(player, id);
  if (action === 'account') openAccount();
  if (action === 'rules') openRules();
  if (action === 'invite') openInvite();
  if (action === 'refresh') await mutate(b, refresh, 'The club ledger is up to date.');
  if (action === 'respond') await mutate(b, () => store.respond(id, b.dataset.response), b.dataset.response === 'accepted' ? 'Challenge accepted. See you on court.' : 'Challenge updated.');
  if (action === 'review') await mutate(b, async () => { await store.reviewResult(id, true); if (modal.open) modal.close(); }, 'Result confirmed. The ladder has been updated.');
  if (action === 'dispute') {
    const m = state.matches.find(m => m.id === id);
    if (!m) return;
    showModal('A score to settle.', `<p class="intro">Dispute ${e(nameOf(m.player_a))} ${m.score_a}–${m.score_b} ${e(nameOf(m.player_b))}? Ratings will stay unchanged. Agree the correct score with your opponent, then record a fresh result.</p><button class="button button-primary" data-action="confirm-dispute" data-id="${e(id)}">Dispute this result</button><button class="small-action" data-action="close">Keep it pending</button>`);
  }
  if (action === 'confirm-dispute') await mutate(b, async () => { await store.reviewResult(id, false); modal.close(); }, 'Score disputed. Agree the result and submit it again.');
  if (action === 'more') { visibleCount += 20; renderBoard(); }
  if (action === 'signout') await mutate(b, async () => { await store.signOut(); modal.close(); }, 'You have signed out. See you at the club.');
  if (action === 'reset') showModal('A fresh start?', '<p class="intro">This clears your demo changes in this browser and restores the fictional club. It does not affect a connected live club.</p><button class="button button-primary" data-action="confirm-reset">Reset the demonstration</button><button class="small-action" data-action="close">Keep my changes</button>');
  if (action === 'confirm-reset') await mutate(b, async () => { await store.reset(); modal.close(); }, 'The demonstration has been reset.');
  if (action === 'copy-link') {
    try { await navigator.clipboard.writeText(`${location.origin}${location.pathname}`); notify('Club link copied. Share the invitation code separately.'); }
    catch { $('#club-link').select(); notify('Select and copy the club link above.'); }
  }
  if (action === 'export') {
    if (!requireMember()) return;
    // Neutralise spreadsheet formulas, including malicious member names.
    const cell = v => '"' + String(v ?? '').replace(/^\s*[=+@\-\t\r]/, "'$&").replaceAll('"','""') + '"';
    const rows = [['Date','Player A','Games A','Games B','Player B','Status','Player A Elo change'], ...state.matches.map(m => [m.played_on,nameOf(m.player_a),m.score_a,m.score_b,nameOf(m.player_b),m.status,m.rating_change_a])];
    const url = URL.createObjectURL(new Blob(['\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n')], { type:'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `shablam-squash-ledger-${localDate()}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
});

document.addEventListener('submit', async event => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  const values = Object.fromEntries(new FormData(form));
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    let message = '';
    if (form.id === 'challenge-form') { await store.challenge(values.opponent, values.note); message = 'Gauntlet thrown. Your challenge is on the board.'; view = 'challenges'; }
    if (form.id === 'result-form') { await store.submitResult({ opponent:values.opponent, scoreA:Number(values.scoreA), scoreB:Number(values.scoreB), bestOf:Number(values.bestOf), playedOn:values.playedOn, challengeId:values.challengeId || null }); message = 'Result submitted. Your opponent can now confirm it.'; view = 'ledger'; }
    if (form.id === 'switch-form') { await store.switchPlayer(values.player); message = `Welcome, ${nameOf(values.player).split(' ')[0]}.`; }
    if (form.id === 'join-form') { await store.join(values.name, values.invite); message = 'Welcome to Shablam Squash. Your rating starts at 1,200.'; }
    if (form.id === 'signin-form') { await store.signIn(values.email.trim()); formMessage(form, 'Your sign-in link is on its way. Check your email, then follow it back to the club.', true); return; }
    await refresh(); changeView(view,false); modal.close(); notify(message);
  } catch (error) { formMessage(form, error.message || 'Something went wrong. Please try again.'); }
  finally { button.disabled = false; }
});

$('#search').addEventListener('input', event => { search = event.target.value.trim().toLowerCase(); renderBoard(); });
modal.addEventListener('click', event => { if (event.target === modal) { const rect = modal.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) modal.close(); } });
window.addEventListener('storage', event => { if (event.key?.startsWith('shablam-') && store?.mode === 'demo') refresh().catch(err => notify(err.message, true)); });
window.addEventListener('hashchange', () => changeView(location.hash.slice(1), false));

async function boot() {
  const hasUrl = Boolean(config.supabaseUrl?.trim());
  const hasKey = Boolean(config.supabasePublishableKey?.trim());
  if (hasUrl !== hasKey) throw new Error('The club connection is incomplete. Set both the Supabase URL and publishable key in config.js.');
  if (hasUrl) {
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(config.supabaseUrl)) throw new Error('Use your HTTPS Supabase project URL in config.js.');
    if (config.supabasePublishableKey.startsWith('sb_secret_')) throw new Error('Use a publishable key, never a secret key, in config.js.');
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm');
    store = await new LiveStore(createClient(config.supabaseUrl, config.supabasePublishableKey)).init();
    store.client.auth.onAuthStateChange((event, session) => {
      store.userId = session?.user.id ?? null;
      // Run data requests outside the SDK auth callback to avoid auth lock deadlocks.
      setTimeout(() => { refresh().then(() => { if (event === 'SIGNED_IN' && modal.open) modal.close(); }).catch(err => notify(err.message, true)); }, 0);
    });
  } else {
    store = await new DemoStore().init();
  }
  await refresh();
  changeView(location.hash.slice(1) || 'ladder', false);
  if (store.mode === 'live') {
    // Modest polling keeps opponents' changes visible without requiring Realtime setup.
    setInterval(() => { if (!document.hidden && store.userId) refresh().catch(err => notify(err.message, true)); }, 30000);
    window.addEventListener('focus', () => refresh().catch(err => notify(err.message, true)));
  }
}

boot().catch(error => {
  const banner = $('#mode-banner'); banner.hidden = false; banner.classList.add('status-error'); banner.textContent = error.message || 'The club could not be loaded. Please reload the page.';
  $('#board-content').innerHTML = empty('The ledger is unavailable.', 'Check the club connection and reload.');
  console.error('Shablam Squash could not start:', error);
});
