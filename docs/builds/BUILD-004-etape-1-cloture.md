# CabinetOS — Clôture de BUILD-004, étape 1 : parcours d'accès

**BUILD-004 · Parcours d'accès · Étape 1 — Se connecter**
Date de clôture de l'étape : 13 septembre 2026

Cette note clôture la **première étape** de BUILD-004 (parcours d'accès). Le
Build reste **ouvert** : les étapes 2 (« S'inscrire ») et 3 (« Inviter ») sont
reportées, comme prévu dès le Brief. Le détail technique vit dans
`docs/design/parcours-acces-etape-1-spec.md`, l'ADR-0019 (`docs/adr/`), et les
maquettes (`docs/design/maquettes/`).

---

## Décision : l'étape 1 est close

Les 4 commits demandés par la spec, plus un correctif post-validation et une
correction de cohérence visuelle, sont livrés et validés :

| PR | Contenu |
|---|---|
| #48 | Commit 1 : parcours d'authentification (connexion, session, déconnexion) |
| #49 | ADR-0019 : décision technique préalable au commit 2 |
| #50 | Commit 2 : résolution d'organisation à la connexion |
| #51 | Commit 3 : changement d'organisation en cours de session |
| #52 | Commit 4 : réglage organisation par défaut |
| #53 | Correctif : `useTranslations` non appelable dans un composant async |
| #54 | Correctif : unifier le calcul du monogramme d'organisation |

## Un blocage architectural signalé et résolu avant d'écrire du code

Avant le commit 2, un blocage a été trouvé : `memberships` porte une politique
de sécurité (RLS) forcée par organisation — impossible de lister les
organisations d'un utilisateur sans déjà connaître l'organisation, exactement
ce que la connexion doit déterminer. Signalé avant toute implémentation
(ADR-0019). La solution retenue : un cache sur `users`, table qui n'a jamais
porté de politique RLS — zéro contournement de sécurité, une seule colonne.

## Un bug réel trouvé par la vérification visuelle elle-même

En vérifiant visuellement les écrans (livrable de validation demandé par la
spec), la page d'accueil renvoyait une erreur 500 : `useTranslations`
(synchrone) n'est pas appelable à l'intérieur d'un composant `async` —
présent depuis le commit 1, jamais détecté par les tests automatisés, qui
simulent tous `next-intl` entièrement. Corrigé (PR #53), vérifié
concrètement : `GET /fr` renvoyait 500 avant, 200 après.

## Sortie CI complète — aucune régression sur Patient ni Médecin

Reproduite intégralement en local avant chaque PR (`lint`, `format:check`,
`check:architecture`, `db:check`, suite complète, suite d'isolation, `build`) :

- **Suite backend complète** : 37 suites, **190 tests**, tous passés.
- **Suite d'isolation backend** (bloquante) : 7 suites, **29 tests**, tous
  passés, **couverture 93,23 %** — inclut le test de bascule d'organisation
  (commit 3), le livrable le plus important du chantier : preuve qu'après
  bascule d'une organisation A vers B, l'utilisateur ne voit que les données
  de B, jamais un reliquat de A.
- **Suite frontend** : 10 suites, **53 tests**, tous passés.
- **Build** (API + Web) : vert.

## Aperçu visuel

Un aperçu de chaque écran (connexion FR/AR, choix d'organisation, sélecteur
d'organisation, menu utilisateur, réglages), généré avec un vrai utilisateur
et une vraie session, a été transmis pour validation du rendu — pas déposé
ici (mêmes modalités que les clôtures d'EA du module Médecin).

## Le périmètre reporté (rappel)

- Étape 2 — S'inscrire : auto-inscription, création d'organisation par
  l'utilisateur, validation par l'équipe.
- Étape 3 — Inviter : un administrateur d'organisation ajoute ses membres.
- Réinitialisation de mot de passe en libre-service (infrastructure e-mail).
- Vrai mode sombre.

---

**BUILD-004 reste ouvert.** Le tag `build-004-etape-1-closed` marque l'état
exact du socle à la fin de cette étape — pas la clôture complète du Build,
qui viendra avec les étapes 2 et 3.
