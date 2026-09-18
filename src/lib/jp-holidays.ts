/**
 * 일본 법정 휴일 (国民の祝日) — 거래처 교산(京三)의 휴무일을 달력에 보여 주기 위한 것.
 *
 * - 표시 전용이다. 한국 직원의 휴가 일수 계산에는 넣지 않는다 (한국은 근무일).
 * - DB 에 저장하지 않고 「国民の祝日に関する法律」의 규칙으로 해마다 계산한다.
 *   그래서 관리자가 매년 입력하지 않아도 된다.
 * - 2022년 이후 규칙 기준. 2099년까지 맞다 (춘분·추분 계산식의 범위).
 *   법이 바뀌거나 임시 휴일(즉위 행사 등)이 생기면 이 파일을 고친다.
 *
 * 규칙
 * 1. 날짜가 정해진 휴일 + 해피 먼데이(n번째 월요일) + 춘분·추분
 * 2. 国民の休日: 앞뒤 날이 모두 휴일인 날 (예: 2026년 9월 22일)
 * 3. 振替休日: 휴일이 일요일이면, 그다음 휴일이 아닌 날
 */
import { addDays, dayOfWeek } from "@/lib/dates";

export type JpHoliday = { ja: string; ko: string };

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function ymd(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** 그달의 n번째 월요일 */
function nthMonday(y: number, m: number, n: number): string {
  const first = ymd(y, m, 1);
  const offset = (8 - dayOfWeek(first)) % 7; // 첫 월요일까지 며칠
  return addDays(first, offset + (n - 1) * 7);
}

/** 춘분일·추분일 (1980~2099 년 근사식, 일본 국립천문대 공표값과 일치) */
function equinoxDay(y: number, base: number): number {
  return Math.floor(base + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
}

export function japanHolidays(year: number): Map<string, JpHoliday> {
  const y = year;
  const map = new Map<string, JpHoliday>();
  const add = (day: string, ja: string, ko: string) => map.set(day, { ja, ko });

  add(ymd(y, 1, 1), "元日", "새해 첫날");
  add(nthMonday(y, 1, 2), "成人の日", "성인의 날");
  add(ymd(y, 2, 11), "建国記念の日", "건국기념일");
  add(ymd(y, 2, 23), "天皇誕生日", "천황 탄생일");
  add(ymd(y, 3, equinoxDay(y, 20.8431)), "春分の日", "춘분의 날");
  add(ymd(y, 4, 29), "昭和の日", "쇼와의 날");
  add(ymd(y, 5, 3), "憲法記念日", "헌법기념일");
  add(ymd(y, 5, 4), "みどりの日", "녹색의 날");
  add(ymd(y, 5, 5), "こどもの日", "어린이날");
  add(nthMonday(y, 7, 3), "海の日", "바다의 날");
  add(ymd(y, 8, 11), "山の日", "산의 날");
  add(nthMonday(y, 9, 3), "敬老の日", "경로의 날");
  add(ymd(y, 9, equinoxDay(y, 23.2488)), "秋分の日", "추분의 날");
  add(nthMonday(y, 10, 2), "スポーツの日", "스포츠의 날");
  add(ymd(y, 11, 3), "文化の日", "문화의 날");
  add(ymd(y, 11, 23), "勤労感謝の日", "근로감사의 날");

  const statutory = new Set(map.keys());

  // 国民の休日: 앞뒤가 모두 법정 휴일인, 휴일이 아닌 날
  for (const day of statutory) {
    const next = addDays(day, 1);
    const afterNext = addDays(day, 2);
    if (!statutory.has(next) && statutory.has(afterNext)) {
      add(next, "国民の休日", "국민의 휴일");
    }
  }

  // 振替休日: 법정 휴일이 일요일이면 그다음 휴일이 아닌 날
  for (const day of statutory) {
    if (dayOfWeek(day) !== 0) continue;
    let sub = addDays(day, 1);
    while (map.has(sub)) sub = addDays(sub, 1);
    add(sub, "振替休日", "대체휴일");
  }

  return map;
}

/** 기간 안의 일본 휴일 (양 끝 포함) */
export function japanHolidaysBetween(from: string, to: string): Map<string, JpHoliday> {
  const out = new Map<string, JpHoliday>();
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y += 1) {
    for (const [day, h] of japanHolidays(y)) {
      if (day >= from && day <= to) out.set(day, h);
    }
  }
  return out;
}
