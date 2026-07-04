import type { CatalogSourceField, DailyFeedRuleFilter } from "../../types";

export type FeedKind = "catalog_daily" | "daily_thread";

export type DraftFilter = {
  id: string;
  fieldId: string;
  op: string;
  textValue: string;
  numberValue: string;
  numberMaxValue: string;
};

export function defaultTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function defaultStartsAtInput(): string {
  const date = new Date();
  date.setHours(8, 0, 0, 0);
  return datetimeLocalValue(date);
}

export function datetimeLocalValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

export function localInputToISOString(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Start time is invalid");
  }
  return date.toISOString();
}

export function operatorsForField(field: CatalogSourceField): Array<{ value: string; label: string }> {
  if (field.value_type === "number" && !field.is_array) {
    return [
      { value: "eq", label: "=" },
      { value: "gte", label: ">=" },
      { value: "lte", label: "<=" },
      { value: "gt", label: ">" },
      { value: "lt", label: "<" },
      { value: "between", label: "Between" },
    ];
  }
  if (field.value_type === "string" && field.is_array) {
    return [
      { value: "contains", label: "Contains" },
      { value: "contains_any", label: "Contains any" },
      { value: "contains_all", label: "Contains all" },
    ];
  }
  return [
    { value: "eq", label: "=" },
    { value: "contains", label: "Contains" },
    { value: "like", label: "Like" },
  ];
}

export function defaultOperatorForField(field: CatalogSourceField): string {
  return operatorsForField(field)[0]?.value ?? "";
}

export function draftFilterToRequest(filter: DraftFilter, fields: CatalogSourceField[]): DailyFeedRuleFilter {
  const field = fields.find((candidate) => candidate.id === filter.fieldId);
  if (!field) {
    throw new Error("Filter field is invalid");
  }
  const op = filter.op || defaultOperatorForField(field);
  const request: DailyFeedRuleFilter = {
    field_id: field.id,
    op,
  };

  if (field.value_type === "number") {
    const first = Number(filter.numberValue);
    if (!Number.isFinite(first)) {
      throw new Error(`${field.label} value is invalid`);
    }
    if (op === "between") {
      const second = Number(filter.numberMaxValue);
      if (!Number.isFinite(second)) {
        throw new Error(`${field.label} range is invalid`);
      }
      request.number_values = [first, second];
    } else {
      request.number_values = [first];
    }
    return request;
  }

  const textValues =
    field.is_array && op !== "contains"
      ? filter.textValue
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      : [filter.textValue.trim()].filter(Boolean);
  if (!textValues.length) {
    throw new Error(`${field.label} value is required`);
  }
  request.text_values = textValues;
  return request;
}
