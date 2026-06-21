const state = {
  authenticated: false,
  me: null,
  sources: [],
  accounts: [],
  groups: [],
  selectedGroupId: null,
  daily: null,
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

function optionList(select, values, selected) {
  select.innerHTML = values
    .map((value) => `<option value="${escapeHTML(value.slug)}"${value.slug === selected ? " selected" : ""}>${escapeHTML(value.name)}</option>`)
    .join("");
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
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
  state.sources = [];
  state.accounts = [];
  state.groups = [];
  state.selectedGroupId = null;
  state.daily = null;
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
  await loadDaily();
  await loadProblems();
  await loadLeaderboard();
}

async function loadBase() {
  const [me, sources, accounts, groups] = await Promise.all([
    api("/api/me"),
    api("/api/sources"),
    api("/api/me/external-accounts"),
    api("/api/groups"),
  ]);
  state.me = me;
  state.sources = sources;
  state.accounts = accounts;
  state.groups = groups;
  if (!state.selectedGroupId && groups.length > 0) {
    state.selectedGroupId = groups[0].id;
  }
  renderIdentity();
  renderSources();
  renderAccounts();
  renderGroups();
}

async function loadDaily() {
  try {
    state.daily = await api("/api/me/daily");
  } catch (error) {
    state.daily = null;
  }
  renderDaily();
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
  if (scope === "daily" && state.daily) path = `/api/daily-sets/${state.daily.id}/leaderboard`;
  const rows = await api(path);
  renderLeaderboard(rows);
}

function renderIdentity() {
  $("identity").textContent = `${state.me.display_name} @${state.me.username}`;
  $("display-name").value = state.me.display_name;
}

function renderSources() {
  for (const id of ["daily-source", "problem-source", "account-source"]) {
    optionList($(id), state.sources, "codeforces");
  }
}

function renderAccounts() {
  $("accounts").innerHTML = state.accounts.length
    ? state.accounts.map((account) => `
      <div class="row">
        <div class="row-top">
          <div>
            <div class="title">${escapeHTML(account.external_handle)}</div>
            <div class="meta">${escapeHTML(account.source_name)} · ${escapeHTML(account.sync_status)}</div>
          </div>
          <div class="actions">
            <button class="secondary" onclick="verifyAccount('${account.id}')">Verify</button>
            <button class="secondary" onclick="syncAccount('${account.id}')">Sync</button>
          </div>
        </div>
      </div>
    `).join("")
    : `<div class="meta">No linked accounts</div>`;
}

function renderGroups() {
  $("groups").innerHTML = state.groups.length
    ? state.groups.map((group) => `
      <div class="row">
        <div class="row-top">
          <div>
            <div class="title">${escapeHTML(group.name)}</div>
            <div class="meta">${escapeHTML(group.visibility)} · ${escapeHTML(group.my_role || "viewer")}</div>
          </div>
          <button class="${group.id === state.selectedGroupId ? "" : "secondary"}" onclick="selectGroup('${group.id}')">
            ${group.id === state.selectedGroupId ? "Selected" : "Select"}
          </button>
        </div>
      </div>
    `).join("")
    : `<div class="meta">No groups yet</div>`;
}

function renderDaily() {
  const daily = state.daily;
  if (!daily) {
    $("daily").innerHTML = `<div class="meta">No daily generated for today</div>`;
    return;
  }
  $("daily").innerHTML = `
    <div class="row">
      <div class="row-top">
        <div>
          <div class="title">${escapeHTML(daily.title || "Daily Set")}</div>
          <div class="meta">${escapeHTML(daily.date)} · ${daily.items.length} problems</div>
        </div>
      </div>
    </div>
    ${daily.items.map((item) => problemHTML(item.problem, {
      prefix: `${item.position}. ${item.role} · ${item.points} pts`,
      dailySetId: daily.id,
    })).join("")}
  `;
}

function renderProblems() {
  $("problems").innerHTML = state.problems.map((problem) => problemHTML(problem)).join("");
}

function renderLeaderboard(rows) {
  $("leaderboard").innerHTML = rows.length
    ? rows.map((row) => `
      <div class="leaderboard-row">
        <div><strong>#${row.rank}</strong> ${escapeHTML(row.display_name)}</div>
        <div class="meta">${row.points} pts · ${row.solves} solves</div>
      </div>
    `).join("")
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
          <div class="meta">${escapeHTML(options.prefix || problem.source_slug)} · ${problem.rating || "unrated"} · ${escapeHTML(problem.external_id)} ${status}</div>
        </div>
        <button class="secondary" onclick="markSolved('${problem.id}', '${options.dailySetId || ""}')">Solve</button>
      </div>
      <div class="tag-list">${tags}</div>
    </div>
  `;
}

async function selectGroup(id) {
  state.selectedGroupId = id;
  renderGroups();
  await loadLeaderboard();
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
  await Promise.all([loadDaily(), loadProblems(), loadLeaderboard()]);
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

  $("daily-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    state.daily = await api("/api/me/dailies/generate", {
      method: "POST",
      body: JSON.stringify({
        source: $("daily-source").value,
        tags: tagsFromInput($("daily-tags").value),
        count: Number($("daily-count").value || 3),
        difficulty: { target_rating: Number($("daily-target").value || 1300) },
      }),
    });
    renderDaily();
    await loadLeaderboard();
    toast("Daily generated");
  });

  $("group-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const group = await api("/api/groups", {
      method: "POST",
      body: JSON.stringify({
        name: $("group-name").value,
        visibility: $("group-visibility").value,
      }),
    });
    state.selectedGroupId = group.id;
    $("group-name").value = "";
    await loadBase();
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
window.markSolved = markSolved;
window.verifyAccount = verifyAccount;
window.syncAccount = syncAccount;

boot();
