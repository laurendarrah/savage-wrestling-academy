// Programs and grades in the owner workspace (issue #45). The server's rules in lib/program-approval.ts are the source
// of truth: SWA Development is grades K to 6, SWA Intermediate 7 to 12, SWA Advance 7 to 12 and every wrestler needs
// coach approval. tests/workspace-modules.mjs checks that these rules and the server agree for every grade.
import {programDetails} from '../program-names';
import type {Program} from './types';

export const PROGRAM_IDS = ['Elementary', 'Intermediate', 'Advanced'] as const;
export type ProgramId = typeof PROGRAM_IDS[number];

// Kindergarten is "K"; the other grades are numeric strings, as saved on a family's wrestler.
export const GRADES = ['K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'] as const;
const grades = (from: string, through: string) => GRADES.slice(GRADES.indexOf(from as never), GRADES.indexOf(through as never) + 1);

export const PROGRAM_RULES: Record<ProgramId, {grades: readonly string[]; coachApproval: boolean}> = {
  Elementary: {grades: grades('K', '6'), coachApproval: false},
  Intermediate: {grades: grades('7', '12'), coachApproval: false},
  Advanced: {grades: grades('7', '12'), coachApproval: true},
};

const rules = (program: string) => (PROGRAM_IDS as readonly string[]).includes(program) ? PROGRAM_RULES[program as ProgramId] : null;

// Whether a wrestler in this grade may join the program (SWA Advance also needs coach approval).
export function gradeAllowed(program: string, grade: string): boolean {
  return !!rules(program)?.grades.includes(grade);
}

// Whether this wrestler needs the coach's approval first: every SWA Advance wrestler in its grades.
export function needsCoachApproval(program: string, grade: string): boolean {
  return !!rules(program)?.coachApproval && gradeAllowed(program, grade);
}

// "Grades K–6", "Grades 7–12 · Coach approval required".
export function gradesLabel(program: ProgramId): string {
  const r = PROGRAM_RULES[program];
  return `Grades ${r.grades[0]}–${r.grades[r.grades.length - 1]}${r.coachApproval ? ' · Coach approval required' : ''}`;
}

// The three programs a new academy starts from. Nothing is public until the owner publishes them.
// days, time, short and color are older fields that a saved document still carries; nothing reads them.
export type StarterProgram = {id: ProgramId; name: string; grades: string; days: number[]; time: string; short: string; color: string};
export function starterPrograms(): StarterProgram[] {
  return [
    {id: 'Elementary', name: programDetails.Elementary.name, grades: gradesLabel('Elementary'), days: [1, 3, 5], time: '6:00–7:30 PM', short: 'Mon, Wed & Fri', color: 'el'},
    {id: 'Intermediate', name: programDetails.Intermediate.name, grades: gradesLabel('Intermediate'), days: [1, 3], time: '7:30–9:00 PM', short: 'Mon & Wed', color: 'mid'},
    {id: 'Advanced', name: programDetails.Advanced.name, grades: gradesLabel('Advanced'), days: [2, 4, 0], time: '7:30–9:00 PM · Sun 10:00 AM–12:00 PM', short: 'Tue, Thu & Sun', color: ''},
  ];
}

// The first SWA Advance description, before the program names changed. hydratePrograms() replaces it straight away.
const FIRST_ADVANCED_DESCRIPTION = 'For experienced wrestlers ready for faster drilling, demanding situations, and competitive live wrestling. All SWA Advance wrestlers require coach approval.';
export function starterDescription(id: string): string {
  return id === 'Elementary' ? programDetails.Elementary.description : id === 'Intermediate' ? programDetails.Intermediate.description : FIRST_ADVANCED_DESCRIPTION;
}

// Starter prices, until the owner sets their own under Programs & pricing.
export const STARTER_PRICE_CENTS = 20000;
export const STARTER_WALK_IN_CENTS = 4000;

export function programName(programs: readonly Pick<Program, 'id' | 'name'>[], id: string): string {
  return programs.find(p => p.id === id)?.name || id;
}

// ---------- Grade ranges on additional practices, camps, clinics and events ----------
// Saved as text: "" (no limit), "K", "7–12". The editor offers two lists, from and through.

// The saved range as the two lists show it, or blanks when it is not a range of known grades.
export function parseGradeRange(saved: string): {from: string; through: string} {
  const [first, last = first] = saved === 'All grades' ? ['K', '12'] : saved.split(/\s*[–-]\s*/);
  const known = (GRADES as readonly string[]).includes(first) && (GRADES as readonly string[]).includes(last);
  return known ? {from: first, through: last} : {from: '', through: ''};
}

export function gradeRangeText(from: string, through: string): string {
  return !from ? '' : from === through ? from : from + '–' + through;
}

// After the owner picks a grade in one list: a blank clears both, a first pick fills both, and the other list follows
// when the range would run backwards.
export function pickGradeRange(from: string, through: string, changed: 'from' | 'through'): {from: string; through: string; range: string} {
  const picked = changed === 'from' ? from : through;
  if (!picked) { from = ''; through = ''; }
  else {
    if (!from) from = picked;
    if (!through) through = picked;
    if (GRADES.indexOf(from as never) > GRADES.indexOf(through as never)) {
      if (changed === 'from') through = from; else from = through;
    }
  }
  return {from, through, range: gradeRangeText(from, through)};
}
