import { FormEvent, useState } from "react";

import type { CreateGroupInviteLinkRequest, GroupInviteLink } from "../../types";

const DAY_MS = 24 * 60 * 60 * 1000;

export function InviteLinksManager({
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
  const [label, setLabel] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("7");
  const [maxUses, setMaxUses] = useState("");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedMaxUses = maxUses.trim();
    const parsedMaxUses = trimmedMaxUses === "" ? undefined : Number.parseInt(trimmedMaxUses, 10);
    const payload: CreateGroupInviteLinkRequest = {
      expires_at: new Date(Date.now() + Number.parseInt(expiresInDays, 10) * DAY_MS).toISOString(),
    };
    const trimmedLabel = label.trim();
    if (trimmedLabel !== "") {
      payload.label = trimmedLabel;
    }
    if (parsedMaxUses !== undefined && Number.isFinite(parsedMaxUses)) {
      payload.max_uses = parsedMaxUses;
    }
    onCreateInviteLink(payload);
    setLabel("");
    setMaxUses("");
  }

  async function copyCreatedInviteURL() {
    if (createdInviteURL === "" || navigator.clipboard === undefined) {
      return;
    }
    await navigator.clipboard.writeText(createdInviteURL).catch(() => undefined);
  }

  return (
    <section className="invite-links-section group-settings-invite-section" aria-label="Invite links">
      <div className="section-title">Invite links</div>

      <form className="invite-link-form" onSubmit={handleSubmit}>
        <label>
          Label
          <input value={label} maxLength={120} onChange={(event) => setLabel(event.target.value)} />
        </label>
        <label>
          Expires
          <select value={expiresInDays} onChange={(event) => setExpiresInDays(event.target.value)}>
            <option value="1">1 day</option>
            <option value="7">7 days</option>
            <option value="30">30 days</option>
          </select>
        </label>
        <label>
          Max uses
          <input
            inputMode="numeric"
            min="1"
            placeholder="Unlimited"
            type="number"
            value={maxUses}
            onChange={(event) => setMaxUses(event.target.value)}
          />
        </label>
        <button type="submit" disabled={creating}>
          Create link
        </button>
      </form>

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

      {error ? (
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
