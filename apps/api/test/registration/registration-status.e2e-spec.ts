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
import { EMAIL_SENDER, InMemoryEmailSender, renderEmail } from '../../src/modules/email';
import { RESEND_EMAIL_WINDOW_SECONDS } from '../../src/business/registration';
import { createTestAccount } from '../fixtures/test-accounts';

// TASK-054 (BUILD-004 etape 2, EA-015) : statut de la demande cote fondateur et renvoi de
// l'email de complement (ADR-0021 D4, ADR-0022).
//
// Points verifies a la cloture d'EA-015 (encadrant) : le renvoi re-emet le message stocke
// sans le reconstruire ; la garde de 60 s tient ; registration_events ne contient aucun
// contenu ; aucune fuite de refusal_internal_reason.
//
// Les colonnes de complement sont ecrites par l'action admin d'EA-018 : ici, le message est
// seme directement (fixture), comme convenu avec l'encadrant.

const ADMIN_DATABASE_URL = process.env.ADMIN_DATABASE_URL;
const INTERNAL_REASON = 'MOTIF-INTERNE-CONFIDENTIEL-7f3a';
const INTERNAL_NOTE = 'NOTE-EQUIPE-CONFIDENTIELLE-91bc';
const REQUESTED_INFO = 'le lien de votre fiche Google';
const COMPLEMENT_MESSAGE =
  'Bonjour, pourriez-vous nous envoyer le lien de la fiche Google de votre cabinet ?\nMerci <3 & a bientot.';

