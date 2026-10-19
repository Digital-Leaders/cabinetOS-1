import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as express from 'express';
import { toNodeHandler } from 'better-auth/node';
import { sql, TransactionRollbackError } from 'drizzle-orm';
import { Pool } from 'pg';
import { uuidv7 } from 'uuidv7';
import { AppModule } from '../../src/app.module';
import { auth, authPool } from '../../src/modules/identity/infrastructure/auth';
import { DatabaseService } from '../../src/modules/shared/database/database.service';
import { GlobalExceptionFilter } from '../../src/modules/shared/filters/http-exception.filter';
import { createOrganization, createMembership } from '../../src/modules/organization';
import { createTestAccount } from '../fixtures/test-accounts';
import { countRegistrationRequests } from '../../src/business/registration/infrastructure/admin-registration.queries';

// BUILD-004 etape 2, EA-017 / TASK-059 : l'API de l'espace admin des demandes d'inscription
// (liste, detail, note interne, historique), de bout en bout (HTTP -> garde -> base).
//
// Ce qui est prouve : seuls les administrateurs de plateforme entrent ; la liste filtre,
// cherche et pagine sans trou ni doublon ; le detail est en LECTURE SEULE (les donnees
// declarees ne bougent jamais) ; la note interne est la seule ecriture, et elle n'arrive jamais
// au fondateur ; l'historique ne contient aucun contenu.

type AdminCountsLike = { pending: number; validated: number; refused: number };

const ADMIN_DATABASE_URL = process.env.ADMIN_DATABASE_URL;
const INTERNAL_REASON = 'MOTIF-INTERNE-CONFIDENTIEL-4d2e';
const NOTE = 'NOTE-INTERNE-CONFIDENTIELLE-b81c';

