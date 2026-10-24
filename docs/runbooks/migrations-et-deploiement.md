# Runbook — migrations de base de données et mise en place d'un environnement

**Statut : proposé, validé en bac à sable, PAS encore validé sur l'hébergement.**
Les commandes ci-dessous ont été **exécutées** sur une base PostgreSQL 16 vierge (Linux) : les blocs `A1` à `A4`, `B2`, `D1` et
`D2` sont extraits de ce fichier et ont été exécutés **tels quels**, et le résultat est identique à celui de la CI (mêmes droits sur les
20 tables et séquences, zéro violation à la vérification, les 55 tests d'isolation passent dessus). **Non testé ici** :
PostgreSQL 18 (version de la CI et de `docker-compose`), et tout ce qui dépend de l'hébergement. Les passages
**« À COMPLÉTER (hébergement) »** attendent la personne qui y a accès.

## 1. Principes

- **Les migrations sont des fichiers SQL versionnés (`db/migrations/*.sql`), appliqués explicitement, jamais
  automatiquement** (ADR-0011), avec la **connexion d'administration** (rôle propriétaire des tables, `postgres`).
- L'application, elle, tourne avec le rôle **`cabinetos_app`** (`NOSUPERUSER`, `NOBYPASSRLS`), jamais avec `postgres`.
  C'est ce qui rend effectives la sécurité par ligne (RLS) et les protections « ajout seul » des historiques.
- **Les migrations s'appliquent avec `psql`, fichier par fichier. N'utilisez PAS `drizzle-kit migrate`** : le journal de
  `drizzle-kit` (`db/migrations/meta/_journal.json`) ne contient que **15 entrées (0000 à 0014)**, alors que le dépôt
  compte **26 fichiers (0000 à 0025)**. Il n'appliquerait pas les onze dernières, écrites à la main.
- **Il n'existe aucune table de suivi des migrations appliquées.** Personne, ni la base, ni un outil, ne sait quelle est
  la dernière migration appliquée : voir §4. **Ne jamais rejouer une migration à l'aveugle.**
- Aucun secret dans Git. Les mots de passe passent par des variables d'environnement.

## 2. Prérequis

- Le client `psql` (la CI en utilise un 16 contre un serveur 18 ; seul `pg_dump` exige un client au moins aussi récent
  que le serveur, voir ADR-0011).
- Une connexion d'administration qui peut : `CREATE DATABASE`, `CREATE ROLE`, et **`CREATE EXTENSION`** pour `pg_trgm` et
  `unaccent` (migration 0009). **À vérifier sur l'hébergement** : certains services managés n'autorisent ces extensions
  qu'à un rôle précis.
- Les variables ci-dessous (les mots de passe contenant des caractères spéciaux doivent être encodés dans les URL) :

```bash
export DB_NAME=cabinetos_recette
export ADMIN_SERVER_URL='postgres://postgres:MOT_DE_PASSE_ADMIN@HOTE:5432/postgres'
export ADMIN_DATABASE_URL="postgres://postgres:MOT_DE_PASSE_ADMIN@HOTE:5432/$DB_NAME"
export APP_DB_PASSWORD='UN_SECRET_FORT_DIFFERENT_DE_CELUI_DE_LA_CI'
# DATABASE_URL de l'application = postgres://cabinetos_app:<APP_DB_PASSWORD>@HOTE:5432/<DB_NAME>
```

> Le mot de passe `cabinetos_app_pw` qui figure dans `ci.yml` est un mot de passe **de test**. Ne jamais l'utiliser en recette ni en production.

## 3. A — Première mise en place d'un environnement

**Ordre impératif : le rôle applicatif est créé AVANT les migrations.** Les migrations 0003, 0019 et 0023 *retirent* des
droits à ce rôle ; elles échouent s'il n'existe pas (§6, cas 2), et elles perdent leur effet si des droits généraux sont
accordés après elles (§6, cas 3). La CI procède autrement (migrations, puis création du rôle, puis 0003, 0019 et 0023) ; le
résultat est le même (vérifié), mais l'ordre ci-dessous est plus simple et ne demande aucune exception.

**A1 — Créer la base**
```bash
# [A1]
psql "$ADMIN_SERVER_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE $DB_NAME"
```

**A2 — Créer le rôle applicatif et ses droits par défaut**
```bash
# [A2]
psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -v app_password="$APP_DB_PASSWORD" -v db_name="$DB_NAME" <<'SQL'
CREATE ROLE cabinetos_app LOGIN PASSWORD :'app_password' NOSUPERUSER NOBYPASSRLS;
GRANT CONNECT ON DATABASE :"db_name" TO cabinetos_app;
GRANT USAGE ON SCHEMA public TO cabinetos_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cabinetos_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO cabinetos_app;
SQL
```
`ALTER DEFAULT PRIVILEGES` (sans `FOR ROLE`) s'applique aux tables créées par **le rôle qui exécute cette commande** : ce doit
être le même que celui qui applique les migrations à l'étape A3, et qui en est propriétaire.

**A3 — Appliquer TOUTES les migrations, en ordre numérique strict**
```bash
# [A3]  (depuis la racine du dépôt)
for f in db/migrations/*.sql; do
  echo ">>> $f"
  psql "$ADMIN_DATABASE_URL" -q -v ON_ERROR_STOP=1 --single-transaction -f "$f" \
    || { echo "ECHEC sur $f : ARRETER ICI, ne pas continuer."; break; }
done
```
- **`-v ON_ERROR_STOP=1` est indispensable** : sans lui, `psql` continue après une instruction en erreur et rend le code de
  sortie **0** (§6, cas 1). `ci.yml` n'utilise pas cette option aujourd'hui.
- **`--single-transaction`** : chaque fichier est appliqué en entier ou pas du tout. Testé sur les 26 fichiers (PostgreSQL 16).
- L'ordre alphabétique des fichiers est l'ordre numérique (numéros sur quatre chiffres).
- Durée mesurée sur une base vierge : environ 2 secondes.

**A4 — Vérifier : le résultat doit être « VERIFICATION OK »**
```bash
# [A4]
OUT=$(psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -At -f db/verify-privileges.sql)
if [ -z "$OUT" ]; then echo "VERIFICATION OK : aucune violation"; else echo "VIOLATIONS :"; echo "$OUT"; fi
```
**Ne pas se fier au code de sortie** : la requête est un simple `SELECT`, elle rend le code 0 même lorsqu'elle liste des violations.
Seule la **sortie vide** compte.

`db/verify-privileges.sql` (lecture seule) contrôle : le rôle applicatif existe et n'est ni superutilisateur ni
`BYPASSRLS` ; les historiques sont en ajout seul ; `platform_admins` est en lecture seule pour l'application ; le rôle
applicatif a gardé ses droits normaux ; la sécurité par ligne est activée **et forcée** sur les huit tables concernées ;
les objets de l'étape 2 existent. **Chaque ligne listée est une violation : ne pas démarrer l'application.** Si le rôle applicatif n'existe pas, la requête le dit (`rôle cabinetos_app introuvable`) au lieu d'échouer.

**A5 — Créer le premier administrateur de plateforme**
Aucun compte ne peut s'attribuer ce droit : l'application n'a que la **lecture** de `platform_admins`. Voir
`apps/api/scripts/README.md`. Le script charge la configuration complète de l'application : il lui faut donc les **mêmes
variables d'environnement que l'API** (étape A6), plus `ADMIN_DATABASE_URL`.
```bash
TEAM_ACCOUNT_PASSWORD='…' pnpm --filter @cabinetos/api run admin:grant -- \
  --email prenom.nom@exemple.ma --name "Prénom Nom" \
  --granted-by "Prénom Nom" --reason "co-fondatrice, validation des inscriptions"
```

**A6 — Variables d'environnement de l'API.** Liste de référence : `apps/api/.env.recette.example`. L'API **refuse de démarrer**
si une variable obligatoire manque, c'est voulu. Deux pièges :
- **`APP_BASE_URL`** (adresse publique du front) est obligatoire en production : cible du lien de l'email d'activation.
- **`EMAIL_REPLY_TO`** doit être une boîte réellement surveillée : le médecin répond directement à l'email de complément.

Côté front : `API_URL`, et `NEXT_PUBLIC_SUPPORT_WHATSAPP` / `NEXT_PUBLIC_SUPPORT_PHONE` (un contact non configuré n'est pas affiché).

**A7 — Démarrer, puis contrôler.** `GET /api/v1/health` doit répondre 200, puis la page `/fr/login` du front.
**À COMPLÉTER (hébergement)** : la commande ou le mécanisme de démarrage de l'API et du front.

## 4. B — Mises à jour

**B1 — Sauvegarder** (§7, bloc `D1`), **avant** toute migration.

**B2 — Identifier les migrations à appliquer.** Comme il n'existe pas de table de suivi, **tenez un journal de déploiement**
(quelle migration, quand, par qui). À défaut, l'état se déduit d'un objet témoin :

| Migration | Objet témoin |
|---|---|
| 0017 | colonne `users.organization_memberships` |
| 0018 | tables `registration_requests` et `registration_events` |
| 0021 | colonnes `registration_requests.complement_requested_info` et `complement_message` |
| 0022 | table `platform_admins` |
| 0024 | colonnes `organizations.city` et `organizations.address` |
| 0025 | rôle `fondateur` dans la table `roles` |
| 0003, 0019, 0023 | des droits, pas un objet : les contrôle la vérification A4 |
| 0020 | un rattrapage de données (cache d'appartenance) : aucun objet témoin |

```bash
# [B2]  Résultat attendu pour l'étape 2 complète : registration_requests|platform_admins|2|1
psql "$ADMIN_DATABASE_URL" -At -c "SELECT to_regclass('public.registration_requests'), to_regclass('public.platform_admins'), (SELECT count(*) FROM information_schema.columns WHERE table_name = 'organizations' AND column_name IN ('city', 'address')), (SELECT count(*) FROM roles WHERE name = 'fondateur')"
```

**Rejouabilité, mesurée** : chaque migration a été rejouée sur une copie d'une base à jour (avec `ON_ERROR_STOP` et en
transaction), en surveillant cinq compteurs (permissions, rôles, liens rôle-permission, utilisateurs, organisations).
- **Rejouables sans erreur et sans donnée dupliquée : 0003, 0008, 0010, 0011, 0019, 0020, 0023, 0024, 0025.**
- **Échouent (« existe déjà ») : 0000, 0001, 0002, 0004, 0005, 0006, 0007, 0009, 0012, 0013, 0014, 0015, 0016, 0017, 0018, 0021, 0022.**
  **Ne jamais les rejouer.** L'échec est franc et la transaction annule tout : rien n'est corrompu, mais un rejeu ne « répare » rien.

« Rejouable » signifie ici : aucune erreur et aucun changement dans ces cinq compteurs. Les autres effets n'ont pas été mesurés.

**B3 — Appliquer uniquement les nouvelles**, dans l'ordre, avec la même boucle qu'en A3, par exemple pour 0026 et 0027 :
`for f in db/migrations/0026_*.sql db/migrations/0027_*.sql; do … done`.

**B4 — Relancer la vérification A4.** Résultat attendu : « VERIFICATION OK ».

**B5 — Puis seulement** déployer et redémarrer l'application. Jamais l'inverse, jamais en automatique.

## 5. C — Retour arrière

- **Application** : tags d'image Docker. **À COMPLÉTER (hébergement)** : où les tags sont conservés, et la commande pour revenir à l'état précédent.
- **Base** : 21 migrations sur 26 portent une section `DOWN` en **commentaire**, qui n'est **jamais exécutée automatiquement**.
  **Cinq n'en ont aucune : 0000, 0001, 0002, 0004, 0012** ; pour celles-ci, le retour arrière se fait par **restauration d'une
  sauvegarde**. Une section `DOWN` est **destructive** quand elle supprime une colonne ou une table : les données qu'elles
  contiennent sont perdues. Toujours sauvegarder avant, et l'exécuter à la main, dans une transaction.

## 6. Quand ça tourne mal : les trois erreurs d'exploitation (reproduites)

| # | Situation | Ce qu'on observe | Que faire |
|---|---|---|---|
| 1 | Migration appliquée **sans** `ON_ERROR_STOP` | Une instruction échoue au milieu, **code de sortie 0**, et les instructions suivantes **s'exécutent quand même** : la base est à moitié migrée sans aucun signal. | Toujours `-v ON_ERROR_STOP=1 --single-transaction`. En cas de doute sur un état partiel, restaurer la sauvegarde. |
| 2 | 0019 ou 0023 appliquée **sans** le rôle applicatif | **Erreur franche** : `ERROR:  role "cabinetos_app" does not exist`, code 3. | Créer le rôle (A2), puis rejouer le fichier (un `REVOKE` est rejouable sans effet de bord). |
| 3 | Droits généraux accordés **après** 0003, 0019 et 0023 (par ex. rejouer l'ancien `GRANT … ON ALL TABLES` de la CI) | **Silencieux** : code 0, aucun message, et quatre protections sont annulées : `audit_events`, `registration_events` et `registration_requests` redeviennent modifiables par l'application, `platform_admins` redevient inscriptible. | Lancer A4 : il liste exactement ces violations. Rejouer 0003, 0019 et 0023 (rejouables), puis relancer A4. |

Le cas 3 est le plus dangereux : seule la vérification A4 (ou les tests d'isolation) le révèle.

## 7. D — Sauvegardes

La stratégie (ADR-0011) est : sauvegardes **automatiques**, avec **test de restauration périodique**. **À COMPLÉTER
(hébergement)** : le mécanisme automatique réel et la fréquence du test.

**Avant chaque migration**, sauvegarde manuelle. Le client `pg_dump` doit être **au moins aussi récent que le serveur**
(ADR-0011) :
```bash
# [D1]
export BACKUP_FILE="sauvegarde-avant-migration-$(date +%Y%m%d-%H%M).dump"
pg_dump "$ADMIN_DATABASE_URL" -Fc -f "$BACKUP_FILE"
```

**Test de restauration** : toujours dans une base **vierge**, jamais sur la base en service. Il n'est valable que si la
vérification A4 y passe aussi :
```bash
# [D2]
export RESTORE_URL="${ADMIN_DATABASE_URL%/*}/cabinetos_restauration_test"
psql "$ADMIN_SERVER_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE cabinetos_restauration_test"
pg_restore --exit-on-error -d "$RESTORE_URL" "$BACKUP_FILE"
OUT=$(psql "$RESTORE_URL" -v ON_ERROR_STOP=1 -At -f db/verify-privileges.sql)
if [ -z "$OUT" ]; then echo "RESTAURATION OK : aucune violation"; else echo "VIOLATIONS :"; echo "$OUT"; fi
```

**Mesuré :**
- Une sauvegarde de la base vierge migrée pèse environ 65 Ko et se fait en moins d'une seconde.
- Restaurée sur un serveur où le rôle `cabinetos_app` **existe**, elle réussit (code 0) et la vérification A4 ne signale **aucune violation** : les droits sont bien restaurés avec les tables.
- Restaurée sur un serveur où ce rôle **n'existe pas**, elle **échoue** (code 1, 46 erreurs, la première : `role "cabinetos_app" does not exist`).
  **Les rôles ne font pas partie de la sauvegarde d'une base** : sur un nouveau serveur, il faut recréer le rôle applicatif (la
  première instruction de A2) **avant** de restaurer.

## 8. Ce qui reste à compléter (hébergement)

- [ ] D'où s'exécute `psql` (poste d'exploitation, bastion, console de l'hébergeur) et qui détient `ADMIN_DATABASE_URL`.
- [ ] Les droits de la connexion d'administration pour `CREATE EXTENSION pg_trgm` et `unaccent` (§2).
- [ ] La commande de démarrage de l'API et du front, et la gestion des tags d'image (§3 A7, §5).
- [ ] La sauvegarde automatique réelle et la fréquence du test de restauration (§7).
- [ ] La version PostgreSQL de l'hébergement : ce runbook a été validé sur la 16 ; la CI utilise la 18.
- [ ] Une **table de suivi des migrations** : recommandée, **non créée ici**. Elle supprimerait le risque de rejeu à l'aveugle.
- [ ] Ajouter `-v ON_ERROR_STOP=1` à l'étape de migrations de `ci.yml` : recommandé, **non fait ici**. Aucune erreur SQL n'a été relevée dans le journal de la CI rejouée, donc le changement ne devrait pas la faire échouer.
