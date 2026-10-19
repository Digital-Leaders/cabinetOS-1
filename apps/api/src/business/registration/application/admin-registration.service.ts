import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../../modules/shared';
import {
  DEFAULT_ADMIN_FILTER,
  DEFAULT_PAGE_SIZE,
  encodeCursor,
  decodeCursor,
  type AdminFilter,
} from '../domain/admin-list';
import {
  countRegistrationRequests,
  findRegistrationHistory,
  findRegistrationRequestDetail,
  listRegistrationRequests,
  updateInternalNote,
} from '../infrastructure/admin-registration.queries';

// BUILD-004 etape 2, EA-017 / TASK-059 : ce que l'EQUIPE (administrateurs de plateforme) lit et
// annote sur les demandes d'inscription. Appele uniquement depuis un endpoint
// @RequirePlatformAdmin(). Les actions Valider / Demander un complement / Refuser relevent
// d'EA-018 et ne sont pas ici.

@Injectable()
export class AdminRegistrationService {
  constructor(private readonly databaseService: DatabaseService) {}

  async list(params: { filter?: AdminFilter; q?: string; cursor?: string; limit?: number }) {
    const page = await listRegistrationRequests(this.databaseService.db, {
      filter: params.filter ?? DEFAULT_ADMIN_FILTER,
      query: params.q,
      cursor: params.cursor ? decodeCursor(params.cursor) : undefined,
      limit: params.limit ?? DEFAULT_PAGE_SIZE,
    });
    const counts = await countRegistrationRequests(this.databaseService.db);
    return {
      data: page.items,
      meta: { nextCursor: page.nextCursor ? encodeCursor(page.nextCursor) : null, counts },
    };
  }

  async detail(id: string) {
    const row = await findRegistrationRequestDetail(this.databaseService.db, id);
    if (!row) throw new NotFoundException('Demande d inscription introuvable.');
    const history = await findRegistrationHistory(this.databaseService.db, id);

    return {
      id: row.id,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      // Deux blocs en lecture seule, comme la maquette : ce que le medecin a declare.
      doctor: {
        firstName: row.firstName,
        lastName: row.lastName,
        email: row.email,
        specialty: row.specialty,
        inpe: row.inpe,
        numeroOrdre: row.numeroOrdre,
      },
      structure: { name: row.structureName, city: row.city, address: row.address },
      internalNote: row.internalNote,
      // Present seulement quand il a un sens (ADR-0022 : message sortant conserve pour le renvoi).
      complement:
        row.status === 'COMPLEMENT_REQUESTED'
          ? { requestedInfo: row.complementRequestedInfo, message: row.complementMessage }
          : null,
      // L'equipe voit le motif interne qu'elle a ecrit ; le fondateur, jamais (R8).
      refusal:
        row.status === 'REFUSED'
          ? {
              internalReason: row.refusalInternalReason,
              messageToApplicant: row.refusalMessageToApplicant,
            }
          : null,
      organizationId: row.organizationId,
      history,
    };
  }

  async saveInternalNote(id: string, note: string | null | undefined) {
    // Une note vide efface la note : elle est facultative.
    const normalized = note?.trim() ? note.trim() : null;
    const saved = await updateInternalNote(this.databaseService.db, id, normalized);
    if (!saved) throw new NotFoundException('Demande d inscription introuvable.');
    return saved;
  }
}
