# CabinetOS — Organisation du dépôt

Schéma de référence. Un seul principe : **une chose = un seul endroit officiel.**
Si tu sais quel type de chose tu tiens, tu sais où la ranger. Si tu cherches une chose,
tu sais où regarder.

Ce document vit dans le dépôt (`docs/ORGANISATION.md`) — c'est lui-même une application
de sa propre règle.

## 1. Le schéma

```
cabinetos/
│
├── apps/                 LE CODE ← verrouillé par l'outillage,
│   ├── api/               backend NestJS      ne peut pas dériver
│   └── web/                frontend Next.js
│
├── packages/             code partagé
├── infra/                Docker · CI
├── db/migrations/        migrations (schéma + RLS)
│
└── docs/                 LA MÉMOIRE ← rien ne la contraint :
    ├── adr/                décisions d'architecture   c'est ICI qu'on met la
    ├── builds/             bilans de fin de Build      discipline
    ├── specs/              RFA · Engineering Assets
    ├── runbooks/           procédures d'exploitation (migrations, déploiement)
    └── ORGANISATION.md     ce document
```

Deux zones, deux natures :

- **`apps/`, `packages/`** — le code. Sa structure est imposée par les règles de
  frontières (`dependency-cruiser`). Un import mal placé fait échouer la CI. Personne ne
  peut le désorganiser sans que ça se voie. Rien à surveiller ici.
- **`docs/`** — la mémoire. Aucun outil ne l'oblige. C'est le seul endroit où le désordre
  peut s'installer en silence. Toute la discipline se concentre là.

## 2. Où je range / où je cherche

Le même tableau se lit dans les deux sens.

| J'ai / je cherche…                | Endroit unique        | Nommage                                                   |
| --------------------------------- | --------------------- | --------------------------------------------------------- |
| Une décision d'architecture       | `docs/adr/`           | `NNNN-titre.md` (ex. `0006-acces-donnees-drizzle-orm.md`) |
| Le bilan d'un Build               | `docs/builds/`        | `BUILD-NNN-report.md`                                     |
| Une spec : RFA, Engineering Asset | `docs/specs/`         | `BUILD-NNN-nom.md`                                        |
| Du code                           | `apps/` · `packages/` | structure imposée, non négociable                         |
| Une migration de base             | `db/migrations/`      | généré par `drizzle-kit`                                  |
| Une tâche à faire ou une dette    | Issue GitHub          | jamais un fichier `TODO.md`                               |

**Règle d'or** : ce qui n'est pas dans le dépôt n'existe pas. Une décision non écrite en
ADR sera rediscutée dans un an. Une dette qui n'est pas une issue est une dette oubliée.

## 3. Le fil qui relie tout : l'identifiant

Chaque chose porte un identifiant, et le même identifiant se retrouve partout où cette
chose apparaît :

```
BUILD-001 ─┬─ EA-001 ─┬─ TASK-001 ─── branche build-001/ea-001-...
           │          ├─ TASK-002     commit "feat(TASK-002): ..."
           │          └─ TASK-003     PR "TASK-003 — ..."
           │
           └─ produit ── ADR-0006, ADR-0010...
```

Conséquence pratique : depuis n'importe quel artefact, tu retrouves tous les autres en
cherchant l'identifiant. Un ADR mentionne les TASK qui l'ont mis en œuvre ; une PR
mentionne l'ADR qui la justifie ; une issue mentionne le Build qui la traitera. On ne se
perd pas, parce qu'on suit un fil.

## 4. Git : trois règles, pas plus

| Élément | Règle                    | Exemple                                           |
| ------- | ------------------------ | ------------------------------------------------- |
| Branche | `build-NNN/ea-NNN-sujet` | `build-001/ea-003-isolation`                      |
| Commit  | `type(RÉF): description` | `test(TASK-016): accès inter-organisation refusé` |
| Tag     | à la clôture d'un Build  | `build-001-closed`                                |

