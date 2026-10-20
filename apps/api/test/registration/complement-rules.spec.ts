import {
  COMPLEMENT_INFO_TYPES,
  MAX_COMPLEMENT_MESSAGE_LENGTH,
  MAX_OTHER_INFO_LENGTH,
  PREDEFINED_INFO_LABELS,
  requestedInfoLabel,
} from '../../src/business/registration/domain/complement-rules';

// BUILD-004 etape 2, EA-018 / TASK-064 : regles pures de la demande de complement (brief R7).

describe('types d information demandee (maquette admin)', () => {
  it('trois choix exactement : fiche Google, autre presence publique, autre a preciser', () => {
    expect([...COMPLEMENT_INFO_TYPES]).toEqual([
      'google_listing',
      'other_public_presence',
      'other',
    ]);
  });

  it('les deux types predefinis ont un libelle fixe, qui complete la phrase de l email', () => {
    expect(requestedInfoLabel('google_listing')).toBe(
      'le lien vers la fiche Google de votre établissement',
    );
    expect(requestedInfoLabel('other_public_presence')).toBe(
      'le lien vers une autre présence professionnelle publique',
    );
    expect(Object.keys(PREDEFINED_INFO_LABELS).sort()).toEqual([
      'google_listing',
      'other_public_presence',
    ]);
  });

  it('un type predefini ignore le texte « autre » eventuellement fourni : le libelle ne se laisse pas detourner', () => {
    expect(requestedInfoLabel('google_listing', 'tout autre chose')).toBe(
      PREDEFINED_INFO_LABELS.google_listing,
    );
  });

  it('« autre » : le texte saisi par l administrateur, sans espaces autour', () => {
    expect(
      requestedInfoLabel('other', "  une copie de votre carte d'inscription à l'Ordre  "),
    ).toBe("une copie de votre carte d'inscription à l'Ordre");
  });

  it.each([undefined, null, '', '   '])('« autre » sans precision (%j) : refuse', (missing) => {
    expect(() => requestedInfoLabel('other', missing)).toThrow(/exige de preciser/);
  });

  it('bornes : 2000 caracteres pour le message, 200 pour la precision', () => {
    expect(MAX_COMPLEMENT_MESSAGE_LENGTH).toBe(2000);
    expect(MAX_OTHER_INFO_LENGTH).toBe(200);
  });
});
