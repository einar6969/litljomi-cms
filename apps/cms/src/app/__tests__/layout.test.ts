import { expect, it } from 'vitest';
import { dynamic } from '../layout';

// A page rendered at build time has no nonce, and the policy would then block its inline scripts.
it('renders every page per request', () => {
  expect(dynamic).toBe('force-dynamic');
});
