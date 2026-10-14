import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as express from 'express';
import { toNodeHandler } from 'better-auth/node';
import { sql } from 'drizzle-orm';
import { AppModule } from '../src/app.module';
import { auth, authPool } from '../src/modules/identity/infrastructure/auth';
import { AUTH_PROVIDER } from '../src/modules/identity/application/auth-provider.port';
import type { AuthProvider } from '../src/modules/identity/application/auth-provider.port';
import { DatabaseService } from '../src/modules/shared/database/database.service';

// TASK-015 : gestion des sessions -- renouvellement automatique et revocation explicite.
//
// Important a noter : le renouvellement automatique est un comportement NATIF de
// Better-Auth (option updateAge, activee par defaut a 1 jour) -- ce n est pas du code
// que nous ecrivons, mais un comportement que nous verifions et documentons ici pour
// nous assurer qu il fonctionne reellement avec notre configuration (schema existant,
// role applicatif non-superutilisateur). La revocation, elle, passe explicitement par
// AuthProvider.revokeSession() (TASK-014), jamais par un appel direct a Better-Auth.

describe('Gestion des sessions (e2e, TASK-015)', () => {
  let app: INestApplication;
  let authProvider: AuthProvider;
  let databaseService: DatabaseService;
  let httpServer: string;
  const testEmail = `session-mgmt-test-${Date.now()}@example.com`;
  const testPassword = 'password1234';
  const origin = 'http://localhost:3001';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ bodyParser: false });
    authProvider = app.get<AuthProvider>(AUTH_PROVIDER);
    databaseService = app.get(DatabaseService);

    const expressApp = app.getHttpAdapter().getInstance();
    expressApp.all('/api/v1/auth/{*splat}', toNodeHandler(auth));
    app.use(express.json());
    app.setGlobalPrefix('api/v1', { exclude: ['api/v1/auth/{*splat}'] });

    await app.init();
    await app.listen(0);
    const address = app.getHttpServer().address();
    httpServer = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await databaseService.db.execute(sql`DELETE FROM users WHERE email = ${testEmail}`);
    await authPool.end();
    await app.close();
  });

  it('le renouvellement automatique prolonge une session ancienne sans reconnexion complete', async () => {
    const signUpRes = await fetch(`${httpServer}/api/v1/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ email: testEmail, password: testPassword, name: 'Session Mgmt Test' }),
    });
    const cookie = (signUpRes.headers.get('set-cookie') as string).split(';')[0];

    await databaseService.db.execute(
      sql`UPDATE sessions SET updated_at = NOW() - INTERVAL '2 days', expires_at = NOW() + INTERVAL '1 hour' WHERE user_id = (SELECT id FROM users WHERE email = ${testEmail})`,
    );
    const before = await databaseService.db.execute(
      sql`SELECT expires_at FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = ${testEmail})`,
    );
    const expiresAtBefore = new Date((before.rows[0] as { expires_at: string }).expires_at);

    const headers = new Headers();
    headers.set('cookie', cookie);
    const identity = await authProvider.verifySession(headers);
    expect(identity).not.toBeNull();

    const after = await databaseService.db.execute(
      sql`SELECT expires_at FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = ${testEmail})`,
    );
    const expiresAtAfter = new Date((after.rows[0] as { expires_at: string }).expires_at);

    expect(expiresAtAfter.getTime()).toBeGreaterThan(expiresAtBefore.getTime());
  });

  it('une session revoquee devient immediatement invalide sur la requete suivante', async () => {
    const signInRes = await fetch(`${httpServer}/api/v1/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });
    const cookie = (signInRes.headers.get('set-cookie') as string).split(';')[0];
    const signInBody = await signInRes.json();

    const headers = new Headers();
    headers.set('cookie', cookie);

    const beforeRevoke = await authProvider.verifySession(headers);
    expect(beforeRevoke).not.toBeNull();

    await authProvider.revokeSession(headers, signInBody.token);

    const afterRevoke = await authProvider.verifySession(headers);
    expect(afterRevoke).toBeNull();
  });

  it('ne revoque pas les autres sessions du meme utilisateur (hors perimetre : revocation de masse)', async () => {
    const session1 = await fetch(`${httpServer}/api/v1/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });
    const cookie1 = (session1.headers.get('set-cookie') as string).split(';')[0];
    const body1 = await session1.json();

    const session2 = await fetch(`${httpServer}/api/v1/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });
    const cookie2 = (session2.headers.get('set-cookie') as string).split(';')[0];

    const headers1 = new Headers();
    headers1.set('cookie', cookie1);
    await authProvider.revokeSession(headers1, body1.token);

    const identity1 = await authProvider.verifySession(headers1);
    expect(identity1).toBeNull();

    const headers2 = new Headers();
    headers2.set('cookie', cookie2);
    const identity2 = await authProvider.verifySession(headers2);
    expect(identity2).not.toBeNull();
  });
});
