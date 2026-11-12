/**
 * Food pictures for the nutrition tab: an emoji per food, found by Hebrew keywords in the text the assistant wrote.
 * The model also sends `foods` with its own emoji; this list fills in for older answers and the offline demo.
 * Order matters: the more specific words come first.
 */
const FOODS: [RegExp, string, string][] = [
  [/שוקו/, '🥛', 'שוקו'], [/חלב/, '🥛', 'חלב'], [/יוגורט|מעדן|לבן\b|אשל/, '🥣', 'יוגורט'],
  [/גבינ/, '🧀', 'גבינה'], [/ביצ|חביתה/, '🥚', 'ביצה'], [/טונה|דג|סלמון/, '🐟', 'דג'],
  [/שניצל|עוף|הודו|חזה/, '🍗', 'עוף'], [/בשר|קציצ|המבורגר/, '🥩', 'בשר'], [/טופו/, '🧈', 'טופו'],
  [/פסטה|ספגטי|מקרוני|פתיתים/, '🍝', 'פסטה'], [/אורז/, '🍚', 'אורז'], [/תפוח אדמה|תפו"א|בטטה|פירה/, '🥔', 'תפוח אדמה'],
  [/פיתה|לחם|כריך|טוסט|לחמני|בייגל|פרוס/, '🍞', 'לחם'], [/שיבולת|דייסה|קורנפלקס|גרנולה|דגני/, '🥣', 'דגנים'],
  [/חומוס|עדשים|שעועית|קטני/, '🫘', 'קטניות'], [/טחינה/, '🥙', 'טחינה'], [/פיצה/, '🍕', 'פיצה'], [/מרק/, '🍲', 'מרק'],
  [/סלט|ירקות|ירק\b/, '🥗', 'סלט'], [/מלפפון/, '🥒', 'מלפפון'], [/עגבני/, '🍅', 'עגבנייה'], [/גזר/, '🥕', 'גזר'],
  [/פלפל/, '🫑', 'פלפל'], [/ברוקולי/, '🥦', 'ברוקולי'], [/תירס/, '🌽', 'תירס'], [/אבוקדו/, '🥑', 'אבוקדו'],
  [/בננ/, '🍌', 'בננה'], [/תפוח(?! אדמה)/, '🍎', 'תפוח'], [/תפוז|קלמנטינ/, '🍊', 'תפוז'], [/ענב/, '🍇', 'ענבים'],
  [/אבטיח/, '🍉', 'אבטיח'], [/תות/, '🍓', 'תות'], [/אגס/, '🍐', 'אגס'], [/תמר|צימוק|פירות יבשים/, '🌴', 'תמרים'],
  [/פרי|פירות/, '🍏', 'פרי'], [/אגוז|שקד|בוטנ/, '🥜', 'אגוזים'], [/דבש|ריבה/, '🍯', 'דבש'],
  [/מים|בקבוק|לשתות/, '💧', 'מים'],
];

export interface Food { emoji: string; name: string }

/** The foods mentioned in a text, in order, without repeats (at most `max`). */
export function foodsIn(text: string, max = 6): Food[] {
  const found: { at: number; food: Food }[] = [];
  const seen = new Set<string>();
  for (const [re, emoji, name] of FOODS) {
    const m = re.exec(text);
    if (m && !seen.has(emoji + name)) { seen.add(emoji + name); found.push({ at: m.index, food: { emoji, name } }); }
  }
  return found.sort((a, b) => a.at - b.at).map((x) => x.food).filter((f, i, all) => all.findIndex((g) => g.emoji === f.emoji) === i).slice(0, max);
}

const isEmoji = (s: unknown): s is string => typeof s === 'string' && /\p{Extended_Pictographic}/u.test(s) && s.length <= 8;

/** The model's own list when it sent one ({emoji, name}), else the foods found in the text. */
export function foodsOf(given: unknown, text: string): Food[] {
  if (Array.isArray(given)) {
    const list = given.filter((f): f is Food => !!f && isEmoji((f as Food).emoji) && typeof (f as Food).name === 'string').slice(0, 6);
    if (list.length) return list;
  }
  return foodsIn(text);
}
