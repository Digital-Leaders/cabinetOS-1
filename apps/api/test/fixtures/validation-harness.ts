import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as express from 'express';
import { toNodeHandler } from 'better-auth/node';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { AppModule } from '../../src/app.module';
import { auth, authPool } from '../../src/modules/identity/infrastructure/auth';
import { DatabaseService } from '../../src/modules/shared/database/database.service';
import { GlobalExceptionFilter } from '../../src/modules/shared/filters/http-exception.filter';
import {
  EMAIL_SENDER,
  InMemoryEmailSender,
  TransactionalEmailService,
} from '../../src/modules/email';
import { createTestAccount } from './test-accounts';

// BUILD-004 etape 2, EA-018 / TASK-063 : outil partage des tests de la cascade de validation. Demarre
// l'application complete (HTTP -> garde -> base -> email en memoire), cree un administrateur de plateforme
// et des fondateurs REELS par le parcours d'inscription, et nettoie tout ce qui a ete cree.

const ADMIN_DATABASE_URL = process.env.ADMIN_DATABASE_URL;

export interface FounderInput {
  label: string;
  firstName?: string;
  lastName?: string;
  structure?: string;
  /** Nom de structure EXACT (sans le libelle du test) : pour provoquer volontairement une collision de nom court. */
  exact?: string;
  city?: string;
  address?: string;
  specialty?: string;
  inpe?: string;
  numeroOrdre?: string;
}

export interface Founder {
  email: string;
  cookie: string;
  requestId: string;
  userId: string;
  structureName: string;
}

