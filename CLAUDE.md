# LABAF Live — mémoire du projet

> Fichier de contexte pour Claude. À placer à la racine du dépôt : Claude Code le lit automatiquement à chaque nouvelle session.
> Dernière mise à jour : 1er novembre 2026.

## Le projet en bref

Site web du club de baby-foot **LABAF Paris** qui permet de suivre en direct les joueurs du club en tournoi, à partir des données publiques de **Coral** (le logiciel de la FFBF et de l'ITSF où les joueurs s'inscrivent et où les scores sont saisis).

- **Site** : https://labaf-paris.github.io/labaf-live/
- **Dépôt** : https://github.com/labaf-paris/labaf-live (organisation GitHub `labaf-paris`, dépôt public)
- **Propriétaire** : Rémi (compte GitHub `Remhie`), admin du club.
- **Coût** : 0 €. Hébergé par GitHub Pages, robot sur GitHub Actions et cron-job.org.

## Comment parler à Rémi

- Toujours en **français**, dans un langage simple, sans jargon technique non expliqué.
- Il n'est pas développeur. Le guider **pas à pas** pour toute action sur GitHub ou ailleurs, avec des liens directs.
- Il veut que tout soit **le plus automatique possible** et pouvoir **tester en aperçu avant de publier**.
- Ne jamais lui demander de coller une clé ou un mot de passe dans la conversation.

## Architecture

```
docs/index.html        le site (une seule page : accueil + fiche tournoi via #CODE)
docs/logo.webp         logo LABAF (noir, inversé en mode sombre)
docs/data/index.json   liste de tous les tournois FFBF de la saison + membres LABAF inscrits
docs/data/t/CODE.json  détail d'un tournoi (inscrits, catégories, matchs, scores, modalités)
scripts/update.mjs     le robot : lit Coral et écrit docs/data/
scripts/extract.cjs    fonction exécutée DANS la page Coral (via Playwright) pour extraire les données
.github/workflows/update.yml   planning du robot
README.md              notice
```

### Sources Coral

- **Liste des tournois** : `GET https://api.tablesoccer.org/cms.tournaments?tour=4` (circuit national FFBF, JSON public). Champs : code, name, start_on, end_on, locality, category.id, status, info (PDF du dossier).
- **Catégories FFBF** (category.id) : 16 Open Loisir · 19 Open Régional · 22 Open National · 25 et 28 Championnats individuels · 31 World Series · 34, 37 et 40 compétitions clubs.
- **Détail d'un tournoi** : page publique `https://app.tablesoccer.org/p/CODE/`. L'API `tournament.fetch_module` refuse les appels directs (erreur 412). On ouvre donc la page avec Playwright et on lit le store Vue : `[...document.querySelectorAll('*')].find(e=>e.__vue__).__vue__.$store.state.tournament` (players, competitions, phases, matches, team_players_index, competition_players, playgrounds, tournament.settings).
- **Aucune connexion Coral n'est nécessaire.** Rien n'est stocké côté identifiants.

### Règles métier importantes

- **Joueur LABAF** = une appartenance avec `organization.short_name === 'PSC'` (code Coral du club) et `status === 'active'`. Les anciens membres gardent PSC en `inactive` et sont exclus.
- On ignore les joueurs **désinscrits** du tournoi (`player.tournament.status === 'removed'`) et les matchs `status === 'removed'`.
- Les heures Coral sont en **UTC** et sont affichées en heure de Paris.
- Les noms de catégories varient selon les tournois (« Open Singles » / « Open Simple »…). Le site les reconnaît par mots-clés (fonction `compKey`).
- Une page club Coral (`/o/PSC/players`) liste les 26 licenciés, mais elle demande une connexion. Elle n'est **pas** utilisée : un licencié est repéré automatiquement dès qu'il s'inscrit à un tournoi.

## Automatisation

| Quoi | Quand | Par qui |
|---|---|---|
| Relecture des tournois en cours (`live`) | toutes les 3 min, samedi et dimanche toute la journée | **cron-job.org** (tâche « LABAF Live », expression `*/3 * * * 6,0`, Europe/Paris) qui appelle l'API GitHub `workflow_dispatch` avec `{"ref":"main","inputs":{"mode":"live"}}` |
| Idem, en secours | toutes les 5 min en théorie (souvent 5 à 20 en pratique) | cron GitHub `*/5 * * * *` |
| Relecture complète de la saison (`full`) : inscriptions et modalités | toutes les 3 h en théorie (en pratique 4 à 8 h) | cron GitHub `17 */3 * * *` |
| Lancement manuel | à la demande | onglet Actions → « Mise à jour des tournois » → Run workflow (mode full) |
| Rafraîchissement de la page chez le visiteur | toutes les 60 s | le site lui-même |

