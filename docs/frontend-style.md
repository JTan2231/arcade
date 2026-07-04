# Frontend Style

Arcade uses a single dark UI theme. The executable source of truth for colors
is the `:root` token block in `web/frontend/src/styles.css`.

## Color Direction

The current interface is a quiet, work-focused application UI:

- near-black, black, white, and neutral gray for almost every UI role;
- white and light gray for focus rings, active selections, links, and primary
  actions;
- muted red only for destructive or error states;
- grayscale syntax highlighting for code-like evidence.

## Color Tokens

Use semantic color tokens in component rules. Do not add raw hex or `rgb()`
values outside the `:root` token block unless the value is an intrinsic CSS
keyword such as `transparent`, `currentcolor`, or `inherit`.

| Token | Value | Use |
| --- | --- | --- |
| `--color-page` | `#050505` | App background and code-like surfaces. |
| `--color-surface` | `#111` | Panels, inputs, menus, and raised surfaces. |
| `--color-surface-subtle` | `#171717` | Rows, forms, previews, and empty states inside panels. |
| `--color-surface-hover` | `#202020` | Neutral row and control hover states. |
| `--color-surface-muted` | `#262626` | Secondary button, icon, pill, and menu hover states. |
| `--color-text` | `#f0f0f0` | Primary text. |
| `--color-text-muted` | `#a1a1a1` | Metadata, labels, and supporting text. |
| `--color-text-nav-muted` | `#8a8a8a` | Unselected sidebar navigation text. |
| `--color-icon-muted` | `#707070` | Muted sidebar icon controls. |
| `--color-border` | `#303030` | Default borders and dividers. |
| `--color-border-subtle` | `#242424` | Tree connector lines. |
| `--color-border-hover` | `#4a4a4a` | Neutral hover borders. |
| `--color-accent` | `#f0f0f0` | Focus rings, active links, and active navigation text. |
| `--color-accent-hover` | `#fff` | Hovered links and strong accent text. |
| `--color-accent-surface` | `#202020` | Selected rows and selected controls. |
| `--color-accent-surface-hover` | `#292929` | Hovered selected rows and controls. |
| `--color-accent-badge-surface` | `#202020` | Small accent badges. |
| `--color-accent-border` | `#5a5a5a` | Selected borders. |
| `--color-accent-border-hover` | `#707070` | Hovered selected borders. |
| `--color-accent-badge-border` | `#454545` | Small accent badge borders. |
| `--color-accent-action` | `#262626` | Filled primary action backgrounds. |
| `--color-accent-action-hover` | `#303030` | Hovered filled primary action backgrounds. |
| `--color-accent-action-text` | `#fff` | Text on filled primary action backgrounds. |
| `--color-danger` | `#ff9592` | Destructive actions and error text. |
| `--color-danger-surface` | `#241515` | Destructive hover surfaces. |
| `--color-danger-border` | `#5a2a2a` | Destructive control borders. |
| `--color-danger-border-hover` | `#8a3a38` | Destructive hover borders. |
| `--color-header` | `#080808` | App header background. |
| `--color-header-muted` | `#a1a1a1` | Secondary header text. |
| `--color-inverse-text` | `#f0f0f0` | Text on near-black surfaces. |
| `--color-overlay` | `rgb(2 6 8 / 64%)` | Modal backdrop. |
| `--color-toast` | `#050708` | Toast background. |
| `--color-code-fade-start` | `rgb(5 5 5 / 0%)` | Transparent edge of code preview fades. |
| `--color-code-attribute` | `#ddd` | Syntax-highlighted attributes and types. |
| `--color-code-comment` | `#8a8a8a` | Syntax-highlighted comments. |
| `--color-code-keyword` | `#e8e8e8` | Syntax-highlighted keywords. |
| `--color-code-literal` | `#c8c8c8` | Syntax-highlighted numbers, symbols, and literals. |
| `--color-code-meta` | `#a1a1a1` | Syntax-highlighted metadata and deletions. |
| `--color-code-string` | `#f0f0f0` | Syntax-highlighted strings and additions. |
| `--color-code-title` | `#fff` | Syntax-highlighted names, sections, and titles. |

Shadow tokens live beside the color tokens because their color values are also
part of the visual palette:

| Token | Value | Use |
| --- | --- | --- |
| `--shadow-panel` | `0 1px 2px rgb(0 0 0 / 30%)` | Standard panel elevation. |
| `--shadow-popover` | `0 12px 28px rgb(0 0 0 / 45%)` | Menus and popovers. |
| `--shadow-modal` | `0 24px 80px rgb(0 0 0 / 58%)` | Dialogs. |
| `--shadow-toast` | `0 8px 24px rgb(0 0 0 / 48%)` | Toasts. |

## Working Rules

- Prefer changing an existing token value over overriding colors in component
  rules.
- Add a new token only when the UI has a distinct semantic role that is not
  covered by the existing set.
- Name tokens by usage rather than by hue. Use `--color-accent-surface`, not
  `--color-teal-50`.
- Keep the core UI monochrome. Apart from destructive/error states, new
  saturated hues should be treated as product content rather than chrome.
- Keep legacy aliases in `styles.css` only as migration aids. New code should
  use the semantic tokens above.
- Validate code changes with `./ci.sh`.
- For frontend visual checks, use `./locator.ts` to inspect affected rendered
  regions and generated screenshots.
