// Met à jour les données du site à partir de Coral.
//   node scripts/update.mjs --plan   -> dit s'il y a quelque chose à lire (pour GitHub Actions)
//   node scripts/update.mjs live     -> relit les tournois en cours (toutes les 5 min)
//   node scripts/update.mjs full     -> relit aussi les inscriptions des tournois à venir (toutes les heures)
//   node scripts/update.mjs saison   -> relit tous les tournois déjà commencés (rattrapage, à la demande)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { extractTournament } = require('./extract.cjs');

const CLUB = 'PSC';                       // code du club LABAF Paris sur Coral
const TOUR = 4;                           // circuit national FFBF sur Coral
const LIST_URL = `https://api.tablesoccer.org/cms.tournaments?tour=${TOUR}`;
const PAGE_URL = (code) => `https://app.tablesoccer.org/p/${code}/`;
const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'data');
const UPCOMING_DAYS = 366;                // horizon de lecture des inscriptions (toute la saison)
const MIN_MATCHES = 10;                   // matchs minimum pour le classement « meilleur pourcentage de victoires »

const LEVELS = {
  16: 'loisir', 19: 'regional', 22: 'national',
  25: 'championnat', 28: 'championnat', 31: 'national',
  34: 'clubs', 37: 'clubs', 40: 'clubs',
};

const todayParis = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const readJson = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } };
const writeJson = (f, obj) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(obj)); };

async function fetchList() {
  const r = await fetch(LIST_URL, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`Liste des tournois indisponible (${r.status})`);
  const j = await r.json();
  return (j.tournaments || []).map((t) => ({
    code: t.code,
    name: (t.name || '').trim(),
    start: t.start_on,
    end: t.end_on || t.start_on,
    city: t.locality || (t.address && t.address.locality) || '',
    organizer: t.organization ? t.organization.short_name : '',
    categoryId: t.category ? t.category.id : null,
    category: t.category ? t.category.name : '',
    level: LEVELS[t.category && t.category.id] || 'autre',
    status: t.status,
    info: t.info || null,
  }));
}

const isLive = (t, today) => t.status !== 'finished' && t.start <= today && today <= t.end;
const isRecent = (t, today) => t.end < today && t.end >= addDays(today, -1) && t.status !== 'finished';

function plan(list, mode, today) {
  const live = list.filter((t) => isLive(t, today) || isRecent(t, today));
  if (mode === 'live') return live;
  // « saison » : relit une fois tous les tournois déjà commencés (rattrapage des statistiques)
  if (mode === 'saison') return list.filter((t) => t.start <= today);
  const upcoming = list.filter((t) => t.start > today && t.start <= addDays(today, UPCOMING_DAYS));
  const map = new Map([...live, ...upcoming].map((t) => [t.code, t]));
  return [...map.values()];
}

async function scan(targets) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage({ locale: 'fr-FR' });
  const results = {};
  for (const t of targets) {
    try {
      await page.goto(PAGE_URL(t.code), { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForFunction((code) => {
        const el = [...document.querySelectorAll('*')].find((e) => e.__vue__);
        const st = el && el.__vue__.$store.state.tournament;
        return st && st.tournament && st.tournament.code === code;
      }, t.code, { timeout: 30000 });
      await page.waitForTimeout(3500); // laisse la page finir de charger joueurs et matchs
      const data = await page.evaluate(extractTournament, CLUB);
      if (data && !data.error) results[t.code] = data;
      else console.warn(`${t.code}: ${data && data.error}`);
    } catch (e) {
      console.warn(`${t.code}: lecture impossible (${e.message.split('\n')[0]})`);
    }
  }
  await browser.close();
  return results;
}

async function main() {
  const arg = process.argv[2] || 'live';
  const today = todayParis();
  const list = await fetchList();
  const mode = arg === '--plan' ? (process.argv[3] || 'live') : arg;
  const targets = plan(list, mode, today);

  if (arg === '--plan') {
    const need = targets.length > 0 ? 'true' : 'false';
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `need=${need}\n`);
    console.log(`${mode}: ${targets.length} tournoi(s) à lire`);
    return;
  }

  console.log(`${mode}: lecture de ${targets.length} tournoi(s)`);
  const scanned = targets.length ? await scan(targets) : {};
  const nowIso = new Date().toISOString();

  for (const [code, data] of Object.entries(scanned)) {
    writeJson(path.join(DATA, 't', `${code}.json`), { ...data, updated: nowIso });
  }

  // Index : on garde la présence LABAF déjà connue pour les tournois non relus cette fois-ci.
  const prev = readJson(path.join(DATA, 'index.json'), { tournaments: [] });
  const prevByCode = Object.fromEntries((prev.tournaments || []).map((t) => [t.code, t]));
  const tournaments = list.map((t) => {
    const s = scanned[t.code];
    const old = prevByCode[t.code] || {};
    const members = s ? s.members : (old.members || null);
    const hasDetail = !!s || !!old.hasDetail || fs.existsSync(path.join(DATA, 't', `${t.code}.json`));
    const modalities = s ? s.modalities : (old.modalities || null);
    return { ...t, members, players: s ? s.players : (old.players || null), modalities, hasDetail };
  });
  const season = computeSeason(tournaments, today);
  writeJson(path.join(DATA, 'index.json'), { club: CLUB, updated: nowIso, season, tournaments });
  console.log('Données écrites.');
}

