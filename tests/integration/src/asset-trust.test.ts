// M3-07: register_asset and update_asset lock the tenant row FOR SHARE (P4 follow-up security r1;
// 20261103000700_asset_trust.sql), so a suspension and an asset write are serialized. Each pgAs()
// connection holds one open transaction impersonating a role the way PostgREST does;
// expectBlocked() proves the second one waits on the first's lock. Runs on demo; every suspension
// is undone before the test ends.
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { editorClient } from './clients.ts';
import { TENANT } from './fixtures.ts';
import { closeAll, closeClient, expectBlocked, ownerQuery, pgAs } from './sql.ts';

const register = (c: pg.Client, id = randomUUID()) =>
  c.query(`select api.register_asset($1, $2, $3, 'a.jpg', 'image/jpeg', 10, 1, 1, repeat('a', 64))`, [
    id,
    TENANT.demo,
    `${TENANT.demo}/${id}/a.jpg`,
  ]);

const demoStatus = async () =>
  (await ownerQuery<{ status: string }>('select status from cms.tenants where id = $1', [TENANT.demo]))[0]!.status;

/** A demo asset committed by the owner, for update_asset. */
async function demoAsset(): Promise<string> {
  const id = randomUUID();
  await ownerQuery(
    `insert into cms.assets (id, tenant_id, original_path, filename, mime, bytes, width, height, sha256)
     values ($1::uuid, $2::uuid, $2::text || '/' || $1::text || '/a.jpg', 'a.jpg', 'image/jpeg', 10, 1, 1, repeat('a', 64))`,
    [id, TENANT.demo],
  );
  return id;
}

afterEach(async () => {
  await ownerQuery(`update cms.tenants set status = 'active' where id = $1`, [TENANT.demo]);
});
afterAll(closeAll);

describe('asset functions lock the tenant row (M3-07)', () => {
  it('a suspension waits for an in-flight register_asset, which commits its asset first', async () => {
    const id = randomUUID();
    const editor = await pgAs('editor_demo');
    await register(editor, id);

    const owner = await pgAs('owner');
    const suspending = owner.query(`update cms.tenants set status = 'suspended' where id = $1`, [TENANT.demo]);
    await expectBlocked(owner);

    await editor.query('commit');
    await suspending;
    await owner.query('commit');
    await closeClient(editor);
    await closeClient(owner);
    expect(await demoStatus()).toBe('suspended');
    expect(await ownerQuery('select id from cms.assets where id = $1', [id])).toEqual([{ id }]);
  });

  it('register_asset waits for an in-flight suspension, then is refused with tenant_inactive', async () => {
    const owner = await pgAs('owner');
    await owner.query(`update cms.tenants set status = 'suspended' where id = $1`, [TENANT.demo]);

    const id = randomUUID();
    const editor = await pgAs('editor_demo');
    const registering = register(editor, id).then(
      () => null,
      (e: unknown) => e,
    );
    await expectBlocked(editor);

    await owner.query('commit');
    await closeClient(owner);
    const error = (await registering) as { code?: string; message?: string } | null;
    expect({ code: error?.code, message: error?.message }).toEqual({ code: 'P0001', message: 'tenant_inactive' });
    await closeClient(editor);
    expect(await ownerQuery('select id from cms.assets where id = $1', [id])).toEqual([]);
  });

  it('update_asset waits for an in-flight suspension, then is refused with tenant_inactive', async () => {
    const asset = await demoAsset();
    const owner = await pgAs('owner');
    await owner.query(`update cms.tenants set status = 'suspended' where id = $1`, [TENANT.demo]);

    const editor = await pgAs('editor_demo');
    const updating = editor.query(`select api.update_asset($1, 0.5, 0.5, 'Brauð')`, [asset]).then(
      () => null,
      (e: unknown) => e,
    );
    await expectBlocked(editor);

    await owner.query('commit');
    await closeClient(owner);
    const error = (await updating) as { code?: string; message?: string } | null;
    expect({ code: error?.code, message: error?.message }).toEqual({ code: 'P0001', message: 'tenant_inactive' });
    await closeClient(editor);
  });

  it("a suspended tenant's register_asset over the Data API is refused", async () => {
    await ownerQuery(`update cms.tenants set status = 'suspended' where id = $1`, [TENANT.demo]);
    const id = randomUUID();
    const { error } = await (await editorClient('editor_demo')).schema('api').rpc('register_asset', {
      p_asset_id: id,
      p_tenant_id: TENANT.demo,
      p_original_path: `${TENANT.demo}/${id}/a.jpg`,
      p_filename: 'a.jpg',
      p_mime: 'image/jpeg',
      p_bytes: 10,
      p_width: 1,
      p_height: 1,
      p_sha256: 'a'.repeat(64),
    });
    expect({ code: error?.code, message: error?.message }).toEqual({ code: 'P0001', message: 'tenant_inactive' });
  });

  it('an editor can never update the tenant row the lock grant covers', async () => {
    const editor = await pgAs('editor_demo');
    const error = await editor.query(`update cms.tenants set name = 'Annað' where id = $1`, [TENANT.demo]).then(
      () => null,
      (e: unknown) => e as { code?: string },
    );
    expect(error?.code).toBe('42501');
    await closeClient(editor);
  });
});
