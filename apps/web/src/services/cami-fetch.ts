// cami-fetch.ts
// Phase 5: fetch wrapper for Cami EF calls.
// Attaches draft_jwt as Authorization: Bearer header if present in _camiMeta.
// Falls back to the project's anon key when draft_jwt is unavailable.
// On HTTP 401 with a draft_jwt, refreshes the token via load-draft and retries once.

import { useProjectStore } from "../stores/project-store";

const SUPABASE_URL = import.meta.env.VITE_CAMI_SUPABASE_URL as string;
const ANON_KEY = import.meta.env.VITE_CAMI_SUPABASE_ANON_KEY as string;

/** Fire a single POST to a Cami EF with the given jwt as Authorization header. */
function postEf(efName: string, body: Record<string, unknown>, jwt: string): Promise<Response> {
  return fetch(`${SUPABASE_URL}/functions/v1/${efName}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      apikey: ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

/**
 * Call load-draft to mint a fresh draft_jwt, persist it to the project store,
 * and return the new token. Returns null if refresh fails.
 */
async function refreshDraftJwt(draftId: string): Promise<string | null> {
  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/load-draft`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ANON_KEY}`,
        apikey: ANON_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ draft_id: draftId }),
    });
    if (!resp.ok) {
      console.warn("[camiEfFetch] load-draft refresh failed:", resp.status);
      return null;
    }
    const data = (await resp.json()) as { draft_jwt?: string };
    if (!data.draft_jwt) return null;

    // Persist fresh token so subsequent calls use it without another refresh.
    const { project } = useProjectStore.getState();
    if (project._camiMeta) {
      useProjectStore.getState().setCamiMeta({
        ...project._camiMeta,
        draft_jwt: data.draft_jwt,
      });
    }
    return data.draft_jwt;
  } catch (err) {
    console.warn("[camiEfFetch] load-draft refresh error:", err);
    return null;
  }
}

/**
 * POST to a Cami EF with automatic draft_jwt auth and one-shot 401 refresh.
 *
 * Uses draft_jwt from _camiMeta if present; falls back to the project anon key.
 * On HTTP 401 (expired JWT), calls load-draft to get a fresh token, updates
 * the store, and retries the original request once. If the retry also returns
 * 401, returns the retry response (caller sees the error).
 */
export async function camiEfFetch(
  efName: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const camiMeta = useProjectStore.getState().project._camiMeta;
  const jwt = camiMeta?.draft_jwt ?? ANON_KEY;

  const resp = await postEf(efName, body, jwt);

  // On 401, refresh once if we hold a draft_jwt (not the anon key).
  if (resp.status === 401 && camiMeta?.draft_jwt && camiMeta.draftId) {
    const newJwt = await refreshDraftJwt(camiMeta.draftId);
    if (newJwt) {
      return postEf(efName, body, newJwt);
    }
    // Refresh failed — surface the original 401 to the caller.
  }

  return resp;
}
