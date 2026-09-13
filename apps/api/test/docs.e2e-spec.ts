import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/modules/shared/filters/http-exception.filter';

describe('OpenAPI docs (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());

    const config = new DocumentBuilder().setTitle('CabinetOS API').setVersion('0.1.0').build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/docs responds 200', async () => {
    const response = await request(app.getHttpServer()).get('/api/docs');
    expect(response.status).toBe(200);
  });

  it('GET /api/docs-json exposes the expected paths, prefixed with /api/v1', async () => {
    const response = await request(app.getHttpServer()).get('/api/docs-json');

    expect(response.status).toBe(200);
    const paths = Object.keys(response.body.paths);

    expect(paths).toEqual(
      expect.arrayContaining([
        '/api/v1/health',
        '/api/v1/identity/organizations',
        '/api/v1/identity/organizations/{organizationId}/default',
        '/api/v1/organizations',
        '/api/v1/roles',
        '/api/v1/audit-events',
        '/api/v1/notifications',
        '/api/v1/settings',
        '/api/v1/files',
      ]),
    );
  });
});
