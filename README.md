# Redline

**See what Copilot changed. Review it in one place. Jump back to any file and keep going.**

Redline is a VS Code extension for developers who use GitHub Copilot (or any AI that edits your workspace) and need a clear picture of local changes before they commit—or before they ask Copilot to refine a specific file.

Copilot can touch many files in one session. The built-in Source Control view lists filenames, but it is not built for reading diffs across a whole batch of edits. Redline opens **all your local changes in one unified diff tab**, with a side panel to hop file-by-file, collapse noisy context, and open any file in inline or side-by-side view so you can continue the conversation right where it matters.

## Built for the Copilot workflow

1. **Copilot edits your code** — inline completions, chat refactors, multi-file edits.
2. **Redline shows the full picture** — every changed file in a single scrollable review tab, plus a Changed Files tree in the activity bar.
3. **You review and iterate** — spot a rough edge in `auth.ts`? Open that file, select the hunk, and ask Copilot to adjust it. Redline keeps diffs live as you (and Copilot) keep editing.

Redline is a **review and navigation layer**, not an apply/revert tool. You stay in control: accept changes in the editor, refine with Copilot, or undo with Git—Redline just makes the diff easy to read.

## Features

- **Unified diff tab** — all changed files in one main-editor view via VS Code's multi-file diff editor
- **Inline overlays** on real files: green additions, red ghost deletions
- **Collapsible context** between distant hunks (folding + Show more / Show all / Show less)
- **Git baseline** (working tree vs HEAD or vs index) or **snapshot baseline** (Start Review)
- **Side-by-side** per file when you want a classic before/after read
- **Changed Files panel** — click any file to open it and keep chatting with Copilot in context
- **Keyboard navigation** — previous/next hunk and file without leaving the editor
- **Multi-root** workspace support

## Requirements

- VS Code `^1.86.0` (multi-file diff editor). Works in VS Code with Copilot; also runs in Cursor.
- Built-in **Git** extension (for git baseline mode)

## Getting started

Install from the marketplace (or load the VSIX), open a repo with local changes, and Redline auto-starts git review when configured. Click the status bar or **Redline: Open All Changes** to open the unified tab.

```bash
npm install
npm run compile
npm test
```

### F5 debug

1. Open this folder in VS Code
2. Run **Tasks: Run Build Task** (or `npm run watch`)
3. Press **F5** — **Run Extension** launches Extension Development Host
4. Open a git repo with local changes (or use snapshot mode)

### Package VSIX

```bash
npm run package
```

## Typical session with Copilot

| Step | What you do |
|------|-------------|
| Ask Copilot to refactor | Copilot edits one or more files |
| Glance at the status bar | `Reviewing (N files)` — click to open the unified diff |
| Scan the full diff | Scroll through every file in one tab; collapse gaps between hunks |
| Drill into one file | Click it in **Changed Files**, or use `Alt+Shift+]` / `[` to move between files |
| Refine with Copilot | With the file open and diffs visible, select code and ask Copilot for a follow-up |
| Repeat | Diffs refresh as you and Copilot keep editing |

## Commands

| Command | Description |
|---------|-------------|
| Redline: Open All Changes | Open all changed files in the unified multi-file diff tab |
| Redline: Start Review | Start git or snapshot review and open unified tab |
| Redline: Stop Review | Stop active review |
| Redline: Clear Review | Clear snapshot + decorations |
| Redline: Open Inline Review | Open a single file with inline overlay |
| Redline: Open Side-by-Side Review | Open a single file in `vscode.diff` view |
| Redline: Next/Previous Change | Jump between change regions (inline mode) |
| Redline: Next/Previous Changed File | Jump between files (inline mode) |
| Redline: Collapse All / Expand All | Reset gap visibility for the current file |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `reviewAgent.baselineMode` | `git` | `git` or `snapshot` |
| `reviewAgent.gitCompare` | `workingTreeVsHead` | Git comparison mode |
| `reviewAgent.autoStartGitReview` | `true` | Auto-enable git diff on workspace open |
| `reviewAgent.autoOpenUnifiedReview` | `true` | Auto-open unified tab when review starts |
| `reviewAgent.contextLines` | `3` | Context lines around each change |
| `reviewAgent.expandStepLines` | `20` | Lines per "Show more" |
| `reviewAgent.collapseThreshold` | `8` | Min gap size to fold |
| `reviewAgent.debounceMs` | `300` | Re-diff debounce |
| `reviewAgent.maxFileSizeMb` | `5` | Snapshot file size cap |
| `reviewAgent.watchExclude` | `[]` | Extra ignore globs |
| `reviewAgent.defaultOpenMode` | `inline` | Mode when opening a file from the tree |

## Keybindings

| Key | Action |
|-----|--------|
| `Alt+]` | Next change |
| `Alt+[` | Previous change |
| `Alt+Shift+]` | Next changed file |
| `Alt+Shift+[` | Previous changed file |

## Limitations (v1)

- No Keep/Revert/apply actions — use the editor and Git (or Copilot) to change code
- No binary file diffing
- Unified tab uses a static resource list — use **Refresh** then **Open All Changes** to pick up file list changes
- Snapshot watcher uses primary workspace folder pattern (multi-root files still diff when opened)
- Side-by-side collapse UX focuses on inline mode
- Git required for git baseline; falls back with a message if unavailable

## License

Personal / internal use.
