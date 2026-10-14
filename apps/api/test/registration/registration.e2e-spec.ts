import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as express from 'express';
import { toNodeHandler } from 'better-auth/node';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { uuidv7 } from 'uuidv7';
import { AppModule } from '../../src/app.module';
import { auth, authPool } from '../../src/modules/identity/infrastructure/auth';
import { DatabaseService } from '../../src/modules/shared/database/database.service';
import { GlobalExceptionFilter } from '../../src/modules/shared/filters/http-exception.filter';
import { createOrganization, createMembership } from '../../src/modules/organization';
import { EMAIL_SENDER, InMemoryEmailSender } from '../../src/modules/email';
import { ORPHAN_ACCOUNT_MIN_AGE_MINUTES } from '../../src/business/registration';
import { createTestAccount } from '../fixtures/test-accounts';

// TASK-052 (BUILD-004 etape 2, EA-014) : inscription du fondateur, de bout en bout
// (HTTP -> controleur -> AuthProvider -> base -> email en memoire).
//
// Couvre : la demande PENDING_VERIFICATION et sa session (D2), l'email de confirmation
// decouple (R6), l'email deja utilise (message neutre, D7), la compensation (D2), la
// recuperation d'orphelin strict ET age (P1) et les trois cas de concurrence cadres a la
// validation de l'ADR. Chaque refus est accompagne de la preuve que rien n'a bouge.

const ADMIN_DATABASE_URL = process.env.ADMIN_DATABASE_URL;
const NEUTRAL_MESSAGE =
  'Un espace existe deja avec cet email. Connectez-vous, ou contactez-nous si besoin.';

