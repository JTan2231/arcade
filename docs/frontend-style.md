# Frontend Style

Arcade uses a single dark UI theme. The active executable source of truth is the
generated palette under `web/frontend/src/palette`. The `:root` block in
`web/frontend/src/styles/tokens.css` remains the complete first-paint and
runtime-failure fallback.

`src/main.tsx` creates and validates the default palette, then installs all 57
semantic color, shadow, and glow variables before React mounts. Component CSS
continues to consume only those semantic variables.

## Color Direction

The current interface is a quiet, work-focused application UI:

- blue-black, cool dark surfaces, white, and low-saturation cool gray for most
  UI roles;
- cool white and light blue-gray for focus rings, active selections, links, and
  primary actions;
- muted red only for destructive or error states;
- restrained multi-hue syntax highlighting for code-like evidence, treated as
  content rather than general UI chrome.

## Color Tokens

Use semantic color tokens in component rules. Do not add raw hex or `rgb()`
values outside the `:root` token block unless the value is an intrinsic CSS
keyword such as `transparent`, `currentcolor`, or `inherit`. The values below
are the fallback and calibration targets; the active generated values are
perceptually fitted to them and locked by `src/palette/snapshot.ts`.

| Token                            | Value                     | Use                                                    |
| -------------------------------- | ------------------------- | ------------------------------------------------------ |
| `--color-page`                   | `#060a10`                 | App background.                                        |
| `--color-surface`                | `#11151b`                 | Panels, inputs, menus, and raised surfaces.            |
| `--color-surface-subtle`         | `#171c24`                 | Rows, forms, previews, and empty states inside panels. |
| `--color-surface-hover`          | `#202733`                 | Neutral row and control hover states.                  |
| `--color-surface-muted`          | `#26303d`                 | Secondary button, icon, pill, and menu hover states.   |
| `--color-text`                   | `#f0f4f8`                 | Primary text.                                          |
| `--color-text-muted`             | `#a3adba`                 | Metadata, labels, and supporting text.                 |
| `--color-text-nav-muted`         | `#8994a3`                 | Unselected sidebar navigation text.                    |
| `--color-text-nav-active-parent` | `#c6d0dc`                 | Selected sidebar parent when a child item is selected. |
| `--color-icon-muted`             | `#707b8a`                 | Muted sidebar icon controls.                           |
| `--color-border`                 | `#303947`                 | Default borders and dividers.                          |
| `--color-border-subtle`          | `#242b35`                 | Tree connector lines.                                  |
| `--color-border-hover`           | `#4a586b`                 | Neutral hover borders.                                 |
| `--color-accent`                 | `#f0f6ff`                 | Focus rings, active links, and active navigation text. |
| `--color-accent-hover`           | `#fff`                    | Hovered links and strong accent text.                  |
| `--color-accent-surface`         | `#202936`                 | Selected rows and selected controls.                   |
| `--color-accent-surface-hover`   | `#293443`                 | Hovered selected rows and controls.                    |
| `--color-accent-badge-surface`   | `#202936`                 | Small accent badges.                                   |
| `--color-accent-border`          | `#5a6a80`                 | Selected borders.                                      |
| `--color-accent-border-hover`    | `#708298`                 | Hovered selected borders.                              |
| `--color-accent-badge-border`    | `#465466`                 | Small accent badge borders.                            |
| `--color-accent-action`          | `#26303d`                 | Filled primary action backgrounds.                     |
| `--color-accent-action-hover`    | `#303b4a`                 | Hovered filled primary action backgrounds.             |
| `--color-accent-action-text`     | `#fff`                    | Text on filled primary action backgrounds.             |
| `--color-danger`                 | `#ff9592`                 | Destructive actions and error text.                    |
| `--color-danger-surface`         | `#241515`                 | Destructive hover surfaces.                            |
| `--color-danger-border`          | `#5a2a2a`                 | Destructive control borders.                           |
| `--color-danger-border-hover`    | `#8a3a38`                 | Destructive hover borders.                             |
| `--color-post-tag`               | `#b87333`                 | Post tag labels.                                       |
| `--color-leaderboard-gold`       | `#e7d17a`                 | First-place leaderboard content.                       |
| `--color-leaderboard-silver`     | `#d6d6d6`                 | Second-place leaderboard content.                      |
| `--color-leaderboard-bronze`     | `#d6985e`                 | Third-place leaderboard content.                       |
| `--color-header`                 | `#080c12`                 | App header background.                                 |
| `--color-header-muted`           | `#a3adba`                 | Secondary header text.                                 |
| `--color-inverse-text`           | `#f0f4f8`                 | Text on near-black surfaces.                           |
| `--color-overlay`                | `rgb(2 6 8 / 64%)`        | Modal backdrop.                                        |
| `--color-toast`                  | `#05080d`                 | Toast background.                                      |
| `--color-output-item-title-dim`  | `color-mix(...)`          | Resting generated-output link text.                    |
| `--color-feed-spotlight`         | `rgb(232 242 255 / 8%)`   | Canvas-drawn feed output spotlight origin.             |
| `--color-feed-spotlight-transparent` | `rgb(232 242 255 / 0%)`   | Canvas-drawn transparent spotlight endpoint.           |
| `--color-code-surface`           | `#2c4a3e`                 | Code-like surfaces.                                    |
| `--color-code-border`            | `#4d725f`                 | Code-like surface borders.                             |
| `--color-code-accent`            | `#50d4b7`                 | Code-like surface accent strokes.                      |
| `--color-code-fade-start`        | `rgb(44 74 62 / 0%)`      | Transparent edge of code preview fades.                |
| `--color-code-attribute`         | `#80cbc4`                 | Syntax-highlighted attributes and types.               |
| `--color-code-comment`           | `#8ea39b`                 | Syntax-highlighted comments.                           |
| `--color-code-keyword`           | `#8edcff`                 | Syntax-highlighted keywords.                           |
| `--color-code-literal`           | `#f3c969`                 | Syntax-highlighted numbers, symbols, and literals.     |
| `--color-code-meta`              | `#ff9e9e`                 | Syntax-highlighted metadata and deletions.             |
| `--color-code-string`            | `#c3e88d`                 | Syntax-highlighted strings and additions.              |
| `--color-code-title`             | `#d9b8ff`                 | Syntax-highlighted names, sections, and titles.        |

