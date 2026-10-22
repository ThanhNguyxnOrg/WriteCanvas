# pad.ws — source review: architecture, ink pipeline, UI, performance, persistence, packaging

**Date:** 2026-10-20 · **Scope:** [coderamp-labs/pad.ws](https://github.com/coderamp-labs/pad.ws) plus the drawing dependency it uses, [`@atyrode/excalidraw`](https://github.com/atyrode/excalidraw) · **Read-only research; no WriteCanvas source changed.**

## Snapshot and method

| Item | Value |
|---|---|
| pad.ws revision inspected | `eac61edab04e56567fd454e47f71ee0603e3e141` (`main`, tag `v0.1.0-6-geac61ed`, 2025-06-04) |
| Excalidraw fork revision inspected | `0a534f1bc688ad6c71954fef51a69407613efdbc` (`master`, 2025-05-14) |
| Published package resolved by pad.ws | `@atyrode/excalidraw@0.18.0-15` (exact resolution in `src/frontend/yarn.lock:5-8`; declared as `^0.18.0-15` in `src/frontend/package.json:5-6`) |
| Licenses | MIT for both projects (`LICENSE` in each repository) |
| WriteCanvas baseline | commit `b507a823bdd2fc1fd41717138650c983adab8228` plus uncommitted working-tree changes to `src/index.html`, `src/js/editor.js`, `src/js/library.js`, `src/js/paper.js`, `src/style.css` on 2026-10-20 |

**Method.** The two repositories were cloned locally and read directly. Line references are to the revisions above. For pad.ws, absolute paths are shown relative to the repository root. For Excalidraw, paths start at `packages/`. The published npm tarball is the same release line, but **line numbers may differ slightly from the fork checkout**; the fork is used for readable source and the caveat is repeated where it matters.

**Limits.** No runtime profiling, multi-client collaboration test, or pen-hardware matrix was run. Performance statements are source-derived, not measured FPS numbers. Claims about absent behavior are based on searching the inspected trees; they are flagged as such.

> **Attribution warning.** pad.ws contains **no drawing engine of its own**. Its canvas is the `@atyrode/excalidraw` React component. Every statement below about pressure, perfect-freehand, canvas layering, erasing, text editing, toolbar mechanics, or undo/redo is a statement about **Excalidraw in the fork**, not about original pad.ws code. pad.ws contributes the shell, accounts, tabs, Coder integration, WebSocket transport, and persistence.

---

## Verdict

1. **pad.ws is a browser IDE with a whiteboard, not a handwriting or note-taking app.** The README describes it as "a whiteboard app that acts as a dev environment in your browser" and says it uses Excalidraw for the whiteboard and Coder for cloud development environments (`README.md:7-17`). The application mounts Excalidraw, hides its sidebar, injects a custom main menu, puts document tabs in Excalidraw's footer, and overlays a collaboration client (`src/frontend/src/App.tsx:60-114`; `src/frontend/src/constants.ts:16-23`).
2. **The transferable ink lessons are Excalidraw's, not pad.ws's.** The useful parts for WriteCanvas are the committed/static vs in-progress canvas split, viewport culling, RAF throttling, pressure-per-point freehand rendering, and the contextual toolbar/overflow patterns. Copying pad.ws alone would teach almost nothing about ink.
3. **pad.ws is a good reference for shell interaction, with caveats.** The grouped main menu, fixed-width document tabs with overflow paging, and width-responsive action buttons are coherent product patterns. Several of the custom controls are **not** accessibility-complete: the tab context menu has no menu semantics, Escape handling, focus trap, or arrow navigation (`src/frontend/src/ui/TabContextMenu.tsx:148-200`); the action flyout rows are clickable `<div>`s (`src/frontend/src/pad/buttons/ActionButton.tsx:477-553`); the language options are `<div>`s (`src/frontend/src/pad/editors/SearchableLanguageSelector.tsx:267-285`).
4. **pad.ws's persistence and collaboration model should not be copied into WriteCanvas.** It stores the whole pad as one `JSONB` value (`src/backend/database/models/pad_model.py:31`), flushes to Postgres every 300 seconds (`src/backend/workers/canvas_worker.py:11,422-450`), keeps the hot copy in Redis with a one-hour TTL (`src/backend/domain/pad.py:22-23,222-244`), has no local-first cache, and reconciles elements with last-writer-wins `version`/`versionNonce` rules (`src/backend/workers/canvas_worker.py:382-410`). This is a server-authoritative whiteboard design, not a durable note app design.
5. **There is no desktop packaging in pad.ws.** It is a Docker web deployment: a two-stage `Dockerfile` builds the React app and serves it from FastAPI (`Dockerfile:1-49`; `src/backend/main.py:74-75`), with Postgres, Redis, Keycloak, and Coder in `docker-compose.yml:3-96`. The "Desktop" action is a `vscode://` / `cursor://` magnet link to a Coder workspace, not an Electron or Tauri app (`src/frontend/src/pad/buttons/ActionButton.tsx:361-380`).

---

## 1. What pad.ws actually is

### 1.1 Product shape

- **Whiteboard + IDE.** README feature bullets: interactive whiteboard via Excalidraw, terminals and VS Code inside the whiteboard, browser access, "use your own tools" via VS Code/Cursor desktop clients (`README.md:9-17`).
- **Excalidraw is the canvas.** `App.tsx` imports `Excalidraw`, `MainMenu`, and `Footer` from `@atyrode/excalidraw` and renders them directly (`src/frontend/src/App.tsx:1-4,60-114`). There is no custom canvas component, renderer, or ink model in the pad.ws frontend tree.
- **The sidebar is hidden.** `HIDDEN_UI_ELEMENTS` sets `sidebar: true` while leaving toolbar, zoom, undo/redo, help, and main menu enabled (`src/frontend/src/constants.ts:16-23`). The result is an infinite-canvas whiteboard with a top toolbar and a footer tab strip, not a page-based note UI.
- **Document tabs are pad.ws's main document model.** `Tabs` is rendered inside Excalidraw's `<Footer>` and lists pads; selecting a tab calls `selectTab` (`src/frontend/src/App.tsx:86-104`; `src/frontend/src/ui/Tabs.tsx:111-113`). A pad is the unit of navigation, not a page inside a note.
- **The backend is an IDE control plane as much as a canvas backend.** It has `workspace_router` endpoints to get/start/stop a Coder workspace (`src/backend/routers/workspace_router.py:23-97`) and `app_router` exposes the Coder URL to the frontend (`src/backend/routers/app_router.py:27-37`).

### 1.2 What is absent

The following are **not** present in the inspected pad.ws tree:

- A page model (pages, page thumbnails, page ordering, paper templates, page-sized documents). The pad document is one Excalidraw scene: `files`, `elements`, and per-user `appState` (`src/backend/domain/pad.py:61-69`).
- A handwriting note format, ink file format, PDF import/export, or OCR/handwriting recognition. Search of the frontend and backend found no such code path; the only canvas serialization is Excalidraw scene JSON.
- Local-first persistence. There is no IndexedDB, service worker, or offline cache in `src/frontend/src`; the only `localStorage` use is the OIDC popup handshake (`src/frontend/public/auth/popup-close.html:9`).
- An Electron/Tauri main process, auto-update, code signing, native menus, or filesystem integration. Dependencies and scripts are web-only (`src/frontend/package.json`), and deployment is the Docker image.
- A test framework or test files. `package.json` scripts are only `start` and `build` (`src/frontend/package.json:34-37`), and no `*.test.*` / `*.spec.*` files were found.

### 1.3 Why this matters for the review

If the goal is "learn how pad.ws does ink", the honest answer is: **it does not**. The correct unit of analysis is the Excalidraw fork. The rest of this report therefore separates:

- **pad.ws code**: shell, menus, tabs, collaboration transport, backend persistence, deployment.
- **Excalidraw code**: canvas layers, input handling, pressure, freehand rendering, eraser, text editing, toolbar, command palette, accessibility primitives.

---

## 2. Architecture and dependencies

### 2.1 Stack

| Layer | Technology | Evidence |
|---|---|---|
| Frontend framework | React 19.0.0, React DOM 19.0.0 | `src/frontend/package.json:18-19` |
| Build | Vite 5.2.0, TypeScript 5 | `src/frontend/package.json:27-37`; `src/frontend/vite.config.mts:1-32` |
| Canvas | `@atyrode/excalidraw@0.18.0-15` (fork of Excalidraw 0.18) | `src/frontend/package.json:5-6`; `src/frontend/yarn.lock:5-8` |
| Data fetching | TanStack Query 5 | `src/frontend/package.json:8-9`; `src/frontend/src/hooks/usePadData.ts:1,34-41` |
| Code editor | `@monaco-editor/react` 4.7 | `src/frontend/package.json:7`; `src/frontend/src/pad/editors/Editor.tsx:2` |
| Icons / UI | lucide-react | `src/frontend/package.json:16` |
| Validation | zod 3.24 | `src/frontend/package.json:21`; `src/frontend/src/lib/collab/Portal.tsx:7-15` |
| Utilities | lodash.throttle, lodash.isequal | `src/frontend/package.json:14-15`; `src/frontend/src/lib/collab/Collab.tsx:10-11` |
| Analytics | posthog-js | `src/frontend/package.json:17`; `src/frontend/src/lib/posthog.ts` |
| Backend | FastAPI + Uvicorn, Python 3.11 | `src/backend/requirements.txt:1-2`; `Dockerfile:16` |
| DB access | SQLAlchemy async, asyncpg, psycopg2 | `src/backend/requirements.txt:5,9,12`; `src/backend/database/database.py` |
| Persistence | PostgreSQL 16 | `docker-compose.yml:4-14`; `src/backend/database/models/pad_model.py:31` |
| Hot cache / streams | Redis 7 (alpine) | `docker-compose.yml:16-25`; `src/backend/routers/ws_router.py:19-21` |
| Auth | Keycloak 25 (OIDC) | `docker-compose.yml:27-48`; `src/backend/routers/auth_router.py` |
| IDE backend | Coder | `docker-compose.yml:50-69`; `src/backend/coder.py` |

The frontend is approximately 8.5k lines of TS/TSX/SCSS and the backend approximately 3.5k lines of Python in the inspected tree. That is small enough that the architecture is readable end to end; most of the real complexity lives inside Excalidraw.

### 2.2 Runtime topology

```
React + Excalidraw
   │  REST: GET /api/pad/{id}, /api/workspace/state
   │  WS:   /ws/pad/{pad_id}
   ▼
FastAPI  ──► Redis stream  pad:stream:{pad_id}  (scene_update, appstate_update)
   │              │
   │              └──► CanvasWorker ──► Redis hash pad:{id} (TTL 1h)
   │                                      └──► PostgreSQL pads.data (every 300s)
   │
   └──► Redis pub/sub pad:pointer:updates:{pad_id} (pointer_update)
```

Evidence:

- Static frontend served by FastAPI: `app.mount("/assets", ...)` and `app.mount("/static", ...)` (`src/backend/main.py:74-75`); SPA fallback serves `index.html` (`:115-129`).
- WebSocket endpoint `/ws/pad/{pad_id}` (`src/backend/routers/ws_router.py:340-345`), cookie session auth (`:47-73`), access check before accept (`:354-363`).
- Scene and app-state messages go through a Redis stream with `maxlen=100` and a 3600-second expiry (`:91-97`); pointer updates go through Redis pub/sub (`:101-113`, `:245-282`).
- The worker consumes the stream and updates the Redis-cached `Pad` (`src/backend/workers/canvas_worker.py:176-267`); periodic Postgres save is 300 seconds (`:11,422-450`).
- The worker is started lazily when a pad is loaded (`src/backend/domain/pad.py:303-336`) and stopped on shutdown or delete.

### 2.3 The pad document model

`PadStore` is deliberately minimal:

```python
data = Column(JSONB, nullable=False)
```

(`src/backend/database/models/pad_model.py:31`)

The `data` object has this shape:

```python
{
  "files": data.get("files", {}),
  "elements": data.get("elements", []),
  "appState": { str(owner_id): data.get("appState", {}) }
}
```

(`src/backend/domain/pad.py:61-69`)

Consequences:

- **One row per pad, one JSON document per row.** There is no normalization into elements, pages, or operations. Every scene update rewrites the cached document, and every 300-second flush writes the whole document to Postgres.
- **AppState is per user, not shared.** `pad_router.get_pad` returns only the requesting user's `appState` (`src/backend/routers/pad_router.py:59-63`). This is intentional: view state such as scroll and zoom is personal.
- **No revision history.** The JSONB document has no operation log, no snapshots, no per-element rows. Recovery is limited to the latest cached/database value.
- **No local replica.** The browser is not a source of truth; closing the tab with unsaved client state is not a recovery scenario because the server is expected to have it.

### 2.4 What pad.ws adds on top of Excalidraw

| Addition | Where | Purpose |
|---|---|---|
| Custom main menu | `src/frontend/src/ui/MainMenu.tsx:183-275` | Account, Files, Tools (Code Editor, Terminal, Dashboard, Action Button), Settings, Logout |
| Footer tab strip | `src/frontend/src/ui/Tabs.tsx` | Pad navigation, create/rename/delete/share, five tabs per page |
| Tab context menu | `src/frontend/src/ui/TabContextMenu.tsx` | Rename, delete, leave shared pad, copy URL, toggle sharing |
| Collaboration client | `src/frontend/src/lib/collab/Collab.tsx`, `Portal.tsx` | Scene/appState/pointer synchronization over native WebSocket |
| Canvas worker | `src/backend/workers/canvas_worker.py` | Stream processing, reconciliation, periodic Postgres saves |
| Coder integration | `src/backend/coder.py`, `workspace_router.py` | Workspace state/start/stop for the IDE |
| Embeddable action buttons | `src/frontend/src/pad/buttons/ActionButton.tsx` | Insert terminal/code/desktop actions into the canvas |

Excalidraw's own sidebar is hidden, and its toolbar/zoom/undo/help/main menu remain (`src/frontend/src/constants.ts:16-23`). So the UI is "Excalidraw plus a shell", not a fork of Excalidraw's UI at the pad.ws level.

---

## 3. Ink pipeline (Excalidraw fork)

This is the section that matters for WriteCanvas. All references are to the Excalidraw fork at `0a534f1b...`.

### 3.1 Canvas layers

Excalidraw renders a stack of canvases, not one canvas:

```tsx
<StaticCanvas ... scale={window.devicePixelRatio} />
{this.state.newElement && (
  <NewElementCanvas ... scale={window.devicePixelRatio} />
)}
<InteractiveCanvas ... scale={window.devicePixelRatio} ... />
```

(`packages/excalidraw/components/App.tsx:1796-1869`)

The roles are:

- **`StaticCanvas`**: committed, non-deleted elements; grid and background (`App.tsx:1796-1819`). It is not interactive.
- **`NewElementCanvas`**: mounted only while `appState.newElement` exists (`App.tsx:1820-1839`). It renders only the element currently being drawn, not the whole scene (`packages/excalidraw/renderer/renderNewElementScene.ts:36-48`).
- **`InteractiveCanvas`**: selection outlines, handles, remote collaborators, and the actual pointer event handlers (`App.tsx:1841-1869`).
- **SVG layer** for certain overlays, and **HTML/textarea** for embeddables and text editing (`App.tsx:1870` onward; `packages/excalidraw/wysiwyg/textWysiwyg.tsx:293-329`).

The important architectural point is **separation of committed content from in-progress content**. While a stroke is being drawn, the static canvas is not asked to repaint the whole scene; the new element is painted on its own canvas above it. This is exactly the pattern WriteCanvas already has with `inkC` and `liveC` (`src/index.html:90-95`), and it is worth preserving.

`StaticCanvas` sizes the backing store to `appState.width * scale` and `appState.height * scale`, where `scale` is `window.devicePixelRatio` (`packages/excalidraw/components/canvases/StaticCanvas.tsx:52-70`; `App.tsx:1806`). The canvas is **viewport-sized**, not document-sized. This is why DPR scaling is cheap for Excalidraw and would be dangerous if copied naively into WriteCanvas's full-page canvas model.

### 3.2 Static scene redraw and culling

`StaticCanvas` delegates to `renderStaticScene` (`StaticCanvas.tsx:72-84`), which is RAF-throttled with a trailing call (`packages/excalidraw/renderer/staticScene.ts:463-469`). It does **not** maintain a retained per-element scene graph. On each render it paints the currently visible elements.

The render set is computed by `Renderer.getRenderableElements`, which:

- skips the element currently being drawn (`newElementId`) and the element being text-edited (`packages/excalidraw/scene/Renderer.ts:84-107`);
- filters to elements intersecting the viewport using `isElementInViewport` (`Renderer.ts:47-69`);
- memoizes the result on zoom, scroll, viewport size, editing state, new element id, and a scene nonce (`Renderer.ts:111-162`).

`StaticCanvas` itself is memoized on `sceneNonce`, `scale`, `elementsMap`, `visibleElements`, and relevant app-state props (`StaticCanvas.tsx:121-147`). This means a pointer move that only changes the in-progress element does not force a static repaint; only a committed scene change does.

### 3.3 Pointer input and pressure

Excalidraw wraps pointer-move handlers in `withBatchedUpdatesThrottled`:

```ts
export const withBatchedUpdatesThrottled = (func) =>
  throttleRAF((event) => {
    unstable_batchedUpdates(func, event);
  });
```

(`packages/excalidraw/reactUtils.ts:23-32`)

`throttleRAF` executes at most once per animation frame and can keep a trailing call (`packages/common/src/utils.ts:154-186`). The canvas pointer-move handler is wrapped this way (`packages/excalidraw/components/App.tsx:8060-8063`). **Consequence:** on a 120–240 Hz pen, Excalidraw samples at most once per display frame. It does **not** call `getCoalescedEvents()` or listen for `pointerrawupdate`; a search of the fork found no such calls. This is a deliberate simplicity/latency tradeoff, not a high-fidelity input pipeline.

Pressure handling is per point:

- On pointer-down, Excalidraw creates the freedraw element with `simulatePressure = event.pressure === 0.5` (`App.tsx:7523`) and seeds `pressures` with the first real pressure, or an empty array when simulating (`App.tsx:7537-7541`).
- On each pointer move, it appends the new point and, if pressure is real, the new pressure (`App.tsx:8694-8704`).
- On pointer-up, it appends the final point and pressure (`App.tsx:9097-9105`).

The data model stores `points` and `pressures` as parallel arrays (`packages/element/src/types.ts:371-373`). This is simple and serializable, but each move copies both arrays (`[...points, point]`, `[...pressures, pressure]`). For a long stroke, that is O(n) allocation per sample and O(n²) total copying. The fork does not use a mutable point buffer for the in-progress stroke.

### 3.4 Freehand rendering

Freedraw rendering uses `perfect-freehand` 1.2.0 (resolved by the Excalidraw package; `src/frontend/yarn.lock:31`) with these options:

```ts
const options: StrokeOptions = {
  simulatePressure: element.simulatePressure,
  size: element.strokeWidth * 4.25,
  thinning: 0.6,
  smoothing: 0.5,
  streamline: 0.5,
  easing: (t) => Math.sin((t * Math.PI) / 2),
  last: !!element.lastCommittedPoint,
};
```

(`packages/element/src/renderElement.ts:1026-1045`)

Real pressure is passed as the third coordinate of each point (`renderElement.ts:1028-1032`); when `simulatePressure` is true, perfect-freehand synthesizes pressure from velocity. The generated `Path2D` is cached in a `WeakMap` keyed by the element object (`renderElement.ts:1013-1023`), but freedraw shapes are regenerated when the element's shape cache is invalidated (`packages/element/src/mutateElement.ts:137`; `packages/element/src/Shape.ts:512-515`). The path cache is therefore a lookup for the current path, not an incremental stroke builder; an in-progress stroke still rebuilds its full path as points are added.

Notable consequences for WriteCanvas:

- The brush width is `strokeWidth * 4.25`, not a direct pixel width. This is an Excalidraw aesthetic constant.
- `thinning: 0.6` makes pressure strongly affect width. `streamline: 0.5` smooths the path.
- `last: !!lastCommittedPoint` tells perfect-freehand whether the stroke is finished; this affects the end cap.
- There is **no tilt, azimuth, barrel rotation, or predicted-point** handling in this path. Pressure and velocity are the only inputs.

### 3.5 Eraser

Excalidraw's eraser is **object-level**. `EraserTrail.addPointToPath` tests the eraser path against candidate elements and returns whole elements/groups to erase (`packages/excalidraw/eraser/index.ts:34-84`; `App.tsx:6280-6291` in the pad.ws fork). It does not split a stroke at the eraser circle.

This is a real limitation, not a pattern to copy. WriteCanvas already has three eraser modes: whole stroke, segment/split, and sheet (`src/index.html:163-174`; `src/js/editor.js:490-540`). The segment eraser is **more granular than Excalidraw** and should not be regressed to object-level erasing.

### 3.6 Text editing

Excalidraw uses a real `<textarea>` overlay positioned over the canvas, styled to match the element's font, size, line height, and padding (`packages/excalidraw/wysiwyg/textWysiwyg.tsx:293-329`). It commits on Escape or Ctrl/Cmd+Enter, and handles Tab/Shift+Tab for indentation (`textWysiwyg.tsx:380-429`). The text element is not rendered on the static canvas while it is being edited, preventing double text (`Renderer.ts:98-106`).

WriteCanvas already uses the same pattern: a `<textarea>` positioned in the page coordinate space, styled with the text object's style, committing on Escape/Enter, with a counter-scaled formatting bar (`src/js/editor.js:1236-1268`). This is already aligned; no change is needed.

### 3.7 Undo/redo

Excalidraw's undo/redo is history-stack based, not document-version based. `createUndoAction` calls `history.undo(elementsMap, appState)` and the button is disabled when the undo stack is empty (`packages/excalidraw/actions/actionHistory.tsx:58-90`). Remote scene updates are applied with `commitToHistory: false` (`src/frontend/src/lib/collab/Collab.tsx:521`), so remote edits do not enter the local undo stack.

For WriteCanvas, the relevant idea is the same: local undo should not replay remote operations. If collaboration is added later, keep remote application outside the local undo history.

---

## 4. Toolbar and UI

### 4.1 Excalidraw's toolbar is top-center, not left

`LayerUI` renders a `FixedSideContainer side="top"` with `App-menu App-menu_top` (`packages/excalidraw/components/LayerUI.tsx:238-256`). The shape toolbar sits inside that top container (`LayerUI.tsx:257-340`). The left side is used for the selected-shape action panel when an element is selected (`LayerUI.tsx:253-256`), not for the main tool strip.

The shape set is:

| Tool | Key | Numeric key |
|---|---|---|
| Selection | V | 1 |
| Rectangle | R | 2 |
| Diamond | D | 3 |
| Ellipse | O | 4 |
| Arrow | A | 5 |
| Line | L | 6 |
| Freedraw | P / X | 7 |
| Text | T | 8 |
| Image | — | 9 |
| Eraser | E | 0 |

(`packages/excalidraw/components/shapes.tsx:16-87`)

Tool buttons are radio inputs with `aria-label` and `aria-keyshortcuts` (`packages/excalidraw/components/ToolButton.tsx:170-207`). This is better than a set of unlabeled icon buttons: the native radio group provides selection semantics and keyboard behavior.

### 4.2 Contextual controls and overflow

`SelectedShapeActions` only renders controls relevant to the current tool or selected elements:

- stroke color if the tool/element supports stroke;
- background color if it supports fill;
- fill style only when fill is visible;
- stroke width only for tools/elements with width;
- stroke shape only for freedraw;
- stroke style/sloppiness only when supported;
- roundness, arrow type, font family/size/alignment based on selection;
- opacity, layer order, alignment, duplicate/delete/group only when applicable.

(`packages/excalidraw/components/Actions.tsx:104-281`)

Rare tools (frame, embeddable, laser, lasso, Mermaid, magic frame) are behind an overflow "extra tools" dropdown (`Actions.tsx:366-454`). This is the pattern WriteCanvas should adapt: keep the common pen/highlighter/eraser controls visible, and collapse rare or mode-specific controls instead of showing a fixed wall of options.

### 4.3 Command palette

Excalidraw opens the command palette with **Ctrl/Cmd + /** or **Ctrl/Cmd + Shift + P** (`packages/excalidraw/components/CommandPalette/CommandPalette.tsx:127-134`). It supports:

- fuzzy filtering over command labels (`:821-830`);
- categories and a "recents" section (`:866-908`);
- ArrowUp/ArrowDown/Enter navigation with wrap-around (`:656-767`);
- command availability predicates and shortcut hints (`:940-972`).

The weak point is semantics: command items are `<div>`s with click/mousemove handlers, not `role="option"` elements in a listbox (`CommandPalette.tsx:940-972`). Keyboard operation works because focus stays in the search input and the component maintains its own highlight index, but screen-reader users do not get listbox/option announcements.

**Applicability:** if WriteCanvas accumulates enough commands (page actions, export, pen presets, view toggles), a command palette is a good power-user affordance. It is not needed at the current command count. If added, use proper combobox/listbox semantics rather than copying the div-based items.

### 4.4 pad.ws shell: main menu

pad.ws wraps Excalidraw's `MainMenu` and adds:

- a user row with Gravatar and username (`src/frontend/src/ui/MainMenu.tsx:198-212`);
- a **Files** group: Load Scene, Export, Save as Image, Clear Canvas (`:215-220`);
- a **Tools** group: Code Editor, Terminal, Dashboard, Action Button (`:224-249`);
- Account, Settings, Logout (`:253-273`).

This is a clean information architecture: grouped, labeled, and ordered by frequency. It is a better model than a flat list of a dozen unrelated items. WriteCanvas's library/menu flyout (`src/index.html:152-155`) could adopt the same grouping for note actions vs app actions vs account/settings.

### 4.5 pad.ws shell: document tabs

`Tabs` implements a paginated footer strip:

- five pads per page (`PADS_PER_PAGE = 5`, `src/frontend/src/ui/Tabs.tsx:72`);
- fixed 120px tab width, overflow fade via a mask (`src/frontend/src/ui/Tabs.scss:19-47`);
- wheel navigation with a 70ms throttle (`Tabs.tsx:181-218`);
- previous/next buttons with `aria-label` (`Tabs.tsx:400-434`);
- automatic page adjustment when a new pad is created or the tab list shrinks (`Tabs.tsx:115-147`).

The visual pattern is good for a narrow footer. The accessibility gap is structural: the strip is a set of `<div>`s and `Button`s, not `role="tablist"` / `role="tab"`; there is no roving tabindex and no Left/Right arrow navigation. A screen-reader user hears buttons, not tabs, and cannot move between tabs with arrow keys.

**Applicability:** WriteCanvas's page bar is a sidebar, not a footer strip, so the visual layout does not map directly. The reusable ideas are the overflow fade, the 5-item paging window, and the scroll buttons. If WriteCanvas ever adds a horizontal recent-notes strip, use real tab semantics rather than copying pad.ws's markup.

### 4.6 pad.ws shell: context menu and flyouts

`TabContextMenu` has a hand-rolled `Popover`:

- closes on outside `mousedown` (`src/frontend/src/ui/TabContextMenu.tsx:74-85`);
- clamps to the viewport with `getBoundingClientRect()` (`:87-99`);
- renders a `<ul>` of `<li><button>` items (`:148-200`).

The `<button>` elements are focusable and Enter works, but the menu has **no** `role="menu"`, no Escape handler, no focus trap, no focus return, and no ArrowUp/ArrowDown navigation. Rename/delete/leave use native `window.prompt` and `window.confirm` (`:235-250`), which are blocking, unstyled, and hard to integrate with the app's visual language.

The `ActionButton` flyout has a different problem: its target/editor/action rows are clickable `<div>`s with `onClick` (`src/frontend/src/pad/buttons/ActionButton.tsx:477-553`). They are not focusable and have no key handling. The button itself opens the flyout, but keyboard users cannot choose an option.

The `SearchableLanguageSelector` handles ArrowUp/ArrowDown/Enter/Escape/Tab on its input (`src/frontend/src/pad/editors/SearchableLanguageSelector.tsx:196-233`) and has ARIA labels (`:238-253`), but its options are `<div>`s (`:267-285`) and there are no combobox/listbox/option roles.

**Verdict:** pad.ws's shell is visually coherent but not a good accessibility reference. The better reference is Excalidraw's own primitives.

### 4.7 Accessibility patterns worth adapting from Excalidraw

| Pattern | What it does | Evidence |
|---|---|---|
| `Popover` focus trap | Focuses the container, traps Tab/Shift+Tab inside, closes on outside pointerdown, fits to viewport | `packages/excalidraw/components/Popover.tsx:33-146` |
| `Modal` dialog semantics | `role="dialog"`, `aria-modal="true"`, Escape closes | `packages/excalidraw/components/Modal.tsx:35-65` |
| `Dialog` focus restore | Restores focus to the element that was active before opening | `packages/excalidraw/components/Dialog.tsx:99-104` |
| Tool radio semantics | Native radio input with `aria-label` and `aria-keyshortcuts` | `packages/excalidraw/components/ToolButton.tsx:170-207` |
| Command palette keyboard model | Global shortcut, ArrowUp/Down, Enter, Escape, recents, fuzzy search | `CommandPalette.tsx:127-134,656-767,821-830,866-908` |
| Text WYSIWYG | Real textarea overlay with matching style, Escape/Ctrl+Enter commit, Tab indent | `textWysiwyg.tsx:293-329,380-429` |

The gap in Excalidraw's own accessibility is mainly semantic richness in custom widgets (command items and some popovers), not a lack of focus management in dialogs.

### 4.8 WriteCanvas UI baseline

WriteCanvas is already ahead of pad.ws's custom shell in several places:

- Toolbar buttons have visible labels, `title`, `aria-label`, `aria-keyshortcuts`, and `aria-pressed` on toggles (`src/index.html:54-78`).
- Pen, save, board-color, shape, and eraser flyouts use `role="dialog"`, labels, and real buttons (`src/index.html:101-174`). The library flyout is the exception: it has no dialog role or label (`src/index.html:150-153`).
- Save state is a `role="status"` live region (`src/index.html:77`).
- Text editing uses a positioned textarea with matching style and a real toolbar (`src/js/editor.js:1236-1296`).

The main gap is flyout focus management: `closeToolFlyout` only adds `hidden` and clears state (`src/js/editor.js:1623-1628`); `openToolFlyout` positions the flyout and installs a light-dismiss handler (`:1633-1647`) but does not focus the first control, trap Tab, restore focus to the anchor on close, or close on Escape as a dialog. Escape is handled globally for a fixed list of flyouts (`:2144-2148`), which is not the same as per-dialog focus behavior.

---

## 5. Performance

No benchmarks were run. The following are source-level observations about where time and memory go.

### 5.1 What Excalidraw does well

1. **Viewport-only rendering.** `getVisibleCanvasElements` tests each element against the viewport, so off-screen elements are not painted (`packages/excalidraw/scene/Renderer.ts:47-69`). The visible set is memoized on the scene nonce and viewport (`Renderer.ts:111-162`).
2. **Committed vs in-progress separation.** The static canvas is not repainted for every pointer move; the in-progress element is rendered on `NewElementCanvas` (`App.tsx:1820-1839`). This is the single most important structural optimization for inking.
3. **RAF throttling.** Static, new-element, and interactive renderers are all throttled to animation frames (`staticScene.ts:463-469`; `renderNewElementScene.ts:52-57`; `interactiveScene.ts:1128`). Pointer moves are also batched to RAF (`App.tsx:8060-8063`; `reactUtils.ts:23-32`).
4. **Path caching.** Freedraw `Path2D` objects are cached in a `WeakMap` (`renderElement.ts:1013-1023`), so unchanged elements do not rebuild their path.
5. **Network backpressure.** Pointer updates are throttled at 30ms (`src/frontend/src/constants.ts:26`; `Collab.tsx:99-101`), app-state broadcasts are debounced at 500ms (`Collab.tsx:103-119`), and scene updates are sent only when the scene version increases (`Collab.tsx:393-399`).

### 5.2 What it costs

- **No coalesced input.** Because pointer moves are sampled once per RAF, a 240Hz pen produces at most ~60 samples per second on a 60Hz display (or ~120 on a 120Hz display). This is a fidelity loss on fast strokes, not just a performance choice.
- **O(n²) point-array copying.** Every freedraw pointer move creates new `points` and `pressures` arrays (`App.tsx:8695-8704`). A 5-second stroke at 120 samples/second has ~600 points; the total copied elements is on the order of 180,000. This is small in absolute terms but scales quadratically with stroke length.
- **Full visible-scene repaint.** The static canvas is not a retained scene graph; on any committed scene change it repaints all visible elements (`StaticCanvas.tsx:72-84`; `Renderer.ts:149-160`). For large diagrams this is the dominant cost. Excalidraw mitigates it with viewport culling and RAF throttling, not with per-element dirty rectangles or tiles.
- **React state update per frame.** The in-progress element lives in React state (`App.tsx:8711-8713`), so every sampled point causes a React render as well as a canvas render. React 19 batching plus RAF throttling keeps this bounded, but it is still per-frame work.
- **Backend auth check at 1 Hz per socket.** `periodic_auth_check` calls `check_pad_access` and sleeps for one second between checks (`src/backend/routers/ws_router.py:126-161`). Each check re-runs `PadAccess`, which loads the pad through the connection's session (`src/backend/dependencies.py:186-214`), usually from Redis. At scale this is a steady per-connection cost that a token-expiry timer or periodic revalidation at a longer interval would avoid.
- **Per-client stream consumption.** Every WebSocket client runs its own `consume_redis_stream` loop (`ws_router.py:194-242,419-421`), and every scene update is delivered to every other client. That is O(n) fanout per edit; fine for small rooms, not a scalable broadcast design.

### 5.3 Performance comparison with WriteCanvas

WriteCanvas currently has the right **layer split** but a more expensive **live path**:

- Six document-sized layers: `paperC`, `rasterC`, `inkC`, `liveC`, `laserC`, `rulerC` (`src/index.html:90-95`). Only the current page is rendered (`src/js/editor.js:258-267`).
- Each layer's backing store is set to the document size (`src/js/editor.js:250-255`). There is no DPR scaling; zoom is a CSS transform on the stack (`src/js/editor.js:156-168`). At zoom > 1, the browser upscales the canvas, so strokes can look soft.
- Each pointer move appends a point and calls `drawLiveSlice` (`src/js/editor.js:572-574`). `drawLiveSlice` calls `drawStrokeMask` for the **entire stroke** (`src/js/editor.js:473-488`; `src/js/pen.js:263-274`), and `drawStrokeMask` rebuilds all stamps from all points (`src/js/pen.js:93-228`). The per-event cost therefore grows with stroke length, and total cost is roughly quadratic. This is the highest-value performance target in the current editor.
- Zoom uses CSS `scale()` (`src/js/editor.js:161`), and pointer coordinates are corrected by the measured scale (`src/js/editor.js:232-237`). This is functionally correct but visually lossy at high zoom and on high-DPI displays.

The Excalidraw approach is not a drop-in fix because Excalidraw's canvases are viewport-sized, while WriteCanvas's are document-sized. The safe adaptation is:

1. Keep the committed ink layer document-sized and repaint it only when committed content changes.
2. Make the **live preview buffer** dirty-rect or viewport-sized, and update only the newly added stamp segment.
3. Apply device-pixel-ratio scaling to the live/compositor surface, not blindly to all six full-page layers.
4. If crisp committed ink at high zoom is required, move to a viewport/tile compositor rather than multiplying every full-page canvas by DPR.

A naive "set every layer to `w * devicePixelRatio`" would multiply memory by 4 on a 2× display across six layers. For a 2500×3235 page, one RGBA layer is ~32 MB; six layers at 2× would be ~776 MB. That is not viable. This is exactly why Excalidraw's viewport-sized design matters.

---

## 6. Persistence and collaboration

### 6.1 Durability model

| Concern | pad.ws behavior | Evidence |
|---|---|---|
| Storage unit | Entire pad as one JSONB document (`files`, `elements`, per-user `appState`) | `src/backend/database/models/pad_model.py:31`; `src/backend/domain/pad.py:61-69` |
| Hot copy | Redis hash `pad:{id}` with 1-hour TTL | `src/backend/domain/pad.py:22-23,222-244` |
| Durable flush | Every 300 seconds, plus graceful worker stop | `src/backend/workers/canvas_worker.py:11,422-450`; `:89-128` |
| Client cache | None; no IndexedDB/service worker/local scene cache | Search of `src/frontend/src`; only `public/auth/popup-close.html:9` uses localStorage |
| Offline editing | Not supported | No offline code path; WS requires an open authenticated connection (`Portal.tsx:100-102`) |
| Cross-tab undo | Remote changes applied with `commitToHistory: false` | `src/frontend/src/lib/collab/Collab.tsx:521` |
| Image/file persistence | Server accepts `files`, but the client never sends them in `scene_update` | `src/backend/workers/canvas_worker.py:282-290`; `Collab.tsx:340-344`; `Portal.tsx:337-341` |

The durability window is the main issue. Postgres can be up to five minutes behind the live scene. Redis is configured with `--save 60 1` (`docker-compose.yml:24`), which reduces but does not eliminate the loss window if the Redis process or host dies. A user who closes the tab is fine if the worker is alive and the Redis cache is intact; a user who loses Redis before the next 300-second flush can lose several minutes of work.

For a note-taking app, this is the wrong tradeoff. WriteCanvas's current model is stronger:

- save is debounced at 1.4 seconds (`src/js/editor.js:1479-1484`);
- the page is written to a temporary file and atomically renamed (`main/library.js:315-321`);
- the index is updated after the page file is safe, and a failed index write rolls back the page pointer (`main/library.js:315-329`);
- saves are serialized and capture the note/page at call time (`src/js/editor.js:1497-1500`).

That is a local-first, crash-resistant design. **Do not replace it with pad.ws's server-snapshot model.** If cloud sync is added, make it a second replica on top of the local file store, not the primary store.

### 6.2 Real-time protocol

Message types observed in the client and server:

| Type | Direction | Transport | Payload | Notes |
|---|---|---|---|---|
| `connected` | server → client | direct WS send | `collaboratorsList` | Sent immediately after accept; no scene payload (`ws_router.py:373-384`) |
| `user_joined` / `user_left` | server → all | Redis stream | username / empty | Presence only (`ws_router.py:386-395,456-467`) |
| `pointer_update` | both | Redis pub/sub | `{pointer: {x,y,tool}, button}` | Throttled 30ms; not persisted (`ws_router.py:101-113`; `Collab.tsx:99-101`) |
| `scene_update` | client → server → others | Redis stream | `{update_subtype, elements}` | Only elements; no files (`Portal.tsx:337-341`) |
| `appstate_update` | client → server | Redis stream | `{appState}` | Persisted per user, **never sent to other clients** (`ws_router.py:232`) |
| `force_disconnect` | server → client | Redis stream | reason | Access revoked (`ws_router.py:141-154`) |

Two details are especially important:

1. **AppState is not shared.** The server explicitly filters `appstate_update` out of the fanout (`ws_router.py:232`). The handler stores the sender's full appState under `data["appState"][user_id]` with last-writer-wins semantics (`canvas_worker.py:306-331`). The REST GET returns only the requester's appState (`pad_router.py:59-63`). So there is **no shared viewport, shared selection, or shared tool state** in pad.ws. The 500ms appState broadcasts from the client are effectively write-only persistence traffic.
2. **Files are a gap.** The Excalidraw `onChange` callback provides `(elements, appState, files)`, but `Collab` ignores `_files` (`Collab.tsx:340-344`). `Portal.broadcastSceneUpdate` builds a payload with `elements` only (`Portal.tsx:337-341`). The backend *does* accept `client_files` and merge them (`canvas_worker.py:282-290`), which suggests the server was designed for file sync but the client does not use it. Images added after the initial REST load therefore appear not to propagate or persist through this path. This is a code-inspection finding; no runtime image test was performed.

### 6.3 Conflict model: LWW, not CRDT

Scene reconciliation is element-level last-writer-wins:

- Compare `version`; higher wins.
- If versions are equal, compare `versionNonce`; lower nonce wins.
- Elements are then sorted by fractional `index`.

(`src/backend/workers/canvas_worker.py:382-420`)

The client uses Excalidraw's `reconcileElements` for incoming remote updates (`Collab.tsx:515-521`). This is not a CRDT and does not merge concurrent edits within one element. Two users editing the same element produce one winner; the other user's change is discarded. For a whiteboard of independent shapes this is often acceptable. For handwriting strokes, it is a poor fit: strokes are frequently appended to and partially erased, and an element-level winner can resurrect erased segments or discard new points.

### 6.4 Reconnect and recovery

- Reconnect is limited to 5 attempts with exponential backoff starting at 1 second (`Portal.tsx:19-20,175-186`).
- On reconnect, the client updates connection status and receives `connected` with the collaborator list (`Collab.tsx:536-568`). It does **not** re-fetch the pad scene, and the WebSocket consumer starts at `$` (only new messages, `ws_router.py:420`).
- Periodic full sync exists but is explicitly disabled (`ENABLE_PERIODIC_FULL_SYNC = false`, `src/frontend/src/constants.ts:27-28`), while a comment in `Collab.tsx:400-403` says the code relies on periodic full sync to correct inconsistencies.

**Consequence:** a client that disconnects while others edit can miss those edits permanently for the session. With full sync disabled, there is no visible recovery path in the code. This is a significant reliability bug, not a design subtlety. It also means pad.ws is a weak reference for "how to reconnect" in WriteCanvas.

### 6.5 What to use instead if WriteCanvas adds collaboration

If collaboration is on the roadmap, pad.ws is a **negative** reference. A WriteCanvas design should:

- keep the local file as the durable source of truth, with a sync journal/outbox;
- use a CRDT or operation log for scene edits, with stable stroke IDs and tombstones for segment erasure;
- sync binary assets separately (content-addressed blobs), not inside scene messages;
- treat presence (pointer, viewport, selection) as ephemeral and non-persistent;
- define explicit conflict behavior for text edits and page metadata;
- test offline → online transitions, duplicate delivery, and concurrent segment erasure.

An element-level LWW scheme like pad.ws's is especially unsuitable for WriteCanvas because WriteCanvas's segment eraser can cut a stroke into pieces (`src/js/editor.js:496-528`). A concurrent LWW merge could restore the uncut stroke or duplicate the pieces.

---

## 7. Desktop packaging

pad.ws has **no desktop packaging**:

- No Electron, Tauri, Capacitor, or React Native dependency; the frontend package is React/Vite/web only (`src/frontend/package.json`).
- The production artifact is a Docker image that builds the frontend and serves it from FastAPI (`Dockerfile:1-49`; `src/backend/main.py:74-75,115-129`).
- The compose stack includes Postgres, Redis, Keycloak, Coder, and the pad app (`docker-compose.yml:3-96`).
- The "Desktop" option in the action-button flyout is a Coder magnet link:

```ts
const magnetLink = `${prefix}://coder.coder-remote/open?owner=${owner}&workspace=${workspace}&url=${url}&token=&openRecent=true&agent=${agent}`;
window.open(magnetLink, '_blank');
```

(`src/frontend/src/pad/buttons/ActionButton.tsx:376-379`)

That opens VS Code or Cursor on the user's machine and connects it to the Coder workspace. It is not an app shell, does not bundle a webview, and provides no native file dialogs, menus, auto-update, code signing, or offline mode.

**Applicability to WriteCanvas:** none for packaging. WriteCanvas is already an Electron 38 app with electron-builder targets for NSIS, DMG, AppImage, and deb (`package.json:8-33`). pad.ws's deployment model is a hosted web service with an IDE control plane, which is a different product category. The only transferable operational idea is separating static frontend serving from API/WebSocket serving, which WriteCanvas does not need for a desktop app.

---

## 8. Prioritized adopt / adapt / avoid list

Priorities are relative to WriteCanvas's current code and the evidence above. Effort is a rough engineering estimate, not a measured schedule.

### P0 — do next (high impact, contained risk)

| # | Action | Why (evidence) | WriteCanvas touchpoint | Effort |
|---|---|---|---|---|
| P0-1 | **Batch live-stroke updates to one paint per animation frame, and stop re-stamping the entire stroke on every `pointermove`.** Cache the stamp list and append only the new segment. | WriteCanvas calls `drawLiveSlice` from every pointer move (`src/js/editor.js:572-574`), which rebuilds all stamps for the whole stroke (`src/js/editor.js:473-488`; `src/js/pen.js:263-274`). Excalidraw separates in-progress rendering from static content and throttles pointer handling to RAF (`App.tsx:1820-1839,8060-8063`; `reactUtils.ts:23-32`). | `src/js/editor.js` `onPointerMove`, `drawLiveSlice`; `src/js/pen.js` `drawStrokeMask`, `buildStamps` | M |
| P0-2 | **Make zoom crisp without multiplying every full-page canvas by DPR.** Use a viewport-sized compositor or DPR-scale only the live/compositor layers; repaint committed content at the new scale when zoom settles. | WriteCanvas uses document-size backing stores (`src/js/editor.js:250-255`) and CSS `scale()` for zoom (`:156-168`), so zoom > 1 upscales. Excalidraw uses viewport-sized canvases with `window.devicePixelRatio` (`App.tsx:1806,1823,1852`; `StaticCanvas.tsx:61-70`). | `src/js/editor.js` `sizeLayers`, `applyTransform`; `src/index.html` canvas stack | M–L |
| P0-3 | **Add focus trap, initial focus, Escape-to-close, and focus return to every flyout/dialog.** | Excalidraw's `Popover` traps Tab and fits the viewport (`Popover.tsx:33-146`); `Modal` has `role="dialog"`/`aria-modal`/Escape (`Modal.tsx:35-65`); `Dialog` restores the previous focus (`Dialog.tsx:99-104`). WriteCanvas flyouts only toggle `hidden` (`src/js/editor.js:1623-1628,1633-1647`). | `src/js/editor.js` `openToolFlyout`, `closeToolFlyout`, `closeFlyoutCloser`; `src/index.html` flyouts | S–M |
| P0-4 | **Preserve the local atomic save path; do not move durability to a server snapshot.** Add a crash-recovery journal only if needed. | WriteCanvas writes temp + rename (`main/library.js:315-321`) with a 1.4s debounce (`src/js/editor.js:1479-1484`). pad.ws stores one JSONB pad (`pad_model.py:31`) and flushes to Postgres every 300s (`canvas_worker.py:11,422-450`), with no client cache. | `main/library.js`, `src/js/editor.js` save path | S (protect), M (journal) |
| P0-5 | **Use coalesced pointer events if the platform provides them, then dedupe against the last point.** | Excalidraw does **not** do this; it samples once per RAF (search found no `getCoalescedEvents`/`pointerrawupdate`). WriteCanvas also has no coalescing (`src/js/editor.js:2113-2116`). This is an improvement beyond pad.ws, especially for 120–240Hz pens. | `src/js/editor.js` pointer listeners; `src/js/pen.js` `addPoint` | S |

### P1 — worth doing when the area is touched

| # | Action | Why (evidence) | WriteCanvas touchpoint | Effort |
|---|---|---|---|---|
| P1-1 | **Show only contextually relevant tool options.** Pen options for pen, eraser size/mode for eraser, selection actions for selection; put rare controls behind an overflow. | Excalidraw's selected-shape panel conditionally renders controls (`Actions.tsx:104-281`) and hides rare tools in an overflow dropdown (`:366-454`). WriteCanvas's pen flyout is already mode-specific; the shape/eraser flyouts can follow the same rule. | `src/index.html:101-174`; `src/js/editor.js` flyout builders | M |
| P1-2 | **Adopt a command palette only if the command count justifies it.** Use real combobox/listbox semantics, not div items. | Excalidraw's palette has global shortcut, fuzzy search, recents, and Arrow/Enter handling (`CommandPalette.tsx:127-134,656-767,821-830,866-908`), but its items are divs (`:940-972`). | New UI; `src/js/editor.js` keyboard handler | M |
| P1-3 | **Group the library/menu actions by intent (File / Tools / Account), with icon + label.** | pad.ws's menu groups Files, Tools, Account/Settings/Logout (`MainMenu.tsx:215-273`). WriteCanvas's library flyout is currently a tree plus header (`src/index.html:152-155`). | `src/index.html` library flyout; `src/js/library.js` | S |
| P1-4 | **If a horizontal recent-notes/pages strip is added, use real tab semantics and arrow-key navigation.** | pad.ws's tab strip has good overflow paging and labels (`Tabs.tsx:72,181-218,400-434`; `Tabs.scss:19-47`) but lacks `tablist`/`tab` roles and arrow keys. | New UI or page bar | M |
| P1-5 | **Use a resize-aware compact toolbar only where width actually varies.** | pad.ws uses a `ResizeObserver` with breakpoints at 100/150/250/320/410px (`ActionButton.tsx:211-242`). WriteCanvas has a 1420px minimum window (`main/main.js:35`), so this is low value unless the toolbar is embedded or the minimum changes. | `src/index.html` topbar | S |

### P2 — optional / low urgency

| # | Action | Why | Effort |
|---|---|---|---|
| P2-1 | **Adopt the editable text overlay pattern** (already present in WriteCanvas). | Excalidraw uses a styled textarea overlay (`textWysiwyg.tsx:293-329,380-429`); WriteCanvas already does the same (`src/js/editor.js:1236-1268`). No change. | — |
| P2-2 | **Keep the object-level vs segment-level eraser distinction.** | Excalidraw erases whole elements (`eraser/index.ts:34-84`); WriteCanvas already has stroke/segment/sheet modes (`src/index.html:163-174`; `src/js/editor.js:490-540`). Do not regress. | — |

### Avoid — do not copy

| Anti-pattern | Evidence | Why it is wrong for WriteCanvas |
|---|---|---|
| Whole-pad JSONB as the document store | `pad_model.py:31`; `pad.py:61-69` | Rewrites the whole document, no page-level recovery, no operation history. WriteCanvas's per-page PNG + vector data is finer-grained. |
| 300-second durable flush | `canvas_worker.py:11,422-450` | Up to five minutes of loss; a note app needs seconds-level durability or a local journal. |
| Server-authoritative, no local cache | No IndexedDB/localStorage scene cache; only `public/auth/popup-close.html:9` | Desktop note apps must work offline and survive network loss. |
| Element-level LWW as "collaboration" | `canvas_worker.py:382-410`; `Collab.tsx:515-521` | Loses concurrent edits and cannot represent partial erasure of a stroke. |
| Per-user appState persisted but never shared | `ws_router.py:232`; `canvas_worker.py:306-331`; `pad_router.py:59-63` | Sends write-only traffic and provides no shared viewport/selection. |
| Ignoring `files` in scene sync | `Collab.tsx:340-344`; `Portal.tsx:337-341` vs server support at `canvas_worker.py:282-290` | Images added after load may not sync. If WriteCanvas adds pasted images, do not repeat this. |
| 5-attempt reconnect with no scene resync | `Portal.tsx:19-20,175-186`; `constants.ts:27-28`; `ws_router.py:420` | A reconnect can silently diverge. Any future sync needs a resync handshake. |
| Native `prompt`/`confirm` for rename/delete | `TabContextMenu.tsx:235-250` | Blocking, unstyled, inaccessible relative to an in-app dialog. |
| Clickable `<div>` menu/flyout options | `ActionButton.tsx:477-553`; `SearchableLanguageSelector.tsx:267-285`; `CommandPalette.tsx:940-972` | Not keyboard focusable or screen-reader semantic. Use real buttons/options. |
| React/Excalidraw component architecture | `App.tsx:1-4,60-114`; `package.json:5-6` | WriteCanvas is vanilla HTML/CSS/JS + Electron; adopting React and a 300k-line canvas library would be a rewrite, not a refactor. |
| Coder / Keycloak / Postgres / Redis control plane | `docker-compose.yml:3-96`; `workspace_router.py:23-97` | Solves hosted IDE tenancy, not desktop note-taking. No user-facing benefit for WriteCanvas. |

---

## 9. Applicability to WriteCanvas

### 9.1 What WriteCanvas already does well (keep)

| Area | Current implementation | Evidence | Assessment |
|---|---|---|---|
| Layer separation | `paperC`, `rasterC`, `inkC`, `liveC`, `laserC`, `rulerC`; committed ink on `inkC`, live stroke on `liveC` | `src/index.html:90-95`; `src/js/editor.js:258-267,473-488` | Correct architecture; keep it. |
| Current-page-only rendering | `renderPage` only draws the current page | `src/js/editor.js:258-267` | Correct; avoids painting the whole notebook. |
| Pressure input | Per-point `p` stored in `stroke.pts`; smoothing interpolates pressure | `src/js/pen.js:59-63,69-89,305-314`; `src/js/editor.js:454,573` | Good; add coalesced events for fidelity, not a new pressure model. |
| Atomic save | Temp file + rename; index persisted after page file; rollback on index failure | `main/library.js:315-329` | Stronger than pad.ws; keep. |
| Autosave | 1.4s debounce, serialized saves, capture note/page at call time | `src/js/editor.js:1479-1484,1497-1500` | Good; consider a crash journal only if close/crash loss is observed. |
| Save status | `role="status" aria-live="polite"` | `src/index.html:77` | Good; ensure error text is announced too. |
| Text editing | Real textarea overlay with matching style and formatting bar | `src/js/editor.js:1236-1296` | Matches Excalidraw's WYSIWYG approach; keep. |
| Eraser granularity | Stroke, segment, and sheet modes | `src/index.html:163-174`; `src/js/editor.js:490-540` | More capable than Excalidraw's object-only eraser; keep. |
| Toolbar semantics | Labels, `aria-label`, `aria-keyshortcuts`, `aria-pressed` | `src/index.html:54-78` | Better than pad.ws's div-based custom controls; keep and extend to flyouts. |

### 9.2 Concrete gaps and recommended changes

#### Gap 1 — Live stroke work grows with stroke length

**Current:** every pointer move calls `drawLiveSlice`, which calls `drawStrokeMask` on the entire stroke; `drawStrokeMask` rebuilds every stamp (`src/js/editor.js:572-574,473-488`; `src/js/pen.js:263-274`; `src/js/pen.js:93-228`).

**Recommended:** keep an incremental stamp cache per live stroke:

- on `pointerdown`, initialize an empty stamp list and paint the first dot;
- on each new point, build stamps only for the segment since the last point;
- append those stamps to the cached list and paint only the dirty bounding box into `scratchCtx`;
- composite `scratch` once per RAF into `liveC`, preserving the current "opaque mask then one alpha composite" behavior (`src/js/pen.js:263-274`).

Because `smoothPoints` is midpoint-based and uses the next raw sample (`src/js/pen.js:69-89`), the incremental cache must keep the last one or two samples unfinalized and only append stamps for the stabilized prefix; otherwise the newest segment will visibly change shape when the next point arrives.

This preserves the existing anti-darkening fix while removing the repeated full-stroke work. It is the WriteCanvas equivalent of Excalidraw's "render only the new element" split.

#### Gap 2 — Zoom is CSS-only

**Current:** backing stores are document-sized (`src/js/editor.js:250-255`); `applyTransform` sets a CSS `scale()` (`:156-168`). At zoom > 1, ink is upscaled; at high DPI, it is also under-sampled relative to device pixels.

**Recommended:** do not simply multiply all six layers by DPR. Options, in order of cost:

1. **Cheapest:** keep committed layers document-sized, but render the live preview into a viewport-sized scratch/compositor canvas at DPR resolution. This fixes the most visible case (the stroke under the pen) without a full compositor rewrite.
2. **Medium:** on zoom settle, repaint committed layers at a higher internal scale into a viewport-sized display canvas; keep the document-sized bitmap as the source.
3. **Long-term:** tile the page (e.g., 512×512) and composite visible tiles at DPR; this scales to large pages and high zoom but is a larger change.

The Excalidraw evidence supports the viewport-sized approach (`StaticCanvas.tsx:61-70`; `App.tsx:1806`), not full-page DPR multiplication.

#### Gap 3 — Input is not coalesced or frame-batched

**Current:** `pointermove` is attached directly (`src/js/editor.js:2113-2116`); each event appends and draws.

**Recommended:**

- Use `event.getCoalescedEvents?.()` when available and append all samples in order, not just the latest one.
- Coalesce paints to one per `requestAnimationFrame`; keep the latest pending points in a small buffer.
- Deduplicate points closer than the current `minDist` threshold (already done in `addPoint`, `src/js/pen.js:305-314`).
- Keep pressure per sample; do not average it across a frame.

Excalidraw shows the RAF-batching half of this (`reactUtils.ts:23-32`), but not the coalescing half. The combination is better than either.

#### Gap 4 — Flyouts are dialogs visually but not behaviorally

**Current:** `role="dialog"` and labels are present (`src/index.html:101-174`), but `openToolFlyout` only positions and light-dismisses (`src/js/editor.js:1633-1647`); `closeToolFlyout` only hides (`:1623-1628`); global Escape handles a fixed list (`:2144-2148`).

**Recommended:**

- On open, remember `document.activeElement`, focus the first focusable control (or the dialog container).
- Trap Tab/Shift+Tab within the flyout.
- Close on Escape and restore focus to the anchor.
- Keep the existing outside-pointer dismissal, but do not let it steal focus from a control that is about to be clicked.
- For menus inside flyouts, use `role="menu"`/`menuitem` or plain buttons with arrow-key support; do not leave clickable `<div>`s.

This is a small, high-confidence accessibility win. The Excalidraw `Popover` and `Dialog` implementations are good references (`Popover.tsx:33-146`; `Dialog.tsx:99-104`).

#### Gap 5 — Contextual options are split across always-visible flyouts

**Current:** pen, shape, eraser, board-color, save, and library flyouts each expose their full option set (`src/index.html:101-174`). The toolbar already has labeled toggles, so the entry points are clear.

**Recommended:** keep the entry points, but make each flyout show only the controls for the active mode. For example, the eraser flyout should not show pen size; the shape flyout should not show text formatting until text is active. This mirrors Excalidraw's conditional `SelectedShapeActions` (`Actions.tsx:104-281`) and reduces scanning.

### 9.3 What not to change

- **Do not adopt Excalidraw's object-only eraser.** WriteCanvas's segment eraser is strictly more capable (`src/js/editor.js:490-540`).
- **Do not replace the local file store with a server document.** pad.ws's model is optimized for a hosted whiteboard, not a durable note app.
- **Do not add React/Excalidraw.** The interaction patterns are useful; the runtime and component model are not.
- **Do not copy pad.ws's custom tab/menu accessibility.** Copy Excalidraw's dialog primitives or use native semantics instead.

### 9.4 If collaboration is planned

pad.ws is a useful **protocol sketch** (WebSocket + Redis stream + presence pub/sub) but a poor **conflict model**. For WriteCanvas:

- sync pages/strokes, not a monolithic scene;
- use stable stroke IDs and explicit tombstones for segment erasure;
- sync assets separately;
- use a CRDT or operation log with per-page compaction;
- keep local writes primary and the network a replicator;
- test offline/reconnect and concurrent segment erasure before shipping.

A reasonable first step is **not** real-time collaboration; it is an export/import or a read-only shared snapshot. That avoids the hardest conflict cases while delivering most of the sharing value.

---

## 10. Not applicable to WriteCanvas

| Item | Why it does not apply |
|---|---|
| React 19 + `@atyrode/excalidraw` component architecture | WriteCanvas is vanilla HTML/CSS/JS with Electron. The useful ideas are canvas layering, RAF batching, and UI patterns, not the component tree or Excalidraw's 300k-line codebase. |
| Coder, terminal, Monaco editor, VS Code/Cursor magnet links | These are pad.ws's hosted-IDE product. WriteCanvas is a local note app; it has no workspace control plane and no need for remote IDE sessions. |
| Keycloak, Postgres, Redis, Docker Compose | pad.ws's multi-user hosted deployment. WriteCanvas stores notes on the local filesystem and has no server-side tenancy. |
| Whole-pad JSONB + 300-second flush | Wrong durability unit and wrong latency for note-taking. WriteCanvas's atomic per-page save is better. |
| Element-level LWW collaboration | Does not fit partial stroke erasure or offline editing; pad.ws itself has reconnect gaps and image-file gaps. |
| Excalidraw JSON scene format | WriteCanvas has its own page/PNG/vector persistence. Adopting the scene format would be a storage migration with no user benefit. |
| Infinite canvas / diagram tools (shapes, frames, embeds, Mermaid, laser, lasso) | WriteCanvas is a page-based handwriting app. Some shapes/text already exist (`src/index.html:156-161`), but the infinite-canvas model and diagram tooling are out of scope. |
| Electron/Tauri packaging from pad.ws | pad.ws has none. WriteCanvas already has Electron 38 + electron-builder; there is nothing to adopt. |
| pad.ws's custom tab context menu, action flyout divs, language selector divs | These are accessibility anti-patterns; use native buttons/dialogs instead. |
| pad.ws's command palette as-is | The keyboard model is good, but the div-based items are not. If WriteCanvas adds a palette, implement proper listbox semantics. |

---

## 11. Open questions and unverified items

1. **Published bundle vs fork source.** The npm tarball is `0.18.0-15`; the fork checkout is `0a534f1b...` (2025-05-14). The fork was used for readable line-level citations. A diff against the published bundle was not performed, so a few line numbers or details may differ in the exact artifact pad.ws loads.
2. **No runtime multi-client test.** The reconnect/divergence and image-file findings are code-inspection findings. A two-browser test (disconnect one, edit in the other, reconnect) would confirm the divergence. An image-paste test would confirm whether files persist through another path not found by search.
3. **No performance profiling.** The O(n²) live-stroke claim is derived from the call graph (`drawLiveStroke` → `drawStrokeMask` → `buildStamps` over all points), not from a profile. Real device timings will vary with page size, DPR, and pen rate.
4. **No pen-hardware matrix.** Pressure behavior on Wacom, Surface Pen, Apple Pencil (via browser), and mouse was not tested. Excalidraw's `event.pressure === 0.5` simulated-pressure heuristic and WriteCanvas's `p > 0 ? p : 0.5` fallback (`src/js/pen.js:59-63`) may behave differently across devices.
5. **No upstream Excalidraw diff.** The `@atyrode` fork may contain changes beyond stock Excalidraw 0.18. This review treats the fork as the implementation pad.ws ships, not as upstream Excalidraw documentation.
6. **No production pad.ws deployment inspection.** The compose file is explicitly a development/test setup (`README.md:26-27`); the managed service may use different infrastructure, scaling, or persistence settings.
7. **No license review beyond MIT.** Both repositories are MIT-licensed. Reusing code requires preserving the copyright/permission notice; this report is technical research, not legal advice.

---

## 12. Source map

### pad.ws (commit `eac61edab04e56567fd454e47f71ee0603e3e141`)

- Repository: <https://github.com/coderamp-labs/pad.ws/tree/eac61edab04e56567fd454e47f71ee0603e3e141>
- App composition: [`src/frontend/src/App.tsx`](https://github.com/coderamp-labs/pad.ws/blob/eac61edab04e56567fd454e47f71ee0603e3e141/src/frontend/src/App.tsx)
- Constants / hidden UI / collab timings: [`src/frontend/src/constants.ts`](https://github.com/coderamp-labs/pad.ws/blob/eac61edab04e56567fd454e47f71ee0603e3e141/src/frontend/src/constants.ts)
- Collaboration client: [`src/frontend/src/lib/collab/Collab.tsx`](https://github.com/coderamp-labs/pad.ws/blob/eac61edab04e56567fd454e47f71ee0603e3e141/src/frontend/src/lib/collab/Collab.tsx), [`Portal.tsx`](https://github.com/coderamp-labs/pad.ws/blob/eac61edab04e56567fd454e47f71ee0603e3e141/src/frontend/src/lib/collab/Portal.tsx)
- Main menu / tabs / context menu: [`MainMenu.tsx`](https://github.com/coderamp-labs/pad.ws/blob/eac61edab04e56567fd454e47f71ee0603e3e141/src/frontend/src/ui/MainMenu.tsx), [`Tabs.tsx`](https://github.com/coderamp-labs/pad.ws/blob/eac61edab04e56567fd454e47f71ee0603e3e141/src/frontend/src/ui/Tabs.tsx), [`Tabs.scss`](https://github.com/coderamp-labs/pad.ws/blob/eac61edab04e56567fd454e47f71ee0603e3e141/src/frontend/src/ui/Tabs.scss), [`TabContextMenu.tsx`](https://github.com/coderamp-labs/pad.ws/blob/eac61edab04e56567fd454e47f71ee0603e3e141/src/frontend/src/ui/TabContextMenu.tsx)
- Action button / language selector: [`ActionButton.tsx`](https://github.com/coderamp-labs/pad.ws/blob/eac61edab04e56567fd454e47f71ee0603e3e141/src/frontend/src/pad/buttons/ActionButton.tsx), [`SearchableLanguageSelector.tsx`](https://github.com/coderamp-labs/pad.ws/blob/eac61edab04e56567fd454e47f71ee0603e3e141/src/frontend/src/pad/editors/SearchableLanguageSelector.tsx)
- Backend pad model / router: [`pad_model.py`](https://github.com/coderamp-labs/pad.ws/blob/eac61edab04e56567fd454e47f71ee0603e3e141/src/backend/database/models/pad_model.py), [`pad_router.py`](https://github.com/coderamp-labs/pad.ws/blob/eac61edab04e56567fd454e47f71ee0603e3e141/src/backend/routers/pad_router.py), [`pad.py`](https://github.com/coderamp-labs/pad.ws/blob/eac61edab04e56567fd454e47f71ee0603e3e141/src/backend/domain/pad.py)
- Worker / WebSocket: [`canvas_worker.py`](https://github.com/coderamp-labs/pad.ws/blob/eac61edab04e56567fd454e47f71ee0603e3e141/src/backend/workers/canvas_worker.py), [`ws_router.py`](https://github.com/coderamp-labs/pad.ws/blob/eac61edab04e56567fd454e47f71ee0603e3e141/src/backend/routers/ws_router.py)
- Deployment: [`Dockerfile`](https://github.com/coderamp-labs/pad.ws/blob/eac61edab04e56567fd454e47f71ee0603e3e141/Dockerfile), [`docker-compose.yml`](https://github.com/coderamp-labs/pad.ws/blob/eac61edab04e56567fd454e47f71ee0603e3e141/docker-compose.yml)
- README: [`README.md`](https://github.com/coderamp-labs/pad.ws/blob/eac61edab04e56567fd454e47f71ee0603e3e141/README.md)
- License: [`LICENSE`](https://github.com/coderamp-labs/pad.ws/blob/eac61edab04e56567fd454e47f71ee0603e3e141/LICENSE)

### Excalidraw fork (commit `0a534f1bc688ad6c71954fef51a69407613efdbc`)

- Repository: <https://github.com/atyrode/excalidraw/tree/0a534f1bc688ad6c71954fef51a69407613efdbc>
- App / canvas layers / pointer handling: [`packages/excalidraw/components/App.tsx`](https://github.com/atyrode/excalidraw/blob/0a534f1bc688ad6c71954fef51a69407613efdbc/packages/excalidraw/components/App.tsx)
- Static / new-element / interactive canvases: [`StaticCanvas.tsx`](https://github.com/atyrode/excalidraw/blob/0a534f1bc688ad6c71954fef51a69407613efdbc/packages/excalidraw/components/canvases/StaticCanvas.tsx), [`NewElementCanvas.tsx`](https://github.com/atyrode/excalidraw/blob/0a534f1bc688ad6c71954fef51a69407613efdbc/packages/excalidraw/components/canvases/NewElementCanvas.tsx), [`InteractiveCanvas.tsx`](https://github.com/atyrode/excalidraw/blob/0a534f1bc688ad6c71954fef51a69407613efdbc/packages/excalidraw/components/canvases/InteractiveCanvas.tsx)
- Renderers / culling / RAF: [`Renderer.ts`](https://github.com/atyrode/excalidraw/blob/0a534f1bc688ad6c71954fef51a69407613efdbc/packages/excalidraw/scene/Renderer.ts), [`staticScene.ts`](https://github.com/atyrode/excalidraw/blob/0a534f1bc688ad6c71954fef51a69407613efdbc/packages/excalidraw/renderer/staticScene.ts), [`renderNewElementScene.ts`](https://github.com/atyrode/excalidraw/blob/0a534f1bc688ad6c71954fef51a69407613efdbc/packages/excalidraw/renderer/renderNewElementScene.ts), [`interactiveScene.ts`](https://github.com/atyrode/excalidraw/blob/0a534f1bc688ad6c71954fef51a69407613efdbc/packages/excalidraw/renderer/interactiveScene.ts), [`reactUtils.ts`](https://github.com/atyrode/excalidraw/blob/0a534f1bc688ad6c71954fef51a69407613efdbc/packages/excalidraw/reactUtils.ts), [`utils.ts`](https://github.com/atyrode/excalidraw/blob/0a534f1bc688ad6c71954fef51a69407613efdbc/packages/common/src/utils.ts)
- Freehand rendering: [`renderElement.ts`](https://github.com/atyrode/excalidraw/blob/0a534f1bc688ad6c71954fef51a69407613efdbc/packages/element/src/renderElement.ts)
- Toolbar / actions / shapes: [`LayerUI.tsx`](https://github.com/atyrode/excalidraw/blob/0a534f1bc688ad6c71954fef51a69407613efdbc/packages/excalidraw/components/LayerUI.tsx), [`Actions.tsx`](https://github.com/atyrode/excalidraw/blob/0a534f1bc688ad6c71954fef51a69407613efdbc/packages/excalidraw/components/Actions.tsx), [`shapes.tsx`](https://github.com/atyrode/excalidraw/blob/0a534f1bc688ad6c71954fef51a69407613efdbc/packages/excalidraw/components/shapes.tsx), [`ToolButton.tsx`](https://github.com/atyrode/excalidraw/blob/0a534f1bc688ad6c71954fef51a69407613efdbc/packages/excalidraw/components/ToolButton.tsx)
- Command palette: [`CommandPalette.tsx`](https://github.com/atyrode/excalidraw/blob/0a534f1bc688ad6c71954fef51a69407613efdbc/packages/excalidraw/components/CommandPalette/CommandPalette.tsx)
- Accessibility primitives: [`Popover.tsx`](https://github.com/atyrode/excalidraw/blob/0a534f1bc688ad6c71954fef51a69407613efdbc/packages/excalidraw/components/Popover.tsx), [`Modal.tsx`](https://github.com/atyrode/excalidraw/blob/0a534f1bc688ad6c71954fef51a69407613efdbc/packages/excalidraw/components/Modal.tsx), [`Dialog.tsx`](https://github.com/atyrode/excalidraw/blob/0a534f1bc688ad6c71954fef51a69407613efdbc/packages/excalidraw/components/Dialog.tsx)
- Text / eraser / history: [`textWysiwyg.tsx`](https://github.com/atyrode/excalidraw/blob/0a534f1bc688ad6c71954fef51a69407613efdbc/packages/excalidraw/wysiwyg/textWysiwyg.tsx), [`eraser/index.ts`](https://github.com/atyrode/excalidraw/blob/0a534f1bc688ad6c71954fef51a69407613efdbc/packages/excalidraw/eraser/index.ts), [`actionHistory.tsx`](https://github.com/atyrode/excalidraw/blob/0a534f1bc688ad6c71954fef51a69407613efdbc/packages/excalidraw/actions/actionHistory.tsx)
- Package: <https://www.npmjs.com/package/@atyrode/excalidraw/v/0.18.0-15>
- License: [`LICENSE`](https://github.com/atyrode/excalidraw/blob/0a534f1bc688ad6c71954fef51a69407613efdbc/LICENSE)

### WriteCanvas (working tree, 2026-10-20)

- Canvas stack: [`src/index.html`](https://github.com/ThanhNguyxnOrg/WriteCanvas/blob/master/src/index.html) (local: `src/index.html:90-95`)
- Editor / live stroke / zoom / flyouts: `src/js/editor.js:156-168,250-255,258-267,473-488,542-574,1479-1484,1567-1656,2122-2148`
- Pen input / stamping: `src/js/pen.js:59-63,69-89,93-228,263-274,305-314`
- Atomic save: `main/library.js:315-329`
- Electron packaging: `package.json:8-33`; `main/main.js:35`
