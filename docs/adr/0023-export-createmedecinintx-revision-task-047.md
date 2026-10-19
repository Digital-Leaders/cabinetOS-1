# ADR-0023 — Export de `createMedecinInTx` : révision de l'invariant de TASK-047

**Statut** : Accepté (encadrant, BUILD-004 étape 2, décision rendue avant EA-018). Révise
l'invariant de la surface publique du module Médecin posé par TASK-047 (BUILD-003, EA-012) ; met
en œuvre ADR-0021 D5.

## Contexte

TASK-047 a posé une règle volontairement stricte pour `business/medecin/index.ts` :
**« Aucune fonction d'écriture (create/update) n'est exportée »** ; création et mise à jour restent
internes, accessibles seulement par le contrôleur du module.

La cascade de validation d'une inscription (ADR-0021 D5, brief R4) doit, **d'un bloc**, créer
l'organisation, l'adhésion du fondateur **et sa fiche médecin**, puis passer la demande à `ACTIVE`.
Ce travail se fait hors du module Médecin (dans `business/registration`). Trois options existent :

| Option | Verdict |
|---|---|
| Écrire la fiche médecin par du SQL propre au module d'inscription | **Écartée** : c'est un *chemin parallèle* (R4 l'interdit). La normalisation de l'INPE, la RLS et les contraintes du module Médecin ne s'y appliqueraient pas. |
| Appeler `createMedecin` (qui ouvre sa propre transaction) | **Écartée** : la fiche s'écrit alors *hors* de la transaction de la cascade. Si une étape suivante échoue, la fiche subsiste sans organisation ni adhésion (état incohérent), et la clé étrangère composée vers `memberships` ne voit pas une adhésion non encore validée. |
| Exporter une variante qui **reçoit la transaction de l'appelant** | **Retenue.** |

## Décision

1. `createMedecin` est refactoré en **enveloppe fine** autour de `createMedecinInTx(tx, organizationId, data)`
   (corps inchangé : même normalisation, même insertion). Même opération pour `createOrganization` et
   `createMembership` (ADR-0021 D5). Aucun comportement des fonctions publiques existantes ne change.
2. **`createMedecinInTx` est la seule écriture exportée** par `business/medecin/index.ts`. L'invariant de
   TASK-047 est **rétréci, pas supprimé** :
   - **aucune mise à jour** (`updateMedecin`), **aucune création hors transaction** (`createMedecin`),
     **aucune suppression** n'est exportée ;
   - `createMedecinInTx` **exige une transaction ouverte par `withOrganizationScope` pour l'organisation visée**.
3. Cette exigence n'est pas qu'un type TypeScript (qui accepterait aussi une connexion simple) : elle est
   **garantie par la base**. La politique RLS **forcée** de `medecins` (migration 0013) refuse l'insertion avec
   une connexion simple (aucune organisation positionnée) comme avec une transaction scopée sur **une autre**
   organisation. Un test le prouve (`create-medecin-in-tx.spec.ts`).
4. Un test (`medecin-public-surface.spec.ts`) fige la surface publique **par liste exacte** : si une autre
   fonction d'écriture apparaît dans `index.ts`, il échoue.
5. **Aucun test existant du module Médecin n'est modifié** (brief §10.1).

## Justification

- R4 : un seul chemin de code. La fiche créée par la cascade est identique, champ pour champ, à celle créée
  par le contrôleur du module.
- L'atomicité (tout réussit ou tout échoue) n'est possible que si la fiche s'écrit **dans la transaction de la
  cascade**.
- Exporter *une* fonction, contrainte par la base, est la plus petite brèche possible dans l'invariant :
  l'écriture hors transaction et la modification restent impossibles pour les autres modules.

## Conséquences

- `business/registration` importe `createMedecinInTx` depuis le point d'entrée public du module Médecin,
  jamais depuis ses dossiers internes (frontière contrôlée par dependency-cruiser).
- Toute nouvelle écriture à exposer un jour passe par un **nouvel ADR de révision**, jamais par un ajout
  silencieux dans `index.ts`.
- Renvois : `business/medecin/index.ts` (commentaire de la surface publique) et ADR-0021 D5.
