# CabinetOS — Spécification de design

## Parcours d'accès · Étape 1 — Se connecter

Cette spec décrit les **interfaces et le comportement** de l'étape 1 du parcours d'accès : se connecter, choisir son organisation, en changer en cours de session, se déconnecter. Elle est pilotée par le Product Owner et accompagne trois maquettes HTML interactives, qui font foi pour l'apparence et le comportement.

Comme pour Patient et Médecin, les maquettes montrent le comportement voulu, **pas du code à réutiliser** : le développeur implémente avec ses composants et **re-valide toute règle côté serveur**.

**Emplacement :** `docs/design/`. **Pièces jointes :** `connexion.html`, `choix-organisation.html`, `changement-organisation.html`.

**Ce chantier n'est pas un module métier** : il n'y a presque rien à créer côté modèle de données. L'authentification, les organisations, les memberships et les rôles existent déjà (socle BUILD-001, Better-Auth). Ce chantier construit le **parcours utilisateur** par-dessus l'existant.

---

## Le découpage en trois étapes (rappel)

Le parcours d'accès complet est découpé en trois étapes livrées séparément. **Cette spec ne couvre que l'étape 1.**

1. **Étape 1 — Se connecter** *(cette spec)* : connexion, choix d'organisation, changement d'organisation, déconnexion. Les comptes sont créés par l'équipe (démos, cabinets pilotes).
2. **Étape 2 — S'inscrire** *(reportée)* : un médecin crée son compte **et** son organisation, avec validation par l'équipe (le contrôle anti-usurpation).
3. **Étape 3 — Inviter** *(reportée)* : un administrateur d'organisation ajoute ses membres (médecins, secrétaires).

---

## Trois règles non-négociables (valables ici et sur tous les écrans)

Ces trois règles s'appliquent à cette étape et deviennent le standard de toutes les interfaces CabinetOS.

