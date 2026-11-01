// Entry point for `node --test tools/harness`.
// Node 22 no longer searches a directory given to `--test`; it loads it as a module, which resolves
// to this file. It imports every harness test file so the plan's command runs the whole suite.
// settings.test.mjs checks that this list matches the files in __tests__/.
const files = ['gate', 'guard', 'integrity', 'settings', 'state'];
for (const name of files) {
  import(`./__tests__/${name}.test.mjs`).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
