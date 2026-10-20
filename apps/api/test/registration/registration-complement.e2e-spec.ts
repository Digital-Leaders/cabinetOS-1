import { renderEmail } from '../../src/modules/email';
import { bootValidationHarness, Founder, ValidationHarness } from '../fixtures/validation-harness';
import { createTestAccount } from '../fixtures/test-accounts';

// BUILD-004 etape 2, EA-018 / TASK-064 : l'action DEMANDER UN COMPLEMENT (brief R7, R6 ; ADR-0022).
//
// Prouve : seuls les administrateurs la declenchent ; elle enregistre, d'un bloc, le statut, le message
// TEL QU'ENVOYE et la trace (date, action, admin) ; l'email part ensuite, avec le Reply-To surveille ; un
// echec d'email laisse l'acte ACQUIS, trace et renvoyable ; et le renvoi par le MEDECIN reemet un email
// strictement identique a celui de l'administrateur.

jest.setTimeout(60_000);

const GOOGLE_LABEL = 'le lien vers la fiche Google de votre établissement';
const PUBLIC_LABEL = 'le lien vers une autre présence professionnelle publique';
const MESSAGE =
  'Bonjour, afin de finaliser la vérification, merci de nous transmettre le lien vers la fiche Google de votre cabinet.\n\nVous pouvez répondre directement à cet email.';

