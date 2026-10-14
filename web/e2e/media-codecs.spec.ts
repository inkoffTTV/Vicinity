import { expect, test } from '@playwright/test';

// Кодек и стартовая скорость видео (web/src/lib/media.ts): порядок кодеков в предложении и
// x-google-start-bitrate в удалённом описании, которое браузер принимает.

test('codec order and start bitrate are applied to real SDP', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__vicinityCodecs);
  const result = await page.evaluate(async () => {
    const media = (window as any).__vicinityCodecs;
    const firstCodec = (sdp: string) => {
      const pt = /^m=video \S+ \S+ (\d+)/m.exec(sdp)![1];
      return new RegExp(`^a=rtpmap:${pt} ([^/]+)/`, 'm').exec(sdp)![1];
    };
    const target = { width: 2560, height: 1440, fps: 60, maxBitrate: 10_000_000 };
    const motion = await media.chooseVideoCodecs(target, false);
    const detail = await media.chooseVideoCodecs({ ...target, fps: 30 }, true);

    const offerWith = async (order: string[]) => {
      const pc = new RTCPeerConnection();
      media.applyCodecOrder(pc.addTransceiver('video', { direction: 'sendonly' }), order);
      const offer = await pc.createOffer();
      pc.close();
      return offer.sdp!;
    };
    const motionOffer = await offerWith(motion.order);
    const detailOffer = await offerWith(detail.order);

    // Стартовая скорость: у каждого видеокодека, но не у rtx; описание принимается браузером
    const sender = new RTCPeerConnection();
    sender.addTransceiver('video', { direction: 'sendonly' });
    await sender.setLocalDescription();
    const receiver = new RTCPeerConnection();
    await receiver.setRemoteDescription(sender.localDescription!);
    await receiver.setLocalDescription();
    const answer = media.withStartBitrate(receiver.localDescription!.sdp, 3000);
    await sender.setRemoteDescription({ type: 'answer', sdp: answer });
    const pts = [...answer.matchAll(/^a=rtpmap:(\d+) (VP8|VP9|AV1|H264)\//gim)].map((m) => m[1]);
    const rtx = [...answer.matchAll(/^a=rtpmap:(\d+) rtx\//gim)].map((m) => m[1]);
    const fmtp = (pt: string) => new RegExp(`^a=fmtp:${pt} (.*)$`, 'm').exec(answer)?.[1] ?? '';
    sender.close();
    receiver.close();
    return {
      hardware: motion.hardware,
      motionFirst: firstCodec(motionOffer),
      detailFirst: firstCodec(detailOffer),
      startOnAll: pts.length > 0 && pts.every((pt) => fmtp(pt).includes('x-google-start-bitrate=3000')),
      rtxUntouched: rtx.every((pt) => !fmtp(pt).includes('x-google')),
      onceEach: pts.every((pt) => answer.split(`a=fmtp:${pt} `).length === 2),
    };
  });
  // В headless Chromium кодирует процессор: плавность — VP8, чёткость — VP9
  expect(result.hardware).toBe(false);
  expect(result.motionFirst).toBe('VP8');
  expect(result.detailFirst).toBe('VP9');
  expect(result.startOnAll).toBe(true);
  expect(result.rtxUntouched).toBe(true);
  expect(result.onceEach).toBe(true);
});