describe('Inscription du fondateur (e2e, TASK-052)', () => {
  let app: INestApplication;
  let databaseService: DatabaseService;
  let adminPool: Pool;
  let outbox: InMemoryEmailSender;
  let httpServer: string;
  const runId = Date.now();
  const emails: string[] = [];
  const createdOrgIds: string[] = [];
  const createdRoleIds: string[] = [];

  function newEmail(label: string): string {
    const email = `registration-${label}-${runId}-${emails.length}@example.com`;
    emails.push(email);
    return email;
  }

  function validBody(email: string, overrides: Record<string, unknown> = {}) {
    return {
      firstName: 'Youssef',
      lastName: 'Bennani',
      email,
      password: 'password1234',
      specialty: 'cardiologie',
      inpe: '123456789',
      numeroOrdre: 'ORD-42',
      structureName: 'Cabinet Dr Bennani',
      city: 'Casablanca',
      address: '12 rue des Orangers',
      ...overrides,
    };
  }

  function register(body: Record<string, unknown>) {
    return fetch(`${httpServer}/api/v1/registration-requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async function usersWithEmail(email: string) {
    const result = await databaseService.db.execute(
      sql`SELECT id FROM users WHERE email = ${email}`,
    );
    return result.rows as { id: string }[];
  }

  async function requestsOf(userId: string) {
    const result = await databaseService.db.execute(
      sql`SELECT * FROM registration_requests WHERE user_id = ${userId}`,
    );
    return result.rows as Record<string, unknown>[];
  }

  async function eventsOf(requestId: string) {
    const result = await databaseService.db.execute(
      sql`SELECT action, email_template, email_failure_retryable FROM registration_events
          WHERE registration_request_id = ${requestId} ORDER BY created_at, action`,
    );
    return result.rows as {
      action: string;
      email_template: string | null;
      email_failure_retryable: boolean | null;
    }[];
  }

  async function ageAccount(userId: string, minutes: number) {
    await databaseService.db.execute(
      sql`UPDATE users SET created_at = now() - make_interval(mins => ${minutes}) WHERE id = ${userId}`,
    );
  }

  beforeAll(async () => {
    if (!ADMIN_DATABASE_URL) {
      throw new Error(
        'ADMIN_DATABASE_URL est requis (nettoyage des demandes, sans DELETE applicatif).',
      );
    }
    adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication({ bodyParser: false });
    databaseService = app.get(DatabaseService);
    outbox = app.get(EMAIL_SENDER) as InMemoryEmailSender;

    const expressApp = app.getHttpAdapter().getInstance();
    expressApp.all('/api/v1/auth/{*splat}', toNodeHandler(auth));
    app.use(express.json());
    app.setGlobalPrefix('api/v1', { exclude: ['api/v1/auth/{*splat}'] });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    await app.listen(0);
    httpServer = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  });

  beforeEach(() => outbox.reset());

  afterAll(async () => {
    // Demandes et historique : pas de DELETE pour le role applicatif (0019).
    await adminPool.query(
      `DELETE FROM registration_events WHERE registration_request_id IN
         (SELECT r.id FROM registration_requests r JOIN users u ON u.id = r.user_id
          WHERE u.email = ANY($1))`,
      [emails],
    );
    await adminPool.query(
      `DELETE FROM registration_requests WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1))`,
      [emails],
    );
    await adminPool.query('DELETE FROM memberships WHERE organization_id = ANY($1)', [
      createdOrgIds,
    ]);
    await adminPool.query('DELETE FROM users WHERE email = ANY($1)', [emails]);
    await adminPool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
    await adminPool.query('DELETE FROM roles WHERE id = ANY($1)', [createdRoleIds]);
    await adminPool.end();
    await authPool.end();
    await app.close();
  });

  describe('inscription reussie', () => {
    it('cree le compte, la demande PENDING_VERIFICATION, ouvre la session et envoie la confirmation', async () => {
      const email = newEmail('ok');
      const res = await register(validBody(email));

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.status).toBe('PENDING_VERIFICATION');
      expect(body.data.id).toBeDefined();

      // Session ouverte : le fondateur atteindra directement l'ecran de statut.
      const setCookie = res.headers.get('set-cookie');
      expect(setCookie).toContain('session_token');
      const session = await auth.api.getSession({
        headers: new Headers({ cookie: (setCookie as string).split(';')[0] }),
      });
      expect(session?.user.email).toBe(email);

      // Donnees declarees enregistrees telles quelles (R1, R5 : aucune ressaisie).
      const [user] = await usersWithEmail(email);
      const [request] = await requestsOf(user.id);
      expect(request).toMatchObject({
        id: body.data.id,
        status: 'PENDING_VERIFICATION',
        first_name: 'Youssef',
        last_name: 'Bennani',
        specialty: 'cardiologie',
        inpe: '123456789',
        numero_ordre: 'ORD-42',
        structure_name: 'Cabinet Dr Bennani',
        city: 'Casablanca',
        address: '12 rue des Orangers',
        organization_id: null,
      });

      // Email de confirmation : bon destinataire, bon modele, sans donnee sensible.
      expect(outbox.outbox).toHaveLength(1);
      expect(outbox.outbox[0].to.email).toBe(email);
      expect(outbox.outbox[0].text).toContain('Youssef');

      // Historique : soumission puis envoi reussi.
      expect(await eventsOf(body.data.id)).toEqual([
        { action: 'REQUEST_SUBMITTED', email_template: null, email_failure_retryable: null },
        {
          action: 'EMAIL_SENT',
          email_template: 'registration-confirmation',
          email_failure_retryable: null,
        },
      ]);
    });

    it('INPE, numero d Ordre et adresse absents n empechent pas l inscription (R1)', async () => {
      const email = newEmail('minimal');
      const res = await register(
        validBody(email, { inpe: undefined, numeroOrdre: '   ', address: undefined }),
      );
      expect(res.status).toBe(201);
      const [user] = await usersWithEmail(email);
      const [request] = await requestsOf(user.id);
      expect(request).toMatchObject({ inpe: null, numero_ordre: null, address: null });
    });

    it('accepte le choix explicite generaliste (D7) et normalise l email', async () => {
      const email = newEmail('generaliste');
      const res = await register(
        validBody(`  ${email.toUpperCase()} `, { specialty: 'generaliste' }),
      );
      expect(res.status).toBe(201);
      const [user] = await usersWithEmail(email);
      expect((await requestsOf(user.id))[0].specialty).toBe('generaliste');
    });
  });

  describe('validation du formulaire (400, aucun compte cree)', () => {
    it.each([
      ['specialite hors liste', { specialty: 'medecine_generale' }],
      ['ville hors liste', { city: 'Paris' }],
      ['prenom vide', { firstName: '   ' }],
      ['nom de structure absent', { structureName: undefined }],
      ['email invalide', { email: 'pas-un-email' }],
      ['mot de passe trop court', { password: 'court' }],
    ])('%s', async (_label, overrides) => {
      const email = newEmail('invalid');
      const res = await register(validBody(email, overrides));
      expect(res.status).toBe(400);
      expect(await usersWithEmail(email)).toHaveLength(0);
      expect(outbox.outbox).toHaveLength(0);
    });
  });

  describe('decouplage de l email (R6)', () => {
    it('un echec d envoi ne bloque pas l inscription : demande creee, echec inscrit et renvoyable', async () => {
      outbox.failNext(1);
      const email = newEmail('email-ko');
      const res = await register(validBody(email));

      expect(res.status).toBe(201);
      const { data } = await res.json();
      const [user] = await usersWithEmail(email);
      expect((await requestsOf(user.id))[0].status).toBe('PENDING_VERIFICATION');
      expect(await eventsOf(data.id)).toContainEqual({
        action: 'EMAIL_FAILED',
        email_template: 'registration-confirmation',
        email_failure_retryable: true,
      });
    });
  });

  describe('email deja utilise (message neutre, D7)', () => {
    it('un fondateur deja inscrit : 409 neutre, aucun doublon, compte et demande intacts', async () => {
      const email = newEmail('duplicate');
      expect((await register(validBody(email))).status).toBe(201);
      const [user] = await usersWithEmail(email);
      await ageAccount(user.id, ORPHAN_ACCOUNT_MIN_AGE_MINUTES + 60);

      const res = await register(validBody(email, { password: 'autre-mot-de-passe' }));
      expect(res.status).toBe(409);
      expect((await res.json()).error.message).toBe(NEUTRAL_MESSAGE);

      const users = await usersWithEmail(email);
      expect(users).toEqual([{ id: user.id }]);
      expect(await requestsOf(user.id)).toHaveLength(1);
    });

    it('un fondateur refuse ne peut pas se reinscrire en V1 (P2) : meme reponse neutre', async () => {
      const email = newEmail('refused');
      expect((await register(validBody(email))).status).toBe(201);
      const [user] = await usersWithEmail(email);
      await databaseService.db.execute(
        sql`UPDATE registration_requests SET status = 'REFUSED',
              refusal_internal_reason = 'Motif interne', refusal_message_to_applicant = 'Message'
            WHERE user_id = ${user.id}`,
      );
      await ageAccount(user.id, ORPHAN_ACCOUNT_MIN_AGE_MINUTES + 60);

      const res = await register(validBody(email));
      expect(res.status).toBe(409);
      expect((await res.json()).error.message).toBe(NEUTRAL_MESSAGE);
      expect(await usersWithEmail(email)).toEqual([{ id: user.id }]);
    });
  });

  describe('compte orphelin (P1)', () => {
    it('un orphelin strict et age de plus de 10 min est recupere : nouveau compte, nouvelle demande', async () => {
      const email = newEmail('orphan-old');
      const orphan = await createTestAccount({
        email,
        password: 'ancien-mdp-1234',
        name: 'Orphelin',
      });
      await ageAccount(orphan.userId, ORPHAN_ACCOUNT_MIN_AGE_MINUTES + 1);

      const res = await register(validBody(email));
      expect(res.status).toBe(201);

      const users = await usersWithEmail(email);
      expect(users).toHaveLength(1);
      expect(users[0].id).not.toBe(orphan.userId);
      expect(await requestsOf(users[0].id)).toHaveLength(1);
      // L'ancienne session de l'orphelin a disparu avec lui (cascade).
      const oldSession = await auth.api.getSession({
        headers: new Headers({ cookie: orphan.cookie }),
      });
      expect(oldSession).toBeNull();
    });

    it('un orphelin recent (moins de 10 min) n est jamais supprime : 409 neutre', async () => {
      const email = newEmail('orphan-recent');
      const orphan = await createTestAccount({
        email,
        password: 'ancien-mdp-1234',
        name: 'Recent',
      });
      await ageAccount(orphan.userId, ORPHAN_ACCOUNT_MIN_AGE_MINUTES - 1);

      const res = await register(validBody(email));
      expect(res.status).toBe(409);
      expect(await usersWithEmail(email)).toEqual([{ id: orphan.userId }]);
    });

    it('un compte d equipe (avec adhesion), meme ancien, n est jamais recupere', async () => {
      const email = newEmail('team');
      const team = await createTestAccount({ email, password: 'equipe-mdp-1234', name: 'Equipe' });
      const org = await createOrganization(databaseService, {
        name: 'Registration Team Org',
        slug: `registration-team-${runId}`,
      });
      createdOrgIds.push(org.id);
      const roleId = uuidv7();
      createdRoleIds.push(roleId);
      await databaseService.db.execute(
        sql`INSERT INTO roles (id, name) VALUES (${roleId}, ${'RegistrationTeamRole-' + runId})`,
      );
      await createMembership(databaseService, org.id, { userId: team.userId, roleId });
      await ageAccount(team.userId, 60 * 24 * 30);

      const res = await register(validBody(email));
      expect(res.status).toBe(409);
      expect((await res.json()).error.message).toBe(NEUTRAL_MESSAGE);
      expect(await usersWithEmail(email)).toEqual([{ id: team.userId }]);
    });
  });

  describe('concurrence (P1, cadree a la validation de l ADR)', () => {
    it('une tentative concurrente ne supprime pas un compte dont la demande est en cours d insertion', async () => {
      // Etat exact d'une inscription en vol : compte cree a l'instant, demande pas
      // encore inseree. Une seconde tentative arrive a ce moment-la.
      const email = newEmail('in-flight');
      const inFlight = await createTestAccount({
        email,
        password: 'premier-mdp-1234',
        name: 'En vol',
      });

      const concurrent = await register(validBody(email));
      expect(concurrent.status).toBe(409);
      expect(await usersWithEmail(email)).toEqual([{ id: inFlight.userId }]);

      // L'inscription en vol se termine normalement : son compte est toujours la.
      await databaseService.db.execute(
        sql`INSERT INTO registration_requests (id, user_id, first_name, last_name, specialty, structure_name, city)
            VALUES (${uuidv7()}, ${inFlight.userId}, 'En', 'Vol', 'generaliste', 'Cabinet', 'Rabat')`,
      );
      expect(await requestsOf(inFlight.userId)).toHaveLength(1);
    });

    it('deux inscriptions simultanees sur le meme email : une seule reussit, l autre recoit le 409 neutre', async () => {
      const email = newEmail('parallel');
      const [a, b] = await Promise.all([
        register(validBody(email, { firstName: 'Premier' })),
        register(validBody(email, { firstName: 'Second' })),
      ]);

      expect([a.status, b.status].sort()).toEqual([201, 409]);
      const loser = a.status === 409 ? a : b;
      expect((await loser.json()).error.message).toBe(NEUTRAL_MESSAGE);

      const users = await usersWithEmail(email);
      expect(users).toHaveLength(1);
      expect(await requestsOf(users[0].id)).toHaveLength(1);
    });
  });

  describe('compensation (D2)', () => {
    it('si la demande ne peut pas etre inseree, le compte est supprime et rien ne reste', async () => {
      // Panne simulee au moment precis de l'insertion de la demande, par un declencheur
      // de test pose avec le role admin (aucun point d'injection dans le code de prod).
      await adminPool.query(`
        CREATE OR REPLACE FUNCTION test_fail_registration_insert() RETURNS trigger AS $$
        BEGIN
          IF NEW.structure_name = 'PANNE-SIMULEE' THEN
            RAISE EXCEPTION 'panne simulee pour le test de compensation';
          END IF;
          RETURN NEW;
        END $$ LANGUAGE plpgsql;
        CREATE TRIGGER test_fail_registration_insert BEFORE INSERT ON registration_requests
          FOR EACH ROW EXECUTE FUNCTION test_fail_registration_insert();
      `);
      try {
        const email = newEmail('compensation');
        const res = await register(validBody(email, { structureName: 'PANNE-SIMULEE' }));

        expect(res.status).toBe(500);
        expect((await res.json()).error.message).toMatch(/pas pu etre enregistree/);
        expect(await usersWithEmail(email)).toHaveLength(0);
        expect(outbox.outbox).toHaveLength(0);

        // L'email est aussitot libre : une nouvelle tentative (sans panne) reussit.
        const retry = await register(validBody(email));
        expect(retry.status).toBe(201);
      } finally {
        await adminPool.query(`
          DROP TRIGGER IF EXISTS test_fail_registration_insert ON registration_requests;
          DROP FUNCTION IF EXISTS test_fail_registration_insert();
        `);
      }
    });
  });
});