Shadow tokens live beside the color tokens because their color values are also
part of the visual palette:

| Token                            | Value                          | Use                                |
| -------------------------------- | ------------------------------ | ---------------------------------- |
| `--shadow-panel`                 | `0 1px 2px rgb(0 4 12 / 30%)`   | Standard panel elevation.          |
| `--shadow-popover`               | `0 12px 28px rgb(0 4 12 / 45%)` | Menus and popovers.                |
| `--shadow-modal`                 | `0 24px 80px rgb(0 4 12 / 58%)` | Dialogs.                           |
| `--shadow-toast`                 | `0 8px 24px rgb(0 4 12 / 48%)`  | Toasts.                            |
| `--filter-leaderboard-gold-glow` | `drop-shadow(...)`             | First-place leaderboard glow.      |
| `--shadow-leaderboard-gold-text` | `0 0 5px ...`                  | First-place leaderboard text glow. |

## CSS Lint Rules

Stylelint is intentionally strict. New CSS should keep selectors shallow,
tokenized, and explicit:

- no raw hex, named colors, `rgb()`, `rgba()`, `hsl()`, or `hsla()` outside
  `tokens.css`;
- no unknown custom properties; cross-file shared values belong in `tokens.css`;
- no CSS `@import` rules or `http`/`https` URL schemes in CSS assets;
- no ID selectors, `!important`, type-qualified class selectors such as
  `button.secondary`, or selector specificity above `0,3,1`;
- no selector chains with more than three classes or more than two combinators;
- class names and custom properties must use lowercase kebab-case;
- no unscoped, descriptionless, invalid, or needless Stylelint disables;
- no vendor-prefixed properties except the configured `-webkit-user-select`
  compatibility exception.

## Working Rules

- Prefer changing an existing token value over overriding colors in component
  rules.
- Add a new token only when the UI has a distinct semantic role that is not
  covered by the existing set.
- Define active palette changes through the scene, material, and recipe data in
  `src/palette/defaults.ts`; keep the fallback declaration, required token list,
  target, and generated snapshot in sync.
- Name tokens by usage rather than by hue. Use `--color-accent-surface`, not
  `--color-teal-50`.
- Keep the core UI cool, dark, and low-saturation. Apart from
  destructive/error states, new saturated hues should be treated as product
  content rather than chrome.
- Keep legacy aliases in `tokens.css` only as migration aids. New code should
  use the semantic tokens above.
- Validate code changes with `./ci.sh`.
- Run `bun run check:palette` from `web/frontend` for a focused completeness,
  snapshot, calibration-distance, contrast, and state-separation check.
- For frontend visual checks, use `./locator.ts` to inspect affected rendered
  regions and generated screenshots.
