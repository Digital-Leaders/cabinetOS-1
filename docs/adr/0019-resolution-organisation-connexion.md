# ADR-0019 — Résolution d'organisation à la connexion : cache des adhésions sur `users`

**Statut** : Proposé (révisé suite à retour encadrant — voir « Révision » en fin
de document)

## Contexte

Le parcours d'accès, étape 1, doit résoudre à la connexion les organisations d'un
utilisateur (une seule → directe ; plusieurs + défaut → défaut ; plusieurs sans
défaut → écran de choix) — un cas non anticipé par le socle (ADR-0005) : toute
lecture existante suppose déjà connu le contexte d'organisation, or c'est
précisément ce que la résolution cherche à déterminer.

Concrètement : `memberships` porte `FORCE ROW LEVEL SECURITY`, avec une politique
`organization_id = current_setting('app.organization_id', true)`. Sans ce
paramètre déjà positionné, la condition vaut `organization_id = NULL`, qui ne
correspond à aucune ligne. `DatabaseService.withOrganizationScope()` est le seul
point d'accès aux tables Core, et il refuse explicitement de s'exécuter sans
`organizationId`.

## Décision

Vérifié directement dans le schéma : `users` (Identity, Better-Auth) ne porte
**aucune politique RLS** — ni lui, ni `organizations` (seules `memberships`,
`settings`, `audit_events` et `notifications` en portent, migration `0001`).
`users` est donc lisible et modifiable sans aucun contexte d'organisation déjà
établi.

Une nouvelle colonne **`users.organization_memberships`** (`jsonb`, défaut
`'[]'`), tableau d'objets `{ organizationId, organizationName, isDefault }` :
un résumé des adhésions de l'utilisateur, porté par son compte, lisible dès la
connexion sans contexte d'organisation. Aucune nouvelle table, aucune fonction
contournant RLS, aucune politique RLS modifiée.

Mise à jour du cache **dans la même transaction** que l'opération qui la rend
nécessaire — jamais une synchronisation différée :
- `createMembership` (déjà exécutée via `withOrganizationScope`, donc déjà dans
  une transaction) ajoute l'entrée correspondante à `organization_memberships`
  de l'utilisateur concerné ; si c'est sa première adhésion, `isDefault: true`
  automatiquement (une seule organisation = la destination, sans action de
  l'utilisateur).
- `deleteMembership` retire l'entrée correspondante.
- Une nouvelle fonction `setDefaultMembership` (lecture-écriture ordinaire sur
  `users`, aucun scope requis) positionne `isDefault: true` sur l'entrée
  choisie et `false` sur les autres, pour l'utilisateur de la session
  authentifiée — jamais un `userId` fourni par le client.

La résolution à la connexion se réduit à une lecture de
`users.organization_memberships` :
- 1 entrée → ouverture directe (l'unique organisation, quel que soit son
  `isDefault`).
- Plusieurs entrées, une avec `isDefault: true` → ouverture de celle-ci.
- Plusieurs entrées, aucun défaut → écran de choix, alimenté directement par
  le tableau (aucune requête supplémentaire pour l'afficher).

## Justification

- **Aucun contournement de sécurité** : contrairement à la version précédente
  de cette ADR (fonctions `SECURITY DEFINER`), cette approche ne touche à
  aucune politique RLS et n'introduit aucun nouveau chemin d'accès élargi —
  elle exploite une table qui n'a jamais été scopée.
- **Écriture toujours transactionnelle avec sa cause** : le cache ne peut pas
  diverger silencieusement de `memberships`, puisqu'il est mis à jour dans la
  même transaction que la création/suppression d'adhésion, jamais après coup.
- **Une seule colonne, un seul type d'objet** : pas de table séparée, pas de
  détournement de Settings (toujours inadapté : scopé par organisation, pas
  par utilisateur).
- **`users` appartient à Identity, `memberships`/`organizations` à
  Organization** : `organization.queries.ts` référence déjà `users` (clé
  étrangère `userId`, exportée par l'index public d'Identity) — écrire dans
  `users` depuis les fonctions de membership prolonge une dépendance déjà
  établie, n'en crée pas une nouvelle.

## Conséquences

- Nouvelle migration : colonne `users.organization_memberships` (jsonb, défaut
  `'[]'`).
- `createMembership` et `deleteMembership` modifiés pour maintenir le cache ;
  nouvelle fonction `setDefaultMembership`. Aucune fonction existante de
  lecture/écriture sur `memberships` n'est autrement changée.
- **Limite connue, acceptée pour ce Build** : si une organisation est
  renommée, les entrées déjà mises en cache dans `organization_memberships`
  deviennent obsolètes pour les utilisateurs concernés jusqu'à leur prochaine
  adhésion/désadhésion. Non bloquant aujourd'hui : `organizations` n'a
  actuellement aucune fonction de renommage (contrôleur non implémenté). À
  traiter (rafraîchir le cache de tous les membres) si un tel renommage est
  construit plus tard.
- Test dédié requis (même exigence qu'un geste d'isolation) : après
  création/suppression d'une adhésion, le cache sur `users` reflète
  exactement l'état réel de `memberships` — pas seulement que l'opération
  réussit, que les deux restent synchronisés.

## Révision

Version initiale : deux fonctions `SECURITY DEFINER` contournant RLS pour lire
les adhésions par utilisateur. Remise en question par l'encadrant : puisque
l'appartenance d'un utilisateur est connue dès la création de son compte,
peut-elle être rendue lisible directement là où le contexte d'organisation
n'existe pas encore, plutôt que de contourner la sécurité pour l'atteindre où
elle est protégée ? Vérification faite : `users` n'a jamais porté de politique
RLS -- la question ouvre une solution strictement plus simple, retenue ici,
sans aucune exception au modèle de sécurité.

## Statut

Proposé le 11 septembre 2026, révisé le même jour suite à retour encadrant.
