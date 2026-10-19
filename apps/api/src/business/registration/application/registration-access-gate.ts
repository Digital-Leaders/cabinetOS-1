import { Injectable, OnModuleInit } from '@nestjs/common';
import { AccountAccessGateRegistry, type AccountAccessGate } from '../../../modules/access-control';
import type { AccessDenial } from '../../../modules/access-control';
import { DatabaseService } from '../../../modules/shared';
import { findRegistrationStatus } from '../infrastructure/registration.queries';

// TASK-056 (BUILD-004 etape 2, EA-016, ADR-0021 D4) : implementation, cote inscription, de
// la porte d'acces aux donnees metier (port defini dans le Core, access-control).
//
// Regle : un compte qui possede une demande d'inscription dont le statut n'est PAS ACTIVE
// (en verification, complement demande, refusee) n'accede a aucune donnee. Un compte SANS
// demande (compte d'equipe, demos de l'etape 1) n'est jamais concerne : aucun changement.

export const REGISTRATION_NOT_ACTIVE_CODE = 'REGISTRATION_NOT_ACTIVE';

@Injectable()
export class RegistrationAccessGate implements AccountAccessGate, OnModuleInit {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly registry: AccountAccessGateRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async check(userId: string): Promise<AccessDenial | null> {
    const status = await findRegistrationStatus(this.databaseService.db, userId);
    if (status === null || status === 'ACTIVE') return null;
    return {
      code: REGISTRATION_NOT_ACTIVE_CODE,
      message:
        "Acces refuse : votre demande d'inscription n'a pas encore ete validee. Consultez l'etat de votre demande.",
    };
  }
}
