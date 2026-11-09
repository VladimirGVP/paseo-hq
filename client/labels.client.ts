/** Display-only translations: saved provider IDs and mappings stay compatible. */
const labels: Record<string, string> = {
  Session: "За 5 часов",
  Weekly: "За неделю",
  Window: "",
  "Code review": "Проверка кода",
  "Code Review": "Проверка кода",
  Credits: "Баланс",
  "Banked resets": "Доступные сбросы лимита",
  "Plan pool": "Квота подписки",
  "Antigravity CLI": "Antigravity CLI · локальная статистика",
  "Gemini Models": "Gemini в Antigravity",
  "Claude and GPT models": "Claude и GPT в Antigravity",
  Requests: "Запросы",
  Tokens: "Токены",
  "Session · last 5h": "Последние 5 часов",
  Today: "Последние 24 часа",
  "Last 7 days": "Последние 7 дней",
  "Every client": "Все клиенты",
};
export function usageLabel(label: string): string {
  if (labels[label] !== undefined) return labels[label];
  return label
    .replace("Session · last 5h", "Последние 5 часов")
    .split(" · ")
    .map((part) => labels[part] ?? (part === "last 5h" ? "последние 5 часов" : part))
    .join(" · ");
}
