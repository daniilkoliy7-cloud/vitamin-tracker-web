export const ru = {
  today: "Сегодня",
  courses: "Курсы",
  add: "Добавить",
  "add-course": "Добавить курс",
  "course-name": "Название",
  "dosage-opt": "Дозировка (опц.)",
  "intakes-per-day": "Приёмов в день",
  duration: "Длительность (дн)",
  save: "Сохранить",
  cancel: "Отмена",
  delete: "Удалить",
  pause: "Пауза",
  resume: "Возобновить",
  archive: "Архивировать",
  "no-courses": "Нет активных курсов",
  "no-data": "Нет данных",
  "days-left": (n: number) => {
    const forms = ["день", "дня", "дней"];
    const idx = n % 10 === 1 && n % 100 !== 11 ? 0 : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 1 : 2;
    return `осталось ${n} ${forms[idx]}`;
  },
  progress: (p: number) => `${p}%`,
  taken: "Принял",
  skipped: "Пропустил",
  active: "Активен",
  paused: "Пауза",
  archived: "Архив",
  "confirm-delete": "Удалить курс?",
  "intake-at": (h: number, m: number) => `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}`,
};