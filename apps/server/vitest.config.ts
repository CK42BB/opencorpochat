// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 20_000,
    pool: 'forks',
  },
});
