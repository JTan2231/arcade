const state = {
  authenticated: false,
  groups: [],
  selectedGroupId: null,
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

function selectGroup(id) {
  state.selectedGroupId = id;
  renderGroups();
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

boot();
