import type { Theme } from "@earendil-works/pi-coding-agent"
import { matchesKey } from "@earendil-works/pi-tui"
import { FilterableListState, isEnter } from "./filterable-list-state.js"
import { createOverlayFrame, renderOverlayFrame } from "./overlay-frame.js"
import { handleFilterableListInput, isEscapeInput, resetFilterableList } from "./overlay-input.js"
import { type PickerRequest, PickerSession } from "./picker-session.js"
import { SingleLineTextField } from "./single-line-text-field.js"
import type { CommitSummary, TagSummary } from "./types.js"

export type TagPickerState = "closed" | "loading" | "open" | "target" | "create"

export interface TagCreation {
  name: string
  target: CommitSummary
  annotated: boolean
  message?: string
}

export interface TagPickerCallbacks {
  onSelect: (tag: TagSummary) => void
  onRequestTargets: () => void
  onCreate: (creation: TagCreation) => void
  onValidationError: (message: string) => void
  onClose: () => void
  onRequestRender: () => void
}

export class TagPickerController {
  public readonly list: FilterableListState<TagSummary>
  public readonly commits: FilterableListState<CommitSummary>
  public createTarget: CommitSummary | undefined
  public createAnnotated = false

  private readonly session = new PickerSession<"open" | "target" | "create">()
  private readonly nameField = new SingleLineTextField()
  private readonly messageField = new SingleLineTextField()
  private createFocus: "name" | "message" = "name"

  constructor(private readonly callbacks: TagPickerCallbacks) {
    this.list = new FilterableListState<TagSummary>([], (tag) =>
      [
        tag.name,
        tag.annotated ? "annotated" : "lightweight",
        tag.targetHash,
        tag.targetType,
        tag.createdAt,
        tag.creator,
        tag.annotation,
        tag.targetSubject,
      ]
        .filter(Boolean)
        .join(" "),
    )
    this.commits = new FilterableListState<CommitSummary>([], (commit) => `${commit.hash} ${commit.message}`)
  }

  get state(): TagPickerState {
    return this.session.state
  }

  get loadingMessage(): string | undefined {
    return this.session.loadingMessage
  }

  get createName(): string {
    return this.nameField.value
  }

  set createName(value: string) {
    this.nameField.setValue(value, "end")
  }

  get createMessage(): string {
    return this.messageField.value
  }

  set createMessage(value: string) {
    this.messageField.setValue(value, "end")
  }

  public activeTextField(): SingleLineTextField | undefined {
    if (this.state === "open") return this.list.searchField
    if (this.state === "target") return this.commits.searchField
    if (this.state === "create") return this.createFocus === "message" ? this.messageField : this.nameField
  }

  public open(tags: TagSummary[]): void {
    this.session.transition("open")
    this.list.items = tags
    this.clearCreation()
    resetFilterableList(this.list, this.callbacks.onRequestRender)
  }

  public openTargetSelection(commits: CommitSummary[]): void {
    this.session.transition("target")
    this.commits.items = commits
    resetFilterableList(this.commits, this.callbacks.onRequestRender)
  }

  public refreshTags(tags: TagSummary[]): void {
    this.list.items = tags
    this.list.clampSelection()
    this.callbacks.onRequestRender()
  }

  public showTagList(): void {
    this.session.transition("open")
    this.list.searchQuery = ""
    this.list.reset()
    this.clearCreation()
    this.callbacks.onRequestRender()
  }

  public beginLoading(message: string, returnState: Exclude<TagPickerState, "loading">): PickerRequest {
    return this.session.beginLoading(message, returnState)
  }

  public isCurrent(request: PickerRequest): boolean {
    return this.session.isCurrent(request)
  }

  public finishLoading(request: PickerRequest, nextState: Exclude<TagPickerState, "loading">): boolean {
    return this.session.finish(request, nextState)
  }

  public cancelLoading(): Exclude<TagPickerState, "loading"> {
    return this.session.cancelLoading()
  }

