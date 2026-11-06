export const textFields = {
  headline: { label: 'Homepage headline', limit: 100 },
  intro: { label: 'Homepage introduction', limit: 450 },
  address: { label: 'Street address', limit: 120 },
  city: { label: 'City, state and ZIP', limit: 120 },
  email: { label: 'Public contact email', limit: 180 },
} as const;

export const colorFields = {
  background: 'Page background',
  hero: 'Hero background',
  panel: 'Card and contact backgrounds',
  text: 'Main text',
  muted: 'Secondary text',
  button: 'Primary button background',
  buttonText: 'Primary button text',
  accent: 'Accent text and links',
} as const;

export const directories = {
  staff: { label: 'Staff', singular: 'staff member', fields: { name: 'Name', detail: 'Coaching role', description: 'Bio', image: 'Photo URL' } },
  wrestlers: { label: 'Wrestler accomplishments', singular: 'wrestler', fields: { name: 'Name', detail: 'School or team', description: 'Accomplishments', image: 'Photo URL' } },
  alumni: { label: 'College alumni', singular: 'alumnus', fields: { name: 'Name', detail: 'College or university', description: 'Highlights', image: 'College logo URL' } },
} as const;

export type Directory = keyof typeof directories;
type TextKey = keyof typeof textFields;
type ColorKey = keyof typeof colorFields;
type Entry = { name: string; detail: string; description: string; image: string };

export type WebsiteDraft = Record<TextKey, string> & {
  colors: Record<ColorKey, string>;
  staff: Entry[];
  wrestlers: Entry[];
  alumni: Entry[];
};

const stateChampions = [
  ['Gavin Mangano', 'Shoreham-Wading River High School', '2024'],
  ['Joseph Clem', 'Wantagh High School', '2024'],
  ['Tommy Aiello', 'John Glenn High School', '2023 and 2025'],
  ['Dunia Sibomana', 'Long Beach High School', '2022 and 2025'],
  ['Jackson Polo', 'Cold Spring Harbor High School', '2022'],
  ['Jordan Soriano', 'Clark High School', '2022'],
  ['Malik Leftenant', 'Copiague High School', '2020'],
  ['Matt Rogers', 'Wantagh High School', '2020'],
  ['Jonathan Loew', 'Wantagh High School', '2018'],
  ['Justin Vines', 'Wantagh High School', '2017'],
];

export const ownerPortraitSource = 'https://img1.wsimg.com/isteam/ip/18dbf09c-f6ac-4b3e-87c0-f46c7eed1a53/Justin%20Accordino.jpg';

export const defaultWebsite: WebsiteDraft = {
  headline: 'Wrestling for every stage.',
  intro: 'Train at Savage Wrestling Academy. Build strong fundamentals, get quality mat time, and develop as a wrestler from your first practice through high school competition.',
  address: '20 Railroad St',
  city: 'Huntington Station, NY 11746',
  email: 'savagewrestlingclub@gmail.com',
  colors: { background: '#101011', hero: '#151415', panel: '#1b191b', text: '#f7f6f4', muted: '#c0bdba', button: '#b72332', buttonText: '#ffffff', accent: '#f37a82' },
  staff: [{
    name: 'Justin Accordino',
    detail: 'Owner and Head Coach',
    description: 'Justin earned NCAA Division I All-American honors at Hofstra, qualified for the NCAA championships twice, and was a high school folkstyle national champion.',
    image: ownerPortraitSource,
  }],
  wrestlers: stateChampions.map(([name, detail, years]) => ({ name, detail, description: 'New York State Champion, ' + years, image: '' })),
  alumni: [],
};

export const entryLimit = 100;
export const entryLengths = { name: 100, detail: 140, description: 1200, image: 1500 };

export function readDraft(form: URLSearchParams): WebsiteDraft {
  function text(name: string, limit: number, required = true) {
    const value = form.get(name)?.trim() ?? '';
    if ((required && !value) || value.length > limit) throw Error('Check the length and required fields in the homepage editor.');
    return value;
  }
  const content = Object.fromEntries(Object.entries(textFields).map(([key, field]) => [key, text(key, field.limit)])) as Record<TextKey, string>;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(content.email)) throw Error('Enter a valid public contact email.');
  const colors = Object.fromEntries(Object.keys(colorFields).map(key => {
    const value = form.get(key) ?? '';
    if (!/^#[\da-f]{6}$/i.test(value)) throw Error('Choose a valid color for each color field.');
    return [key, value.toLowerCase()];
  })) as WebsiteDraft['colors'];

  const records = (key: Directory): Entry[] => {
    const fields = Object.keys(entryLengths) as (keyof Entry)[];
    const columns = fields.map(field => form.getAll(key + '-' + field));
    const count = columns[0].length;
    if (count > entryLimit || columns.some(column => column.length !== count)) throw Error('Check the number of directory entries.');
    return Array.from({ length: count }, (_, index) => {
      const entry = Object.fromEntries(fields.map((field, col) => [field, columns[col][index].trim()])) as Entry;
      if (!entry.name || fields.some(field => entry[field].length > entryLengths[field])) throw Error('Each directory entry needs a name and must fit within the field limits.');
      if (entry.image) {
        const url = URL.parse(entry.image);
        if (!url || url.protocol !== 'https:' || url.username || url.password) throw Error('Photo and college logo links must be public HTTPS URLs.');
        entry.image = url.href;
        if (entry.image.length > entryLengths.image) throw Error('Use a shorter photo or college logo link.');
      }
      return entry;
    });
  };
  return { ...content, colors, staff: records('staff'), wrestlers: records('wrestlers'), alumni: records('alumni') };
}
