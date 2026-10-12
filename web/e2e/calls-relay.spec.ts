import { APIRequestContext, expect, test } from '@playwright/test';
import { uniqueName } from './helpers';
import { API, RawWs } from './calls-helpers';

// Сервер: voice_media и voice_rtc (docs/API.md §11) — кто может что слать, что доходит и в каком виде.

interface Account {
  id: number;
  token: string;
}

async function register(request: APIRequestContext, name: string): Promise<Account> {
  const r = await request.post(`${API}/auth/register`, {
    data: { username: uniqueName('relay'), password: 'password123', display_name: name },
  });
  expect(r.status()).toBe(201);
  const body = await r.json();
  return { id: body.user_id, token: body.token };
}

const auth = (a: Account) => ({ Authorization: `Bearer ${a.token}` });

test('voice_media and voice_rtc: only between members of the same voice channel, whitelisted fields', async ({
  request,
}) => {
  const x = await register(request, 'Икс');
  const y = await register(request, 'Игрек');
  const z = await register(request, 'Зет');
  const created = await (await request.post(`${API}/servers`, { headers: auth(x), data: { name: 'Релей' } })).json();
  const serverId = created.server_id;
  expect((await request.post(`${API}/servers/join`, { headers: auth(y), data: { code: created.invite_code } })).ok()).toBe(true);
  const chans = (await (await request.get(`${API}/servers/${serverId}/channels`, { headers: auth(x) })).json()).channels;
  const voiceId = chans.find((c: any) => c.is_voice === 1 || c.is_voice === true).id;

  const wx = await RawWs.open(x.token);
  const wy = await RawWs.open(y.token);
  const wz = await RawWs.open(z.token);
  // Вторая вкладка Игрека — без голоса
  const wy2 = await RawWs.open(y.token);

  wx.send({ type: 'voice_join', channel_id: voiceId, proto: 2 });
  wy.send({ type: 'voice_join', channel_id: voiceId, proto: 2 });
  const state = await wx.next(
    (e) => e.type === 'voice_state' && e.channel_id === voiceId && e.users.length === 2,
  );
  // Новые поля у каждого участника: по умолчанию ничего не транслируют
  for (const u of state.users) expect(u).toMatchObject({ screen: false, camera: false });

  const rtcTo = (w: RawWs) => w.events.filter((e) => e.type === 'voice_rtc');

  // Полноценное сообщение от участника канала — доходит с from, без посторонних полей
  wx.send({
    type: 'voice_rtc',
    to: y.id,
    from: 999,
    kind: 'screen',
    action: 'offer',
    sdp: 'v=0\r\n',
    sdpType: 'offer',
    junk: 'x'.repeat(100),
    name: 'подделка',
  });
  const got = await wy.next((e) => e.type === 'voice_rtc');
  expect(got).toEqual({ type: 'voice_rtc', to: y.id, from: x.id, kind: 'screen', action: 'offer', sdp: 'v=0\r\n', sdpType: 'offer' });
  // Только в голосовое подключение адресата
  await wy2.roundTrip();
  expect(rtcTo(wy2)).toHaveLength(0);

  // Отбрасывается: неизвестный kind/action, слишком длинный SDP, не в канале, не тому подключению
  wx.send({ type: 'voice_rtc', to: y.id, kind: 'audio', action: 'offer' });
  wx.send({ type: 'voice_rtc', to: y.id, kind: 'screen', action: 'hack' });
  wx.send({ type: 'voice_rtc', to: y.id, kind: 'camera', action: 'offer', sdp: 'x'.repeat(33 * 1024) });
  wx.send({ type: 'voice_rtc', to: y.id, kind: 'camera', action: 'ice', candidate: 'c'.repeat(1025) });
  wx.send({ type: 'voice_rtc', to: z.id, kind: 'screen', action: 'watch' }); // Зет не в канале
  wz.send({ type: 'voice_rtc', to: x.id, kind: 'screen', action: 'watch' }); // и не участник сервера
  wy2.send({ type: 'voice_rtc', to: x.id, kind: 'screen', action: 'watch' }); // вкладка без голоса
  await wx.roundTrip();
  await wz.roundTrip();
  await wy2.roundTrip();
  await wy.roundTrip();
  expect(rtcTo(wy)).toHaveLength(1);
  expect(rtcTo(wx)).toHaveLength(0);
  expect(rtcTo(wz)).toHaveLength(0);

  // Ответ в обратную сторону и причина остановки
  wy.send({ type: 'voice_rtc', to: x.id, kind: 'screen', action: 'stop', reason: 'full' });
  expect(await wx.next((e) => e.type === 'voice_rtc')).toMatchObject({ from: y.id, action: 'stop', reason: 'full' });

  // voice_media: состояние уходит всем участникам сервера в voice_state
  const before = wy.events.length;
  wx.send({ type: 'voice_media', screen: true, camera: false });
  const live = await wy.next(
    (e) => e.type === 'voice_state' && e.users.some((u: any) => u.user_id === x.id && u.screen === true),
  );
  expect(live.users.find((u: any) => u.user_id === x.id)).toEqual({ user_id: x.id, name: 'Икс', screen: true, camera: false });
  expect(wy.events.indexOf(live)).toBeGreaterThanOrEqual(before);
  // Повтор того же состояния ничего не рассылает
  const n = wy.events.filter((e) => e.type === 'voice_state').length;
  wx.send({ type: 'voice_media', screen: true, camera: false });
  await wx.roundTrip();
  await new Promise((r) => setTimeout(r, 500));
  expect(wy.events.filter((e) => e.type === 'voice_state').length).toBe(n);

  // Не из голоса — игнорируется: посторонний, вкладка без голоса
  wz.send({ type: 'voice_media', screen: true, camera: true });
  wy2.send({ type: 'voice_media', screen: true, camera: true });
  await wz.roundTrip();
  await wy2.roundTrip();
  await new Promise((r) => setTimeout(r, 500));
  expect(
    wx.events.some((e) => e.type === 'voice_state' && e.users.some((u: any) => u.user_id !== x.id && (u.screen || u.camera))),
  ).toBe(false);

  // Выход из канала сбрасывает состояние; после повторного входа — ничего не транслирует
  wx.send({ type: 'voice_leave' });
  await wy.next((e) => e.type === 'voice_state' && e.users.length === 1);
  wx.send({ type: 'voice_join', channel_id: voiceId, proto: 2 });
  const back = await wy.next(
    (e) => e.type === 'voice_state' && e.users.length === 2 && wy.events.indexOf(e) > wy.events.indexOf(live),
  );
  expect(back.users.find((u: any) => u.user_id === x.id)).toMatchObject({ screen: false, camera: false });

  // Лимит voice_media: 20 в минуту. Серия переключений исчерпывает его — следующее сообщение не принимается.
  // (Рассылки voice_state идут из одного потока и склеиваются, поэтому считаем не их, а итоговое состояние.)
  for (let i = 0; i < 30; i++) wx.send({ type: 'voice_media', screen: i % 2 === 0, camera: false });
  await wx.roundTrip();
  await new Promise((r) => setTimeout(r, 500));
  const mark = wy.events.length;
  wx.send({ type: 'voice_media', screen: true, camera: true });
  await wx.roundTrip();
  await new Promise((r) => setTimeout(r, 800));
  expect(
    wy.events
      .slice(mark)
      .some((e) => e.type === 'voice_state' && e.users.some((u: any) => u.user_id === x.id && u.camera === true)),
  ).toBe(false);

  for (const w of [wx, wy, wz, wy2]) w.close();
});
