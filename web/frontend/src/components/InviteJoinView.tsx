import { useEffect, useMemo, useState } from "react";

import { acceptInviteLink, getInviteLinkPreview, isUnauthorized } from "../api";
import { queryCache } from "../cache/queryCache";
import { errorMessage } from "../errors";
import type { Group, GroupInviteLinkPreview, LoginRequest, SignupRequest, User } from "../types";
import { AuthView } from "./AuthView";

type InviteAvailability = "active" | "expired" | "revoked" | "full";

export function InviteJoinView({
  token,
  currentUser,
  authError,
  authSubmitting,
  onAccepted,
  onClearAuthError,
  onLogin,
  onSignup,
  onToast,
  onUnauthorized,
}: {
  token: string;
  currentUser: User | null;
  authError: string;
  authSubmitting: boolean;
  onAccepted: (group: Group) => void;
  onClearAuthError: () => void;
  onLogin: (payload: LoginRequest) => void;
  onSignup: (payload: SignupRequest) => void;
  onToast: (message: string) => void;
  onUnauthorized: () => void;
}) {
  const [preview, setPreview] = useState<GroupInviteLinkPreview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const availability = useMemo(() => (preview === null ? null : inviteAvailability(preview)), [preview]);

  useEffect(() => {
    const controller = new AbortController();
    setLoadingPreview(true);
    setPreviewError("");
    void getInviteLinkPreview(token, { signal: controller.signal })
      .then((nextPreview) => {
        if (!controller.signal.aborted) {
          setPreview(nextPreview);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setPreviewError(errorMessage(error));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoadingPreview(false);
        }
      });
    return () => controller.abort();
  }, [token]);

  function handleAccept() {
    if (currentUser === null || preview === null || availability !== "active") {
      return;
    }
    const currentUserId = currentUser.id;
    setAccepting(true);
    void acceptInviteLink(token)
      .then((group) => {
        queryCache.touched(["user", currentUserId, "groups"]);
        onToast("Joined group");
        onAccepted(group);
      })
      .catch((error) => {
        if (isUnauthorized(error)) {
          onUnauthorized();
          return;
        }
        setPreviewError(errorMessage(error));
      })
      .finally(() => setAccepting(false));
  }

  const intro = (
    <InvitePreview
      availability={availability}
      error={previewError}
      loading={loadingPreview}
      preview={preview}
      signedIn={currentUser !== null}
    />
  );

  if (currentUser === null) {
    return (
      <AuthView
        error={authError}
        intro={intro}
        submitting={authSubmitting}
        onClearError={onClearAuthError}
        onLogin={onLogin}
        onSignup={onSignup}
      />
    );
  }

  return (
    <main className="auth-layout invite-join-layout">
      <section className="panel auth-panel invite-join-panel" aria-label="Invite link">
        {intro}
        <button
          type="button"
          disabled={preview === null || availability !== "active" || accepting}
          onClick={handleAccept}
        >
          Join group
        </button>
      </section>
    </main>
  );
}

function InvitePreview({
  availability,
  error,
  loading,
  preview,
  signedIn,
}: {
  availability: InviteAvailability | null;
  error: string;
  loading: boolean;
  preview: GroupInviteLinkPreview | null;
  signedIn: boolean;
}) {
  if (loading) {
    return <div className="empty-state">Loading invite...</div>;
  }
  if (error !== "") {
    return (
      <div className="invite-preview">
        <h1>Invite link</h1>
        <div className="form-error" role="alert">
          {error}
        </div>
      </div>
    );
  }
  if (preview === null) {
    return null;
  }

  return (
    <div className="invite-preview">
      <h1>{preview.group.name}</h1>
      {preview.created_by ? <div className="meta">Invited by {preview.created_by.display_name}</div> : null}
      {availability !== "active" ? <div className="form-error">{availabilityLabel(availability)}</div> : null}
      {!signedIn && availability === "active" ? <div className="meta">Sign in to join</div> : null}
    </div>
  );
}

function inviteAvailability(preview: GroupInviteLinkPreview): InviteAvailability {
  if (preview.revoked_at !== undefined) {
    return "revoked";
  }
  if (new Date(preview.expires_at).getTime() <= Date.now()) {
    return "expired";
  }
  if (preview.max_uses !== undefined && preview.use_count >= preview.max_uses) {
    return "full";
  }
  return "active";
}

function availabilityLabel(availability: InviteAvailability | null): string {
  switch (availability) {
    case "expired":
      return "This invite link has expired";
    case "revoked":
      return "This invite link has been revoked";
    case "full":
      return "This invite link has no remaining uses";
    default:
      return "";
  }
}
