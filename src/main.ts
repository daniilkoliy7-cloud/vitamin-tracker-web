import { init as initI18n, t, lang } from "./i18n/index";
import { Course, Intake, IntakeRecord, todayStr, uid, daysRemaining, intakeTime, isExpired, endDate } from "./models";
import * as db from "./db";

// --- Navigate ---
(window as any).navigate = function (page: string, param?: string) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  const el = document.getElementById("page-" + page);
  if (el) el.classList.add("active");
  document.querySelectorAll(".nav a").forEach(a => a.classList.remove("active"));
  const navLink = [...document.querySelectorAll(".nav a")].find(a => a.getAttribute("onclick")?.includes(page));
  if (navLink) navLink.classList.add("active");
  if (page === "today") renderToday();
  if (page === "courses") renderCourses();
  if (page === "add") setupAddForm();
  if (page === "detail" && param) renderDetail(param);
};

// --- Toast ---
function toast(msg: string) {
  const el = document.getElementById("toast")!;
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2000);
}

// --- Today ---
async function renderToday() {
  await db.runHousekeeping();
  await db.ensureTodayRecords();
  const courses = await db.getActiveCourses();
  const list = document.getElementById("today-list")!;
  const empty = document.getElementById("today-empty")!;
  list.innerHTML = "";
  if (courses.length === 0) { empty.style.display = "block"; return; }
  empty.style.display = "none";
  
  const today = todayStr();
  for (const course of courses) {
    const intakes = (await db.getCourseIntakes(course.id)).sort((a, b) => a.sortOrder - b.sortOrder);
    const records = (await db.getRecordsForDay(today)).filter(r => r.courseId === course.id);
    
    let html = `<div class="card"><h3>${course.name}</h3>`;
    if (course.dosage) html += `<p class="text-muted">${course.dosage}</p>`;
    
    for (const intake of intakes) {
      const rec = records.find(r => r.intakeId === intake.id);
      const status = rec?.status || "pending";
      const timeStr = intakeTime(intake);
      
      html += `<div class="row mt-2">`;
      html += `<span class="text-muted" style="font-family:monospace;font-size:15px">${timeStr}</span>`;
      
      if (status === "taken") {
        html += `<span class="pill taken">✅ ${t("taken")}</span>`;
      } else if (status === "skipped") {
        html += `<span class="pill missed">⏭ ${t("skipped")}</span>`;
      } else if (status === "missed") {
        html += `<span class="pill missed">❌ ${t("skipped")}</span>`;
      } else {
        html += `<button class="btn-sm" onclick="markIntake('${intake.id}','taken')">${t("taken")}</button>`;
        html += `<button class="btn-sm btn-outline" onclick="markIntake('${intake.id}','skipped')">${t("skipped")}</button>`;
      }
      html += `</div>`;
    }
    html += `</div>`;
    list.innerHTML += html;
  }
}

(window as any).markIntake = async function (intakeId: string, action: string) {
  const today = todayStr();
  const allRecs = (await (db as any).all("records")).filter((r: any) => r.day === today);
  let rec = allRecs.find((r: any) => r.intakeId === intakeId);
  if (rec) {
    rec.status = action;
    rec.markedAt = new Date().toISOString();
    await db.saveRecord(rec);
    toast(action === "taken" ? "✅" : "⏭");
    renderToday();
  }
};

// --- Courses list ---
async function renderCourses() {
  await db.runHousekeeping();
  const courses = await db.getCourses();
  const list = document.getElementById("courses-list")!;
  list.innerHTML = "";
  
  // Group by status
  const sections: [string, string][] = [["active", t("active")], ["paused", t("paused")], ["archived", t("archived")]];
  let hasAny = false;
  for (const [status, label] of sections) {
    const filtered = courses.filter(c => c.status === status);
    if (filtered.length === 0) continue;
    hasAny = true;
    list.innerHTML += `<h2 class="text-muted mt-2">${label}</h2>`;
    for (const course of filtered) {
      const days = daysRemaining(course);
      const intakes = await db.getCourseIntakes(course.id);
      const allRecs = await Promise.all(intakes.map(i => db.getIntakeRecords(i.id)));
      const total = allRecs.flat().length;
      const taken = allRecs.flat().filter(r => r.status === "taken").length;
      const pct = total > 0 ? Math.round(taken / total * 100) : 0;
      
      list.innerHTML += `
        <div class="card cursor-pointer" onclick="navigate('detail','${course.id}')">
          <div class="row">
            <div><h3>${course.name}</h3>
            <span class="text-muted">${status !== "active" ? "" : t("days-left", days)}</span></div>
            <div style="text-align:right"><span style="font-size:20px;font-weight:700">${pct}%</span></div>
          </div>
        </div>`;
    }
  }
  if (!hasAny) list.innerHTML = `<p class="text-center text-muted mt-4">${t("no-courses")}</p>`;
}

// --- Add form ---
function setupAddForm() {
  const nIntakes = parseInt((document.getElementById("add-intakes") as HTMLInputElement).value || "2");
  renderTimePickers(nIntakes);
  
  document.getElementById("add-intakes")!.onchange = () => {
    const n = parseInt((document.getElementById("add-intakes") as HTMLInputElement).value || "1");
    if (n >= 1 && n <= 6) renderTimePickers(n);
  };
}

