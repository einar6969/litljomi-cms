// Storage paths of the release build (spec §4.1 rule 6, §5.6, §7.2) and the deferred Minors on
// object names (Task 8 security r1 Minor 2; Task 10 security r1 Minor 3).
import { describe, expect, it } from 'vitest';
import {
  deliveryBundlePath,
  deliveryPointerPath,
  pointerBundlePath,
  privateMediaPath,
  publicMediaPath,
} from '../storage-paths';

const TENANT = '00000000-0000-4000-8000-00000000a001';
const ASSET = '11111111-1111-4111-8111-111111111111';

describe('delivery paths', () => {
  it('start with the tenant slug (§4.1 rule 6, §5.6)', () => {
    expect(deliveryBundlePath('prufa', 42)).toBe('prufa/releases/42.json');
    expect(deliveryPointerPath('prufa')).toBe('prufa/current.json');
  });
  it('the pointer names the bundle relative to the tenant (§7.2)', () => {
    expect(pointerBundlePath(42)).toBe('releases/42.json');
    expect(`prufa/${pointerBundlePath(7)}`).toBe(deliveryBundlePath('prufa', 7));
  });
  it.each(['', 'Prufa', 'a/b', '..', 'a b', '-a', 'a-', 'a--b', 'þ'])('refuses the slug %j', (slug) => {
    expect(() => deliveryBundlePath(slug, 1)).toThrow(/slug/);
    expect(() => deliveryPointerPath(slug)).toThrow(/slug/);
  });
  it.each([0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])('refuses the release number %d', (n) => {
    expect(() => deliveryBundlePath('prufa', n)).toThrow(/release number/);
    expect(() => pointerBundlePath(n)).toThrow(/release number/);
  });
});

describe('media paths', () => {
  it('public: {tenant_slug}/{asset_id}/{filename}; private: {tenant_id}/{asset_id}/{filename} (§5.6)', () => {
    expect(publicMediaPath('prufa', ASSET, 'brauð ársins.jpg')).toBe(`prufa/${ASSET}/brauð ársins.jpg`);
    expect(privateMediaPath(TENANT, ASSET, 'a.jpg')).toBe(`${TENANT}/${ASSET}/a.jpg`);
  });
  it.each(['', '.', '..', 'a/b.jpg', 'a\\b.jpg', 'a\u0000.jpg', 'a\n.jpg', 'a\t.jpg', 'a\u007f.jpg', '\u001b.jpg'])(
    'refuses the filename %j',
    (filename) => {
      expect(() => publicMediaPath('prufa', ASSET, filename)).toThrow(/filename/);
      expect(() => privateMediaPath(TENANT, ASSET, filename)).toThrow(/filename/);
    },
  );
  it.each(['', 'x', 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA', `${ASSET}/..`, '11111111111141118111111111111111'])('refuses the id %j', (id) => {
    expect(() => publicMediaPath('prufa', id, 'a.jpg')).toThrow(/asset id/);
    expect(() => privateMediaPath(TENANT, id, 'a.jpg')).toThrow(/asset id/);
    expect(() => privateMediaPath(id, ASSET, 'a.jpg')).toThrow(/tenant id/);
  });
  it('refuses a bad slug for public media', () => {
    expect(() => publicMediaPath('../x', ASSET, 'a.jpg')).toThrow(/slug/);
  });
});
