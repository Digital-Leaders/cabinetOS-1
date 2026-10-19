module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  rootDir: '.',
  // Fuseau de test fixe (voir test/jest.global-setup.js).
  globalSetup: '<rootDir>/test/jest.global-setup.js',
  testRegex: '.*\\.spec\\.tsx$',
  transform: {
    '^.+\\.(t|j)sx?$': ['ts-jest', { tsconfig: 'tsconfig.component-test.json' }],
  },
  moduleNameMapper: {
    '\\.css$': '<rootDir>/test/css-stub.js',
  },
  setupFilesAfterEnv: ['<rootDir>/test/setup-jest-dom.ts'],
};
