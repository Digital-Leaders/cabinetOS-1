// TASK-055 (BUILD-004 etape 2, EA-015) : client des deux routes de statut livrees en
// TASK-054 (ADR-0021 D4, ADR-0022). Session seule, sans organisation : un fondateur non
// ACTIVE n'en a aucune.

export type RegistrationStatus =
  'PENDING_VERIFICATION' | 'COMPLEMENT_REQUESTED' | 'ACTIVE' | 'REFUSED';

export interface RegistrationStatusView {
  /** null : compte sans demande (compte d'equipe) -- il entre normalement. */
  status: RegistrationStatus | null;
  maskedEmail?: string;
  refusalMessage?: string;
  nextResendAllowedAt?: string | null;
}

export class RegistrationStatusError extends Error {
  status: number;
  constructor(status: number) {
    super(`HTTP ${status}`);
    this.name = 'RegistrationStatusError';
    this.status = status;
  }
}

export async function fetchRegistrationStatus(): Promise<RegistrationStatusView> {
  const response = await fetch('/api/v1/identity/registration-status', {
    credentials: 'include',
  });
  if (!response.ok) throw new RegistrationStatusError(response.status);
  const body = await response.json();
  return body.data as RegistrationStatusView;
}

export type ResendResult =
  | { kind: 'SENT'; nextResendAllowedAt: string }
  /** L'envoi a echoue cote fournisseur : trace et renvoyable apres le delai (R6). */
  | { kind: 'SEND_FAILED'; nextResendAllowedAt: string }
  /** Delai anti-abus en cours (429). */
  | { kind: 'TOO_SOON' }
  /** La demande n'attend plus de complement (409/404) : le statut a change. */
  | { kind: 'STATUS_CHANGED' }
  | { kind: 'UNEXPECTED' };

export async function resendComplementEmail(): Promise<ResendResult> {
  let response: Response;
  try {
    response = await fetch('/api/v1/identity/registration-status/resend-email', {
      method: 'POST',
      credentials: 'include',
    });
  } catch {
    return { kind: 'UNEXPECTED' };
  }
  if (response.status === 429) return { kind: 'TOO_SOON' };
  if (response.status === 409 || response.status === 404) return { kind: 'STATUS_CHANGED' };
  if (!response.ok) return { kind: 'UNEXPECTED' };

  const body = await response.json().catch(() => null);
  const data = body?.data as { sent: boolean; nextResendAllowedAt: string } | undefined;
  if (!data) return { kind: 'UNEXPECTED' };
  return data.sent
    ? { kind: 'SENT', nextResendAllowedAt: data.nextResendAllowedAt }
    : { kind: 'SEND_FAILED', nextResendAllowedAt: data.nextResendAllowedAt };
}