  public updateLoadingMessage(message: string): void {
    this.session.updateLoadingMessage(message)
  }

  public close(): void {
    this.session.close()
    this.clearCreation()
    this.callbacks.onClose()
    this.callbacks.onRequestRender()
  }

  public handleInput(data: string): void {
    if (this.state === "loading" || this.state === "closed") return
    if (isEscapeInput(data)) {
      this.handleEscape()
      return
    }
    if (this.state === "create") {
      this.handleCreateInput(data)
    } else if (this.state === "target") {
      handleFilterableListInput(data, this.commits, (commit) => this.beginCreate(commit))
      this.commits.clampSelection()
    } else if (this.isCreateShortcut(data)) {
      this.callbacks.onRequestTargets()
    } else {
      handleFilterableListInput(data, this.list, this.callbacks.onSelect)
      this.list.clampSelection()
    }
    this.callbacks.onRequestRender()
  }

  private handleEscape(): void {
    if (this.state === "create") {
      this.session.transition("target")
      this.clearCreation()
      this.callbacks.onRequestRender()
      return
    }
    if (this.state === "target") {
      this.session.transition("open")
      this.callbacks.onRequestRender()
      return
    }
    this.close()
  }

  private isCreateShortcut(data: string): boolean {
    return matchesKey(data, "ctrl+n") || data === "\x0e"
  }

  private beginCreate(target: CommitSummary): void {
    this.createTarget = target
    this.createAnnotated = false
    this.createName = ""
    this.createMessage = ""
    this.createFocus = "name"
    this.session.transition("create")
  }

  private handleCreateInput(data: string): void {
    if (matchesKey(data, "ctrl+t") || data === "\x14") {
      this.createAnnotated = !this.createAnnotated
      if (!this.createAnnotated) this.createFocus = "name"
      return
    }
    if (matchesKey(data, "tab") || data === "\t") {
      if (this.createAnnotated) this.createFocus = this.createFocus === "name" ? "message" : "name"
      return
    }
    if (isEnter(data)) {
      this.submitCreation()
      return
    }
    const field = this.createFocus === "message" ? this.messageField : this.nameField
    field.handleInput(data, "editor")
  }

  private submitCreation(): void {
    const name = this.createName.trim()
    const message = this.createMessage.trim()
    if (!name) {
      this.callbacks.onValidationError("Tag name is empty")
      return
    }
    if (this.createAnnotated && !message) {
      this.callbacks.onValidationError("Annotated tag message is empty")
      return
    }
    const target = this.createTarget
    if (!target) {
      this.callbacks.onValidationError("Select a target commit")
      return
    }
    this.callbacks.onCreate({
      name,
      target,
      annotated: this.createAnnotated,
      message: this.createAnnotated ? message : undefined,
    })
  }

  private clearCreation(): void {
    this.createTarget = undefined
    this.createName = ""
    this.createMessage = ""
    this.createAnnotated = false
    this.createFocus = "name"
  }

  public renderOverlayLines(baseLineCount: number, width: number, theme: Theme): string[] {
    const frame = createOverlayFrame(baseLineCount, width, theme)
    return renderOverlayFrame(
      frame,
      ` ${theme.fg("accent", theme.bold(this.title()))}`,
      ` ${theme.fg("dim", this.hint(frame.compact))}`,
      this.renderBody(frame.maxItems, frame.innerWidth, frame.compact, theme),
    )
  }

  private title(): string {
    if (this.state === "target") return "Select tag target"
    if (this.state === "create") return `Create tag at ${this.createTarget?.hash ?? "commit"}`
    return "Tags"
  }

  private hint(compact: boolean): string {
    if (this.state === "loading") return "Esc cancel"
    if (this.state === "target")
      return compact ? "↑↓ move • Enter target • Esc back" : "type search • enter target • F1 help • esc back"
    if (this.state === "create") {
      return compact
        ? "Tab field • Ctrl+T type • Enter create"
        : "Tab switch field • Ctrl+T toggle type • enter create • F1 help • esc back"
    }
    return compact ? "↑↓ move • Enter view • Ctrl+N new" : "type search • enter view • Ctrl+N new • F1 help • esc close"
  }

