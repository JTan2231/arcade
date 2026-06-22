# UX

This document captures product and data-model direction for the group, source,
catalog item, and daily feed creation flows.

## Group Setup Model

A group is the permission and membership container. It can exist before a feed
exists, but a group without an enabled feed should be treated as unfinished setup
in the UI.

The home page should show the user's existing groups and a create group action.
The create group action should stay lightweight and require exactly one user
input: group name.

Group creation should default the rest:

- Slug is generated.
- Visibility defaults to invite-only.
- The creator is added as an active owner.
- Description, custom slug, visibility, and membership settings can live in
  group settings after creation.

## First-Run Flow

Recommended flow:

1. Home shows the user's groups and a create group action.
2. Create group asks only for group name.
3. After creation, the user lands on the group page.
4. If the group has no enabled feeds, the group page shows a setup state.
5. The setup state has one primary action: set up the first feed.
6. Feed setup requires selecting an existing source or creating a new source
   inline.
7. New source setup includes adding or importing enough valid catalog items for
   feed generation.
8. The user previews generated feed output and enables the feed.

## Setup Dependencies

The product dependency is:

```text
group -> feed -> source -> catalog items
```

The database does not need to enforce that every group has a feed. The UI should
enforce readiness: a group is not considered ready until it has at least one
enabled feed backed by valid source data.

A feed cannot be enabled unless it has at least one rule block referencing a
source with eligible catalog items. A source is valid for feed generation when it
has catalog items that can render with the source template. Items missing
required template variables are ineligible.

Creating or importing source data should feel like the normal branch of first
feed setup. Choosing an existing source should feel like an explicit shortcut for
the case where the user has already created usable source data.

## Minimum User Input

### Group

Required:

- Name.

Defaulted:

- Slug.
- Visibility.
- Membership settings.
- Creator owner membership.

### Feed

Required:

- Feed name, prefilled with `Daily Practice`.
- Source selection, either existing or newly created inline.

Defaulted:

- Audience: all group members.
- Schedule: daily UTC.
- Enabled: true after successful preview.
- Count: 3.

### Source

Required:

- Source name.
- Template, unless supplied by a preset.
- At least one valid catalog item before the source can back an enabled feed.

### Catalog Item

Required:

- Title.
- Any data fields referenced by the source template.

Optional:

- Rating.
- Tags.
- Other source-specific data used for filtering or rendering.

## Source Model

Users manage sources. A source is the semantic collection that feed items come
from, such as:

- Codeforces Problems
- Tekken Characters
- Interview Prompts
- Lunch Spots

Because the source is already the meaningful bucket, catalog item `kind` is
redundant and should be removed. A broad cross-source taxonomy is not needed for
the current product shape.

Sources should be owned inside the app, likely by a group:

```sql
catalog_sources
- id uuid primary key default gen_random_uuid()
- group_id uuid not null references groups(id) on delete cascade
- name text not null
- template text not null
- created_by_user_id uuid references users(id)
- created_at timestamptz not null default now()
- updated_at timestamptz not null default now()
```

The source template defines how selected items become generated feed output.
It is intentionally just a string. No output type is required yet.

If the rendered string starts with `https://`, the UI can present it as a link.
Otherwise the UI can present it as text or a prompt. More explicit output types
can be added later if the product needs them.

## Catalog Items

Catalog items are internal rows in a user-managed source. Users should not need
to provide stable IDs, external IDs, or item kinds.

```sql
catalog_items
- id uuid primary key default gen_random_uuid()
- source_id uuid not null references catalog_sources(id) on delete cascade
- title text not null
- data jsonb not null default '{}'
- created_at timestamptz not null default now()
- updated_at timestamptz not null default now()
```

Remove these concepts from catalog items:

- `external_id`
- `kind`
- source-specific URL locator fields as a separate top-level concept

The internal `id` remains as the database primary key. It is not user-authored.

`data` replaces `metadata`. The field carries both filterable values and
template variables. For example, `data.rating` and `data.tags` can be used for
feed filtering, while `data.contest_id`, `data.index`, `data.focus`, or
`data.drill` can be used to render the source template.

Catalog items should still avoid storing large copyrighted or answer-bearing
content such as statements, prompts from third-party problem providers, samples,
editorials, or solutions unless the app has explicit rights and a product reason
to store them.

## Template Rendering

