export function todayDateValue(): string {
  return formatDateValue(new Date());
}

function formatDateValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatDateLabel(value: string): string {
  const today = todayDateValue();
  const now = new Date();
  const yesterday = formatDateValue(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));

  if (value === today) {
    return `Today (${value})`;
  }
  if (value === yesterday) {
    return `Yesterday (${value})`;
  }
  return value;
}
