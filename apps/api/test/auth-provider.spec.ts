import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as express from 'express';
import { toNodeHandler } from 'better-auth/node';
import { AppModule } from '../src/app.module';
import { auth, authPool } from '../src/modules/identity/infrastructure/auth';
import { AUTH_PROVIDER } from '../src/modules/identity/application/auth-provider.port';
import type { AuthProvider } from '../src/modules/identity/application/auth-provider.port';
import { DatabaseService } from '../src/modules/shared/database/database.service';
import { sql } from 'drizzle-orm';

// TASK-014 : verifie que l interface AuthProvider fonctionne correctement via
// l injection de dependances NestJS, en passant par le token AUTH_PROVIDER --
// jamais en instanciant l adaptateur directement.

describe('AuthProvider (TASK-014)', () => {
  let app: INestApplication;
  let authProvider: AuthProvider;
  const testEmail = `authprovider-test-${Date.now()}@example.com`;
  const testPassword = 'password1234';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ bodyParser: false });
    authProvider = app.get<AuthProvider>(AUTH_PROVIDER);

    const expressApp = app.getHttpAdapter().getInstance();
    expressApp.all('/api/v1/auth/{*splat}', toNodeHandler(auth));
    app.use(express.json());
    app.setGlobalPrefix('api/v1', { exclude: ['api/v1/auth/{*splat}'] });

    await app.init();
  });

  afterAll(async () => {
    const databaseService = app.get(DatabaseService);
    await databaseService.db.execute(sql`DELETE FROM users WHERE email = ${testEmail}`);
    await authPool.end();
    await app.close();
  });

  it('resout l identite a partir d une session valide', async () => {
    // BUILD-004 etape 2 (ADR-0021 D2) : l'inscription HTTP native est fermee ; le
    // compte est cree par le port lui-meme (createAccount), qui ouvre la session.
    const created = await authProvider.createAccount({
      email: testEmail,
      password: testPassword,
      name: 'Auth Provider Test',
    });
    expect(created.ok).toBe(true);
    const setCookie = created.ok ? created.sessionCookies[0] : undefined;
    expect(setCookie).toBeTruthy();

    const headers = new Headers();
    headers.set('cookie', (setCookie as string).split(';')[0]);

    const identity = await authProvider.verifySession(headers);
    expect(identity).not.toBeNull();
    expect(identity?.email).toBe(testEmail);
    expect(identity?.userId).toBeDefined();
  });

  it('createAccount renvoie EMAIL_ALREADY_USED sans lever pour un email deja pris (ADR-0021 D2)', async () => {
    const again = await authProvider.createAccount({
      email: testEmail.toUpperCase(),
      password: testPassword,
      name: 'Doublon',
    });
    expect(again).toEqual({ ok: false, reason: 'EMAIL_ALREADY_USED' });
  });

  it('createAccount renvoie INVALID_PASSWORD sans lever pour un mot de passe trop court', async () => {
    const result = await authProvider.createAccount({
      email: `short-${testEmail}`,
      password: 'court',
      name: 'Court',
    });
    expect(result).toEqual({ ok: false, reason: 'INVALID_PASSWORD' });
  });

  it('retourne null pour une requete sans session', async () => {
    const identity = await authProvider.verifySession(new Headers());
    expect(identity).toBeNull();
  });
});