Source templates use placeholders wrapped in braces:

```text
https://codeforces.com/problemset/problem/{contest_id}/{index}
Practice {title}. Focus on {focus}. Drill: {drill}.
```

Template values come from:

- `title`, always available from the catalog item title.
- Keys in the catalog item's `data` object.

Rendering should happen on demand during feed output generation. The final URL,
prompt, or text should not be stored on the item.

If an item is missing a value required by the source template, the item should
be treated as ineligible for feed generation. Preview and import tooling can
surface missing placeholders earlier, but generation should not emit partially
rendered strings.

## Codeforces Example

Source:

```json
{
  "name": "Codeforces Problems",
  "template": "https://codeforces.com/problemset/problem/{contest_id}/{index}"
}
```

Item:

```json
{
  "title": "Watermelon",
  "data": {
    "contest_id": "4",
    "index": "A",
    "rating": 800,
    "tags": ["math", "greedy"]
  }
}
```

Rendered output:

```text
https://codeforces.com/problemset/problem/4/A
```

For Codeforces, rating and provider tags are source-specific data conventions.
The core model does not need Codeforces-specific columns.

## Tekken Example

Source:

```json
{
  "name": "Tekken Characters",
  "template": "Practice {title}. Focus on {focus}. Drill: {drill}."
}
```

Item:

```json
{
  "title": "Jin Kazama",
  "data": {
    "focus": "electric execution and neutral control",
    "drill": "10 clean electrics from both sides",
    "tags": ["tekken-8", "mishima", "execution-heavy"]
  }
}
```

Rendered output:

```text
Practice Jin Kazama. Focus on electric execution and neutral control. Drill: 10 clean electrics from both sides.
```

This uses the same source and item model as Codeforces. The difference is only
the source template and item data conventions.

## Feed Creation

Feed creation should be about saving a rule definition, not materializing a
daily set. Feed outputs are generated on demand from the feed definition,
matching catalog items, and source templates.

Backend minimum:

- Feed name.
- At least one rule block.
- Each rule block needs source, count, and any desired filters.

Recommended first-feed UX:

1. Feed name, defaulted to `Daily Practice`.
2. Source step:
   - Choose an existing source.
   - Create a new source.
   - Import a source from a preset or CSV.
3. Rule step:
   - Count, defaulted to 3.
   - Difficulty target if the source uses numeric rating.
   - Optional tags.
4. Preview step:
   - Show generated output.
   - Show ineligible items and missing template variables.
5. Enable feed.

Everything else can default:

- Audience: all group members.
- Schedule: daily UTC.
- Enabled: true after successful preview.

Example feed rule:

```json
{
  "name": "Daily Practice",
  "rules": {
    "blocks": [
      {
        "source_id": "source-uuid",
        "count": 3,
        "filters": {
          "rating": { "min": 800, "max": 1400, "target": 1100 },
          "tags": { "include_any": ["dp"] }
        }
      }
    ]
  }
}
```

The current filter vocabulary can remain intentionally narrow:

- `data.rating` for numeric ranges and target sorting.
- `data.tags` for include/exclude tag matching.

More structured filters can be added later if sources need them.

## Source Setup UX

Creating the first feed should guide the user through source selection. The
default branch should be creating or importing source data, because a new group
usually does not have usable data yet.

Choosing an existing source should read as a shortcut: the user is skipping
source setup because they already have usable source data.

Creating a source should ask for:

- Source name.
- Template, unless supplied by a preset.

Adding items can start with a simple form or import:

- Title.
- Any data fields referenced by the source template.
- Optional data as structured JSON or mapped CSV columns.

For CSV import, every row should map to one catalog item. A `title` column is
required. All other columns become keys in `data`, with special handling for
common structured fields like `tags`.

Example Codeforces CSV:

```csv
title,contest_id,index,rating,tags
Watermelon,4,A,800,"math,greedy"
Way Too Long Words,71,A,800,strings
```

Example Tekken CSV:

```csv
title,focus,drill,tags
Jin Kazama,electric execution and neutral control,10 clean electrics from both sides,"tekken-8,mishima,execution-heavy"
King,throws and okizeme,practice chain throw starters and wall followups,"tekken-8,grappler"
```

Import preview should show:

- Parsed title.
- Parsed data.
- Rendered output using the source template.
- Missing template variables, if any.
