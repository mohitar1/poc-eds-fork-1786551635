module.exports = {
  root: true,
  extends: 'airbnb-base',
  env: {
    browser: true,
  },
  parser: '@babel/eslint-parser',
  parserOptions: {
    allowImportExportEverywhere: true,
    sourceType: 'module',
    requireConfigFile: false,
  },
  rules: {
    'import/extensions': ['error', { js: 'always' }], // require js file extensions in imports
    'linebreak-style': ['error', 'unix'], // enforce unix linebreaks
    'no-param-reassign': [2, { props: false }], // allow modifying properties of param
    'no-use-before-define': ['warn'],
  },
  overrides: [
    {
      // Node CLI: the per-fork asset enrichment agent (customer-migration Phase C).
      files: ['scripts/agent/**/*.js'],
      env: { node: true },
      rules: {
        'import/prefer-default-export': 'off', // small single-purpose util modules
        'import/no-extraneous-dependencies': ['error', { devDependencies: true, packageDir: __dirname }],
        'no-console': 'off', // CLI reporting writes to stdout/stderr
        'no-await-in-loop': 'off', // sequential paging / bounded per-asset work
        'no-restricted-syntax': 'off', // allow for..of in Node CLI code
        'no-plusplus': 'off',
        'no-continue': 'off',
        'max-classes-per-file': ['error', 2], // ims-auth: IMS + static token providers
      },
    },
  ],
};
