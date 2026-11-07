// The parts of the academy settings document (academy_state.payload) that the owner workspace edits. The server
// checks every save with validState() in lib/academy-validation.ts; these types describe what the page reads and writes.

export type Program = {
  id: string;
  name: string;
  grades: string;
  description: string;
  priceCents: number;
  walkInPriceCents?: number;
  [key: string]: unknown;
};

export type WeeklySlot = {day: string; start: string; end: string};

export type Season = {
  season?: string;
  program: string;
  start: string;
  end: string;
  weekly: WeeklySlot[];
  excludedDates?: string[];
  // A free-text note from before days off were dates (still shown, never published).
  exceptions?: string;
  // Very old semesters described their times in words.
  days?: string;
  time?: string;
  until?: string;
};

export type EventSession = {date: string; start: string; end: string};

export type AcademyEvent = {
  id?: string | null;
  name: string;
  type: string;
  gradeRange?: string;
  description?: string;
  dates?: string[];
  // A date in words, from before events had real dates.
  date?: string;
  schedule?: unknown;
  price: number;
  day?: number | null;
  slots: number;
  archived?: boolean;
  archivedAt?: string | null;
};

export type ExtraPractice = {
  id: string;
  name: string;
  gradeRange?: string;
  description?: string;
  dates: string[];
  start: string;
  end: string;
  memberCents: number;
  nonMemberCents: number;
  enabled: boolean;
};

export type TeamCode = {id: string; name: string; code: string; percent: number; programs: string[]; active: boolean};

export type AcademyDoc = {
  programs?: Program[];
  programNamingVersion?: number;
  seasons: Season[];
  events?: AcademyEvent[];
  extraPractices?: ExtraPractice[];
  teamCodes?: TeamCode[];
  [key: string]: unknown;
};

// What a submitted form gives: Object.fromEntries(new FormData(form)), and FormData itself where a field repeats.
export type FormValues = Record<string, string | undefined>;
export type FormList = {get(name: string): unknown; getAll(name: string): unknown[]};

// A check either fails with the message the owner sees, or gives the value to save.
export type Checked<T> = {error: string} | {error?: undefined; value: T};
