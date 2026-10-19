# Scripts d'exploitation (API)

## Créer un compte d'équipe — `account:create`

Depuis l'étape 2 du parcours d'accès (BUILD-004, ADR-0021 D2), **l'inscription HTTP
native est fermée** : un compte ne peut plus être créé par `POST /api/v1/auth/sign-up/email`.
Les fondateurs passent par le parcours d'inscription (demande + validation humaine). Les
comptes d'équipe (démos, cabinets pilotes) passent par ce script, et par lui seul.

```bash
TEAM_ACCOUNT_PASSWORD='mot-de-passe-solide' pnpm --filter @cabinetos/api run account:create -- \
  --email prenom.nom@exemple.ma --name "Prénom Nom" \
  --organization <id de l'organisation> --role <id du rôle>
```

- Variables d'environnement : celles de l'API (`DATABASE_URL`, `BETTER_AUTH_SECRET`…), comme pour `pnpm dev`.
- Le mot de passe passe par `TEAM_ACCOUNT_PASSWORD`, **jamais en argument** (il resterait dans l'historique du terminal).

### Invariants (ADR-0021, à ne jamais contourner)

1. **Un compte d'équipe reçoit toujours au moins une adhésion dans le même lancement.**
   Si l'adhésion échoue (organisation ou rôle inconnu), le compte est supprimé aussitôt.
   Raison : un compte sans demande ni adhésion est un _orphelin_, que le parcours
   d'inscription a le droit de récupérer après 10 minutes (P1). Un compte d'équipe ne
   doit jamais pouvoir lui ressembler.
2. **Chaque création est tracée** : événement `team_account.created` dans `audit_events`
   de l'organisation, en plus de la sortie console.
3. **Administrateurs de plateforme** (`platform_admins`, P3) : seule table qui transcende
   l'isolation des organisations. Tant que l'étape 2-bis n'existe pas, un admin n'y est
   ajouté **que par `admin:grant`** (section ci-dessous), qui trace qui l'ajoute et pourquoi.

Ne créez jamais de compte directement en base ou par un autre chemin.

---

## Ajouter un administrateur de plateforme — `admin:grant`

Un **administrateur de plateforme** est un membre de l'équipe CabinetOS qui examine et valide
les demandes d'inscription (`/admin/...`). Il **n'appartient à aucune organisation** et n'a
accès à **aucune donnée d'organisation** : ce droit n'ouvre que les endpoints d'administration.

```bash
ADMIN_DATABASE_URL='postgres://...' pnpm --filter @cabinetos/api run admin:grant -- \
  --email prenom.nom@exemple.ma \
  --granted-by "Prénom Nom" \
  --reason "co-fondateur, validation des inscriptions"
```

- Si le compte n'existe pas, ajoutez `--name "Prénom Nom"` et la variable
  `TEAM_ACCOUNT_PASSWORD` : il est créé, puis promu, dans le même lancement. S'il existe déjà,
  il est simplement promu (son mot de passe n'est pas touché).
- `--granted-by` (qui ajoute) et `--reason` (pourquoi) sont **obligatoires**. Ils sont inscrits
  dans `platform_admins` avec la date, et la base refuse une valeur vide (`CHECK`).
- Relancer la commande pour un administrateur actif ne change rien (« déjà administrateur »).

### Pourquoi `ADMIN_DATABASE_URL` et non `DATABASE_URL`

L'application se connecte avec le rôle `cabinetos_app`, qui n'a que **`SELECT`** sur
`platform_admins` (migration 0023). L'écriture exige la connexion d'administration de la base
(rôle propriétaire des tables). Conséquence voulue : **même une faille de l'application ne
peut pas promouvoir un compte** administrateur de plateforme.

### Invariants (ADR-0021, à ne jamais contourner)

1. **Aucun ajout hors de ce script** : jamais d'`INSERT` à la main, ni par un autre chemin.
2. **Un compte créé par ce script reçoit toujours sa ligne `platform_admins` dans le même
   lancement.** Si l'écriture échoue, le compte créé est supprimé aussitôt. Raison : un compte
   sans demande, sans adhésion et sans ligne admin est un _orphelin_ que le parcours
   d'inscription peut récupérer après 10 minutes (P1). Un administrateur n'y est jamais exposé :
   la règle de l'orphelin l'exclut, et la clé étrangère `platform_admins.user_id` empêche de
   toute façon la suppression de son compte.
3. **La trace est conservée** : un retrait n'efface pas la ligne.

### Retirer un administrateur

Il n'y a pas encore de script de retrait (étape 2-bis). La procédure, avec la connexion
d'administration, **à tracer** (qui, quand, pourquoi) là où l'équipe garde ses décisions :

```sql
UPDATE platform_admins SET revoked_at = now() WHERE user_id = '<id du compte>';
```

La garde ignore aussitôt la ligne ; elle reste pour la trace. Le script **refuse** de
réactiver un ancien administrateur révoqué : c'est une décision humaine à prendre et à tracer
à la main.
