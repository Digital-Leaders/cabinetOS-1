import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminRequestsList } from './admin-requests-list';
import { AdminApiError, type AdminListItem } from '../../lib/admin-client';
import { translate, visible } from './admin-test-utils';
import messages from '../../messages/fr.json';

// BUILD-004 etape 2, EA-017 / TASK-060 : liste des demandes (brief §5.3). Filtrage, recherche et
// pagination sont faits par le SERVEUR (TASK-059) : ici on prouve que l'ecran les demande
// correctement, affiche exactement ce qu'il recoit, et ne montre jamais une reponse perimee.

jest.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, values?: Record<string, string | number>) =>
    translate(messages as Record<string, unknown>, ns, key, values),
}));

const pushMock = jest.fn();
const replaceMock = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
}));

const fetchListMock = jest.fn();
jest.mock('../../lib/admin-client', () => {
  const actual = jest.requireActual('../../lib/admin-client');
  return {
    ...actual,
    fetchAdminMe: async () => undefined,
    fetchRegistrationRequests: (...args: unknown[]) => fetchListMock(...args),
  };
});
jest.mock('../../lib/auth-client', () => ({ signOut: jest.fn() }));

const a = messages.Admin;
const reg = messages.Registration;
const COUNTS = { pending: 3, validated: 1, refused: 2 };

function item(overrides: Partial<AdminListItem> = {}): AdminListItem {
  return {
    id: 'r1',
    firstName: 'Youssef',
    lastName: 'Bennani',
    specialty: 'cardiologie',
    structureName: 'Cabinet Dr Bennani',
    city: 'Casablanca',
    status: 'PENDING_VERIFICATION',
    createdAt: '2026-09-28T12:00:00.000Z',
    ...overrides,
  };
}
const page = (items: AdminListItem[], nextCursor: string | null = null, counts = COUNTS) => ({
  items,
  nextCursor,
  counts,
});

beforeEach(() => {
  pushMock.mockReset();
  replaceMock.mockReset();
  fetchListMock.mockReset();
  fetchListMock.mockResolvedValue(page([item()]));
});

