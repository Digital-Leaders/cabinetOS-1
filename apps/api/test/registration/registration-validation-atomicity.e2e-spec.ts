import { bootValidationHarness, Founder, ValidationHarness } from '../fixtures/validation-harness';

// BUILD-004 etape 2, EA-018 / TASK-063 -- TEST CRITIQUE n°1 : « tout ou rien ».
//
// La cascade (organisation -> adhesion -> fiche medecin -> demande ACTIVE -> historique) forme UN acte
// atomique (brief R4). On la fait ECHOUER A CHAQUE ETAPE, avec de vraies pannes injectees dans la base (un
// declencheur qui leve une exception au moment precis de l'ecriture, pose avec la connexion
// d'administration ; aucun point d'injection dans le code de production), et on verifie que RIEN ne subsiste :
// ni organisation, ni adhesion, ni cache d'appartenance, ni fiche medecin, ni changement de statut, ni
// evenement d'historique, ni email. Puis, la panne levee, la meme validation reussit : aucun reste ne la gene.

jest.setTimeout(60_000);

type Step = {
  label: string;
  table: string;
  event: string;
  /** Condition SQL (sur NEW) qui ne vise QUE la ligne de ce test. */
  when: (f: Founder) => string;
  /** Prefixe / valeur a mettre dans la demande pour que la condition la vise. */
  founder: { label: string; firstName?: string; structure?: string };
};

