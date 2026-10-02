import { Course, Intake, IntakeRecord, todayStr, uid, isExpired } from "./models";

const DB_NAME = "vt_db";
const DB_VER = 1;

async function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, { version: DB_VER });
    req.onupgradeneeded = (ev: IDBVersionChangeEvent) => {
      const db = (ev.target as any).database as IDBDatabase;
      if (ev.versionChanged === 1) {
        db.createObjectStore("courses", { keyPath: "id" });
        db.createObjectStore("intakes", { keyPath: "id" });
        db.createObjectStore("records", { keyPath: "id" });
        // Indices
        db.createObjectStore("records").createIndex("courseIdx", "courseId", { unique: false });
        db.createObjectStore("records").createIndex("dayIdx", "day", { unique: false });
        db.createObjectStore("intakes").createIndex("courseIdx", "courseId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

type Store = "courses" | "intakes" | "records";

async function all<T>(store: Store): Promise<T[]> {
  const db = await openDB();
  const tx = db.transaction(store);
  const cursor = tx.cursor();
  const items: T[] = [];
  while (true) {
    const row = await cursor.next();
    if (!row) break;
    items.push(row.value as T);
  }
  return items;
}

async function get<T>(store: Store, id: string): Promise<T | undefined> {
  const db = await openDB();
  const tx = db.transaction(store);
  const val = await tx.get(id);
  return val as T | undefined;
}

async function put(store: Store, item: any): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(store);
  await tx.put(item);
}

async function remove(store: Store, id: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(store);
  await tx.delete(id);
}

async function query<T>(store: Store, idx: string, value: string): Promise<T[]> {
  const db = await openDB();
  const tx = db.transaction(store);
  const cursor = tx.cursor(idx, value);
  const items: T[] = [];
  while (true) {
    const row = await cursor.next();
    if (!row) break;
    items.push(row.value as T);
  }
  return items;
}

// Re-export for main.ts access
export { all, get, query };

// == High-level API ==

export async function getCourses(): Promise<Course[]> {
  return all<Course>("courses");
}

export async function getActiveCourses(): Promise<Course[]> {
  const all = await getCourses();
  return all.filter(c => c.status === "active" && !isExpired(c));
}

export async function saveCourse(c: Course): Promise<void> {
  await put("courses", c);
}

export async function deleteCourse(id: string): Promise<void> {
  // Cascade: delete intakes + records
  const intakes = await getCourseIntakes(id);
  for (const intake of intakes) {
    const recs = await getIntakeRecords(intake.id);
    for (const r of recs) await remove("records", r.id);
    await remove("intakes", intake.id);
  }
  await remove("courses", id);
}

export async function getCourseIntakes(courseId: string): Promise<Intake[]> {
  return query<Intake>("intakes", "courseIdx", courseId);
}

export async function saveIntake(i: Intake): Promise<void> {
  await put("intakes", i);
}

export async function getIntakeRecords(intakeId: string): Promise<IntakeRecord[]> {
  return query<IntakeRecord>("records", "courseIdx", intakeId);
}

export async function getRecordsForDay(day: string): Promise<IntakeRecord[]> {
  const all = await all<IntakeRecord>("records");
  return all.filter(r => r.day === day);
}

export async function saveRecord(r: IntakeRecord): Promise<void> {
  await put("records", r);
}

export async function ensureTodayRecords(): Promise<void> {
  const today = todayStr();
  const courses = await getCourses();
  for (const course of courses.filter(c => c.status === "active" && !isExpired(c))) {
    const intakes = await getCourseIntakes(course.id);
    for (const intake of intakes) {
      const recs = await getIntakeRecords(intake.id);
      const existing = recs.find(r => r.day === today);
      if (!existing) {
        await saveRecord({
          id: uid(),
          intakeId: intake.id,
          courseId: course.id,
          day: today,
          status: "pending",
        });
      }
    }
  }
}

// Archive expired courses + mark missed
export async function runHousekeeping(): Promise<void> {
  const courses = await getCourses();
  for (const course of courses) {
    if (course.status === "active" && isExpired(course)) {
      course.status = "archived";
      course.archivedAt = todayStr();
      await saveCourse(course);
    }
  }
  // Mark pending records from past days as missed
  const allRecs = await all<IntakeRecord>("records");
  const today = todayStr();
  for (const rec of allRecs.filter(r => r.status === "pending" && r.day < today)) {
    rec.status = "missed";
    await saveRecord(rec);
  }
}