import { Course, Intake, IntakeRecord, todayStr, uid, isExpired } from "./models";

const DB_NAME = "vt_db";
const DB_VER = 1;
let _db: IDBDatabase | null = null;

async function openDB(): Promise<IDBDatabase> {
  if (_db) return _db;
  try {
    const req = indexedDB.open(DB_NAME, { version: DB_VER });
    req.onupgradeneeded = (ev: IDBVersionChangeEvent) => {
      const db = (ev.target as any).database as IDBDatabase;
      if (ev.versionChanged === 1) {
        db.createObjectStore("courses", { keyPath: "id" });
        db.createObjectStore("intakes", { keyPath: "id" });
        db.createObjectStore("records", { keyPath: "id" });
        db.createObjectStore("records").createIndex("courseIdx", "courseId", { unique: false });
        db.createObjectStore("records").createIndex("dayIdx", "day", { unique: false });
        db.createObjectStore("intakes").createIndex("courseIdx", "courseId", { unique: false });
      }
    };
    await new Promise<void>((resolve, reject) => {
      req.onsuccess = () => { _db = req.result; resolve(); };
      req.onerror = () => reject(new Error("Cannot open DB"));
    });
    return _db!;
  } catch (e) {
    throw new Error("DB init failed: " + (e instanceof Error ? e.message : String(e)));
  }
}

type Store = "courses" | "intakes" | "records";

export async function getAll<T>(store: Store): Promise<T[]> {
  const db = await openDB();
  const tx = db.transaction(store);
  const cursor = tx.cursor();
  const items: T[] = [];
  while (true) {
    const row = await cursor.next();
    if (!row) break;
    items.push(row.value as T);
  }
  await cursor.close();
  return items;
}

export async function getById<T>(store: Store, id: string): Promise<T | undefined> {
  const db = await openDB();
  const tx = db.transaction(store);
  const val = await tx.get(id);
  return val as T | undefined;
}

export async function putItem(store: Store, item: any): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(store);
  await tx.put(item);
}

export async function removeItem(store: Store, id: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(store);
  await tx.delete(id);
}

export async function queryByIndex<T>(store: Store, index: string, value: string): Promise<T[]> {
  const db = await openDB();
  const tx = db.transaction(store);
  const cursor = tx.cursor(index, value);
  const items: T[] = [];
  while (true) {
    const row = await cursor.next();
    if (!row) break;
    items.push(row.value as T);
  }
  await cursor.close();
  return items;
}

// === High-level API ===

export async function getCourses(): Promise<Course[]> {
  try { return await getAll<Course>("courses"); } catch { return []; }
}

export async function getActiveCourses(): Promise<Course[]> {
  const all = await getCourses();
  return all.filter(c => c.status === "active" && !isExpired(c));
}

export async function saveCourse(c: Course): Promise<boolean> {
  try { await putItem("courses", c); return true; } catch (e) { return false; }
}

export async function deleteCourse(id: string): Promise<boolean> {
  try {
    const intakes = await getCourseIntakes(id);
    for (const intake of intakes) {
      const recs = await getIntakeRecords(intake.id);
      for (const r of recs) await removeItem("records", r.id);
      await removeItem("intakes", intake.id);
    }
    await removeItem("courses", id);
    return true;
  } catch { return false; }
}

export async function getCourseIntakes(courseId: string): Promise<Intake[]> {
  try { return await queryByIndex<Intake>("intakes", "courseIdx", courseId); } catch { return []; }
}

export async function saveIntake(i: Intake): Promise<boolean> {
  try { await putItem("intakes", i); return true; } catch { return false; }
}

export async function saveIntakes(intakes: Intake[]): Promise<boolean> {
  for (const i of intakes) { if (!await saveIntake(i)) return false; }
  return true;
}

export async function getIntakeRecords(intakeId: string): Promise<IntakeRecord[]> {
  try { return await queryByIndex<IntakeRecord>("records", "courseIdx", intakeId); } catch { return []; }
}

export async function getRecordsForDay(day: string): Promise<IntakeRecord[]> {
  const all = await getAllRecords();
  return all.filter(r => r.day === day);
}

export async function getAllRecords(): Promise<IntakeRecord[]> {
  try { return await getAll<IntakeRecord>("records"); } catch { return []; }
}

export async function saveRecord(r: IntakeRecord): Promise<boolean> {
  try { await putItem("records", r); return true; } catch { return false; }
}

export async function ensureTodayRecords(): Promise<void> {
  try {
    const today = todayStr();
    const courses = await getCourses();
    for (const course of courses.filter(c => c.status === "active" && !isExpired(c))) {
      const intakes = await getCourseIntakes(course.id);
      for (const intake of intakes) {
        const existing = (await getIntakeRecords(intake.id)).find(r => r.day === today);
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
  } catch {}
}

export async function runHousekeeping(): Promise<void> {
  try {
    const courses = await getCourses();
    for (const course of courses) {
      if (course.status === "active" && isExpired(course)) {
        course.status = "archived";
        course.archivedAt = todayStr();
        await saveCourse(course);
      }
    }
    const allRecs = await getAllRecords();
    const today = todayStr();
    for (const rec of allRecs.filter(r => r.status === "pending" && r.day < today)) {
      rec.status = "missed";
      await saveRecord(rec);
    }
  } catch {}
}