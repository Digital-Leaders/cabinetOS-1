import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminRequestDetailScreen } from './admin-request-detail';
import { AdminActionError, type AdminRequestDetail } from '../../lib/admin-client';
import { COMPLEMENT_DEFAULT_MESSAGE, REFUSAL_DEFAULT_MESSAGE } from './admin-action-messages';
import { translate } from './admin-test-utils';
import messages from '../../messages/fr.json';

// BUILD-004 etape 2, EA-018 / TASK-066 : les TROIS ACTIONS de l'administrateur, leurs fenetres de confirmation et leur
// branchement sur l'ecran de detail. Verifie : rien ne part sans le clic de confirmation ; un double clic n'envoie
// qu'UNE requete ; la fenetre ne se ferme pas pendant l'envoi ; une demande deja traitee (409) et un resultat incertain
// (reseau coupe) sont expliques et l'etat reel est relu ; le renvoi d'un email qui n'est pas parti.

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
const validateMock = jest.fn();
const complementMock = jest.fn();
const refuseMock = jest.fn();
const resendMock = jest.fn();
jest.mock('../../lib/admin-client', () => {
  const actual = jest.requireActual('../../lib/admin-client');
  return {
    ...actual,
    fetchAdminMe: async () => undefined,
    fetchRegistrationRequestDetail: (...args: unknown[]) => fetchDetailMock(...args),
    validateRegistrationRequest: (...args: unknown[]) => validateMock(...args),
    requestComplement: (...args: unknown[]) => complementMock(...args),
    refuseRegistrationRequest: (...args: unknown[]) => refuseMock(...args),
    resendRegistrationEmail: (...args: unknown[]) => resendMock(...args),
  };
});
jest.mock('../../lib/auth-client', () => ({ signOut: jest.fn() }));

const a = messages.Admin;
const d = a.detail;
const act_ = a.actions;

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
    structure: { name: 'Cabinet Dr Bennani', city: 'Casablanca', address: null },
    internalNote: null,
    complement: null,
    refusal: null,
    organizationId: null,
    history: [
      {
        id: 'e1',
        action: 'REQUEST_SUBMITTED',
        createdAt: '2026-09-28T12:00:00.000Z',
        actor: null,
        emailTemplate: null,
        emailFailureRetryable: null,
      },
    ],
    ...overrides,
  };
}

const failedEmail = (template: string) => ({
  id: 'e2',
  action: 'EMAIL_FAILED',
  createdAt: '2026-09-28T12:05:00.000Z',
  actor: null,
  emailTemplate: template,
  emailFailureRetryable: true,
});
const sentEmail = (template: string, id = 'e3') => ({
  id,
  action: 'EMAIL_SENT',
  createdAt: '2026-09-28T12:10:00.000Z',
  actor: null,
  emailTemplate: template,
  emailFailureRetryable: null,
});

async function renderDetail(overrides: Partial<AdminRequestDetail> = {}, locale = 'fr') {
  fetchDetailMock.mockResolvedValue(detail(overrides));
  render(<AdminRequestDetailScreen locale={locale} id="r1" />);
  await screen.findByText(/Youssef Bennani/);
}

beforeEach(() => {
  [
    pushMock,
    replaceMock,
    fetchDetailMock,
    validateMock,
    complementMock,
    refuseMock,
    resendMock,
  ].forEach((m) => m.mockReset());
});

const open = async (user: ReturnType<typeof userEvent.setup>, label: string) => {
  await user.click(screen.getByRole('button', { name: label }));
  return screen.getByRole('dialog');
};

