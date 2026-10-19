module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  // Fuseau de test non UTC (voir test/jest.global-setup.js).
  globalSetup: '<rootDir>/test/jest.global-setup.js',
  testRegex: '.*\\.(spec|e2e-spec)\\.ts$',
  transform: {
    '^.+\\.(t|j|mj)s$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  transformIgnorePatterns: [],
  setupFiles: ['<rootDir>/test/jest.setup.ts'],
};
