import { compensateAccountCreation } from '../../src/business/registration/application/compensation';

// TASK-052 (ADR-0021, P1) : compensation fiabilisee -- relances, puis journal en cas
// d'echec persistant, sans donnee personnelle.

describe('compensateAccountCreation (TASK-052, P1)', () => {
  const noDelay = [0, 0, 0];

  it('supprime le compte au premier essai, sans rien journaliser', async () => {
    const deleteAccount = jest.fn().mockResolvedValue(undefined);
    const logger = { error: jest.fn() };

    await expect(compensateAccountCreation('user-1', deleteAccount, logger, noDelay)).resolves.toBe(
      true,
    );
    expect(deleteAccount).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('reessaie apres un echec transitoire et finit par supprimer le compte', async () => {
    const deleteAccount = jest
      .fn()
      .mockRejectedValueOnce(new Error('connexion perdue'))
      .mockResolvedValueOnce(undefined);
    const logger = { error: jest.fn() };

    await expect(compensateAccountCreation('user-2', deleteAccount, logger, noDelay)).resolves.toBe(
      true,
    );
    expect(deleteAccount).toHaveBeenCalledTimes(2);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('apres echec persistant : journalise une erreur technique, sans le detail de la panne', async () => {
    const deleteAccount = jest
      .fn()
      .mockRejectedValue(new Error('detail technique avec valeur sensible a@b.ma'));
    const logger = { error: jest.fn() };

    await expect(compensateAccountCreation('user-3', deleteAccount, logger, noDelay)).resolves.toBe(
      false,
    );
    expect(deleteAccount).toHaveBeenCalledTimes(3);
    expect(logger.error).toHaveBeenCalledTimes(1);
    const message = logger.error.mock.calls[0][0] as string;
    expect(message).toContain('user-3');
    expect(message).toContain('orphelin');
    expect(message).not.toContain('a@b.ma');
  });
});
