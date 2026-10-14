import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { sql } from 'drizzle-orm';
import { toNodeHandler } from 'better-auth/node';
import * as express from 'express';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/modules/shared/filters/http-exception.filter';
import { auth, authPool } from '../src/modules/identity/infrastructure/auth';
import { DatabaseService } from '../src/modules/shared/database/database.service';

// TASK-013 : parcours e2e inscription -> connexion -> deconnexion, via les vrais
// endpoints Better-Auth (/sign-up/email, /sign-in/email, /sign-out -- noms imposes
// par Better-Auth lui-meme, cf. ADR-007 : on utilise son implementation telle quelle).

describe('Authentification Better-Auth (e2e, TASK-013)', () => {
  let app: INestApplication;
  const testEmail = `e2e-auth-test-${Date.now()}@example.com`;
  const testPassword = 'password1234';
  const origin = 'http://localhost:3001';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ bodyParser: false });

    const expressApp = app.getHttpAdapter().getInstance();
    expressApp.all('/api/v1/auth/{*splat}', toNodeHandler(auth));

    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    app.setGlobalPrefix('api/v1', { exclude: ['api/v1/auth/{*splat}'] });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());

    await app.init();
  });

  afterAll(async () => {
    const databaseService = app.get(DatabaseService);
    await databaseService.db.execute(sql`DELETE FROM users WHERE email = ${testEmail}`);
    await authPool.end();
    await app.close();
  });

  it("un utilisateur peut s'inscrire (sign-up/email)", async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-up/email')
      .set('Origin', origin)
      .send({ email: testEmail, password: testPassword, name: 'E2E Test User' });

    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe(testEmail);
    expect(response.body.token).toBeDefined();
  });

  it('le mot de passe est hache en base, jamais stocke en clair', async () => {
    const databaseService = app.get(DatabaseService);
    const result = await databaseService.db.execute(
      sql`SELECT password FROM accounts a JOIN users u ON u.id = a.user_id WHERE u.email = ${testEmail}`,
    );
    const storedPassword = (result.rows[0] as { password: string }).password;
    expect(storedPassword).not.toBe(testPassword);
    expect(storedPassword.length).toBeGreaterThan(testPassword.length);
  });

  let sessionCookie: string;

  it('un utilisateur cree peut se connecter et recevoir une session valide (sign-in/email)', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-in/email')
      .set('Origin', origin)
      .send({ email: testEmail, password: testPassword });

    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe(testEmail);
    expect(response.body.token).toBeDefined();

    const setCookie = response.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    sessionCookie = (setCookie as unknown as string[])[0];
  });

  it('rejette une connexion avec un mauvais mot de passe', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-in/email')
      .set('Origin', origin)
      .send({ email: testEmail, password: 'wrong-password' });

    expect(response.status).toBe(401);
  });

  it('un utilisateur connecte peut se deconnecter (sign-out)', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-out')
      .set('Origin', origin)
      .set('Cookie', sessionCookie);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });
});