export async function bootValidationHarness(suite: string) {
  if (!ADMIN_DATABASE_URL) throw new Error('ADMIN_DATABASE_URL est requis.');
  const adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app: INestApplication = moduleFixture.createNestApplication({ bodyParser: false });
  const databaseService = app.get(DatabaseService);
  const outbox = app.get(EMAIL_SENDER) as InMemoryEmailSender;
  const emailService = app.get(TransactionalEmailService);

  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.all('/api/v1/auth/{*splat}', toNodeHandler(auth));
  app.use(express.json());
  app.setGlobalPrefix('api/v1', { exclude: ['api/v1/auth/{*splat}'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new GlobalExceptionFilter());
  await app.init();
  await app.listen(0);
  const httpServer = `http://127.0.0.1:${app.getHttpServer().address().port}`;

  const runId = `${suite}${Date.now()}`;
  // Marqueur present dans le nom de structure de TOUTES les demandes de ce test : il isole nos lignes de
  // tout ce que d'autres fichiers de tests (lances en parallele sur la meme base) creent.
  const TAG = `Vt${runId}`;
  const emails: string[] = [];

  const adminEmail = `${runId}-admin@example.com`;
  emails.push(adminEmail);
  const admin = await createTestAccount({
    email: adminEmail,
    password: 'equipe-mdp-1234',
    name: 'Zineb Admin',
  });
  await adminPool.query(
    `INSERT INTO platform_admins (user_id, granted_by, reason) VALUES ($1, 'Test', 'test e2e')`,
    [admin.userId],
  );

  /** Cree une vraie demande : compte + demande PENDING_VERIFICATION, par le parcours d'inscription. */
  async function registerFounder(input: FounderInput): Promise<Founder> {
    const email = `${runId}-${input.label}@example.com`;
    emails.push(email);
    // Nom UNIQUE par fondateur (libelle du test + marqueur) : snapshot() retrouve l'organisation par ce
    // nom, qui ne doit donc jamais etre partage entre deux tests -- sauf demande explicite (`exact`).
    const structureName = input.exact
      ? `${input.exact} ${TAG}`
      : `${input.structure ?? 'Cabinet Dr Bennani'} ${input.label} ${TAG}`;
    const res = await fetch(`${httpServer}/api/v1/registration-requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: input.firstName ?? 'Youssef',
        lastName: input.lastName ?? 'Bennani',
        email,
        password: 'password1234',
        specialty: input.specialty ?? 'cardiologie',
        structureName,
        city: input.city ?? 'Casablanca',
        ...(input.address ? { address: input.address } : {}),
        ...(input.inpe ? { inpe: input.inpe } : {}),
        ...(input.numeroOrdre ? { numeroOrdre: input.numeroOrdre } : {}),
      }),
    });
    if (res.status !== 201) throw new Error(`Inscription de test refusee : ${res.status}`);
    const cookie = (res.headers.get('set-cookie') as string).split(';')[0];
    const { data } = await res.json();
    const user = (await adminPool.query('SELECT id FROM users WHERE email = $1', [email])).rows[0];
    outbox.reset(); // l'email de confirmation de l'inscription n'est pas l'objet de ces tests
    return {
      email,
      cookie,
      requestId: data.id as string,
      userId: user.id as string,
      structureName,
    };
  }

  const call = (method: string, path: string, cookie: string, extra: Record<string, string> = {}) =>
    fetch(`${httpServer}/api/v1${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Cookie: cookie, ...extra },
    });
  const validate = (requestId: string, cookie = admin.cookie) =>
    call('POST', `/admin/registration-requests/${requestId}/validate`, cookie);
  const resendActivation = (requestId: string, cookie = admin.cookie) =>
    call('POST', `/admin/registration-requests/${requestId}/resend-activation-email`, cookie);

  /** Tout ce que la cascade ecrit, relu avec la connexion d'administration (sans RLS). */
  async function snapshot(founder: Founder) {
    const orgs = await adminPool.query(
      'SELECT id, name, slug, city, address FROM organizations WHERE name = $1',
      [founder.structureName],
    );
    const memberships = await adminPool.query(
      `SELECT m.organization_id, r.name AS role FROM memberships m JOIN roles r ON r.id = m.role_id WHERE m.user_id = $1`,
      [founder.userId],
    );
    const medecins = await adminPool.query(
      `SELECT organization_id, user_id, first_name, last_name, specialty, inpe, numero_ordre FROM medecins WHERE user_id = $1`,
      [founder.userId],
    );
    const request = (
      await adminPool.query(
        `SELECT status, organization_id, complement_requested_info, complement_message FROM registration_requests WHERE id = $1`,
        [founder.requestId],
      )
    ).rows[0];
    const cache = (
      await adminPool.query('SELECT organization_memberships AS c FROM users WHERE id = $1', [
        founder.userId,
      ])
    ).rows[0].c as unknown[];
    const events = (
      await adminPool.query(
        `SELECT e.action, e.email_template, e.email_failure_retryable, e.actor_user_id
         FROM registration_events e WHERE e.registration_request_id = $1 ORDER BY e.created_at, e.id`,
        [founder.requestId],
      )
    ).rows as {
      action: string;
      email_template: string | null;
      email_failure_retryable: boolean | null;
      actor_user_id: string | null;
    }[];
    return {
      orgs: orgs.rows as {
        id: string;
        name: string;
        slug: string;
        city: string | null;
        address: string | null;
      }[],
      memberships: memberships.rows as { organization_id: string; role: string }[],
      medecins: medecins.rows as Record<string, unknown>[],
      request: request as {
        status: string;
        organization_id: string | null;
        complement_requested_info: string | null;
        complement_message: string | null;
      },
      cache,
      events,
    };
  }

  async function cleanup() {
    const orgIds = (
      await adminPool.query(`SELECT DISTINCT o.id FROM organizations o WHERE o.name LIKE $1`, [
        `%${TAG}`,
      ])
    ).rows.map((r) => r.id as string);
    await adminPool.query('DELETE FROM patient_records WHERE organization_id = ANY($1)', [orgIds]);
    await adminPool.query('DELETE FROM patients WHERE organization_id = ANY($1)', [orgIds]);
    await adminPool.query('DELETE FROM patient_record_counters WHERE organization_id = ANY($1)', [
      orgIds,
    ]);
    await adminPool.query('DELETE FROM medecins WHERE organization_id = ANY($1)', [orgIds]);
    await adminPool.query('DELETE FROM audit_events WHERE organization_id = ANY($1)', [orgIds]);
    await adminPool.query('DELETE FROM memberships WHERE organization_id = ANY($1)', [orgIds]);
    await adminPool.query(
      `DELETE FROM registration_events WHERE registration_request_id IN
         (SELECT r.id FROM registration_requests r JOIN users u ON u.id = r.user_id WHERE u.email = ANY($1))`,
      [emails],
    );
    await adminPool.query(
      `DELETE FROM registration_requests WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1))`,
      [emails],
    );
    await adminPool.query(
      'DELETE FROM platform_admins WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1))',
      [emails],
    );
    await adminPool.query('DELETE FROM users WHERE email = ANY($1)', [emails]);
    await adminPool.query('DELETE FROM organizations WHERE id = ANY($1)', [orgIds]);
    await adminPool.end();
    await authPool.end();
    await app.close();
  }

  return {
    app,
    databaseService,
    adminPool,
    outbox,
    emailService,
    httpServer,
    admin,
    TAG,
    runId,
    emails,
    registerFounder,
    call,
    validate,
    resendActivation,
    snapshot,
    cleanup,
    sql,
  };
}

export type ValidationHarness = Awaited<ReturnType<typeof bootValidationHarness>>;