Types de commit : `feat` · `fix` · `docs` · `test` · `chore`.

Deux principes qui ne se négocient pas :

- **Tout passe par une Pull Request, même la doc.** C'est le point de contrôle et la
  trace (qui a validé quoi, quand). Jamais de push direct sur `main`.
- **Un tag à chaque clôture de Build.** C'est la photo de l'état exact du socle à ce
  moment — le point de repère qu'on cherchera plus tard pour dire « voilà où on en était ».

## 5. Les issues : la dette ne se perd jamais

Trois attributs obligatoires sur chaque issue, sinon elle devient invisible dans le
backlog :

- **Label de nature** : `dette-technique`, `bug`, `amélioration`…
- **Label de priorité** : `priorité-haute` uniquement si ça bloque le Build suivant.
- **Milestone** : le Build qui traitera l'issue. C'est ce qui fait le pont entre « ce
  qu'on a laissé de côté » et « ce qu'on fait maintenant ».

Chaque issue est auto-suffisante : quelqu'un qui l'ouvre dans trois mois comprend le
problème, la solution attendue et la raison, sans reconstituer le contexte.

## 6. Corrections et versions

Une tâche livrée, une correction demandée, une nouvelle version : c'est le rythme normal
du travail. La règle est unique et elle évite le piège le plus courant.

**Une correction ne crée jamais un fichier « v2 » à côté de l'ancien.** Pas de
`user.queries.v2.ts`, pas de `rapport_final_vraiment.md`. Ce désordre-là est exactement
ce qu'on refuse.

| Ce qui est corrigé                                                  | Comment on versionne                                                                             | Où vit l'historique |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------- |
| Du code                                                             | Nouveau commit sur la branche de la TASK ; la PR s'actualise                                     | Git                 |
| Un document (coquille, mise à jour)                                 | Commit sur le même fichier                                                                       | Git                 |
| Une décision qui change                                             | Nouvel ADR de révision qui référence l'ancien ; l'ancien reste, marqué « Remplacé par ADR-00XX » | La chaîne d'ADR     |
| Un livrable en cours de validation (aller-retour avant intégration) | On itère sur la branche/PR ; seul l'état mergé fait foi                                          | Historique de la PR |

Le principe qui chapeaute les quatre : **une seule version fait foi à tout instant :
l'état sur `main`.** L'historique des versions précédentes vit dans Git, ou dans la
chaîne d'ADR de révision pour les décisions. Jamais dans des fichiers `_v1`, `_v2`,
`_final` posés côte à côte.

Le seul cas où deux versions coexistent volontairement est l'ADR de révision — et c'est
intentionnel : on garde l'ancien pour conserver la trace du pourquoi on a changé d'avis,
pas seulement de la décision finale. C'est la mémoire du raisonnement, pas un doublon
oublié.

## 7. Un Build, du début à la fin

Le cycle complet, pour visualiser où chaque chose atterrit :

1. RFA / specs → `docs/specs/BUILD-002-*.md`
2. Decision Gate → décisions figées en `docs/adr/`
3. Développement → branches `build-002/ea-*` → PR → `main`
4. Correction demandée → nouveau commit sur la même PR (jamais un fichier v2)
5. Migrations → `db/migrations/`
6. Bilan de clôture → `docs/builds/BUILD-002-report.md`
7. Dette identifiée → Issues GitHub (label + milestone)
8. Clôture → tag `build-002-closed`

Chaque étape a son emplacement unique. Rien ne flotte, rien ne se cherche.

## En cas de doute

Une seule question à se poser : **« quel type de chose est-ce ? »** La réponse donne
l'emplacement. Si aucun type ne correspond, ce n'est pas qu'il manque un dossier — c'est
qu'il faut d'abord décider ce qu'est la chose. Et cette décision, si elle est
structurante, est elle-même un ADR.
