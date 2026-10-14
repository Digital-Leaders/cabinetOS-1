# ADR-0021 — Modèle de l'inscription du fondateur : demandes, accès admin, cascade atomique

**Statut** : Accepté (BUILD-004 étape 2, validé par l'encadrant ; couvre EA-014 à EA-018)

## Contexte

L'étape 2 du parcours d'accès (brief du 8 octobre, R1 à R9) fait créer, par un
fondateur, son compte et sa future organisation, avec validation humaine, puis une
cascade qui crée tout l'écosystème d'un coup. Le brief tranche les règles métier ;
il laisse ouvertes cinq questions d'implémentation, soulevées dans la note de
découpage et vérifiées dans le code actuel :

1. **L'inscription native est publique.** `emailAndPassword` est activé :
   `POST /api/v1/auth/sign-up/email` permet à n'importe qui de créer un compte sans
   passer par la validation.
2. **Aucun statut ni historique pré-organisation.** `users` (table Better-Auth) n'a
   pas de statut ; `audit_events` est scopé par organisation, donc inutilisable
   avant que l'organisation existe.
3. **L'autorisation est scopée par organisation.** `PermissionsGuard` exige
   `x-organization-id` et une permission dans cette organisation. L'admin de
   validation est l'équipe CabinetOS : hors de toute organisation.
4. **Les fonctions de création ouvrent chacune leur transaction.** `createMedecin`
   et `createMembership` passent par `withOrganizationScope` (`db.transaction`,
   connexion distincte) ; `createOrganization` écrit sans transaction. Enchaînées
   telles quelles, la cascade n'est pas atomique, et la clé étrangère composite
   `medecins (organization_id, user_id) → memberships` ne voit pas une membership
   non validée.
5. **Données manquantes.** `organizations` ne porte que `name` et `slug` (R5 demande
   ville et adresse) ; aucun rôle n'est semé, seules les permissions manage/read sur
   patients et medecins existent.

## Décision

### D1 — Modèle des demandes (EA-014)

Deux tables globales, hors RLS (l'organisation n'existe pas encore) :

- **`registration_requests`** : une ligne par fondateur (`user_id` unique), le statut
  (`PENDING_VERIFICATION`, `COMPLEMENT_REQUESTED`, `ACTIVE`, `REFUSED`, contrainte
  CHECK), les données déclarées (prénom, nom, spécialité, INPE, n° d'Ordre, nom de
  structure, ville, adresse), la note interne, l'horodatage du dernier renvoi
  d'email (anti-abus), et `organization_id` renseigné à la validation. Le refus
  porte deux colonnes distinctes : `refusal_internal_reason` et
  `refusal_message_to_applicant`. Les endpoints côté fondateur sélectionnent
  explicitement la seconde, jamais la première (R8).
- **`registration_events`** : historique append-only (même principe
  qu'`audit_events` : le rôle applicatif n'a pas UPDATE/DELETE). Chaque transition
  et chaque envoi d'email, réussi ou échoué, y est inscrit (date, action, admin). Il
  ne contient pas le contenu des échanges (R7).

**Règle d'accès** : « non-ACTIVE » ⇔ une demande existe avec un statut ≠ ACTIVE. Un
compte sans demande (créé par l'équipe à l'étape 1) est inchangé : aucune migration
de données, aucune régression sur l'étape 1.

### D2 — Fermeture de l'inscription native (EA-014)

Le compte est créé côté serveur par le cas d'usage d'inscription, qui appelle l'API
Better-Auth (`auth.api.signUpEmail`), puis crée la demande. L'appel HTTP direct à
`/sign-up/email` est refusé par un hook `before` de Better-Auth (les appels internes
restent permis). Le cookie de session est transmis au fondateur pour qu'il atteigne
l'écran de statut. Si l'insertion de la demande échoue après la création du compte,
le compte est supprimé (compensation, voir P1).

**Mécanisme à confirmer en TASK-052.** Si le hook ne permet pas de distinguer
l'appel interne de l'appel HTTP, le repli est `disableSignUp: true` et une création
de compte via le contexte interne de Better-Auth. Dans les deux cas, le résultat
attendu est le même : plus aucune création de compte sans demande.

Les comptes créés à la main par l'équipe (démos, admins) passent par un script
documenté. La gestion des comptes admin sans script est l'étape 2-bis (brief §1).

### D3 — Rôle admin de plateforme (EA-017)

Table `platform_admins` (`user_id`) et garde `@RequirePlatformAdmin()`, dans la
lignée de `@RequireAuthentication()` (étape 1). Ni colonne sur `users` (table gérée
par Better-Auth), ni organisation interne « CabinetOS » (qui mélangerait le
personnel de la plateforme et le modèle multi-tenant, sans même donner une vue
transverse, la RLS isolant chaque organisation). Les endpoints admin vivent sous un
préfixe dédié ; l'accès d'un non-admin est refusé et testé.

### D4 — Règle de connexion selon statut (EA-015, EA-016)

Un endpoint `GET /identity/registration-status` (authentifié, sans organisation)
renvoie le statut, l'email masqué et, pour un refus, le message au demandeur. Le
front route après connexion : seul ACTIVE (ou un compte sans demande) entre dans les
modules. L'API est sûre par construction : un fondateur non-ACTIVE n'a aucune
membership, donc aucune permission ; toute requête de données est refusée même si
le front était contourné. Un test le prouve.

### D5 — Cascade atomique (EA-018)

Extraire le corps de `createOrganization`, `createMembership` et `createMedecin` en
variantes qui reçoivent une transaction existante (`…InTx(tx, …)`) ; les fonctions
publiques actuelles deviennent de fines enveloppes. Un seul chemin de code :
normalisation INPE, RLS et contraintes du module Médecin s'appliquent à l'identique
(R4, « pas de chemin parallèle »).

La cascade s'exécute dans une seule transaction :
`withOrganizationScope(nouvelOrgId, tx => …)` avec un UUID généré en amont
(`organizations` n'a pas de RLS). Ordre imposé par la clé étrangère composite :
organisation → membership (avec synchronisation du cache d'appartenance, ADR-0019)
→ fiche médecin → statut ACTIVE. Tout réussit ou tout échoue. L'email d'activation
part après la validation de la transaction ; son résultat (`{ ok, … }`, ADR-0020)
est inscrit dans l'historique, sans jamais annuler la validation (R6). Les
transitions de statut sont conditionnelles (`UPDATE … WHERE statut IN (…)`) : une
demande déjà traitée n'est pas retraitée.

Cela touche le code du module Médecin (BUILD-003) sans changer son comportement.
Conformément au brief (§10.1), aucun test existant du module n'est modifié ; si l'un
devait l'être, on s'arrête et on en discute.

### D6 — Données de l'organisation et rôle fondateur (EA-018)

- Migration ajoutant `city` et `address` (nullables) à `organizations` (R5).
- Migration créant le rôle global fondateur : manage et read sur patients et
  medecins (le périmètre actuel du compte de démonstration). Les permissions de
  gestion des membres arriveront avec l'étape 3.

### D7 — Valeurs par défaut (confirmées par l'encadrant)

- Délai anti-abus du renvoi d'email : **60 secondes** (on montera en cas d'abus).
- « Généraliste » : la demande stocke un choix explicite `generaliste` ; la cascade
  le traduit en `NULL` (le modèle Médecin représente un généraliste par une
  spécialité NULL).
- Liste des villes : constante partagée des principales villes (V1), sans table. Une
  liste personnalisable par l'admin viendra plus tard, pas maintenant.
- Slug de l'organisation : généré depuis le nom de la structure, avec suffixe en cas
  de collision (le slug est unique).
- Email déjà utilisé : message clair mais neutre, qui ne révèle pas l'état du compte
  existant.

## Précisions intégrées à l'acceptation

**P1 — Compte orphelin (complète D2).** La compensation est réessayée ; en cas
d'échec persistant, une erreur technique est journalisée (sans donnée personnelle).
Le chemin « email déjà utilisé » ne récupère qu'un **orphelin strict** : aucune ligne
`registration_requests`, aucune `membership`, aucune ligne `platform_admins`, **et**
un compte créé depuis plus de **10 minutes** (constante nommée). Le délai protège
une inscription en cours, dont le compte existe déjà mais dont la demande n'est pas
encore insérée. Ce compte est supprimé puis l'inscription reprend normalement. Tout
autre compte reçoit le message neutre.
Invariant associé : un compte d'équipe créé par script reçoit toujours au moins une
membership ou une ligne `platform_admins` dans le même lancement.
Tests (TASK-052) : un orphelin de plus de 10 minutes est récupéré ; un orphelin
récent ne l'est jamais ; une tentative concurrente ne supprime pas un compte dont la
demande est en cours d'insertion ; un compte d'équipe avec membership et un
platform admin ne le sont jamais.

**P2 — Réinscription après refus (choix assumé, D1).** `user_id` est unique et le
compte est conservé au refus : un médecin refusé ne peut pas se réinscrire en V1.
Refusé = nous recontacter. Choix délibéré, pas un effet de bord.

**P3 — Invariant `platform_admins` (D3).** C'est la seule table qui transcende
l'isolation des tenants. Tant que l'étape 2-bis n'existe pas, un admin n'y est
ajouté que par le script documenté, et chaque ajout est tracé. Rappelé dans le
README du script.

**P4 — Limite connue : email d'activation après commit (D5).** Si le process
s'arrête entre le commit de la cascade et l'envoi, la demande est ACTIVE sans email
parti. Récupération : renvoi par l'admin. Accepté pour la V1.

## Justification

- **Aucune régression sur l'étape 1** : l'accès ne change pour personne tant
  qu'aucune demande n'existe.
- **Sécurité par construction** : la porte d'inscription est fermée à la source ; le
  motif interne de refus est dans une colonne que le chemin fondateur ne lit jamais ;
  un non-ACTIVE ne peut rien lire faute de membership.
- **Atomicité sans chemin parallèle** : les variantes « avec transaction » sont le
  même code, seule la frontière transactionnelle change.
- **Historique fiable** : append-only, il survit à un échec d'email ou à un refus et
  ne dépend d'aucune organisation.

## Conséquences

- Plusieurs migrations, numérotées à la suite et ajoutées à `ci.yml` : demandes et
  historique (EA-014), administrateurs de plateforme (EA-017), colonnes de
  l'organisation et rôle fondateur (EA-018).
- Un refactor du module Médecin (D5), couvert par ses tests existants, plus les
  trois tests critiques du brief : cascade atomique (T1, avec panne simulée au
  milieu), découplage de l'email (T2), séparation du refus (T3).
- Le démarrage ne dépend plus d'aucune création de compte ouverte ; les comptes
  d'équipe se créent par script jusqu'à l'étape 2-bis.
- Si une décision ci-dessus doit changer en cours de développement, elle passe par
  un ADR de révision, jamais en silence (brief §11).