describe('AdminRequestsList (TASK-060)', () => {
  it('« A traiter » par defaut : une ligne comme la maquette (monogramme, nom, specialite, cabinet, ville, badge, date)', async () => {
    render(<AdminRequestsList locale="fr" />);

    expect(await screen.findByText('Dr Youssef Bennani')).toBeInTheDocument();
    expect(screen.getByText('YB')).toBeInTheDocument();
    expect(screen.getByText('Cardiologie · Cabinet Dr Bennani · Casablanca')).toBeInTheDocument();
    expect(screen.getByText(a.status.PENDING_VERIFICATION)).toBeInTheDocument();
    expect(screen.getByText('28/09/2026')).toBeInTheDocument();
    expect(fetchListMock).toHaveBeenCalledWith({ filter: 'pending', q: '', limit: 20 });
    expect(screen.getByRole('tab', { name: new RegExp(a.filters.pending) })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('le badge « A traiter » affiche le compteur du serveur, les autres onglets n en ont pas (maquette)', async () => {
    render(<AdminRequestsList locale="fr" />);
    // Le compteur arrive avec la premiere reponse du serveur, pas avec l'onglet.
    await screen.findByText('Dr Youssef Bennani');
    const pending = screen.getByRole('tab', { name: new RegExp(a.filters.pending) });
    expect(within(pending).getByText('3')).toBeInTheDocument();
    expect(
      within(screen.getByRole('tab', { name: a.filters.validated })).queryByText('1'),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('tab', { name: a.filters.refused })).queryByText('2'),
    ).not.toBeInTheDocument();
  });

  it('chaque statut a son badge', async () => {
    fetchListMock.mockResolvedValue(
      page([
        item({ id: '1', status: 'PENDING_VERIFICATION' }),
        item({ id: '2', status: 'COMPLEMENT_REQUESTED' }),
        item({ id: '3', status: 'ACTIVE' }),
        item({ id: '4', status: 'REFUSED' }),
      ]),
    );
    render(<AdminRequestsList locale="fr" />);
    for (const status of [
      'PENDING_VERIFICATION',
      'COMPLEMENT_REQUESTED',
      'ACTIVE',
      'REFUSED',
    ] as const) {
      expect(await screen.findByText(a.status[status])).toBeInTheDocument();
    }
  });

  describe('TOUTE la ligne est cliquable', () => {
    it('c est un vrai lien vers le detail, dans la langue courante', async () => {
      render(<AdminRequestsList locale="ar" />);
      const row = (await screen.findByText(/Youssef Bennani/)).closest('a')!;
      expect(row).toHaveAttribute('href', '/ar/admin/r1');
    });

    it('clic n importe ou sur la ligne (nom, badge, date, marge) : navigation vers le detail', async () => {
      const user = userEvent.setup();
      render(<AdminRequestsList locale="fr" />);
      const row = (await screen.findByText('Dr Youssef Bennani')).closest('a')!;

      for (const target of [
        screen.getByText('Dr Youssef Bennani'),
        screen.getByText(a.status.PENDING_VERIFICATION),
        screen.getByText('28/09/2026'),
        screen.getByText('YB'),
        row,
      ]) {
        pushMock.mockClear();
        await user.click(target);
        expect(pushMock).toHaveBeenCalledWith('/fr/admin/r1');
      }
    });

    it('clic avec Ctrl (nouvel onglet) : le navigateur garde son comportement, aucune navigation interne', async () => {
      render(<AdminRequestsList locale="fr" />);
      const row = (await screen.findByText('Dr Youssef Bennani')).closest('a')!;
      fireEvent.click(row, { ctrlKey: true });
      expect(pushMock).not.toHaveBeenCalled();
    });
  });

  describe('onglets', () => {
    it.each([
      ['validated', a.filters.validated],
      ['refused', a.filters.refused],
    ])(
      '« %s » : demande au serveur le bon filtre, sans refiltrer cote ecran',
      async (filter, label) => {
        const user = userEvent.setup();
        render(<AdminRequestsList locale="fr" />);
        await screen.findByText('Dr Youssef Bennani');

        fetchListMock.mockResolvedValue(
          page([item({ id: 'x', firstName: 'Salma', lastName: 'Tazi' })]),
        );
        await user.click(screen.getByRole('tab', { name: label }));

        expect(await screen.findByText('Dr Salma Tazi')).toBeInTheDocument();
        expect(fetchListMock).toHaveBeenLastCalledWith({ filter, q: '', limit: 20 });
        expect(screen.getByRole('tab', { name: label })).toHaveAttribute('aria-selected', 'true');
        expect(screen.queryByText('Dr Youssef Bennani')).not.toBeInTheDocument();
      },
    );
  });

  describe('recherche', () => {
    it('appliquee apres une pause de frappe : une seule requete pour « fik », pas une par lettre', async () => {
      const user = userEvent.setup();
      render(<AdminRequestsList locale="fr" />);
      await screen.findByText('Dr Youssef Bennani');
      fetchListMock.mockClear();

      await user.type(screen.getByRole('searchbox', { name: a.search.label }), 'fik');
      await waitFor(
        () =>
          expect(fetchListMock).toHaveBeenCalledWith({ filter: 'pending', q: 'fik', limit: 20 }),
        {
          timeout: 2000,
        },
      );
      const queries = fetchListMock.mock.calls.map(([params]) => params.q);
      expect(queries).toEqual(['fik']);
    });

    it('la recherche se combine avec l onglet courant', async () => {
      const user = userEvent.setup();
      render(<AdminRequestsList locale="fr" />);
      await screen.findByText('Dr Youssef Bennani');
      await user.click(screen.getByRole('tab', { name: a.filters.refused }));
      fetchListMock.mockClear();

      await user.type(screen.getByRole('searchbox', { name: a.search.label }), 'tazi');
      await waitFor(
        () =>
          expect(fetchListMock).toHaveBeenCalledWith({ filter: 'refused', q: 'tazi', limit: 20 }),
        {
          timeout: 2000,
        },
      );
    });
  });

  describe('etats vides', () => {
    it.each([
      ['pending', a.list.empty.pending, a.filters.pending],
      ['validated', a.list.empty.validated, a.filters.validated],
      ['refused', a.list.empty.refused, a.filters.refused],
    ])('onglet %s sans demande : message dedie', async (_filter, message, tabLabel) => {
      const user = userEvent.setup();
      fetchListMock.mockResolvedValue(page([]));
      render(<AdminRequestsList locale="fr" />);
      await user.click(await screen.findByRole('tab', { name: new RegExp(tabLabel) }));
      expect(await screen.findByText(message)).toBeInTheDocument();
    });

    it('recherche sans resultat : message dedie, pas celui de l onglet', async () => {
      const user = userEvent.setup();
      render(<AdminRequestsList locale="fr" />);
      await screen.findByText('Dr Youssef Bennani');
      fetchListMock.mockResolvedValue(page([]));

      await user.type(screen.getByRole('searchbox', { name: a.search.label }), 'introuvable');
      expect(
        await screen.findByText(a.list.empty.search, {}, { timeout: 2000 }),
      ).toBeInTheDocument();
    });
  });

  describe('pagination par curseur', () => {
    it('« Afficher plus » apparait quand une page suivante existe, ajoute les lignes, puis disparait', async () => {
      const user = userEvent.setup();
      fetchListMock.mockResolvedValueOnce(page([item({ id: '1' })], 'CURSOR-2'));
      render(<AdminRequestsList locale="fr" />);
      await screen.findByText('Dr Youssef Bennani');

      fetchListMock.mockResolvedValueOnce(
        page([item({ id: '2', firstName: 'Omar', lastName: 'Fikri' })], null),
      );
      await user.click(screen.getByRole('button', { name: a.loadMore }));

      expect(await screen.findByText('Dr Omar Fikri')).toBeInTheDocument();
      expect(screen.getByText('Dr Youssef Bennani')).toBeInTheDocument();
      expect(fetchListMock).toHaveBeenLastCalledWith({
        filter: 'pending',
        q: '',
        cursor: 'CURSOR-2',
        limit: 20,
      });
      expect(screen.queryByRole('button', { name: a.loadMore })).not.toBeInTheDocument();
    });

    it('derniere page : pas de bouton', async () => {
      render(<AdminRequestsList locale="fr" />);
      await screen.findByText('Dr Youssef Bennani');
      expect(screen.queryByRole('button', { name: a.loadMore })).not.toBeInTheDocument();
    });
  });

  describe('reponses perimees', () => {
    it('une reponse lente arrivee APRES un changement d onglet est ignoree', async () => {
      const user = userEvent.setup();
      let resolveSlow!: (value: unknown) => void;
      fetchListMock.mockReturnValueOnce(new Promise((r) => (resolveSlow = r)));
      render(<AdminRequestsList locale="fr" />);

      fetchListMock.mockResolvedValueOnce(
        page([item({ id: 'ok', firstName: 'Salma', lastName: 'Tazi' })]),
      );
      // Les onglets n'apparaissent qu'apres le controle d'acces de la coque.
      await user.click(await screen.findByRole('tab', { name: a.filters.validated }));
      expect(await screen.findByText('Dr Salma Tazi')).toBeInTheDocument();

      // La premiere requete (« A traiter ») repond enfin : elle ne doit rien changer.
      resolveSlow(page([item({ id: 'late', firstName: 'Perime', lastName: 'Perime' })]));
      await new Promise((r) => setTimeout(r, 50));
      expect(screen.queryByText('Dr Perime Perime')).not.toBeInTheDocument();
      expect(screen.getByText('Dr Salma Tazi')).toBeInTheDocument();
    });
  });

  describe('erreurs', () => {
    it('panne : message clair, « Reessayer » relance', async () => {
      const user = userEvent.setup();
      fetchListMock.mockRejectedValueOnce(new AdminApiError('UNEXPECTED'));
      render(<AdminRequestsList locale="fr" />);

      expect(await screen.findByRole('alert')).toHaveTextContent(a.list.error);
      await user.click(screen.getByRole('button', { name: a.retry }));
      expect(await screen.findByText('Dr Youssef Bennani')).toBeInTheDocument();
    });

    it('session expiree pendant la consultation (401) : retour a la connexion', async () => {
      fetchListMock.mockRejectedValue(new AdminApiError('UNAUTHENTICATED'));
      render(<AdminRequestsList locale="fr" />);
      await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/fr/login'));
    });
  });

  describe('contenu et langue', () => {
    it('un code de specialite inconnu s affiche tel quel au lieu de casser l ecran', async () => {
      fetchListMock.mockResolvedValue(page([item({ specialty: 'specialite_future' })]));
      render(<AdminRequestsList locale="fr" />);
      expect(await screen.findByText(/specialite_future · Cabinet/)).toBeInTheDocument();
    });

    it('le generaliste a son libelle', async () => {
      fetchListMock.mockResolvedValue(page([item({ specialty: 'generaliste' })]));
      render(<AdminRequestsList locale="fr" />);
      expect(await screen.findByText(new RegExp(reg.specialties.generaliste))).toBeInTheDocument();
    });

    it('en arabe : date a chiffres latins, lien dans la bonne langue', async () => {
      render(<AdminRequestsList locale="ar" />);
      await screen.findByText(/Youssef Bennani/);
      expect(visible(screen.getByText(/2026/).textContent ?? '')).toBe('28/09/2026');
    });

    it('ne montre ni email, ni adresse, ni note : la liste n en recoit pas', async () => {
      render(<AdminRequestsList locale="fr" />);
      await screen.findByText('Dr Youssef Bennani');
      expect(document.body.textContent).not.toMatch(/@/);
    });
  });
});
