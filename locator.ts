#!/usr/bin/env -S ./test/node_modules/.bin/tsx

import { main } from "./test/src/locator/cli";

void main(process.argv.slice(2), process.cwd()).catch((error: unknown) => {
  process.stderr.write(
    error instanceof Error
      ? `${error.stack ?? error.message}\n`
      : `${String(error)}\n`,
  );
  process.exitCode = 1;
});
