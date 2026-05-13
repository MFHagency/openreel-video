import { useState, useEffect, useCallback, useRef } from "react";
import { autoSaveManager, type AutoSaveMetadata } from "../services/auto-save";
import { useProjectStore } from "../stores/project-store";

interface RecoveryState {
  isChecking: boolean;
  availableSaves: AutoSaveMetadata[];
  showDialog: boolean;
}

export function useProjectRecovery(options?: { skip?: boolean }) {
  const skip = options?.skip ?? false;
  // Latch: once we've decided to skip for this tab's lifetime, never run the
  // autosave check, even if the route flips later. This prevents the dialog
  // from appearing after navigate("editor") fires post-loadFromDraft.
  const everSkipped = useRef<boolean>(skip);
  if (skip) everSkipped.current = true;
  const effectiveSkip = everSkipped.current;
  const [state, setState] = useState<RecoveryState>({
    isChecking: !effectiveSkip,
    availableSaves: [],
    showDialog: false,
  });

  const recoverFromAutoSave = useProjectStore((s) => s.recoverFromAutoSave);

  useEffect(() => {
    if (effectiveSkip) {
      setState({ isChecking: false, availableSaves: [], showDialog: false });
      return;
    }
    const checkForRecovery = async () => {
      try {
        await autoSaveManager.initialize();
        const saves = await autoSaveManager.checkForRecovery();

        if (saves.length > 0) {
          setState({
            isChecking: false,
            availableSaves: saves,
            showDialog: true,
          });
        } else {
          setState({
            isChecking: false,
            availableSaves: [],
            showDialog: false,
          });
        }
      } catch (error) {
        console.warn("[Recovery] Failed to check for saves:", error);
        setState({
          isChecking: false,
          availableSaves: [],
          showDialog: false,
        });
      }
    };

    checkForRecovery();
  }, [effectiveSkip]);

  const recover = useCallback(
    async (saveId: string) => {
      const success = await recoverFromAutoSave(saveId);
      if (success) {
        setState((prev) => ({ ...prev, showDialog: false }));
      }
      return success;
    },
    [recoverFromAutoSave],
  );

  const dismiss = useCallback(() => {
    setState((prev) => ({ ...prev, showDialog: false }));
  }, []);

  const clearAll = useCallback(async () => {
    await autoSaveManager.clearAllSaves();
    setState((prev) => ({ ...prev, availableSaves: [], showDialog: false }));
  }, []);

  return {
    isChecking: state.isChecking,
    availableSaves: state.availableSaves,
    showDialog: state.showDialog,
    recover,
    dismiss,
    clearAll,
  };
}
