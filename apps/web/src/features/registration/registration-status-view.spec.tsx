import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RegistrationStatusScreen } from './registration-status-view';
import messages from '../../messages/fr.json';

// TASK-055 (BUILD-004 etape 2, EA-015) : la variante affichee suit le statut REEL du
// serveur ; le renvoi d'email respecte le delai anti-abus ; seul le message destine au
// demandeur est affiche en cas de refus.

function getNested(obj: unknown, path: string): string {
  const value = path
    .split('.')
    .reduce<unknown>((acc, key) => (acc as Record<string, unknown>)?.[key], obj);
  return typeof value === 'string' ? value : path;
}

jest.mock('next-intl', () => ({
  useTranslations: (namespace: string) => (key: string) =>
    getNested((messages as Record<string, unknown>)[namespace], key),
}));

const pushMock = jest.fn();
const replaceMock = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
}));

const fetchStatusMock = jest.fn();
const resendMock = jest.fn();
jest.mock('../../lib/registration-status-client', () => ({
  fetchRegistrationStatus: () => fetchStatusMock(),
  resendComplementEmail: () => resendMock(),
}));

const signOutMock = jest.fn().mockResolvedValue(undefined);
jest.mock('../../lib/auth-client', () => ({
  signOut: () => signOutMock(),
}));

const s = messages.RegistrationStatus;

beforeEach(() => {
  jest.useRealTimers();
  pushMock.mockReset();
  replaceMock.mockReset();
  fetchStatusMock.mockReset();
  resendMock.mockReset();
  signOutMock.mockClear();
  delete process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP;
  delete process.env.NEXT_PUBLIC_SUPPORT_PHONE;
});

