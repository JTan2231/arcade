import { useEffect, useState } from "react";

import type { CreateGroupInviteLinkRequest, GroupInviteLink } from "../../types";
import { CreateInviteLinkDialog } from "./CreateInviteLinkDialog";

export function InviteLinksManager({
  groupName,
  links,
  loading,
  error,
  creating,
  revokingLinkId,
  createdInviteURL,
  onCreateInviteLink,
  onRevokeInviteLink,
  onClearCreatedInviteURL,
}: {
  groupName: string;
  links: GroupInviteLink[];
  loading: boolean;
  error: string;
  creating: boolean;
  revokingLinkId: string | null;
  createdInviteURL: string;
  onCreateInviteLink: (payload: CreateGroupInviteLinkRequest) => void;
  onRevokeInviteLink: (linkId: string) => void;
  onClearCreatedInviteURL: () => void;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [awaitingCreateResult, setAwaitingCreateResult] = useState(false);
  const [sawCreating, setSawCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  useEffect(() => {
    if (!createOpen || !awaitingCreateResult) {
      return;
    }
    if (createdInviteURL !== "") {
      setCreateOpen(false);
      setAwaitingCreateResult(false);
      setSawCreating(false);
      setCreateError("");
      return;
    }
    if (creating) {
      setSawCreating(true);
      return;
    }
    if (sawCreating && error !== "") {
      setCreateError(error);
      setAwaitingCreateResult(false);
      setSawCreating(false);
    }
  }, [awaitingCreateResult, createOpen, createdInviteURL, creating, error, sawCreating]);

  function openCreateDialog() {
    onClearCreatedInviteURL();
    setCreateError("");
    setAwaitingCreateResult(false);
    setSawCreating(false);
    setCreateOpen(true);
  }

  function closeCreateDialog() {
    if (creating) {
      return;
    }
    setCreateOpen(false);
    setAwaitingCreateResult(false);
    setSawCreating(false);
    setCreateError("");
  }

  async function copyCreatedInviteURL() {
    if (createdInviteURL === "" || navigator.clipboard === undefined) {
      return;
    }
    await navigator.clipboard.writeText(createdInviteURL).catch(() => undefined);
  }

  return (
    <section className="invite-links-section group-settings-invite-section" aria-label="Invite links">
      <div className="section-header-row">
        <div>
          <div className="meta">Create expiring links for new members.</div>
        </div>
        <button
          aria-haspopup="dialog"
          className="secondary"
          type="button"
          disabled={creating || loading}
          onClick={openCreateDialog}
        >
          Add invite link
        </button>
      </div>

      {createdInviteURL !== "" ? (
        <div className="created-invite-link">
          <input aria-label="New invite link" readOnly value={createdInviteURL} />
          <div className="compact-actions">
            <button
              className="secondary"
              type="button"
              onClick={() => {
                void copyCreatedInviteURL();
              }}
            >
              Copy link
            </button>
            <button className="secondary" type="button" onClick={onClearCreatedInviteURL}>
              Clear
            </button>
          </div>
        </div>
      ) : null}

      {error && !createOpen ? (
        <div className="form-error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="stack">
        {loading ? <div className="meta">Loading links...</div> : null}
        {!loading && !links.length ? <div className="meta">No invite links</div> : null}
        {links.map((link) => {
          const status = inviteLinkStatus(link);
          return (
            <div className="row invite-link-row" key={link.id}>
              <div>
                <div className="title">{link.label ?? "Invite link"}</div>
                <div className="meta">
                  {status} - {link.use_count}
                  {link.max_uses === undefined ? "" : `/${link.max_uses}`} uses - expires {formatDate(link.expires_at)}
                </div>
                {link.created_by ? <div className="meta">Created by {link.created_by.display_name}</div> : null}
              </div>
              <button
                className="danger"
                type="button"
                disabled={link.revoked_at !== undefined || revokingLinkId === link.id}
                onClick={() => onRevokeInviteLink(link.id)}
              >
                Revoke
              </button>
            </div>
          );
        })}
      </div>
      {createOpen ? (
        <CreateInviteLinkDialog
          groupName={groupName}
          saving={creating || awaitingCreateResult}
          submissionError={createError}
          onClose={closeCreateDialog}
          onCreate={(payload: CreateGroupInviteLinkRequest) => {
            setCreateError("");
            setAwaitingCreateResult(true);
            onCreateInviteLink(payload);
          }}
        />
      ) : null}
    </section>
  );
}

function inviteLinkStatus(link: GroupInviteLink): string {
  if (link.revoked_at !== undefined) {
    return "Revoked";
  }
  if (new Date(link.expires_at).getTime() <= Date.now()) {
    return "Expired";
  }
  if (link.max_uses !== undefined && link.use_count >= link.max_uses) {
    return "Full";
  }
  return "Active";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(new Date(value));
}
