import { Injectable } from '@nestjs/common';

// BUILD-004 etape 2, EA-016 / TASK-056 (ADR-0021 D4) : « porte d'acces » d'un compte aux
// donnees metier.
//
// POURQUOI UN PORT. La regle « seul un compte dont la demande est ACTIVE accede aux
// donnees » depend de la table registration_requests, qui vit dans un module BUSINESS
// (business/registration). Or dependency-cruiser interdit au Core d'importer Business
// (ADR-0004/0010), et PermissionsGuard est dans le Core. Le Core definit donc le
// CONCEPT (ce port, plus le registre ci-dessous) ; le module Business l'IMPLEMENTE et
// s'enregistre au demarrage. La dependance va bien de Business vers Core, jamais l'inverse
// -- meme patron que AuthProvider (TASK-014).
//
// Defense en profondeur : sans cette garde, un non-ACTIVE est deja refuse « par
// construction » (aucune adhesion, donc aucune permission). La garde garde la regle vraie
// meme si un non-ACTIVE obtenait une adhesion un jour (invitation en etape 3, bug de
// cascade) : les deux protections sont independantes.

export interface AccessDenial {
  /** Code stable, pour les tests et le diagnostic. */
  code: string;
  /** Message affichable au proprietaire du compte. */
  message: string;
}

export interface AccountAccessGate {
  /**
   * Retourne un refus si ce compte ne doit PAS acceder aux donnees metier, sinon null.
   * `userId` provient toujours de la session verifiee cote serveur, jamais du client.
   * Une exception levee ici est traitee comme un refus (la garde echoue FERMEE).
   */
  check(userId: string): Promise<AccessDenial | null>;
}

/**
 * Registre des portes d'acces. Les modules Business y enregistrent leur porte au demarrage ;
 * PermissionsGuard les consulte a chaque requete protegee par permission. Sans porte
 * enregistree, rien ne change (comportement de l'etape 1).
 */
@Injectable()
export class AccountAccessGateRegistry {
  private readonly gates: AccountAccessGate[] = [];

  register(gate: AccountAccessGate): void {
    this.gates.push(gate);
  }

  /** Premier refus rencontre, ou null. Toute exception d'une porte se propage (fail-closed). */
  async findDenial(userId: string): Promise<AccessDenial | null> {
    for (const gate of this.gates) {
      const denial = await gate.check(userId);
      if (denial) return denial;
    }
    return null;
  }
}
