# ADR-0022 — Révision d'ADR-0021 D1 : conservation du dernier message de complément sortant

**Statut** : Accepté (encadrant, BUILD-004 étape 2, EA-015). Révise ADR-0021 D1 et précise R7.

## Contexte

L'écran « Complément demandé » (brief §5.2) offre au fondateur un bouton « Renvoyer
l'email », et le brief (§6) prévoit que l'admin puisse « renvoyer la demande sans recréer la
demande ». Ces deux renvois n'ont de sens que si l'email est ré-émis **à l'identique** : il
contient la demande de l'équipe (l'information attendue et un message modifiable).

ADR-0021 D1 ne conservait pas ce message : `registration_requests` n'avait aucune colonne pour
lui, et R7 disait « CabinetOS conserve la trace de l'action, pas le contenu de l'échange ».
Sans le message, le renvoi ne pourrait être qu'un rappel générique, inutile si l'email
d'origine n'est jamais arrivé, et l'admin devrait réécrire sa demande pour la relancer.

## Décision

1. Deux colonnes **nullables** sur `registration_requests` :
   - `complement_requested_info` : le libellé de l'information demandée, **tel qu'envoyé** ;
   - `complement_message` : le message de l'équipe, **tel qu'envoyé**.

   Ce sont exactement les paramètres du modèle d'email `verification-complement` (EA-013).
   Elles sont écrites par l'action admin « Demander un complément » (EA-018) et **écrasées** à
   chaque nouvelle demande. Le renvoi les relit et ré-émet l'email sans rien reconstruire.
2. **R7, reformulée** : CabinetOS conserve **notre dernier message de complément sortant, à
   seule fin de le renvoyer à l'identique**. Il ne conserve **jamais** la réponse entrante du
   médecin, ni l'historique des messages échangés.
3. `registration_events` reste **sans contenu** : il trace l'action (renvoi demandé, envoi
   réussi ou échoué), jamais le texte.
4. Hygiène des données, imposée par la base (contraintes CHECK) :
   - `COMPLEMENT_REQUESTED` ⇒ les deux colonnes sont renseignées (un renvoi est toujours possible) ;
   - `ACTIVE` ou `REFUSED` ⇒ les deux colonnes sont vides (le message n'a plus d'usage et
     disparaît avec la clôture de la demande). Les transitions d'EA-018 doivent donc les vider.

## Justification

- R7 visait le contenu **entrant** (la réponse du médecin) et l'historique des échanges. Notre
  propre message sortant, conservé en un seul exemplaire et uniquement pour le renvoyer, ne
  réintroduit ni l'un ni l'autre.
- Le renvoi « à l'identique » exigé par l'écran et par le brief (§6) est impossible sans lui.
- Les contraintes rendent la règle vérifiable par construction plutôt que par discipline.

**Alternative écartée** : un rappel générique sans contenu. Il respecte la lettre de l'ancienne
R7, mais laisse le médecin sans savoir ce qu'on attend de lui si l'email d'origine est perdu,
et oblige l'admin à réécrire sa demande pour la relancer.

## Conséquences

- Migration additive `0021_registration-complement-message.sql` (deux colonnes, deux CHECK).
- Renvoi côté fondateur (TASK-054) : ré-émission du message stocké, sous la garde anti-abus de
  60 s (ADR-0021 D7), via le service d'EA-013.
- En EA-015, le renvoi est testé contre un message semé : le flux bout en bout « l'admin demande
  → le fondateur renvoie » sera prouvé en EA-018, qui écrit ces colonnes.
