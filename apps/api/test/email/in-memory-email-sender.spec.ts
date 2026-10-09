import { InMemoryEmailSender } from '../../src/modules/email/infrastructure/in-memory-email-sender.adapter';
import {
  EmailDeliveryError,
  type EmailMessage,
} from '../../src/modules/email/application/email-sender.port';

// EA-013 / TASK-049 : l'adaptateur en memoire, base des tests T2 et T3.

const message: EmailMessage = {
  to: { email: 'medecin@cabinet.ma' },
  from: { email: 'noreply@portesante.ma' },
  subject: 'Objet',
  html: '<p>Contenu</p>',
  text: 'Contenu',
};

describe('InMemoryEmailSender', () => {
  it('capture le message complet : destinataire, objet, contenu', async () => {
    const sender = new InMemoryEmailSender();
    const receipt = await sender.send(message);

    expect(receipt.messageId).toBe('memory-1');
    expect(sender.outbox).toHaveLength(1);
    expect(sender.outbox[0]).toMatchObject({
      to: { email: 'medecin@cabinet.ma' },
      subject: 'Objet',
      html: '<p>Contenu</p>',
      text: 'Contenu',
    });
  });

  it('failNext : le prochain envoi echoue, puis le renvoi fonctionne (prerequis de T2)', async () => {
    const sender = new InMemoryEmailSender();
    sender.failNext();

    await expect(sender.send(message)).rejects.toBeInstanceOf(EmailDeliveryError);
    expect(sender.outbox).toHaveLength(0);

    await expect(sender.send(message)).resolves.toBeDefined();
    expect(sender.outbox).toHaveLength(1);
  });

  it('failAll : tout echoue jusqu a restore()', async () => {
    const sender = new InMemoryEmailSender();
    sender.failAll();
    await expect(sender.send(message)).rejects.toBeInstanceOf(EmailDeliveryError);
    await expect(sender.send(message)).rejects.toBeInstanceOf(EmailDeliveryError);

    sender.restore();
    await expect(sender.send(message)).resolves.toBeDefined();
  });

  it('reset vide la boite d envoi', async () => {
    const sender = new InMemoryEmailSender();
    await sender.send(message);
    sender.reset();
    expect(sender.outbox).toHaveLength(0);
  });
});
