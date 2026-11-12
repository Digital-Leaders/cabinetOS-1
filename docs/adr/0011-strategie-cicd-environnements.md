# ADR-0011 — Stratégie CI/CD et environnements

**Statut** : Accepté

## Contexte

Le projet nécessite un environnement de développement local reproductible, une validation
automatique de chaque pull request, et une séparation stricte des configurations par
contexte (local, test, recette) — sans dépendre d'une infrastructure lourde
disproportionnée pour une équipe réduite.

## Décision

- **Local** : Docker Compose (PostgreSQL 18, API NestJS, frontend Next.js), rechargement à
  chaud.
- **CI/CD** : GitHub Actions — lint, tests (base PostgreSQL éphémère), build, contrôle des
  frontières, à chaque pull request.
- **Environnements** : local (Docker Compose), test (CI, base éphémère), recette
  (configuration proche de la cible) — variables d'environnement strictement séparées par
  contexte, jamais committées.
- Pas de Kubernetes.

## Justification

- Infrastructure simple (VPS ou PaaS géré à terme), cohérente avec la taille de l'équipe
  et la jeunesse du produit.
- `docker compose up` doit démarrer les trois services sans configuration manuelle
  supplémentaire — vérifié par un script CI dédié (TASK-017).
- L'application refuse de démarrer si une variable d'environnement critique est absente,
  avec message d'erreur explicite (validation Joi, TASK-019) — plutôt que de démarrer
  silencieusement dans un état incohérent.
- Migrations gérées par `drizzle-kit`, fichiers versionnés, exécution explicite (jamais
  automatique en production).

## Conséquences

- Chaque nouvelle variable d'environnement critique (par exemple `BETTER_AUTH_SECRET` en
  TASK-013) doit être ajoutée au schéma de validation Joi et documentée dans les trois
  fichiers `.env.*.example` (local, test, recette), avec le bon rôle applicatif
  (`cabinetos_app`, jamais `postgres`) — un écart a été corrigé sur ce point précis lors de
  la revue du jalon EA-003 (`.env.local.example` utilisait encore le rôle superutilisateur).
- La pipeline CI applique désormais explicitement chaque migration versionnée
  (`0000_*.sql`, `0001_*.sql`, `0002_*.sql`, …) avant de lancer les tests — un oubli sur ce
  point a également été corrigé en cours de Build (migration `0002` non appliquée
  automatiquement en CI lors de sa première introduction).
- pg_dump/psql : la version installée par défaut sur les runners GitHub Actions (16.x) est
  plus ancienne que le serveur PostgreSQL 18 utilisé par le projet — `pg_dump` refuse par
  principe de se connecter à un serveur plus récent que lui-même. La CI installe donc
  explicitement les outils clients PostgreSQL 18 via le dépôt APT officiel PGDG, avec
  priorité forcée dans le `PATH` d'exécution.
- Sauvegardes : automatiques, avec test de restauration périodique — mis en œuvre et
  automatisé par TASK-012, avec RLS active de bout en bout.
- Rollback : tags Docker + migrations réversibles documentées.
  *Précision (clôture de BUILD-004, étape 2).* « Documentées » signifie : 21 migrations sur 26 portent une
  section `DOWN`, entièrement en commentaire, donc jamais exécutée automatiquement. **Cinq n'en ont aucune :
  `0000`, `0001`, `0002`, `0004` et `0012`.** Pour celles-ci, le retour arrière est une **restauration de
  sauvegarde**. Voir `docs/runbooks/migrations-et-deploiement.md`, section « C — Retour arrière ».

## Statut

Accepté. Confirmé le 28 juillet 2026. Mis en œuvre en EA-005 (TASK-017 à TASK-019), avec
corrections post-revue en EA-003 et lors de l'intégration Better-Auth.
