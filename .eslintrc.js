module.exports = {
  env: {
    node: true,
    es2021: true,
    jest: true,
  },
  extends: [
    'eslint:recommended'
  ],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  rules: {
    // Code quality rules
    'no-unused-vars': ['error', { 
      'argsIgnorePattern': '^_',
      'varsIgnorePattern': '^_' 
    }],
    'no-console': 'off', // Logging is important for this bot
    'no-undef': 'error',
    
    // Style rules (relaxed for Discord bot)
    'indent': ['error', 2],
    'linebreak-style': ['error', 'unix'],
    'quotes': ['error', 'single'],
    'semi': ['error', 'always'],
    
    // Best practices
    'eqeqeq': 'error',
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-new-func': 'error',
    'no-var': 'error',
    'prefer-const': 'error',
    
    // Security-related
    'no-script-url': 'error',
  },
  ignorePatterns: [
    'node_modules/',
    'coverage/',
    'docs/',
    '*.min.js'
  ]
};