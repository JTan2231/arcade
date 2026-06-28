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
  const yesterday = formatDateValue(
    new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() - 1),
  );

  if (value === today) {
    return `Today (${value})`;
  }
  if (value === yesterday) {
    return `Yesterday (${value})`;
  }
  return value;
}

const FEED_DATE_LOOKBACK_DAYS = 14;
const dateValuePattern = /^\d{4}-\d{2}-\d{2}$/;

export function feedDateOptions(selectedDate: string, earliestDate?: string): Array<{ value: string; label: string }> {
  const options: Array<{ value: string; label: string }> = [];
  const today = new Date();
  const todayValue = formatDateValue(today);
  const earliestValue = normalizeDateFloor(earliestDate, todayValue);

  for (let offset = 0; offset < FEED_DATE_LOOKBACK_DAYS; offset += 1) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset);
    const value = formatDateValue(date);
    if (earliestValue !== null && value < earliestValue) {
      break;
    }
    options.push({ value, label: formatDateLabel(value) });
  }

  if (
    selectedDate &&
    isOnOrAfterDateFloor(selectedDate, earliestValue) &&
    !options.some((option) => option.value === selectedDate)
  ) {
    options.unshift({ value: selectedDate, label: formatDateLabel(selectedDate) });
  }

  return options;
}

function normalizeDateFloor(value: string | undefined, todayValue: string): string | null {
  if (value === undefined || value === "") {
    return null;
  }

  if (dateValuePattern.test(value)) {
    return value > todayValue ? todayValue : value;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const dateValue = formatDateValue(date);
  return dateValue > todayValue ? todayValue : dateValue;
}

function isOnOrAfterDateFloor(value: string, floor: string | null): boolean {
  return floor === null || value >= floor;
}
