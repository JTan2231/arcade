import type { CatalogSourceField } from "../../types";
import type { DraftFilter } from "./feedDraft";
import { defaultOperatorForField, operatorsForField } from "./feedDraft";

export function CatalogFiltersEditor({
  disabled,
  fields,
  filters,
  onChange,
}: {
  disabled: boolean;
  fields: CatalogSourceField[];
  filters: DraftFilter[];
  onChange: (filters: DraftFilter[]) => void;
}) {
  function addFilter() {
    const field = fields[0];
    if (field === undefined) {
      return;
    }
    onChange([
      ...filters,
      {
        id: globalThis.crypto.randomUUID(),
        fieldId: field.id,
        op: defaultOperatorForField(field),
        textValue: "",
        numberValue: "",
        numberMaxValue: "",
      },
    ]);
  }

  function updateFilter(id: string, patch: Partial<DraftFilter>) {
    onChange(filters.map((filter) => (filter.id === id ? { ...filter, ...patch } : filter)));
  }

  function removeFilter(id: string) {
    onChange(filters.filter((filter) => filter.id !== id));
  }

  return (
    <section className="feed-filters-section" aria-label="Filters">
      <div className="section-header-row">
        <div className="title">Filters</div>
        <button className="secondary" type="button" disabled={disabled || fields.length === 0} onClick={addFilter}>
          Add filter
        </button>
      </div>
      {filters.length > 0 ? (
        <div className="stack">
          {filters.map((filter) => (
            <FilterEditor
              disabled={disabled}
              fields={fields}
              filter={filter}
              key={filter.id}
              onChange={(patch) => updateFilter(filter.id, patch)}
              onRemove={() => removeFilter(filter.id)}
            />
          ))}
        </div>
      ) : (
        <div className="empty-state">No filters.</div>
      )}
    </section>
  );
}

function FilterEditor({
  disabled,
  fields,
  filter,
  onChange,
  onRemove,
}: {
  disabled: boolean;
  fields: CatalogSourceField[];
  filter: DraftFilter;
  onChange: (patch: Partial<DraftFilter>) => void;
  onRemove: () => void;
}) {
  const field = fields.find((candidate) => candidate.id === filter.fieldId) ?? fields[0] ?? null;
  const operators = field ? operatorsForField(field) : [];
  const currentOp = operators.some((operator) => operator.value === filter.op)
    ? filter.op
    : (operators[0]?.value ?? "");

  function handleFieldChange(fieldId: string) {
    const nextField = fields.find((candidate) => candidate.id === fieldId);
    onChange({
      fieldId,
      op: nextField ? defaultOperatorForField(nextField) : "",
      textValue: "",
      numberValue: "",
      numberMaxValue: "",
    });
  }

  return (
    <div className="filter-row">
      <label>
        Field
        <select disabled={disabled} value={filter.fieldId} onChange={(event) => handleFieldChange(event.target.value)}>
          {fields.map((candidate) => (
            <option value={candidate.id} key={candidate.id}>
              {candidate.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Operator
        <select disabled={disabled} value={currentOp} onChange={(event) => onChange({ op: event.target.value })}>
          {operators.map((operator) => (
            <option value={operator.value} key={operator.value}>
              {operator.label}
            </option>
          ))}
        </select>
      </label>
      <FilterValueInput disabled={disabled} field={field} filter={{ ...filter, op: currentOp }} onChange={onChange} />
      <button className="secondary filter-remove-button" type="button" disabled={disabled} onClick={onRemove}>
        Remove
      </button>
    </div>
  );
}

function FilterValueInput({
  disabled,
  field,
  filter,
  onChange,
}: {
  disabled: boolean;
  field: CatalogSourceField | null;
  filter: DraftFilter;
  onChange: (patch: Partial<DraftFilter>) => void;
}) {
  if (field === null) {
    return <div />;
  }
  if (field.value_type === "number") {
    if (filter.op === "between") {
      return (
        <div className="filter-between-inputs">
          <label>
            Min
            <input
              disabled={disabled}
              type="number"
              value={filter.numberValue}
              onChange={(event) => onChange({ numberValue: event.target.value })}
            />
          </label>
          <label>
            Max
            <input
              disabled={disabled}
              type="number"
              value={filter.numberMaxValue}
              onChange={(event) => onChange({ numberMaxValue: event.target.value })}
            />
          </label>
        </div>
      );
    }
    return (
      <label>
        Value
        <input
          disabled={disabled}
          type="number"
          value={filter.numberValue}
          onChange={(event) => onChange({ numberValue: event.target.value })}
        />
      </label>
    );
  }

  return (
    <label>
      Value
      <input
        disabled={disabled}
        value={filter.textValue}
        onChange={(event) => onChange({ textValue: event.target.value })}
      />
    </label>
  );
}