describe('RegistrationStatusScreen (TASK-055)', () => {
  it('en verification : message, « rien a faire », email masque -- pas de bouton de renvoi', async () => {
    fetchStatusMock.mockResolvedValue({
      status: 'PENDING_VERIFICATION',
      maskedEmail: 'y•••••@cabinet.ma',
    });
    render(<RegistrationStatusScreen locale="fr" />);

    expect(await screen.findByRole('heading', { name: s.verification.title })).toBeInTheDocument();
    expect(screen.getByText(s.verification.nothingToDo)).toBeInTheDocument();
    expect(screen.getByTestId('masked-email')).toHaveTextContent('y•••••@cabinet.ma');
    expect(screen.queryByRole('button', { name: s.complement.resend })).not.toBeInTheDocument();
  });

  it('complement demande : message, consigne de reponse, bouton de renvoi et rappel indesirables', async () => {
    fetchStatusMock.mockResolvedValue({
      status: 'COMPLEMENT_REQUESTED',
      maskedEmail: 'y•••••@cabinet.ma',
      nextResendAllowedAt: null,
    });
    render(<RegistrationStatusScreen locale="fr" />);

    expect(await screen.findByRole('heading', { name: s.complement.title })).toBeInTheDocument();
    expect(screen.getByText(s.complement.replyStrong)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: s.complement.resend })).toBeEnabled();
    expect(screen.getByText(s.complement.spam)).toBeInTheDocument();
  });

  it('renvoi reussi : « ✓ Email renvoye », bouton bloque, puis reactive a la fin du delai', async () => {
    fetchStatusMock.mockResolvedValue({
      status: 'COMPLEMENT_REQUESTED',
      maskedEmail: 'y•••••@cabinet.ma',
      nextResendAllowedAt: null,
    });
    resendMock.mockResolvedValue({
      kind: 'SENT',
      nextResendAllowedAt: new Date(Date.now() + 300).toISOString(),
    });
    const user = userEvent.setup();
    render(<RegistrationStatusScreen locale="fr" />);
    await user.click(await screen.findByRole('button', { name: s.complement.resend }));

    const done = await screen.findByRole('button', { name: s.complement.resent });
    expect(done).toBeDisabled();
    // Un second clic pendant le delai ne declenche rien.
    await user.click(done);
    expect(resendMock).toHaveBeenCalledTimes(1);

    await waitFor(
      () => expect(screen.getByRole('button', { name: s.complement.resend })).toBeEnabled(),
      { timeout: 2000 },
    );
  });

  it('page rouverte peu apres un renvoi : le bouton reste bloque jusqu a l heure annoncee', async () => {
    fetchStatusMock.mockResolvedValue({
      status: 'COMPLEMENT_REQUESTED',
      maskedEmail: 'y•••••@cabinet.ma',
      nextResendAllowedAt: new Date(Date.now() + 60_000).toISOString(),
    });
    render(<RegistrationStatusScreen locale="fr" />);

    expect(await screen.findByRole('button', { name: s.complement.resent })).toBeDisabled();
  });

  it('echec d envoi : message clair, bouton bloque le temps du delai', async () => {
    fetchStatusMock.mockResolvedValue({
      status: 'COMPLEMENT_REQUESTED',
      maskedEmail: 'y•••••@cabinet.ma',
      nextResendAllowedAt: null,
    });
    resendMock.mockResolvedValue({
      kind: 'SEND_FAILED',
      nextResendAllowedAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const user = userEvent.setup();
    render(<RegistrationStatusScreen locale="fr" />);
    await user.click(await screen.findByRole('button', { name: s.complement.resend }));

    expect(await screen.findByRole('alert')).toHaveTextContent(s.complement.resendFailed);
    expect(screen.getByRole('button', { name: s.complement.resend })).toBeDisabled();
  });

  it('statut change entre-temps (409) : l ecran se recharge et suit le nouveau statut', async () => {
    fetchStatusMock
      .mockResolvedValueOnce({
        status: 'COMPLEMENT_REQUESTED',
        maskedEmail: 'y•••••@cabinet.ma',
        nextResendAllowedAt: null,
      })
      .mockResolvedValueOnce({ status: 'PENDING_VERIFICATION', maskedEmail: 'y•••••@cabinet.ma' });
    resendMock.mockResolvedValue({ kind: 'STATUS_CHANGED' });
    const user = userEvent.setup();
    render(<RegistrationStatusScreen locale="fr" />);
    await user.click(await screen.findByRole('button', { name: s.complement.resend }));

    expect(await screen.findByRole('heading', { name: s.verification.title })).toBeInTheDocument();
    expect(fetchStatusMock).toHaveBeenCalledTimes(2);
  });

  it('refusee : affiche uniquement le message destine au demandeur', async () => {
    fetchStatusMock.mockResolvedValue({
      status: 'REFUSED',
      maskedEmail: 'y•••••@cabinet.ma',
      refusalMessage: 'Nous ne pouvons pas donner suite. Contactez-nous.',
    });
    render(<RegistrationStatusScreen locale="fr" />);

    expect(await screen.findByRole('heading', { name: s.refused.title })).toBeInTheDocument();
    expect(
      screen.getByText('Nous ne pouvons pas donner suite. Contactez-nous.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: s.complement.resend })).not.toBeInTheDocument();
  });

  it.each([
    ['ACTIVE', { status: 'ACTIVE', maskedEmail: 'y•••••@cabinet.ma' }],
    ['compte sans demande', { status: null }],
  ])('%s : rien a montrer, on entre dans l application', async (_label, data) => {
    fetchStatusMock.mockResolvedValue(data);
    render(<RegistrationStatusScreen locale="ar" />);

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/ar'));
  });

  it('erreur de chargement : message clair et « Reessayer » qui relit le statut', async () => {
    fetchStatusMock
      .mockRejectedValueOnce(new Error('reseau'))
      .mockResolvedValueOnce({ status: 'PENDING_VERIFICATION', maskedEmail: 'y•••••@cabinet.ma' });
    const user = userEvent.setup();
    render(<RegistrationStatusScreen locale="fr" />);

    expect(await screen.findByRole('alert')).toHaveTextContent(s.loadError);
    await user.click(screen.getByRole('button', { name: s.retry }));
    expect(await screen.findByRole('heading', { name: s.verification.title })).toBeInTheDocument();
  });

  it('« Se deconnecter » ferme la session puis ramene a la connexion', async () => {
    fetchStatusMock.mockResolvedValue({
      status: 'PENDING_VERIFICATION',
      maskedEmail: 'y•••••@cabinet.ma',
    });
    const user = userEvent.setup();
    render(<RegistrationStatusScreen locale="fr" />);
    await user.click(await screen.findByRole('button', { name: s.logout }));

    expect(signOutMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/fr/login'));
  });

  it('contacts d aide non configures : aucun lien affiche (jamais de lien mort)', async () => {
    fetchStatusMock.mockResolvedValue({
      status: 'PENDING_VERIFICATION',
      maskedEmail: 'y•••••@cabinet.ma',
    });
    render(<RegistrationStatusScreen locale="fr" />);
    await screen.findByRole('heading', { name: s.verification.title });

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByText(s.help.title)).not.toBeInTheDocument();
  });

  it('contacts d aide configures : WhatsApp et telephone, liens normalises', async () => {
    process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP = '212 600 000 000';
    process.env.NEXT_PUBLIC_SUPPORT_PHONE = '+212 500 000 000';
    fetchStatusMock.mockResolvedValue({
      status: 'PENDING_VERIFICATION',
      maskedEmail: 'y•••••@cabinet.ma',
    });
    render(<RegistrationStatusScreen locale="fr" />);
    await screen.findByRole('heading', { name: s.verification.title });

    expect(screen.getByRole('link', { name: s.help.whatsapp })).toHaveAttribute(
      'href',
      'https://wa.me/212600000000',
    );
    expect(screen.getByRole('link', { name: s.help.phone })).toHaveAttribute(
      'href',
      'tel:+212500000000',
    );
  });
});
