import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { DatabaseService } from '../../../modules/shared/database/database.service';
import { medecins, medecinSpecialtyEnum } from './schema';
import { validateInpe } from '../presentation/inpe-validation';

// TASK-041 (BUILD-003, EA-010) : fonctions d acces, toutes via withOrganizationScope
// (ADR-0005) -- aucun acces direct a tx/db hors de ce garde-fou, meme discipline que
// pour Patient (TASK-020).
//
// Contrairement a Patient, une seule table -- pas de "record" separe, pas de
// compteur de numero de dossier (le rattachement organisationnel vit dans
// memberships, ADR-0016 ; aucun geste de numerotation propre a medecins).
//
// TASK-043 : l INPE est normalise ICI, au moment de l ecriture -- jamais la valeur
// brute saisie. Meme discipline que le CIN/telephone pour Patient (TASK-026) :
// c est cette valeur normalisee qui garantit que l unicite scopee (TASK-039)
// retrouve la meme fiche quelle que soit la faaon dont l INPE a ete saisi.
// Jamais bloquant -- un format invalide est stocke quand meme (F.1, F.2).

function normalizeMedecinInput<T extends { inpe?: string }>(data: T): T {
  const normalized = { ...data };
  if (normalized.inpe) {
    normalized.inpe = validateInpe(normalized.inpe).normalized;
  }
  return normalized;
}

export type MedecinSpecialty = (typeof medecinSpecialtyEnum.enumValues)[number];

export interface CreateMedecinInput {
  firstName: string;
  lastName: string;
  userId?: string;
  specialty?: MedecinSpecialty;
  inpe?: string;
  numeroOrdre?: string;
  description?: string;
  phoneCountryCode?: string;
  phoneNationalNumber?: string;
  email?: string;
  city?: string;
  locationReference?: string;
}

export type UpdateMedecinInput = Partial<CreateMedecinInput>;

/**
 * BUILD-004 etape 2, EA-018 / TASK-061 (ADR-0021 D5, ADR-0023) : corps de createMedecin, extrait pour
 * s'executer DANS UNE TRANSACTION fournie par l'appelant -- la cascade de validation d'une
 * inscription, qui cree la fiche medecin du fondateur avec l'organisation et l'adhesion, d'un bloc.
 * Un seul chemin de code (R4 : « pas de chemin parallele ») : normalisation de l'INPE, RLS et
 * contraintes du module Medecin s'appliquent a l'identique ; createMedecin n'en est que l'enveloppe.
 *
 * `tx` DOIT etre une transaction ouverte par withOrganizationScope pour `organizationId`. Ce n'est
 * pas qu'une convention de type : la RLS FORCEE de medecins (migration 0013) refuse l'insertion avec
 * une connexion simple (aucune organisation positionnee) comme avec une transaction scopee sur une
 * AUTRE organisation -- prouve par tests/medecin/create-medecin-in-tx.spec.ts. C'est la SEULE fonction
 * d'ecriture exportee par la surface publique du module (ADR-0023).
 */
export async function createMedecinInTx(
  tx: NodePgDatabase,
  organizationId: string,
  data: CreateMedecinInput,
) {
  const normalized = normalizeMedecinInput(data);
  const [medecin] = await tx
    .insert(medecins)
    .values({ ...normalized, organizationId })
    .returning();
  return medecin;
}

export async function createMedecin(
  databaseService: DatabaseService,
  organizationId: string,
  data: CreateMedecinInput,
) {
  // Comportement INCHANGE : sa propre transaction, scopee a l'organisation.
  return databaseService.withOrganizationScope(organizationId, (tx) =>
    createMedecinInTx(tx, organizationId, data),
  );
}

export async function findMedecinById(
  databaseService: DatabaseService,
  organizationId: string,
  id: string,
) {
  return databaseService.withOrganizationScope(organizationId, async (tx) => {
    const [medecin] = await tx.select().from(medecins).where(eq(medecins.id, id));
    return medecin;
  });
}

export async function updateMedecin(
  databaseService: DatabaseService,
  organizationId: string,
  id: string,
  data: UpdateMedecinInput,
) {
  return databaseService.withOrganizationScope(organizationId, async (tx) => {
    const normalized = normalizeMedecinInput(data);
    const [updated] = await tx
      .update(medecins)
      .set({ ...normalized, updatedAt: new Date() })
      .where(eq(medecins.id, id))
      .returning();
    return updated;
  });
}

// TASK-047 (BUILD-003, EA-012) : surface minimale destinee aux futurs modules
// Business (Consultation, Agenda, Prescription) -- juste de quoi afficher/
// referencer un medecin, jamais de quoi le modifier. Aucune fonction d ecriture
// n est exportee par index.ts.
//
// Contrairement a Patient (patients + patientRecords, TASK-027), une seule
// table medecins ici (ADR-0016) -- aucune jointure necessaire, l id recherche
// est directement celui de la fiche medecin.

export interface MedecinSummary {
  id: string;
  displayName: string;
  specialty: MedecinSpecialty | null;
}

export async function findMedecinSummaryById(
  databaseService: DatabaseService,
  organizationId: string,
  medecinId: string,
): Promise<MedecinSummary | undefined> {
  return databaseService.withOrganizationScope(organizationId, async (tx) => {
    const [row] = await tx
      .select({
        id: medecins.id,
        firstName: medecins.firstName,
        lastName: medecins.lastName,
        specialty: medecins.specialty,
      })
      .from(medecins)
      .where(eq(medecins.id, medecinId));

    if (!row) {
      return undefined;
    }
    return {
      id: row.id,
      displayName: `${row.firstName} ${row.lastName}`,
      specialty: row.specialty,
    };
  });
}
