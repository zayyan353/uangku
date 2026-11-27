const testFiles = '(^|/)(__tests__|testing|tests)/|\\.(test|spec)\\.[cm]?[jt]sx?$';

module.exports = {
  forbidden: [
    {
      name: 'tanpa-siklus',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'lib-tidak-memakai-ui',
      severity: 'error',
      from: { path: '^src/lib/' },
      to: { path: '^src/(components|hooks)/|(^|/)node_modules/(react|react-dom)(/|$)' },
    },
    {
      name: 'produksi-tidak-memakai-tes',
      severity: 'error',
      from: { path: '^src/', pathNot: testFiles },
      to: { path: testFiles },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
  },
};