- **Clé GitHub** (fine-grained token, propriétaire `labaf-paris`, dépôt labaf-live seulement, droit Actions : lecture et écriture) : stockée **uniquement dans cron-job.org**. **Elle expire le 2 octobre 2027** : il faudra la régénérer et la recoller dans cron-job.org.
- Les réglages GitHub nécessaires sont faits : Pages (branche main, dossier /docs) et Workflow permissions en « Read and write » (au niveau de l'organisation et du dépôt).
- Délai réel constaté entre un score saisi sur Coral et son affichage : 3 à 6 min le week-end.

## Choix de design validés par Rémi

- Interface **sobre, quasi noir et blanc**, police Archivo, thème clair et sombre.
- **Couleur par niveau** : National bleu, Régional vert, Loisir ambre, Championnats violet. Le **rouge est réservé au « En direct »**.
- **Couleur par catégorie** et **ordre fixe partout** : simple open, simple dames, double open, double dames, double mixte, puis seniors et juniors.
- **Podiums** : médailles or, argent et bronze, plus un bloc « Podiums » en haut de la fiche.
- **Accueil** : cartes à la une (dernier tournoi, « Aujourd'hui », prochains tournois LABAF, ou les tournois « En direct »), puis la liste par mois avec filtres de niveau et la case « Seulement avec des joueurs LABAF ». **Pas de noms d'inscrits sur l'accueil**, seulement le compteur « ● N LABAF ».
- **Fiche tournoi** : matchs en cours, prochains matchs, résultats par catégorie (classement, bilan V/N/D, détail manche par manche), bloc « S'inscrire » (date limite, tarifs, catégories et horaires, lien Coral, PDF du dossier).
- Statistiques retenues : joueurs LABAF, victoires–défaites, podiums. La stat « engagements » a été **supprimée** à la demande de Rémi.
- Sur téléphone, les filtres sont des pastilles qu'on fait défiler horizontalement.
- « En direct » s'affiche seulement si le tournoi est lancé sur Coral (`status === 'playing'`), que c'est la bonne date et qu'au moins un joueur LABAF est inscrit.

## À faire / problèmes connus

1. **Statut « En direct » en retard** (pas encore corrigé) : le calendrier Coral (`cms.tournaments`) met du temps à passer un tournoi en `playing`, alors que la page du tournoi est à jour. Correction prévue dans `scripts/update.mjs`, à la ligne `return { ...t, members, players: ... }` : ajouter `status: s && s.status ? s.status : t.status,`.
2. **Le robot enregistre une nouvelle version même sans changement**, parce que le champ `updated` change à chaque passage. Résultat : beaucoup de commits, des déploiements Pages inutiles et des échecs ponctuels (« All jobs have failed », sans gravité, le passage suivant rattrape). À faire : ne committer que si les données réelles ont changé (comparer en ignorant `updated`).
3. Les avertissements GitHub « Node.js 20 is deprecated » sont sans gravité. On peut passer `actions/checkout` et `actions/setup-node` en v5.
4. Optionnel : une 2ᵉ tâche cron-job.org le lundi de 0 h à 3 h (`*/3 0-3 * * 1`) pour les tournois du dimanche qui débordent après minuit.
5. Idées évoquées : une page par joueur (parcours de la saison), une icône sur l'écran d'accueil du téléphone (manifest), les tournois internationaux ITSF (hors circuit FFBF), des « fonctionnalités marrantes » à définir avec Rémi.

## Méthode de travail souhaitée

1. Faire les modifications sur une copie locale.
2. Montrer un **aperçu** à Rémi avec les vraies données (page de prévisualisation), **sans publier**.
3. Publier sur `main` seulement après son accord. Attention : le robot publie toutes les 3 min le week-end, donc faire `git pull --rebase` avant chaque envoi.
4. Après publication, vérifier que la mise à jour suivante du robot passe bien au vert.

## Historique rapide

- 28/09/2026 : création, premier aperçu sur l'Open National de Lyon, filtre des licenciés actifs, accueil multi-tournois, couleurs, médailles, mise en ligne (d'abord sous `remhie.github.io`).
- 28/09 au 01/10 : transfert vers l'organisation `labaf-paris`, mise en place de cron-job.org.
- 03/10 : premier test en direct (Open Régional de Bordeaux). Corrections : règle « En direct », carte « Aujourd'hui ».
