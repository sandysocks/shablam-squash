import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Standard installs resolve the dev dependency. PGLITE_MODULE supports a portable
// test runner without requiring a system-wide Node/npm installation.
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');

test('Postgres membership, RLS, challenge permissions and atomic Elo confirmation', async t => {
  const db = new PGlite();
  const a = '00000000-0000-0000-0000-000000000001';
  const b = '00000000-0000-0000-0000-000000000002';
  const c = '00000000-0000-0000-0000-000000000003';
  const outsider = '00000000-0000-0000-0000-000000000004';
  const code = 'test-only-invitation-code-123456789';
  const as = async (id,role = 'authenticated') => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id || '']);
    await db.exec(`set role ${role}`);
  };
  const admin = () => db.exec('reset role');
  const ratings = async () => { await admin(); return (await db.query('select rating from public.players order by id')).rows.map(p => p.rating); };
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid; $$;
      grant usage on schema auth to authenticated,anon;
      grant execute on function auth.uid() to authenticated,anon;`);
    for (const id of [a,b,c,outsider]) await db.query('insert into auth.users values($1)',[id]);
    await db.exec(await readFile(new URL('../supabase/schema.sql',import.meta.url),'utf8'));
    await db.query('insert into private.club_settings values(true,$1)',[code]);

    await t.test('anonymous users and nonmembers cannot read club records or invite code', async () => {
      await as(null,'anon');
      await assert.rejects(db.query('select * from public.players'), /permission denied/);
      await assert.rejects(db.query('select public.join_ladder($1,$2)',['Anon',code]), /permission denied/);
      await as(outsider);
      assert.equal((await db.query('select * from public.players')).rows.length,0);
      await assert.rejects(db.query('select * from private.club_settings'), /permission denied/);
      await assert.rejects(db.query('select public.issue_challenge($1,$2)',[a,'']), /Join the club/);
    });

    await t.test('a private invitation is required; duplicate names are rejected', async () => {
      await as(a);
      await assert.rejects(db.query('select public.join_ladder($1,$2)',['Alice','wrong']), /not valid/);
      await db.query('select public.join_ladder($1,$2)',['Alice',code]);
      await as(b);
      await assert.rejects(db.query('select public.join_ladder($1,$2)',['alice',code]), /already/);
      await db.query('select public.join_ladder($1,$2)',['Bob',code]);
      await as(c); await db.query('select public.join_ladder($1,$2)',['Charlie',code]);
      assert.deepEqual(await ratings(),[1200,1200,1200]);
    });

    let challenge, match;
    await t.test('only the intended opponent can accept a challenge', async () => {
      await as(a);
      challenge = (await db.query('select public.issue_challenge($1,$2) as id',[b,'Friday?'])).rows[0].id;
      await assert.rejects(db.query('select public.respond_to_challenge($1,$2)',[challenge,'accepted']), /cannot/);
      await assert.rejects(db.query('select public.issue_challenge($1,$2)',[b,'Again?']), /already/);
      await as(c);
      await assert.rejects(db.query('select public.respond_to_challenge($1,$2)',[challenge,'accepted']), /cannot/);
      await as(b); await db.query('select public.respond_to_challenge($1,$2)',[challenge,'accepted']);
    });

    await t.test('scores and dates are validated on the server and ratings stay unchanged while pending', async () => {
      await as(a);
      for (const scores of [[3,3],[2,1],[-1,3]]) await assert.rejects(db.query('select public.submit_result($1,$2,$3,5,current_date,null)',[b,...scores]),/completed/);
      await assert.rejects(db.query("select public.submit_result($1,3,1,5,date '2099-01-01',null)",[b]),/valid match date/);
      match = (await db.query('select public.submit_result($1,3,1,5,current_date,$2) as id',[b,challenge])).rows[0].id;
      assert.deepEqual(await ratings(),[1200,1200,1200]);
      await as(a);
      await assert.rejects(db.query('select public.respond_to_challenge($1,$2)',[challenge,'cancelled']),/Resolve/);
      await assert.rejects(db.query('select public.submit_result($1,3,2,5,current_date,null)',[b]),/existing result/);
    });

    await t.test('rating and match writes cannot bypass server functions', async () => {
      await as(a);
      await assert.rejects(db.query('update public.players set rating = 9999 where id = $1',[a]),/permission denied/);
      await assert.rejects(db.query("update public.matches set status = 'confirmed' where id = $1",[match]),/permission denied/);
      await assert.rejects(db.query('delete from public.matches where id = $1',[match]),/permission denied/);
    });

    await t.test('only the other player can confirm, and confirming twice has no effect', async () => {
      await as(a); await assert.rejects(db.query('select public.review_result($1,true)',[match]),/other player/);
      await as(c); await assert.rejects(db.query('select public.review_result($1,true)',[match]),/other player/);
      await as(b); await db.query('select public.review_result($1,true)',[match]);
      await assert.rejects(db.query('select public.review_result($1,true)',[match]),/no longer/);
      assert.deepEqual(await ratings(),[1216,1184,1200]);
      assert.equal((await db.query('select status from public.challenges where id = $1',[challenge])).rows[0].status,'completed');
    });

    await t.test('disputes preserve ratings and a corrected result can be recorded', async () => {
      await as(a);
      const pending = (await db.query('select public.submit_result($1,2,0,3,current_date,null) as id',[b])).rows[0].id;
      await as(b); await db.query('select public.review_result($1,false)',[pending]);
      assert.deepEqual(await ratings(),[1216,1184,1200]);
      await as(a); const corrected = (await db.query('select public.submit_result($1,0,2,3,current_date,null) as id',[b])).rows[0].id;
      await as(b); await db.query('select public.review_result($1,true)',[corrected]);
      const result = await ratings();
      assert.equal(result.reduce((sum,r) => sum+r,0),3600);
      assert.ok(result[0] < 1216 && result[1] > 1184);
    });

    await t.test('a signed-in outsider still cannot see the established club', async () => {
      await as(outsider);
      for (const table of ['players','matches','challenges']) assert.equal((await db.query(`select * from public.${table}`)).rows.length,0);
    });
  } finally { await db.close(); }
});