describe('Demander un complément (e2e, TASK-064)', () => {
  let h: ValidationHarness;

  beforeAll(async () => {
    h = await bootValidationHarness('compl');
  });
  afterAll(async () => {
    await h.cleanup();
  });
  beforeEach(() => h.outbox.reset());

  const requestComplement = (f: Founder, body: unknown, cookie = h.admin.cookie) =>
    fetch(`${h.httpServer}/api/v1/admin/registration-requests/${f.requestId}/request-complement`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify(body),
    });
  const complement = (f: Founder, message = MESSAGE, infoType = 'google_listing') =>
    requestComplement(f, { infoType, message });
  const resendComplement = (f: Founder, cookie = h.admin.cookie) =>
    h.call('POST', `/admin/registration-requests/${f.requestId}/resend-complement-email`, cookie);
  const stored = async (f: Founder) =>
    (
      await h.adminPool.query(
        'SELECT status, complement_requested_info AS info, complement_message AS message FROM registration_requests WHERE id = $1',
        [f.requestId],
      )
    ).rows[0] as { status: string; info: string | null; message: string | null };

  // -----------------------------------------------------------------------------------
  describe('acces : reserve a l equipe, sur les DEUX routes', () => {
    it('401 sans session', async () => {
      const f = await h.registerFounder({ label: 'acces-401' });
      const a = await fetch(
        `${h.httpServer}/api/v1/admin/registration-requests/${f.requestId}/request-complement`,
        { method: 'POST' },
      );
      const b = await fetch(
        `${h.httpServer}/api/v1/admin/registration-requests/${f.requestId}/resend-complement-email`,
        { method: 'POST' },
      );
      expect([a.status, b.status]).toEqual([401, 401]);
    });

    it('403 pour un fondateur non valide : rien ne change, aucun email', async () => {
      const f = await h.registerFounder({ label: 'acces-fondateur' });
      expect(
        (await requestComplement(f, { infoType: 'google_listing', message: MESSAGE }, f.cookie))
          .status,
      ).toBe(403);
      expect((await resendComplement(f, f.cookie)).status).toBe(403);
      // Rien n'a bouge : ni statut, ni message, ni email.
      expect(await stored(f)).toEqual({
        status: 'PENDING_VERIFICATION',
        info: null,
        message: null,
      });
      expect(h.outbox.outbox).toHaveLength(0);
    });

    it('403 pour un membre d organisation, et pour un administrateur REVOQUE', async () => {
      const f = await h.registerFounder({ label: 'acces-membre' });
      const email = `${h.runId}-membre-compl@example.com`;
      h.emails.push(email);
      const member = await createTestAccount({
        email,
        password: 'equipe-mdp-1234',
        name: 'Membre',
      });
      expect(
        (
          await requestComplement(
            f,
            { infoType: 'google_listing', message: MESSAGE },
            member.cookie,
          )
        ).status,
      ).toBe(403);

      const rev = `${h.runId}-revoque-compl@example.com`;
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
      expect(
        (
          await requestComplement(
            f,
            { infoType: 'google_listing', message: MESSAGE },
            revoked.cookie,
          )
        ).status,
      ).toBe(403);
      expect((await stored(f)).status).toBe('PENDING_VERIFICATION');
    });
  });

  // -----------------------------------------------------------------------------------
  describe("l'acte (brief R7, ADR-0022)", () => {
    it('statut, message CONSERVE tel qu envoye, trace avec l administrateur, email avec le Reply-To surveille', async () => {
      const f = await h.registerFounder({ label: 'acte', firstName: 'Salma' });
      const res = await complement(f);
      expect(res.status).toBe(200);
      expect((await res.json()).data).toEqual({
        id: f.requestId,
        status: 'COMPLEMENT_REQUESTED',
        complementEmail: { sent: true },
      });

      // Le message est conserve EXACTEMENT comme envoye (ADR-0022), avec le libelle de l'information.
      expect(await stored(f)).toEqual({
        status: 'COMPLEMENT_REQUESTED',
        info: GOOGLE_LABEL,
        message: MESSAGE,
      });

      // Trace de l'action : date, action, ADMINISTRATEUR ; puis l'envoi, evenement systeme -- sans contenu.
      const { events } = await h.snapshot(f);
      expect(events.map((e) => e.action)).toEqual([
        'REQUEST_SUBMITTED',
        'EMAIL_SENT',
        'COMPLEMENT_REQUESTED',
        'EMAIL_SENT',
      ]);
      expect(events[2]).toMatchObject({
        action: 'COMPLEMENT_REQUESTED',
        actor_user_id: h.admin.userId,
      });
      expect(events[3]).toMatchObject({
        action: 'EMAIL_SENT',
        email_template: 'verification-complement',
        email_failure_retryable: null,
        actor_user_id: null,
      });

      // L'email : bon destinataire, rendu identique au modele, et SURTOUT le Reply-To surveille (R7) :
      // le medecin repond directement a cet email, hors du logiciel.
      expect(h.outbox.outbox).toHaveLength(1);
      const sent = h.outbox.outbox[0];
      expect(sent.to.email).toBe(f.email);
      expect(sent.replyTo).toEqual({ email: 'verification@portesante.ma' });
      const expected = renderEmail('verification-complement', {
        firstName: 'Salma',
        requestedInfo: GOOGLE_LABEL,
        message: MESSAGE,
      });
      expect({ subject: sent.subject, html: sent.html, text: sent.text }).toEqual(expected);
    });

    it("le medecin RESTE bloque : demande en attente de complement = aucune donnee, et son statut n'expose pas le message", async () => {
      const f = await h.registerFounder({ label: 'bloque' });
      await complement(f);
      const raw = await (await h.call('GET', '/identity/registration-status', f.cookie)).text();
      expect(JSON.parse(raw).data.status).toBe('COMPLEMENT_REQUESTED');
      expect(raw).not.toContain('Google');
      expect(raw).not.toContain(MESSAGE);
      expect((await h.call('GET', '/patients?q=x', f.cookie)).status).toBe(403);
    });

    it("l'administrateur voit le complement dans le detail, et la demande reste dans « A traiter »", async () => {
      const f = await h.registerFounder({ label: 'detail' });
      await complement(f);
      const detail = await (
        await h.call('GET', `/admin/registration-requests/${f.requestId}`, h.admin.cookie)
      ).json();
      expect(detail.data.status).toBe('COMPLEMENT_REQUESTED');
      expect(detail.data.complement).toEqual({ requestedInfo: GOOGLE_LABEL, message: MESSAGE });
      const list = await (
        await h.call(
          'GET',
          `/admin/registration-requests?q=${encodeURIComponent(h.TAG)}&limit=50`,
          h.admin.cookie,
        )
      ).json();
      expect(list.data.map((r: { id: string }) => r.id)).toContain(f.requestId);
    });
  });

  // -----------------------------------------------------------------------------------
  describe("les trois types d'information (maquette) et la validation de la saisie", () => {
    it.each([
      ['google_listing', undefined, GOOGLE_LABEL],
      ['other_public_presence', undefined, PUBLIC_LABEL],
      [
        'other',
        "  une copie de votre carte d'inscription à l'Ordre  ",
        "une copie de votre carte d'inscription à l'Ordre",
      ],
    ])('type %s : libelle conserve et envoye = %j', async (infoType, otherInfo, label) => {
      const f = await h.registerFounder({ label: `type-${infoType}` });
      const res = await requestComplement(f, { infoType, otherInfo, message: MESSAGE });
      expect(res.status).toBe(200);
      expect((await stored(f)).info).toBe(label);
      expect(h.outbox.outbox[0].text).toContain(label);
    });

    it('un type predefini ignore le texte « autre » : le libelle ne se laisse pas detourner', async () => {
      const f = await h.registerFounder({ label: 'type-detourne' });
      await requestComplement(f, {
        infoType: 'google_listing',
        otherInfo: 'tout autre chose',
        message: MESSAGE,
      });
      expect((await stored(f)).info).toBe(GOOGLE_LABEL);
    });

    it.each([
      ['type inconnu', { infoType: 'telephone', message: MESSAGE }],
      ['type absent', { message: MESSAGE }],
      ['« autre » sans precision', { infoType: 'other', message: MESSAGE }],
      [
        '« autre » avec precision blanche',
        { infoType: 'other', otherInfo: '   ', message: MESSAGE },
      ],
      [
        '« autre » avec precision trop longue',
        { infoType: 'other', otherInfo: 'x'.repeat(201), message: MESSAGE },
      ],
      ['message absent', { infoType: 'google_listing' }],
      ['message vide', { infoType: 'google_listing', message: '' }],
      ['message blanc', { infoType: 'google_listing', message: '   \n  ' }],
      ['message trop long', { infoType: 'google_listing', message: 'x'.repeat(2001) }],
      ['message qui n est pas du texte', { infoType: 'google_listing', message: 42 }],
    ])('%s : 400, rien ne change, aucun email', async (_label, body) => {
      const f = await h.registerFounder({ label: `invalide-${_label.replace(/\W+/g, '-')}` });
      expect((await requestComplement(f, body)).status).toBe(400);
      expect(await stored(f)).toEqual({
        status: 'PENDING_VERIFICATION',
        info: null,
        message: null,
      });
      expect((await h.snapshot(f)).events.map((e) => e.action)).toEqual([
        'REQUEST_SUBMITTED',
        'EMAIL_SENT',
      ]);
      expect(h.outbox.outbox).toHaveLength(0);
    });

    it('2000 caracteres acceptes ; le message est « nettoye » (espaces autour) mais jamais reecrit', async () => {
      const f = await h.registerFounder({ label: 'limite' });
      expect((await complement(f, `  ${'a'.repeat(2000)}  `)).status).toBe(200);
      expect((await stored(f)).message).toBe('a'.repeat(2000));
    });

    it('un message contenant du HTML est echappe dans l email (aucune injection) et conserve tel quel en base', async () => {
      const f = await h.registerFounder({ label: 'html' });
      const dangerous =
        'Merci de cliquer <a href="https://pirate.example">ici</a> <script>alert(1)</script>';
      await complement(f, dangerous);
      const html = h.outbox.outbox[0].html;
      expect(html).not.toContain('<script>');
      expect(html).not.toContain('<a href="https://pirate.example">');
      expect(html).toContain('&lt;script&gt;');
      expect((await stored(f)).message).toBe(dangerous);
    });

    it('un message sur plusieurs lignes est conserve et envoye en paragraphes', async () => {
      const f = await h.registerFounder({ label: 'lignes' });
      await complement(f, 'Premier paragraphe.\n\nSecond paragraphe.');
      expect(h.outbox.outbox[0].text).toContain('Premier paragraphe.\n\nSecond paragraphe.');
    });
  });

  // -----------------------------------------------------------------------------------
  describe("seules les demandes ouvertes se traitent : 409, et rien n'est modifie", () => {
    it('une demande VALIDEE : 409, elle reste ACTIVE, aucun complement, aucun email', async () => {
      const f = await h.registerFounder({ label: 'etat-validee' });
      expect((await h.validate(f.requestId)).status).toBe(200);
      h.outbox.reset();
      const res = await complement(f);
      expect(res.status).toBe(409);
      expect(JSON.stringify(await res.json())).toMatch(/deja ete traitee/);
      expect(await stored(f)).toEqual({ status: 'ACTIVE', info: null, message: null });
      expect(h.outbox.outbox).toHaveLength(0);
    });

    it('une demande REFUSEE : 409, elle reste refusee', async () => {
      const f = await h.registerFounder({ label: 'etat-refusee' });
      await h.adminPool.query(
        `UPDATE registration_requests SET status = 'REFUSED', refusal_internal_reason = 'm', refusal_message_to_applicant = 'm' WHERE id = $1`,
        [f.requestId],
      );
      expect((await complement(f)).status).toBe(409);
      expect((await stored(f)).status).toBe('REFUSED');
      expect(h.outbox.outbox).toHaveLength(0);
    });

    it('demande inconnue : 404 ; identifiant mal forme : 400', async () => {
      const ghost = {
        ...(await h.registerFounder({ label: 'etat-fantome' })),
        requestId: '01a13bd2-d439-7d64-be45-a77893aa0421',
      };
      expect((await complement(ghost)).status).toBe(404);
      expect(
        (
          await requestComplement(
            { ...ghost, requestId: 'pas-un-uuid' },
            { infoType: 'google_listing', message: MESSAGE },
          )
        ).status,
      ).toBe(400);
    });

    it('une nouvelle demande depuis « complement demande » ECRASE la precedente (ADR-0022) et renvoie un nouvel email', async () => {
      const f = await h.registerFounder({ label: 'nouvelle' });
      await complement(f, 'Premier message.', 'google_listing');
      h.outbox.reset();
      expect(
        (await complement(f, 'Second message, plus precis.', 'other_public_presence')).status,
      ).toBe(200);

      expect(await stored(f)).toEqual({
        status: 'COMPLEMENT_REQUESTED',
        info: PUBLIC_LABEL,
        message: 'Second message, plus precis.',
      });
      expect(h.outbox.outbox).toHaveLength(1);
      expect(h.outbox.outbox[0].text).toContain('Second message, plus precis.');
      expect(h.outbox.outbox[0].text).not.toContain('Premier message.');
      // Les DEUX actions sont tracees dans l'historique, avec leur administrateur.
      const { events } = await h.snapshot(f);
      expect(events.filter((e) => e.action === 'COMPLEMENT_REQUESTED')).toHaveLength(2);
    });

    it('apres un complement, la validation reste possible : le message est efface (ADR-0022)', async () => {
      const f = await h.registerFounder({ label: 'puis-validee' });
      await complement(f);
      expect((await h.validate(f.requestId)).status).toBe(200);
      expect(await stored(f)).toEqual({ status: 'ACTIVE', info: null, message: null });
    });
  });

  // -----------------------------------------------------------------------------------
  describe('echec d email (R6) : la demande de complement reste ACQUISE, tracee, renvoyable', () => {
    it("200 `sent: false`, statut et message conserves, echec dans l'historique ; l'administrateur relance", async () => {
      const f = await h.registerFounder({ label: 'email-ko' });
      h.outbox.failNext(1);
      const res = await complement(f);
      expect(res.status).toBe(200);
      expect((await res.json()).data).toMatchObject({
        status: 'COMPLEMENT_REQUESTED',
        complementEmail: { sent: false },
      });

      // L'acte est ACQUIS.
      expect(await stored(f)).toEqual({
        status: 'COMPLEMENT_REQUESTED',
        info: GOOGLE_LABEL,
        message: MESSAGE,
      });
      const s = await h.snapshot(f);
      expect(s.events[s.events.length - 1]).toMatchObject({
        action: 'EMAIL_FAILED',
        email_template: 'verification-complement',
        email_failure_retryable: true,
      });
      expect(h.outbox.outbox).toHaveLength(0);

      // L'administrateur relance : le message part tel que conserve, avec le Reply-To.
      const resend = await resendComplement(f);
      expect(resend.status).toBe(200);
      expect((await resend.json()).data).toEqual({ sent: true });
      expect(h.outbox.outbox).toHaveLength(1);
      expect(h.outbox.outbox[0].replyTo).toEqual({ email: 'verification@portesante.ma' });
      expect(h.outbox.outbox[0].text).toContain(MESSAGE.split('\n')[0]);
      const after = await h.snapshot(f);
      expect(after.events.map((e) => e.action).slice(-2)).toEqual([
        'EMAIL_RESEND_REQUESTED',
        'EMAIL_SENT',
      ]);
      expect(after.events[after.events.length - 2]).toMatchObject({
        actor_user_id: h.admin.userId,
      });
    });

    it('MEME une exception inattendue pendant l envoi ne remet pas l acte en cause', async () => {
      const f = await h.registerFounder({ label: 'email-exception' });
      const spy = jest
        .spyOn(h.emailService, 'sendTemplate')
        .mockRejectedValueOnce(new Error('panne inattendue'));
      try {
        const res = await complement(f);
        expect(res.status).toBe(200);
        expect((await res.json()).data.complementEmail).toEqual({ sent: false });
      } finally {
        spy.mockRestore();
      }
      expect((await stored(f)).status).toBe('COMPLEMENT_REQUESTED');
      const s = await h.snapshot(f);
      expect(s.events[s.events.length - 1]).toMatchObject({
        action: 'EMAIL_FAILED',
        email_failure_retryable: false,
      });
    });
  });

  // -----------------------------------------------------------------------------------
  describe("renvoi par l'administrateur", () => {
    it('garde anti-abus : un second renvoi dans les 60 s recoit 429 et n envoie rien ; apres le delai, il passe', async () => {
      const f = await h.registerFounder({ label: 'renvoi-delai' });
      await complement(f);
      h.outbox.reset();
      expect((await resendComplement(f)).status).toBe(200);
      expect((await resendComplement(f)).status).toBe(429);
      expect(h.outbox.outbox).toHaveLength(1);
      await h.adminPool.query(
        `UPDATE registration_requests SET last_email_resent_at = now() - interval '61 seconds' WHERE id = $1`,
        [f.requestId],
      );
      expect((await resendComplement(f)).status).toBe(200);
      expect(h.outbox.outbox).toHaveLength(2);
    });

    it('trois clics simultanes : un seul email part', async () => {
      const f = await h.registerFounder({ label: 'renvoi-parallele' });
      await complement(f);
      h.outbox.reset();
      const results = await Promise.all([
        resendComplement(f),
        resendComplement(f),
        resendComplement(f),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 429, 429]);
      expect(h.outbox.outbox).toHaveLength(1);
    });

    it('rien a renvoyer si la demande n est pas en attente de complement : 409 ; inconnue : 404', async () => {
      const f = await h.registerFounder({ label: 'renvoi-pas-compl' });
      expect((await resendComplement(f)).status).toBe(409);
      expect(h.outbox.outbox).toHaveLength(0);
      expect(
        (await resendComplement({ ...f, requestId: '01a13bd2-d439-7d64-be45-a77893aa0421' }))
          .status,
      ).toBe(404);
    });
  });

  // -----------------------------------------------------------------------------------
  describe("DE BOUT EN BOUT : le medecin renvoie l'email, A L'IDENTIQUE de celui de l'administrateur (ADR-0022)", () => {
    it('administrateur -> medecin : l email renvoye par le medecin est strictement identique', async () => {
      const f = await h.registerFounder({ label: 'identique-2', firstName: 'Omar' });
      const res = await requestComplement(f, {
        infoType: 'other',
        otherInfo: "une copie de votre carte d'inscription à l'Ordre",
        message: MESSAGE,
      });
      expect(res.status).toBe(200);
      const original = h.outbox.outbox[0];
      h.outbox.reset();

      // Le medecin clique « Renvoyer l'email » sur son ecran de statut (TASK-054).
      const resend = await h.call('POST', '/identity/registration-status/resend-email', f.cookie);
      expect(resend.status).toBe(200);
      expect(h.outbox.outbox).toHaveLength(1);
      const again = h.outbox.outbox[0];
      expect({
        subject: again.subject,
        html: again.html,
        text: again.text,
        replyTo: again.replyTo,
        to: again.to,
      }).toEqual({
        subject: original.subject,
        html: original.html,
        text: original.text,
        replyTo: original.replyTo,
        to: original.to,
      });
    });
  });

  // -----------------------------------------------------------------------------------
  describe("l'atomicite de l'acte : tout ou rien", () => {
    const FUNCTION = 'test_fail_complement_step';
    beforeAll(async () => {
      await h.adminPool.query(`
        CREATE OR REPLACE FUNCTION ${FUNCTION}() RETURNS trigger AS $$
        BEGIN
          RAISE EXCEPTION 'panne simulee pour le test d atomicite du complement';
        END $$ LANGUAGE plpgsql;
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
        (f: Founder) => `NEW.status = 'COMPLEMENT_REQUESTED' AND NEW.id = '${f.requestId}'`,
      ],
      [
        "l'inscription de l'action dans l'historique",
        'registration_events',
        'INSERT',
        (f: Founder) =>
          `NEW.action = 'COMPLEMENT_REQUESTED' AND NEW.registration_request_id = '${f.requestId}'`,
      ],
    ])(
      'panne a %s : 500, RIEN n est modifie, aucun email ; puis la meme demande reussit',
      async (_label, table, event, when) => {
        const f = await h.registerFounder({ label: `atom-${table}` });
        await h.adminPool.query(
          `CREATE TRIGGER ${FUNCTION}_${table} BEFORE ${event} ON ${table} FOR EACH ROW WHEN (${when(f)}) EXECUTE FUNCTION ${FUNCTION}()`,
        );
        try {
          const failed = await complement(f);
          expect(failed.status).toBe(500);
          expect(JSON.stringify(await failed.json())).toMatch(/rien n'a ete modifie/);
          expect(await stored(f)).toEqual({
            status: 'PENDING_VERIFICATION',
            info: null,
            message: null,
          });
          expect((await h.snapshot(f)).events.map((e) => e.action)).toEqual([
            'REQUEST_SUBMITTED',
            'EMAIL_SENT',
          ]);
          expect(h.outbox.outbox).toHaveLength(0);
        } finally {
          await h.adminPool.query(`DROP TRIGGER IF EXISTS ${FUNCTION}_${table} ON ${table}`);
        }
        expect((await complement(f)).status).toBe(200);
        expect((await stored(f)).status).toBe('COMPLEMENT_REQUESTED');
      },
    );
  });

  // -----------------------------------------------------------------------------------
  describe('actions simultanees : la demande est verrouillee, le resultat reste coherent', () => {
    it('deux demandes de complement en meme temps : les deux passent, l une apres l autre ; l etat final est celui de l une des deux', async () => {
      const f = await h.registerFounder({ label: 'simultane-compl' });
      const [a, b] = await Promise.all([complement(f, 'Message A.'), complement(f, 'Message B.')]);
      expect([a.status, b.status]).toEqual([200, 200]);
      const s = await stored(f);
      expect(['Message A.', 'Message B.']).toContain(s.message);
      expect(
        (await h.snapshot(f)).events.filter((e) => e.action === 'COMPLEMENT_REQUESTED'),
      ).toHaveLength(2);
      expect(h.outbox.outbox).toHaveLength(2);
    });

    it('un complement ET une validation en meme temps : toujours coherent, jamais « valide avec un complement en attente »', async () => {
      const f = await h.registerFounder({ label: 'simultane-valid' });
      const [c, v] = await Promise.all([complement(f), h.validate(f.requestId)]);
      // La validation reussit toujours depuis un etat ouvert ; le complement reussit s'il passe AVANT, sinon 409.
      expect(v.status).toBe(200);
      expect([200, 409]).toContain(c.status);
      const s = await h.snapshot(f);
      expect(s.request).toMatchObject({
        status: 'ACTIVE',
        complement_requested_info: null,
        complement_message: null,
      });
      expect(s.orgs).toHaveLength(1);
    });
  });
});