describe('API admin des demandes d inscription (e2e, TASK-059)', () => {
  let app: INestApplication;
  let databaseService: DatabaseService;
  let adminPool: Pool;
  let httpServer: string;
  let adminCookie: string;
  let orgId: string;
  let roleId: string;
  const runId = Date.now();
  const emails: string[] = [];
  // Marqueur present dans le nom de structure de TOUTES les demandes de ce test : la recherche
  // isole ainsi nos lignes de tout ce que d'autres suites auraient pu laisser.
  const TAG = `Tag${runId}`;

  interface Seed {
    label: string;
    firstName?: string;
    lastName?: string;
    structure?: string;
    city?: string;
    specialty?: string;
    inpe?: string | null;
    numeroOrdre?: string | null;
    address?: string | null;
    status?: 'PENDING_VERIFICATION' | 'COMPLEMENT_REQUESTED' | 'ACTIVE' | 'REFUSED';
    createdAt?: string;
  }

  /** Cree une vraie demande (compte + demande) via l'inscription, puis fixe statut et date. */
  async function seed(input: Seed) {
    const email = `adminapi-${input.label}-${runId}@example.com`;
    emails.push(email);
    const res = await fetch(`${httpServer}/api/v1/registration-requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: input.firstName ?? 'Youssef',
        lastName: input.lastName ?? 'Bennani',
        email,
        password: 'password1234',
        specialty: input.specialty ?? 'pediatrie',
        structureName: `${input.structure ?? 'Cabinet'} ${TAG}`,
        city: input.city ?? 'Rabat',
        ...(input.inpe ? { inpe: input.inpe } : {}),
        ...(input.numeroOrdre ? { numeroOrdre: input.numeroOrdre } : {}),
        ...(input.address ? { address: input.address } : {}),
      }),
    });
    expect(res.status).toBe(201);
    const { data } = await res.json();
    const id = data.id as string;

    const status = input.status ?? 'PENDING_VERIFICATION';
    if (status === 'ACTIVE') {
      await databaseService.db.execute(
        sql`UPDATE registration_requests SET status = 'ACTIVE', organization_id = ${orgId} WHERE id = ${id}`,
      );
    } else if (status === 'REFUSED') {
      await databaseService.db.execute(sql`
        UPDATE registration_requests SET status = 'REFUSED',
          refusal_internal_reason = ${INTERNAL_REASON}, refusal_message_to_applicant = 'Message au demandeur'
        WHERE id = ${id}`);
    } else if (status === 'COMPLEMENT_REQUESTED') {
      await databaseService.db.execute(sql`
        UPDATE registration_requests SET status = 'COMPLEMENT_REQUESTED',
          complement_requested_info = 'le lien de votre fiche Google', complement_message = 'Merci de nous envoyer le lien.'
        WHERE id = ${id}`);
    }
    if (input.createdAt) {
      await databaseService.db.execute(
        sql`UPDATE registration_requests SET created_at = ${input.createdAt}::timestamp WHERE id = ${id}`,
      );
    }
    return { id, email };
  }

  const get = (path: string, cookie = adminCookie) =>
    fetch(`${httpServer}/api/v1${path}`, { headers: { Cookie: cookie } });
  const listOf = async (query: string) => {
    const res = await get(`/admin/registration-requests?${query}`);
    expect(res.status).toBe(200);
    return res.json() as Promise<{
      data: Record<string, unknown>[];
      meta: {
        nextCursor: string | null;
        counts: { pending: number; validated: number; refused: number };
      };
    }>;
  };

  beforeAll(async () => {
    if (!ADMIN_DATABASE_URL) throw new Error('ADMIN_DATABASE_URL est requis.');
    adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication({ bodyParser: false });
    databaseService = app.get(DatabaseService);
    const expressApp = app.getHttpAdapter().getInstance();
    expressApp.all('/api/v1/auth/{*splat}', toNodeHandler(auth));
    app.use(express.json());
    app.setGlobalPrefix('api/v1', { exclude: ['api/v1/auth/{*splat}'] });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
    await app.listen(0);
    httpServer = `http://127.0.0.1:${app.getHttpServer().address().port}`;

    const org = await createOrganization(databaseService, {
      name: 'Admin API Test Org',
      slug: `admin-api-test-${runId}`,
    });
    orgId = org.id;
    roleId = uuidv7();
    await databaseService.db.execute(
      sql`INSERT INTO roles (id, name) VALUES (${roleId}, ${'AdminApiRole-' + runId})`,
    );

    const adminEmail = `adminapi-admin-${runId}@example.com`;
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
    adminCookie = admin.cookie;
  });

  afterAll(async () => {
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
    await adminPool.query('DELETE FROM memberships WHERE organization_id = $1', [orgId]);
    await adminPool.query('DELETE FROM users WHERE email = ANY($1)', [emails]);
    await adminPool.query('DELETE FROM organizations WHERE id = $1', [orgId]);
    await adminPool.query('DELETE FROM roles WHERE id = $1', [roleId]);
    await adminPool.end();
    await authPool.end();
    await app.close();
  });

  // -----------------------------------------------------------------------------------
  describe('acces : reserve a l equipe, sur CHAQUE route', () => {
    let someId: string;
    beforeAll(async () => {
      someId = (await seed({ label: 'acces' })).id;
    });

    const routes: [string, string, string?][] = [
      ['liste', 'GET', '/admin/registration-requests'],
      ['detail', 'GET', '/admin/registration-requests/{id}'],
      ['note interne', 'PUT', '/admin/registration-requests/{id}/internal-note'],
    ];
    const hit = (method: string, path: string, cookie?: string) =>
      fetch(`${httpServer}/api/v1${path.replace('{id}', someId)}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
        body: method === 'PUT' ? JSON.stringify({ internalNote: 'x' }) : undefined,
      });

    it.each(routes)('%s : 401 sans session', async (_label, method, path) => {
      expect((await hit(method, path!)).status).toBe(401);
    });

    it.each(routes)(
      '%s : 403 pour un membre d organisation avec toutes les permissions de donnees',
      async (_label, method, path) => {
        const email = `adminapi-member-${_label.replace(/\s/g, '')}-${runId}@example.com`;
        emails.push(email);
        const member = await createTestAccount({
          email,
          password: 'equipe-mdp-1234',
          name: 'Membre',
        });
        await createMembership(databaseService, orgId, { userId: member.userId, roleId });
        expect((await hit(method, path!, member.cookie)).status).toBe(403);
      },
    );

    it.each(routes)(
      '%s : 403 pour un fondateur dont la demande est en verification',
      async (_label, method, path) => {
        const founder = await seed({ label: `fondateur-${_label.replace(/\s/g, '')}` });
        const signIn = await fetch(`${httpServer}/api/v1/auth/sign-in/email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3001' },
          body: JSON.stringify({ email: founder.email, password: 'password1234' }),
        });
        const cookie = (signIn.headers.get('set-cookie') as string).split(';')[0];
        expect((await hit(method, path!, cookie)).status).toBe(403);
      },
    );

    it.each(routes)('%s : 200 pour un administrateur', async (_label, method, path) => {
      expect((await hit(method, path!, adminCookie)).status).toBe(200);
    });

    it('administrateur REVOQUE : 403 sur la liste', async () => {
      const email = `adminapi-revoked-${runId}@example.com`;
      emails.push(email);
      const revoked = await createTestAccount({
        email,
        password: 'equipe-mdp-1234',
        name: 'Revoque',
      });
      await adminPool.query(
        `INSERT INTO platform_admins (user_id, granted_by, reason, revoked_at) VALUES ($1, 'Test', 'test', now())`,
        [revoked.userId],
      );
      expect((await hit('GET', '/admin/registration-requests', revoked.cookie)).status).toBe(403);
    });
  });

  // -----------------------------------------------------------------------------------
  describe('liste : filtres (brief §5.3)', () => {
    const ids: Record<string, string> = {};
    beforeAll(async () => {
      ids.pending = (await seed({ label: 'f-pending', lastName: 'Verif' })).id;
      ids.complement = (
        await seed({ label: 'f-compl', lastName: 'Compl', status: 'COMPLEMENT_REQUESTED' })
      ).id;
      ids.active = (await seed({ label: 'f-active', lastName: 'Active', status: 'ACTIVE' })).id;
      ids.refused = (await seed({ label: 'f-refused', lastName: 'Refuse', status: 'REFUSED' })).id;
    });

    const idsOf = async (query: string) =>
      (await listOf(`q=${TAG}&limit=50&${query}`)).data.map((r) => r.id as string);

    it('par defaut : « A traiter » = en verification ET complement demande, rien d autre', async () => {
      const found = await idsOf('');
      expect(found).toEqual(expect.arrayContaining([ids.pending, ids.complement]));
      expect(found).not.toContain(ids.active);
      expect(found).not.toContain(ids.refused);
    });

    it('filter=validated : uniquement les demandes ACTIVE', async () => {
      const found = await idsOf('filter=validated');
      expect(found).toContain(ids.active);
      expect(found).not.toContain(ids.pending);
      expect(found).not.toContain(ids.refused);
    });

    it('filter=refused : uniquement les demandes refusees', async () => {
      const found = await idsOf('filter=refused');
      expect(found).toContain(ids.refused);
      expect(found).not.toContain(ids.active);
    });

    it('chaque demande apparait dans UN onglet et un seul', async () => {
      const [a, b, c] = await Promise.all([
        idsOf(''),
        idsOf('filter=validated'),
        idsOf('filter=refused'),
      ]);
      const all = [...a, ...b, ...c];
      expect(new Set(all).size).toBe(all.length);
      expect(all).toEqual(expect.arrayContaining(Object.values(ids)));
    });

    it('filtre inconnu : 400', async () => {
      expect((await get('/admin/registration-requests?filter=tout')).status).toBe(400);
    });

    it('les compteurs des trois onglets suivent les demandes (badge « A traiter 3 »)', async () => {
      // Les compteurs portent sur TOUTE la table. Or d'autres fichiers de tests, lances EN
      // PARALLELE sur la meme base (la CI n'utilise pas --runInBand), y ajoutent et y retirent
      // des lignes pendant ce test : un « avant / apres » mesure en dehors d'une transaction
      // serait faux au hasard du calendrier. On mesure donc dans une transaction REPEATABLE READ :
      // son instantane est fige a la premiere lecture, et le delta est EXACTEMENT ce qu'on y
      // insere, quoi que fassent les autres. La transaction est annulee : rien ne subsiste.
      const insertRequest = (
        tx: Parameters<Parameters<typeof databaseService.db.transaction>[0]>[0],
        label: string,
        columns: ReturnType<typeof sql>,
        values: ReturnType<typeof sql>,
      ) => {
        const userId = uuidv7();
        return tx
          .execute(
            sql`INSERT INTO users (id, name, email) VALUES (${userId}, 'Compteur', ${`count-${label}-${uuidv7()}@example.com`})`,
          )
          .then(() =>
            tx.execute(sql`INSERT INTO registration_requests
              (id, user_id, first_name, last_name, specialty, structure_name, city, status, ${columns})
              VALUES (${uuidv7()}, ${userId}, 'A', 'B', 'generaliste', 'C', 'Rabat', ${values})`),
          );
      };

      let measured: { before: AdminCountsLike; after: AdminCountsLike } | undefined;
      await databaseService.db
        .transaction(
          async (tx) => {
            const before = await countRegistrationRequests(tx as never);
            // 2 « a traiter » (verification + complement), 1 validee, 1 refusee.
            await insertRequest(tx, 'a', sql`organization_id`, sql`'PENDING_VERIFICATION', NULL`);
            await insertRequest(
              tx,
              'b',
              sql`complement_requested_info, complement_message`,
              sql`'COMPLEMENT_REQUESTED', 'info', 'msg'`,
            );
            await insertRequest(tx, 'c', sql`organization_id`, sql`'ACTIVE', ${orgId}`);
            await insertRequest(
              tx,
              'd',
              sql`refusal_internal_reason, refusal_message_to_applicant`,
              sql`'REFUSED', 'motif', 'message'`,
            );
            measured = { before, after: await countRegistrationRequests(tx as never) };
            tx.rollback();
          },
          { isolationLevel: 'repeatable read' },
        )
        .catch((error) => {
          if (!(error instanceof TransactionRollbackError)) throw error;
        });

      expect(measured).toBeDefined();
      const { before, after } = measured!;
      expect(after.pending - before.pending).toBe(2);
      expect(after.validated - before.validated).toBe(1);
      expect(after.refused - before.refused).toBe(1);
    });

    it('les compteurs ignorent le filtre et la recherche courants', async () => {
      // Borne basse, robuste a la concurrence : ma propre demande « a traiter » existe pendant tout
      // le test, donc le compteur « A traiter » vaut au moins 1 -- meme quand le filtre (refusees)
      // et la recherche (rien ne correspond) vident la liste. S'ils filtraient aussi les
      // compteurs, celui-ci vaudrait 0.
      await seed({ label: 'count-independent' });
      const page = await listOf(`filter=refused&q=introuvable${runId}&limit=1`);
      expect(page.data).toEqual([]);
      expect(page.meta.counts.pending).toBeGreaterThanOrEqual(1);
    });
  });

  // -----------------------------------------------------------------------------------
  describe('liste : contenu d une ligne (brief §5.3)', () => {
    it('Dr nom, specialite, cabinet, ville, date, statut -- et RIEN de plus', async () => {
      const { id } = await seed({
        label: 'ligne',
        firstName: 'Salma',
        lastName: 'Tazi',
        structure: 'Centre medical Ranya',
        city: 'Rabat',
        specialty: 'pediatrie',
        inpe: '123456789',
        address: 'Rue secrete 12',
        status: 'COMPLEMENT_REQUESTED',
      });
      const res = await get(`/admin/registration-requests?q=${TAG}&limit=50`);
      const raw = await res.text();
      const row = (JSON.parse(raw).data as Record<string, unknown>[]).find((r) => r.id === id)!;

      expect(Object.keys(row).sort()).toEqual(
        [
          'city',
          'createdAt',
          'firstName',
          'id',
          'lastName',
          'specialty',
          'status',
          'structureName',
        ].sort(),
      );
      expect(row).toMatchObject({
        firstName: 'Salma',
        lastName: 'Tazi',
        specialty: 'pediatrie',
        city: 'Rabat',
        status: 'COMPLEMENT_REQUESTED',
        structureName: `Centre medical Ranya ${TAG}`,
      });
      // Ni email, ni adresse, ni INPE, ni note, ni motif : la liste ne les porte pas.
      expect(raw).not.toContain('Rue secrete');
      expect(raw).not.toContain('123456789');
      expect(raw).not.toContain('@example.com');
    });
  });

  // -----------------------------------------------------------------------------------
  describe('liste : recherche par nom ou cabinet', () => {
    beforeAll(async () => {
      await seed({
        label: 's-1',
        firstName: 'Élodie',
        lastName: 'Marchand',
        structure: 'Clinique des Lilas',
      });
      await seed({
        label: 's-2',
        firstName: 'Omar',
        lastName: 'Fikri',
        structure: 'Clinique Al Andalous',
      });
    });
    const found = async (q: string) =>
      (await listOf(`q=${encodeURIComponent(q)}&limit=50`)).data.map(
        (r) => `${r.firstName} ${r.lastName}`,
      );

    it('par nom de famille', async () => {
      expect(await found(`Fikri ${TAG}`)).toEqual(['Omar Fikri']);
    });

    it('par cabinet', async () => {
      expect(await found(`Lilas ${TAG}`)).toEqual(['Élodie Marchand']);
    });

    it('l ordre des mots n a aucune importance', async () => {
      expect(await found(`Marchand Élodie ${TAG}`)).toEqual(['Élodie Marchand']);
    });

    it('sans accents ni casse : « elodie » trouve « Élodie »', async () => {
      expect(await found(`ELODIE ${TAG}`)).toEqual(['Élodie Marchand']);
    });

    it('partielle : « fik » trouve « Fikri »', async () => {
      expect(await found(`fik ${TAG}`)).toEqual(['Omar Fikri']);
    });

    it('tous les mots doivent se retrouver : « Fikri Marchand » ne trouve personne', async () => {
      expect(await found(`Fikri Marchand ${TAG}`)).toEqual([]);
    });

    it('aucun resultat : liste vide, pas d erreur', async () => {
      const page = await listOf(`q=introuvable${runId}`);
      expect(page.data).toEqual([]);
      expect(page.meta.nextCursor).toBeNull();
    });

    it('« % » et « _ » sont des caracteres ordinaires, jamais des jokers', async () => {
      expect((await listOf(`q=${encodeURIComponent('%')}&filter=pending`)).data).toEqual([]);
      expect((await listOf(`q=${encodeURIComponent('_')}&filter=pending`)).data).toEqual([]);
      expect((await listOf(`q=${encodeURIComponent(`${TAG} %`)}&limit=50`)).data).toEqual([]);
    });

    it('une apostrophe ou un guillemet ne casse rien (valeurs toujours parametrees)', async () => {
      const res = await get(
        `/admin/registration-requests?q=${encodeURIComponent(`'; DROP TABLE users;--`)}`,
      );
      expect(res.status).toBe(200);
      expect((await res.json()).data).toEqual([]);
      expect(
        (await adminPool.query('SELECT count(*)::int AS n FROM users')).rows[0].n,
      ).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------------------
  describe('liste : pagination par curseur (ADR-0008), sans trou ni doublon', () => {
    const ordered: string[] = [];
    beforeAll(async () => {
      // Cinq demandes aux dates distinctes, creees dans le DESORDRE.
      const dates = ['2026-03-05', '2026-03-01', '2026-03-04', '2026-03-02', '2026-03-03'];
      const created: Record<string, string> = {};
      for (const [i, date] of dates.entries()) {
        const { id } = await seed({
          label: `p-${i}`,
          structure: 'Pagination',
          lastName: `Page${i}`,
          createdAt: `${date} 10:00:00.000001`,
        });
        created[date] = id;
      }
      ordered.push(
        ...Object.keys(created)
          .sort()
          .map((d) => created[d]),
      );
    });

    async function walk(query: string, limit: number) {
      const pages: string[][] = [];
      let cursor: string | null = null;
      for (let guard = 0; guard < 20; guard++) {
        const page = await listOf(
          `q=Pagination%20${TAG}&limit=${limit}${cursor ? `&cursor=${cursor}` : ''}&${query}`,
        );
        pages.push(page.data.map((r) => r.id as string));
        cursor = page.meta.nextCursor;
        if (!cursor) break;
      }
      return pages;
    }

    it('« A traiter » : de la plus ancienne a la plus recente, pages de 2, 2 puis 1', async () => {
      const pages = await walk('', 2);
      expect(pages.map((p) => p.length)).toEqual([2, 2, 1]);
      expect(pages.flat()).toEqual(ordered);
    });

    it('onglets clos : du plus recent au plus ancien', async () => {
      await adminPool.query(
        `UPDATE registration_requests SET status = 'ACTIVE', organization_id = $1 WHERE id = ANY($2)`,
        [orgId, ordered],
      );
      const pages = await walk('filter=validated', 2);
      expect(pages.flat()).toEqual([...ordered].reverse());
      await adminPool.query(
        `UPDATE registration_requests SET status = 'PENDING_VERIFICATION', organization_id = NULL WHERE id = ANY($1)`,
        [ordered],
      );
    });

    it('la derniere page n a pas de curseur suivant', async () => {
      const pages = await listOf(`q=Pagination%20${TAG}&limit=50`);
      expect(pages.meta.nextCursor).toBeNull();
    });

    it('un nombre de lignes egal a la taille de page ne fabrique pas de page vide', async () => {
      const page = await listOf(`q=Pagination%20${TAG}&limit=5`);
      expect(page.data).toHaveLength(5);
      expect(page.meta.nextCursor).toBeNull();
    });

    it('demandes creees a la MEME microseconde : aucun trou ni doublon (departage par identifiant)', async () => {
      const tied: string[] = [];
      for (let i = 0; i < 4; i++) {
        const { id } = await seed({
          label: `tie-${i}`,
          structure: 'Egalite',
          lastName: `Egal${i}`,
          createdAt: '2026-04-01 09:00:00.123456',
        });
        tied.push(id);
      }
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let guard = 0; guard < 10; guard++) {
        const page = await listOf(`q=Egalite%20${TAG}&limit=1${cursor ? `&cursor=${cursor}` : ''}`);
        seen.push(...page.data.map((r) => r.id as string));
        cursor = page.meta.nextCursor;
        if (!cursor) break;
      }
      expect(seen).toHaveLength(4);
      expect(new Set(seen)).toEqual(new Set(tied));
    });

    it('une demande creee PENDANT la lecture n abime pas les pages deja lues', async () => {
      const first = await listOf(`q=Pagination%20${TAG}&limit=2`);
      await seed({
        label: 'p-late',
        structure: 'Pagination',
        lastName: 'Tardive',
        createdAt: '2026-05-01 10:00:00',
      });
      const rest = await listOf(`q=Pagination%20${TAG}&limit=50&cursor=${first.meta.nextCursor}`);
      const all = [...first.data, ...rest.data].map((r) => r.id as string);
      expect(new Set(all).size).toBe(all.length);
      expect(all.slice(0, 5)).toEqual(ordered);
    });

    it.each([
      ['curseur invalide', 'cursor=pas-un-curseur'],
      ['limite nulle', 'limit=0'],
      ['limite trop grande', 'limit=51'],
      ['limite non numerique', 'limit=abc'],
      ['limite decimale', 'limit=2.5'],
    ])('%s : 400', async (_label, query) => {
      expect((await get(`/admin/registration-requests?${query}`)).status).toBe(400);
    });
  });

  // -----------------------------------------------------------------------------------
  describe('detail en LECTURE SEULE (brief §5.4)', () => {
    it('affiche exactement ce que le medecin a declare, email en clair', async () => {
      const { id, email } = await seed({
        label: 'detail',
        firstName: 'Youssef',
        lastName: 'Bennani',
        specialty: 'cardiologie',
        inpe: '123456789',
        structure: 'Cabinet Dr Bennani',
        city: 'Casablanca',
        address: 'Rue Ibn Sina, Maarif',
      });
      const res = await get(`/admin/registration-requests/${id}`);
      expect(res.status).toBe(200);
      const { data } = await res.json();

      expect(data).toMatchObject({
        id,
        status: 'PENDING_VERIFICATION',
        doctor: {
          firstName: 'Youssef',
          lastName: 'Bennani',
          email,
          specialty: 'cardiologie',
          inpe: '123456789',
          numeroOrdre: null,
        },
        structure: {
          name: `Cabinet Dr Bennani ${TAG}`,
          city: 'Casablanca',
          address: 'Rue Ibn Sina, Maarif',
        },
        internalNote: null,
        complement: null,
        refusal: null,
        organizationId: null,
      });
      expect(typeof data.createdAt).toBe('string');
    });

    it('champs facultatifs absents : null, que l ecran affichera « non renseigne »', async () => {
      const { id } = await seed({ label: 'detail-minimal' });
      const { data } = await (await get(`/admin/registration-requests/${id}`)).json();
      expect(data.doctor.inpe).toBeNull();
      expect(data.doctor.numeroOrdre).toBeNull();
      expect(data.structure.address).toBeNull();
    });

    it('complement demande : le dernier message sortant est visible de l equipe', async () => {
      const { id } = await seed({ label: 'detail-compl', status: 'COMPLEMENT_REQUESTED' });
      const { data } = await (await get(`/admin/registration-requests/${id}`)).json();
      expect(data.complement).toEqual({
        requestedInfo: 'le lien de votre fiche Google',
        message: 'Merci de nous envoyer le lien.',
      });
      expect(data.refusal).toBeNull();
    });

    it('refusee : l equipe voit le motif interne ET le message au demandeur', async () => {
      const { id } = await seed({ label: 'detail-refus', status: 'REFUSED' });
      const { data } = await (await get(`/admin/registration-requests/${id}`)).json();
      expect(data.refusal).toEqual({
        internalReason: INTERNAL_REASON,
        messageToApplicant: 'Message au demandeur',
      });
      expect(data.complement).toBeNull();
    });

    it('validee : l organisation creee est indiquee', async () => {
      const { id } = await seed({ label: 'detail-active', status: 'ACTIVE' });
      const { data } = await (await get(`/admin/registration-requests/${id}`)).json();
      expect(data.status).toBe('ACTIVE');
      expect(data.organizationId).toBe(orgId);
    });

    it('identifiant inconnu : 404 ; identifiant mal forme : 400, jamais une erreur de base', async () => {
      expect((await get(`/admin/registration-requests/${uuidv7()}`)).status).toBe(404);
      expect((await get('/admin/registration-requests/pas-un-uuid')).status).toBe(400);
      expect((await get("/admin/registration-requests/1'; DROP TABLE users;--")).status).toBe(400);
    });

    it('AUCUNE route ne permet de modifier les donnees declarees : PATCH, PUT, POST, DELETE sur la demande', async () => {
      const { id } = await seed({ label: 'readonly', firstName: 'Intact', lastName: 'Intact' });
      const before = (await (await get(`/admin/registration-requests/${id}`)).json()).data;

      for (const method of ['PATCH', 'PUT', 'POST', 'DELETE']) {
        const res = await fetch(`${httpServer}/api/v1/admin/registration-requests/${id}`, {
          method,
          headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
          body:
            method === 'DELETE'
              ? undefined
              : JSON.stringify({ firstName: 'Pirate', status: 'ACTIVE' }),
        });
        expect({ method, ok: res.ok }).toEqual({ method, ok: false });
      }
      const after = (await (await get(`/admin/registration-requests/${id}`)).json()).data;
      expect(after).toEqual(before);
    });
  });

  // -----------------------------------------------------------------------------------
  describe('note interne : la seule ecriture', () => {
    const put = (id: string, body: unknown, cookie = adminCookie) =>
      fetch(`${httpServer}/api/v1/admin/registration-requests/${id}/internal-note`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify(body),
      });
    const noteOf = async (id: string) =>
      (await (await get(`/admin/registration-requests/${id}`)).json()).data.internalNote;

    it('enregistre, relue au detail, puis remplacee', async () => {
      const { id } = await seed({ label: 'note-1' });
      expect((await put(id, { internalNote: 'Fiche Google concordante.' })).status).toBe(200);
      expect(await noteOf(id)).toBe('Fiche Google concordante.');
      await put(id, { internalNote: 'Finalement, a revoir.' });
      expect(await noteOf(id)).toBe('Finalement, a revoir.');
    });

    it('vide, blanche ou null : efface la note (elle est facultative)', async () => {
      const { id } = await seed({ label: 'note-2' });
      for (const empty of ['', '   ', null]) {
        await put(id, { internalNote: 'a effacer' });
        const res = await put(id, { internalNote: empty });
        expect((await res.json()).data.internalNote).toBeNull();
        expect(await noteOf(id)).toBeNull();
      }
    });

    it('espaces autour retires', async () => {
      const { id } = await seed({ label: 'note-3' });
      await put(id, { internalNote: '   propre   ' });
      expect(await noteOf(id)).toBe('propre');
    });

    it('2000 caracteres acceptes, 2001 refuses', async () => {
      const { id } = await seed({ label: 'note-4' });
      expect((await put(id, { internalNote: 'a'.repeat(2000) })).status).toBe(200);
      expect((await put(id, { internalNote: 'a'.repeat(2001) })).status).toBe(400);
    });

    it('n ecrit QUE la note : statut, donnees declarees, historique inchanges meme si on en envoie d autres', async () => {
      const { id } = await seed({ label: 'note-5', firstName: 'Fidele', lastName: 'Fidele' });
      const before = (await (await get(`/admin/registration-requests/${id}`)).json()).data;

      const res = await put(id, {
        internalNote: NOTE,
        firstName: 'Pirate',
        status: 'ACTIVE',
        organizationId: orgId,
        refusalMessageToApplicant: 'vol',
      });
      expect(res.status).toBe(200);

      const after = (await (await get(`/admin/registration-requests/${id}`)).json()).data;
      expect(after).toEqual({ ...before, internalNote: NOTE, updatedAt: after.updatedAt });
      expect(after.doctor.firstName).toBe('Fidele');
      expect(after.status).toBe('PENDING_VERIFICATION');
      expect(after.history).toEqual(before.history);
    });

    it('demande inconnue : 404 ; identifiant mal forme : 400', async () => {
      expect((await put(uuidv7(), { internalNote: 'x' })).status).toBe(404);
      expect((await put('pas-un-uuid', { internalNote: 'x' })).status).toBe(400);
    });

    it('JAMAIS communiquee au medecin : absente de son statut, et aucun email n est envoye', async () => {
      const { id, email } = await seed({ label: 'note-secret' });
      await put(id, { internalNote: NOTE });

      const signIn = await fetch(`${httpServer}/api/v1/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3001' },
        body: JSON.stringify({ email, password: 'password1234' }),
      });
      const founderCookie = (signIn.headers.get('set-cookie') as string).split(';')[0];
      const statusRaw = await (await get('/identity/registration-status', founderCookie)).text();
      expect(statusRaw).not.toContain(NOTE);
      expect(statusRaw).not.toContain('internalNote');
    });
  });

  // -----------------------------------------------------------------------------------
  describe('historique (date, action, admin)', () => {
    it('chronologique, avec le modele d email -- et AUCUN contenu', async () => {
      const { id } = await seed({ label: 'histo' });
      const { data } = await (await get(`/admin/registration-requests/${id}`)).json();

      expect(data.history.map((h: { action: string }) => h.action)).toEqual([
        'REQUEST_SUBMITTED',
        'EMAIL_SENT',
      ]);
      expect(data.history[1]).toMatchObject({
        action: 'EMAIL_SENT',
        emailTemplate: 'registration-confirmation',
        emailFailureRetryable: null,
        actor: null,
      });
      const dates = data.history.map((h: { createdAt: string }) => Date.parse(h.createdAt));
      expect([...dates].sort((a, b) => a - b)).toEqual(dates);
      // Aucune colonne de contenu (ADR-0022).
      for (const entry of data.history) {
        expect(Object.keys(entry).sort()).toEqual(
          ['action', 'actor', 'createdAt', 'emailFailureRetryable', 'emailTemplate', 'id'].sort(),
        );
      }
    });

    it('echec d envoi : visible et marque renvoyable', async () => {
      const { id } = await seed({ label: 'histo-fail' });
      await adminPool.query(
        `INSERT INTO registration_events (id, registration_request_id, action, email_template, email_failure_retryable)
         VALUES ($1, $2, 'EMAIL_FAILED', 'registration-confirmation', true)`,
        [uuidv7(), id],
      );
      const { data } = await (await get(`/admin/registration-requests/${id}`)).json();
      expect(data.history).toContainEqual(
        expect.objectContaining({ action: 'EMAIL_FAILED', emailFailureRetryable: true }),
      );
    });

    it('une action d administrateur porte son nom (pas son email)', async () => {
      const { id } = await seed({ label: 'histo-actor' });
      const adminId = (
        await adminPool.query('SELECT id FROM users WHERE email = $1', [
          `adminapi-admin-${runId}@example.com`,
        ])
      ).rows[0].id as string;
      await adminPool.query(
        `INSERT INTO registration_events (id, registration_request_id, action, actor_user_id)
         VALUES ($1, $2, 'RETURNED_TO_VERIFICATION', $3)`,
        [uuidv7(), id, adminId],
      );
      const raw = await (await get(`/admin/registration-requests/${id}`)).text();
      const entry = JSON.parse(raw).data.history.find(
        (h: { action: string }) => h.action === 'RETURNED_TO_VERIFICATION',
      );
      expect(entry.actor).toEqual({ id: adminId, name: 'Zineb Admin' });
      expect(raw).not.toContain(`adminapi-admin-${runId}@example.com`);
    });
  });

  // -----------------------------------------------------------------------------------
  describe('horodatages : ISO 8601 en UTC, quel que soit le fuseau du serveur (ADR-0008)', () => {
    const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

    /** Instant « vrai » : la colonne timestamp est ecrite en UTC, on la relit comme telle. */
    async function expectedUtc(id: string, column: 'created_at' | 'updated_at') {
      const r = await adminPool.query(
        `SELECT to_char(${column}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS iso FROM registration_requests WHERE id = $1`,
        [id],
      );
      return r.rows[0].iso as string;
    }

    it('la suite tourne bien dans un fuseau non UTC (sinon ce test ne prouverait rien)', () => {
      expect(new Date('2026-01-15T12:00:00Z').getTimezoneOffset()).not.toBe(0);
    });

    it('liste et detail : createdAt est un ISO UTC qui correspond exactement a la base', async () => {
      const { id } = await seed({
        label: 'iso-1',
        structure: 'Horodatage',
        createdAt: '2026-03-10 08:15:30.123456',
      });
      const list = await listOf(`q=Horodatage%20${TAG}`);
      const row = list.data.find((r) => r.id === id)!;
      expect(row.createdAt).toMatch(ISO_UTC);
      expect(row.createdAt).toBe('2026-03-10T08:15:30.123Z');
      expect(row.createdAt).toBe(await expectedUtc(id, 'created_at'));

      const { data } = await (await get(`/admin/registration-requests/${id}`)).json();
      expect(data.createdAt).toBe('2026-03-10T08:15:30.123Z');
      expect(data.updatedAt).toMatch(ISO_UTC);
      expect(data.updatedAt).toBe(await expectedUtc(id, 'updated_at'));
    });

    it('historique : chaque date est un ISO UTC proche de maintenant', async () => {
      const { id } = await seed({ label: 'iso-2' });
      const { data } = await (await get(`/admin/registration-requests/${id}`)).json();
      for (const entry of data.history) {
        expect(entry.createdAt).toMatch(ISO_UTC);
        expect(Math.abs(Date.now() - Date.parse(entry.createdAt))).toBeLessThan(60_000);
      }
    });

    it('note interne : updatedAt est un ISO UTC proche de maintenant', async () => {
      const { id } = await seed({ label: 'iso-3' });
      const res = await fetch(
        `${httpServer}/api/v1/admin/registration-requests/${id}/internal-note`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
          body: JSON.stringify({ internalNote: 'horodatage' }),
        },
      );
      const { data } = await res.json();
      expect(data.updatedAt).toMatch(ISO_UTC);
      expect(Math.abs(Date.now() - Date.parse(data.updatedAt))).toBeLessThan(60_000);
    });
  });
});
