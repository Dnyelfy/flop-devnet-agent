import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { chatCompletion, enrollSubmit, HttpError } from '../src/gateway.js';

function stubFetch(status, body) {
  return mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(body), { status }));
}

test('a chat request is sent once, non-streaming, with the bearer and the caller-owned id', async (t) => {
  const fetchMock = stubFetch(200, { choices: [{ message: { content: 'OK' } }] });
  t.after(() => fetchMock.mock.restore());
  const out = await chatCompletion('https://gw.example', 'flop_test', 'req-1', { model: 'm', messages: [], max_tokens: 8 });
  assert.equal(out.choices[0].message.content, 'OK');
  assert.equal(fetchMock.mock.callCount(), 1);
  const [url, init] = fetchMock.mock.calls[0].arguments;
  assert.equal(url, 'https://gw.example/v1/chat/completions');
  assert.equal(init.headers.Authorization, 'Bearer flop_test');
  assert.equal(init.headers['Idempotency-Key'], 'req-1');
  assert.equal(init.redirect, 'error');
  assert.deepEqual(JSON.parse(init.body), { model: 'm', messages: [], max_tokens: 8, stream: false });
});

test('a gateway refusal keeps its code and explanation, and is not retried', async (t) => {
  const fetchMock = stubFetch(503, { error: 'wallet_enrollment_cap_reached', message: 'The daily wallet enrollment cap is reached; retry later.' });
  t.after(() => fetchMock.mock.restore());
  await assert.rejects(enrollSubmit('https://gw.example', 'addr', 'msg', '0x00'), (error) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, 503);
    assert.match(error.message, /wallet_enrollment_cap_reached — The daily wallet enrollment cap is reached/);
    return true;
  });
  assert.equal(fetchMock.mock.callCount(), 1);
});
