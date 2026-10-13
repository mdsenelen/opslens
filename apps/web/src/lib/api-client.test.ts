import { afterEach, describe, expect, it, vi } from "vitest";

// The base URL is read once at module load, so each case stubs the
// environment first and then imports a fresh copy of the module.
async function fetchedUrl(env: Record<string, string | undefined>): Promise<string> {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const { getPing } = await import("./api-client");
  await getPing();
  return String((fetchMock.mock.calls[0] as unknown[])[0]);
}

describe("api-client base URL", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("uses the public URL in the browser, where only NEXT_PUBLIC_ variables exist", async () => {
    // Next.js inlines NEXT_PUBLIC_* into the client bundle; OPSLENS_API_URL
    // is server-only and is undefined there. A deployed site whose browser
    // fetches fell back to localhost:4000 would call the visitor's machine.
    expect(await fetchedUrl({ OPSLENS_API_URL: undefined, NEXT_PUBLIC_OPSLENS_API_URL: "https://api.example.com" })).toBe("https://api.example.com/api/ping");
  });

  it("prefers the server-only URL on the server, when both are set", async () => {
    expect(await fetchedUrl({ OPSLENS_API_URL: "http://internal:4000", NEXT_PUBLIC_OPSLENS_API_URL: "https://api.example.com" })).toBe("http://internal:4000/api/ping");
  });

  it("falls back to the local API when neither is set", async () => {
    expect(await fetchedUrl({ OPSLENS_API_URL: undefined, NEXT_PUBLIC_OPSLENS_API_URL: undefined })).toBe("http://localhost:4000/api/ping");
  });
});
