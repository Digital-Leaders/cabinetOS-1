import { renderEmail, BRAND_NAME } from '../../src/modules/email/application/email-templates';

// EA-013 / TASK-050 : les quatre modeles.

describe('Modeles d email', () => {
  it('confirmation : objet, prenom, marque, version texte', () => {
    const mail = renderEmail('registration-confirmation', { firstName: 'Youssef' });
    expect(mail.subject).toMatch(/bien été reçue/);
    expect(mail.html).toContain('Bonjour Youssef,');
    expect(mail.html).toContain(BRAND_NAME);
    expect(mail.text).toContain('Bonjour Youssef,');
    expect(mail.text).toContain('rien à faire pour le moment');
  });

  it('complement : contient l information demandee et le message de l admin', () => {
    const mail = renderEmail('verification-complement', {
      firstName: 'Salma',
      requestedInfo: 'le lien de votre fiche Google',
      message: 'Merci de nous indiquer votre fiche.\nCordialement.',
    });
    expect(mail.html).toContain('le lien de votre fiche Google');
    expect(mail.html).toContain('Merci de nous indiquer votre fiche.<br>Cordialement.');
    expect(mail.text).toContain('répondre directement à cet email');
  });

  it('activation : lien de connexion dans le bouton et en texte', () => {
    const mail = renderEmail('account-activation', {
      firstName: 'Karim',
      loginUrl: 'https://app.portesante.ma/fr/login',
    });
    expect(mail.html).toContain('href="https://app.portesante.ma/fr/login"');
    expect(mail.text).toContain('https://app.portesante.ma/fr/login');
  });

  it('activation : refuse un lien qui n est pas http(s)', () => {
    expect(() =>
      renderEmail('account-activation', { firstName: 'X', loginUrl: 'javascript:alert(1)' }),
    ).toThrow(/invalide/);
    expect(() =>
      renderEmail('account-activation', { firstName: 'X', loginUrl: 'pas une url' }),
    ).toThrow(/invalide/);
  });

  it('echappe le HTML saisi par l utilisateur ou l admin', () => {
    const mail = renderEmail('verification-complement', {
      firstName: '<b>Zineb</b>',
      requestedInfo: 'info',
      message: '<script>alert(1)</script>',
    });
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).not.toContain('<b>Zineb</b>');
    expect(mail.html).toContain('&lt;script&gt;');
  });

  it('refus : n affiche que le message au demandeur, jamais un motif interne (prerequis de T3)', () => {
    const mail = renderEmail('registration-refusal', {
      firstName: 'Amina',
      messageToApplicant: 'Nous ne pouvons pas donner suite. Contactez-nous si besoin.',
      // Un appelant qui tenterait de passer un motif interne : il n'est lu nulle part.
      ...({ internalReason: 'MOTIF-INTERNE-CONFIDENTIEL' } as object),
    } as { firstName: string; messageToApplicant: string });
    expect(mail.html).toContain('Nous ne pouvons pas donner suite.');
    expect(mail.html).not.toContain('MOTIF-INTERNE-CONFIDENTIEL');
    expect(mail.text).not.toContain('MOTIF-INTERNE-CONFIDENTIEL');
    expect(mail.subject).not.toContain('MOTIF-INTERNE-CONFIDENTIEL');
  });

  it('theme clair force dans le HTML de chaque modele', () => {
    const mails = [
      renderEmail('registration-confirmation', { firstName: 'A' }),
      renderEmail('verification-complement', { firstName: 'A', requestedInfo: 'i', message: 'm' }),
      renderEmail('account-activation', { firstName: 'A', loginUrl: 'https://x.ma' }),
      renderEmail('registration-refusal', { firstName: 'A', messageToApplicant: 'm' }),
    ];
    for (const mail of mails) {
      expect(mail.html).toContain('<meta name="color-scheme" content="light">');
    }
  });
});