describe('TEST CRITIQUE n°1 -- la cascade est atomique : tout ou rien (e2e, TASK-063)', () => {
  let h: ValidationHarness;
  const FUNCTION = 'test_fail_validation_step';

  beforeAll(async () => {
    h = await bootValidationHarness('atom');
    await h.adminPool.query(`
      CREATE OR REPLACE FUNCTION ${FUNCTION}() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'panne simulee pour le test d atomicite de la validation';
      END $$ LANGUAGE plpgsql;
    `);
  });
  afterAll(async () => {
    await h.adminPool.query(`DROP FUNCTION IF EXISTS ${FUNCTION}()`);
    await h.cleanup();
  });
  beforeEach(() => h.outbox.reset());

  const install = (step: Step, f: Founder) =>
    h.adminPool.query(`
      CREATE TRIGGER ${FUNCTION}_${step.table} BEFORE ${step.event} ON ${step.table}
      FOR EACH ROW WHEN (${step.when(f)}) EXECUTE FUNCTION ${FUNCTION}();
    `);
  const remove = (step: Step) =>
    h.adminPool.query(`DROP TRIGGER IF EXISTS ${FUNCTION}_${step.table} ON ${step.table}`);

  // Chaque etape de la cascade, dans l'ordre ou elle s'execute. Les conditions ne visent que le fondateur du test.
  const steps: Step[] = [
    {
      label: 'creation de l organisation',
      table: 'organizations',
      event: 'INSERT',
      when: () => `NEW.name LIKE '%PANNE-ORG%'`,
      founder: { label: 'atom-org', structure: 'Cabinet PANNE-ORG' },
    },
    {
      label: 'rattachement du fondateur (adhesion)',
      table: 'memberships',
      event: 'INSERT',
      when: (f) => `NEW.user_id = '${f.userId}'`,
      founder: { label: 'atom-membre' },
    },
    {
      label: 'creation de la fiche medecin',
      table: 'medecins',
      event: 'INSERT',
      when: () => `NEW.first_name = 'PANNE-MEDECIN'`,
      founder: { label: 'atom-medecin', firstName: 'PANNE-MEDECIN' },
    },
    {
      label: 'passage de la demande a ACTIVE',
      table: 'registration_requests',
      event: 'UPDATE',
      when: () => `NEW.status = 'ACTIVE' AND NEW.structure_name LIKE '%PANNE-MAJ%'`,
      founder: { label: 'atom-maj', structure: 'Cabinet PANNE-MAJ' },
    },
    {
      label: 'inscription de la validation dans l historique',
      table: 'registration_events',
      event: 'INSERT',
      when: (f) => `NEW.action = 'VALIDATED' AND NEW.registration_request_id = '${f.requestId}'`,
      founder: { label: 'atom-histo' },
    },
  ];

  it.each(steps)(
    'panne a l etape « $label » : RIEN ne subsiste, puis la meme validation reussit',
    async (step) => {
      const f = await h.registerFounder(step.founder);
      await install(step, f);
      try {
        const failed = await h.validate(f.requestId);

        // L'echec est franc et clair : 500, et le message dit qu'AUCUNE ecriture n'a ete conservee.
        expect(failed.status).toBe(500);
        expect(JSON.stringify(await failed.json())).toMatch(/rien n'a ete cree/);

        // RIEN ne subsiste, ou que la panne soit survenue dans la sequence.
        const s = await h.snapshot(f);
        expect(s.orgs).toHaveLength(0);
        expect(s.memberships).toHaveLength(0);
        expect(s.medecins).toHaveLength(0);
        expect(s.cache).toEqual([]);
        expect(s.request).toMatchObject({ status: 'PENDING_VERIFICATION', organization_id: null });
        expect(s.events.map((e) => e.action)).toEqual(['REQUEST_SUBMITTED', 'EMAIL_SENT']); // pas de VALIDATED
        // Pas d'email d'activation : il n'a de sens qu'APRES une validation acquise.
        expect(h.outbox.outbox).toHaveLength(0);
        // Le fondateur reste, pour le serveur, un fondateur non valide : aucune donnee.
        const status = await (
          await h.call('GET', '/identity/registration-status', f.cookie)
        ).json();
        expect(status.data.status).toBe('PENDING_VERIFICATION');
        expect((await h.call('GET', '/patients?q=x', f.cookie)).status).toBe(403);
      } finally {
        await remove(step);
      }

      // La panne levee, la MEME validation reussit : l'echec n'a laisse aucun reste qui la gene.
      const retry = await h.validate(f.requestId);
      expect(retry.status).toBe(200);
      const after = await h.snapshot(f);
      expect(after.request.status).toBe('ACTIVE');
      expect(after.orgs).toHaveLength(1);
      expect(after.memberships).toHaveLength(1);
      expect(after.medecins).toHaveLength(1);
      expect(after.events.filter((e) => e.action === 'VALIDATED')).toHaveLength(1);
      expect(h.outbox.outbox).toHaveLength(1);
    },
  );

  it("un echec ne laisse pas non plus l'email d'activation partir par erreur, meme quand la panne est la derniere etape", async () => {
    // Panne a la TOUTE DERNIERE ecriture de la transaction (l'historique) : tout le reste avait deja reussi
    // dans la transaction ; c'est le pire cas pour un « presque valide ».
    const step = steps[steps.length - 1];
    const f = await h.registerFounder({ label: 'atom-derniere' });
    await install(step, f);
    try {
      expect((await h.validate(f.requestId)).status).toBe(500);
      expect(h.outbox.outbox).toHaveLength(0);
      const s = await h.snapshot(f);
      expect(s.orgs).toHaveLength(0);
      expect(s.medecins).toHaveLength(0);
    } finally {
      await remove(step);
    }
  });

  it("une panne sur la demande d'UN fondateur n'affecte pas la validation d'un AUTRE, au meme moment", async () => {
    const step = steps[2]; // fiche medecin
    // Libelle propre : le meme que celui de l'etape reutiliserait la meme adresse email (doublon refuse).
    const failing = await h.registerFounder({ ...step.founder, label: 'atom-voisin-panne' });
    const healthy = await h.registerFounder({ label: 'atom-voisin' });
    await install(step, failing);
    try {
      const [bad, good] = await Promise.all([
        h.validate(failing.requestId),
        h.validate(healthy.requestId),
      ]);
      expect(bad.status).toBe(500);
      expect(good.status).toBe(200);
      expect((await h.snapshot(failing)).orgs).toHaveLength(0);
      const ok = await h.snapshot(healthy);
      expect(ok.request.status).toBe('ACTIVE');
      expect(ok.orgs).toHaveLength(1);
    } finally {
      await remove(step);
    }
  });
});