const DEFAULT_HOURS = [9, 13, 18, 21, 8, 12];

function renderTimePickers(n: number) {
  const container = document.getElementById("add-times")!;
  container.innerHTML = "";
  for (let i = 0; i < n; i++) {
    const h = DEFAULT_HOURS[i % DEFAULT_HOURS.length];
    container.innerHTML += `
      <div class="flex gap mt-1" style="align-items:center">
        <span class="text-muted" style="font-size:13px">${t("intake-at", 0, 0).replace("00:00","")}${i + 1}:</span>
        <input type="number" min="0" max="23" value="${h}" style="width:56px" data-idx="${i}" class="time-h" />
        <span style="font-size:16px">:</span>
        <input type="number" min="0" max="59" value="0" style="width:56px" data-idx="${i}" class="time-m" />
      </div>`;
  }
}

(window as any).saveCourse = async function () {
  const name = (document.getElementById("add-name") as HTMLInputElement).value.trim();
  if (!name) { toast("Введите название"); return; }
  const dosage = (document.getElementById("add-dose") as HTMLInputElement).value.trim();
  const duration = parseInt((document.getElementById("add-duration") as HTMLInputElement).value || "30");
  
  const hours = [...document.querySelectorAll(".time-h")].map(el => parseInt((el as HTMLInputElement).value || "9"));
  const mins = [...document.querySelectorAll(".time-m")].map(el => parseInt((el as HTMLInputElement).value || "0"));
  
  const courseId = uid();
  const course: Course = {
    id: courseId,
    name,
    dosage: dosage || undefined,
    startDate: todayStr(),
    durationDays: Math.min(365, Math.max(1, duration)),
    status: "active",
  };
  
  await db.saveCourse(course);
  
  for (let i = 0; i < hours.length && i < 6; i++) {
    await db.saveIntake({
      id: uid(),
      courseId,
      hour: Math.min(23, Math.max(0, hours[i])),
      minute: Math.min(59, Math.max(0, mins[i])),
      sortOrder: i,
    });
  }
  
  toast("✅ Курс создан");
  (window as any).navigate("today");
};

// --- Detail ---
async function renderDetail(courseId: string) {
  const course = await (db as any).get("courses", courseId);
  if (!course) { document.getElementById("detail-content")!.innerHTML = `<p class="text-muted">${t("no-data")}</p>`; return; }
  
  const intakes = (await db.getCourseIntakes(courseId)).sort((a: Intake, b: Intake) => a.sortOrder - b.sortOrder);
  const allRecs = (await Promise.all(intakes.map(i => db.getIntakeRecords(i.id)))).flat();
  const total = allRecs.length;
  const taken = allRecs.filter(r => r.status === "taken").length;
  const pct = total > 0 ? Math.round(taken / total * 100) : 0;
  const days = daysRemaining(course);
  
  document.getElementById("detail-title")!.textContent = `📄 ${course.name}`;
  let html = `<div class="card"><div class="row"><div><span style="font-size:36px">${pct}%</span></div>`;
  html += `<div>${course.dosage ? `<p class="text-muted">${course.dosage}</p>` : ""}`;
  html += `<p class="text-muted">${course.status === "active" ? t("days-left", days) : t(course.status)}</p></div></div></div>`;
  
  html += `<div class="card">`;
  for (const intake of intakes) {
    const recs = allRecs.filter(r => r.intakeId === intake.id);
    html += `<p><span class="text-muted" style="font-family:monospace">${intakeTime(intake)}</span> — `;
    const taken2 = recs.filter(r => r.status === "taken").length;
    const total2 = recs.length;
    html += `${taken2}/${total2}</p>`;
  }
  html += `</div>`;
  
  if (course.status !== "archived") {
    html += `<div class="flex gap mt-2">`;
    if (course.status === "active") {
      html += `<button class="btn" onclick="togglePause('${courseId}')">${t("pause")}</button>`;
    } else {
      html += `<button class="btn" onclick="togglePause('${courseId}')">${t("resume")}</button>`;
    }
    html += `<button class="btn-outline btn-sm" onclick="confirmDelete('${courseId}')">${t("delete")}</button>`;
    html += `</div>`;
  }
  
  document.getElementById("detail-content")!.innerHTML = html;
}

(window as any).togglePause = async function (id: string) {
  const course = await (db as any).get("courses", id);
  if (!course) return;
  course.status = course.status === "paused" ? "active" : "paused";
  await db.saveCourse(course);
  toast(course.status === "paused" ? "⏸" : "▶️");
  renderDetail(id);
};

(window as any).confirmDelete = async function (id: string) {
  if (confirm(t("confirm-delete"))) {
    await db.deleteCourse(id);
    toast("🗑");
    (window as any).navigate("courses");
  }
};

// --- Init ---
(async () => {
  initI18n();
  try { await db.ensureTodayRecords(); } catch (e) { console.log("DB init"); }
  try { await db.runHousekeeping(); } catch (e) { console.log("Housekeeping"); }
  renderToday();
})();