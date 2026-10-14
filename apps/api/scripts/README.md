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
   ajouté **que par script documenté et tracé**. Ce script viendra avec la table (TASK-058).

Ne créez jamais de compte directement en base ou par un autre chemin.
