import type { SingleLineTextField } from "./single-line-text-field.js";
import type { HelpContext } from "./types.js";
export type ViewerFeatureOverlayKind = "confirmation" | "branch" | "stash" | "worktree";
export interface ViewerOverlayAdapter {
    isActive: () => boolean;
    activeTextField: () => SingleLineTextField | undefined;
    helpContext: () => HelpContext;
    render: (baseLines: string[], width: number) => string[];
    handleInput: (data: string) => void;
    handleOpen: (data: string) => boolean;
    close: () => void;
}
export type ActiveOverlay = {
    kind: "confirmation";
    adapter: ViewerOverlayAdapter;
} | {
    kind: "branch";
    adapter: ViewerOverlayAdapter;
} | {
    kind: "stash";
    adapter: ViewerOverlayAdapter;
} | {
    kind: "worktree";
    adapter: ViewerOverlayAdapter;
};
export declare class ViewerOverlayCoordinator {
    private readonly overlays;
    register(kind: ViewerFeatureOverlayKind, adapter: ViewerOverlayAdapter): void;
    active(): ActiveOverlay | undefined;
    hasActive(): boolean;
    activeTextField(): SingleLineTextField | undefined;
    helpContext(): HelpContext | undefined;
    render(baseLines: string[], width: number): string[];
    handleInput(data: string): boolean;
    handleOpen(data: string): boolean;
    closeActive(): boolean;
}
