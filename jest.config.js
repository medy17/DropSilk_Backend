module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    roots: ["<rootDir>/src", "<rootDir>/tests"],
    moduleNameMapper: {
        // This alias is fucking handy.
        "^@src/(.*)$": "<rootDir>/src/$1",
    },
    testMatch: ["**/tests/**/*.test.ts"],
    clearMocks: true,
    collectCoverage: true,
    coverageDirectory: "coverage",
    coverageReporters: ["json", "text", "lcov", "clover"],
};