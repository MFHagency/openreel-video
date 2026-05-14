/**
 * AIPanel - Phase 4b.2
 *
 * Right-side drawer providing 4 AI capabilities for the current Cami draft:
 *  - Captions (IG caption + hashtags + hook text)
 *  - Music recommendations (3-5 audio_bank tracks)
 *  - Effects suggestions (text-only visual effect recommendations)
 *  - Re-pitch (fresh HOOK->BRIDGE->PEAK->CLOSE candidates)
 *
 * Each tab calls a dedicated EF (ai-captions, ai-music, ai-effects, ai-repitch).
 * All EFs share _shared/ai_call, ai_budget, ai_ledger; budget enforced per creator.
 *
 * Requires project._camiMeta to be populated (set by loadFromDraft / importFromCami).
 */
import { useState, useCallback, useMemo } from "react";
import {
  Sparkles,
  X,
  Loader2,
  FileText,
  Music,
  Wand2,
  Shuffle,
  Copy,
  Check,
  AlertCircle,
} from "lucide-react";
import { useProjectStore } from "../../stores/project-store";
import { applyRepitchCandidates } from "./applyRepitchCandidates";

type CapabilityId = "captions" | "music" | "effects" | "repitch";

interface SpendInfo {
  this_call_usd: number;
  month_used_usd: number;
  month_budget_usd: number;
}

interface AIResult {
  data: unknown;
  spend: SpendInfo;
  model: string;
}

interface AIPanelProps {
  open: boolean;
  onClose: () => void;
}

const TABS: { id: CapabilityId; label: string; icon: typeof FileText; efName: string }[] = [
  { id: "captions", label: "Captions", icon: FileText, efName: "ai-captions" },
  { id: "music", label: "Music", icon: Music, efName: "ai-music" },
  { id: "effects", label: "Effects", icon: Wand2, efName: "ai-effects" },
  { id: "repitch", label: "Re-pitch", icon: Shuffle, efName: "ai-repitch" },
];

