# Frontend Style

Arcade uses a single light UI theme. The executable source of truth for colors
is the `:root` token block in `web/frontend/src/styles.css`.

## Color Direction

The current interface is a quiet, work-focused application UI:

- neutral gray-blue surfaces and borders for structure;
- teal for primary actions, active selections, and links;
- red for destructive or error states;
- dark blue-gray for the app header, modal overlay, and toast surfaces.

## Color Tokens

Use semantic color tokens in component rules. Do not add raw hex or `rgb()`
values outside the `:root` token block unless the value is an intrinsic CSS
keyword such as `transparent`, `currentcolor`, or `inherit`.

| Token | Value | Use |
| --- | --- | --- |
| `--color-page` | `#f6f7f9` | App background and code-like surfaces. |
| `--color-surface` | `#fff` | Panels, inputs, menus, and raised surfaces. |
| `--color-surface-subtle` | `#fbfcfe` | Rows, forms, previews, and empty states inside panels. |
| `--color-surface-hover` | `#f5f8fb` | Neutral row and control hover states. |
| `--color-surface-muted` | `#eef2f6` | Secondary button, icon, pill, and menu hover states. |
| `--color-text` | `#1f2933` | Primary text. |
| `--color-text-muted` | `#637083` | Metadata, labels, and supporting text. |
| `--color-text-nav-muted` | `#758294` | Unselected sidebar navigation text. |
| `--color-icon-muted` | `#9aa4b2` | Muted sidebar icon controls. |
| `--color-border` | `#d8dee8` | Default borders and dividers. |
| `--color-border-subtle` | `#c6d1dc` | Tree connector lines. |
| `--color-border-hover` | `#b9c6d3` | Neutral hover borders. |
| `--color-accent` | `#0f766e` | Primary actions, focus rings, and active links. |
| `--color-accent-hover` | `#0b5d56` | Hovered primary actions and strong accent text. |
| `--color-accent-surface` | `#f3fbfa` | Selected rows and selected controls. |
| `--color-accent-surface-hover` | `#eef9f7` | Hovered selected rows and controls. |
| `--color-accent-badge-surface` | `#e9f5f4` | Small accent badges. |
| `--color-accent-border` | `#81b8b2` | Selected borders. |
| `--color-accent-border-hover` | `#6aa8a1` | Hovered selected borders. |
| `--color-accent-badge-border` | `#bedbd8` | Small accent badge borders. |
| `--color-danger` | `#b91c1c` | Destructive actions and error text. |
| `--color-danger-surface` | `#fff1f1` | Destructive hover surfaces. |
| `--color-danger-border` | `#f0b8b8` | Destructive control borders. |
| `--color-danger-border-hover` | `#d66f6f` | Destructive hover borders. |
| `--color-header` | `#263238` | App header background. |
| `--color-header-muted` | `#dbe5ea` | Secondary header text. |
| `--color-inverse-text` | `#fff` | Text on dark or accent surfaces. |
| `--color-overlay` | `rgb(17 24 39 / 42%)` | Modal backdrop. |
| `--color-toast` | `#111827` | Toast background. |
| `--color-code-fade-start` | `rgb(246 247 249 / 0%)` | Transparent edge of code preview fades. |

Shadow tokens live beside the color tokens because their color values are also
part of the visual palette:

| Token | Value | Use |
| --- | --- | --- |
| `--shadow-panel` | `0 1px 2px rgb(20 28 38 / 8%)` | Standard panel elevation. |
| `--shadow-popover` | `0 8px 22px rgb(20 28 38 / 16%)` | Menus and popovers. |
| `--shadow-modal` | `0 24px 60px rgb(20 28 38 / 28%)` | Dialogs. |
| `--shadow-toast` | `0 8px 24px rgb(0 0 0 / 22%)` | Toasts. |

## Working Rules

- Prefer changing an existing token value over overriding colors in component
  rules.
- Add a new token only when the UI has a distinct semantic role that is not
  covered by the existing set.
- Name tokens by usage rather than by hue. Use `--color-accent-surface`, not
  `--color-teal-50`.
- Keep legacy aliases in `styles.css` only as migration aids. New code should
  use the semantic tokens above.
- Validate code changes with `./ci.sh`.
- For frontend visual checks, use `./locator.ts` to inspect affected rendered
  regions and generated screenshots.
