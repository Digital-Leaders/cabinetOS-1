import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

// TASK-013 : instance Better-Auth, connectee au schema existant (TASK-005).
// IMPORTANT : cette connexion utilise DATABASE_URL, donc le role applicatif
// cabinetos_app (non-superutilisateur) -- jamais postgres. Les tables Better-Auth
// (users, sessions, accounts, verifications) sont globales, sans organizationId,
// donc sans politique RLS (coherent avec la Section I de Passe 2).
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const authPool = pool;
const db = drizzle(pool, { schema });

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    usePlural: true,
    schema,
  }),
  basePath: '/api/v1/auth',
  baseURL: process.env.BETTER_AUTH_BASE_URL ?? 'http://localhost:3000',
  secret: process.env.BETTER_AUTH_SECRET,
  emailAndPassword: {
    enabled: true,
  },
  // Parcours d acces, etape 1 -- "session persistante avec expiration" (comportement
  // transversal demande). 7 jours correspond deja au defaut de Better-Auth : ce bloc
  // le rend explicite plutot que de laisser un defaut implicite de la librairie
  // gouverner un parametre sensible pour la securite. updateAge : la session est
  // prolongee de 7 jours si l utilisateur est actif dans le dernier jour, pour eviter
  // une deconnexion en pleine consultation.
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  telemetry: {
    enabled: false,
  },
  trustedOrigins: (process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? 'http://localhost:3001').split(','),
});
