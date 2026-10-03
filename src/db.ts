import { Course, Intake, IntakeRecord, todayStr, uid, isExpired } from "./models";

const DB_NAME = "vt_db";
const DB_VER = 2;

type Store = "courses" | "intakes" | "records";

let _db: IDBDatabase | null = null;
let _opening: Promise<IDBDatabase> | null = null;

function log(op: string, err: unknown): void {
  console.error("[db]", op, err);
}

function desc(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// --- schema helpers (idempotent: safe to run on every upgrade) ---

function ensureStore(db: IDBDatabase, name: Store): void {
  if (!db.objectStoreNames.contains(name)) {
    db.createObjectStore(name, { keyPath: "id" });
  }
}

function ensureIndex(db: IDBDatabase, store: Store, index: string, keyPath: string): void {
  const os = db.transaction(store, "readwrite").objectStore(store);
  if (!os.indexNames.contains(index)) {
    os.createIndex(index, keyPath, { unique: false });
  }
}

function applySchema(db: IDBDatabase): void {
  ensureStore(db, "courses");
  ensureStore(db, "intakes");
  ensureStore(db, "records");
  ensureIndex(db, "intakes", "courseIdx", "courseId");
  ensureIndex(db, "records", "courseIdx", "courseId");
  ensureIndex(db, "records", "intakeIdx", "intakeId");
  ensureIndex(db, "records", "dayIdx", "day");
}

// --- open ---

function openDB(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);
  if (_opening) return _opening;

  _opening = new Promise<IDBDatabase>((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VER);
    } catch (e) {
      _opening = null;
      reject(new Error("indexedDB.open threw: " + desc(e)));
      return;
    }

    req.onupgradeneeded = (ev: IDBVersionChangeEvent) => {
      try {
        const db = req.result as IDBDatabase;
        applySchema(db);
        console.info("[db] upgrade", ev.oldVersion, "->", ev.newVersion ?? DB_VER);
      } catch (e) {
        log("onupgradeneeded", e);
      }
    };

    req.onblocked = () => {
      log("open blocked: another connection holds an older version, close other tabs", null);
    };

    req.onsuccess = () => {
      const db = req.result;
      _db = db;
      _opening = null;
      db.onversionchange = () => {
        log("db.onversionchange: closing connection for another tab", null);
        db.close();
        _db = null;
      };
      db.onclose = () => {
        if (_db === db) {
          _db = null;
          log("db.onclose: connection closed unexpectedly, will reopen on next call", null);
        }
      };
      db.onerror = (e) => { log("db.onerror", e); };
      resolve(db);
    };

    req.onerror = () => {
      _opening = null;
      log("open failed", req.error);
      reject(new Error("Cannot open DB: " + desc(req.error)));
    };
  });

  return _opening;
}

// --- request / transaction plumbing ---

function reqResult<T>(req: IDBRequest<T>, op: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      const e = req.error ?? new Error(op + " request failed");
      log(op, e);
      reject(e);
    };
  });
}

function txDone(tx: IDBTransaction, op: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => {
      const e = tx.error ?? new Error(op + " transaction failed");
      log(op, e);
      reject(e);
    };
    tx.onabort = () => {
      const e = tx.error ?? new Error(op + " transaction aborted");
      log(op, e);
      reject(e);
    };
  });
}

function openTx(db: IDBDatabase, store: Store, mode: IDBTransactionMode, op: string): IDBTransaction {
  try {
    return db.transaction(store, mode);
  } catch (e) {
    log(op + " cannot open transaction on '" + store + "'", e);
    throw e;
  }
}

// --- primitives ---

async function readCursor<T>(store: Store, index: string | null, value: string | null): Promise<T[]> {
  const db = await openDB();
  const op = index ? "cursor " + store + "." + index : "cursor " + store;
  const tx = openTx(db, store, "readonly", op);
  const done = txDone(tx, op);
  const items: T[] = [];

  const cursorReq = index !== null
    ? tx.objectStore(store).index(index).openCursor(value === null ? null : IDBKeyRange.only(value))
    : tx.objectStore(store).openCursor();

  cursorReq.onerror = () => { log(op, cursorReq.error); };
  cursorReq.onsuccess = () => {
    const cursor = cursorReq.result;
    if (!cursor) return;
    items.push(cursor.value as T);
    cursor.continue();
  };

  await done; // commit, not just "request fired"
  return items;
}

export async function getAll<T>(store: Store): Promise<T[]> {
  return readCursor<T>(store, null, null);
}

