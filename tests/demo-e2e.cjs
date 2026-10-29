// Drives the published demo page (dist-demo/next-team-demo.html) through several people and checks the sample backend.
// Run: npm run build:demo && node tests/demo-e2e.cjs [screenshot-dir]   (playwright must be resolvable)
const fs = require('fs');
const { chromium } = require('playwright');
const page_html = '<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>' + fs.readFileSync('dist-demo/next-team-demo.html', 'utf8') + '</body></html>';
const SHOTS = process.argv[2];
let fails = 0;
const out = (ok, label, extra) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${!ok && extra ? ' :: ' + extra : ''}`); };

(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 800 } });
  const p = await ctx.newPage(); const errors = [];
  p.on('pageerror', (e) => errors.push('PAGEERROR ' + e));
  p.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });
  const text = async () => {
    const body = (await p.locator('body').innerText()).replace(/\s+/g, ' ');
    const fields = await p.evaluate(() => [...document.querySelectorAll('input,select,textarea')].map((e) => (['checkbox', 'radio', 'file'].includes(e.type) ? '' : e.tagName === 'SELECT' ? e.selectedOptions[0]?.text ?? '' : e.value)).join(' '));
    return `${body} ${fields}`;
  };
  const has = async (label, ...n) => { const t = await text(); const miss = n.filter((x) => !t.includes(x)); out(!miss.length, label, `missing ${miss.join(', ')} in: ${t.slice(0, 200)}`); };
  const hasNot = async (label, ...n) => { const t = await text(); const f = n.filter((x) => t.includes(x)); out(!f.length, label, `unexpected ${f.join(', ')}`); };
  const wait = (ms = 600) => p.waitForTimeout(ms);
  const shot = (n) => SHOTS && p.screenshot({ path: `${SHOTS}/demo-${n}.png` });
  const pick = async (name) => { await p.click(`text=החלפת משתמש`).catch(() => {}); await wait(300); await p.click(`button:has-text("${name}")`); await wait(1200); };
  const card = (title) => p.locator('.card', { hasText: title });

  await p.setContent(page_html); await wait(1500);
  await has('picker lists the five sample people', 'אבי כץ', 'שרה כהן', 'רוני לוי', 'רונית מזרחי', 'יוסי אברהם'); await shot('picker');

  // coach
  await p.click('button:has-text("אבי כץ")'); await wait(1500);
  await has('coach lands on home with the next event', 'שלום, אבי', 'האירוע הבא', 'אימון קבוצתי', 'מגיעים', 'טרם השיבו', 'הכנה לאירוע'); await shot('coach-home');
  await has('coach home also shows the next event of another type', 'המשחק הקרוב', 'הפועל');
  await has('coach home shows the staff type', 'מאמן ראשי · ילדים ב׳');
  await hasNot('coach does not see the other coach team', 'נוער כדורסל');
  await p.click('text=לפרטי האירוע'); await wait(1000);
  await has('event shows what to bring', 'מה להביא', 'בקבוק מים', 'נעלי כדורגל', 'מגני שוקיים'); await shot('event');
  await p.click('.bottom-nav >> text=בית'); await wait(1000);
  await p.click('text=הכנה לאירוע'); await wait(1000);
  await has('event prep: positions and team score', 'הכנה לאירוע', 'פילוח לפי תפקידים', 'שוערים', 'שחקני שדה', 'ציון משוקלל'); await shot('prep');
  await p.click('button:has-text("רשימת השחקנים")'); await wait(400);
  await has('prep list shows coming players', 'דני כהן', 'נועה מזרחי');
  await p.click('.bottom-nav >> text=אירועים'); await wait(1200);
  await has('team page opens on events', 'גיבוש סוף עונה');
  await p.click('.tabs button:has-text("סגל")'); await wait(600);
  await has('squad with all six players and the pending request', 'דני כהן', 'רוני לוי', 'נועה מזרחי', 'גיל פרידמן', 'תומר שמש', 'יובל אורן', 'בקשות קישור', 'אילנה פרידמן'); await shot('squad');
  for (const [tab, needles] of [['אירועים', ['משחק ליגה נגד הפועל', 'גיבוש סוף עונה', 'טרם התקיימו', 'מהקרוב לרחוק']], ['משימות', ['מתיחות 10 דקות כל יום', 'מתוך 12']], ['סקרים', ['טורניר סוף עונה', 'אולי']], ['הודעות', ['אימון מחר', 'רוני בלי הסעה']], ['הגדרות', ['שליטה בכדור', 'מהירות', 'גיל מינימלי']]]) {
    await p.click(`role=tab[name="${tab}"]`); await wait(700); await has(`coach tab ${tab}`, ...needles);
  }
  await p.click('role=tab[name="אירועים"]'); await wait(600);
  await hasNot('events list hides past events by default', 'משחק ליגה נגד בית״ר');
  const order = async () => p.evaluate(() => [...document.querySelectorAll('.list li a')].map((a) => a.textContent));
  const near = await order(); out(near[0] === 'אימון קבוצתי', 'upcoming events from the nearest', near.join(' | '));
  await p.click('button:has-text("מהקרוב לרחוק")'); await wait(300);
  const far = await order(); out(far[0] === 'גיבוש סוף עונה', 'sort switches to far-to-near', far.join(' | '));
  await p.click('role=tab[name="התקיימו"]'); await wait(300);
  await has('past filter shows the played match', 'משחק ליגה נגד בית״ר', '2:1'); await hasNot('past filter hides upcoming events', 'גיבוש סוף עונה');
  await p.click('role=tab[name="ליגה"]'); await wait(900);
  await has('league tab: table, our team, games', 'טבלת ליגה', 'הפועל השרון', 'מכבי הצפון ילדים ב׳', '6 קבוצות משתתפות', 'משחקי הקבוצה', 'לדף הקבוצה באתר ההתאחדות'); await shot('league');
  out(await p.locator('.league-table tr.ours').count() === 1, 'league tab highlights our team');
  await p.click('role=tab[name="סגל"]'); await wait(700);
  await has('squad shows the staff with types', 'צוות מקצועי', 'אבי כץ', 'מאמן ראשי');
  await p.click('button:has-text("אישור")'); await wait(700);
  await hasNot('approving the request clears it', 'בקשות קישור');
  await p.click('text=דני כהן'); await wait(1000);
  await has('player page: profile tabs and medical info', 'פרופיל שחקן', 'פרטים', 'הערכה', 'יעדים', 'אלרגיה', 'בוטנים', 'תפקיד ברירת מחדל', 'קישור', 'שחקן שדה', 'רגל חזקה', 'שמאל', 'מספר חולצה');
  await p.click('role=tab[name="הערכה"]'); await wait(700);
  await has('player rating: latest average and bars', 'הערכה מקצועית אחרונה', '7.7/10', 'שליטה בכדור', '8/10'); await shot('player');
  await p.click('role=tab[name="יעדים"]'); await wait(700);
  await has('player goals', 'לשפר בעיטה ברגל שמאל', '50 הרמות כדור ברצף');
  await p.fill('input[placeholder^="יעד חדש"]', 'לעבוד על מסירות ארוכות'); await p.click('.goal-form button'); await wait(700);
  await has('goal added', 'לעבוד על מסירות ארוכות');
  await p.locator('.goals li', { hasText: 'לעבוד על מסירות ארוכות' }).getByRole('button', { name: 'הושג' }).click(); await wait(700);
  await has('goal marked done', 'יעדים שהושגו'); await shot('goals');
  // match page
  await p.click('.bottom-nav >> text=אירועים'); await wait(1000);
  await p.click('text=משחק ליגה נגד הפועל'); await wait(1200);
  await has('upcoming match: lineup on a pitch from the formation', 'הרכב על המגרש · 4-3-3', 'ספסל', 'נועה', 'שוער'); await shot('pitch');
  out(await p.locator('.pitch .pitch-slot').count() === 11, 'pitch has 11 slots for 4-3-3');
  const keeper = await p.locator('.pitch .pitch-slot').first().getAttribute('aria-label'); out(keeper === 'נועה מזרחי', 'the goalkeeper stands in goal', keeper);
  await p.locator('.pitch .pitch-slot').nth(0).click(); await p.locator('.pitch .pitch-slot').nth(10).click(); await wait(300);
  await has('a swap marks the lineup unsaved', 'לא נשמר');
  await p.click('button:has-text("שמירת ההרכב")'); await wait(800); await hasNot('saved lineup', 'לא נשמר');
  const moved = await p.locator('.pitch .pitch-slot').first().getAttribute('aria-label'); out(moved !== 'נועה מזרחי', 'saved lineup keeps the swap', moved);
  await p.click('button:has-text("עריכת פרטי האירוע")'); await wait(400);
  await has('event edit has type and end time', 'סוג', 'מסתיים (לא חובה)', 'יריבה');
  await p.fill('input[type="datetime-local"] >> nth=1', '2030-01-01T12:00'); await p.locator('.card', { hasText: 'מסתיים' }).getByRole('button', { name: 'שמירה' }).click(); await wait(800);
  await has('event saved with an end time', 'עריכת פרטי האירוע');
  await p.click('.bottom-nav >> text=אירועים'); await wait(1000);
  await p.click('role=tab[name="התקיימו"]'); await wait(300);
  await p.click('text=משחק ליגה נגד בית״ר'); await wait(900);
  await has('past match: result, goals, cards, formation', '2:1', 'שער', 'כרטיס צהוב', '4-4-2'); await shot('match');

  // parent
  await pick('שרה כהן');
  await has('parent lands on events', 'אירועים קרובים', 'דני כהן'); await hasNot('parent sees only their child', 'רוני לוי', 'נועה מזרחי');
  await has('parent dashboard: next event and the next match', 'האירוע הבא', 'אימון קבוצתי', 'המשחק הקרוב', 'משחק ליגה נגד הפועל', 'בעוד', 'תלבושת', 'בהמשך'); await shot('parent-dashboard');
  await p.click('role=navigation >> text=הילדים'); await wait(800);
  await has('parent home links to the league', 'הקבוצות והליגה', 'טבלה וקבוצות בליגה');
  await p.click('text=דני כהן'); await wait(1000);
  await has('child profile shows the parent as mom', 'שרה כהן (אני)', 'אמא');
  await has('child profile lists the second parent with contact details', 'משה כהן', 'אבא', '050-9990011');
  await p.locator('.parents li', { hasText: 'שרה כהן (אני)' }).getByRole('button', { name: 'עריכה' }).click(); await wait(300);
  await p.selectOption('.parents select', { label: 'אפוטרופוס' });
  await p.locator('.parents').getByRole('button', { name: 'שמירה' }).click(); await wait(700);
  await has('parent changes their relation', 'אפוטרופוס');
  await p.click('text=+ הוספת הורה'); await wait(300);
  await p.locator('.add-parent input').first().fill('סבתא רחל');
  await p.selectOption('.add-parent select', { label: 'אפוטרופוס' });
  await p.locator('.add-parent input[type=tel]').fill('052-4445566');
  await p.click('.add-parent >> text=הוספה'); await wait(700);
  await has('parent adds another guardian', 'סבתא רחל', '052-4445566');
  await p.click('role=navigation >> text=אירועים'); await wait(800);
  await has('parent events with attendance buttons', 'גיבוש סוף עונה', 'טרם נענה'); await shot('parent-events');
  await card('גיבוש סוף עונה').getByRole('button', { name: 'מגיע', exact: true }).click(); await wait(700);
  await has('answer saved', 'מגיע');
  await p.click('role=navigation >> text=הודעות'); await wait(800);
  await has('parent chat: channel and the personal conversation', 'רוני בלי הסעה', 'שיחות אישיות');
  await p.getByRole('button', { name: 'פתיחה' }).first().click(); await wait(600); await has('personal chat visible to the parent', 'כל הכבוד על הבישול');
  await p.fill('input[placeholder="כתבו הודעה…"] >> nth=0', 'אני יכולה לסיע בשבת'); await p.locator('form.composer button').first().click(); await wait(700);
  await has('parent message posted', 'אני יכולה לסיע בשבת');
  await p.click('role=navigation >> text=משימות'); await wait(700); await has('parent tasks (hers and her child\'s)', 'מתיחות 10 דקות כל יום', '100 הרמות כדור');

  // the coach sees what the parent did
  await pick('אבי כץ'); await p.click('.bottom-nav >> text=אירועים'); await wait(1000); await p.click('text=גיבוש סוף עונה'); await wait(900);
  await has('coach sees the parent\'s answer', 'דני כהן', 'מגיעים 1');

  // player
  await pick('רוני לוי');
  await has('player lands on events', 'אירועים קרובים', 'רוני לוי');
  await p.click('role=navigation >> text=אירועים'); await wait(800); await has('player events with attendance buttons (team allows it)', 'אימון קבוצתי', 'לימודים');
  await p.click('role=navigation >> text=משימות'); await wait(700); await has('player tasks: a done task earns a medal', '100 הרמות כדור', 'קיבלת מדליה', '🏅'); await shot('medal'); await hasNot('player does not see parent tasks', 'משימה להורה');

  // club admin who is also a parent: mode picker
  await pick('רונית מזרחי');
  await has('mode picker for a user with two roles', 'איך נכנסים היום?', 'מנהל מועדון', 'הורה');
  await p.click('button:has-text("מנהל מועדון")'); await wait(900); await has('admin sees the club', 'מכבי הצפון');
  await p.click('text=מכבי הצפון'); await wait(900); await has('club teams for the admin', 'ילדים ב׳', 'נוער כדורסל'); await shot('club');
  p.on('dialog', (d) => d.accept());
  await p.click('role=tab[name="שחקנים והורים"]'); await wait(800);
  await has('roster lists children with both parents', 'דני כהן', 'שרה כהן', 'משה כהן', '052-8887766', 'ייצוא לאקסל'); await shot('roster');
  const [download] = await Promise.all([p.waitForEvent('download'), p.click('button:has-text("ייצוא לאקסל")')]);
  const csv = fs.readFileSync(await download.path(), 'utf8');
  out(csv.startsWith('\uFEFF') && csv.includes('דני כהן') && csv.includes('משה כהן'), 'roster exports to a CSV Excel opens', csv.slice(0, 120));
  await p.fill('.roster-filters input[type=search]', 'יובל'); await wait(300);
  await hasNot('roster search narrows the table', 'גיל פרידמן'); await p.fill('.roster-filters input[type=search]', ''); await wait(300);
  await p.locator('table.roster tr', { hasText: 'דני כהן' }).getByRole('button', { name: 'עריכה' }).click(); await wait(800);
  await p.locator('.roster-editor li', { hasText: 'משה כהן' }).getByRole('button', { name: 'מחיקה' }).click().catch(() => {});
  await wait(800); await hasNot('admin removes a parent contact from a child', 'משה כהן');
  await p.locator('.roster-editor').getByRole('button', { name: 'מחיקת הילד מהמועדון' }).click(); await wait(800);
  await hasNot('admin deletes a child from the club', 'דני כהן');
  await p.click('role=tab[name="קבוצות"]'); await wait(500);
  await hasNot('no role strip on regular screens', 'החלפת תפקיד');
  await p.click('.topbar .who'); await wait(700); await has('role switch lives on the profile page', 'החלפת תפקיד');
  await p.click('text=החלפת תפקיד'); await wait(700); await has('back on the entry screen', 'איך נכנסים היום?');
  await p.click('.role-card:has-text("הורה")'); await wait(900); await has('switched to parent mode', 'נועה מזרחי');

  // system admin
  await pick('יוסי אברהם');
  await has('system admin sees clubs and the creation form', 'מועדון חדש', 'מכבי הצפון');
  await p.fill('input >> nth=0', 'מועדון בדיקה'); await p.click('button:has-text("יצירת מועדון")'); await wait(800); await has('club created', 'מועדון בדיקה');
  await p.click('role=navigation >> text=רשימות'); await wait(800); await has('lists screen', 'סוגי אירוע', 'אימון', 'גיבוש'); await shot('lists');

  out(errors.length === 0, 'no runtime errors', errors.slice(0, 3).join(' || '));
  await b.close(); console.log(fails ? `${fails} DEMO CHECKS FAILED` : 'ALL DEMO CHECKS PASSED'); process.exit(fails ? 1 : 0);
})();
