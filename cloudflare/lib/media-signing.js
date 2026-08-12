const encoder = new TextEncoder();
let hmacKeyPromise = null;
let hmacKeySecret = null;

const base64Url = (bytes) =>
  btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');

const timingSafeEqual = (left, right) => {
  const a = encoder.encode(String(left || ''));
  const b = encoder.encode(String(right || ''));
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
};

const signingPayload = ({ mediaId, objectKey, exp, aud, scope, environment }) =>
  [mediaId, objectKey, exp, aud, scope, environment].map((value) => encodeURIComponent(String(value))).join('.');

const hmac = async (payload, secret) => {
  if (!secret) throw Object.assign(new Error('媒体签名密钥未配置'), { status: 503 });
  if (!hmacKeyPromise || hmacKeySecret !== secret) {
    hmacKeySecret = secret;
    hmacKeyPromise = crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    ).catch((error) => {
      hmacKeyPromise = null;
      hmacKeySecret = null;
      throw error;
    });
  }
  const key = await hmacKeyPromise;
  return base64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload))));
};

const alignmentPayload = (challenge) => `jinshan20.checkin.media-signing.v1.${String(challenge || '')}`;

export const createMediaSigningAlignmentProof = async (env, challenge) => {
  if (!/^[0-9a-f-]{32,64}$/i.test(String(challenge || ''))) {
    throw Object.assign(new Error('媒体签名校验挑战无效'), { status: 400 });
  }
  return hmac(alignmentPayload(challenge), env.MEDIA_SIGNING_SECRET);
};

export const verifyMediaSigningAlignmentProof = async (env, challenge, supplied) => {
  if (!supplied) return false;
  const expected = await createMediaSigningAlignmentProof(env, challenge);
  return timingSafeEqual(supplied, expected);
};

export const createPrivateMediaUrl = async (env, media, audience, scope, ttlSeconds = 15 * 60) => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  // Keep the signed URL stable during one TTL window so mobile WebViews can reuse
  // their private browser cache when a drawer is reopened. The extra window keeps
  // every generated URL valid for at least ttlSeconds.
  const exp = (Math.floor(nowSeconds / ttlSeconds) + 2) * ttlSeconds;
  const environment = env.ENVIRONMENT || 'unknown';
  const values = {
    mediaId: media.id,
    objectKey: media.objectKey,
    exp,
    aud: audience,
    scope,
    environment
  };
  const sig = await hmac(signingPayload(values), env.MEDIA_SIGNING_SECRET);
  const query = new URLSearchParams({
    key: media.objectKey,
    exp: String(exp),
    aud: audience,
    scope,
    env: environment,
    sig
  });
  return `/api/private-media/${encodeURIComponent(media.id)}?${query}`;
};

export const verifyPrivateMediaRequest = async (env, mediaId, searchParams) => {
  const values = {
    mediaId,
    objectKey: searchParams.get('key') || '',
    exp: Number(searchParams.get('exp') || 0),
    aud: searchParams.get('aud') || '',
    scope: searchParams.get('scope') || '',
    environment: searchParams.get('env') || ''
  };
  if (!values.objectKey || !Number.isInteger(values.exp)
      || values.exp < Math.floor(Date.now() / 1000)
      || !['owner', 'admin'].includes(values.aud)
      || values.environment !== (env.ENVIRONMENT || 'unknown')) return null;
  const supplied = searchParams.get('sig') || '';
  const expected = await hmac(signingPayload(values), env.MEDIA_SIGNING_SECRET);
  return timingSafeEqual(supplied, expected) ? values : null;
};
