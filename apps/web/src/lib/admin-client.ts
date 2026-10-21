// BUILD-004 etape 2, EA-017 / TASK-060 : client de l'API de l'espace admin (TASK-058, TASK-059).
// Session seule, sans organisation : un administrateur de plateforme n'en a pas.
//
// Les erreurs sont classees par statut HTTP, jamais par le texte du serveur : l'ecran affiche ses
// propres messages, traduits.

export type AdminFilter = 'pending' | 'validated' | 'refused';
export type RegistrationStatus =
  'PENDING_VERIFICATION' | 'COMPLEMENT_REQUESTED' | 'ACTIVE' | 'REFUSED';

export interface AdminListItem {
  id: string;
  firstName: string;
  lastName: string;
  specialty: string;
  structureName: string;
  city: string;
  status: RegistrationStatus;
  createdAt: string;
}

export interface AdminCounts {
  pending: number;
  validated: number;
  refused: number;
}

export interface AdminListPage {
  items: AdminListItem[];
  nextCursor: string | null;
  counts: AdminCounts;
}

export interface AdminHistoryEntry {
  id: string;
  action: string;
  createdAt: string;
  actor: { id: string; name: string } | null;
  emailTemplate: string | null;
  emailFailureRetryable: boolean | null;
}

export interface AdminRequestDetail {
  id: string;
  status: RegistrationStatus;
  createdAt: string;
  updatedAt: string;
  doctor: {
    firstName: string;
    lastName: string;
    email: string;
    specialty: string;
    inpe: string | null;
    numeroOrdre: string | null;
  };
  structure: { name: string; city: string; address: string | null };
  internalNote: string | null;
  complement: { requestedInfo: string | null; message: string | null } | null;
  refusal: { internalReason: string | null; messageToApplicant: string | null } | null;
  organizationId: string | null;
  history: AdminHistoryEntry[];
}

export type AdminErrorKind = 'UNAUTHENTICATED' | 'FORBIDDEN' | 'NOT_FOUND' | 'UNEXPECTED';

export class AdminApiError extends Error {
  kind: AdminErrorKind;
  constructor(kind: AdminErrorKind) {
    super(kind);
    this.name = 'AdminApiError';
    this.kind = kind;
  }
}

function classify(status: number): AdminApiError {
  if (status === 401) return new AdminApiError('UNAUTHENTICATED');
  if (status === 403) return new AdminApiError('FORBIDDEN');
  if (status === 404) return new AdminApiError('NOT_FOUND');
  return new AdminApiError('UNEXPECTED');
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: 'include',
      ...init,
      headers: { 'Content-Type': 'application/json', ...init.headers },
    });
  } catch {
    throw new AdminApiError('UNEXPECTED');
  }
  if (!response.ok) throw classify(response.status);
  return response;
}

/** 200 : l'utilisateur est un administrateur actif de la plateforme. 403 : il ne l'est pas. */
export async function fetchAdminMe(): Promise<void> {
  await request('/api/v1/admin/me');
}

/**
 * Vrai si le compte connecte est administrateur de plateforme. Ne leve jamais : toute erreur
 * (403, reseau, serveur) est « non », la connexion ne doit jamais echouer a cause de cette question.
 */
export async function fetchIsPlatformAdmin(): Promise<boolean> {
  try {
    await fetchAdminMe();
    return true;
  } catch {
    return false;
  }
}

export async function fetchRegistrationRequests(params: {
  filter: AdminFilter;
  q?: string;
  cursor?: string | null;
  limit?: number;
}): Promise<AdminListPage> {
  const search = new URLSearchParams({ filter: params.filter });
  if (params.q?.trim()) search.set('q', params.q.trim());
  if (params.cursor) search.set('cursor', params.cursor);
  if (params.limit) search.set('limit', String(params.limit));

  const response = await request(`/api/v1/admin/registration-requests?${search.toString()}`);
  const body = await response.json();
  return {
    items: body.data as AdminListItem[],
    nextCursor: (body.meta?.nextCursor as string | null) ?? null,
    counts: body.meta?.counts as AdminCounts,
  };
}

export async function fetchRegistrationRequestDetail(id: string): Promise<AdminRequestDetail> {
  const response = await request(`/api/v1/admin/registration-requests/${encodeURIComponent(id)}`);
  return (await response.json()).data as AdminRequestDetail;
}

/** La seule ecriture de l'espace admin en lecture : la note interne. Vide = effacee. */
export async function saveInternalNote(
  id: string,
  note: string,
): Promise<{ internalNote: string | null; updatedAt: string }> {
  const response = await request(
    `/api/v1/admin/registration-requests/${encodeURIComponent(id)}/internal-note`,
    { method: 'PUT', body: JSON.stringify({ internalNote: note }) },
  );
  return (await response.json()).data;
}