/** Une promesse que le test resout a la main : pour observer l'etat « envoi en cours ». */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// ---------------------------------------------------------------------------------------
describe('fenetre « Valider »', () => {
  it('annonce ce que la validation declenche, ensemble, puis l email a part (maquette), sans rien envoyer', async () => {
    const user = userEvent.setup();
    await renderDetail();
    const dialog = await open(user, d.actions.validate);

    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('heading', { name: act_.validate.title })).toBeInTheDocument();
    expect(within(dialog).getByText(/Dr Youssef Bennani/)).toBeInTheDocument();
    for (const step of Object.values(act_.validate.steps)) {
      expect(within(dialog).getByText(step)).toBeInTheDocument();
    }
    expect(within(dialog).getByText(act_.validate.then)).toBeInTheDocument();
    expect(validateMock).not.toHaveBeenCalled();
  });

  it.each([
    [
      '« Annuler »',
      async (u: ReturnType<typeof userEvent.setup>) =>
        u.click(screen.getByRole('button', { name: act_.cancel })),
    ],
    ['la touche Echap', async (u: ReturnType<typeof userEvent.setup>) => u.keyboard('{Escape}')],
    [
      'un clic a cote de la fenetre',
      async (u: ReturnType<typeof userEvent.setup>) =>
        u.click(document.querySelector('.ad-overlay')!),
    ],
  ])('%s ferme la fenetre sans rien envoyer', async (_label, close) => {
    const user = userEvent.setup();
    await renderDetail();
    await open(user, d.actions.validate);
    await close(user);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(validateMock).not.toHaveBeenCalled();
  });

  it('confirmer : UNE requete, fenetre fermee, resultat affiche, et l etat REEL relu depuis le serveur', async () => {
    const user = userEvent.setup();
    validateMock.mockResolvedValue({ organizationId: 'org-1', emailSent: true });
    await renderDetail();
    fetchDetailMock.mockResolvedValue(detail({ status: 'ACTIVE', organizationId: 'org-1' }));

    await open(user, d.actions.validate);
    await user.click(screen.getByRole('button', { name: act_.validate.confirm }));

    await waitFor(() => expect(validateMock).toHaveBeenCalledTimes(1));
    expect(validateMock).toHaveBeenCalledWith('r1');
    expect(await screen.findByRole('status')).toHaveTextContent(d.notices.validate);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // La demande est RELUE : l'ecran montre le statut renvoye par le serveur, et les actions ont disparu.
    await waitFor(() => expect(fetchDetailMock).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('button', { name: d.actions.validate })).not.toBeInTheDocument();
  });

  it('DOUBLE CLIC sur « Confirmer » : une seule requete (verrou synchrone, pas seulement un etat)', async () => {
    const user = userEvent.setup();
    const pending = deferred<{ organizationId: string; emailSent: boolean }>();
    validateMock.mockReturnValue(pending.promise);
    await renderDetail();
    await open(user, d.actions.validate);
    const confirm = screen.getByRole('button', { name: act_.validate.confirm });

    // Deux soumissions dans le MEME instant, avant tout nouveau rendu de React.
    const form = confirm.closest('form')!;
    act(() => {
      form.requestSubmit();
      form.requestSubmit();
    });

    expect(validateMock).toHaveBeenCalledTimes(1);
    pending.resolve({ organizationId: 'org-1', emailSent: true });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(validateMock).toHaveBeenCalledTimes(1);
  });

  it('PENDANT l envoi : la fenetre ne se ferme pas (ni Echap, ni clic a cote, ni Annuler) et indique l envoi', async () => {
    const user = userEvent.setup();
    const pending = deferred<{ organizationId: string; emailSent: boolean }>();
    validateMock.mockReturnValue(pending.promise);
    await renderDetail();
    await open(user, d.actions.validate);
    await user.click(screen.getByRole('button', { name: act_.validate.confirm }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('aria-busy', 'true');
    expect(within(dialog).getByRole('button', { name: act_.sending })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: act_.cancel })).toBeDisabled();
    // Quand le bouton qui avait le focus devient inactif, le focus quitte la fenetre et Echap ne lui parviendrait
    // plus : on le replace DANS la fenetre, sinon ce test ne solliciterait jamais le garde qu'il pretend verifier.
    act(() => dialog.focus());
    expect(dialog).toHaveFocus();
    await user.keyboard('{Escape}');
    await user.click(document.querySelector('.ad-overlay')!);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    pending.resolve({ organizationId: 'org-1', emailSent: true });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('409 (deja traitee, par exemple par un AUTRE administrateur) : expliquee, fenetre fermee, etat reel relu', async () => {
    const user = userEvent.setup();
    validateMock.mockRejectedValue(new AdminActionError('CONFLICT'));
    await renderDetail();
    fetchDetailMock.mockResolvedValue(detail({ status: 'ACTIVE', organizationId: 'org-1' }));

    await open(user, d.actions.validate);
    await user.click(screen.getByRole('button', { name: act_.validate.confirm }));

    expect(await screen.findByRole('alert')).toHaveTextContent(d.notices.conflict);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(fetchDetailMock).toHaveBeenCalledTimes(2));
  });

  it('RESEAU COUPE (resultat incertain) : on n invite PAS a reessayer a l aveugle, on relit l etat reel', async () => {
    const user = userEvent.setup();
    validateMock.mockRejectedValue(new AdminActionError('UNCERTAIN'));
    await renderDetail();
    await open(user, d.actions.validate);
    await user.click(screen.getByRole('button', { name: act_.validate.confirm }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(d.notices.uncertain);
    expect(alert).toHaveTextContent(/vérifiez l'état de la demande avant de réessayer/);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(fetchDetailMock).toHaveBeenCalledTimes(2));
    expect(validateMock).toHaveBeenCalledTimes(1);
  });

  it('erreur SERVEUR : rien n a ete modifie, la fenetre reste ouverte et on peut reessayer', async () => {
    const user = userEvent.setup();
    validateMock.mockRejectedValueOnce(new AdminActionError('SERVER'));
    validateMock.mockResolvedValueOnce({ organizationId: 'org-1', emailSent: true });
    await renderDetail();
    await open(user, d.actions.validate);
    await user.click(screen.getByRole('button', { name: act_.validate.confirm }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/rien n'a été modifié/);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: act_.validate.confirm });
    expect(retry).toBeEnabled();
    await user.click(retry);
    await waitFor(() => expect(validateMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('session expiree (401) : retour a la connexion', async () => {
    const user = userEvent.setup();
    validateMock.mockRejectedValue(new AdminActionError('UNAUTHENTICATED'));
    await renderDetail();
    await open(user, d.actions.validate);
    await user.click(screen.getByRole('button', { name: act_.validate.confirm }));
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/fr/login'));
  });
});

// ---------------------------------------------------------------------------------------
describe('fenetre « Demander un complement »', () => {
  it('trois choix (fiche Google par defaut), message PRE-REMPLI et modifiable, rien d envoye', async () => {
    const user = userEvent.setup();
    await renderDetail();
    const dialog = await open(user, d.actions.complement);

    const radios = within(dialog).getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(
      within(dialog).getByRole('radio', { name: act_.complement.types.google_listing }),
    ).toBeChecked();
    expect(within(dialog).getByLabelText(new RegExp(act_.complement.messageLabel))).toHaveValue(
      COMPLEMENT_DEFAULT_MESSAGE,
    );
    expect(complementMock).not.toHaveBeenCalled();
  });

  it('envoyer avec les valeurs par defaut : type, message tel quel, et AUCUNE precision', async () => {
    const user = userEvent.setup();
    complementMock.mockResolvedValue({ emailSent: true });
    await renderDetail();
    fetchDetailMock.mockResolvedValue(
      detail({ status: 'COMPLEMENT_REQUESTED', complement: { requestedInfo: 'x', message: 'y' } }),
    );
    await open(user, d.actions.complement);
    await user.click(screen.getByRole('button', { name: act_.complement.confirm }));

    await waitFor(() => expect(complementMock).toHaveBeenCalledTimes(1));
    expect(complementMock).toHaveBeenCalledWith('r1', {
      infoType: 'google_listing',
      message: COMPLEMENT_DEFAULT_MESSAGE,
    });
    expect(await screen.findByRole('status')).toHaveTextContent(d.notices.complement);
  });

  it('« Autre information » : un champ de precision apparait, OBLIGATOIRE ; il part avec la demande', async () => {
    const user = userEvent.setup();
    complementMock.mockResolvedValue({ emailSent: true });
    await renderDetail();
    const dialog = await open(user, d.actions.complement);

    expect(within(dialog).queryByLabelText(act_.complement.otherLabel)).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('radio', { name: act_.complement.types.other }));
    const other = within(dialog).getByLabelText(act_.complement.otherLabel);
    expect(screen.getByRole('button', { name: act_.complement.confirm })).toBeDisabled();

    await user.type(other, "  une copie de votre carte d'inscription  ");
    expect(screen.getByRole('button', { name: act_.complement.confirm })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: act_.complement.confirm }));

    await waitFor(() => expect(complementMock).toHaveBeenCalledTimes(1));
    expect(complementMock).toHaveBeenCalledWith('r1', {
      infoType: 'other',
      otherInfo: "une copie de votre carte d'inscription",
      message: COMPLEMENT_DEFAULT_MESSAGE,
    });
  });

  it('revenir a un type predefini n envoie plus la precision ; changer de type ne reecrit PAS le message modifie', async () => {
    const user = userEvent.setup();
    complementMock.mockResolvedValue({ emailSent: true });
    await renderDetail();
    const dialog = await open(user, d.actions.complement);

    const message = within(dialog).getByLabelText(new RegExp(act_.complement.messageLabel));
    await user.clear(message);
    await user.type(message, 'Mon message modifie.');
    await user.click(within(dialog).getByRole('radio', { name: act_.complement.types.other }));
    await user.type(within(dialog).getByLabelText(act_.complement.otherLabel), 'Texte');
    await user.click(
      within(dialog).getByRole('radio', { name: act_.complement.types.other_public_presence }),
    );
    expect(message).toHaveValue('Mon message modifie.');

    await user.click(screen.getByRole('button', { name: act_.complement.confirm }));
    await waitFor(() => expect(complementMock).toHaveBeenCalledTimes(1));
    expect(complementMock).toHaveBeenCalledWith('r1', {
      infoType: 'other_public_presence',
      message: 'Mon message modifie.',
    });
  });

  it('message vide ou blanc : l envoi est impossible', async () => {
    const user = userEvent.setup();
    await renderDetail();
    const dialog = await open(user, d.actions.complement);
    const message = within(dialog).getByLabelText(new RegExp(act_.complement.messageLabel));
    await user.clear(message);
    expect(screen.getByRole('button', { name: act_.complement.confirm })).toBeDisabled();
    await user.type(message, '   ');
    expect(screen.getByRole('button', { name: act_.complement.confirm })).toBeDisabled();
    expect(complementMock).not.toHaveBeenCalled();
  });

  it('saisie refusee par le serveur (400) : message dans la fenetre, qui reste ouverte avec la saisie', async () => {
    const user = userEvent.setup();
    complementMock.mockRejectedValue(new AdminActionError('INVALID'));
    await renderDetail();
    const dialog = await open(user, d.actions.complement);
    await user.click(screen.getByRole('button', { name: act_.complement.confirm }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(act_.errors.invalid);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(dialog).getByLabelText(new RegExp(act_.complement.messageLabel))).toHaveValue(
      COMPLEMENT_DEFAULT_MESSAGE,
    );
  });

  it('double soumission : une seule requete', async () => {
    const user = userEvent.setup();
    const pending = deferred<{ emailSent: boolean }>();
    complementMock.mockReturnValue(pending.promise);
    await renderDetail();
    await open(user, d.actions.complement);
    const form = screen.getByRole('button', { name: act_.complement.confirm }).closest('form')!;
    act(() => {
      form.requestSubmit();
      form.requestSubmit();
    });
    expect(complementMock).toHaveBeenCalledTimes(1);
    pending.resolve({ emailSent: true });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

// ---------------------------------------------------------------------------------------
describe('fenetre « Refuser » : deux champs distincts (R8)', () => {
  it('motif interne (vide, marque « non communique », obligatoire) et message au demandeur (pre-rempli) : DEUX champs', async () => {
    const user = userEvent.setup();
    await renderDetail();
    const dialog = await open(user, d.actions.refuse);

    const reason = within(dialog).getByLabelText(act_.refuse.reasonLabel);
    const message = within(dialog).getByLabelText(new RegExp(act_.refuse.messageLabel));
    expect(reason).not.toBe(message);
    expect(reason).toHaveValue('');
    expect(message).toHaveValue(REFUSAL_DEFAULT_MESSAGE);
    expect(reason).toBeRequired();
    expect(within(dialog).getByText(act_.refuse.definitive)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: act_.refuse.confirm })).toBeDisabled();
    expect(refuseMock).not.toHaveBeenCalled();
  });

  it('confirmer : les DEUX champs, nettoyes, partent separes ; resultat affiche ; etat reel relu', async () => {
    const user = userEvent.setup();
    refuseMock.mockResolvedValue({ emailSent: true });
    await renderDetail();
    fetchDetailMock.mockResolvedValue(
      detail({
        status: 'REFUSED',
        refusal: { internalReason: 'INPE introuvable', messageToApplicant: 'Message' },
      }),
    );
    const dialog = await open(user, d.actions.refuse);

    await user.type(within(dialog).getByLabelText(act_.refuse.reasonLabel), '  INPE introuvable  ');
    await user.click(screen.getByRole('button', { name: act_.refuse.confirm }));

    await waitFor(() => expect(refuseMock).toHaveBeenCalledTimes(1));
    expect(refuseMock).toHaveBeenCalledWith('r1', {
      internalReason: 'INPE introuvable',
      messageToApplicant: REFUSAL_DEFAULT_MESSAGE,
    });
    expect(await screen.findByRole('status')).toHaveTextContent(d.notices.refuse);
    await waitFor(() => expect(fetchDetailMock).toHaveBeenCalledTimes(2));
  });

  it.each([
    ['textes identiques', 'Dossier incomplet', 'Dossier incomplet'],
    ['espaces et casse differents', 'Dossier incomplet', '  DOSSIER   incomplet '],
  ])(
    '%s dans les deux champs : message d erreur, envoi IMPOSSIBLE (le motif serait communique)',
    async (_label, reason, message) => {
      const user = userEvent.setup();
      await renderDetail();
      const dialog = await open(user, d.actions.refuse);
      const messageField = within(dialog).getByLabelText(new RegExp(act_.refuse.messageLabel));
      await user.clear(messageField);
      await user.type(messageField, message);
      await user.type(within(dialog).getByLabelText(act_.refuse.reasonLabel), reason);

      expect(within(dialog).getByRole('alert')).toHaveTextContent(act_.refuse.sameText);
      expect(screen.getByRole('button', { name: act_.refuse.confirm })).toBeDisabled();
      expect(refuseMock).not.toHaveBeenCalled();
    },
  );

  it('message au demandeur vide : envoi impossible meme avec un motif', async () => {
    const user = userEvent.setup();
    await renderDetail();
    const dialog = await open(user, d.actions.refuse);
    await user.type(within(dialog).getByLabelText(act_.refuse.reasonLabel), 'Un motif');
    await user.clear(within(dialog).getByLabelText(new RegExp(act_.refuse.messageLabel)));
    expect(screen.getByRole('button', { name: act_.refuse.confirm })).toBeDisabled();
  });

  it('Annuler / Echap : rien n est envoye, et le motif saisi disparait avec la fenetre (jamais conserve ailleurs)', async () => {
    const user = userEvent.setup();
    await renderDetail();
    let dialog = await open(user, d.actions.refuse);
    await user.type(
      within(dialog).getByLabelText(act_.refuse.reasonLabel),
      'MOTIF-SECRET-A-NE-PAS-GARDER',
    );
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(refuseMock).not.toHaveBeenCalled();
    // Le motif n'apparait nulle part sur l'ecran...
    expect(document.body).not.toHaveTextContent('MOTIF-SECRET-A-NE-PAS-GARDER');
    // ...et une nouvelle ouverture repart d'un champ vide.
    dialog = await open(user, d.actions.refuse);
    expect(within(dialog).getByLabelText(act_.refuse.reasonLabel)).toHaveValue('');
  });

  it('double soumission : une seule requete de refus', async () => {
    const user = userEvent.setup();
    const pending = deferred<{ emailSent: boolean }>();
    refuseMock.mockReturnValue(pending.promise);
    await renderDetail();
    const dialog = await open(user, d.actions.refuse);
    await user.type(within(dialog).getByLabelText(act_.refuse.reasonLabel), 'Un motif');
    const form = screen.getByRole('button', { name: act_.refuse.confirm }).closest('form')!;
    act(() => {
      form.requestSubmit();
      form.requestSubmit();
    });
    expect(refuseMock).toHaveBeenCalledTimes(1);
    pending.resolve({ emailSent: true });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('409 : deja traitee, expliquee ; erreur serveur : rien modifie, on peut reessayer', async () => {
    const user = userEvent.setup();
    refuseMock.mockRejectedValueOnce(new AdminActionError('SERVER'));
    await renderDetail();
    const dialog = await open(user, d.actions.refuse);
    await user.type(within(dialog).getByLabelText(act_.refuse.reasonLabel), 'Un motif');
    await user.click(screen.getByRole('button', { name: act_.refuse.confirm }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/rien n'a été modifié/);

    refuseMock.mockRejectedValueOnce(new AdminActionError('CONFLICT'));
    await user.click(screen.getByRole('button', { name: act_.refuse.confirm }));
    expect(await screen.findByText(d.notices.conflict)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------------------
describe('accessibilite des fenetres', () => {
  it('le focus ENTRE dans la fenetre a l ouverture et REVIENT au bouton d origine a la fermeture', async () => {
    const user = userEvent.setup();
    await renderDetail();
    const trigger = screen.getByRole('button', { name: d.actions.complement });
    await user.click(trigger);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    await user.keyboard('{Escape}');
    expect(trigger).toHaveFocus();
  });

  it('Tab reste DANS la fenetre (le focus tourne), Maj+Tab aussi', async () => {
    const user = userEvent.setup();
    await renderDetail();
    const dialog = await open(user, d.actions.validate);
    const confirm = within(dialog).getByRole('button', { name: act_.validate.confirm });
    const cancel = within(dialog).getByRole('button', { name: act_.cancel });

    confirm.focus();
    await user.tab();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(document.activeElement).toBe(cancel);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(confirm);
  });

  it('la fenetre est nommee par son titre, et le bandeau de resultat est annonce (role status / alert)', async () => {
    const user = userEvent.setup();
    validateMock.mockResolvedValue({ organizationId: 'o', emailSent: true });
    await renderDetail();
    const dialog = await open(user, d.actions.validate);
    expect(dialog).toHaveAccessibleName(act_.validate.title);
    await user.click(screen.getByRole('button', { name: act_.validate.confirm }));
    expect(await screen.findByRole('status')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------------------
describe("renvoi d'un email qui n'est pas parti (derive de l'historique)", () => {
  const cases = [
    ['ACTIVE', 'account-activation', 'activation'],
    ['COMPLEMENT_REQUESTED', 'verification-complement', 'complement'],
    ['REFUSED', 'registration-refusal', 'refusal'],
  ] as const;

  it.each(cases)(
    '%s : dernier email en echec -> avertissement et bouton ; il renvoie le BON email (%s)',
    async (status, template, kind) => {
      const user = userEvent.setup();
      resendMock.mockResolvedValue({ sent: true });
      await renderDetail({
        status,
        organizationId: status === 'ACTIVE' ? 'org-1' : null,
        complement: status === 'COMPLEMENT_REQUESTED' ? { requestedInfo: 'x', message: 'y' } : null,
        refusal: status === 'REFUSED' ? { internalReason: 'm', messageToApplicant: 'n' } : null,
        history: [detail().history[0], failedEmail(template)],
      });
      expect(screen.getByRole('alert')).toHaveTextContent(
        (act_.emailRetry.message as Record<string, string>)[kind],
      );
      fetchDetailMock.mockResolvedValue(
        detail({
          status,
          history: [detail().history[0], failedEmail(template), sentEmail(template)],
        }),
      );

      await user.click(screen.getByRole('button', { name: act_.emailRetry.button }));
      await waitFor(() => expect(resendMock).toHaveBeenCalledWith('r1', kind));
      expect(await screen.findByRole('status')).toHaveTextContent(d.notices.resent);
      await waitFor(() => expect(fetchDetailMock).toHaveBeenCalledTimes(2));
      // L'historique relu montre l'envoi reussi : l'avertissement a disparu.
      expect(
        screen.queryByRole('button', { name: act_.emailRetry.button }),
      ).not.toBeInTheDocument();
    },
  );

  it.each([
    ['dernier email envoye', 'ACTIVE', [sentEmail('account-activation')]],
    [
      'echec PUIS succes',
      'ACTIVE',
      [failedEmail('account-activation'), sentEmail('account-activation')],
    ],
    [
      'echec d un AUTRE modele que celui du statut',
      'ACTIVE',
      [failedEmail('registration-confirmation')],
    ],
    [
      'demande en verification (aucun email a renvoyer d ici)',
      'PENDING_VERIFICATION',
      [failedEmail('registration-confirmation')],
    ],
    ['aucun email dans l historique', 'ACTIVE', []],
  ] as const)('%s : AUCUN avertissement', async (_label, status, emails) => {
    await renderDetail({
      status,
      organizationId: status === 'ACTIVE' ? 'org-1' : null,
      history: [detail().history[0], ...emails],
    });
    expect(screen.queryByRole('button', { name: act_.emailRetry.button })).not.toBeInTheDocument();
  });

  it('un renvoi trop rapproche (429) : explique, le bouton reste disponible', async () => {
    const user = userEvent.setup();
    resendMock.mockRejectedValue(new AdminActionError('TOO_SOON'));
    await renderDetail({
      status: 'ACTIVE',
      organizationId: 'org-1',
      history: [detail().history[0], failedEmail('account-activation')],
    });
    await user.click(screen.getByRole('button', { name: act_.emailRetry.button }));
    expect(await screen.findByText(act_.emailRetry.tooSoon)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: act_.emailRetry.button })).toBeEnabled();
  });

  it('le renvoi echoue encore (sent: false) : message clair, pas de faux succes', async () => {
    const user = userEvent.setup();
    resendMock.mockResolvedValue({ sent: false });
    await renderDetail({
      status: 'ACTIVE',
      organizationId: 'org-1',
      history: [detail().history[0], failedEmail('account-activation')],
    });
    await user.click(screen.getByRole('button', { name: act_.emailRetry.button }));
    expect(await screen.findByText(act_.emailRetry.failed)).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('double clic sur « Renvoyer l email » : une seule requete', async () => {
    const user = userEvent.setup();
    const pending = deferred<{ sent: boolean }>();
    resendMock.mockReturnValue(pending.promise);
    await renderDetail({
      status: 'ACTIVE',
      organizationId: 'org-1',
      history: [detail().history[0], failedEmail('account-activation')],
    });
    const button = screen.getByRole('button', { name: act_.emailRetry.button });
    await user.dblClick(button);
    expect(resendMock).toHaveBeenCalledTimes(1);
    pending.resolve({ sent: true });
  });
});