// Bilan de la saison du club, calculé à partir des fichiers des tournois déjà commencés.
// - un match LABAF contre LABAF compte une seule fois dans « matchs joués » et n'entre ni dans
//   le bilan V/D du club ni dans les buts (il s'annulerait) ; il compte en revanche une victoire
//   pour le joueur qui l'a gagné.
// - un match de double gagné compte 1 victoire pour chacun des joueurs LABAF de l'équipe.
function computeSeason(tournaments, today) {
  const s = { tournaments: 0, matches: 0, v: 0, d: 0, n: 0, goalsFor: 0, goalsAgainst: 0, podiums: { 1: 0, 2: 0, 3: 0 }, best: {} };
  const wins = {}; // nom -> { g, v, d, n }
  let half = 0;
  const sum = (a) => (a || []).reduce((x, y) => x + (+y || 0), 0);
  for (const t of tournaments) {
    if (t.start > today) continue;
    const d = readJson(path.join(DATA, 't', `${t.code}.json`), null);
    if (!d) continue;
    let played = false;
    for (const e of d.entries || []) {
      const mates = (e.team || []).filter((p) => p.member);
      for (const p of mates) wins[p.name] = wins[p.name] || { g: p.g, v: 0, d: 0, n: 0 };
      if (e.rank >= 1 && e.rank <= 3) s.podiums[e.rank]++;
      for (const m of e.matches || []) {
        if (m.status !== 'done' || !m.res) continue;
        played = true;
        const internal = (m.opp || []).some((p) => p.member);
        for (const p of mates) wins[p.name][m.res === 'V' ? 'v' : m.res === 'D' ? 'd' : 'n']++;
        if (internal) { half++; continue; }
        s.matches++;
        if (m.res === 'V') s.v++; else if (m.res === 'D') s.d++; else s.n++;
        if (m.score) { s.goalsFor += sum(m.score.us); s.goalsAgainst += sum(m.score.them); }
      }
    }
    if (played) s.tournaments++;
  }
  s.matches += Math.round(half / 2);
  // Podium des 3 meilleurs joueurs et des 3 meilleures joueuses : plus fort pourcentage de
  // victoires (V / (V + D)), parmi ceux qui ont joué au moins MIN_MATCHES matchs dans la saison.
  // À pourcentage égal, celui qui a le plus de victoires passe devant.
  const pct = (w) => (w.v + w.d ? Math.round((100 * w.v) / (w.v + w.d)) : 0);
  for (const g of ['m', 'f']) {
    s.best[g] = Object.entries(wins)
      .filter(([, w]) => w.g === g && w.v + w.d + w.n >= MIN_MATCHES)
      .sort((a, b) => pct(b[1]) - pct(a[1]) || b[1].v - a[1].v || a[0].localeCompare(b[0]))
      .slice(0, 3)
      .map(([name, w]) => ({ name, pct: pct(w), v: w.v, d: w.d, n: w.n }));
  }
  s.minMatches = MIN_MATCHES;
  return s;
}

main().catch((e) => { console.error(e); process.exit(1); });
