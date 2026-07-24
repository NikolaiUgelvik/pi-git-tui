import type { SingleLineTextField } from "./single-line-text-field.js";
import type { HelpContext } from "./types.js";
export type ViewerFeatureOverlayKind = "confirmation" | "branch" | "tag" | "stash" | "worktree" | "settings";
export interface ViewerOverlayAdapter {
    isActive: () => boolean;
    activeTextField: () => SingleLineTextField | undefined;
    helpContext: () => HelpContext;
    render: (baseLines: string[], width: number) => string[];
    handleInput: (data: string) => void;
    handleOpen: (data: string) => boolean;
    close: () => void;
}
export interface ViewerOverlayFeature {
    readonly kind: ViewerFeatureOverlayKind;
    readonly adapter: ViewerOverlayAdapter;
    invalidate?(): void;
}
export declare class ViewerOverlayCoordinator {
    private readonly overlays;
    /** Later registrations have higher input, rendering, and open priority. */
    register(feature: ViewerOverlayFeature): void;
    active(): ViewerOverlayFeature | undefined;
    hasActive(): boolean;
    activeTextField(): SingleLineTextField | undefined;
    helpContext(): HelpContext | undefined;
    render(baseLines: string[], width: number): string[];
    handleInput(data: string): boolean;
    handleOpen(data: string): boolean;
    closeActive(): boolean;
}
