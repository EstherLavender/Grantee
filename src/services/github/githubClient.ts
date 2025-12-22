const GH = "https://api.github.com";

export async function gh<T>(path: string, token?: string): Promise<T> {
  const res = await fetch(`${GH}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "User-Agent": "grantees-api",
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GitHub API error ${res.status}: ${text || res.statusText}`);
  }

  return (await res.json()) as T;
}
