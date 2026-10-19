import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminRequestDetailScreen } from './admin-request-detail';
import { AdminApiError, type AdminRequestDetail } from '../../lib/admin-client';
import { translate } from './admin-test-utils';
import messages from '../../messages/fr.json';

// BUILD-004 etape 2, EA-017 / TASK-060 : detail d'une demande (brief §5.4). LECTURE SEULE : on
// examine une declaration, on ne la reecrit pas. Seule la note interne est enregistrable. Les
// trois actions sont affichees mais inertes (EA-018), et seulement sur une demande ouverte.

jest.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, values?: Record<string, string | number>) =>
    translate(messages as Record<string, unknown>, ns, key, values),
}));

const pushMock = jest.fn();
const replaceMock = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
}));

const fetchDetailMock = jest.fn();
const saveNoteMock = jest.fn();
jest.mock('../../lib/admin-client', () => {
  const actual = jest.requireActual('../../lib/admin-client');
  return {
    ...actual,
    fetchAdminMe: async () => undefined,
    fetchRegistrationRequestDetail: (...args: unknown[]) => fetchDetailMock(...args),
    saveInternalNote: (...args: unknown[]) => saveNoteMock(...args),
  };
});
jest.mock('../../lib/auth-client', () => ({ signOut: jest.fn() }));

const a = messages.Admin;
const d = a.detail;

function detail(overrides: Partial<AdminRequestDetail> = {}): AdminRequestDetail {
  return {
    id: 'r1',
    status: 'PENDING_VERIFICATION',
    createdAt: '2026-09-28T12:00:00.000Z',
    updatedAt: '2026-09-28T12:00:00.000Z',
    doctor: {
      firstName: 'Youssef',
      lastName: 'Bennani',
      email: 'y.bennani@cabinet.ma',
      specialty: 'cardiologie',
      inpe: '123456789',
      numeroOrdre: null,
    },
    structure: { name: 'Cabinet Dr Bennani', city: 'Casablanca', address: 'Rue Ibn Sina, Maârif' },
    internalNote: null,
    complement: null,
    refusal: null,
    organizationId: null,
    history: [
      {
        id: 'h1',
        action: 'REQUEST_SUBMITTED',
        createdAt: '2026-09-28T12:00:00.000Z',
        actor: null,
        emailTemplate: null,
        emailFailureRetryable: null,
      },
      {
        id: 'h2',
        action: 'EMAIL_SENT',
        createdAt: '2026-09-28T12:00:05.000Z',
        actor: null,
        emailTemplate: 'registration-confirmation',
        emailFailureRetryable: null,
      },
    ],
    ...overrides,
  };
}

async function renderDetail(overrides: Partial<AdminRequestDetail> = {}, locale = 'fr') {
  fetchDetailMock.mockResolvedValue(detail(overrides));
  render(<AdminRequestDetailScreen locale={locale} id="r1" />);
  await screen.findByText(/Youssef Bennani/);
}

beforeEach(() => {
  pushMock.mockReset();
  replaceMock.mockReset();
  fetchDetailMock.mockReset();
  saveNoteMock.mockReset();
});

