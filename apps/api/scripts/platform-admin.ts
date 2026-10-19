import type { AuthProvider } from '../src/modules/identity';

// BUILD-004 etape 2, EA-017 / TASK-058 (ADR-0021 P3) : ajout d'un administrateur de PLATEFORME.
//
// INVARIANT (P3) : tant que l'etape 2-bis n'existe pas, un administrateur n'est ajoute QUE
// par ce script, et chaque ajout est TRACE : qui l'ajoute (grantedBy) et pourquoi (reason),
// inscrits dans platform_admins -- et exiges par la base elle-meme (CHECK), pas seulement ici.
//
// ECRITURE AVEC LA CONNEXION D'ADMINISTRATION (ADMIN_DATABASE_URL), jamais avec le role de
// l'application : cabinetos_app n'a que SELECT sur platform_admins (migration 0023), si bien
// qu'une faille de l'application ne peut pas promouvoir un compte.
//
// INVARIANT (P1) : un compte cree ici recoit TOUJOURS sa ligne platform_admins dans le meme
// lancement. Si l'ecriture echoue, le compte cree est supprime aussitot : il ne reste jamais
// un compte sans demande, sans adhesion ni ligne admin, qui serait recuperable comme orphelin.
// Un compte DEJA existant n'est jamais supprime, quoi qu'il arrive.

/** Ce dont le script a besoin de la connexion d'administration (compatible pg.Pool). */
export interface AdminDb {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export interface GrantPlatformAdminInput {
  email: string;
  /** Operateur humain qui ajoute cet administrateur (trace). */
  grantedBy: string;
  /** Raison de l'ajout (trace). */
  reason: string;
  /** Requis seulement si le compte n'existe pas encore. */
  name?: string;
  password?: string;
}

export type GrantPlatformAdminResult = {
  userId: string;
  /** true si le compte a ete cree par ce lancement, false s'il existait deja. */
  accountCreated: boolean;
  /** ALREADY_ADMIN : deja administrateur actif, rien n'a ete modifie. */
  outcome: 'GRANTED' | 'ALREADY_ADMIN';
};

export async function grantPlatformAdmin(
  deps: { authProvider: AuthProvider; adminDb: AdminDb },
  input: GrantPlatformAdminInput,
): Promise<GrantPlatformAdminResult> {
  const grantedBy = input.grantedBy?.trim();
  const reason = input.reason?.trim();
  if (!grantedBy) throw new Error('--granted-by est obligatoire : qui ajoute cet administrateur ?');
  if (!reason) throw new Error('--reason est obligatoire : pourquoi cet administrateur ?');

  const email = input.email.trim().toLowerCase();
  const existing = await deps.adminDb.query('SELECT id FROM users WHERE lower(email) = $1', [
    email,
  ]);

  let userId: string;
  let accountCreated = false;

  if (existing.rows.length > 0) {
    userId = existing.rows[0].id as string;
  } else {
    if (!input.name?.trim() || !input.password) {
      throw new Error(
        "Aucun compte avec cet email : fournir --name et la variable TEAM_ACCOUNT_PASSWORD pour le creer, ou utiliser l'email d'un compte existant.",
      );
    }
    const account = await deps.authProvider.createAccount({
      email,
      password: input.password,
      name: input.name.trim(),
    });
    if (!account.ok) {
      throw new Error(
        account.reason === 'EMAIL_ALREADY_USED'
          ? 'Un compte existe deja avec cet email (creation simultanee ?). Relancer la commande.'
          : 'Mot de passe refuse (8 caracteres minimum).',
      );
    }
    userId = account.userId;
    accountCreated = true;
  }

  try {
    const inserted = await deps.adminDb.query(
      `INSERT INTO platform_admins (user_id, granted_by, reason)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO NOTHING
       RETURNING user_id`,
      [userId, grantedBy, reason],
    );
    if (inserted.rows.length > 0) {
      return { userId, accountCreated, outcome: 'GRANTED' };
    }

    // Une ligne existe deja : administrateur actif (rien a faire) ou revoque (decision humaine).
    const current = await deps.adminDb.query(
      'SELECT revoked_at FROM platform_admins WHERE user_id = $1',
      [userId],
    );
    if (current.rows[0]?.revoked_at) {
      throw new Error(
        "Ce compte est un ancien administrateur REVOQUE. Le reactiver est une decision a prendre et a tracer a la main (voir apps/api/scripts/README.md) : le script ne l'efface pas.",
      );
    }
    return { userId, accountCreated, outcome: 'ALREADY_ADMIN' };
  } catch (error) {
    // Invariant P1 : un compte cree par CE lancement ne reste jamais sans ligne admin.
    if (accountCreated) {
      await deps.adminDb.query('DELETE FROM users WHERE id = $1', [userId]).catch(() => undefined);
    }
    throw error;
  }
}
