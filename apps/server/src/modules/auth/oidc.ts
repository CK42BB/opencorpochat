// SPDX-License-Identifier: AGPL-3.0-only
// OpenID Connect authorization-code flow with PKCE, implemented against the published
// OIDC Core / Discovery specifications. The ID token is received directly from the
// token endpoint over TLS, which (per OIDC Core §3.1.3.7) permits validating the issuer
// via TLS rather than a signature check; we still verify iss/aud/exp/nonce claims.
import { createHash } from 'node:crypto';
import type { Config } from '../../config.js';
import { randomToken } from '../../lib/crypto.js';

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
}

let cached: { at: number; doc: Discovery } | null = null;

async function discover(cfg: NonNullable<Config['oidc']>): Promise<Discovery> {
  if (cached && Date.now() - cached.at < 3600_000) return cached.doc;
  const res = await fetch(`${cfg.issuer}/.well-known/openid-configuration`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`OIDC discovery failed: HTTP ${res.status}`);
  const doc = (await res.json()) as Discovery;
  cached = { at: Date.now(), doc };
  return doc;
}

export interface OidcState {
  state: string;
  nonce: string;
  verifier: string;
  returnTo: string;
}

export async function startOidc(config: Config, returnTo: string) {
  const cfg = config.oidc!;
  const doc = await discover(cfg);
  const st: OidcState = {
    state: randomToken(16),
    nonce: randomToken(16),
    verifier: randomToken(48),
    returnTo,
  };
  const challenge = createHash('sha256').update(st.verifier).digest('base64url');
  const url = new URL(doc.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', cfg.clientId);
  url.searchParams.set('redirect_uri', `${config.publicUrl}/api/v1/auth/oidc/callback`);
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', st.state);
  url.searchParams.set('nonce', st.nonce);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return { url: url.toString(), state: st };
}

export interface OidcClaims {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  preferred_username?: string;
  given_name?: string;
  family_name?: string;
}

export async function finishOidc(config: Config, code: string, st: OidcState): Promise<OidcClaims> {
  const cfg = config.oidc!;
  const doc = await discover(cfg);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: `${config.publicUrl}/api/v1/auth/oidc/callback`,
    client_id: cfg.clientId,
    code_verifier: st.verifier,
  });
  if (cfg.clientSecret) body.set('client_secret', cfg.clientSecret);
  const res = await fetch(doc.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`OIDC token exchange failed: HTTP ${res.status}`);
  const tokens = (await res.json()) as { id_token?: string; access_token?: string };
  if (!tokens.id_token) throw new Error('OIDC provider returned no id_token');
  const payload = JSON.parse(
    Buffer.from(tokens.id_token.split('.')[1] ?? '', 'base64url').toString('utf8'),
  );
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (payload.iss !== doc.issuer) throw new Error('OIDC issuer mismatch');
  if (!aud.includes(cfg.clientId)) throw new Error('OIDC audience mismatch');
  if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now() - 60_000)
    throw new Error('OIDC token expired');
  if (payload.nonce !== st.nonce) throw new Error('OIDC nonce mismatch');
  let claims: OidcClaims = payload;
  // Some providers only put email/profile in userinfo.
  if ((!claims.email || !claims.name) && doc.userinfo_endpoint && tokens.access_token) {
    const ui = await fetch(doc.userinfo_endpoint, {
      headers: { authorization: `Bearer ${tokens.access_token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (ui.ok) {
      const info = (await ui.json()) as OidcClaims;
      if (info.sub === claims.sub)
        claims = {
          ...info,
          ...claims,
          email: claims.email ?? info.email,
          name: claims.name ?? info.name,
        };
    }
  }
  return claims;
}
