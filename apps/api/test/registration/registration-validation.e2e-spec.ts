import { renderEmail } from '../../src/modules/email';
import * as validationQueries from '../../src/business/registration/infrastructure/validation.queries';
import { bootValidationHarness, ValidationHarness } from '../fixtures/validation-harness';
import { createTestAccount } from '../fixtures/test-accounts';

// BUILD-004 etape 2, EA-018 / TASK-063 : l'action VALIDER (brief R4, R5, R6), de bout en bout.
//
// Prouve : seuls les administrateurs valident ; la cascade cree, d'un bloc, le compte actif, l'organisation
// (ville et adresse reprises), l'adhesion du fondateur avec le role « fondateur » et sa fiche medecin
// pre-remplie ; deux validations simultanees ne creent qu'UNE organisation ; et -- test critique n°2 -- un
// echec d'email laisse la validation ACQUISE, trace dans l'historique et renvoyable.
// (L'atomicite sous panne est dans registration-validation-atomicity.e2e-spec.ts.)

jest.setTimeout(60_000);

describe('Valider une inscription (e2e, TASK-063)', () => {
  let h: ValidationHarness;

  beforeAll(async () => {
    h = await bootValidationHarness('val');
  });
  afterAll(async () => {
    await h.cleanup();
  });
  beforeEach(() => h.outbox.reset());

  // -----------------------------------------------------------------------------------
  describe('acces : reserve a l equipe, sur les DEUX routes', () => {
    const routes = [
      [
        'validation',
        (id: string, cookie?: string) =>
          cookie
            ? h.validate(id, cookie)
            : fetch(`${h.httpServer}/api/v1/admin/registration-requests/${id}/validate`, {
                method: 'POST',
              }),
      ],
      [
        'renvoi',
        (id: string, cookie?: string) =>
          cookie
            ? h.resendActivation(id, cookie)
            : fetch(
                `${h.httpServer}/api/v1/admin/registration-requests/${id}/resend-activation-email`,
                { method: 'POST' },
              ),
      ],
    ] as const;

    it.each(routes)('%s : 401 sans session', async (_label, hit) => {
      const f = await h.registerFounder({ label: `acces-401-${_label}` });
      expect((await hit(f.requestId)).status).toBe(401);
    });

    it.each(routes)(
      '%s : 403 pour un fondateur non valide, et RIEN n est cree',
      async (_label, hit) => {
        const f = await h.registerFounder({ label: `acces-403-${_label}` });
        expect((await hit(f.requestId, f.cookie)).status).toBe(403);
        const s = await h.snapshot(f);
        expect(s.request.status).toBe('PENDING_VERIFICATION');
        expect(s.orgs).toHaveLength(0);
        expect(s.memberships).toHaveLength(0);
        expect(s.medecins).toHaveLength(0);
      },
    );

    it.each(routes)(
      '%s : 403 pour un membre d organisation sans droit de plateforme',
      async (_label, hit) => {
        const f = await h.registerFounder({ label: `acces-membre-${_label}` });
        const email = `${h.runId}-membre-${_label}@example.com`;
        h.emails.push(email);
        const member = await createTestAccount({
          email,
          password: 'equipe-mdp-1234',
          name: 'Membre',
        });
        expect((await hit(f.requestId, member.cookie)).status).toBe(403);
      },
    );

    it('un administrateur REVOQUE ne peut plus valider', async () => {
      const f = await h.registerFounder({ label: 'acces-revoque' });
      const email = `${h.runId}-revoque@example.com`;
      h.emails.push(email);
      const revoked = await createTestAccount({
        email,
        password: 'equipe-mdp-1234',
        name: 'Revoque',
      });
      await h.adminPool.query(
        `INSERT INTO platform_admins (user_id, granted_by, reason, revoked_at) VALUES ($1, 'Test', 'test', now())`,
        [revoked.userId],
      );
      expect((await h.validate(f.requestId, revoked.cookie)).status).toBe(403);
      expect((await h.snapshot(f)).orgs).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------------------
  describe('la cascade complete (brief R4 et R5)', () => {
    it('cree EN UN BLOC : compte actif, organisation, adhesion « fondateur », fiche medecin pre-remplie', async () => {
      const f = await h.registerFounder({
        label: 'cascade',
        firstName: 'Youssef',
        lastName: 'Bennani',
        structure: 'Cabinet Dr Bennani',
        city: 'Casablanca',
        address: 'Rue Ibn Sina, Maarif',
        specialty: 'cardiologie',
        inpe: '123 456 789', // avec espaces : la fiche medecin normalise (un seul chemin de code, R4)
        numeroOrdre: 'ORD-42',
      });

      const res = await h.validate(f.requestId);
      expect(res.status).toBe(200);
      const { data } = await res.json();
      expect(data).toMatchObject({
        id: f.requestId,
        status: 'ACTIVE',
        activationEmail: { sent: true },
      });

      const s = await h.snapshot(f);
      // Operation 1 : la demande est ACTIVE et pointe vers l'organisation.
      expect(s.request).toMatchObject({
        status: 'ACTIVE',
        organization_id: data.organizationId,
        complement_requested_info: null,
        complement_message: null,
      });
      // Operation 2 : l'organisation, avec nom, ville et adresse repris de la demande (R5, aucune ressaisie).
      expect(s.orgs).toHaveLength(1);
      expect(s.orgs[0]).toMatchObject({
        id: data.organizationId,
        name: f.structureName,
        city: 'Casablanca',
        address: 'Rue Ibn Sina, Maarif',
      });
      // Operation 3 : le fondateur est le premier membre, avec le role « fondateur ».
      expect(s.memberships).toEqual([{ organization_id: data.organizationId, role: 'fondateur' }]);
      expect(s.cache).toEqual([
        {
          organizationId: data.organizationId,
          organizationName: f.structureName,
          isDefault: false,
        },
      ]);
      // Operation 4 : sa fiche medecin, liee a son compte, pre-remplie (nom, prenom, specialite, INPE, Ordre).
      expect(s.medecins).toEqual([
        {
          organization_id: data.organizationId,
          user_id: f.userId,
          first_name: 'Youssef',
          last_name: 'Bennani',
          specialty: 'cardiologie',
          inpe: '123456789',
          numero_ordre: 'ORD-42',
        },
      ]);
    });

    it('« generaliste » devient une specialite NULL ; INPE, Ordre et adresse absents restent absents', async () => {
      const f = await h.registerFounder({ label: 'generaliste', specialty: 'generaliste' });
      expect((await h.validate(f.requestId)).status).toBe(200);
      const s = await h.snapshot(f);
      expect(s.medecins[0]).toMatchObject({ specialty: null, inpe: null, numero_ordre: null });
      expect(s.orgs[0].address).toBeNull();
    });

    it('depuis « complement demande » : validable, et le dernier message de complement est efface (ADR-0022)', async () => {
      const f = await h.registerFounder({ label: 'depuis-complement' });
      await h.adminPool.query(
        `UPDATE registration_requests SET status = 'COMPLEMENT_REQUESTED',
           complement_requested_info = 'le lien de votre fiche Google', complement_message = 'Merci.' WHERE id = $1`,
        [f.requestId],
      );
      expect((await h.validate(f.requestId)).status).toBe(200);
      const s = await h.snapshot(f);
      expect(s.request).toMatchObject({
        status: 'ACTIVE',
        complement_requested_info: null,
        complement_message: null,
      });
    });

    it("l'historique trace l'acte : demande, validation PAR L'ADMINISTRATEUR, puis l'envoi -- sans aucun contenu", async () => {
      const f = await h.registerFounder({ label: 'historique' });
      await h.validate(f.requestId);
      const { events } = await h.snapshot(f);
      expect(events.map((e) => e.action)).toEqual([
        'REQUEST_SUBMITTED',
        'EMAIL_SENT',
        'VALIDATED',
        'EMAIL_SENT',
      ]);
      expect(events[2]).toMatchObject({ action: 'VALIDATED', actor_user_id: h.admin.userId });
      // L'email d'activation est un evenement SYSTEME (pas d'acteur), distinct de la validation.
      expect(events[3]).toMatchObject({
        action: 'EMAIL_SENT',
        email_template: 'account-activation',
        email_failure_retryable: null,
        actor_user_id: null,
      });
    });

    it("DE BOUT EN BOUT : avant, le fondateur n'a acces a rien ; apres, il gere patients et medecins -- et pas l'espace admin", async () => {
      const f = await h.registerFounder({ label: 'bout-en-bout' });
      const org = (id: string) => ({ 'x-organization-id': id });

      // AVANT : refus (demande non validee, et aucune organisation).
      expect((await h.call('GET', '/patients?q=x', f.cookie)).status).toBe(403);

      const { data } = await (await h.validate(f.requestId)).json();

      // APRES : meme session, il acces a son organisation avec son role « fondateur ».
      const status = await (await h.call('GET', '/identity/registration-status', f.cookie)).json();
      expect(status.data.status).toBe('ACTIVE');
      const orgs = await (await h.call('GET', '/identity/organizations', f.cookie)).json();
      expect(orgs.data).toEqual([
        expect.objectContaining({
          organizationId: data.organizationId,
          organizationName: f.structureName,
        }),
      ]);
      expect(
        (await h.call('GET', '/patients?q=x', f.cookie, org(data.organizationId))).status,
      ).toBe(200);
      expect(
        (await h.call('GET', '/medecins?q=x', f.cookie, org(data.organizationId))).status,
      ).toBe(200);
      const created = await fetch(`${h.httpServer}/api/v1/patients`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: f.cookie,
          ...org(data.organizationId),
        },
        body: JSON.stringify({ firstName: 'Fatima', lastName: 'Alaoui', dateOfBirthUnknown: true }),
      });
      expect(created.status).toBe(201);
      // Ce n'est PAS un administrateur de plateforme.
      expect((await h.call('GET', '/admin/me', f.cookie)).status).toBe(403);
      // Et son organisation est SEULE : il ne voit pas celle d'un autre fondateur.
      const other = await h.registerFounder({ label: 'bout-en-bout-autre' });
      const otherOrg = (await (await h.validate(other.requestId)).json()).data.organizationId;
      expect((await h.call('GET', '/patients?q=x', f.cookie, org(otherOrg))).status).toBe(403);
    });
  });

  // -----------------------------------------------------------------------------------
  describe('seules les demandes ouvertes se valident : 409, et rien de nouveau n est cree', () => {
    it('une demande DEJA validee : 409, pas de seconde organisation ni de second email', async () => {
      const f = await h.registerFounder({ label: 'deja-validee' });
      expect((await h.validate(f.requestId)).status).toBe(200);
      h.outbox.reset();

      const again = await h.validate(f.requestId);
      expect(again.status).toBe(409);
      expect(JSON.stringify(await again.json())).toMatch(/deja ete traitee/);
      const s = await h.snapshot(f);
      expect(s.orgs).toHaveLength(1);
      expect(s.memberships).toHaveLength(1);
      expect(s.medecins).toHaveLength(1);
      expect(s.events.filter((e) => e.action === 'VALIDATED')).toHaveLength(1);
      expect(h.outbox.outbox).toHaveLength(0);
    });

    it('une demande REFUSEE : 409 (un refus est definitif en V1, ADR-0021 P2), rien n est cree', async () => {
      const f = await h.registerFounder({ label: 'refusee' });
      await h.adminPool.query(
        `UPDATE registration_requests SET status = 'REFUSED', refusal_internal_reason = 'motif', refusal_message_to_applicant = 'message' WHERE id = $1`,
        [f.requestId],
      );
      expect((await h.validate(f.requestId)).status).toBe(409);
      const s = await h.snapshot(f);
      expect(s.request.status).toBe('REFUSED');
      expect(s.orgs).toHaveLength(0);
      expect(s.memberships).toHaveLength(0);
      expect(h.outbox.outbox).toHaveLength(0);
    });

    it('demande inconnue : 404 ; identifiant mal forme : 400', async () => {
      expect((await h.validate('01a13bd2-d439-7d64-be45-a77893aa0421')).status).toBe(404);
      expect((await h.validate('pas-un-uuid')).status).toBe(400);
    });
  });

  // -----------------------------------------------------------------------------------
  describe("le nom court de l'organisation (slug) : depuis le nom, avec suffixe anti-collision (ADR-0021 D7)", () => {
    const slugOf = async (founder: Awaited<ReturnType<typeof h.registerFounder>>) =>
      (await h.snapshot(founder)).orgs[0].slug;

    it('sans accents ni symboles', async () => {
      const f = await h.registerFounder({ label: 'slug-1', exact: "Clinique L'Océan & Fils" });
      await h.validate(f.requestId);
      expect(await slugOf(f)).toBe(`clinique-l-ocean-fils-${h.TAG.toLowerCase()}`);
    });

    it('deux structures de MEME nom, validees l une apres l autre : le second recoit « -2 »', async () => {
      // Noms DISTINCTS qui ne different que par la ponctuation : meme nom court, deux organisations.
      const a = await h.registerFounder({ label: 'slug-a', exact: 'Cabinet Doublon' });
      const b = await h.registerFounder({ label: 'slug-b', exact: 'Cabinet-Doublon' });
      await h.validate(a.requestId);
      await h.validate(b.requestId);
      const base = `cabinet-doublon-${h.TAG.toLowerCase()}`;
      expect(await slugOf(a)).toBe(base);
      expect(await slugOf(b)).toBe(`${base}-2`);
    });

    it('deux structures de meme nom validees EN MEME TEMPS : les deux reussissent, avec des noms courts distincts', async () => {
      const a = await h.registerFounder({ label: 'slug-par-a', exact: 'Cabinet Parallele' });
      const b = await h.registerFounder({ label: 'slug-par-b', exact: 'Cabinet.Parallele' });
      const [ra, rb] = await Promise.all([h.validate(a.requestId), h.validate(b.requestId)]);
      expect([ra.status, rb.status]).toEqual([200, 200]);
      const slugs = [await slugOf(a), await slugOf(b)];
      expect(new Set(slugs).size).toBe(2);
      for (const slug of slugs)
        expect(slug).toMatch(new RegExp(`^cabinet-parallele-${h.TAG.toLowerCase()}(-\\d+)?$`));
    });
  });

  // -----------------------------------------------------------------------------------
  describe('reprise sur collision de nom court : testee de facon DETERMINISTE', () => {
    // Une course entre deux validations ne declenche pas la collision a coup sur : un test qui en depend
    // peut passer sans rien prouver (constate : la suppression de la reprise ne le faisait pas echouer).
    // On force donc la collision : une organisation occupe deja le nom court, et on fait croire a la
    // validation qu'il est libre -- la base refuse alors l'insertion (unicite), comme dans la vraie course.
    async function occupySlug(slug: string) {
      await h.adminPool.query(
        `INSERT INTO organizations (id, name, slug) VALUES (gen_random_uuid(), $1, $2)`,
        [`Occupant ${slug} ${h.TAG}`, slug],
      );
    }

    it('une collision detectee PAR LA BASE declenche une nouvelle tentative : succes avec « -2 », rien ne reste de la premiere', async () => {
      const f = await h.registerFounder({ label: 'reprise-1', exact: 'Cabinet Reprise' });
      const base = `cabinet-reprise-${h.TAG.toLowerCase()}`;
      await occupySlug(base);

      const spy = jest.spyOn(validationQueries, 'slugIsTaken').mockResolvedValueOnce(false);
      let res: Response;
      try {
        res = await h.validate(f.requestId);
      } finally {
        spy.mockRestore();
      }
      expect(res.status).toBe(200);
      const s = await h.snapshot(f);
      expect(s.orgs).toHaveLength(1); // la premiere tentative, annulee, ne laisse AUCUNE organisation
      expect(s.orgs[0].slug).toBe(`${base}-2`);
      expect(s.memberships).toHaveLength(1);
      expect(s.medecins).toHaveLength(1);
      expect(s.events.filter((e) => e.action === 'VALIDATED')).toHaveLength(1);
    });

    it('si TOUTES les tentatives echouent : 500 franc, RIEN n est cree ; puis la meme validation reussit', async () => {
      const f = await h.registerFounder({ label: 'reprise-2', exact: 'Cabinet Reprise Echec' });
      const base = `cabinet-reprise-echec-${h.TAG.toLowerCase()}`;
      await occupySlug(base);

      const spy = jest.spyOn(validationQueries, 'slugIsTaken').mockResolvedValue(false);
      try {
        const res = await h.validate(f.requestId);
        expect(res.status).toBe(500);
        expect(JSON.stringify(await res.json())).toMatch(/rien n'a ete cree/);
        expect(spy).toHaveBeenCalledTimes(3); // trois tentatives, pas une de plus
      } finally {
        spy.mockRestore();
      }
      const s = await h.snapshot(f);
      expect(s.orgs).toHaveLength(0);
      expect(s.memberships).toHaveLength(0);
      expect(s.medecins).toHaveLength(0);
      expect(s.request.status).toBe('PENDING_VERIFICATION');
      expect(h.outbox.outbox).toHaveLength(0);

      // La panne levee, la meme validation reussit.
      expect((await h.validate(f.requestId)).status).toBe(200);
      expect((await h.snapshot(f)).orgs[0].slug).toBe(`${base}-2`);
    });
  });

  // -----------------------------------------------------------------------------------
  describe('deux validations SIMULTANEES de la meme demande : une seule reussit', () => {
    it('trois clics en meme temps : 200, 409, 409 -- UNE organisation, UNE adhesion, UNE fiche, UN email', async () => {
      const f = await h.registerFounder({ label: 'concurrence' });
      const results = await Promise.all([
        h.validate(f.requestId),
        h.validate(f.requestId),
        h.validate(f.requestId),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);

      const s = await h.snapshot(f);
      expect(s.orgs).toHaveLength(1);
      expect(s.memberships).toHaveLength(1);
      expect(s.medecins).toHaveLength(1);
      expect(s.events.filter((e) => e.action === 'VALIDATED')).toHaveLength(1);
      expect(h.outbox.outbox).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------------------
  describe("TEST CRITIQUE n°2 -- l'email est decouple (R6) : sa panne n'annule JAMAIS la validation", () => {
    it('echec d envoi : 200, validation ACQUISE (tout est cree), echec dans l historique, renvoi possible', async () => {
      const f = await h.registerFounder({ label: 'email-ko' });
      h.outbox.failNext(1);

      const res = await h.validate(f.requestId);
      expect(res.status).toBe(200);
      expect((await res.json()).data).toMatchObject({
        status: 'ACTIVE',
        activationEmail: { sent: false },
      });

      // La validation est ACQUISE : tout a ete ecrit.
      const s = await h.snapshot(f);
      expect(s.request.status).toBe('ACTIVE');
      expect(s.orgs).toHaveLength(1);
      expect(s.memberships).toHaveLength(1);
      expect(s.medecins).toHaveLength(1);
      // L'echec est dans l'historique, marque renvoyable.
      expect(s.events.map((e) => e.action)).toEqual([
        'REQUEST_SUBMITTED',
        'EMAIL_SENT',
        'VALIDATED',
        'EMAIL_FAILED',
      ]);
      expect(s.events[3]).toMatchObject({
        action: 'EMAIL_FAILED',
        email_template: 'account-activation',
        email_failure_retryable: true,
      });
      expect(h.outbox.outbox).toHaveLength(0);

      // Et le fondateur peut deja se servir de son espace, malgre l'email perdu.
      const status = await (await h.call('GET', '/identity/registration-status', f.cookie)).json();
      expect(status.data.status).toBe('ACTIVE');

      // L'administrateur RELANCE l'envoi : l'email part, l'historique garde la trace de chaque etape.
      const resend = await h.resendActivation(f.requestId);
      expect(resend.status).toBe(200);
      expect((await resend.json()).data).toEqual({ sent: true });
      expect(h.outbox.outbox).toHaveLength(1);
      const after = await h.snapshot(f);
      expect(after.events.map((e) => e.action)).toEqual([
        'REQUEST_SUBMITTED',
        'EMAIL_SENT',
        'VALIDATED',
        'EMAIL_FAILED',
        'EMAIL_RESEND_REQUESTED',
        'EMAIL_SENT',
      ]);
      expect(after.events[4]).toMatchObject({
        action: 'EMAIL_RESEND_REQUESTED',
        actor_user_id: h.admin.userId,
      });
    });

    it('MEME une exception inattendue pendant l envoi ne remet pas la validation en cause', async () => {
      const f = await h.registerFounder({ label: 'email-exception' });
      const spy = jest
        .spyOn(h.emailService, 'sendTemplate')
        .mockRejectedValueOnce(new Error('panne inattendue'));
      try {
        const res = await h.validate(f.requestId);
        expect(res.status).toBe(200);
        expect((await res.json()).data.activationEmail).toEqual({ sent: false });
      } finally {
        spy.mockRestore();
      }
      const s = await h.snapshot(f);
      expect(s.request.status).toBe('ACTIVE');
      expect(s.orgs).toHaveLength(1);
      expect(s.events[s.events.length - 1]).toMatchObject({
        action: 'EMAIL_FAILED',
        email_failure_retryable: false,
      });
    });

    it("l'email d'activation: bon destinataire, lien de connexion du site, rendu identique au modele", async () => {
      const f = await h.registerFounder({ label: 'email-contenu', firstName: 'Salma' });
      await h.validate(f.requestId);
      expect(h.outbox.outbox).toHaveLength(1);
      const sent = h.outbox.outbox[0];
      expect(sent.to.email).toBe(f.email);
      const expected = renderEmail('account-activation', {
        firstName: 'Salma',
        loginUrl: 'http://localhost:3001/fr/login',
      });
      expect({ subject: sent.subject, html: sent.html, text: sent.text }).toEqual(expected);
      expect(sent.text).toContain('http://localhost:3001/fr/login');
    });

    it('un prenom contenant du HTML est echappe dans l email (aucune injection)', async () => {
      const f = await h.registerFounder({ label: 'email-html', firstName: '<b>Zoé</b>' });
      await h.validate(f.requestId);
      const html = h.outbox.outbox[0].html;
      expect(html).not.toContain('<b>Zoé</b>');
      expect(html).toContain('&lt;b&gt;');
    });
  });

  // -----------------------------------------------------------------------------------
  describe("renvoi de l'email d'activation par l'administrateur", () => {
    it('garde anti-abus : un second renvoi dans les 60 s recoit 429 et n envoie rien ; apres le delai, il passe', async () => {
      const f = await h.registerFounder({ label: 'renvoi-delai' });
      await h.validate(f.requestId);
      h.outbox.reset();

      expect((await h.resendActivation(f.requestId)).status).toBe(200);
      expect((await h.resendActivation(f.requestId)).status).toBe(429);
      expect(h.outbox.outbox).toHaveLength(1);

      await h.adminPool.query(
        `UPDATE registration_requests SET last_email_resent_at = now() - interval '61 seconds' WHERE id = $1`,
        [f.requestId],
      );
      expect((await h.resendActivation(f.requestId)).status).toBe(200);
      expect(h.outbox.outbox).toHaveLength(2);
    });

    it('trois clics simultanes : un seul email part', async () => {
      const f = await h.registerFounder({ label: 'renvoi-parallele' });
      await h.validate(f.requestId);
      h.outbox.reset();
      const results = await Promise.all([
        h.resendActivation(f.requestId),
        h.resendActivation(f.requestId),
        h.resendActivation(f.requestId),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 429, 429]);
      expect(h.outbox.outbox).toHaveLength(1);
    });

    it('rien a renvoyer pour une demande non validee : 409, aucun email ; demande inconnue : 404', async () => {
      const f = await h.registerFounder({ label: 'renvoi-non-validee' });
      expect((await h.resendActivation(f.requestId)).status).toBe(409);
      expect(h.outbox.outbox).toHaveLength(0);
      expect((await h.resendActivation('01a13bd2-d439-7d64-be45-a77893aa0421')).status).toBe(404);
    });
  });
});
