import {
  Test,
  TestingModule,
  ConfigModule,
  DatabaseService,
  envValidationSchema,
  createOrganization,
  Pool,
  sql,
  uuidv7,
} from '../../apps/api/test/isolation-test-kit';

// BUILD-004 etape 2, EA-014 / TASK-051 (ADR-0021, D1) : garanties AU NIVEAU BASE des
// tables d'inscription (migrations 0018 et 0019), avec le role applicatif reel
// cabinetos_app -- jamais un superutilisateur, qui contournerait toujours la restriction.
//
// Meme exigence que audit-append-only.spec.ts : prouver que l'operation interdite
// echoue (et que la ligne est intacte apres coup), pas seulement que l'operation
// autorisee reussit.
//
// drizzle-orm enveloppe l'erreur pg dans .cause (DrizzleQueryError) : le SQLSTATE y vit.
//   42501 insufficient_privilege, 23514 check_violation, 23505 unique_violation.

const ADMIN_DATABASE_URL = process.env.ADMIN_DATABASE_URL;

describe('registration_requests / registration_events - garanties base (TASK-051)', () => {
  let moduleRef: TestingModule;
  let databaseService: DatabaseService;
  let adminPool: Pool;
  const createdUserIds: string[] = [];
  let orgId: string;

  // Le role applicatif cree les comptes de test : users n'a pas de RLS (Identity).
  async function createUser(): Promise<string> {
    const id = uuidv7();
    await databaseService.db.execute(
      sql`INSERT INTO users (id, name, email) VALUES (${id}, 'Registration Test', ${`registration-test-${id}@example.com`})`,
    );
    createdUserIds.push(id);
    return id;
  }

  async function createRequest(userId: string): Promise<string> {
    const id = uuidv7();
    await databaseService.db.execute(
      sql`INSERT INTO registration_requests (id, user_id, first_name, last_name, specialty, structure_name, city)
          VALUES (${id}, ${userId}, 'Youssef', 'Bennani', 'generaliste', 'Cabinet Test', 'Casablanca')`,
    );
    return id;
  }

  async function readRequest(id: string) {
    const result = await databaseService.db.execute(
      sql`SELECT status, internal_note FROM registration_requests WHERE id = ${id}`,
    );
    return result.rows[0] as { status: string; internal_note: string | null } | undefined;
  }

  beforeAll(async () => {
    if (!ADMIN_DATABASE_URL) {
      throw new Error(
        'ADMIN_DATABASE_URL est requis pour ce test (nettoyage des tables d inscription, sans DELETE pour le role applicatif depuis 0019).',
      );
    }
    adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });

    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, validationSchema: envValidationSchema })],
      providers: [DatabaseService],
    }).compile();
    databaseService = moduleRef.get(DatabaseService);

    const org = await createOrganization(databaseService, {
      name: 'Registration Test Org',
      slug: `registration-test-${Date.now()}`,
    });
    orgId = org.id;
  });

  afterAll(async () => {
    // Ni DELETE sur les demandes ni sur l'historique pour cabinetos_app : le nettoyage
    // passe par le role admin, jamais par le role applicatif.
    await adminPool.query(
      `DELETE FROM registration_events WHERE registration_request_id IN
         (SELECT id FROM registration_requests WHERE user_id = ANY($1))`,
      [createdUserIds],
    );
    await adminPool.query('DELETE FROM registration_requests WHERE user_id = ANY($1)', [
      createdUserIds,
    ]);
    await adminPool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds]);
    await adminPool.query('DELETE FROM organizations WHERE id = $1', [orgId]);
    await adminPool.end();
    await databaseService.onModuleDestroy();
  });

  describe('registration_events - append-only', () => {
    let requestId: string;

    beforeAll(async () => {
      requestId = await createRequest(await createUser());
    });

    it('INSERT et SELECT reussissent avec le role applicatif', async () => {
      const id = uuidv7();
      await databaseService.db.execute(
        sql`INSERT INTO registration_events (id, registration_request_id, action)
            VALUES (${id}, ${requestId}, 'REQUEST_SUBMITTED')`,
      );
      const result = await databaseService.db.execute(
        sql`SELECT action FROM registration_events WHERE id = ${id}`,
      );
      expect(result.rows).toEqual([{ action: 'REQUEST_SUBMITTED' }]);
    });

    it('UPDATE echoue (privilege insuffisant) et la ligne reste inchangee', async () => {
      const id = uuidv7();
      await databaseService.db.execute(
        sql`INSERT INTO registration_events (id, registration_request_id, action)
            VALUES (${id}, ${requestId}, 'REQUEST_SUBMITTED')`,
      );

      await expect(
        databaseService.db.execute(
          sql`UPDATE registration_events SET action = 'VALIDATED' WHERE id = ${id}`,
        ),
      ).rejects.toMatchObject({ cause: { code: '42501' } });

      const result = await databaseService.db.execute(
        sql`SELECT action FROM registration_events WHERE id = ${id}`,
      );
      expect(result.rows).toEqual([{ action: 'REQUEST_SUBMITTED' }]);
    });

    it('DELETE echoue (privilege insuffisant) et la ligne existe toujours', async () => {
      const id = uuidv7();
      await databaseService.db.execute(
        sql`INSERT INTO registration_events (id, registration_request_id, action)
            VALUES (${id}, ${requestId}, 'REQUEST_SUBMITTED')`,
      );

      await expect(
        databaseService.db.execute(sql`DELETE FROM registration_events WHERE id = ${id}`),
      ).rejects.toMatchObject({ cause: { code: '42501' } });

      const result = await databaseService.db.execute(
        sql`SELECT id FROM registration_events WHERE id = ${id}`,
      );
      expect(result.rows).toHaveLength(1);
    });

    it('une action hors de la liste fermee est rejetee', async () => {
      await expect(
        databaseService.db.execute(
          sql`INSERT INTO registration_events (id, registration_request_id, action)
              VALUES (${uuidv7()}, ${requestId}, 'ACTION_INVENTEE')`,
        ),
      ).rejects.toMatchObject({ cause: { code: '23514' } });
    });

    it('un evenement d email nomme toujours son modele, les autres jamais', async () => {
      await expect(
        databaseService.db.execute(
          sql`INSERT INTO registration_events (id, registration_request_id, action)
              VALUES (${uuidv7()}, ${requestId}, 'EMAIL_SENT')`,
        ),
      ).rejects.toMatchObject({ cause: { code: '23514' } });

      await expect(
        databaseService.db.execute(
          sql`INSERT INTO registration_events (id, registration_request_id, action, email_template)
              VALUES (${uuidv7()}, ${requestId}, 'VALIDATED', 'account-activation')`,
        ),
      ).rejects.toMatchObject({ cause: { code: '23514' } });

      await expect(
        databaseService.db.execute(
          sql`INSERT INTO registration_events (id, registration_request_id, action, email_template)
              VALUES (${uuidv7()}, ${requestId}, 'EMAIL_SENT', 'modele-inconnu')`,
        ),
      ).rejects.toMatchObject({ cause: { code: '23514' } });

      // Controle positif : la forme valide passe.
      await databaseService.db.execute(
        sql`INSERT INTO registration_events (id, registration_request_id, action, email_template)
            VALUES (${uuidv7()}, ${requestId}, 'EMAIL_SENT', 'registration-confirmation')`,
      );
    });

    it('seul un echec d envoi dit s il est renvoyable', async () => {
      await expect(
        databaseService.db.execute(
          sql`INSERT INTO registration_events (id, registration_request_id, action, email_template)
              VALUES (${uuidv7()}, ${requestId}, 'EMAIL_FAILED', 'registration-confirmation')`,
        ),
      ).rejects.toMatchObject({ cause: { code: '23514' } });

      await expect(
        databaseService.db.execute(
          sql`INSERT INTO registration_events (id, registration_request_id, action, email_template, email_failure_retryable)
              VALUES (${uuidv7()}, ${requestId}, 'EMAIL_SENT', 'registration-confirmation', true)`,
        ),
      ).rejects.toMatchObject({ cause: { code: '23514' } });

      await databaseService.db.execute(
        sql`INSERT INTO registration_events (id, registration_request_id, action, email_template, email_failure_retryable)
            VALUES (${uuidv7()}, ${requestId}, 'EMAIL_FAILED', 'registration-confirmation', true)`,
      );
    });
  });

  describe('registration_requests', () => {
    it('INSERT, SELECT et UPDATE reussissent avec le role applicatif', async () => {
      const id = await createRequest(await createUser());
      expect((await readRequest(id))?.status).toBe('PENDING_VERIFICATION');

      await databaseService.db.execute(
        sql`UPDATE registration_requests SET internal_note = 'note equipe' WHERE id = ${id}`,
      );
      expect((await readRequest(id))?.internal_note).toBe('note equipe');
    });

    it('DELETE echoue (privilege insuffisant) et la demande existe toujours', async () => {
      const id = await createRequest(await createUser());

      await expect(
        databaseService.db.execute(sql`DELETE FROM registration_requests WHERE id = ${id}`),
      ).rejects.toMatchObject({ cause: { code: '42501' } });

      expect(await readRequest(id)).toBeDefined();
    });

    it('un statut hors des quatre valeurs est rejete', async () => {
      const id = await createRequest(await createUser());

      await expect(
        databaseService.db.execute(
          sql`UPDATE registration_requests SET status = 'SUSPENDED' WHERE id = ${id}`,
        ),
      ).rejects.toMatchObject({ cause: { code: '23514' } });

      expect((await readRequest(id))?.status).toBe('PENDING_VERIFICATION');
    });

    it('une seconde demande pour le meme compte est rejetee (une demande par fondateur)', async () => {
      const userId = await createUser();
      await createRequest(userId);

      await expect(createRequest(userId)).rejects.toMatchObject({ cause: { code: '23505' } });
    });

    it('un refus sans ses deux messages est rejete (R8)', async () => {
      const id = await createRequest(await createUser());

      await expect(
        databaseService.db.execute(
          sql`UPDATE registration_requests SET status = 'REFUSED',
                refusal_message_to_applicant = 'Message au demandeur'
              WHERE id = ${id}`,
        ),
      ).rejects.toMatchObject({ cause: { code: '23514' } });

      await expect(
        databaseService.db.execute(
          sql`UPDATE registration_requests SET status = 'REFUSED',
                refusal_internal_reason = 'Motif interne'
              WHERE id = ${id}`,
        ),
      ).rejects.toMatchObject({ cause: { code: '23514' } });

      // Controle positif : avec les deux messages, le refus passe.
      await databaseService.db.execute(
        sql`UPDATE registration_requests SET status = 'REFUSED',
              refusal_internal_reason = 'Motif interne',
              refusal_message_to_applicant = 'Message au demandeur'
            WHERE id = ${id}`,
      );
      expect((await readRequest(id))?.status).toBe('REFUSED');
    });

    it('une demande ACTIVE sans organisation est rejetee', async () => {
      const id = await createRequest(await createUser());

      await expect(
        databaseService.db.execute(
          sql`UPDATE registration_requests SET status = 'ACTIVE' WHERE id = ${id}`,
        ),
      ).rejects.toMatchObject({ cause: { code: '23514' } });

      // Controle positif : avec l'organisation creee par la cascade, ACTIVE passe.
      await databaseService.db.execute(
        sql`UPDATE registration_requests SET status = 'ACTIVE', organization_id = ${orgId}
            WHERE id = ${id}`,
      );
      expect((await readRequest(id))?.status).toBe('ACTIVE');
    });
  });
});
