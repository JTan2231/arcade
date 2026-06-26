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

export function feedDateOptions(selectedDate: string): Array<{ value: string; label: string }> {
  const options: Array<{ value: string; label: string }> = [];
  const today = new Date();

  for (let offset = 0; offset < 14; offset += 1) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset);
    const value = formatDateValue(date);
    options.push({ value, label: formatDateLabel(value) });
  }

  if (selectedDate && !options.some((option) => option.value === selectedDate)) {
    options.unshift({ value: selectedDate, label: formatDateLabel(selectedDate) });
  }

  return options;
}
