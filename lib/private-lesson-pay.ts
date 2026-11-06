export const coachLessonPercent=65;
export const businessLessonPercent=100-coachLessonPercent;
export const lessonFormatLabels={
 'one-on-one':'One-on-one',
 partner:'Two-on-one',
 'small-group':'Small group'
} as const;
export type LessonFormat=keyof typeof lessonFormatLabels;
export function lessonFormatValid(value:unknown):value is LessonFormat{
 return typeof value==='string'&&Object.hasOwn(lessonFormatLabels,value);
}
export function lessonSplit(grossCents:number){
 const coachCents=Math.round(grossCents*coachLessonPercent/100);
 return {grossCents,coachCents,businessCents:grossCents-coachCents};
}
export function lessonAmountValid(value:unknown):value is number{
 return Number.isSafeInteger(value)&&Number(value)>=0&&Number(value)<=10000000;
}
