import {
  badgeClass,
  buildSearchShortcuts,
  formatDate,
  formatDayMonth,
  isOpenStatus,
} from './admin-format';

// TASK-060 : fonctions de presentation de l'espace admin.

describe('statuts', () => {
  it('seuls « en verification » et « complement demande » sont des demandes ouvertes', () => {
    expect(isOpenStatus('PENDING_VERIFICATION')).toBe(true);
    expect(isOpenStatus('COMPLEMENT_REQUESTED')).toBe(true);
    expect(isOpenStatus('ACTIVE')).toBe(false);
    expect(isOpenStatus('REFUSED')).toBe(false);
  });

  it('une classe de badge par statut (maquette : verif / compl / ok / no)', () => {
    expect(badgeClass('PENDING_VERIFICATION')).toBe('verif');
    expect(badgeClass('COMPLEMENT_REQUESTED')).toBe('compl');
    expect(badgeClass('ACTIVE')).toBe('ok');
    expect(badgeClass('REFUSED')).toBe('no');
  });
});

describe('dates', () => {
  // Le fuseau est FIXE dans ces tests : le jour d'un meme instant change selon le fuseau de la
  // machine (minuit UTC est deja « demain » a Casablanca l'ete, et midi UTC l'est a UTC+12). Un
  // test qui en depend reussit sur une machine et echoue sur une autre.
  const iso = '2026-09-28T12:00:00.000Z';
  const UTC = 'UTC';

  it('jj/mm/aaaa en francais', () => {
    expect(formatDate(iso, 'fr', UTC)).toBe('28/09/2026');
  });

  it('en arabe aussi : chiffres LATINS, lisibles partout', () => {
    // L'arabe insere des marques de direction invisibles autour des « / » : on les ignore.
    const visible = formatDate(iso, 'ar', UTC).replace(/[\u200e\u200f]/g, '');
    expect(visible).toBe('28/09/2026');
    expect(visible).not.toMatch(/[\u0660-\u0669]/);
  });

  it('jj/mm pour l historique, comme la maquette', () => {
    expect(formatDayMonth(iso, 'fr', UTC)).toBe('28/09');
  });

  it('langue inconnue : repli francais', () => {
    expect(formatDate(iso, 'xx', UTC)).toBe('28/09/2026');
  });

  it('le meme instant donne un jour different selon le fuseau : c est bien l heure DE L UTILISATEUR qui compte', () => {
    const lateEvening = '2026-09-28T23:30:00.000Z';
    expect(formatDate(lateEvening, 'fr', 'UTC')).toBe('28/09/2026');
    expect(formatDate(lateEvening, 'fr', 'Etc/GMT-1')).toBe('29/09/2026');
    expect(formatDate(lateEvening, 'fr', 'Etc/GMT+8')).toBe('28/09/2026');
  });

  it('sans fuseau explicite (comme l ecran) : le fuseau local de l utilisateur s applique', () => {
    // Attendu calcule par Intl dans le fuseau local de la machine : vrai quel que soit ce fuseau.
    const expected = new Intl.DateTimeFormat('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(new Date(iso));
    expect(formatDate(iso, 'fr')).toBe(expected);
  });
});

describe('raccourcis de recherche (brief §5.4)', () => {
  const detail = {
    doctor: { firstName: 'Youssef', lastName: 'Bennani' },
    structure: { name: 'Cabinet Dr Bennani', city: 'Casablanca', address: 'Rue Ibn Sina, Maârif' },
  } as never;
  const links = buildSearchShortcuts(detail, 'Cardiologie', 'annuaire médical');

  it('trois liens pre-remplis : Google, Maps, annuaire', () => {
    expect(Object.keys(links).sort()).toEqual(['directory', 'google', 'maps']);
  });

  it('Google : nom, specialite et ville', () => {
    const q = new URL(links.google).searchParams.get('q');
    expect(new URL(links.google).origin).toBe('https://www.google.com');
    expect(q).toBe('Youssef Bennani Cardiologie Casablanca');
  });

  it('Maps : cabinet, adresse et ville', () => {
    const url = new URL(links.maps);
    expect(url.pathname).toBe('/maps/search/');
    expect(url.searchParams.get('api')).toBe('1');
    expect(url.searchParams.get('query')).toBe(
      'Cabinet Dr Bennani Rue Ibn Sina, Maârif Casablanca',
    );
  });

  it('annuaire : une recherche GENERIQUE, liee a aucun annuaire en particulier (pas de source privilegiee)', () => {
    const url = new URL(links.directory);
    expect(url.origin).toBe('https://www.google.com');
    expect(url.searchParams.get('q')).toBe(
      'annuaire médical Youssef Bennani Cardiologie Casablanca',
    );
  });

  it('sans adresse : elle est simplement omise, jamais « null »', () => {
    const noAddress = buildSearchShortcuts(
      {
        ...(detail as object),
        structure: { name: 'Cabinet', city: 'Rabat', address: null },
      } as never,
      'Pédiatrie',
      'annuaire',
    );
    expect(new URL(noAddress.maps).searchParams.get('query')).toBe('Cabinet Rabat');
    expect(noAddress.maps).not.toContain('null');
  });

  it('les caracteres speciaux sont encodes : aucune injection de parametre dans l URL', () => {
    const hostile = buildSearchShortcuts(
      {
        doctor: { firstName: 'A&b=c', lastName: '#frag?x=1' },
        structure: { name: 'Cab"inet <x>', city: 'Rabat', address: null },
      } as never,
      'Spé',
      'annuaire',
    );
    const url = new URL(hostile.google);
    expect([...url.searchParams.keys()]).toEqual(['q']);
    expect(url.hash).toBe('');
    expect(url.searchParams.get('q')).toBe('A&b=c #frag?x=1 Spé Rabat');
  });
});
