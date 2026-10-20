import { Logger } from '@nestjs/common';
import { renderEmail } from '../../src/modules/email';
import { bootValidationHarness, Founder, ValidationHarness } from '../fixtures/validation-harness';
import { createTestAccount } from '../fixtures/test-accounts';

// BUILD-004 etape 2, EA-018 / TASK-065 : l'action REFUSER (brief R8, R6 ; ADR-0021 P2), de bout en bout.
//
// TEST CRITIQUE (decoupage) : le motif INTERNE n'apparait JAMAIS dans ce que recoit ou voit le demandeur. On
// envoie un motif contenant des marqueurs uniques, puis on FOUILLE tout : chaque champ de chaque email, les
// reponses d'API du demandeur, l'historique, les journaux du serveur.
// Prouve aussi : deux champs obligatoires et distincts, confirmation explicite exigee, acte atomique, refus
// definitif, et -- R6 -- un echec d'email laisse le refus ACQUIS, trace et renvoyable.

jest.setTimeout(60_000);

// Marqueurs UNIQUES, reconnaissables : si l'un d'eux apparait ou que ce soit cote demandeur, c'est une fuite.
const INTERNAL_REASON =
  'MOTIF-INTERNE-CONFIDENTIEL-9f2c : INPE-INVALIDE-X7Q, aucune fiche Google, doublon suspecte avec Dr Hamid';
const INTERNAL_FRAGMENTS = [
  'MOTIF-INTERNE',
  'CONFIDENTIEL-9f2c',
  'INPE-INVALIDE-X7Q',
  'doublon suspecte',
  'Dr Hamid',
];
const MESSAGE =
  "Nous ne pouvons pas donner suite a votre demande pour le moment. N'hesitez pas a nous contacter pour en discuter.";

