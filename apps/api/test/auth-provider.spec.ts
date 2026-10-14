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
  let httpServer: string;
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
    await app.listen(0);
    const address = app.getHttpServer().address();
    httpServer = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    const databaseService = app.get(DatabaseService);
    await databaseService.db.execute(sql`DELETE FROM users WHERE email = ${testEmail}`);
    await authPool.end();
    await app.close();
  });

  it('resout l identite a partir d une session valide', async () => {
    const signUpRes = await fetch(`${httpServer}/api/v1/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3001' },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
        name: 'Auth Provider Test',
      }),
    });
    const setCookie = signUpRes.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();

    const headers = new Headers();
    headers.set('cookie', (setCookie as string).split(';')[0]);

    const identity = await authProvider.verifySession(headers);
    expect(identity).not.toBeNull();
    expect(identity?.email).toBe(testEmail);
    expect(identity?.userId).toBeDefined();
  });

  it('retourne null pour une requete sans session', async () => {
    const identity = await authProvider.verifySession(new Headers());
    expect(identity).toBeNull();
  });
});