describe('AdminRequestDetailScreen (TASK-060)', () => {
  describe('en-tete et donnees declarees', () => {
    it('nom, specialite, statut et date de reception, comme la maquette', async () => {
      await renderDetail();
      expect(screen.getByText('Dr Youssef Bennani')).toBeInTheDocument();
      expect(screen.getByText(a.status.PENDING_VERIFICATION)).toBeInTheDocument();
      expect(screen.getByText('Demande reçue le 28/09/2026')).toBeInTheDocument();
      expect(fetchDetailMock).toHaveBeenCalledWith('r1');
    });

    it('deux blocs : Medecin (6 champs) et Structure d exercice (3 champs), avec l email EN CLAIR', async () => {
      await renderDetail();
      const doctor = screen.getByRole('heading', { name: d.doctor }).closest('section')!;
      for (const [label, value] of [
        [d.fields.firstName, 'Youssef'],
        [d.fields.lastName, 'Bennani'],
        [d.fields.email, 'y.bennani@cabinet.ma'],
        [d.fields.specialty, 'Cardiologie'],
        [d.fields.inpe, '123456789'],
      ]) {
        const row = within(doctor).getByText(label).parentElement!;
        expect(row).toHaveTextContent(value);
      }
      const structure = screen.getByRole('heading', { name: d.structure }).closest('section')!;
      expect(within(structure).getByText('Cabinet Dr Bennani')).toBeInTheDocument();
      expect(within(structure).getByText('Casablanca')).toBeInTheDocument();
      expect(within(structure).getByText('Rue Ibn Sina, Maârif')).toBeInTheDocument();
    });

    it('champs facultatifs absents : « non renseigne »', async () => {
      await renderDetail({
        doctor: { ...detail().doctor, inpe: null, numeroOrdre: null },
        structure: { name: 'Cabinet', city: 'Rabat', address: null },
      });
      expect(screen.getAllByText(a.notSpecified)).toHaveLength(3);
    });

    it('l email, l INPE et le N° d Ordre s affichent de gauche a droite meme en arabe', async () => {
      await renderDetail({ doctor: { ...detail().doctor, numeroOrdre: 'ORD-42' } }, 'ar');
      expect(screen.getByText('y.bennani@cabinet.ma')).toHaveAttribute('dir', 'ltr');
      expect(screen.getByText('123456789')).toHaveAttribute('dir', 'ltr');
      expect(screen.getByText('ORD-42')).toHaveAttribute('dir', 'ltr');
    });
  });

  describe('LECTURE SEULE : les donnees declarees ne sont pas modifiables', () => {
    it('le SEUL champ de saisie de l ecran est la note interne', async () => {
      await renderDetail();
      const fields = [...screen.queryAllByRole('textbox'), ...screen.queryAllByRole('combobox')];
      expect(fields).toHaveLength(1);
      expect(fields[0]).toBe(screen.getByRole('textbox', { name: d.note.label }));
      expect(document.querySelectorAll('input:not([type="hidden"])')).toHaveLength(0);
      expect(document.querySelectorAll('select')).toHaveLength(0);
    });

    it('aucun appel d ecriture a l ouverture : seul le detail est lu', async () => {
      await renderDetail();
      expect(saveNoteMock).not.toHaveBeenCalled();
      expect(fetchDetailMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('complement et refus', () => {
    it('complement demande : l equipe voit ce qui a ete demande', async () => {
      await renderDetail({
        status: 'COMPLEMENT_REQUESTED',
        complement: {
          requestedInfo: 'le lien de votre fiche Google',
          message: 'Merci de nous envoyer le lien.',
        },
      });
      expect(screen.getByRole('heading', { name: d.complement.title })).toBeInTheDocument();
      expect(screen.getByText('le lien de votre fiche Google')).toBeInTheDocument();
      expect(screen.getByText('Merci de nous envoyer le lien.')).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: d.refusal.title })).not.toBeInTheDocument();
    });

    it('refusee : motif interne (marque « non communique ») et message au demandeur, separes', async () => {
      await renderDetail({
        status: 'REFUSED',
        refusal: {
          internalReason: 'Aucune trace professionnelle.',
          messageToApplicant: 'Nous ne pouvons pas donner suite.',
        },
      });
      expect(screen.getByRole('heading', { name: d.refusal.title })).toBeInTheDocument();
      expect(screen.getByText(d.refusal.internalReason)).toBeInTheDocument();
      expect(screen.getByText('Aucune trace professionnelle.')).toBeInTheDocument();
      expect(screen.getByText(d.refusal.message)).toBeInTheDocument();
      expect(screen.getByText('Nous ne pouvons pas donner suite.')).toBeInTheDocument();
    });

    it('demande en verification : ni bloc de complement, ni bloc de refus', async () => {
      await renderDetail();
      expect(screen.queryByRole('heading', { name: d.complement.title })).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: d.refusal.title })).not.toBeInTheDocument();
    });
  });

  describe('raccourcis de recherche (brief §5.4)', () => {
    it('trois liens pre-remplis, ouverts dans un nouvel onglet, sans transmettre l origine', async () => {
      await renderDetail();
      const google = screen.getByRole('link', { name: new RegExp(d.verify.google) });
      const maps = screen.getByRole('link', { name: new RegExp(d.verify.maps) });
      const directory = screen.getByRole('link', { name: new RegExp(d.verify.directory) });

      expect(new URL(google.getAttribute('href')!).searchParams.get('q')).toBe(
        'Youssef Bennani Cardiologie Casablanca',
      );
      expect(new URL(maps.getAttribute('href')!).searchParams.get('query')).toBe(
        'Cabinet Dr Bennani Rue Ibn Sina, Maârif Casablanca',
      );
      expect(new URL(directory.getAttribute('href')!).searchParams.get('q')).toBe(
        'annuaire médical Youssef Bennani Cardiologie Casablanca',
      );
      for (const link of [google, maps, directory]) {
        expect(link).toHaveAttribute('target', '_blank');
        expect(link.getAttribute('rel')).toContain('noopener');
        expect(link.getAttribute('rel')).toContain('noreferrer');
      }
    });

    it('rappelle que CabinetOS ne conclut jamais automatiquement', async () => {
      await renderDetail();
      expect(screen.getByText(d.verify.note)).toBeInTheDocument();
      expect(d.verify.note).toMatch(/ne conclut jamais automatiquement/);
    });
  });

  describe('note interne (facultative, jamais communiquee au medecin)', () => {
    it('affiche la note existante ; « Enregistrer » est inactif tant que rien n a change', async () => {
      await renderDetail({ internalNote: 'Fiche Google concordante.' });
      expect(screen.getByRole('textbox', { name: d.note.label })).toHaveValue(
        'Fiche Google concordante.',
      );
      expect(screen.getByRole('button', { name: d.note.save })).toBeDisabled();
      expect(screen.getByText(d.note.sub)).toBeInTheDocument();
    });

    it('enregistre la note saisie, affiche « Note enregistree », puis redevient inactif', async () => {
      saveNoteMock.mockResolvedValue({
        internalNote: 'À vérifier demain.',
        updatedAt: '2026-10-19T10:00:00.000Z',
      });
      const user = userEvent.setup();
      await renderDetail();
      await user.type(screen.getByRole('textbox', { name: d.note.label }), 'À vérifier demain.');
      await user.click(screen.getByRole('button', { name: d.note.save }));

      expect(await screen.findByText(d.note.saved)).toBeInTheDocument();
      expect(saveNoteMock).toHaveBeenCalledWith('r1', 'À vérifier demain.');
      expect(screen.getByRole('button', { name: d.note.save })).toBeDisabled();
    });

    it('affiche la valeur NORMALISEE par le serveur (espaces retires)', async () => {
      saveNoteMock.mockResolvedValue({
        internalNote: 'propre',
        updatedAt: '2026-10-19T10:00:00.000Z',
      });
      const user = userEvent.setup();
      await renderDetail();
      await user.type(screen.getByRole('textbox', { name: d.note.label }), '   propre   ');
      await user.click(screen.getByRole('button', { name: d.note.save }));

      await waitFor(() =>
        expect(screen.getByRole('textbox', { name: d.note.label })).toHaveValue('propre'),
      );
    });

    it('vider la note l efface (elle est facultative)', async () => {
      saveNoteMock.mockResolvedValue({ internalNote: null, updatedAt: '2026-10-19T10:00:00.000Z' });
      const user = userEvent.setup();
      await renderDetail({ internalNote: 'a effacer' });
      await user.clear(screen.getByRole('textbox', { name: d.note.label }));
      await user.click(screen.getByRole('button', { name: d.note.save }));

      expect(await screen.findByText(d.note.saved)).toBeInTheDocument();
      expect(saveNoteMock).toHaveBeenCalledWith('r1', '');
      expect(screen.getByRole('textbox', { name: d.note.label })).toHaveValue('');
    });

    it('echec : message clair, la saisie est conservee, on peut reessayer', async () => {
      saveNoteMock.mockRejectedValueOnce(new AdminApiError('UNEXPECTED'));
      const user = userEvent.setup();
      await renderDetail();
      await user.type(screen.getByRole('textbox', { name: d.note.label }), 'important');
      await user.click(screen.getByRole('button', { name: d.note.save }));

      expect(await screen.findByRole('alert')).toHaveTextContent(d.note.error);
      expect(screen.getByRole('textbox', { name: d.note.label })).toHaveValue('important');
      expect(screen.getByRole('button', { name: d.note.save })).toBeEnabled();
    });

    it('limite de 2000 caracteres, comme le serveur', async () => {
      await renderDetail();
      expect(screen.getByRole('textbox', { name: d.note.label })).toHaveAttribute(
        'maxlength',
        '2000',
      );
    });

    it('le message « Note enregistree » disparait des qu on retape', async () => {
      saveNoteMock.mockResolvedValue({ internalNote: 'un', updatedAt: '2026-10-19T10:00:00.000Z' });
      const user = userEvent.setup();
      await renderDetail();
      await user.type(screen.getByRole('textbox', { name: d.note.label }), 'un');
      await user.click(screen.getByRole('button', { name: d.note.save }));
      await screen.findByText(d.note.saved);

      await user.type(screen.getByRole('textbox', { name: d.note.label }), ' deux');
      expect(screen.queryByText(d.note.saved)).not.toBeInTheDocument();
    });
  });

  describe('historique (date, action, admin)', () => {
    it('chronologique, au format jj/mm de la maquette', async () => {
      await renderDetail();
      const timeline = screen.getByRole('heading', { name: d.history.title }).closest('section')!;
      const items = within(timeline).getAllByText(/\d{2}\/\d{2}/);
      expect(items).toHaveLength(2);
      expect(items[0]).toHaveTextContent('28/09');
      expect(within(timeline).getByText(d.history.actions.REQUEST_SUBMITTED)).toBeInTheDocument();
      expect(
        within(timeline).getByText(d.history.emailSent['registration-confirmation']),
      ).toBeInTheDocument();
    });

    it('chaque modele d email a son libelle (envoye, echec, renvoi)', async () => {
      const templates = [
        'registration-confirmation',
        'verification-complement',
        'account-activation',
        'registration-refusal',
      ] as const;
      await renderDetail({
        history: templates.flatMap((template, i) => [
          {
            id: `s${i}`,
            action: 'EMAIL_SENT',
            createdAt: '2026-09-28T12:00:00.000Z',
            actor: null,
            emailTemplate: template,
            emailFailureRetryable: null,
          },
          {
            id: `f${i}`,
            action: 'EMAIL_FAILED',
            createdAt: '2026-09-28T12:00:00.000Z',
            actor: null,
            emailTemplate: template,
            emailFailureRetryable: false,
          },
          {
            id: `r${i}`,
            action: 'EMAIL_RESEND_REQUESTED',
            createdAt: '2026-09-28T12:00:00.000Z',
            actor: null,
            emailTemplate: template,
            emailFailureRetryable: null,
          },
        ]),
      });
      for (const template of templates) {
        expect(screen.getByText(d.history.emailSent[template])).toBeInTheDocument();
        expect(screen.getByText(d.history.emailFailed[template])).toBeInTheDocument();
        expect(screen.getByText(d.history.emailResend[template])).toBeInTheDocument();
      }
    });

    it('un echec d envoi renvoyable le dit', async () => {
      await renderDetail({
        history: [
          {
            id: 'f',
            action: 'EMAIL_FAILED',
            createdAt: '2026-09-28T12:00:00.000Z',
            actor: null,
            emailTemplate: 'account-activation',
            emailFailureRetryable: true,
          },
        ],
      });
      expect(
        screen.getByText(`${d.history.emailFailed['account-activation']} (${d.history.retryable})`),
      ).toBeInTheDocument();
    });

    it('une action d administrateur porte son NOM', async () => {
      await renderDetail({
        history: [
          {
            id: 'v',
            action: 'RETURNED_TO_VERIFICATION',
            createdAt: '2026-09-29T12:00:00.000Z',
            actor: { id: 'u1', name: 'Zineb Admin' },
            emailTemplate: null,
            emailFailureRetryable: null,
          },
        ],
      });
      expect(
        screen.getByText(`${d.history.actions.RETURNED_TO_VERIFICATION} — par Zineb Admin`),
      ).toBeInTheDocument();
    });

    it('une action inconnue (future) ne casse pas l ecran', async () => {
      await renderDetail({
        history: [
          {
            id: 'x',
            action: 'ACTION_FUTURE',
            createdAt: '2026-09-29T12:00:00.000Z',
            actor: null,
            emailTemplate: null,
            emailFailureRetryable: null,
          },
        ],
      });
      expect(screen.getByText(d.history.unknown)).toBeInTheDocument();
    });
  });

  describe('les trois actions : affichees, INERTES (EA-018), seulement sur une demande ouverte', () => {
    it.each(['PENDING_VERIFICATION', 'COMPLEMENT_REQUESTED'] as const)(
      '%s : trois boutons inactifs et la mention « bientot disponibles »',
      async (status) => {
        await renderDetail({
          status,
          complement:
            status === 'COMPLEMENT_REQUESTED' ? { requestedInfo: 'x', message: 'y' } : null,
        });
        for (const label of [d.actions.validate, d.actions.complement, d.actions.refuse]) {
          expect(screen.getByRole('button', { name: label })).toBeDisabled();
        }
        expect(screen.getByText(d.actions.soon)).toBeInTheDocument();
      },
    );

    it.each([
      ['ACTIVE', null],
      ['REFUSED', { internalReason: 'm', messageToApplicant: 'n' }],
    ] as const)('%s : aucune action, la demande est close', async (status, refusal) => {
      await renderDetail({ status, refusal });
      for (const label of [d.actions.validate, d.actions.complement, d.actions.refuse]) {
        expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
      }
      expect(screen.queryByText(d.actions.soon)).not.toBeInTheDocument();
    });

    it('un clic sur une action inerte ne fait rien : aucun appel, aucune navigation', async () => {
      const user = userEvent.setup();
      await renderDetail();
      await user.click(screen.getByRole('button', { name: d.actions.validate }));
      expect(saveNoteMock).not.toHaveBeenCalled();
      expect(pushMock).not.toHaveBeenCalled();
    });
  });

  describe('navigation et erreurs', () => {
    it('« Retour aux demandes » ramene a la liste, dans la langue courante', async () => {
      const user = userEvent.setup();
      await renderDetail({}, 'ar');
      const back = screen.getByRole('link', { name: new RegExp(a.back) });
      expect(back).toHaveAttribute('href', '/ar/admin');
      await user.click(back);
      expect(pushMock).toHaveBeenCalledWith('/ar/admin');
    });

    it('demande introuvable (404) : message dedie, avec le retour', async () => {
      fetchDetailMock.mockRejectedValue(new AdminApiError('NOT_FOUND'));
      render(<AdminRequestDetailScreen locale="fr" id="inconnu" />);
      expect(await screen.findByRole('alert')).toHaveTextContent(d.notFound);
      expect(screen.getByRole('link', { name: new RegExp(a.back) })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: a.retry })).not.toBeInTheDocument();
    });

    it('panne : message clair et « Reessayer » relit la demande', async () => {
      fetchDetailMock.mockRejectedValueOnce(new AdminApiError('UNEXPECTED'));
      fetchDetailMock.mockResolvedValueOnce(detail());
      const user = userEvent.setup();
      render(<AdminRequestDetailScreen locale="fr" id="r1" />);
      expect(await screen.findByRole('alert')).toHaveTextContent(d.error);
      await user.click(screen.getByRole('button', { name: a.retry }));
      expect(await screen.findByText('Dr Youssef Bennani')).toBeInTheDocument();
    });

    it('session expiree (401) : retour a la connexion', async () => {
      fetchDetailMock.mockRejectedValue(new AdminApiError('UNAUTHENTICATED'));
      render(<AdminRequestDetailScreen locale="fr" id="r1" />);
      await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/fr/login'));
    });
  });
});
