import { readFileSync } from 'fs';
import { join } from 'path';
import {
  REGISTRATION_EMAIL_TEMPLATES,
  REGISTRATION_EVENT_ACTIONS,
  REGISTRATION_STATUSES,
} from '../../src/business/registration';

// BUILD-004 etape 2, EA-017 / TASK-060 : l'espace admin (apps/web) traduit chaque statut, chaque
// action d'historique et chaque modele d'email. Le front ne peut pas importer le code de l'API ; ce
// test lit ses traductions et les compare aux listes du serveur. S'il echoue, une valeur a ete
// ajoutee d'un seul cote : l'ecran afficherait « Action inconnue », ou une cle de traduction brute.

const load = (lang: 'fr' | 'ar') =>
  JSON.parse(
    readFileSync(
      join(__dirname, '..', '..', '..', 'web', 'src', 'messages', `${lang}.json`),
      'utf-8',
    ),
  ).Admin;

const EMAIL_ACTIONS = ['EMAIL_SENT', 'EMAIL_FAILED', 'EMAIL_RESEND_REQUESTED'];

describe.each(['fr', 'ar'] as const)(
  'libelles de l espace admin (%s) alignes sur l API',
  (lang) => {
    const admin = load(lang);

    it('un libelle par statut', () => {
      expect(Object.keys(admin.status).sort()).toEqual([...REGISTRATION_STATUSES].sort());
    });

    it('un libelle par action d historique qui n est pas un email', () => {
      const plain = REGISTRATION_EVENT_ACTIONS.filter((action) => !EMAIL_ACTIONS.includes(action));
      expect(Object.keys(admin.detail.history.actions).sort()).toEqual([...plain].sort());
    });

    it.each(['emailSent', 'emailFailed', 'emailResend'])(
      'un libelle %s par modele d email',
      (group) => {
        expect(Object.keys(admin.detail.history[group]).sort()).toEqual(
          [...REGISTRATION_EMAIL_TEMPLATES].sort(),
        );
      },
    );

    it('les actions d email de l API sont bien celles que l ecran sait afficher', () => {
      const emailActions = REGISTRATION_EVENT_ACTIONS.filter((action) =>
        EMAIL_ACTIONS.includes(action),
      );
      expect([...emailActions].sort()).toEqual([...EMAIL_ACTIONS].sort());
    });
  },
);