describe('Refuser une inscription (e2e, TASK-065)', () => {
  let h: ValidationHarness;

  beforeAll(async () => {
    h = await bootValidationHarness('refus');
  });
  afterAll(async () => {
    await h.cleanup();
  });
  beforeEach(() => h.outbox.reset());

  const refuse = (f: Founder, body: unknown, cookie = h.admin.cookie) =>
    fetch(`${h.httpServer}/api/v1/admin/registration-requests/${f.requestId}/refuse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify(body),
    });
  const refuseOk = (f: Founder, reason = INTERNAL_REASON, message = MESSAGE) =>
    refuse(f, { internalReason: reason, messageToApplicant: message, confirmed: true });
  const resendRefusal = (f: Founder, cookie = h.admin.cookie) =>
    h.call('POST', `/admin/registration-requests/${f.requestId}/resend-refusal-email`, cookie);
  const stored = async (f: Founder) =>
    (
      await h.adminPool.query(
        `SELECT status, refusal_internal_reason AS reason, refusal_message_to_applicant AS message,
                organization_id AS org, complement_requested_info AS info, complement_message AS compl
         FROM registration_requests WHERE id = $1`,
        [f.requestId],
      )
    ).rows[0] as {
      status: string;
      reason: string | null;
      message: string | null;
      org: string | null;
      info: string | null;
      compl: string | null;
    };
  const untouched = {
    status: 'PENDING_VERIFICATION',
    reason: null,
    message: null,
    org: null,
    info: null,
    compl: null,
  };
  const leaks = (text: string) => INTERNAL_FRAGMENTS.filter((fragment) => text.includes(fragment));

  // -----------------------------------------------------------------------------------
  describe('acces : reserve a l equipe, sur les DEUX routes', () => {
    it('401 sans session', async () => {
      const f = await h.registerFounder({ label: 'acces-401' });
      const a = await fetch(
        `${h.httpServer}/api/v1/admin/registration-requests/${f.requestId}/refuse`,
        { method: 'POST' },
      );
      const b = await fetch(
        `${h.httpServer}/api/v1/admin/registration-requests/${f.requestId}/resend-refusal-email`,
        { method: 'POST' },
      );
      expect([a.status, b.status]).toEqual([401, 401]);
    });

    it('403 pour le demandeur lui-meme : il ne peut ni se refuser, ni lire ce qui le concerne ; rien ne change', async () => {
      const f = await h.registerFounder({ label: 'acces-fondateur' });
      // La requete du demandeur SEULE (aucune action prealable de l'administrateur).
      expect(
        (
          await refuse(
            f,
            { internalReason: 'x', messageToApplicant: 'y', confirmed: true },
            f.cookie,
          )
        ).status,
      ).toBe(403);
      expect((await resendRefusal(f, f.cookie)).status).toBe(403);
      // Rien n'a bouge : ni statut, ni motif, ni message, ni email.
      expect(await stored(f)).toEqual(untouched);
      expect(h.outbox.outbox).toHaveLength(0);
    });

    it('403 pour un membre d organisation, et pour un administrateur REVOQUE', async () => {
      const f = await h.registerFounder({ label: 'acces-membre' });
      const body = { internalReason: 'a', messageToApplicant: 'b', confirmed: true };
      const email = `${h.runId}-membre-refus@example.com`;
      h.emails.push(email);
      const member = await createTestAccount({
        email,
        password: 'equipe-mdp-1234',
        name: 'Membre',
      });
      expect((await refuse(f, body, member.cookie)).status).toBe(403);

      const rev = `${h.runId}-revoque-refus@example.com`;
      h.emails.push(rev);
      const revoked = await createTestAccount({
        email: rev,
        password: 'equipe-mdp-1234',
        name: 'Revoque',
      });
      await h.adminPool.query(
        `INSERT INTO platform_admins (user_id, granted_by, reason, revoked_at) VALUES ($1, 'Test', 'test', now())`,
        [revoked.userId],
      );
      expect((await refuse(f, body, revoked.cookie)).status).toBe(403);
      expect(await stored(f)).toEqual(untouched);
      expect(h.outbox.outbox).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------------------
  describe("l'acte (brief R8)", () => {
    it('statut, DEUX champs conserves tels quels et separes, aucune organisation, trace avec l administrateur', async () => {
      const f = await h.registerFounder({ label: 'acte', firstName: 'Salma' });
      const res = await refuseOk(f);
      expect(res.status).toBe(200);
      expect((await res.json()).data).toEqual({
        id: f.requestId,
        status: 'REFUSED',
        refusalEmail: { sent: true },
      });

      // Les deux champs sont conserves EXACTEMENT, dans deux colonnes distinctes.
      expect(await stored(f)).toEqual({
        status: 'REFUSED',
        reason: INTERNAL_REASON,
        message: MESSAGE,
        org: null,
        info: null,
        compl: null,
      });
      // Un refus ne cree RIEN : ni organisation, ni adhesion, ni fiche medecin.
      const s = await h.snapshot(f);
      expect(s.orgs).toHaveLength(0);
      expect(s.memberships).toHaveLength(0);
      expect(s.medecins).toHaveLength(0);
      expect(s.cache).toEqual([]);
      // Trace de l'action : date, action, ADMINISTRATEUR ; puis l'envoi, evenement systeme.
      expect(s.events.map((e) => e.action)).toEqual([
        'REQUEST_SUBMITTED',
        'EMAIL_SENT',
        'REFUSED',
        'EMAIL_SENT',
      ]);
      expect(s.events[2]).toMatchObject({ action: 'REFUSED', actor_user_id: h.admin.userId });
      expect(s.events[3]).toMatchObject({
        action: 'EMAIL_SENT',
        email_template: 'registration-refusal',
        email_failure_retryable: null,
        actor_user_id: null,
      });
      // L'email : bon destinataire, rendu identique au modele avec le MESSAGE AU DEMANDEUR.
      expect(h.outbox.outbox).toHaveLength(1);
      const sent = h.outbox.outbox[0];
      expect(sent.to.email).toBe(f.email);
      expect({ subject: sent.subject, html: sent.html, text: sent.text }).toEqual(
        renderEmail('registration-refusal', { firstName: 'Salma', messageToApplicant: MESSAGE }),
      );
    });

    it('depuis « complement demande » : refusable, et le dernier message de complement est efface (ADR-0022)', async () => {
      const f = await h.registerFounder({ label: 'depuis-complement' });
      await h.adminPool.query(
        `UPDATE registration_requests SET status = 'COMPLEMENT_REQUESTED',
           complement_requested_info = 'info', complement_message = 'msg' WHERE id = $1`,
        [f.requestId],
      );
      expect((await refuseOk(f)).status).toBe(200);
      expect(await stored(f)).toMatchObject({ status: 'REFUSED', info: null, compl: null });
    });

    it("l'administrateur voit le motif ET le message dans le detail ; la demande est dans « Refusees »", async () => {
      const f = await h.registerFounder({ label: 'admin-voit' });
      await refuseOk(f);
      const detail = await (
        await h.call('GET', `/admin/registration-requests/${f.requestId}`, h.admin.cookie)
      ).json();
      expect(detail.data.status).toBe('REFUSED');
      expect(detail.data.refusal).toEqual({
        internalReason: INTERNAL_REASON,
        messageToApplicant: MESSAGE,
      });
      const list = await (
        await h.call(
          'GET',
          `/admin/registration-requests?filter=refused&q=${encodeURIComponent(h.TAG)}&limit=50`,
          h.admin.cookie,
        )
      ).json();
      expect(list.data.map((r: { id: string }) => r.id)).toContain(f.requestId);
      expect(list.meta.counts.refused).toBeGreaterThanOrEqual(1);
    });
  });

  // -----------------------------------------------------------------------------------
  describe("TEST CRITIQUE -- le motif INTERNE n'apparait JAMAIS cote demandeur (R8)", () => {
    it('ni dans AUCUN champ d aucun email envoye (envoi puis renvoi), ni dans la reponse du refus', async () => {
      const f = await h.registerFounder({ label: 'fuite-email', firstName: 'Omar' });
      const res = await refuseOk(f);
      const refuseBody = await res.text();
      // Meme la reponse de l'API a l'administrateur ne renvoie pas le motif.
      expect(leaks(refuseBody)).toEqual([]);

      // Le renvoi (relit le message en base) : memes garanties.
      await h.adminPool.query(
        `UPDATE registration_requests SET last_email_resent_at = NULL WHERE id = $1`,
        [f.requestId],
      );
      expect((await resendRefusal(f)).status).toBe(200);

      expect(h.outbox.outbox).toHaveLength(2);
      for (const message of h.outbox.outbox) {
        // L'objet ENTIER du message (destinataire, sujet, HTML, texte, en-tetes, Reply-To...) est fouille.
        expect({ leaks: leaks(JSON.stringify(message)) }).toEqual({ leaks: [] });
        // ...et il porte bien le message AU DEMANDEUR.
        expect(message.text).toContain(MESSAGE);
        expect(message.html).toContain('N&#39;hesitez pas a nous contacter');
      }
    });

    it('ni dans ce que le demandeur peut LIRE : son statut, ses organisations, et les espaces qui lui sont fermes', async () => {
      const f = await h.registerFounder({ label: 'fuite-api' });
      await refuseOk(f);

      const status = await h.call('GET', '/identity/registration-status', f.cookie);
      const statusBody = await status.text();
      expect(JSON.parse(statusBody).data).toEqual({
        status: 'REFUSED',
        maskedEmail: expect.any(String),
        refusalMessage: MESSAGE, // le message AU DEMANDEUR : c'est fait pour lui
      });
      expect(leaks(statusBody)).toEqual([]);

      for (const [path, expected] of [
        ['/identity/organizations', 200],
        ['/patients?q=x', 403],
        ['/medecins?q=x', 403],
        ['/admin/me', 403],
        [`/admin/registration-requests/${f.requestId}`, 403],
        ['/admin/registration-requests', 403],
      ] as const) {
        const response = await h.call('GET', path, f.cookie);
        const body = await response.text();
        expect({ path, status: response.status }).toEqual({ path, status: expected });
        expect({ path, leaks: leaks(body) }).toEqual({ path, leaks: [] });
      }
    });

    it("ni dans l'historique : date, action et administrateur, sans aucun contenu", async () => {
      const f = await h.registerFounder({ label: 'fuite-historique' });
      await refuseOk(f);
      const rows = (
        await h.adminPool.query(
          'SELECT * FROM registration_events WHERE registration_request_id = $1',
          [f.requestId],
        )
      ).rows;
      const serialized = JSON.stringify(rows);
      expect(leaks(serialized)).toEqual([]);
      expect(serialized).not.toContain(MESSAGE);
    });

    it('ni dans les JOURNAUX du serveur, meme quand le refus echoue', async () => {
      const f = await h.registerFounder({ label: 'fuite-journaux' });
      const FUNCTION = 'test_fail_refusal_logs';
      await h.adminPool.query(`
        CREATE OR REPLACE FUNCTION ${FUNCTION}() RETURNS trigger AS $$
        BEGIN RAISE EXCEPTION 'panne simulee'; END $$ LANGUAGE plpgsql;
      `);
      await h.adminPool.query(
        `CREATE TRIGGER ${FUNCTION} BEFORE UPDATE ON registration_requests FOR EACH ROW
         WHEN (NEW.status = 'REFUSED' AND NEW.id = '${f.requestId}') EXECUTE FUNCTION ${FUNCTION}()`,
      );
      const error = jest.spyOn(Logger.prototype, 'error');
      const warn = jest.spyOn(Logger.prototype, 'warn');
      let body = '';
      try {
        const res = await refuseOk(f);
        expect(res.status).toBe(500);
        body = await res.text();
      } finally {
        const logged = JSON.stringify([...error.mock.calls, ...warn.mock.calls]);
        error.mockRestore();
        warn.mockRestore();
        await h.adminPool.query(`DROP TRIGGER IF EXISTS ${FUNCTION} ON registration_requests`);
        await h.adminPool.query(`DROP FUNCTION IF EXISTS ${FUNCTION}()`);
        expect(leaks(logged)).toEqual([]);
        expect(logged).not.toContain(MESSAGE);
      }
      // La reponse d'erreur non plus ne contient ni le motif ni le message.
      expect(leaks(body)).toEqual([]);
      expect(body).not.toContain(MESSAGE);
    });
  });

  // -----------------------------------------------------------------------------------
  describe('DEUX champs obligatoires et distincts, plus une confirmation explicite', () => {
    it.each([
      ['motif absent', { messageToApplicant: MESSAGE, confirmed: true }],
      ['motif vide', { internalReason: '', messageToApplicant: MESSAGE, confirmed: true }],
      ['motif blanc', { internalReason: '  \n ', messageToApplicant: MESSAGE, confirmed: true }],
      [
        'motif trop long',
        { internalReason: 'x'.repeat(2001), messageToApplicant: MESSAGE, confirmed: true },
      ],
      [
        'motif qui n est pas du texte',
        { internalReason: 7, messageToApplicant: MESSAGE, confirmed: true },
      ],
      ['message au demandeur absent', { internalReason: INTERNAL_REASON, confirmed: true }],
      [
        'message au demandeur vide',
        { internalReason: INTERNAL_REASON, messageToApplicant: '', confirmed: true },
      ],
      [
        'message au demandeur blanc',
        { internalReason: INTERNAL_REASON, messageToApplicant: '   ', confirmed: true },
      ],
      [
        'message au demandeur trop long',
        { internalReason: INTERNAL_REASON, messageToApplicant: 'x'.repeat(2001), confirmed: true },
      ],
      ['confirmation absente', { internalReason: INTERNAL_REASON, messageToApplicant: MESSAGE }],
      [
        'confirmation fausse',
        { internalReason: INTERNAL_REASON, messageToApplicant: MESSAGE, confirmed: false },
      ],
      [
        'confirmation « true » en texte',
        { internalReason: INTERNAL_REASON, messageToApplicant: MESSAGE, confirmed: 'true' },
      ],
      [
        'confirmation 1',
        { internalReason: INTERNAL_REASON, messageToApplicant: MESSAGE, confirmed: 1 },
      ],
    ])('%s : 400, rien ne change, aucun email', async (label, body) => {
      const f = await h.registerFounder({ label: `invalide-${label.replace(/\W+/g, '-')}` });
      expect((await refuse(f, body)).status).toBe(400);
      expect(await stored(f)).toEqual(untouched);
      expect((await h.snapshot(f)).events.map((e) => e.action)).toEqual([
        'REQUEST_SUBMITTED',
        'EMAIL_SENT',
      ]);
      expect(h.outbox.outbox).toHaveLength(0);
    });

    it.each([
      ['textes identiques', 'Dossier incomplet', 'Dossier incomplet'],
      ['espaces et casse differents', 'Dossier incomplet', '  DOSSIER   incomplet '],
    ])(
      '%s dans les deux champs : 400 explicite (le motif serait communique), rien ne change',
      async (_label, reason, message) => {
        const f = await h.registerFounder({ label: `identique-${_label.replace(/\W+/g, '-')}` });
        const res = await refuseOk(f, reason, message);
        expect(res.status).toBe(400);
        expect(JSON.stringify(await res.json())).toMatch(
          /ne peut pas etre identique au motif interne/,
        );
        expect(await stored(f)).toEqual(untouched);
        expect(h.outbox.outbox).toHaveLength(0);
      },
    );

    it('2000 caracteres acceptes ; les espaces autour sont retires, le texte jamais reecrit', async () => {
      const f = await h.registerFounder({ label: 'limite' });
      expect((await refuseOk(f, `  ${'a'.repeat(2000)}  `, `  ${'b'.repeat(2000)}  `)).status).toBe(
        200,
      );
      const s = await stored(f);
      expect(s.reason).toBe('a'.repeat(2000));
      expect(s.message).toBe('b'.repeat(2000));
    });

    it("un message au demandeur contenant du HTML est echappe dans l'email (aucune injection)", async () => {
      const f = await h.registerFounder({ label: 'html' });
      await refuseOk(
        f,
        INTERNAL_REASON,
        'Voir <a href="https://pirate.example">ici</a> <script>alert(1)</script>',
      );
      const html = h.outbox.outbox[0].html;
      expect(html).not.toContain('<script>');
      expect(html).not.toContain('<a href="https://pirate.example">');
      expect(html).toContain('&lt;script&gt;');
    });
  });

  // -----------------------------------------------------------------------------------
  describe("seules les demandes ouvertes se refusent : 409, et rien n'est modifie", () => {
    it('une demande VALIDEE : 409, elle reste ACTIVE avec son organisation, aucun email', async () => {
      const f = await h.registerFounder({ label: 'etat-validee' });
      expect((await h.validate(f.requestId)).status).toBe(200);
      h.outbox.reset();
      const res = await refuseOk(f);
      expect(res.status).toBe(409);
      expect(JSON.stringify(await res.json())).toMatch(/deja ete traitee/);
      expect(await stored(f)).toMatchObject({ status: 'ACTIVE', reason: null, message: null });
      expect((await h.snapshot(f)).orgs).toHaveLength(1);
      expect(h.outbox.outbox).toHaveLength(0);
    });

    it("une demande DEJA refusee : 409, et le motif d'origine n'est PAS ecrase", async () => {
      const f = await h.registerFounder({ label: 'etat-refusee' });
      await refuseOk(f, INTERNAL_REASON, MESSAGE);
      h.outbox.reset();
      const res = await refuseOk(f, 'AUTRE-MOTIF-TARDIF', 'Un autre message.');
      expect(res.status).toBe(409);
      expect(await stored(f)).toMatchObject({
        status: 'REFUSED',
        reason: INTERNAL_REASON,
        message: MESSAGE,
      });
      expect(h.outbox.outbox).toHaveLength(0);
    });

    it('demande inconnue : 404 ; identifiant mal forme : 400', async () => {
      const f = await h.registerFounder({ label: 'etat-fantome' });
      expect(
        (await refuseOk({ ...f, requestId: '01a13bd2-d439-7d64-be45-a77893aa0421' })).status,
      ).toBe(404);
      expect((await refuseOk({ ...f, requestId: 'pas-un-uuid' })).status).toBe(400);
    });
  });

  // -----------------------------------------------------------------------------------
  describe('un refus est DEFINITIF en V1 (ADR-0021 P2)', () => {
    it('le demandeur se connecte et voit son refus ; il ne peut ni se reinscrire, ni etre valide, ni recevoir un complement', async () => {
      const f = await h.registerFounder({ label: 'definitif' });
      await refuseOk(f);

      // Son compte existe toujours : il voit l'ecran de refus avec le message qui lui est destine.
      const status = await (await h.call('GET', '/identity/registration-status', f.cookie)).json();
      expect(status.data).toMatchObject({ status: 'REFUSED', refusalMessage: MESSAGE });
      expect((await h.call('GET', '/patients?q=x', f.cookie)).status).toBe(403);

      // Pas de reinscription avec le meme email : reponse neutre, aucun doublon.
      const again = await fetch(`${h.httpServer}/api/v1/registration-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: 'Y',
          lastName: 'B',
          email: f.email,
          password: 'password1234',
          specialty: 'generaliste',
          structureName: `Autre ${h.TAG}`,
          city: 'Rabat',
        }),
      });
      expect(again.status).toBe(409);
      expect(
        (
          await h.adminPool.query(
            'SELECT count(*)::int AS n FROM registration_requests WHERE user_id = $1',
            [f.userId],
          )
        ).rows[0].n,
      ).toBe(1);

      // Ni validation, ni complement, depuis un refus.
      h.outbox.reset();
      expect((await h.validate(f.requestId)).status).toBe(409);
      const compl = await fetch(
        `${h.httpServer}/api/v1/admin/registration-requests/${f.requestId}/request-complement`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: h.admin.cookie },
          body: JSON.stringify({ infoType: 'google_listing', message: 'Message' }),
        },
      );
      expect(compl.status).toBe(409);
      expect(await stored(f)).toMatchObject({ status: 'REFUSED' });
      expect(h.outbox.outbox).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------------------
  describe("echec d'email (R6) : le refus reste ACQUIS, trace, renvoyable", () => {
    it("200 `sent: false`, refus conserve, echec dans l'historique ; l'administrateur relance ; AUCUNE fuite dans le renvoi", async () => {
      const f = await h.registerFounder({ label: 'email-ko' });
      h.outbox.failNext(1);
      const res = await refuseOk(f);
      expect(res.status).toBe(200);
      expect((await res.json()).data).toMatchObject({
        status: 'REFUSED',
        refusalEmail: { sent: false },
      });

      expect(await stored(f)).toMatchObject({
        status: 'REFUSED',
        reason: INTERNAL_REASON,
        message: MESSAGE,
      });
      const s = await h.snapshot(f);
      expect(s.events[s.events.length - 1]).toMatchObject({
        action: 'EMAIL_FAILED',
        email_template: 'registration-refusal',
        email_failure_retryable: true,
      });
      expect(h.outbox.outbox).toHaveLength(0);

      const resend = await resendRefusal(f);
      expect(resend.status).toBe(200);
      expect((await resend.json()).data).toEqual({ sent: true });
      expect(h.outbox.outbox).toHaveLength(1);
      const message = h.outbox.outbox[0];
      expect(leaks(JSON.stringify(message))).toEqual([]);
      expect(message.text).toContain(MESSAGE);
      const after = await h.snapshot(f);
      expect(after.events.map((e) => e.action).slice(-2)).toEqual([
        'EMAIL_RESEND_REQUESTED',
        'EMAIL_SENT',
      ]);
      expect(after.events[after.events.length - 2]).toMatchObject({
        actor_user_id: h.admin.userId,
      });
    });

    it("MEME une exception inattendue pendant l'envoi ne remet pas le refus en cause", async () => {
      const f = await h.registerFounder({ label: 'email-exception' });
      const spy = jest
        .spyOn(h.emailService, 'sendTemplate')
        .mockRejectedValueOnce(new Error('panne inattendue'));
      try {
        const res = await refuseOk(f);
        expect(res.status).toBe(200);
        expect((await res.json()).data.refusalEmail).toEqual({ sent: false });
      } finally {
        spy.mockRestore();
      }
      expect((await stored(f)).status).toBe('REFUSED');
      const s = await h.snapshot(f);
      expect(s.events[s.events.length - 1]).toMatchObject({
        action: 'EMAIL_FAILED',
        email_failure_retryable: false,
      });
    });

    it('renvoi : garde de 60 s (429), trois clics simultanes = un seul email, demande non refusee 409, inconnue 404', async () => {
      const f = await h.registerFounder({ label: 'renvoi' });
      await refuseOk(f);
      h.outbox.reset();
      expect((await resendRefusal(f)).status).toBe(200);
      expect((await resendRefusal(f)).status).toBe(429);
      expect(h.outbox.outbox).toHaveLength(1);
      await h.adminPool.query(
        `UPDATE registration_requests SET last_email_resent_at = now() - interval '61 seconds' WHERE id = $1`,
        [f.requestId],
      );
      expect((await resendRefusal(f)).status).toBe(200);

      await h.adminPool.query(
        `UPDATE registration_requests SET last_email_resent_at = NULL WHERE id = $1`,
        [f.requestId],
      );
      h.outbox.reset();
      const results = await Promise.all([resendRefusal(f), resendRefusal(f), resendRefusal(f)]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 429, 429]);
      expect(h.outbox.outbox).toHaveLength(1);

      const open = await h.registerFounder({ label: 'renvoi-pas-refusee' });
      expect((await resendRefusal(open)).status).toBe(409);
      expect(
        (await resendRefusal({ ...open, requestId: '01a13bd2-d439-7d64-be45-a77893aa0421' }))
          .status,
      ).toBe(404);
    });
  });

  // -----------------------------------------------------------------------------------
  describe("l'atomicite de l'acte : tout ou rien", () => {
    const FUNCTION = 'test_fail_refusal_step';
    beforeAll(async () => {
      await h.adminPool.query(`
        CREATE OR REPLACE FUNCTION ${FUNCTION}() RETURNS trigger AS $$
        BEGIN RAISE EXCEPTION 'panne simulee pour le test d atomicite du refus'; END $$ LANGUAGE plpgsql;
      `);
    });
    afterAll(async () => {
      await h.adminPool.query(`DROP FUNCTION IF EXISTS ${FUNCTION}()`);
    });

    it.each([
      [
        'la mise a jour de la demande',
        'registration_requests',
        'UPDATE',
        (f: Founder) => `NEW.status = 'REFUSED' AND NEW.id = '${f.requestId}'`,
      ],
      [
        "l'inscription de l'action dans l'historique",
        'registration_events',
        'INSERT',
        (f: Founder) => `NEW.action = 'REFUSED' AND NEW.registration_request_id = '${f.requestId}'`,
      ],
    ])(
      'panne a %s : 500, RIEN n est modifie, aucun email ; puis le meme refus reussit',
      async (_label, table, event, when) => {
        const f = await h.registerFounder({ label: `atom-${table}` });
        await h.adminPool.query(
          `CREATE TRIGGER ${FUNCTION}_${table} BEFORE ${event} ON ${table} FOR EACH ROW WHEN (${when(f)}) EXECUTE FUNCTION ${FUNCTION}()`,
        );
        try {
          const failed = await refuseOk(f);
          expect(failed.status).toBe(500);
          expect(JSON.stringify(await failed.json())).toMatch(/rien n'a ete modifie/);
          expect(await stored(f)).toEqual(untouched);
          expect((await h.snapshot(f)).events.map((e) => e.action)).toEqual([
            'REQUEST_SUBMITTED',
            'EMAIL_SENT',
          ]);
          expect(h.outbox.outbox).toHaveLength(0);
        } finally {
          await h.adminPool.query(`DROP TRIGGER IF EXISTS ${FUNCTION}_${table} ON ${table}`);
        }
        expect((await refuseOk(f)).status).toBe(200);
        expect((await stored(f)).status).toBe('REFUSED');
      },
    );
  });

  // -----------------------------------------------------------------------------------
  describe('actions simultanees : la demande est verrouillee, le resultat reste coherent', () => {
    it('deux refus en meme temps : un seul reussit, un seul email, le motif conserve est celui du gagnant', async () => {
      const f = await h.registerFounder({ label: 'simultane-refus' });
      const [a, b] = await Promise.all([
        refuseOk(f, 'Motif A, interne.', 'Message A pour le demandeur.'),
        refuseOk(f, 'Motif B, interne.', 'Message B pour le demandeur.'),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      const s = await stored(f);
      const winner = a.status === 200 ? 'A' : 'B';
      expect(s).toMatchObject({
        status: 'REFUSED',
        reason: `Motif ${winner}, interne.`,
        message: `Message ${winner} pour le demandeur.`,
      });
      expect(h.outbox.outbox).toHaveLength(1);
      expect((await h.snapshot(f)).events.filter((e) => e.action === 'REFUSED')).toHaveLength(1);
    });

    it('un refus ET une validation en meme temps : jamais « refusee avec une organisation », jamais « validee avec un motif de refus »', async () => {
      const f = await h.registerFounder({ label: 'simultane-valid' });
      const [r, v] = await Promise.all([refuseOk(f), h.validate(f.requestId)]);
      expect([r.status, v.status].sort()).toEqual([200, 409]);
      const s = await h.snapshot(f);
      const row = await stored(f);
      if (r.status === 200) {
        expect(row).toMatchObject({ status: 'REFUSED', org: null });
        expect(s.orgs).toHaveLength(0);
        expect(s.memberships).toHaveLength(0);
        expect(s.medecins).toHaveLength(0);
      } else {
        expect(row).toMatchObject({ status: 'ACTIVE', reason: null, message: null });
        expect(s.orgs).toHaveLength(1);
      }
    });
  });
});