  private renderBody(maxItems: number, innerWidth: number, compact: boolean, theme: Theme): string[] {
    if (this.state === "loading") return [` ${theme.fg("warning", this.loadingMessage ?? "Loading…")}`]
    if (this.state === "create") return this.renderCreateRows(innerWidth, compact, theme)
    const search = this.state === "target" ? this.commits : this.list
    const noun = this.state === "target" ? "commits" : "tags"
    const prefix = " Search: "
    const field = search.searchField.render(
      Math.max(1, innerWidth - prefix.length),
      search.searchField.focused,
      theme.fg("muted", `type to filter ${noun}`),
    )
    const spacing = compact ? [] : [""]
    const rows = this.state === "target" ? this.renderCommitRows(maxItems, theme) : this.renderTagRows(maxItems, theme)
    return [`${prefix}${field}`, ...spacing, ...rows]
  }

  private renderTagRows(maxItems: number, theme: Theme): string[] {
    this.list.clampSelection()
    if (this.list.filteredCount === 0) {
      const message = this.list.searchQuery ? "No matching tags" : "No tags yet — Ctrl+N creates one"
      return [` ${theme.fg("muted", message)}`]
    }
    return this.list.visibleItems(maxItems).map(({ item, index }) => {
      const selected = index === this.list.selectedIndex
      const marker = selected ? "▶" : " "
      const kind = item.annotated ? "annotated" : "lightweight"
      const targetType = item.targetType === "commit" ? "" : ` ${item.targetType}`
      const metadata = [kind, `${item.targetHash}${targetType}`, item.createdAt, item.creator]
        .filter(Boolean)
        .join(" • ")
      const description = [item.annotation, item.targetSubject].filter(Boolean).join(" • ")
      const suffix = description ? ` — ${description}` : ""
      const line = ` ${marker} ${theme.fg("accent", item.name)} ${theme.fg("muted", metadata)}${suffix}`
      return selected ? theme.bg("selectedBg", line) : line
    })
  }

  private renderCommitRows(maxItems: number, theme: Theme): string[] {
    this.commits.clampSelection()
    if (this.commits.filteredCount === 0) return [` ${theme.fg("muted", "No commits available")}`]
    return this.commits.visibleItems(maxItems).map(({ item, index }) => {
      const selected = index === this.commits.selectedIndex
      const marker = selected ? "▶" : " "
      const line = ` ${marker} ${theme.fg("accent", item.hash)} ${item.message}`
      return selected ? theme.bg("selectedBg", line) : line
    })
  }

  private renderCreateRows(innerWidth: number, compact: boolean, theme: Theme): string[] {
    const target = this.createTarget
    const targetRow = ` Target: ${theme.fg("accent", target?.hash ?? "none")} ${target?.message ?? ""}`
    const namePrefix = this.createFocus === "name" ? "▶ Name: " : "  Name: "
    const name = this.nameField.render(
      Math.max(1, innerWidth - namePrefix.length),
      this.nameField.focused,
      theme.fg("muted", "tag-name"),
    )
    const typeRow = `  Type: ${theme.fg("accent", this.createAnnotated ? "annotated" : "lightweight")} ${theme.fg("muted", "(Ctrl+T toggles)")}`
    const rows = [`${namePrefix}${name}`, typeRow]
    if (this.createAnnotated) {
      const messagePrefix = this.createFocus === "message" ? "▶ Message: " : "  Message: "
      const message = this.messageField.render(
        Math.max(1, innerWidth - messagePrefix.length),
        this.messageField.focused,
        theme.fg("muted", "tag annotation"),
      )
      rows.push(`${messagePrefix}${message}`)
    }
    return compact ? [...rows, targetRow] : [targetRow, "", ...rows]
  }
}
