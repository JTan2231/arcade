import { useCallback, useEffect, useRef, useState } from "react";
import { useMachine } from "@xstate/react";

import { AuthView } from "./components/AuthView";
import { InviteJoinView } from "./components/InviteJoinView";
import { Toast } from "./components/Toast";
import { appMachine } from "./machines/appMachine";
import { groupPath, readAppRoute, type AppRoute } from "./routes";
import { PublicRouteAdapter } from "./workspace/PublicRouteAdapter";
import { WorkspaceShell } from "./workspace/WorkspaceShell";
import type { DashboardActorRef } from "./workspace/types";

export default function App() {
  const [route, setRoute] = useState<AppRoute>(() => readAppRoute());
  const [snapshot, send] = useMachine(appMachine);
  const { context } = snapshot;
  const dashboardRef = snapshot.children["dashboard"] as DashboardActorRef | undefined;
  const appNavigationPathRef = useRef<string | null>(null);

  const checkingSession = snapshot.matches("checkingSession");
  const signedOut = snapshot.matches("signedOut");
  const signedIn = snapshot.matches("signedIn");
  const loggingIn = snapshot.matches({ signedOut: "loggingIn" });
  const signingUp = snapshot.matches({ signedOut: "signingUp" });
  const publicRoute = typeof route === "object" && route.kind !== "invite" ? route : null;
  const inviteRoute = typeof route === "object" && route.kind === "invite" ? route : null;

  const setAppPath = useCallback((path: string, mode: "push" | "replace" = "push") => {
    if (window.location.pathname === path) {
      return;
    }
    appNavigationPathRef.current = path;
    if (mode === "replace") {
      window.history.replaceState(null, "", path);
    } else {
      window.history.pushState(null, "", path);
    }
    setRoute(readAppRoute());
  }, []);

  const requestToast = useCallback(
    (message: string) => {
      send({ type: "TOAST_REQUESTED", message });
    },
    [send],
  );

  const handleUnauthorized = useCallback(() => {
    send({ type: "UNAUTHORIZED" });
  }, [send]);

  useEffect(() => {
    function handlePopState() {
      appNavigationPathRef.current = null;
      setRoute(readAppRoute());
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (context.toastMessage === null) {
      return undefined;
    }

    const timer = window.setTimeout(() => send({ type: "TOAST_DISMISSED" }), 2400);
    return () => window.clearTimeout(timer);
  }, [context.toastMessage, send]);

  if (publicRoute !== null && !signedIn) {
    return (
      <>
        <PublicRouteAdapter onNavigate={setAppPath} route={publicRoute} signedIn={signedIn} />
        <Toast message={context.toastMessage} />
      </>
    );
  }

  if (checkingSession) {
    return (
      <>
        <main className="auth-layout">
          <section className="panel auth-panel" aria-label="Authentication">
            <div className="empty-state">Checking session...</div>
          </section>
        </main>
        <Toast message={context.toastMessage} />
      </>
    );
  }

  if (inviteRoute !== null) {
    return (
      <>
        <InviteJoinView
          authError={context.authError}
          authSubmitting={loggingIn || signingUp}
          currentUser={context.user}
          token={inviteRoute.token}
          onAccepted={(group) => {
            dashboardRef?.send({ type: "GROUPS_REFRESH_REQUESTED", preferredGroupId: group.id });
            setAppPath(groupPath(group), "replace");
          }}
          onClearAuthError={() => send({ type: "AUTH_ERROR_CLEARED" })}
          onLogin={(payload) => send({ type: "LOGIN_SUBMITTED", payload })}
          onSignup={(payload) => send({ type: "SIGNUP_SUBMITTED", payload })}
          onToast={requestToast}
          onUnauthorized={handleUnauthorized}
        />
        <Toast message={context.toastMessage} />
      </>
    );
  }

  if (signedOut) {
    return (
      <>
        <AuthView
          error={context.authError}
          submitting={loggingIn || signingUp}
          onClearError={() => send({ type: "AUTH_ERROR_CLEARED" })}
          onLogin={(payload) => send({ type: "LOGIN_SUBMITTED", payload })}
          onSignup={(payload) => send({ type: "SIGNUP_SUBMITTED", payload })}
        />
        <Toast message={context.toastMessage} />
      </>
    );
  }

  return (
    <>
      <WorkspaceShell
        dashboardRef={dashboardRef}
        currentUser={context.user}
        navigationPathRef={appNavigationPathRef}
        route={route}
        signedIn={signedIn}
        onNavigate={setAppPath}
        onLogout={() => send({ type: "LOGOUT_REQUESTED" })}
        onToast={requestToast}
        onUnauthorized={handleUnauthorized}
      />
      <Toast message={context.toastMessage} />
    </>
  );
}
