const state = {
  authenticated: false,
  me: null,
  providerSources: [],
  accounts: [],
  groups: [],
  selectedGroupId: null,
  groupSources: [],
  groupFeeds: [],
  dailyOutputs: [],
  setupOpen: false,
  setupMode: "create",
  setupSourceId: null,
  setupPreview: null,
  setupRules: null,
  setupFeedName: "Daily Practice",
  problems: [],
};

const $ = (id) => document.getElementById(id);

async function api(path, options = {}) {
  const { skipAuthRedirect = false, ...fetchOptions } = options;
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(fetchOptions.headers || {}) },
    ...fetchOptions,
  });
  if (response.status === 204) return null;
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 && !skipAuthRedirect) {
    showAuthView();
    throw new Error("Please sign in");
  }
  if (!response.ok) throw new Error(body.error || `Request failed: ${response.status}`);
  return body;
}

function toast(message) {
  const element = $("toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove("show"), 2400);
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function optionList(select, values, selected, valueKey = "slug") {
  select.innerHTML = values
    .map((value) => {
      const optionValue = value[valueKey];
      return `<option value="${escapeHTML(optionValue)}"${optionValue === selected ? " selected" : ""}>${escapeHTML(value.name)}</option>`;
    })
    .join("");
}

function tagsFromInput(value) {
  return value
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

function resetState() {
  state.authenticated = false;
  state.me = null;
  state.providerSources = [];
  state.accounts = [];
  state.groups = [];
  state.selectedGroupId = null;
  state.groupSources = [];
  state.groupFeeds = [];
  state.dailyOutputs = [];
  state.setupOpen = false;
  state.setupMode = "create";
  state.setupSourceId = null;
  state.setupPreview = null;
  state.setupRules = null;
  state.setupFeedName = "Daily Practice";
  state.problems = [];
}

function showAuthView(message = "") {
  resetState();
  $("app-header").hidden = true;
  $("app-layout").hidden = true;
  $("auth-view").hidden = false;
  $("auth-error").textContent = message;
}

function showAppView() {
  state.authenticated = true;
  $("auth-view").hidden = true;
  $("app-header").hidden = false;
  $("app-layout").hidden = false;
  $("auth-error").textContent = "";
}

function setAuthMode(mode) {
  const login = mode === "login";
  $("login-form").hidden = !login;
  $("signup-form").hidden = login;
  $("login-tab").classList.toggle("active", login);
  $("login-tab").classList.toggle("secondary", !login);
  $("signup-tab").classList.toggle("active", !login);
  $("signup-tab").classList.toggle("secondary", login);
  $("auth-error").textContent = "";
}

async function loadAppData() {
  await loadBase();
  await Promise.all([loadSelectedGroup(), loadDaily(), loadProblems(), loadLeaderboard()]);
}

async function loadBase() {
  const [me, providerSources, accounts, groups] = await Promise.all([
    api("/api/me"),
    api("/api/sources"),
    api("/api/me/external-accounts"),
    api("/api/groups"),
  ]);
  state.me = me;
  state.providerSources = providerSources;
  state.accounts = accounts;
  state.groups = groups;
  if (!state.selectedGroupId && groups.length > 0) {
    state.selectedGroupId = (groups.find((group) => group.my_status === "active") || groups[0]).id;
  }
  if (state.selectedGroupId && !groups.some((group) => group.id === state.selectedGroupId)) {
    state.selectedGroupId = groups[0]?.id || null;
  }
  renderIdentity();
  renderProviderSources();
  renderAccounts();
  renderGroups();
}

async function loadSelectedGroup() {
  if (!state.selectedGroupId) {
    state.groupSources = [];
    state.groupFeeds = [];
    renderWorkspace();
    return;
  }
  const [sources, feeds] = await Promise.all([
    api(`/api/groups/${state.selectedGroupId}/catalog-sources`),
    api(`/api/groups/${state.selectedGroupId}/daily-feeds`),
  ]);
  state.groupSources = sources;
  state.groupFeeds = feeds;
  renderGroups();
  renderWorkspace();
}

async function loadDaily() {
  try {
    state.dailyOutputs = await api("/api/me/daily-feed-outputs");
  } catch (error) {
    state.dailyOutputs = [];
  }
  renderWorkspace();
}

async function loadProblems() {
  const source = $("problem-source").value || "codeforces";
  const params = new URLSearchParams({ source, limit: "80" });
  const tag = $("problem-tag").value.trim();
  if (tag) params.set("tag", tag);
  if ($("problem-min").value) params.set("min_rating", $("problem-min").value);
  if ($("problem-max").value) params.set("max_rating", $("problem-max").value);
  state.problems = await api(`/api/problems?${params}`);
  renderProblems();
}

async function loadLeaderboard() {
  const scope = $("leaderboard-scope").value;
  let path = "/api/leaderboards";
  if (scope === "group" && state.selectedGroupId) path = `/api/groups/${state.selectedGroupId}/leaderboard`;
  const rows = await api(path);
  renderLeaderboard(rows);
}

function selectedGroup() {
  return state.groups.find((group) => group.id === state.selectedGroupId) || null;
}

function canManageGroup(group) {
  return group && (group.my_role === "owner" || group.my_role === "admin");
}

function renderIdentity() {
  $("identity").textContent = `${state.me.display_name} @${state.me.username}`;
  $("display-name").value = state.me.display_name;
}

function renderProviderSources() {
  for (const id of ["problem-source", "account-source"]) optionList($(id), state.providerSources, "codeforces");
}

function renderAccounts() {
  $("accounts").innerHTML = state.accounts.length
    ? state.accounts
        .map(
          (account) => `
      <div class="row">
        <div class="row-top">
          <div>
            <div class="title">${escapeHTML(account.external_handle)}</div>
            <div class="meta">${escapeHTML(account.source_name)} - ${escapeHTML(account.sync_status)}</div>
          </div>
          <div class="actions">
            <button class="secondary" onclick="verifyAccount('${account.id}')">Verify</button>
            <button class="secondary" onclick="syncAccount('${account.id}')">Sync</button>
          </div>
        </div>
      </div>
    `,
        )
        .join("")
    : `<div class="meta">No linked accounts</div>`;
}

function renderGroups() {
  $("groups").innerHTML = state.groups.length
    ? state.groups
        .map((group) => {
          const selected = group.id === state.selectedGroupId;
          return `
      <div class="row ${selected ? "selected-row" : ""}">
        <div class="row-top">
          <div>
            <div class="title">${escapeHTML(group.name)}</div>
            <div class="meta">${escapeHTML(group.visibility)} - ${escapeHTML(group.my_role || "viewer")}</div>
          </div>
          <button class="${selected ? "" : "secondary"}" onclick="selectGroup('${group.id}')">
            ${selected ? "Selected" : "Open"}
          </button>
        </div>
      </div>
    `;
        })
        .join("")
    : `<div class="meta">No groups yet</div>`;
}

function renderWorkspace() {
  const group = selectedGroup();
  if (!group) {
    $("group-workspace").innerHTML = `
      <div class="workspace-empty">
        <h2>Groups</h2>
        <div class="meta">Create a group to start setup</div>
      </div>
    `;
    return;
  }

  const manage = canManageGroup(group);
  const enabledFeeds = state.groupFeeds.filter((feed) => feed.enabled);
  const ready = enabledFeeds.length > 0;
  const outputs = state.dailyOutputs.filter((daily) => daily.group_id === group.id);

  $("group-workspace").innerHTML = `
    <div class="workspace-header">
      <div>
        <h2>${escapeHTML(group.name)}</h2>
        <div class="meta">${ready ? "Ready" : "Setup required"} - ${escapeHTML(group.visibility)} - ${escapeHTML(group.my_role || "viewer")}</div>
      </div>
      ${
        manage
          ? `<button type="button" onclick="startFeedSetup()">${ready || state.setupOpen ? "Set up feed" : "Set up first feed"}</button>`
          : ""
      }
    </div>
    ${
      !ready && !state.setupOpen
        ? `
      <div class="setup-state">
        <div>
          <div class="title">No enabled feeds</div>
          <div class="meta">This group is unfinished</div>
        </div>
        ${manage ? `<button type="button" onclick="startFeedSetup()">Set up first feed</button>` : ""}
      </div>
    `
        : ""
    }
    ${state.setupOpen ? setupFormHTML() : ""}
    ${renderDailyOutputSection(outputs)}
    ${renderSourcesSection()}
    ${renderFeedsSection()}
  `;
  bindSetupControls();
}

function renderDailyOutputSection(outputs) {
  if (!outputs.length) {
    return `
      <div class="section-block">
        <div class="section-title">Today</div>
        <div class="meta">No generated output</div>
      </div>
    `;
  }
  return `
    <div class="section-block">
      <div class="section-title">Today</div>
      <div class="stack">
        ${outputs
          .map(
            (daily) => `
          <div class="row">
            <div class="row-top">
              <div>
                <div class="title">${escapeHTML(daily.title || "Daily Feed")}</div>
                <div class="meta">${escapeHTML(daily.date)} - ${daily.items.length} items</div>
              </div>
            </div>
          </div>
          ${daily.items.map((item) => dailyFeedItemHTML(item)).join("")}
        `,
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderSourcesSection() {
  return `
    <div class="section-block">
      <div class="section-title">Sources</div>
      <div class="stack">
        ${
          state.groupSources.length
            ? state.groupSources
                .map(
                  (source) => `
            <div class="row">
              <div class="row-top">
                <div>
                  <div class="title">${escapeHTML(source.name)}</div>
                  <div class="meta">${source.eligible_item_count}/${source.item_count} eligible - ${escapeHTML(source.template)}</div>
                </div>
              </div>
            </div>
          `,
                )
                .join("")
            : `<div class="meta">No sources yet</div>`
        }
      </div>
    </div>
  `;
}

function renderFeedsSection() {
  return `
    <div class="section-block">
      <div class="section-title">Feeds</div>
      <div class="stack">
        ${
          state.groupFeeds.length
            ? state.groupFeeds
                .map(
                  (feed) => `
            <div class="row">
              <div class="row-top">
                <div>
                  <div class="title">${escapeHTML(feed.name)}</div>
                  <div class="meta">${feed.enabled ? "enabled" : "disabled"} - ${feed.rules.blocks.length} rule block</div>
                </div>
              </div>
            </div>
          `,
                )
                .join("")
            : `<div class="meta">No feeds yet</div>`
        }
      </div>
    </div>
  `;
}

function setupFormHTML() {
  const sourceOptions = state.groupSources
    .map((source) => `<option value="${escapeHTML(source.id)}">${escapeHTML(source.name)} (${source.eligible_item_count} eligible)</option>`)
    .join("");
  return `
    <form id="setup-form" class="setup-form">
      <div class="setup-grid">
        <label>
          Feed name
          <input id="setup-feed-name" value="${escapeHTML(state.setupFeedName || "Daily Practice")}" required>
        </label>
        <label>
          Source
          <select id="setup-source-mode">
            <option value="create"${state.setupMode === "create" ? " selected" : ""}>Create source</option>
            <option value="preset"${state.setupMode === "preset" ? " selected" : ""}>Codeforces preset</option>
            <option value="existing"${state.setupMode === "existing" ? " selected" : ""}>Existing source</option>
          </select>
        </label>
      </div>

      <div id="setup-create-section" class="setup-mode-section">
        <div class="setup-grid">
          <label>
            Source name
            <input id="setup-source-name" value="Practice Prompts" required>
          </label>
          <label class="wide-field">
            Template
            <input id="setup-source-template" value="Practice {title}. Focus on {focus}. Drill: {drill}." required>
          </label>
        </div>
        <div class="setup-grid">
          <label>
            Item title
            <input id="setup-item-title" placeholder="Jin Kazama">
          </label>
          <label>
            Rating
            <input id="setup-item-rating" type="number" step="100" placeholder="1200">
          </label>
          <label>
            Tags
            <input id="setup-item-tags" placeholder="execution, neutral">
          </label>
        </div>
        <div id="setup-field-grid" class="setup-grid"></div>
        <label>
          CSV import
          <textarea id="setup-csv" rows="4" placeholder="title,focus,drill,tags"></textarea>
        </label>
      </div>

      <div id="setup-preset-section" class="setup-mode-section">
        <div class="row">
          <div class="title">Codeforces Problems</div>
          <div class="meta">https://codeforces.com/problemset/problem/{contest_id}/{index}</div>
        </div>
      </div>

      <div id="setup-existing-section" class="setup-mode-section">
        <label>
          Existing source
          <select id="setup-existing-source">
            ${sourceOptions || `<option value="">No sources</option>`}
          </select>
        </label>
      </div>

      <div class="setup-grid">
        <label>
          Count
          <input id="setup-count" type="number" min="1" max="50" value="3">
        </label>
        <label>
          Target
          <input id="setup-target" type="number" min="1" step="100" placeholder="1100">
        </label>
        <label>
          Tags
          <input id="setup-tags" placeholder="dp, graphs">
        </label>
      </div>

      <div class="actions">
        <button type="submit">Preview feed</button>
        <button id="setup-enable" type="button" ${state.setupPreview ? "" : "disabled"}>Enable feed</button>
        <button class="secondary" type="button" onclick="cancelFeedSetup()">Cancel</button>
      </div>
      <div id="setup-preview" class="stack"></div>
    </form>
  `;
}

function bindSetupControls() {
  const form = $("setup-form");
  if (!form) return;
  form.addEventListener("submit", previewSetup);
  $("setup-source-mode").addEventListener("change", (event) => {
    state.setupMode = event.target.value;
    state.setupSourceId = null;
    state.setupPreview = null;
    state.setupRules = null;
    syncSetupMode();
    renderSetupPreview();
  });
  $("setup-source-template")?.addEventListener("input", updateTemplateFields);
  $("setup-enable").addEventListener("click", enableSetup);
  syncSetupMode();
  updateTemplateFields();
  renderSetupPreview();
}

function syncSetupMode() {
  const mode = $("setup-source-mode")?.value || state.setupMode;
  for (const name of ["create", "preset", "existing"]) {
    const section = $(`setup-${name}-section`);
    if (section) section.hidden = mode !== name;
  }
}

function updateTemplateFields() {
  const template = $("setup-source-template")?.value || "";
  const fields = templateFields(template).filter((field) => field !== "title");
  const grid = $("setup-field-grid");
  if (!grid) return;
  grid.innerHTML = fields
    .map(
      (field) => `
      <label>
        ${escapeHTML(field)}
        <input class="template-field" data-field="${escapeHTML(field)}" autocomplete="off">
      </label>
    `,
    )
    .join("");
}

function templateFields(template) {
  const fields = [];
  const seen = new Set();
  for (const match of template.matchAll(/\{([A-Za-z0-9_]+)\}/g)) {
    if (seen.has(match[1])) continue;
    seen.add(match[1]);
    fields.push(match[1]);
  }
  return fields;
}

async function previewSetup(event) {
  event.preventDefault();
  try {
    const sourceID = await ensureSetupSource();
    const rules = buildSetupRules(sourceID);
    const name = $("setup-feed-name").value.trim() || "Daily Practice";
    const preview = await api(`/api/groups/${state.selectedGroupId}/daily-feeds/preview`, {
      method: "POST",
      body: JSON.stringify({ name, rules }),
    });
    state.setupSourceId = sourceID;
    state.setupRules = rules;
    state.setupFeedName = name;
    state.setupPreview = preview;
    renderSetupPreview();
    toast("Preview ready");
  } catch (error) {
    toast(error.message);
  }
}

async function ensureSetupSource() {
  const mode = $("setup-source-mode").value;
  if (mode === "existing") {
    const sourceID = $("setup-existing-source").value;
    if (!sourceID) throw new Error("Select a source");
    return sourceID;
  }
  if (state.setupSourceId) return state.setupSourceId;

  if (mode === "preset") {
    const existing = state.groupSources.find((source) => source.name === "Codeforces Problems");
    if (existing) {
      state.setupSourceId = existing.id;
      return existing.id;
    }
    const source = await api(`/api/groups/${state.selectedGroupId}/catalog-sources`, {
      method: "POST",
      body: JSON.stringify({ preset: "codeforces" }),
    });
    state.groupSources.push(source);
    state.setupSourceId = source.id;
    return source.id;
  }

  const items = collectSetupItems();
  if (!items.length) throw new Error("Add at least one item");
  const source = await api(`/api/groups/${state.selectedGroupId}/catalog-sources`, {
    method: "POST",
    body: JSON.stringify({
      name: $("setup-source-name").value,
      template: $("setup-source-template").value,
      items,
    }),
  });
  state.groupSources.push(source);
  state.setupSourceId = source.id;
  return source.id;
}

function collectSetupItems() {
  const csv = $("setup-csv").value.trim();
  if (csv) return csvRowsToItems(parseCSV(csv));

  const title = $("setup-item-title").value.trim();
  if (!title) return [];
  const data = {};
  for (const input of document.querySelectorAll(".template-field")) {
    const value = input.value.trim();
    if (value) data[input.dataset.field] = coerceValue(input.dataset.field, value);
  }
  const rating = $("setup-item-rating").value;
  if (rating) data.rating = Number(rating);
  const tags = tagsFromInput($("setup-item-tags").value);
  if (tags.length) data.tags = tags;
  return [{ title, data }];
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted && char === '"' && next === '"') {
      value += '"';
      index++;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && char === ",") {
      row.push(value);
      value = "";
      continue;
    }
    if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") index++;
      row.push(value);
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      value = "";
      continue;
    }
    value += char;
  }
  row.push(value);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  return rows;
}

function csvRowsToItems(rows) {
  if (rows.length < 2) throw new Error("CSV needs a header and at least one row");
  const headers = rows[0].map((header) => header.trim());
  const titleIndex = headers.indexOf("title");
  if (titleIndex < 0) throw new Error("CSV needs a title column");
  return rows.slice(1).map((row) => {
    const title = (row[titleIndex] || "").trim();
    if (!title) throw new Error("CSV rows need titles");
    const data = {};
    headers.forEach((header, index) => {
      if (!header || header === "title") return;
      const raw = (row[index] || "").trim();
      if (!raw) return;
      data[header] = coerceValue(header, raw);
    });
    return { title, data };
  });
}

function coerceValue(key, raw) {
  if (key === "tags") return tagsFromInput(raw);
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

function buildSetupRules(sourceID) {
  const filters = {};
  const target = $("setup-target").value;
  if (target) {
    const numericTarget = Number(target);
    filters.rating = {
      min: numericTarget - 500,
      max: numericTarget + 500,
      target: numericTarget,
    };
  }
  const tags = tagsFromInput($("setup-tags").value);
  if (tags.length) filters.tags = { include_any: tags };
  return {
    blocks: [
      {
        source_id: sourceID,
        count: Number($("setup-count").value || 3),
        filters,
      },
    ],
  };
}

function renderSetupPreview() {
  const container = $("setup-preview");
  if (!container) return;
  const enable = $("setup-enable");
  if (enable) enable.disabled = !state.setupPreview;
  if (!state.setupPreview) {
    container.innerHTML = "";
    return;
  }
  const preview = state.setupPreview;
  container.innerHTML = `
    <div class="section-title">Preview</div>
    ${preview.output.items.map((item) => dailyFeedItemHTML(item)).join("")}
    ${
      preview.ineligible_items.length
        ? `
      <div class="section-title">Ineligible</div>
      ${preview.ineligible_items
        .map(
          (item) => `
        <div class="row">
          <div class="title">${escapeHTML(item.title)}</div>
          <div class="meta">Missing ${escapeHTML(item.missing_fields.join(", "))}</div>
        </div>
      `,
        )
        .join("")}
    `
        : ""
    }
  `;
}

async function enableSetup() {
  try {
    if (!state.setupPreview || !state.setupRules) {
      await previewSetup(new Event("submit"));
      if (!state.setupPreview || !state.setupRules) return;
    }
    await api(`/api/groups/${state.selectedGroupId}/daily-feeds`, {
      method: "POST",
      body: JSON.stringify({
        name: state.setupFeedName || "Daily Practice",
        enabled: true,
        rules: state.setupRules,
      }),
    });
    state.setupOpen = false;
    state.setupSourceId = null;
    state.setupPreview = null;
    state.setupRules = null;
    await Promise.all([loadSelectedGroup(), loadDaily(), loadLeaderboard()]);
    toast("Daily feed enabled");
  } catch (error) {
    toast(error.message);
  }
}

function startFeedSetup() {
  state.setupOpen = true;
  state.setupPreview = null;
  state.setupRules = null;
  state.setupSourceId = null;
  state.setupMode = "create";
  state.setupFeedName = "Daily Practice";
  renderWorkspace();
}

function cancelFeedSetup() {
  state.setupOpen = false;
  state.setupPreview = null;
  state.setupRules = null;
  state.setupSourceId = null;
  renderWorkspace();
}

function renderProblems() {
  $("problems").innerHTML = state.problems.map((problem) => problemHTML(problem)).join("");
}

function renderLeaderboard(rows) {
  $("leaderboard").innerHTML = rows.length
    ? rows
        .map(
          (row) => `
      <div class="leaderboard-row">
        <div><strong>#${row.rank}</strong> ${escapeHTML(row.display_name)}</div>
        <div class="meta">${row.points} pts - ${row.solves} solves</div>
      </div>
    `,
        )
        .join("")
    : `<div class="meta">No rows yet</div>`;
}

function problemHTML(problem, options = {}) {
  const tags = (problem.tags || []).map((tag) => `<span class="tag">${escapeHTML(tag)}</span>`).join("");
  const status = problem.solved_by_me ? `<span class="status">Solved</span>` : "";
  return `
    <div class="problem-row">
      <div class="problem-top">
        <div>
          <div class="title"><a href="${escapeHTML(problem.url)}" target="_blank" rel="noreferrer">${escapeHTML(problem.title)}</a></div>
          <div class="meta">${escapeHTML(options.prefix || problem.source_slug)} - ${problem.rating || "unrated"} - ${escapeHTML(problem.external_id)} ${status}</div>
        </div>
        <button class="secondary" onclick="markSolved('${problem.id}', '${options.dailySetId || ""}')">Solve</button>
      </div>
      <div class="tag-list">${tags}</div>
    </div>
  `;
}

function dailyFeedItemHTML(entry) {
  const item = entry.item;
  const data = item.data || {};
  const tags = (data.tags || []).map((tag) => `<span class="tag">${escapeHTML(tag)}</span>`).join("");
  const rating = data.rating || "unrated";
  const action = entry.action || {};
  const actionHTML =
    action.type === "external_url"
      ? `<a class="button-link secondary" href="${escapeHTML(action.url)}" target="_blank" rel="noreferrer">${escapeHTML(action.label || "Open")}</a>`
      : "";
  const promptHTML = action.type === "text" ? `<div class="prompt-output">${escapeHTML(action.text)}</div>` : "";
  return `
    <div class="problem-row">
      <div class="problem-top">
        <div>
          <div class="title">${escapeHTML(item.title)}</div>
          <div class="meta">${entry.position}. ${escapeHTML(entry.role)} - ${entry.points} pts - ${escapeHTML(item.source_name)} - ${escapeHTML(rating)}</div>
          <div class="meta">${escapeHTML(entry.reason)}</div>
        </div>
        ${actionHTML}
      </div>
      ${promptHTML}
      <div class="tag-list">${tags}</div>
    </div>
  `;
}

async function selectGroup(id) {
  state.selectedGroupId = id;
  state.setupOpen = false;
  state.setupSourceId = null;
  state.setupPreview = null;
  state.setupRules = null;
  renderGroups();
  await Promise.all([loadSelectedGroup(), loadDaily(), loadLeaderboard()]);
}

async function markSolved(problemId, dailySetId = "") {
  await api("/api/submissions/manual", {
    method: "POST",
    body: JSON.stringify({
      problem_id: problemId,
      verdict: "manual_solve",
      daily_set_id: dailySetId || undefined,
    }),
  });
  toast("Solve recorded");
  await Promise.all([loadProblems(), loadLeaderboard()]);
}

async function verifyAccount(id) {
  await api(`/api/me/external-accounts/${id}/verify`, { method: "POST", body: "{}" });
  state.accounts = await api("/api/me/external-accounts");
  renderAccounts();
}

async function syncAccount(id) {
  await api(`/api/me/external-accounts/${id}/sync`, { method: "POST", body: "{}" });
  state.accounts = await api("/api/me/external-accounts");
  renderAccounts();
}

function bindForms() {
  $("login-tab").addEventListener("click", () => setAuthMode("login"));
  $("signup-tab").addEventListener("click", () => setAuthMode("signup"));

  $("login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      state.me = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: $("login-email").value,
          password: $("login-password").value,
          remember_me: $("login-remember").checked,
        }),
        skipAuthRedirect: true,
      });
      showAppView();
      try {
        await loadAppData();
        toast("Signed in");
      } catch (loadError) {
        if (state.authenticated) toast(loadError.message);
      }
    } catch (error) {
      $("auth-error").textContent = error.message;
    }
  });

  $("signup-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      state.me = await api("/api/auth/signup", {
        method: "POST",
        body: JSON.stringify({
          email: $("signup-email").value,
          password: $("signup-password").value,
          display_name: $("signup-display-name").value,
          remember_me: $("signup-remember").checked,
        }),
        skipAuthRedirect: true,
      });
      showAppView();
      try {
        await loadAppData();
        toast("Account created");
      } catch (loadError) {
        if (state.authenticated) toast(loadError.message);
      }
    } catch (error) {
      $("auth-error").textContent = error.message;
    }
  });

  $("logout").addEventListener("click", async () => {
    try {
      await api("/api/auth/logout", { method: "POST", body: "{}", skipAuthRedirect: true });
    } finally {
      showAuthView();
      toast("Signed out");
    }
  });

  $("refresh").addEventListener("click", async () => {
    await loadAppData();
    toast("Refreshed");
  });

  $("profile-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    state.me = await api("/api/me", {
      method: "PATCH",
      body: JSON.stringify({ display_name: $("display-name").value }),
    });
    renderIdentity();
    toast("Profile saved");
  });

  $("group-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const group = await api("/api/groups", {
      method: "POST",
      body: JSON.stringify({
        name: $("group-name").value,
      }),
    });
    state.selectedGroupId = group.id;
    $("group-name").value = "";
    await loadBase();
    await loadSelectedGroup();
    toast("Group created");
  });

  $("problem-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    await loadProblems();
  });

  $("account-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    await api("/api/me/external-accounts", {
      method: "POST",
      body: JSON.stringify({
        source: $("account-source").value,
        external_handle: $("account-handle").value,
      }),
    });
    $("account-handle").value = "";
    state.accounts = await api("/api/me/external-accounts");
    renderAccounts();
    toast("Account linked");
  });

  $("leaderboard-scope").addEventListener("change", loadLeaderboard);
}

async function boot() {
  bindForms();
  setAuthMode("login");
  try {
    state.me = await api("/api/auth/session", { skipAuthRedirect: true });
  } catch (error) {
    showAuthView();
    return;
  }

  showAppView();
  try {
    await loadAppData();
  } catch (error) {
    if (state.authenticated) toast(error.message);
  }
}

window.selectGroup = selectGroup;
window.startFeedSetup = startFeedSetup;
window.cancelFeedSetup = cancelFeedSetup;
window.syncSetupMode = syncSetupMode;
window.updateTemplateFields = updateTemplateFields;
window.markSolved = markSolved;
window.verifyAccount = verifyAccount;
window.syncAccount = syncAccount;

boot();
