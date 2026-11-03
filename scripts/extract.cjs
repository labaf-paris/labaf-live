// Fonction exécutée DANS la page publique d'un tournoi Coral (app.tablesoccer.org/p/CODE/).
// Elle lit les données déjà chargées par la page (comme ce qu'un visiteur voit) et
// renvoie uniquement ce qui concerne les licenciés actifs du club.
// Doit rester autonome : elle est envoyée telle quelle au navigateur.
function extractTournament(CLUB) {
  const root = [...document.querySelectorAll('*')].find((e) => e.__vue__);
  if (!root) return { error: 'page-non-chargee' };
  const st = root.__vue__.$store.state.tournament;
  if (!st || !st.tournament) return { error: 'pas-de-tournoi' };

  const players = Object.values(st.players || {});
  const pById = {};
  for (const p of players) pById[p.id] = p;

  const clubMembership = (p) => (p && p.organizations || []).find((o) => o.organization && o.organization.short_name === CLUB);
  const isMember = (p) => { const m = clubMembership(p); return !!m && m.status === 'active'; };
  // Joueur réellement engagé : on écarte ceux dont l'inscription au tournoi a été retirée
  const isEntered = (p) => !(p && p.tournament && p.tournament.status === 'removed');
  const mainClub = (p) => {
    if (!p) return '';
    const places = (p.organizations || []).filter((o) => o.organization && o.organization.geo_type === 'place' && o.status === 'active');
    const own = places.find((o) => o.organization.short_name === CLUB);
    return ((own || places[0] || {}).organization || {}).short_name || '';
  };
  const cap = (s) => (s || '').trim();
  const pName = (p) => p ? cap(p.first_name) + ' ' + cap(p.last_name).toUpperCase() : '?';
  // Genre (« f » ou « m ») : gardé seulement pour les joueurs du club, pour la stat « joueur / joueuse de la saison »
  const gender = (p) => (p && p.gender === 'woman' ? 'f' : p && p.gender === 'man' ? 'm' : undefined);
  const person = (pid) => {
    const p = pById[pid];
    const o = { name: pName(p), club: mainClub(p), member: isMember(p) };
    if (o.member && gender(p)) o.g = gender(p);
    return o;
  };

  const teamPlayers = (tid) => (st.team_players_index && st.team_players_index[tid]) || [];

  // Phases : type (qualif, principal, consolante) et nombre de tours pour nommer finale, demi...
  const phaseInfo = {};
  for (const ph of Object.values(st.phases || {})) {
    const n = ph.name || '';
    const kind = /qualif/i.test(n) ? 'Q' : /second|consol/i.test(n) ? 'C' : /main|princip|elim/i.test(n) ? 'P' : 'X';
    phaseInfo[ph.id] = { kind, name: n, system: ph.play_system, comp: (ph.competition && ph.competition.id) || ph.competition_id || null, maxRound: 0 };
  }
  const compOfPhase = {};
  for (const [cid, pid] of Object.entries(st.competitionPhaseMap || {})) compOfPhase[pid] = +cid;
  for (const [pid, info] of Object.entries(phaseInfo)) if (!info.comp && compOfPhase[pid]) info.comp = compOfPhase[pid];

  const matches = Object.values(st.matches || {}).filter((m) => m.status !== 'removed');
  for (const m of matches) { const i = phaseInfo[m.phase_id]; if (i && m.round > i.maxRound) i.maxRound = m.round; }

  const tables = {};
  for (const pg of Object.values(st.playgrounds || {})) if (pg && pg.id) tables[pg.id] = pg.number || pg.id;

  const regCount = {};
  for (const cp of Object.values(st.competition_players || {})) if (cp.status !== 'removed') regCount[cp.competition_id] = (regCount[cp.competition_id] || 0) + 1;
  const comps = {};
  for (const c of Object.values(st.competitions || {})) {
    const rankOf = {};
    for (const [r, t] of Object.entries((c.settings && c.settings.standings) || {})) rankOf[t] = +r;
    comps[c.id] = { id: c.id, name: c.name, rankOf, n: Object.keys(rankOf).length || regCount[c.id] || 0, start: c.settings && c.settings.start_at };
  }

  const clubTeams = new Set();
  for (const [tid, pids] of Object.entries(st.team_players_index || {})) if (pids.some((pid) => isMember(pById[pid]))) clubTeams.add(+tid);

  const splitScore = (s, side) => {
    if (!s) return null;
    const a = side === 'home' ? s.home : s.away, b = side === 'home' ? s.away : s.home;
    if (a == null || b == null) return null;
    return { us: Array.isArray(a) ? a : [a], them: Array.isArray(b) ? b : [b] };
  };

  const byEntry = {};
  for (const m of matches) {
    const info = phaseInfo[m.phase_id] || { kind: 'X', comp: null, maxRound: 0, name: '' };
    for (const side of ['home', 'away']) {
      const tid = m[side];
      if (!clubTeams.has(tid)) continue;
      const oppTid = side === 'home' ? m.away : m.home;
      const key = info.comp + '_' + tid;
      const e = byEntry[key] || (byEntry[key] = { compId: info.comp, team: tid, matches: [] });
      const sc = splitScore(m.score, side);
      const status = m.status === 'finished' ? 'done' : (m.start_at && !m.end_at ? 'live' : 'upcoming');
      const won = m.winner === (side === 'home' ? 1 : 2);
      if (!oppTid) continue; // exempt : pas un vrai match
      const pp = (o) => (o.member ? o : { name: o.name, club: o.club });
      e.matches.push({
        kind: info.kind, round: m.round, maxRound: info.maxRound,
        status, at: m.start_at ? m.start_at.slice(0, 16) : null,
        table: status === 'done' ? undefined : (m.playground_id ? (tables[m.playground_id] || m.playground_id) : null),
        score: sc, res: status !== 'done' ? '' : (m.winner === 0 ? 'N' : won ? 'V' : 'D'),
        opp: teamPlayers(oppTid).map(person).map(pp),
      });
    }
  }

  const entries = Object.values(byEntry).map((e) => {
    const c = comps[e.compId] || { name: '?', rankOf: {}, n: 0 };
    e.matches.sort((a, b) => (a.at || '9999').localeCompare(b.at || '9999'));
    const team = teamPlayers(e.team).map(person).map((o) => (o.member ? o : { name: o.name, club: o.club }));
    return { comp: c.name, compId: e.compId, n: c.n, rank: c.rankOf[e.team] || null, team, matches: e.matches };
  });

  // Inscriptions (utile avant le début du tournoi, quand il n'y a pas encore de match)
  const regs = {};
  for (const cp of Object.values(st.competition_players || {})) {
    if (cp.status === 'removed') continue;
    const p = pById[cp.player_id];
    if (!isMember(p)) continue;
    const c = comps[cp.competition_id];
    (regs[p.id] = regs[p.id] || { name: pName(p), comps: [] }).comps.push(c ? c.name : '?');
  }
  const members = players.filter((p) => isMember(p) && isEntered(p)).map((p) => pName(p)).sort();

  // Joueurs du club présents au tournoi mais pas encore rattachés à une catégorie
  for (const p of players) {
    if (!isMember(p) || !isEntered(p)) continue;
    if (!Object.values(regs).some((r) => r.name === pName(p))) regs[p.id] = { name: pName(p), comps: [] };
  }

  // Modalités d'inscription (quand l'organisateur les a renseignées)
  const t = st.tournament;
  const s = t.settings || {};
  const reg = s.registrations || {};
  const fees = s.fees || {};
  const compFees = [];
  for (const f of fees.competition || []) {
    if (typeof f.amount === 'number') compFees.push(f.amount);
    for (const o of f.overrides || []) if (typeof o.amount === 'number') compFees.push(o.amount);
  }
  const modalities = {
    regEnd: reg.end_time || null,
    online: reg.allow_online !== false,
    currency: s.currency || 'EUR',
    baseFee: fees.tournament && typeof fees.tournament.amount === 'number' ? fees.tournament.amount : null,
    compFeeMin: compFees.length ? Math.min(...compFees) : null,
    compFeeMax: compFees.length ? Math.max(...compFees) : null,
  };
  return {
    modalities,
    code: t.code, name: t.name, status: t.status, start: t.start_at, end: t.end_at,
    players: players.length, members,
    registrations: Object.values(regs),
    competitions: Object.values(comps).map((c) => ({ id: c.id, name: c.name, n: c.n, start: c.start })),
    entries,
  };
}
if (typeof module !== 'undefined') module.exports = { extractTournament };
