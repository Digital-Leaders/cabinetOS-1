// TASK-052 (ADR-0021, D2 + P1) : compensation fiabilisee. Si l'insertion de la
// demande echoue apres la creation du compte, le compte est supprime ; la
// suppression est reessayee, et un echec persistant est journalise (sans donnee
// personnelle). Le compte restant serait alors un orphelin, recuperable par le
// chemin « email deja utilise » une fois le delai de P1 ecoule.

export interface CompensationLogger {
  error(message: string): void;
}

export const COMPENSATION_DELAYS_MS = [0, 100, 400] as const;

/**
 * Execute `deleteAccount` jusqu'a ce qu'il reussisse, au plus une fois par delai.
 * Retourne true si le compte est supprime (ou deja absent), false sinon.
 */
export async function compensateAccountCreation(
  userId: string,
  deleteAccount: (userId: string) => Promise<void>,
  logger: CompensationLogger,
  delaysMs: readonly number[] = COMPENSATION_DELAYS_MS,
): Promise<boolean> {
  for (const delay of delaysMs) {
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      await deleteAccount(userId);
      return true;
    } catch {
      // On reessaie ; le detail technique n'est pas journalise (il peut contenir
      // des valeurs de la requete).
    }
  }
  logger.error(
    `Compensation echouee apres ${delaysMs.length} tentatives : le compte ${userId} reste sans demande (orphelin, ADR-0021 P1).`,
  );
  return false;
}
