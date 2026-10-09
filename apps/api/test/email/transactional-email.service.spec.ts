import { Logger } from '@nestjs/common';
import { InMemoryEmailSender } from '../../src/modules/email/infrastructure/in-memory-email-sender.adapter';
import {
  TransactionalEmailService,
  type EmailOptions,
} from '../../src/modules/email/application/transactional-email.service';

// EA-013 / TASK-049-050 : point d'envoi central. Prerequis de T2 (decouplage) et T3.

const options: EmailOptions = {
  from: { email: 'noreply@portesante.ma', name: 'PorteSanté' },
  supportReplyTo: { email: 'verification@portesante.ma' },
};
const to = { email: 'medecin@cabinet.ma' };

describe('TransactionalEmailService', () => {
  let sender: InMemoryEmailSender;
  let service: TransactionalEmailService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    sender = new InMemoryEmailSender();
    service = new TransactionalEmailService(sender, options);
  });
  afterEach(() => jest.restoreAllMocks());

  it('un email "part" : capture avec expediteur, destinataire et modele', async () => {
    const result = await service.sendTemplate('registration-confirmation', to, { firstName: 'Y' });

    expect(result).toEqual({ ok: true, messageId: 'memory-1' });
    expect(sender.outbox).toHaveLength(1);
    expect(sender.outbox[0].from).toEqual(options.from);
    expect(sender.outbox[0].to).toEqual(to);
    expect(sender.outbox[0].subject).toMatch(/bien été reçue/);
  });

  it('Reply-To surveille uniquement sur la demande de complement (R7)', async () => {
    await service.sendTemplate('verification-complement', to, {
      firstName: 'S',
      requestedInfo: 'info',
      message: 'm',
    });
    await service.sendTemplate('registration-confirmation', to, { firstName: 'S' });

    expect(sender.outbox[0].replyTo).toEqual(options.supportReplyTo);
    expect(sender.outbox[1].replyTo).toBeUndefined();
  });

  it('un echec d envoi est REMONTE comme resultat, sans lever (prerequis de T2)', async () => {
    sender.failNext();

    const result = await service.sendTemplate('account-activation', to, {
      firstName: 'K',
      loginUrl: 'https://app.portesante.ma/fr/login',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retryable).toBe(true);
      expect(result.reason).toMatch(/Echec/);
    }
    expect(sender.outbox).toHaveLength(0);
  });

  it('le renvoi fonctionne apres un echec', async () => {
    sender.failNext();
    const params = { firstName: 'K', loginUrl: 'https://app.portesante.ma/fr/login' };

    expect((await service.sendTemplate('account-activation', to, params)).ok).toBe(false);
    expect((await service.sendTemplate('account-activation', to, params)).ok).toBe(true);
    expect(sender.outbox).toHaveLength(1);
  });

  it('une erreur de rendu (lien invalide) devient un echec non renvoyable, rien n est envoye', async () => {
    const result = await service.sendTemplate('account-activation', to, {
      firstName: 'K',
      loginUrl: 'javascript:alert(1)',
    });

    expect(result).toMatchObject({ ok: false, retryable: false });
    expect(sender.outbox).toHaveLength(0);
  });

  it('le motif interne d un refus n atteint jamais le message capture (T3, niveau service)', async () => {
    const internal = 'MOTIF-INTERNE-CONFIDENTIEL';
    await service.sendTemplate('registration-refusal', to, {
      firstName: 'A',
      messageToApplicant: 'Nous ne pouvons pas donner suite.',
    });

    const sent = JSON.stringify(sender.outbox[0]);
    expect(sent).not.toContain(internal);
    expect(sent).toContain('Nous ne pouvons pas donner suite.');
  });
});
