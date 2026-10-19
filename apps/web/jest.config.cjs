module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  // Fuseau de test fixe (voir test/jest.global-setup.js).
  globalSetup: '<rootDir>/test/jest.global-setup.js',
  testRegex: '.*\\.(e2e-spec|spec)\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: 'tsconfig.jest.json' }],
  },
};