export function AIPanel({ open, onClose }: AIPanelProps) {
  const camiMeta = useProjectStore((s) => s.project._camiMeta);
  const [activeTab, setActiveTab] = useState<CapabilityId>("captions");
  const [escalate, setEscalate] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Partial<Record<CapabilityId, AIResult>>>({});
  const [errors, setErrors] = useState<Partial<Record<CapabilityId, string>>>({});
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [applyingRepitch, setApplyingRepitch] = useState(false);

  const monthSpend = useMemo(() => {
    // Show the most recent spend from any tab's result (they all read the same source).
    let latest: SpendInfo | null = null;
    for (const tabId of TABS.map((t) => t.id)) {
      const r = results[tabId];
      if (r && (!latest || r.spend.month_used_usd > latest.month_used_usd)) {
        latest = r.spend;
      }
    }
    return latest;
  }, [results]);

  const callEF = useCallback(
    async (capability: CapabilityId) => {
      if (!camiMeta?.draftId || !camiMeta?.creatorId) {
        setErrors((e) => ({
          ...e,
          [capability]: "Open this project from Cami Drafts to enable AI tools.",
        }));
        return;
      }
      const url = import.meta.env.VITE_CAMI_SUPABASE_URL;
      const key = import.meta.env.VITE_CAMI_SUPABASE_ANON_KEY;
      if (!url || !key) {
        setErrors((e) => ({ ...e, [capability]: "Missing Cami connection config." }));
        return;
      }
      const tab = TABS.find((t) => t.id === capability)!;
      setLoading(true);
      setErrors((e) => ({ ...e, [capability]: "" }));
      try {
        const resp = await fetch(`${url}/functions/v1/${tab.efName}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            apikey: key,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            draft_id: camiMeta.draftId,
            content_file_id: camiMeta.contentFileId,
            creator_id: camiMeta.creatorId,
            escalate_to_sonnet: escalate,
          }),
        });
        const body = await resp.json();
        if (!resp.ok) {
          throw new Error(body?.error || `HTTP ${resp.status}`);
        }
        setResults((r) => ({
          ...r,
          [capability]: { data: body.result, spend: body.spend, model: body.model },
        }));
      } catch (err) {
        setErrors((e) => ({
          ...e,
          [capability]: err instanceof Error ? err.message : String(err),
        }));
      } finally {
        setLoading(false);
      }
    },
    [camiMeta, escalate],
  );

  const copyToClipboard = useCallback((text: string, fieldId: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedField(fieldId);
    setTimeout(() => setCopiedField(null), 1500);
  }, []);

  const handleApplyRepitch = useCallback(async () => {
    const repitchResult = results["repitch"];
    const candidates = (repitchResult?.data as { candidates?: { arc: "hook" | "bridge" | "peak" | "close"; start_seconds: number; end_seconds: number; rationale: string }[] } | undefined)?.candidates;
    if (!candidates || candidates.length === 0) return;

    const confirmed = window.confirm(
      `This will replace the current video track with ${candidates.length} new clips ` +
        `(HOOK / BRIDGE / PEAK / CLOSE). The existing timeline edit will be lost. Continue?`,
    );
    if (!confirmed) return;

    setApplyingRepitch(true);
    try {
      const project = useProjectStore.getState().project;
      const result = applyRepitchCandidates(project, candidates);
      if (!result.ok) {
        console.error("[applyRepitchCandidates] failed:", result.reason);
        alert(`Could not apply candidates: ${result.reason}. Please re-import the draft.`);
        return;
      }
      useProjectStore.getState().replaceTrackClips(result.trackId, result.newClips);
      onClose();
    } catch (err) {
      console.error("[handleApplyRepitch] error:", err);
      alert("An error occurred while applying. See console.");
    } finally {
      setApplyingRepitch(false);
    }
  }, [results, onClose]);

  if (!open) return null;

  const isDisabled = !camiMeta?.draftId;

  return (
    <div className="fixed inset-y-0 right-0 w-[420px] bg-background border-l border-border z-50 flex flex-col shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-background-secondary">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-purple-400" />
          <span className="text-sm font-medium text-text-primary">AI Assist</span>
        </div>
        <button
          onClick={onClose}
          className="p-1 hover:bg-background-tertiary rounded text-text-muted hover:text-text-primary transition-colors"
          aria-label="Close AI panel"
        >
          <X size={16} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border bg-background-secondary">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                isActive
                  ? "border-purple-400 text-purple-400 bg-background"
                  : "border-transparent text-text-muted hover:text-text-secondary"
              }`}
            >
              <Icon size={12} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Disabled banner */}
      {isDisabled && (
        <div className="mx-3 mt-3 p-2 bg-amber-500/10 border border-amber-500/30 rounded text-[11px] text-amber-300 flex items-start gap-1.5">
          <AlertCircle size={12} className="mt-0.5 shrink-0" />
          <span>This project is not linked to a Cami draft. Open from the Drafts page to enable AI tools.</span>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Controls row */}
        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-text-secondary cursor-pointer select-none">
            <input
              type="checkbox"
              checked={escalate}
              onChange={(e) => setEscalate(e.target.checked)}
              className="accent-purple-400"
            />
            Use Sonnet (smarter, ~12x cost)
          </label>
          <button
            onClick={() => callEF(activeTab)}
            disabled={loading || isDisabled}
            className="px-3 py-1.5 bg-purple-500/20 hover:bg-purple-500/30 disabled:opacity-50 disabled:cursor-not-allowed text-purple-300 rounded text-xs font-medium flex items-center gap-1.5 transition-colors"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            {loading ? "Generating…" : "Generate"}
          </button>
        </div>

        {/* Error */}
        {errors[activeTab] && (
          <div className="p-2 bg-error/10 border border-error/30 rounded text-[11px] text-error flex items-start gap-1.5">
            <AlertCircle size={12} className="mt-0.5 shrink-0" />
            <span className="break-words">{errors[activeTab]}</span>
          </div>
        )}

        {/* Result */}
        {results[activeTab] && (
          <ResultDisplay
            capability={activeTab}
            result={results[activeTab]!}
            copiedField={copiedField}
            onCopy={copyToClipboard}
          />
        )}

        {/* Re-pitch apply button — only shown when exactly 4 candidates returned */}
        {activeTab === "repitch" &&
          (results["repitch"]?.data as { candidates?: unknown[] } | undefined)?.candidates?.length === 4 && (
            <button
              type="button"
              className="mt-3 w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white py-2 rounded text-sm font-medium transition-colors"
              onClick={() => void handleApplyRepitch()}
              disabled={applyingRepitch}
            >
              {applyingRepitch ? "Applying…" : "Replace timeline candidates"}
            </button>
          )}
      </div>

      {/* Spend chip */}
      <div className="px-4 py-2 border-t border-border bg-background-secondary text-[11px] text-text-muted flex items-center justify-between">
        <span>
          {monthSpend
            ? `$${monthSpend.month_used_usd.toFixed(4)} / $${monthSpend.month_budget_usd.toFixed(2)} this month`
            : "Token spend will appear here"}
        </span>
        {results[activeTab] && (
          <span className="text-text-secondary">
            {results[activeTab]!.model.includes("sonnet") ? "Sonnet 4.5" : "Haiku 4.5"}
          </span>
        )}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Result renderers per capability
// -----------------------------------------------------------------------------

interface ResultDisplayProps {
  capability: CapabilityId;
  result: AIResult;
  copiedField: string | null;
  onCopy: (text: string, fieldId: string) => void;
}

function ResultDisplay({ capability, result, copiedField, onCopy }: ResultDisplayProps) {
  switch (capability) {
    case "captions":
      return <CaptionsResult data={result.data} copiedField={copiedField} onCopy={onCopy} />;
    case "music":
      return <MusicResult data={result.data} />;
    case "effects":
      return <EffectsResult data={result.data} />;
    case "repitch":
      return <RepitchResult data={result.data} />;
  }
}

function CopyBtn({
  text,
  fieldId,
  copiedField,
  onCopy,
}: {
  text: string;
  fieldId: string;
  copiedField: string | null;
  onCopy: (text: string, fieldId: string) => void;
}) {
  const isCopied = copiedField === fieldId;
  return (
    <button
      onClick={() => onCopy(text, fieldId)}
      className="p-1 hover:bg-background-tertiary rounded text-text-muted hover:text-text-primary transition-colors"
      aria-label={`Copy ${fieldId}`}
    >
      {isCopied ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
    </button>
  );
}

interface CaptionData {
  caption: string;
  hashtags: string[];
  hook_text: string;
  hook_type: string;
  cta: string;
  alt_captions: string[];
}

function CaptionsResult({
  data,
  copiedField,
  onCopy,
}: {
  data: unknown;
  copiedField: string | null;
  onCopy: (text: string, fieldId: string) => void;
}) {
  const d = data as CaptionData;
  return (
    <div className="space-y-2.5 text-xs">
      <Field label="Hook text" badge={d.hook_type}>
        <div className="flex items-start gap-2">
          <p className="flex-1 text-text-primary">{d.hook_text}</p>
          <CopyBtn text={d.hook_text} fieldId="hook" copiedField={copiedField} onCopy={onCopy} />
        </div>
      </Field>
      <Field label="Caption">
        <div className="flex items-start gap-2">
          <p className="flex-1 text-text-primary whitespace-pre-wrap">{d.caption}</p>
          <CopyBtn text={d.caption} fieldId="caption" copiedField={copiedField} onCopy={onCopy} />
        </div>
      </Field>
      <Field label="CTA">
        <div className="flex items-start gap-2">
          <p className="flex-1 text-text-primary">{d.cta}</p>
          <CopyBtn text={d.cta} fieldId="cta" copiedField={copiedField} onCopy={onCopy} />
        </div>
      </Field>
      <Field label="Hashtags">
        <div className="flex items-start gap-2">
          <p className="flex-1 text-text-primary break-words">{d.hashtags.join(" ")}</p>
          <CopyBtn
            text={d.hashtags.join(" ")}
            fieldId="tags"
            copiedField={copiedField}
            onCopy={onCopy}
          />
        </div>
      </Field>
      {d.alt_captions?.length > 0 && (
        <Field label="Alternates">
          <div className="space-y-1.5">
            {d.alt_captions.map((alt, i) => (
              <div key={i} className="flex items-start gap-2">
                <p className="flex-1 text-text-secondary">{alt}</p>
                <CopyBtn
                  text={alt}
                  fieldId={`alt-${i}`}
                  copiedField={copiedField}
                  onCopy={onCopy}
                />
              </div>
            ))}
          </div>
        </Field>
      )}
    </div>
  );
}

interface MusicData {
  picks: Array<{ audio_id: string; title: string; rationale: string }>;
}

function MusicResult({ data }: { data: unknown }) {
  const d = data as MusicData;
  return (
    <div className="space-y-2 text-xs">
      <p className="text-[11px] text-text-muted italic">
        Copy a title to find it in the audio library.
      </p>
      {d.picks?.map((pick, i) => (
        <div key={pick.audio_id} className="p-2 bg-background-secondary rounded border border-border">
          <div className="font-medium text-text-primary">
            {i + 1}. {pick.title}
          </div>
          <p className="text-text-muted text-[11px] mt-1">{pick.rationale}</p>
        </div>
      ))}
      <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-900">
        <strong>Audio swap not yet wired.</strong> Recommendations above are advisory.
        Wiring the swap into the timeline is pending Oscar&apos;s decision on audio library source
        (ccMixter / Suno / Epidemic Sound). Tracked as a Phase 4b.3+ follow-up.
      </div>
    </div>
  );
}

interface EffectsData {
  effects: Array<{ name: string; where: string; rationale: string }>;
}

function EffectsResult({ data }: { data: unknown }) {
  const d = data as EffectsData;
  return (
    <div className="space-y-2 text-xs">
      <p className="text-[11px] text-text-muted italic">
        Text-only suggestions. Apply manually via the Effects panel.
      </p>
      {d.effects?.map((fx, i) => (
        <div key={i} className="p-2 bg-background-secondary rounded border border-border">
          <div className="font-medium text-text-primary">{fx.name}</div>
          <div className="text-[11px] text-purple-300 mt-0.5">Apply to: {fx.where}</div>
          <p className="text-text-muted text-[11px] mt-1">{fx.rationale}</p>
        </div>
      ))}
    </div>
  );
}

interface RepitchData {
  candidates: Array<{
    arc: string;
    start_seconds: number;
    end_seconds: number;
    rationale: string;
  }>;
}

const ARC_COLORS: Record<string, string> = {
  hook: "text-rose-400 bg-rose-500/10 border-rose-500/30",
  bridge: "text-amber-400 bg-amber-500/10 border-amber-500/30",
  peak: "text-fuchsia-400 bg-fuchsia-500/10 border-fuchsia-500/30",
  close: "text-sky-400 bg-sky-500/10 border-sky-500/30",
};

function RepitchResult({ data }: { data: unknown }) {
  const d = data as RepitchData;
  const total = (d.candidates || []).reduce(
    (sum, c) => sum + (c.end_seconds - c.start_seconds),
    0,
  );
  return (
    <div className="space-y-2 text-xs">
      <p className="text-[11px] text-text-muted italic">
        Fresh arc suggestions. Use the button below to replace the timeline. Total: {total.toFixed(1)}s.
      </p>
      {d.candidates?.map((c, i) => {
        const colorClass = ARC_COLORS[c.arc] || "text-text-secondary bg-background-tertiary";
        return (
          <div key={i} className="p-2 bg-background-secondary rounded border border-border">
            <div className="flex items-center gap-2">
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase border ${colorClass}`}>
                {c.arc}
              </span>
              <span className="text-text-secondary font-mono text-[11px]">
                {c.start_seconds.toFixed(1)}s → {c.end_seconds.toFixed(1)}s
                <span className="text-text-muted ml-1">({(c.end_seconds - c.start_seconds).toFixed(1)}s)</span>
              </span>
            </div>
            <p className="text-text-muted text-[11px] mt-1.5">{c.rationale}</p>
          </div>
        );
      })}
    </div>
  );
}

function Field({
  label,
  badge,
  children,
}: {
  label: string;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wide font-medium text-text-muted">
          {label}
        </span>
        {badge && (
          <span className="text-[9px] px-1 py-0.5 bg-purple-500/15 text-purple-300 rounded uppercase font-medium">
            {badge}
          </span>
        )}
      </div>
      <div className="text-text-primary">{children}</div>
    </div>
  );
}
