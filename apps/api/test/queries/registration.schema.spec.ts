import {
  registrationRequests,
  registrationEvents,
  REGISTRATION_STATUSES,
} from '../../src/business/registration';

// TASK-051 (BUILD-004 etape 2, EA-014) : nullabilite exacte du modele d'inscription
// (ADR-0021, D1). Les garanties base (privileges, CHECK, unicite) sont prouvees avec le
// role applicatif reel dans tests/isolation/registration-append-only.spec.ts.

describe('registration_requests schema (TASK-051)', () => {
  it('impose le compte, le statut et les donnees declarees obligatoires', () => {
    expect(registrationRequests.userId.notNull).toBe(true);
    expect(registrationRequests.status.notNull).toBe(true);
    expect(registrationRequests.firstName.notNull).toBe(true);
    expect(registrationRequests.lastName.notNull).toBe(true);
    expect(registrationRequests.specialty.notNull).toBe(true);
    expect(registrationRequests.structureName.notNull).toBe(true);
    expect(registrationRequests.city.notNull).toBe(true);
  });

  it('laisse facultatifs INPE, numero d Ordre et adresse (R2)', () => {
    expect(registrationRequests.inpe.notNull).toBe(false);
    expect(registrationRequests.numeroOrdre.notNull).toBe(false);
    expect(registrationRequests.address.notNull).toBe(false);
  });

  it('laisse vides les champs remplis plus tard (equipe, refus, renvoi, cascade)', () => {
    expect(registrationRequests.internalNote.notNull).toBe(false);
    expect(registrationRequests.refusalInternalReason.notNull).toBe(false);
    expect(registrationRequests.refusalMessageToApplicant.notNull).toBe(false);
    expect(registrationRequests.lastEmailResentAt.notNull).toBe(false);
    expect(registrationRequests.organizationId.notNull).toBe(false);
  });

  it('separe le motif interne et le message au demandeur en deux colonnes (R8)', () => {
    expect(registrationRequests.refusalInternalReason.name).toBe('refusal_internal_reason');
    expect(registrationRequests.refusalMessageToApplicant.name).toBe(
      'refusal_message_to_applicant',
    );
  });

  it('demarre en PENDING_VERIFICATION, parmi exactement quatre statuts', () => {
    expect(registrationRequests.status.default).toBe('PENDING_VERIFICATION');
    expect(REGISTRATION_STATUSES).toEqual([
      'PENDING_VERIFICATION',
      'COMPLEMENT_REQUESTED',
      'ACTIVE',
      'REFUSED',
    ]);
  });

  it('reprend le nom de colonne du numero d Ordre du module Medecin', () => {
    expect(registrationRequests.numeroOrdre.name).toBe('numero_ordre');
  });

  it('ne duplique pas l email du compte (il reste dans users)', () => {
    expect(Object.keys(registrationRequests)).not.toContain('email');
  });
});

describe('registration_events schema (TASK-051)', () => {
  it('impose la demande et l action ; acteur et details d email facultatifs', () => {
    expect(registrationEvents.registrationRequestId.notNull).toBe(true);
    expect(registrationEvents.action.notNull).toBe(true);
    expect(registrationEvents.actorUserId.notNull).toBe(false);
    expect(registrationEvents.emailTemplate.notNull).toBe(false);
    expect(registrationEvents.emailFailureRetryable.notNull).toBe(false);
  });

  it('ne porte aucune colonne de contenu (R7, R8)', () => {
    const columns = Object.keys(registrationEvents);
    for (const forbidden of ['content', 'body', 'message', 'html', 'text', 'reason']) {
      expect(columns.some((c) => c.toLowerCase().includes(forbidden))).toBe(false);
    }
  });
});
