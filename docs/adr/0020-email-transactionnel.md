# ADR-0020 — Infrastructure d'email transactionnel : port, adaptateurs, envoi découplé

**Statut** : Proposé (EA-013, BUILD-004 étape 2 — à valider par l'encadrant)

## Contexte

L'étape 2 du parcours d'accès (inscription du fondateur) introduit quatre emails
transactionnels : confirmation d'inscription, demande de complément, activation
du compte, refus. Le brief (§5) demande une brique **minimale et transverse** :
CabinetOS → service d'envoi → destinataire, quelques modèles, un point d'envoi
centralisé. Elle resservira à la réinitialisation de mot de passe et aux
invitations de l'étape 3. Hors périmètre : préférences utilisateur, campagnes,
moteur de notifications, historique de communication.

Deux règles du brief contraignent la conception :

- **R6** : la validation métier ne doit jamais échouer parce qu'un email n'a pas
  pu partir. L'envoi est postérieur et distinct de l'acte métier ; un échec laisse
  une trace et un renvoi reste possible.
- **R8 / T3** : le motif interne d'un refus ne doit jamais pouvoir atteindre le
  demandeur. Cela doit être vérifiable sur le contenu réel de l'email.

## Décision

**Un port, deux adaptateurs, un point d'envoi central** — dans un nouveau module
Core `email` (même schéma que `AuthProvider`, ADR-007).

- **Port `EmailSender`** (`application/email-sender.port.ts`) : `send(message)`,
  indépendant du fournisseur. Un échec lève `EmailDeliveryError`, qui porte un
  indicateur `retryable` (réseau, 429, 5xx : oui ; refus du fournisseur : non).
- **Adaptateur Brevo** : API transactionnelle HTTP (`POST /v3/smtp/email`), via
  `fetch`, **sans SDK** (aucune dépendance ajoutée). La clé API est passée au
  constructeur, lue par le module dans `BREVO_API_KEY`, jamais en dur, jamais dans
  un message d'erreur.
- **Adaptateur en mémoire** : capture destinataire, objet et contenu complets, et
  sait simuler un échec (`failNext`, `failAll`). C'est ce qui rend T2 (échec
  d'envoi) et T3 (contenu du refus) testables sans réseau.
- **`TransactionalEmailService.sendTemplate(modèle, destinataire, paramètres)`** :
  point d'envoi central. **Il ne lève jamais pour un échec d'envoi** : il renvoie
  `{ ok: true, messageId }` ou `{ ok: false, retryable, reason }`. L'appelant (la
  cascade de validation, EA-018) inscrit le résultat dans l'historique de la
  demande ; l'acte métier déjà enregistré n'est jamais annulé (R6).
- **Quatre modèles** (`application/email-templates.ts`) : fonctions pures,
  paramètres typés. Le modèle de refus ne reçoit que `messageToApplicant` : le
  motif interne n'est pas un paramètre possible, il est **impossible par
  conception** de l'y glisser (R8).

**Configuration.** `EMAIL_PROVIDER` vaut `memory` (défaut hors production : rien
ne part réellement) ou `brevo`. **En production, `brevo` est obligatoire** : jamais
d'envoi silencieusement perdu. `BREVO_API_KEY` est requise si et seulement si le
fournisseur est `brevo`. Expéditeur et Reply-To (valeurs non secrètes, défauts
documentés) : `noreply@portesante.ma` (nom affiché *PorteSanté*) et
`verification@portesante.ma`. Le Reply-To n'est posé que sur la demande de
complément, seul email qui attend une réponse (R7).

**Nom de produit.** Le code et la documentation restent sous « CabinetOS » ; les
emails portent le nom commercial *PorteSanté*, comme le brief le prescrit. Aucune
règle de code ne dépend de ce nom (constante `BRAND_NAME`).

## Justification

- **Réversibilité.** Aucun module ne dépend de Brevo : changer de fournisseur
  (le SMTP transactionnel de Brevo est le repli prévu par le brief) revient à
  écrire un adaptateur.
- **Découplage garanti par la forme de l'API**, pas par la discipline : l'appelant
  reçoit un résultat, pas une exception à ne pas oublier d'attraper.
- **Testabilité.** Le contenu réel des emails est inspectable ; la séparation du
  refus se prouve sur le message capturé.
- **Pas de SDK** : une surface d'attaque et une dépendance de moins pour un seul
  appel HTTP.

## Conséquences

- **Secrets** : `BREVO_API_KEY` ne figure jamais dans le dépôt ; `.env.local.example`
  documente les clés attendues sans valeur ; un test vérifie l'absence de clé
  codée en dur dans le module.
- **Pas d'historique ni de file d'attente dans la brique** : la trace d'un échec
  et le renvoi relèvent de l'appelant (historique de la demande, EA-014/018). Une
  file de réessais serait un chantier distinct.
- **Français uniquement** pour les modèles en V1 (le brief ne prévoit pas
  d'email arabe).
- **Vigilance (brief §14)** : Brevo révoque une clé après 90 jours sans usage ;
  le blocage par IP est à activer avant la production ; le plan de production
  (volumes, limites) est à confirmer avant la mise en ligne.
- **Condition de production** : le démarrage en `NODE_ENV=production` exige
  désormais `EMAIL_PROVIDER=brevo` et `BREVO_API_KEY`.

## Statut

Proposé, dans le cadre d'EA-013 (TASK-048 à TASK-050).