// ---------------------------------------------------------------------------------------
// BUILD-004 etape 2, EA-018 / TASK-066 : les TROIS ACTIONS de l'administrateur (Valider, Demander un
// complement, Refuser) et le renvoi d'un email. Routes livrees par TASK-063, 064 et 065.
//
// Classement d'erreurs PROPRE aux actions (celui de ci-dessus, partage par la lecture, reste inchange). Ici la
// DISTINCTION qui compte pour ne pas valider deux fois :
//   - SERVER    : le serveur a repondu par une erreur ; pour ces actions il garantit que RIEN n'a ete modifie
//                 (la transaction est annulee) : on peut reessayer ;
//   - UNCERTAIN : aucune reponse (reseau coupe) ; l'action a PEUT-ETRE reussi : on ne propose PAS de reessayer a
//                 l'aveugle, on relit l'etat reel de la demande.

export type AdminActionErrorKind =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT' // 409 : demande deja traitee (y compris par un autre administrateur au meme instant)
  | 'INVALID' // 400 : saisie refusee par le serveur
  | 'TOO_SOON' // 429 : un renvoi d'email vient d'avoir lieu
  | 'SERVER' // erreur serveur : rien n'a ete modifie
  | 'UNCERTAIN'; // pas de reponse : resultat inconnu

export class AdminActionError extends Error {
  kind: AdminActionErrorKind;
  constructor(kind: AdminActionErrorKind) {
    super(kind);
    this.name = 'AdminActionError';
    this.kind = kind;
  }
}

function classifyAction(status: number): AdminActionError {
  if (status === 401) return new AdminActionError('UNAUTHENTICATED');
  if (status === 403) return new AdminActionError('FORBIDDEN');
  if (status === 404) return new AdminActionError('NOT_FOUND');
  if (status === 409) return new AdminActionError('CONFLICT');
  if (status === 400) return new AdminActionError('INVALID');
  if (status === 429) return new AdminActionError('TOO_SOON');
  return new AdminActionError('SERVER');
}

async function postAction(path: string, body?: unknown): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/admin/registration-requests/${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new AdminActionError('UNCERTAIN');
  }
  if (!response.ok) throw classifyAction(response.status);
  const parsed = await response.json().catch(() => null);
  // Reponse 2xx mais illisible : l'action a reussi, on ne sait simplement pas le detail.
  return (parsed?.data ?? {}) as Record<string, unknown>;
}

const enc = encodeURIComponent;

/** VALIDER (TASK-063). `emailSent: false` : la validation est ACQUISE, l'email d'activation n'est pas parti. */
export async function validateRegistrationRequest(
  id: string,
): Promise<{ organizationId: string; emailSent: boolean }> {
  const data = await postAction(`${enc(id)}/validate`);
  return {
    organizationId: String(data.organizationId ?? ''),
    emailSent: (data.activationEmail as { sent?: boolean } | undefined)?.sent === true,
  };
}

export type ComplementInfoType = 'google_listing' | 'other_public_presence' | 'other';

export interface ComplementInput {
  infoType: ComplementInfoType;
  /** Exigee seulement pour `other`. */
  otherInfo?: string;
  message: string;
}

/** DEMANDER UN COMPLEMENT (TASK-064). */
export async function requestComplement(
  id: string,
  input: ComplementInput,
): Promise<{ emailSent: boolean }> {
  const data = await postAction(`${enc(id)}/request-complement`, {
    infoType: input.infoType,
    ...(input.infoType === 'other' ? { otherInfo: input.otherInfo } : {}),
    message: input.message,
  });
  return { emailSent: (data.complementEmail as { sent?: boolean } | undefined)?.sent === true };
}

export interface RefusalInput {
  internalReason: string;
  messageToApplicant: string;
}

/**
 * REFUSER (TASK-065). `confirmed: true` est ENVOYE ICI et nulle part ailleurs : cette fonction n'est appelee que
 * par le bouton de confirmation de la fenetre de refus. Le serveur l'exige (un refus est definitif et envoie un
 * email) : un appel sans confirmation n'a aucun effet.
 */
export async function refuseRegistrationRequest(
  id: string,
  input: RefusalInput,
): Promise<{ emailSent: boolean }> {
  const data = await postAction(`${enc(id)}/refuse`, {
    internalReason: input.internalReason,
    messageToApplicant: input.messageToApplicant,
    confirmed: true,
  });
  return { emailSent: (data.refusalEmail as { sent?: boolean } | undefined)?.sent === true };
}

export type ResendEmailKind = 'activation' | 'complement' | 'refusal';

const RESEND_ROUTES: Record<ResendEmailKind, string> = {
  activation: 'resend-activation-email',
  complement: 'resend-complement-email',
  refusal: 'resend-refusal-email',
};

/** Renvoi d'un email (TASK-063/064/065), sous la garde anti-abus de 60 s du serveur (429 : TOO_SOON). */
export async function resendRegistrationEmail(
  id: string,
  kind: ResendEmailKind,
): Promise<{ sent: boolean }> {
  const data = await postAction(`${enc(id)}/${RESEND_ROUTES[kind]}`);
  return { sent: data.sent === true };
}
