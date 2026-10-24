import { REGISTRATION_CITIES } from '../../src/business/registration';
import { bootValidationHarness, ValidationHarness } from '../fixtures/validation-harness';

// BUILD-004 etape 2, EA-018 / TASK-067 (brief R5, « aucune ressaisie ») : la fiche medecin creee par la validation
// reprend la VILLE declaree a l'inscription -- la meme que celle de l'organisation. Verifie en base ET dans ce que le
// fondateur peut lire par l'API de la fiche.

jest.setTimeout(60_000);

describe('La fiche medecin reprend la ville de l inscription (e2e, TASK-067)', () => {
  let h: ValidationHarness;

  beforeAll(async () => {
    h = await bootValidationHarness('ville');
  });
  afterAll(async () => {
    await h.cleanup();
  });
  beforeEach(() => h.outbox.reset());

  const medecinOf = async (userId: string) =>
    (await h.adminPool.query('SELECT id, city FROM medecins WHERE user_id = $1', [userId]))
      .rows as {
      id: string;
      city: string | null;
    }[];

  // Libelle NUMERIQUE : « Fes » avec accent donnerait une adresse email invalide.
  it.each(REGISTRATION_CITIES.map((city, index) => [index, city] as const))(
    'founder n°%i, ville « %s » : la fiche medecin la porte, comme l organisation',
    async (index, city) => {
      const f = await h.registerFounder({ label: `ville-${index}`, city });
      expect((await h.validate(f.requestId)).status).toBe(200);

      const s = await h.snapshot(f);
      const fiches = await medecinOf(f.userId);
      expect(fiches).toHaveLength(1);
      expect(fiches[0].city).toBe(city);
      // La MEME valeur que sur l'organisation : une seule saisie, deux endroits (R5).
      expect(s.orgs[0].city).toBe(city);
      expect(fiches[0].city).toBe(s.orgs[0].city);
    },
  );

  it('le fondateur la lit sur SA fiche, par l API de la fiche medecin (ce qu il voit reellement)', async () => {
    const f = await h.registerFounder({ label: 'ville-api', city: 'Tanger' });
    await h.validate(f.requestId);
    const org = (await h.snapshot(f)).orgs[0].id;
    const [fiche] = await medecinOf(f.userId);

    const res = await h.call('GET', `/medecins/${fiche.id}`, f.cookie, {
      'x-organization-id': org,
    });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({
      id: fiche.id,
      city: 'Tanger',
      firstName: 'Youssef',
    });
  });

  it('chaque fiche porte la ville de SA demande : aucune contamination entre deux fondateurs', async () => {
    const a = await h.registerFounder({ label: 'ville-iso-a', city: 'Agadir' });
    const b = await h.registerFounder({ label: 'ville-iso-b', city: 'Marrakech' });
    const [ra, rb] = await Promise.all([h.validate(a.requestId), h.validate(b.requestId)]);
    expect([ra.status, rb.status]).toEqual([200, 200]);

    expect((await medecinOf(a.userId))[0].city).toBe('Agadir');
    expect((await medecinOf(b.userId))[0].city).toBe('Marrakech');
  });

  it('une validation qui echoue ne laisse pas de fiche avec une ville : tout ou rien reste vrai', async () => {
    const f = await h.registerFounder({
      label: 'ville-atomique',
      city: 'Rabat',
      firstName: 'PANNE-VILLE',
    });
    const FUNCTION = 'test_fail_city_step';
    await h.adminPool.query(`
      CREATE OR REPLACE FUNCTION ${FUNCTION}() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'panne simulee'; END $$ LANGUAGE plpgsql;
    `);
    await h.adminPool.query(
      `CREATE TRIGGER ${FUNCTION} BEFORE UPDATE ON registration_requests FOR EACH ROW
       WHEN (NEW.status = 'ACTIVE' AND NEW.id = '${f.requestId}') EXECUTE FUNCTION ${FUNCTION}()`,
    );
    try {
      // Panne APRES la creation de la fiche (a la mise a jour de la demande) : la fiche, ville comprise, disparait.
      expect((await h.validate(f.requestId)).status).toBe(500);
      expect(await medecinOf(f.userId)).toEqual([]);
    } finally {
      await h.adminPool.query(`DROP TRIGGER IF EXISTS ${FUNCTION} ON registration_requests`);
      await h.adminPool.query(`DROP FUNCTION IF EXISTS ${FUNCTION}()`);
    }
    expect((await h.validate(f.requestId)).status).toBe(200);
    expect((await medecinOf(f.userId))[0].city).toBe('Rabat');
  });
});
