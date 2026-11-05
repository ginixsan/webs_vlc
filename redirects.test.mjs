import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isForeignRedirect } from './redirects.mjs';

test('same site, subdomains and renamed municipal domains are not foreign', () => {
  assert.equal(isForeignRedirect('https://www.agost.es/', 'https://www.agost.es/inicio'), false);
  assert.equal(isForeignRedirect('https://www.mutxamel.org/', 'https://ayto.mutxamel.org/'), false);
  assert.equal(isForeignRedirect('https://www.aytoestivella.com/', 'https://www.estivella.es/'), false);
  assert.equal(isForeignRedirect('https://www.peniscola.org/', 'http://va.peniscola.org/'), false);
});

test('a jump to an unrelated domain is foreign', () => {
  assert.equal(isForeignRedirect('https://benlloc.es/', 'https://amrox.org/4/80ad3c0bf9a8'), true);
  assert.equal(isForeignRedirect('https://www.benetusser.net/', 'https://giveanangel.com/'), true);
});

test('unparseable final URLs are not treated as redirects', () => {
  assert.equal(isForeignRedirect('https://www.agost.es/', ''), false);
  assert.equal(isForeignRedirect('https://www.agost.es/', 'about:blank'), false);
});
