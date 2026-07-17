import type { EvidenceFormatDraft } from "./evidenceFormatDraft";

type ConstraintFieldProps = {
  draft: EvidenceFormatDraft;
  disabled?: boolean;
  lineModeLabel?: string;
  onChange: (patch: Partial<EvidenceFormatDraft>) => void;
};

export function EvidenceFormatLengthFields({ draft, disabled = false, onChange }: ConstraintFieldProps) {
  return (
    <div className="form-grid two-column">
      <label>
        Min chars
        <input
          disabled={disabled}
          min="1"
          type="number"
          value={draft.minChars}
          onChange={(event) => onChange({ minChars: event.target.value })}
        />
      </label>
      <label>
        Max chars
        <input
          disabled={disabled}
          min="1"
          type="number"
          value={draft.maxChars}
          onChange={(event) => onChange({ maxChars: event.target.value })}
        />
      </label>
    </div>
  );
}

export function EvidenceFormatLineFields({
  draft,
  disabled = false,
  lineModeLabel = "Line mode",
  onChange,
}: ConstraintFieldProps) {
  return (
    <>
      <div className="form-grid two-column">
        <label>
          {lineModeLabel}
          <select
            aria-label={lineModeLabel}
            disabled={disabled}
            value={draft.lineMode}
            onChange={(event) => onChange({ lineMode: event.target.value as "range" | "exact" })}
          >
            <option value="range">Range</option>
            <option value="exact">Exact</option>
          </select>
        </label>
        <label className="checkbox-row status-checkbox">
          <input
            checked={draft.allowBlankLines}
            disabled={disabled}
            type="checkbox"
            onChange={(event) => onChange({ allowBlankLines: event.target.checked })}
          />
          Blank lines
        </label>
      </div>
      {draft.lineMode === "exact" ? (
        <label>
          Exact lines
          <input
            disabled={disabled}
            min="1"
            type="number"
            value={draft.exactLines}
            onChange={(event) => onChange({ exactLines: event.target.value })}
          />
        </label>
      ) : (
        <div className="form-grid two-column">
          <label>
            Min lines
            <input
              disabled={disabled}
              min="1"
              type="number"
              value={draft.minLines}
              onChange={(event) => onChange({ minLines: event.target.value })}
            />
          </label>
          <label>
            Max lines
            <input
              disabled={disabled}
              min="1"
              type="number"
              value={draft.maxLines}
              onChange={(event) => onChange({ maxLines: event.target.value })}
            />
          </label>
        </div>
      )}
    </>
  );
}

export function EvidenceFormatLineLengthFields({ draft, disabled = false, onChange }: ConstraintFieldProps) {
  return (
    <div className="form-grid two-column">
      <label>
        Line min chars
        <input
          disabled={disabled}
          min="1"
          type="number"
          value={draft.lineMinChars}
          onChange={(event) => onChange({ lineMinChars: event.target.value })}
        />
      </label>
      <label>
        Line max chars
        <input
          disabled={disabled}
          min="1"
          type="number"
          value={draft.lineMaxChars}
          onChange={(event) => onChange({ lineMaxChars: event.target.value })}
        />
      </label>
    </div>
  );
}
