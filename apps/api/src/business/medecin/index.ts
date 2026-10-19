export { MedecinModule } from './medecin.module';
export { medecins, medecinSpecialtyEnum } from './infrastructure/schema';
export { findMedecinSummaryById, type MedecinSummary } from './infrastructure/medecin.queries';
export { createMedecinInTx } from './infrastructure/medecin.queries';

// TASK-047 (BUILD-003, EA-012) : surface volontairement minimale -- destinee aux futurs modules
// Business (Consultation, Agenda, Prescription) pour referencer une fiche medecin sans dependre du
// modele interne complet.
//
// REGLE (revisee par ADR-0023, EA-018 de BUILD-004). L'invariant d'origine -- « aucune fonction
// d'ecriture n'est exportee » -- est RETRECI, pas supprime :
//   - la SEULE ecriture exportee est `createMedecinInTx`, et elle EXIGE une transaction ouverte par
//     withOrganizationScope pour l'organisation visee : la RLS forcee de medecins refuse toute autre
//     utilisation (connexion simple, ou transaction d'une autre organisation) ;
//   - AUCUNE mise a jour (updateMedecin), AUCUNE creation hors transaction (createMedecin), AUCUNE
//     suppression n'est exportee : create/update restent internes au module, accessibles via son
//     controleur.
// Pourquoi cette exception : la cascade de validation d'une inscription cree l'organisation,
// l'adhesion du fondateur ET sa fiche medecin d'un bloc, par le MEME code que le module Medecin
// (R4 : pas de chemin parallele). Un test (medecin-public-surface.spec.ts) echoue si une autre
// fonction d'ecriture apparait ici.
