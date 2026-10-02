import { ru } from "./ru";
import { en } from "./en";

type Lang = typeof ru;
let _lang: Lang = ru;

const nav = navigator as any;
const prefLang = nav?.language?.startsWith("en") ? "en" : "ru";

export function init() {
  _lang = prefLang === "en" ? en : ru;
  applyI18n();
}

export function t(key: string, ...args: any[]): string {
  const val = (_lang as any)[key];
  if (typeof val === "function") return val(...args);
  return val || key;
}

export function lang() {
  return prefLang;
}

function applyI18n() {
  for (const el of document.querySelectorAll("[data-i18n]")) {
    const key = el.getAttribute("data-i18n")!;
    el.textContent = t(key);
  }
  for (const el of document.querySelectorAll("[data-i18n-placeholder]")) {
    const key = el.getAttribute("data-i18n-placeholder")!;
    (el as HTMLInputElement).placeholder = t(key);
  }
}