1. **Contraste AA.** Tout texte respecte un ratio de contraste d'au moins 4.5 sur son fond. Un texte qui passe techniquement le seuil mais paraît faible se corrige quand même — le seuil est un plancher, pas un objectif.
2. **Thème clair forcé.** Le produit s'affiche en fond clair **quel que soit** le réglage clair/sombre de l'appareil. Pas d'adaptation automatique au mode sombre du système. Le dev doit le garantir **au niveau de l'application** (une page seule ne peut pas toujours l'imposer, testé). Le vrai mode sombre — avec sa propre palette — est une amélioration future, non construite ici.
3. **Les validations aident, elles ne bloquent jamais** au-delà du strict nécessaire — cohérent avec Patient et Médecin.

---

## Écran 1 — Connexion

**Objectif : entrer dans CabinetOS. Premier contact visuel avec le produit.**

- Identifiant = **e-mail** + mot de passe. Better-Auth gère nativement.
- Bouton **« Se connecter »**.
- **Message d'erreur** en cas d'échec (e-mail ou mot de passe incorrect) — clair, dans l'interface, sans dramatiser ni s'excuser. Champs vides surlignés.
- Le curseur est placé d'emblée dans le champ e-mail.
- Deux repères **gardés visibles** (décision Product Owner), menant à des étapes reportées : « Mot de passe oublié ? » (réinitialisation, reportée) et « Créer mon cabinet » (auto-inscription, étape 2). Ils montrent l'écran complet tel qu'il sera à terme ; ils s'activeront quand les étapes 2/3 existeront, sans changer l'écran. Pour l'étape 1, un clic peut mener à un message « bientôt disponible » plutôt qu'à une page morte.

**Reporté (hors étape 1) :** la **réinitialisation de mot de passe en libre-service** — elle suppose l'envoi d'e-mail (infrastructure à monter, qui resservira aux invitations de l'étape 3). Pour les premiers tests, l'équipe réinitialise manuellement. On monte l'e-mail une seule fois, quand plusieurs fonctions en ont besoin.

---

## Écran 2 — Choix d'organisation

**Objectif : choisir quelle organisation ouvrir, pour un utilisateur qui en a plusieurs.**

**Quand cet écran apparaît (logique importante) :**
- **Une seule** organisation → ne s'affiche pas, on ouvre directement l'espace.
- **Plusieurs** organisations **avec** une organisation par défaut définie → ne s'affiche pas, on ouvre le défaut.
- **Plusieurs** organisations **sans** défaut → **cet écran s'affiche**.

Ne jamais demander de choisir quand il n'y a rien à choisir.

- Liste des organisations, **nom de la structure seul** (décision Product Owner — pas de rôle affiché).
- Un clic ouvre l'organisation.
- L'organisation par défaut actuelle (s'il y en a une) est **signalée**.
- Une option **« Ouvrir directement l'organisation choisie à l'avenir »** — c'est le réglage de l'organisation par défaut, posé au moment naturel du choix. **Modifiable ensuite** dans les réglages.

---

## Écran 3 — Changement d'organisation & déconnexion (en cours de session)

**Objectif : basculer d'une organisation à l'autre sans se déconnecter, et se déconnecter.**

Ce n'est pas un écran à part : ce sont **deux éléments de l'en-tête** de l'application.

**Sélecteur d'organisation — en haut à gauche, près de la marque** (il définit le *contexte de travail*) :
- affiche l'organisation courante (monogramme + nom) ;
- au clic, un menu liste les organisations, l'actuelle cochée ;
- choisir une autre **bascule le contexte** sans déconnexion ni retour au login.

**Menu utilisateur — en haut à droite, sur l'avatar** (il concerne *la personne*) :
- nom + e-mail de l'utilisateur ;
- accès **Profil** et **Réglages** (où vit le réglage « organisation par défaut ») ;
- **Se déconnecter** (action distincte, traitée visuellement à part).

---

## Comportements transversaux (à implémenter par le dev)

- **Session persistante avec expiration** : l'utilisateur reste connecté un certain temps, puis doit se reconnecter après expiration. Réglage Better-Auth — durée à fixer (proposition : quelques jours, à ajuster).
- **Organisation par défaut réglable** : un utilisateur multi-organisations peut définir/changer son organisation principale (celle qui s'ouvre à la connexion). Posée au choix d'organisation, modifiable dans les réglages.
- **Changement d'organisation en cours de session** : sans déconnexion, via le sélecteur d'en-tête.
- **Déconnexion** : depuis le menu utilisateur, ramène à l'écran de connexion.

---

## Ce que le dev doit construire (côté technique)

- Le **parcours d'authentification** front, branché sur Better-Auth du socle (connexion, session, déconnexion). L'auth serveur existe déjà — il s'agit du parcours par-dessus.
- La logique de **résolution d'organisation à la connexion** (une seule → directe ; plusieurs + défaut → défaut ; plusieurs sans défaut → écran de choix).
- Le **changement d'organisation en cours de session** (rebascule du contexte scopé — l'`organization_id` actif change, avec tout ce que ça implique pour les requêtes RLS déjà en place).
- Le **réglage « organisation par défaut »** (stocké côté utilisateur — réutiliser le module Settings du socle plutôt que créer une table).
- L'application des **trois règles non-négociables** (contraste AA, thème clair forcé, validations non bloquantes).

**Point de vigilance sécurité :** le changement d'organisation en cours de session touche au cœur de l'isolation multi-tenant. Basculer d'organisation doit re-scoper proprement **tout** le contexte (le nouvel `organization_id` doit gouverner toutes les requêtes suivantes). À traiter et tester avec le même soin que les trois gestes d'isolation des modules métier — un test doit prouver qu'après bascule, l'utilisateur ne voit **que** les données de la nouvelle organisation, jamais un reliquat de l'ancienne.

---

## Hors périmètre de l'étape 1

- Auto-inscription et création d'organisation par l'utilisateur (étape 2).
- Invitation de membres (étape 3).
- Réinitialisation de mot de passe en libre-service (avec l'infrastructure e-mail).
- Vérification d'identité professionnelle (rattachée à l'étape 2 / au parcours d'inscription).
- Vrai mode sombre (amélioration future).

---

## Livrables attendus pour validation

Format : une PR par écran ou par lot cohérent, mergée sur `main`, CI verte. On valide au fil de l'eau, pas tout d'un bloc.

**Validation en deux mains, comme pour les interfaces Patient :**
- le **comportement** et la **conformité aux règles** sont vérifiés côté encadrant (tests, conformité au Gate et aux trois règles non-négociables) ;
- le **rendu visuel** (fidélité aux maquettes, lisibilité réelle) est validé par le Product Owner sur aperçu.

**[commit] — Le parcours d'authentification** (connexion, session, déconnexion) branché sur Better-Auth réel, pas de données en dur. Avec les tests de comportement : connexion réussie, échec sur mauvais identifiants (message clair, pas de 500 brut), déconnexion qui ramène au login.

**[commit] — La résolution d'organisation à la connexion**, avec les tests des trois cas : une seule organisation → ouverture directe ; plusieurs + défaut défini → ouverture du défaut ; plusieurs sans défaut → écran de choix. Le test doit prouver qu'on ne demande jamais de choisir quand il n'y a rien à choisir.

**[commit] — Le changement d'organisation en cours de session**, et surtout **son test d'isolation** — le livrable le plus important de ce chantier : un test qui prouve qu'après bascule de l'organisation A vers B, l'utilisateur ne voit **que** les données de B, jamais un reliquat de A. Même exigence que les trois gestes d'isolation des modules : prouver le refus/l'étanchéité, pas seulement que la bascule fonctionne.

**[commit] — Le réglage « organisation par défaut »** (via le module Settings du socle, pas une nouvelle table), avec le test : définir un défaut, vérifier qu'il s'ouvre à la connexion suivante, le changer, vérifier la prise en compte.

**[validation] — Un aperçu visuel de chaque écran** (capture ou preview) — pour la validation du rendu par le Product Owner : fidélité aux maquettes, **contraste AA respecté**, et **affichage en thème clair même sur un appareil réglé en mode sombre** (le point vérifié en maquette — à confirmer sur l'app réelle).

**[validation] — La sortie CI complète** confirmant que les tests ci-dessus passent et qu'aucune régression n'est introduite sur les modules Patient et Médecin (l'auth et le scoping sont transverses — une régression ici toucherait tout).

**Ce que je ne demande pas :** rien de nouveau côté modèle métier — ce chantier construit le parcours, pas des entités. Si le dev découvre qu'un écran a besoin d'une donnée ou d'un endpoint absent, il ne l'improvise pas : il le signale, on tranche.
