export default {
  collectCoverageFrom: [
    'src/**/*.js',
    'index.js'
  ],
  coverageThreshold: {
    global: {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90
    }
  }
}
