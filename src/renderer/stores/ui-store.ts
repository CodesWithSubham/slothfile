import { create } from 'zustand';

interface UiState {
  activeFolderId: string | null;
  activePlanId: string | null;
  setActiveFolder: (id: string | null) => void;
  setActivePlan: (id: string | null) => void;
  selectedFileIds: Set<string>;
  toggleFile: (id: string) => void;
  setSelectedFiles: (ids: string[]) => void;
  clearSelection: () => void;
}

/** UI-only state. Server data (files, plans, history) lives in TanStack Query, not here. */
export const useUi = create<UiState>((set) => ({
  activeFolderId: null,
  activePlanId: null,
  setActiveFolder: (id) => set({ activeFolderId: id, selectedFileIds: new Set() }),
  setActivePlan: (id) => set({ activePlanId: id }),
  selectedFileIds: new Set(),
  toggleFile: (id) => set((s) => { const n = new Set(s.selectedFileIds); if (n.has(id)) n.delete(id); else n.add(id); return { selectedFileIds: n }; }),
  setSelectedFiles: (ids) => set({ selectedFileIds: new Set(ids) }),
  clearSelection: () => set({ selectedFileIds: new Set() })
}));