describe('Statut de la demande et renvoi d email (e2e, TASK-054)', () => {
  let app: INestApplication;
  let databaseService: DatabaseService;
  let adminPool: Pool;
  let outbox: InMemoryEmailSender;
  let httpServer: string;
  const runId = Date.now();
  const emails: string[] = [];

  async function registerFounder(label: string) {
    const email = `status-${label}-${runId}@example.com`;
    emails.push(email);
    const res = await fetch(`${httpServer}/api/v1/registration-requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: 'Youssef',
        lastName: 'Bennani',
        email,
        password: 'password1234',
        specialty: 'pediatrie',
        structureName: 'Cabinet Test',
        city: 'Rabat',
      }),
    });
    expect(res.status).toBe(201);
    const cookie = (res.headers.get('set-cookie') as string).split(';')[0];
    const { data } = await res.json();
    // L'email de confirmation de l'inscription n'est pas l'objet de ces tests.
    outbox.reset();
    return { email, cookie, requestId: data.id as string };
  }

  async function seedComplement(requestId: string) {
    await databaseService.db.execute(sql`
      UPDATE registration_requests
      SET status = 'COMPLEMENT_REQUESTED',
          complement_requested_info = ${REQUESTED_INFO},
          complement_message = ${COMPLEMENT_MESSAGE}
      WHERE id = ${requestId}
    `);
  }

  function getStatus(cookie?: string) {
    return fetch(`${httpServer}/api/v1/identity/registration-status`, {
      headers: cookie ? { Cookie: cookie } : {},
    });
  }

  function resend(cookie?: string) {
    return fetch(`${httpServer}/api/v1/identity/registration-status/resend-email`, {
      method: 'POST',
      headers: cookie ? { Cookie: cookie } : {},
    });
  }

  async function eventsOf(requestId: string) {
    const result = await databaseService.db.execute(
      sql`SELECT * FROM registration_events WHERE registration_request_id = ${requestId}
          ORDER BY created_at, action`,
    );
    return result.rows as Record<string, unknown>[];
  }

  beforeAll(async () => {
    if (!ADMIN_DATABASE_URL) throw new Error('ADMIN_DATABASE_URL est requis (nettoyage).');
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
    await adminPool.query('DELETE FROM users WHERE email = ANY($1)', [emails]);
    await adminPool.end();
    await authPool.end();
    await app.close();
  });

  describe('GET /identity/registration-status', () => {
    it('sans session : 401, en lecture comme en renvoi', async () => {
      expect((await getStatus()).status).toBe(401);
      expect((await resend()).status).toBe(401);
    });

    it('compte sans demande (compte d equipe) : status null, il entre normalement', async () => {
      const email = `status-team-${runId}@example.com`;
      emails.push(email);
      const team = await createTestAccount({ email, password: 'equipe-mdp-1234', name: 'Equipe' });

      const res = await getStatus(team.cookie);
      expect(res.status).toBe(200);
      expect((await res.json()).data).toEqual({ status: null });
    });

    it('en verification : statut et email masque, rien d autre', async () => {
      const founder = await registerFounder('pending');
      const { data } = await (await getStatus(founder.cookie)).json();

      expect(data).toEqual({ status: 'PENDING_VERIFICATION', maskedEmail: 's•••••@example.com' });
    });

    it('refusee : le message au demandeur seulement -- motif interne et note jamais exposes (R8)', async () => {
      const founder = await registerFounder('refused');
      await databaseService.db.execute(sql`
        UPDATE registration_requests
        SET status = 'REFUSED',
            refusal_internal_reason = ${INTERNAL_REASON},
            refusal_message_to_applicant = 'Nous ne pouvons pas donner suite. Contactez-nous.',
            internal_note = ${INTERNAL_NOTE}
        WHERE id = ${founder.requestId}
      `);

      const res = await getStatus(founder.cookie);
      const raw = await res.text();
      expect(raw).not.toContain(INTERNAL_REASON);
      expect(raw).not.toContain(INTERNAL_NOTE);
      expect(JSON.parse(raw).data).toEqual({
        status: 'REFUSED',
        maskedEmail: 's•••••@example.com',
        refusalMessage: 'Nous ne pouvons pas donner suite. Contactez-nous.',
      });
    });

    it('complement demande : le contenu du complement n est pas renvoye, seul le delai l est', async () => {
      const founder = await registerFounder('complement-view');
      await seedComplement(founder.requestId);

      const raw = await (await getStatus(founder.cookie)).text();
      expect(raw).not.toContain(REQUESTED_INFO);
      expect(JSON.parse(raw).data).toEqual({
        status: 'COMPLEMENT_REQUESTED',
        maskedEmail: 's•••••@example.com',
        nextResendAllowedAt: null,
      });
    });
  });

  describe('POST /identity/registration-status/resend-email', () => {
    it('re-emet A L IDENTIQUE le message stocke, sans le reconstruire (ADR-0022)', async () => {
      const founder = await registerFounder('resend');
      await seedComplement(founder.requestId);

      const res = await resend(founder.cookie);
      expect(res.status).toBe(200);
      const { data } = await res.json();
      expect(data.sent).toBe(true);

      expect(outbox.outbox).toHaveLength(1);
      const sent = outbox.outbox[0];
      expect(sent.to.email).toBe(founder.email);
      // Exactement le rendu du modele avec les parametres stockes : rien n'est recompose.
      const expected = renderEmail('verification-complement', {
        firstName: 'Youssef',
        requestedInfo: REQUESTED_INFO,
        message: COMPLEMENT_MESSAGE,
      });
      expect({ subject: sent.subject, html: sent.html, text: sent.text }).toEqual(expected);
    });

    it('deux clics rapproches : un seul envoi, le second recoit 429', async () => {
      const founder = await registerFounder('double');
      await seedComplement(founder.requestId);

      expect((await resend(founder.cookie)).status).toBe(200);
      const second = await resend(founder.cookie);
      expect(second.status).toBe(429);
      expect(outbox.outbox).toHaveLength(1);

      // Le statut annonce quand le prochain renvoi sera accepte (environ 60 s).
      const { data } = await (await getStatus(founder.cookie)).json();
      const waitMs = new Date(data.nextResendAllowedAt).getTime() - Date.now();
      expect(waitMs).toBeGreaterThan((RESEND_EMAIL_WINDOW_SECONDS - 10) * 1000);
      expect(waitMs).toBeLessThanOrEqual(RESEND_EMAIL_WINDOW_SECONDS * 1000);
    });

    it('deux clics simultanes : un seul creneau reserve, un seul email', async () => {
      const founder = await registerFounder('parallel');
      await seedComplement(founder.requestId);

      const results = await Promise.all([
        resend(founder.cookie),
        resend(founder.cookie),
        resend(founder.cookie),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 429, 429]);
      expect(outbox.outbox).toHaveLength(1);
    });

    it('une fois le delai ecoule, un nouveau renvoi est accepte', async () => {
      const founder = await registerFounder('after-window');
      await seedComplement(founder.requestId);
      expect((await resend(founder.cookie)).status).toBe(200);

      await databaseService.db.execute(sql`
        UPDATE registration_requests
        SET last_email_resent_at = now() - make_interval(secs => ${RESEND_EMAIL_WINDOW_SECONDS + 1})
        WHERE id = ${founder.requestId}
      `);
      expect((await resend(founder.cookie)).status).toBe(200);
      expect(outbox.outbox).toHaveLength(2);
    });

    it('hors complement (en verification) : 409, aucun email', async () => {
      const founder = await registerFounder('not-complement');

      expect((await resend(founder.cookie)).status).toBe(409);
      expect(outbox.outbox).toHaveLength(0);
    });

    it('compte sans demande : 404, aucun email', async () => {
      const email = `status-team-resend-${runId}@example.com`;
      emails.push(email);
      const team = await createTestAccount({ email, password: 'equipe-mdp-1234', name: 'Equipe' });

      expect((await resend(team.cookie)).status).toBe(404);
      expect(outbox.outbox).toHaveLength(0);
    });

    it('un fondateur n agit que sur SA demande : renvoyer pour soi ne touche jamais celle d un autre', async () => {
      const inComplement = await registerFounder('owner');
      await seedComplement(inComplement.requestId);
      const other = await registerFounder('other');

      expect((await resend(other.cookie)).status).toBe(409);
      expect(outbox.outbox).toHaveLength(0);
      // Le creneau de l'autre demande est intact : son proprietaire peut toujours renvoyer.
      expect((await resend(inComplement.cookie)).status).toBe(200);
    });

    it('echec d envoi : trace EMAIL_FAILED renvoyable, jamais une erreur pour le fondateur (R6)', async () => {
      const founder = await registerFounder('send-ko');
      await seedComplement(founder.requestId);
      outbox.failNext(1);

      const res = await resend(founder.cookie);
      expect(res.status).toBe(200);
      expect((await res.json()).data.sent).toBe(false);
      expect(await eventsOf(founder.requestId)).toContainEqual(
        expect.objectContaining({
          action: 'EMAIL_FAILED',
          email_template: 'verification-complement',
          email_failure_retryable: true,
        }),
      );
    });

    it('l historique trace l action, jamais le contenu renvoye', async () => {
      const founder = await registerFounder('history');
      await seedComplement(founder.requestId);
      await resend(founder.cookie);

      const events = await eventsOf(founder.requestId);
      expect(events.map((e) => e.action)).toEqual(
        expect.arrayContaining(['EMAIL_RESEND_REQUESTED', 'EMAIL_SENT']),
      );
      const serialized = JSON.stringify(events);
      expect(serialized).not.toContain(REQUESTED_INFO);
      expect(serialized).not.toContain('fiche Google');
    });
  });

  describe('contraintes de base (ADR-0022)', () => {
    it('COMPLEMENT_REQUESTED sans message est refuse : un renvoi est toujours possible', async () => {
      const founder = await registerFounder('check-present');
      await expect(
        databaseService.db.execute(
          sql`UPDATE registration_requests SET status = 'COMPLEMENT_REQUESTED' WHERE id = ${founder.requestId}`,
        ),
      ).rejects.toMatchObject({ cause: { code: '23514' } });
    });

    it('une demande close (REFUSED) qui garderait le message est refusee : hygiene des donnees', async () => {
      const founder = await registerFounder('check-cleared');
      await seedComplement(founder.requestId);
      await expect(
        databaseService.db.execute(sql`
          UPDATE registration_requests
          SET status = 'REFUSED', refusal_internal_reason = 'x', refusal_message_to_applicant = 'y'
          WHERE id = ${founder.requestId}
        `),
      ).rejects.toMatchObject({ cause: { code: '23514' } });

      // Controle positif : en vidant le message, la cloture passe.
      await databaseService.db.execute(sql`
        UPDATE registration_requests
        SET status = 'REFUSED', refusal_internal_reason = 'x', refusal_message_to_applicant = 'y',
            complement_requested_info = NULL, complement_message = NULL
        WHERE id = ${founder.requestId}
      `);
    });
  });
});
