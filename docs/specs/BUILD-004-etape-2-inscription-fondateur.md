# CabinetOS — Brief développeur

## Parcours d'accès · Étape 2 — S'inscrire (fondateur)

Ce brief transforme les décisions de conception en **exigences implémentables** : fonctions, règles métier, états et transitions, exigences techniques, cas d'erreur, et critères d'acceptation testables. Il accompagne cinq maquettes HTML (inscription, statut d'attente, admin liste, admin détail, admin actions).

**Rappel de cycle.** Étape 2 du BUILD-004 (parcours d'accès). Le Build reste ouvert ; l'étape 3 (inviter des membres) suit. Comme d'habitude, les maquettes montrent le comportement voulu, pas du code à copier ; toute règle est re-validée côté serveur.

---

# 1. Périmètre & principe directeur

## Ce que fait l'étape 2

Un **fondateur médecin** s'inscrit lui-même : il crée son compte **et** sa nouvelle organisation. Sa demande passe par une **validation humaine** (contrôle anti-usurpation par recoupement de sources publiques) avant activation. À la validation, tout son écosystème est créé d'un coup.

## Principe directeur (à garder présent partout)

**L'espace admin aide l'humain à vérifier ; il n'automatise jamais la décision.** Aucun score, aucune checklist, aucune conclusion automatique tirée de résultats de recherche. La validité d'un médecin est appréciée par une personne, par faisceau d'indices.

## Hors périmètre (nommé)

- L'invitation de membres à une organisation existante (étape 3).
- La réinitialisation de mot de passe en libre-service (viendra ; réutilisera l'email introduit ici).
- Le fondateur non-médecin (gestionnaire, directeur) — voir règle d'architecture §2.
- Tout dépôt/stockage de document justificatif (décision : vérification par sources publiques, pas par documents).

---

# 2. Règles métier

## R1 — Contenu de l'inscription

Le formulaire collecte, en une page (trois blocs) :
- **Vous** : prénom, nom, email, mot de passe.
- **Votre activité** : spécialité (liste contrôlée du module Médecin), INPE (facultatif), n° d'Ordre (facultatif).
- **Votre cabinet** : nom du cabinet ou structure d'exercice, ville (liste contrôlée), adresse.

Champs **obligatoires** : prénom, nom, email, mot de passe, spécialité, nom de structure, ville. **Facultatifs** : INPE, n° d'Ordre, adresse. Aucun des deux identifiants professionnels n'est obligatoire, sans justification métier de cette facultativité (ni règle public/privé).

## R2 — La validation est humaine, par recoupement de sources publiques

L'équipe vérifie la concordance (identité, spécialité, existence de l'activité, cabinet, ville, adresse) à partir de sources publiques (Google, Maps, annuaires, site). **Ne jamais exiger la présence sur une source particulière** : l'absence de fiche Google n'est pas un motif de refus.

## R3 — Fondateur = médecin (règle de workflow, PAS de modèle)

Pour la V1, le fondateur est **obligatoirement** médecin : à la validation, une fiche médecin lui est créée. **Mais** cette obligation est une règle du **parcours d'inscription V1**, jamais une contrainte du modèle de données. Le modèle reste : `User → Membership → Organization` et `User → DoctorProfile` **séparés**. Ne jamais coder `FounderUser = Doctor`. Objectif : permettre plus tard un fondateur non-médecin sans refonte.

## R4 — La cascade de validation (5 opérations)

Quand l'admin valide, CabinetOS exécute, **de façon cohérente** :
1. activation du compte (statut → `ACTIVE`) ;
2. création de l'organisation ;
3. rattachement du fondateur comme premier membre (`membership`, avec un rôle admin/fondateur) ;
4. **création de sa fiche médecin**, pré-remplie des données d'inscription, liée à son `userId` — **via les fonctions normales du module Médecin** (createMedecin, `userId` renseigné), jamais un chemin de création parallèle. Ainsi l'isolation, les contraintes et l'unicité déjà validées du module Médecin s'appliquent automatiquement ;
5. **puis, séparément** : envoi de l'email d'activation (voir R6).

Les opérations 1 à 4 forment l'acte métier atomique. L'opération 5 est découplée.

## R5 — Aucune ressaisie

Les données d'inscription pré-remplissent la fiche médecin (nom, prénom, spécialité, INPE, n° d'Ordre) et l'organisation (nom, ville, adresse). Le fondateur ne ressaisit rien après validation ; il complètera éventuellement sa fiche depuis le produit.

## R6 — Validation et notification découplées (règle critique)

**La validation métier ne doit jamais échouer parce que l'email n'a pas pu partir.** Séquence : l'admin valide → les opérations 1-4 sont enregistrées et font foi → l'email d'activation est déclenché *ensuite*, comme opération distincte. Si l'envoi échoue : la validation **reste acquise**, l'échec est visible dans l'historique, et l'admin peut **relancer** l'envoi. Jamais de rollback de la validation sur échec d'email.

## R7 — Le complément se fait par email, hors logiciel

Quand la vérification est insuffisante, l'admin demande un complément : choix du type (lien fiche Google / autre présence publique / autre à préciser) + message pré-rempli modifiable → statut `COMPLEMENT_REQUESTED` + email au médecin. Le médecin (ou son secrétariat) **répond directement à l'email**. L'email part d'une adresse **Reply-To réellement surveillée** par l'équipe. La réponse n'est pas intégrée dans CabinetOS en V1 : l'admin la lit dans sa boîte, revient et valide/refuse manuellement. CabinetOS conserve la **trace de l'action** (complément demandé, date, admin, décision), pas le contenu de l'échange.

## R8 — Refus : deux champs strictement séparés

Le refus exige un **motif interne obligatoire** (jamais communiqué au demandeur) ET un **message au demandeur** distinct (pré-rempli, modifiable, laissant une porte de contact ouverte). Impossible par conception d'envoyer le motif interne au médecin. Le refus demande une **confirmation** avant exécution.

## R9 — Données déclarées en lecture seule (admin)

L'admin **examine** la déclaration du médecin ; il ne la **modifie pas** depuis l'écran de validation. Les informations d'inscription sont affichées en lecture seule.

---

# 3. États & transitions

## Statuts de la demande / du compte

| Statut | Signification | Le fondateur peut… |
|---|---|---|
| `PENDING_VERIFICATION` | Inscrit, en attente de contrôle | s'authentifier → écran « en vérification » ; rien d'autre |
| `COMPLEMENT_REQUESTED` | Complément demandé par email | s'authentifier → écran « complément demandé » ; renvoyer l'email |
| `ACTIVE` | Validé, écosystème créé | se connecter et entrer dans CabinetOS |
| `REFUSED` | Refusé | s'authentifier → message de refus (version demandeur) |

## Transitions (déclenchées par l'admin, sauf la première)

- inscription → `PENDING_VERIFICATION`
- `PENDING_VERIFICATION` → `COMPLEMENT_REQUESTED` (demande de complément)
- `COMPLEMENT_REQUESTED` → `PENDING_VERIFICATION` (optionnel, si l'admin re-bascule) ou directement → `ACTIVE` / `REFUSED`
- `PENDING_VERIFICATION` / `COMPLEMENT_REQUESTED` → `ACTIVE` (validation → cascade R4)
- `PENDING_VERIFICATION` / `COMPLEMENT_REQUESTED` → `REFUSED` (refus → R8)

Chaque transition significative est inscrite dans l'**historique** (date, action, admin) et, quand elle requiert l'attention du médecin, déclenche un email.

## Règle de connexion (complète l'étape 1)

L'authentification vérifie les identifiants **ET** le statut. Un mot de passe correct sur un compte non-`ACTIVE` **n'ouvre pas** l'accès aux modules : il mène à l'**écran de statut** correspondant. Seul `ACTIVE` donne accès au produit. Cette règle modifie le comportement post-connexion de l'étape 1.

---

# 4. Infrastructure email transactionnel (brique nouvelle)

## Périmètre — volontairement minimal

Introduire une capacité d'**email transactionnel**, pas un système de notifications. Besoin : `CabinetOS → service d'envoi → destinataire`, avec quelques modèles et un point d'envoi centralisé. **Hors périmètre** : préférences utilisateur, campagnes, moteur de notifications, historique de communication.

## Capacité transverse

Cette brique est **réutilisable** (réinitialisation de mot de passe et invitations de l'étape 3 s'appuieront dessus). La concevoir comme un service partagé du socle, pas comme un bout de code du seul parcours d'inscription.

## Emails de l'étape 2

1. **Confirmation immédiate** (à la soumission de l'inscription) : « demande reçue, statut en vérification ». Sert aussi de **test de validité de l'adresse**.
2. **Demande de complément** (transition `COMPLEMENT_REQUESTED`) : Reply-To surveillé, réponse attendue du médecin.
3. **Activation** (transition `ACTIVE`) : « votre compte est activé, connectez-vous ».
4. **Refus** (transition `REFUSED`) : version *message au demandeur* uniquement — jamais le motif interne.

## Découplage (rappel R6)

L'envoi est toujours **postérieur et distinct** de l'acte métier. Échec d'envoi ⇒ trace + possibilité de renvoi, jamais d'annulation de l'acte.

---

# 5. Écrans (maquettes jointes)

## 5.1 Inscription (`inscription.html`)
Une page, trois blocs, un CTA « Créer mon espace ». Spécialité et ville en listes contrôlées. INPE / Ordre facultatifs. Sous-titre sobre, pas d'explication du processus de vérification sur cette page.

## 5.2 Statut d'attente (`statut-attente.html`, 2 variantes)
Page pleine, **sans navigation CabinetOS** (authentifié mais pas autorisé à entrer). L'écran affiché est **déterminé par le statut réel**, jamais par un choix de l'utilisateur (les onglets de la maquette n'existent pas dans le produit).
- **En vérification** : message + « Vous n'avez rien à faire pour le moment » + email masqué + WhatsApp/téléphone + déconnexion.
- **Complément demandé** : message court + « Renvoyer l'email » + rappel indésirables + email masqué + contacts + déconnexion.
- **Email masqué** (`y•••••@…`) : diagnostic seulement, **non modifiable** depuis cette page (sécurité).
- **« Renvoyer l'email »** : anti-abus obligatoire — après clic, état « ✓ Email renvoyé » et délai avant nouvel envoi autorisé. Présent uniquement sur la variante complément.

## 5.3 Admin — liste (`admin-validation.html`)
Filtres **À traiter / Validées / Refusées** (À traiter par défaut ; les deux sous-états y sont distingués par leurs badges). Recherche par nom/cabinet. Chaque ligne : Dr Nom, spécialité, cabinet, ville, date, badge. **Toute la ligne est cliquable** (zone tactile mobile). Accès réservé à un rôle admin.

## 5.4 Admin — détail
En-tête (nom, spécialité, statut, date). Deux blocs **lecture seule** (Médecin / Structure). **Raccourcis de recherche** pré-remplis (Google, Maps, annuaire générique — pas de source unique privilégiée) avec le rappel « CabinetOS ne conclut jamais automatiquement ». **Note interne facultative** (jamais de checklist/score). **Historique**. Trois actions.

## 5.5 Admin — les trois actions
- **Valider** : confirmation qui **rappelle la cascade** (R4) et le découplage email (R6).
- **Demander un complément** : type d'info + message modifiable → « Envoyer la demande » (R7).
- **Refuser** : motif interne obligatoire (encadré, « non communiqué ») + message au demandeur séparé + **confirmation** (R8).

---

# 6. Cas d'erreur à traiter

- **Email d'inscription déjà utilisé** : message clair, pas de création de doublon, pas de fuite (ne pas révéler l'état d'un compte existant plus que nécessaire).
- **Échec d'envoi d'un email** (tous types) : l'acte métier associé reste acquis ; trace dans l'historique ; renvoi possible (R6).
- **Connexion sur compte non-`ACTIVE`** : mène à l'écran de statut, jamais aux modules (§3).
- **Complément demandé sans réponse** : l'admin peut **renvoyer** la demande sans recréer la demande.
- **Renvoi d'email abusif** (fondateur) : bloqué par le délai anti-abus (§5.2).
- **Validation dont une opération de la cascade échoue** : l'acte métier 1-4 doit être cohérent (soit tout, soit rien pour ces quatre) ; l'email (5) est à part. Définir le comportement si (ex.) la création de fiche médecin échoue — la validation ne doit pas laisser un état incohérent.
- **Double validation / action concurrente** (deux admins sur la même demande) : une demande déjà traitée ne se re-traite pas ; signaler l'état courant.

---

# 7. Critères d'acceptation testables

- Une inscription complète crée une demande en `PENDING_VERIFICATION` **et** envoie l'email de confirmation ; l'email de confirmation part même si tout le reste est minimal.
- Une inscription avec email déjà utilisé n'crée pas de doublon et renvoie une erreur exploitable.
- INPE et n° d'Ordre absents **n'empêchent pas** l'inscription.
- Un compte `PENDING_VERIFICATION` / `COMPLEMENT_REQUESTED` / `REFUSED` qui s'authentifie **n'accède pas** aux modules ; il atteint l'écran de statut correspondant. Seul `ACTIVE` entre.
- La validation crée, pour un même acte : compte `ACTIVE` + organisation + membership fondateur + **fiche médecin liée au `userId`, créée via les fonctions du module Médecin** — vérifiable, et pré-remplie sans ressaisie.
- **Test du découplage** : simuler un échec d'envoi de l'email d'activation → la validation reste acquise (compte `ACTIVE`, écosystème créé), l'historique montre l'échec, le renvoi fonctionne.
- **Test de séparation du refus** : le motif interne n'apparaît **jamais** dans l'email envoyé au demandeur (test sur le contenu de l'email).
- Le renvoi d'email côté fondateur est limité par le délai anti-abus (deux clics rapprochés → un seul envoi).
- La demande de complément passe la demande en `COMPLEMENT_REQUESTED`, envoie l'email, inscrit l'historique.
- L'admin ne peut pas modifier les données déclarées depuis l'écran de validation (lecture seule vérifiée).
- Sortie CI : **aucune régression** sur l'étape 1, Patient et Médecin (l'auth et la création de fiche médecin sont transverses).

---

# 8. Règles non-négociables (rappel, tous écrans)

1. **Contraste AA** (ratio ≥ 4.5 ; un texte qui passe le seuil mais paraît faible se corrige).
2. **Thème clair forcé** au niveau application (pas d'adaptation au mode sombre système).
3. **Les validations aident sans bloquer** (cohérent Patient/Médecin).
4. **Continuité** : toute décision de ce brief qui devrait changer en développement passe par un ADR de révision, jamais en silence.

---

# 9. Livrables attendus pour validation

Une PR par lot cohérent, CI verte. Validation en deux mains (comportement + règles côté encadrant ; rendu côté Product Owner).

- **[commit]** L'infrastructure email transactionnel (service partagé, modèles, Reply-To surveillé) + ADR dédié (brique transverse du socle).
- **[commit]** Le parcours d'inscription (formulaire, création de la demande `PENDING_VERIFICATION`, email de confirmation) + tests.
- **[commit]** Les écrans de statut (déterminés par le statut réel) + anti-abus du renvoi + tests.
- **[commit]** La règle de connexion selon statut (complète l'étape 1) + tests.
- **[commit]** L'espace admin (liste, détail lecture seule, raccourcis, note interne, historique) + rôle admin + tests.
- **[commit]** Les trois actions admin, dont **la cascade de validation** (R4, fiche médecin via module Médecin) et **le découplage email** (R6) + **tests des deux points critiques** (découplage : validation acquise malgré échec email ; refus : motif interne jamais envoyé).
- **[validation]** Aperçu visuel de chaque écran (contraste AA + thème clair vérifiés sur app réelle).
- **[validation]** Sortie CI complète, aucune régression étape 1 / Patient / Médecin.

**Point d'attention le plus sensible :** la **cascade de validation** (crée compte + organisation + membership + fiche médecin) et son **découplage d'avec l'email**. C'est là que je regarderai le code en priorité — que la fiche médecin passe par les fonctions du module Médecin (pas un chemin parallèle), et que l'échec d'email ne compromette jamais la validation.
