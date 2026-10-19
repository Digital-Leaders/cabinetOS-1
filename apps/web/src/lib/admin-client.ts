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
