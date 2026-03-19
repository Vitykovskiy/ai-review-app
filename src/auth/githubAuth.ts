import jwt from 'jsonwebtoken';

interface CachedToken {
  token: string;
  expiresAt: number;
}

const tokenCache = new Map<number, CachedToken>();

export function generateJWT(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    { iat: now - 60, exp: now + 600, iss: appId },
    privateKey,
    { algorithm: 'RS256' }
  );
}

export async function getInstallationToken(
  installationId: number,
  appId: string,
  privateKey: string
): Promise<string> {
  const cached = tokenCache.get(installationId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }

  const jwtToken = generateJWT(appId, privateKey);

  const response = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwtToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to get installation token (${response.status}): ${text}`
    );
  }

  const data = (await response.json()) as { token: string; expires_at: string };

  // Cache token with 5 minute buffer before expiry
  const expiresAt = new Date(data.expires_at).getTime() - 5 * 60 * 1000;
  tokenCache.set(installationId, { token: data.token, expiresAt });

  return data.token;
}
