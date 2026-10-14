// TASK-053 (BUILD-004 etape 2) : client de l'inscription du fondateur.
// POST /api/v1/registration-requests (TASK-052) passe par la meme passerelle Next.js que
// api-client.ts : le cookie de session pose par la reponse arrive donc directement au
// navigateur, sans configuration supplementaire.
//
// Les erreurs sont classees par statut HTTP, jamais par le texte du serveur : l'ecran
// affiche ses propres messages, traduits (le serveur repond en francais seulement).

export interface RegistrationPayload {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  specialty: string;
  inpe?: string;
  numeroOrdre?: string;
  structureName: string;
  city: string;
  address?: string;
}

export type RegistrationErrorKind = 'EMAIL_ALREADY_USED' | 'INVALID' | 'UNEXPECTED';

export class RegistrationError extends Error {
  kind: RegistrationErrorKind;
  constructor(kind: RegistrationErrorKind) {
    super(kind);
    this.name = 'RegistrationError';
    this.kind = kind;
  }
}

export async function submitRegistration(
  payload: RegistrationPayload,
): Promise<{ id: string; status: string }> {
  let response: Response;
  try {
    response = await fetch('/api/v1/registration-requests', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new RegistrationError('UNEXPECTED');
  }

  if (response.status === 409) throw new RegistrationError('EMAIL_ALREADY_USED');
  if (response.status === 400) throw new RegistrationError('INVALID');
  if (!response.ok) throw new RegistrationError('UNEXPECTED');

  const body = await response.json().catch(() => null);
  return body?.data as { id: string; status: string };
}