export async function getById<T>(store: Store, id: string): Promise<T | undefined> {
  const db = await openDB();
  const op = "get " + store + "." + id;
  const tx = openTx(db, store, "readonly", op);
  const done = txDone(tx, op);
  const [val] = await Promise.all([reqResult(tx.objectStore(store).get(id), op), done]);
  return val as T | undefined;
}

export async function putItem(store: Store, item: any): Promise<void> {
  const db = await openDB();
  const op = "put " + store;
  const tx = openTx(db, store, "readwrite", op);
  const done = txDone(tx, op);
  const req = tx.objectStore(store).put(item);
  req.onerror = () => { log(op, req.error); };
  await done; // resolve only after tx.oncomplete => write is durable
}

export async function removeItem(store: Store, id: string): Promise<void> {
  const db = await openDB();
  const op = "delete " + store + "." + id;
  const tx = openTx(db, store, "readwrite", op);
  const done = txDone(tx, op);
  const req = tx.objectStore(store).delete(id);
  req.onerror = () => { log(op, req.error); };
  await done;
}

export async function queryByIndex<T>(store: Store, index: string, value: string): Promise<T[]> {
  return readCursor<T>(store, index, value);
}

// === High-level API ===

export async function getCourses(): Promise<Course[]> {
  try {
    return await getAll<Course>("courses");
  } catch (e) {
    log("getCourses", e);
    return [];
  }
}

export async function getActiveCourses(): Promise<Course[]> {
  const all = await getCourses();
  return all.filter(c => c.status === "active" && !isExpired(c));
}

export async function saveCourse(c: Course): Promise<boolean> {
  try {
    await putItem("courses", c);
    return true;
  } catch (e) {
    log("saveCourse " + c.id, e);
    return false;
  }
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
  } catch (e) {
    log("deleteCourse " + id, e);
    return false;
  }
}

export async function getCourseIntakes(courseId: string): Promise<Intake[]> {
  try {
    return await queryByIndex<Intake>("intakes", "courseIdx", courseId);
  } catch (e) {
    log("getCourseIntakes " + courseId, e);
    return [];
  }
}

export async function saveIntake(i: Intake): Promise<boolean> {
  try {
    await putItem("intakes", i);
    return true;
  } catch (e) {
    log("saveIntake " + i.id, e);
    return false;
  }
}

export async function saveIntakes(intakes: Intake[]): Promise<boolean> {
  for (const i of intakes) {
    if (!(await saveIntake(i))) {
      log("saveIntakes batch stopped at " + i.id, null);
      return false;
    }
  }
  return true;
}

export async function getIntakeRecords(intakeId: string): Promise<IntakeRecord[]> {
  try {
    return await queryByIndex<IntakeRecord>("records", "intakeIdx", intakeId);
  } catch (e) {
    log("getIntakeRecords " + intakeId, e);
    return [];
  }
}

export async function getRecordsForDay(day: string): Promise<IntakeRecord[]> {
  const all = await getAllRecords();
  return all.filter(r => r.day === day);
}

export async function getAllRecords(): Promise<IntakeRecord[]> {
  try {
    return await getAll<IntakeRecord>("records");
  } catch (e) {
    log("getAllRecords", e);
    return [];
  }
}

export async function saveRecord(r: IntakeRecord): Promise<boolean> {
  try {
    await putItem("records", r);
    return true;
  } catch (e) {
    log("saveRecord " + r.id, e);
    return false;
  }
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
          const ok = await saveRecord({
            id: uid(),
            intakeId: intake.id,
            courseId: course.id,
            day: today,
            status: "pending",
          });
          if (!ok) log("ensureTodayRecords: write failed for intake " + intake.id, null);
        }
      }
    }
  } catch (e) {
    log("ensureTodayRecords", e);
  }
}

export async function runHousekeeping(): Promise<void> {
  try {
    const courses = await getCourses();
    for (const course of courses) {
      if (course.status === "active" && isExpired(course)) {
        course.status = "archived";
        course.archivedAt = todayStr();
        const ok = await saveCourse(course);
        if (!ok) log("runHousekeeping: archive failed for course " + course.id, null);
      }
    }
    const allRecs = await getAllRecords();
    const today = todayStr();
    for (const rec of allRecs.filter(r => r.status === "pending" && r.day < today)) {
      rec.status = "missed";
      const ok = await saveRecord(rec);
      if (!ok) log("runHousekeeping: mark missed failed for record " + rec.id, null);
    }
  } catch (e) {
    log("runHousekeeping", e);
  }
}