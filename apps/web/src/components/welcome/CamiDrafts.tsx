import React, { useState, useEffect, useCallback } from "react";
import { Clock, Film, ExternalLink, Cloud } from "lucide-react";

// Cami draft row shape from Cami's list-drafts EF.
// Only the fields we render. Aligned with reel_drafts schema.
interface CamiDraftRow {
  id: string;
  title: string | null;
  status: string;
  duration_seconds: number | null;
  thumbnail_url: string | null;
  created_at: string;
  updated_at: string;
}

interface CamiDraftsProps {
  /** Open the given draft in this same tab (Phase 4b.1 hash-route flow). */
  onOpenDraft: (draftId: string) => void;
}

/**
 * Phase 4b.1: surfaces Cami drafts inside EVE's welcome → Recent tab,
 * above the local IndexedDB project list. Clicking a row routes the
 * browser to #/draft/<id>, which App.tsx then resolves via
 * projectManager.loadFromDraft.
 */
export const CamiDrafts: React.FC<CamiDraftsProps> = ({ onOpenDraft }) => {
  const [drafts, setDrafts] = useState<CamiDraftRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const url = import.meta.env.VITE_CAMI_SUPABASE_URL as string | undefined;
    const key = import.meta.env.VITE_CAMI_SUPABASE_ANON_KEY as string | undefined;
    if (!url || !key) {
      // Not configured — silently render nothing.
      setDrafts([]);
      return;
    }
    let cancelled = false;
    fetch(`${url}/functions/v1/list-drafts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        apikey: key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ limit: 50 }),
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: { drafts?: CamiDraftRow[] }) => {
        if (cancelled) return;
        setDrafts(data.drafts ?? []);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        console.error("[CamiDrafts] list-drafts failed:", e);
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const formatAge = useCallback((iso: string): string => {
    const t = new Date(iso).getTime();
    const diffMs = Date.now() - t;
    const mins = Math.floor(diffMs / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(iso).toLocaleDateString();
  }, []);

  // Hide entire section when no data, no error, and load hasn't returned empty.
  if (drafts === null && error === null) {
    return null; // still loading; don't flash
  }
  if (error) {
    return (
      <div className="mb-8 p-4 rounded-xl border border-yellow-500/20 bg-yellow-500/5 text-xs text-yellow-200/80">
        Couldn't load Cami drafts: {error}
      </div>
    );
  }
  if (drafts && drafts.length === 0) {
    // No drafts yet — render nothing, let RecentProjects own the empty-state.
    return null;
  }

  return (
    <div className="space-y-4 mb-10">
      <div className="flex items-center gap-2">
        <Cloud size={14} className="text-purple-400" />
        <h3 className="text-sm font-medium text-text-primary">
          Cami Drafts ({drafts?.length ?? 0})
        </h3>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {drafts?.map((d) => {
          const title = d.title || "Untitled draft";
          return (
            <button
              key={d.id}
              onClick={() => onOpenDraft(d.id)}
              className="group flex flex-col bg-background-tertiary rounded-xl border border-purple-500/20 hover:border-purple-500/60 hover:bg-background-elevated transition-all overflow-hidden text-left"
            >
              <div className="aspect-video w-full bg-background flex items-center justify-center border-b border-border relative">
                {d.thumbnail_url ? (
                  <img
                    src={d.thumbnail_url}
                    alt={title}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Film
                    size={32}
                    className="text-purple-400/30 group-hover:text-purple-400/60 transition-colors"
                  />
                )}
                <span className="absolute top-2 right-2 text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 backdrop-blur-sm">
                  {d.status}
                </span>
              </div>
              <div className="p-3 flex-1">
                <h4 className="text-sm font-medium text-text-primary truncate group-hover:text-purple-400 transition-colors flex items-center gap-1.5">
                  {title}
                  <ExternalLink
                    size={11}
                    className="opacity-0 group-hover:opacity-60 transition-opacity"
                  />
                </h4>
                <div className="flex items-center gap-1.5 mt-1.5 text-xs text-text-muted">
                  <Clock size={11} />
                  <span>{formatAge(d.updated_at)}</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default CamiDrafts;
