const state = {
  authenticated: false,
  groups: [],
  selectedGroupId: null,
  groupFeeds: [],
  groupFeedsLoading: false,
  groupFeedsError: "",
  selectedFeedId: null,
  selectedFeedDate: todayDateValue(),
  selectedFeedOutput: null,
  feedOutputLoading: false,
  feedOutputError: "",
  groupRequestId: 0,
  feedOutputRequestId: 0,
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

function resetState() {
  state.authenticated = false;
  state.groups = [];
  state.selectedGroupId = null;
  state.groupFeeds = [];
  state.groupFeedsLoading = false;
  state.groupFeedsError = "";
  state.selectedFeedId = null;
  state.selectedFeedDate = todayDateValue();
  state.selectedFeedOutput = null;
  state.feedOutputLoading = false;
  state.feedOutputError = "";
  state.groupRequestId += 1;
  state.feedOutputRequestId += 1;
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
  const groups = await api("/api/groups");
  state.groups = groups;

  if (!state.selectedGroupId && groups.length > 0) {
    state.selectedGroupId = (groups.find((group) => group.my_status === "active") || groups[0]).id;
  }
  if (state.selectedGroupId && !groups.some((group) => group.id === state.selectedGroupId)) {
    state.selectedGroupId = groups[0]?.id || null;
  }

  renderGroups();
  await loadSelectedGroupDashboard();
}

function renderGroups() {
  $("groups").innerHTML = state.groups.length
    ? state.groups
        .map((group) => {
          const selected = group.id === state.selectedGroupId;
          const role = group.my_role || "viewer";
          const status = group.my_status ? ` - ${group.my_status}` : "";
          return `
      <div class="row ${selected ? "selected-row" : ""}">
        <div class="row-top">
          <div>
            <div class="title">${escapeHTML(group.name)}</div>
            <div class="meta">${escapeHTML(group.visibility)} - ${escapeHTML(role)}${escapeHTML(status)}</div>
          </div>
          <button class="${selected ? "" : "secondary"}" type="button" onclick="selectGroup('${group.id}')">
            ${selected ? "Selected" : "Open"}
          </button>
        </div>
      </div>
    `;
        })
        .join("")
    : `<div class="meta">No groups yet</div>`;
}

async function selectGroup(id) {
  state.selectedGroupId = id;
  state.groupFeeds = [];
  state.groupFeedsError = "";
  state.selectedFeedId = null;
  state.selectedFeedDate = todayDateValue();
  state.selectedFeedOutput = null;
  state.feedOutputError = "";
  renderGroups();
  renderGroupDashboard();
  await loadSelectedGroupDashboard();
}

function selectedGroup() {
  return state.groups.find((group) => group.id === state.selectedGroupId) || null;
}

function selectedFeed() {
  return state.groupFeeds.find((feed) => feed.id === state.selectedFeedId) || null;
}

function canManageGroup(group) {
  return group?.my_status === "active" && (group.my_role === "owner" || group.my_role === "admin");
}

async function loadSelectedGroupDashboard() {
  const group = selectedGroup();
  const requestId = ++state.groupRequestId;
  state.feedOutputRequestId += 1;
  state.groupFeeds = [];
  state.groupFeedsError = "";
  state.selectedFeedId = null;
  state.selectedFeedOutput = null;
  state.feedOutputError = "";
  state.groupFeedsLoading = Boolean(group);
  state.feedOutputLoading = false;
  renderGroupDashboard();

  if (!group) {
    state.groupFeedsLoading = false;
    renderGroupDashboard();
    return;
  }

  try {
    const feeds = await api(`/api/groups/${encodeURIComponent(group.id)}/daily-feeds`);
    if (requestId !== state.groupRequestId) return;

    state.groupFeeds = feeds;
    state.groupFeedsLoading = false;
    state.selectedFeedId = feeds[0]?.id || null;
    state.selectedFeedDate = todayDateValue();
    renderGroupDashboard();

    if (state.selectedFeedId) {
      await loadSelectedFeedOutput({ useToday: true });
    }
  } catch (error) {
    if (requestId !== state.groupRequestId) return;
    state.groupFeeds = [];
    state.groupFeedsLoading = false;
    state.groupFeedsError = error.message;
    renderGroupDashboard();
  }
}

async function selectFeed(id) {
  if (state.selectedFeedId === id && state.selectedFeedOutput) return;
  state.selectedFeedId = id;
  state.selectedFeedDate = todayDateValue();
  state.selectedFeedOutput = null;
  state.feedOutputError = "";
  renderGroupDashboard();
  await loadSelectedFeedOutput({ useToday: true });
}

async function changeFeedDate(value) {
  state.selectedFeedDate = value;
  state.selectedFeedOutput = null;
  state.feedOutputError = "";
  renderGroupDashboard();
  await loadSelectedFeedOutput();
}

async function loadSelectedFeedOutput({ useToday = false } = {}) {
  const group = selectedGroup();
  const feed = selectedFeed();
  if (!group || !feed) {
    renderGroupDashboard();
    return;
  }

  const requestId = ++state.feedOutputRequestId;
  state.feedOutputLoading = true;
  state.feedOutputError = "";
  state.selectedFeedOutput = null;
  renderGroupDashboard();

  const path = useToday
    ? `/api/groups/${encodeURIComponent(group.id)}/daily-feeds/${encodeURIComponent(feed.id)}/today`
    : `/api/groups/${encodeURIComponent(group.id)}/daily-feeds/${encodeURIComponent(feed.id)}/outputs/${encodeURIComponent(state.selectedFeedDate)}`;

  try {
    const output = await api(path);
    if (requestId !== state.feedOutputRequestId) return;
    state.selectedFeedOutput = output;
    state.selectedFeedDate = output.date || state.selectedFeedDate;
    state.feedOutputLoading = false;
    renderGroupDashboard();
  } catch (error) {
    if (requestId !== state.feedOutputRequestId) return;
    state.feedOutputError = error.message;
    state.feedOutputLoading = false;
    renderGroupDashboard();
  }
}

function renderGroupDashboard() {
  const target = $("group-dashboard");
  const group = selectedGroup();
  if (!group) {
    target.innerHTML = `
      <div class="empty-state">
        <div class="title">No group selected</div>
        <div class="meta">Create or open a group to view feeds.</div>
      </div>
    `;
    return;
  }

  const manage = canManageGroup(group);
  const feed = selectedFeed();
  const role = group.my_role || "viewer";
  const status = group.my_status || "not joined";

  target.innerHTML = `
    <div class="dashboard-header">
      <div>
        <h2>${escapeHTML(group.name)}</h2>
        <div class="meta">${escapeHTML(group.visibility)} - ${escapeHTML(role)} - ${escapeHTML(status)}</div>
      </div>
    </div>

    <div class="dashboard-grid">
      <section class="dashboard-section feeds-section">
        <div class="section-header">
          <h3>Feeds</h3>
        </div>
        ${renderFeedList(manage)}
      </section>

      <section class="dashboard-section feed-output-section">
        <div class="section-header output-header">
          <div>
            <h3>${feed ? escapeHTML(feed.name) : "Feed output"}</h3>
            ${feed ? `<div class="meta">${escapeHTML(describeFeed(feed))}</div>` : ""}
          </div>
          ${feed ? renderFeedDateSelect() : ""}
        </div>
        ${feed && manage ? renderFeedManagement(feed) : ""}
        ${renderFeedOutput(feed)}
      </section>
    </div>
  `;
}

function renderFeedList(manage) {
  if (state.groupFeedsLoading) {
    return `<div class="empty-state">Loading feeds...</div>`;
  }
  if (state.groupFeedsError) {
    return `<div class="form-error" role="alert">${escapeHTML(state.groupFeedsError)}</div>`;
  }
  if (!state.groupFeeds.length) {
    const message = manage ? "No feeds yet." : "No feeds are available for this group.";
    return `<div class="empty-state">${escapeHTML(message)}</div>`;
  }

  return `
    <div class="stack">
      ${state.groupFeeds.map((feed) => renderFeedRow(feed, manage)).join("")}
    </div>
  `;
}

function renderFeedRow(feed, manage) {
  const selected = feed.id === state.selectedFeedId;
  const enabled = feed.enabled ? "Enabled" : "Disabled";
  return `
    <div class="row feed-row ${selected ? "selected-row" : ""}">
      <div class="row-top feed-row-top">
        <div>
          <div class="title">${escapeHTML(feed.name)}</div>
          <div class="meta">${escapeHTML(enabled)} - ${escapeHTML(describeAudience(feed.audience))}</div>
          <div class="meta">${escapeHTML(describeSchedule(feed.schedule))}</div>
        </div>
        <div class="button-group">
          <button class="${selected ? "" : "secondary"}" type="button" onclick="${manage ? "manageFeed" : "selectFeed"}('${feed.id}')">
            ${selected ? "Selected" : manage ? "Manage" : "View"}
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderFeedDateSelect() {
  const options = feedDateOptions();
  return `
    <label class="date-control">
      Date
      <select onchange="changeFeedDate(this.value)">
        ${options
          .map((option) => `<option value="${escapeHTML(option.value)}" ${option.value === state.selectedFeedDate ? "selected" : ""}>${escapeHTML(option.label)}</option>`)
          .join("")}
      </select>
    </label>
  `;
}

function renderFeedManagement(feed) {
  return `
    <div class="management-strip">
      <div>
        <div class="title">Feed management</div>
        <div class="meta">${feed.enabled ? "Enabled" : "Disabled"}</div>
      </div>
      <button class="secondary" type="button" onclick="toggleFeedEnabled('${feed.id}')">
        ${feed.enabled ? "Disable" : "Enable"}
      </button>
    </div>
  `;
}

function renderFeedOutput(feed) {
  if (!feed) {
    return `<div class="empty-state">Select a feed to view its daily output.</div>`;
  }
  if (state.feedOutputLoading) {
    return `<div class="empty-state">Loading output...</div>`;
  }
  if (state.feedOutputError) {
    return `<div class="form-error" role="alert">${escapeHTML(state.feedOutputError)}</div>`;
  }
  if (!state.selectedFeedOutput) {
    return `<div class="empty-state">No output loaded.</div>`;
  }
  if (!state.selectedFeedOutput.items?.length) {
    return `<div class="empty-state">No generated items for ${escapeHTML(state.selectedFeedOutput.date)}.</div>`;
  }

  return `
    <div class="output-summary">
      <div class="title">${escapeHTML(state.selectedFeedOutput.title)}</div>
      <div class="meta">${escapeHTML(formatDateLabel(state.selectedFeedOutput.date))}</div>
    </div>
    <div class="stack output-items">
      ${state.selectedFeedOutput.items.map(renderOutputItem).join("")}
    </div>
  `;
}

function renderOutputItem(item) {
  const catalogItem = item.item || {};
  const data = catalogItem.data || {};
  const rating = data.rating ? `Rating ${data.rating}` : "";
  const tags = Array.isArray(data.tags) ? data.tags.slice(0, 4).join(", ") : "";
  const details = [catalogItem.source_name, rating, tags].filter(Boolean).join(" - ");
  return `
    <div class="row output-item">
      <div class="output-item-main">
        <div class="item-position">${escapeHTML(item.position)}</div>
        <div>
          <div class="title">${escapeHTML(catalogItem.title || "Untitled")}</div>
          <div class="meta">${escapeHTML(details)}</div>
          <div class="meta">${escapeHTML(item.reason || "")}</div>
        </div>
      </div>
      <div class="output-item-side">
        <span class="pill">${escapeHTML(item.role || "target")}</span>
        <span class="pill">${escapeHTML(item.points || 0)} pts</span>
        ${renderOutputAction(item.action)}
      </div>
    </div>
  `;
}

function renderOutputAction(action = {}) {
  if (action.type === "external_url" && action.url) {
    return `<a class="button-link" href="${escapeHTML(action.url)}" target="_blank" rel="noreferrer">${escapeHTML(action.label || "Open")}</a>`;
  }
  if (action.type === "text" && action.text) {
    return `
      <details class="prompt-details">
        <summary>${escapeHTML(action.label || "Prompt")}</summary>
        <pre>${escapeHTML(action.text)}</pre>
      </details>
    `;
  }
  return "";
}

function describeFeed(feed) {
  return [describeFeedKind(feed.kind), describeAudience(feed.audience), describeSchedule(feed.schedule)].filter(Boolean).join(" - ");
}

function describeFeedKind(kind) {
  if (kind === "daily_thread") return "Daily thread";
  return "Catalog daily";
}

function describeAudience(audience = {}) {
  if (audience.type === "division") return "Division audience";
  return "All members";
}

function describeSchedule(schedule = {}) {
  const cadence = schedule.cadence || "daily";
  const timezone = schedule.timezone || "UTC";
  return `${cadence} in ${timezone}`;
}

function feedDateOptions() {
  const options = [];
  const today = new Date();
  for (let offset = 0; offset < 14; offset += 1) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset);
    const value = formatDateValue(date);
    options.push({ value, label: formatDateLabel(value) });
  }
  if (state.selectedFeedDate && !options.some((option) => option.value === state.selectedFeedDate)) {
    options.unshift({ value: state.selectedFeedDate, label: formatDateLabel(state.selectedFeedDate) });
  }
  return options;
}

function todayDateValue() {
  return formatDateValue(new Date());
}

function formatDateValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateLabel(value) {
  const today = todayDateValue();
  const yesterday = formatDateValue(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() - 1));
  if (value === today) return `Today (${value})`;
  if (value === yesterday) return `Yesterday (${value})`;
  return value;
}

async function manageFeed(id) {
  await selectFeed(id);
}

async function toggleFeedEnabled(id) {
  const group = selectedGroup();
  const feed = state.groupFeeds.find((candidate) => candidate.id === id);
  if (!group || !feed) return;

  try {
    const updated = await api(`/api/groups/${encodeURIComponent(group.id)}/daily-feeds/${encodeURIComponent(feed.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled: !feed.enabled }),
    });
    state.groupFeeds = state.groupFeeds.map((candidate) => (candidate.id === updated.id ? updated : candidate));
    state.selectedFeedId = updated.id;
    renderGroupDashboard();
    toast(updated.enabled ? "Feed enabled" : "Feed disabled");
  } catch (error) {
    toast(error.message);
  }
}

function bindForms() {
  $("login-tab").addEventListener("click", () => setAuthMode("login"));
  $("signup-tab").addEventListener("click", () => setAuthMode("signup"));

  $("login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: $("login-email").value,
          password: $("login-password").value,
          remember_me: $("login-remember").checked,
        }),
        skipAuthRedirect: true,
      });
      showAppView();
      await loadAppData();
      toast("Signed in");
    } catch (error) {
      $("auth-error").textContent = error.message;
    }
  });

  $("signup-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/auth/signup", {
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
      await loadAppData();
      toast("Account created");
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

  $("group-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const group = await api("/api/groups", {
        method: "POST",
        body: JSON.stringify({
          name: $("group-name").value,
        }),
      });
      state.selectedGroupId = group.id;
      $("group-name").value = "";
      await loadAppData();
      toast("Group created");
    } catch (error) {
      toast(error.message);
    }
  });
}

async function boot() {
  bindForms();
  setAuthMode("login");
  try {
    await api("/api/auth/session", { skipAuthRedirect: true });
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
window.selectFeed = selectFeed;
window.changeFeedDate = changeFeedDate;
window.manageFeed = manageFeed;
window.toggleFeedEnabled = toggleFeedEnabled;

boot();
