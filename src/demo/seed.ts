// Sample data for the in-browser demo. Nothing here is real.
type Row = Record<string, any>;
export type Tables = Record<string, Row[]>;

const day = 86400000;
const at = (offsetDays: number, hour: number, minute = 0) => {
  const d = new Date(Date.now() + offsetDays * day);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};
const ago = (days: number) => new Date(Date.now() - days * day).toISOString();
const ALL = ['system_admin', 'club_admin', 'coach', 'parent', 'player'];

export function seed(): Tables {
  const lk = (id: string, domain: string, name_he: string, sort_order: number, extra: Row = {}): Row => ({
    id, domain, slug: id, name_he, icon_path: null, parent_id: null, sport_id: null, club_id: null, sort_order, meta: {}, active: true, ...extra,
  });
  const lookups: Row[] = [
    lk('lk_train', 'event_type', 'אימון', 1), lk('lk_match', 'event_type', 'משחק', 2, { meta: { is_match: true } }), lk('lk_build', 'event_type', 'גיבוש', 3),
    lk('r_ill', 'absence_reason', 'מחלה', 1), lk('r_inj', 'absence_reason', 'פציעה', 2), lk('r_vac', 'absence_reason', 'חופשה', 3),
    lk('r_sch', 'absence_reason', 'לימודים', 4), lk('r_fam', 'absence_reason', 'אירוע משפחתי', 5), lk('r_oth', 'absence_reason', 'אחר', 6, { meta: { note_required: true } }),
    lk('fm11', 'match_format', '11 על 11', 1, { sport_id: 'sp_fb' }), lk('fm9', 'match_format', '9 על 9', 2, { sport_id: 'sp_fb' }),
    lk('fm7', 'match_format', '7 על 7', 3, { sport_id: 'sp_fb' }), lk('fm5', 'match_format', '5 על 5', 4, { sport_id: 'sp_fb' }),
    lk('bm5', 'match_format', '5 על 5', 1, { sport_id: 'sp_bb' }), lk('bm3', 'match_format', '3 על 3', 2, { sport_id: 'sp_bb' }),
    lk('st_goal', 'stat_type', 'שער', 1, { sport_id: 'sp_fb', meta: { scores: 1 } }), lk('st_assist', 'stat_type', 'בישול', 2, { sport_id: 'sp_fb' }),
    lk('st_yellow', 'stat_type', 'כרטיס צהוב', 3, { sport_id: 'sp_fb' }), lk('st_red', 'stat_type', 'כרטיס אדום', 4, { sport_id: 'sp_fb' }),
    lk('bs_1', 'stat_type', 'זריקה חופשית', 1, { sport_id: 'sp_bb' }), lk('bs_2', 'stat_type', 'סל 2 נקודות', 2, { sport_id: 'sp_bb' }),
    lk('bs_3', 'stat_type', 'סל 3 נקודות', 3, { sport_id: 'sp_bb' }), lk('bs_reb', 'stat_type', 'ריבאונד', 4, { sport_id: 'sp_bb' }),
  ];
  [['4-3-3', 'fm11'], ['4-4-2', 'fm11'], ['3-5-2', 'fm11'], ['4-2-3-1', 'fm11'], ['3-3-2', 'fm9'], ['3-2-3', 'fm9'], ['2-3-1', 'fm7'], ['3-2-1', 'fm7'], ['2-2', 'fm5'], ['1-2-1', 'fm5']]
    .forEach(([name, parent], i) => lookups.push(lk(`f_${name}`, 'formation', name, i + 1, { parent_id: parent, sport_id: 'sp_fb' })));

  const def = (id: string, scope: string, key: string, label_he: string, data_type: string, config: Row, visible_to: string[], editable_by: string[], extra: Row = {}): Row => ({
    id, scope, key, label_he, data_type, config, visible_to, editable_by, club_id: null, team_id: null, sport_id: null, sort_order: 0, active: true, ...extra,
  });
  const STAFF = ['system_admin', 'club_admin', 'coach'];
  const attribute_defs: Row[] = [
    def('d_allergy', 'player', 'medical_allergy', 'אלרגיה', 'text', {}, [...STAFF, 'parent'], ['coach', 'parent'], { sort_order: 10 }),
    def('d_cond', 'player', 'medical_condition', 'בעיה רפואית', 'text', {}, [...STAFF, 'parent'], ['coach', 'parent'], { sort_order: 11 }),
    def('d_minage', 'team', 'min_response_age', 'גיל מינימלי שבו שחקן עונה בעצמו', 'number', { min: 0, max: 21, default: 12 }, ALL, STAFF, { sort_order: 1 }),
    def('d_canresp', 'team', 'players_can_respond', 'פרופיל שחקן רשאי לאשר הגעה', 'boolean', { default: false }, ALL, STAFF, { sort_order: 2 }),
    def('d_dfmt', 'team', 'default_match_format', 'מספר שחקנים במגרש (ברירת מחדל)', 'lookup', { domain: 'match_format' }, ALL, STAFF, { sort_order: 3 }),
    def('d_dform', 'team', 'default_formation', 'מערך (ברירת מחדל)', 'lookup', { domain: 'formation', depends_on: 'default_match_format' }, ALL, STAFF, { sort_order: 4 }),
    def('d_efmt', 'event', 'match_format', 'מספר שחקנים במגרש', 'lookup', { domain: 'match_format', default_from_team: 'default_match_format' }, ALL, STAFF, { sort_order: 1 }),
    def('d_eform', 'event', 'formation', 'מערך', 'lookup', { domain: 'formation', depends_on: 'match_format', default_from_team: 'default_formation' }, ALL, STAFF, { sort_order: 2 }),
    def('d_ball', 'player', 'ball_control', 'שליטה בכדור', 'scale', { min: 1, max: 10 }, ALL, ['coach'], { team_id: 't1', club_id: 'c1', sort_order: 1 }),
    def('d_speed', 'player', 'speed', 'מהירות', 'scale', { min: 1, max: 10 }, ALL, ['coach'], { team_id: 't1', club_id: 'c1', sort_order: 2 }),
    def('d_team', 'player', 'teamwork', 'עבודת צוות', 'scale', { min: 1, max: 10 }, ALL, ['coach'], { team_id: 't1', club_id: 'c1', sort_order: 3 }),
  ];
  let seq = 0;
  const val = (def_id: string, entity_id: string, value: unknown, daysAgo: number, by = 'u_coach'): Row =>
    ({ id: `v${++seq}`, seq, def_id, entity_id, value, recorded_by: by, recorded_at: ago(daysAgo) });
  const attribute_values: Row[] = [
    val('d_ball', 'k1', 5, 120), val('d_ball', 'k1', 6, 80), val('d_ball', 'k1', 7, 40), val('d_ball', 'k1', 8, 7),
    val('d_speed', 'k1', 6, 80), val('d_speed', 'k1', 7, 7), val('d_team', 'k1', 7, 80), val('d_team', 'k1', 8, 7),
    val('d_ball', 'k2', 8, 90), val('d_ball', 'k2', 9, 10), val('d_speed', 'k2', 7, 10), val('d_team', 'k2', 9, 10),
    val('d_ball', 'k3', 6, 30), val('d_speed', 'k3', 8, 30),
    val('d_allergy', 'k1', 'בוטנים', 100, 'u_p1'), val('d_cond', 'k2', 'אסתמה קלה, ממליצים על משאף בתיק', 60, 'u_p2'),
    val('d_canresp', 't1', true, 30), val('d_minage', 't1', 12, 30), val('d_dfmt', 't1', 'fm11', 30), val('d_dform', 't1', 'f_4-3-3', 30),
    val('d_efmt', 'e_match', 'fm11', 5), val('d_eform', 'e_match', 'f_4-3-3', 5), val('d_efmt', 'e_past', 'fm11', 9), val('d_eform', 'e_past', 'f_4-4-2', 9),
  ];

  const player = (id: string, full_name: string, birth_date: string, user_id: string | null = null): Row =>
    ({ id, club_id: 'c1', full_name, birth_date, photo_path: null, photo_consent: false, user_id });

  const msg = (id: string, team_id: string, author_id: string, body: string, daysAgo: number): Row =>
    ({ id, team_id, author_id, body, created_at: ago(daysAgo) });

  return {
    sports: [
      { id: 'sp_fb', slug: 'football', name_he: 'כדורגל', sort_order: 1, icon_path: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 8l3.5 2.5-1.3 4H9.8l-1.3-4zM12 8V2M15.5 10.5l5-1.5M14.2 14.5l3 4M9.8 14.5l-3 4M8.5 10.5l-5-1.5' },
      { id: 'sp_bb', slug: 'basketball', name_he: 'כדורסל', sort_order: 2, icon_path: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 2v20M2 12h20M5 5c3 3 3 11 0 14M19 5c-3 3-3 11 0 14' },
    ],
    lookups,
    clubs: [{ id: 'c1', name: 'מכבי הצפון' }],
    teams: [
      { id: 't1', club_id: 'c1', name: 'ילדים ב׳', sport_id: 'sp_fb' },
      { id: 't2', club_id: 'c1', name: 'נוער כדורסל', sport_id: 'sp_bb' },
    ],
    profiles: [
      { id: 'u_sys', email: 'yossi@demo.nextteam.app', phone: null, full_name: 'יוסי אברהם', is_system_admin: true },
      { id: 'u_admin', email: 'ronit@demo.nextteam.app', phone: null, full_name: 'רונית מזרחי', is_system_admin: false },
      { id: 'u_coach', email: 'avi@demo.nextteam.app', phone: null, full_name: 'אבי כץ', is_system_admin: false },
      { id: 'u_coach2', email: 'michal@demo.nextteam.app', phone: null, full_name: 'מיכל ברק', is_system_admin: false },
      { id: 'u_p1', email: 'sara@demo.nextteam.app', phone: null, full_name: 'שרה כהן', is_system_admin: false },
      { id: 'u_k2', email: 'roni@demo.nextteam.app', phone: null, full_name: 'רוני לוי', is_system_admin: false },
      { id: 'u_p2', email: 'david@demo.nextteam.app', phone: null, full_name: 'דוד לוי', is_system_admin: false },
      { id: 'u_p4', email: 'ilana@demo.nextteam.app', phone: null, full_name: 'אילנה פרידמן', is_system_admin: false },
    ],
    memberships: [
      { id: 'm1', user_id: 'u_admin', club_id: 'c1', team_id: null, role: 'club_admin' },
      { id: 'm2', user_id: 'u_coach', club_id: 'c1', team_id: 't1', role: 'coach' },
      { id: 'm3', user_id: 'u_coach2', club_id: 'c1', team_id: 't2', role: 'coach' },
    ],
    players: [
      player('k1', 'דני כהן', '2014-05-01'), player('k2', 'רוני לוי', '2011-03-02', 'u_k2'), player('k3', 'נועה מזרחי', '2013-09-12'),
      player('k4', 'גיל פרידמן', '2014-01-20'), player('k5', 'תומר שמש', '2013-11-05'), player('k6', 'יובל אורן', '2012-07-30'),
    ],
    team_players: ['k1', 'k2', 'k3', 'k4', 'k5', 'k6'].map((player_id) => ({ team_id: 't1', player_id })),
    guardianships: [
      { id: 'g1', parent_id: 'u_p1', player_id: 'k1', status: 'approved' },
      { id: 'g2', parent_id: 'u_p2', player_id: 'k2', status: 'approved' },
      { id: 'g3', parent_id: 'u_admin', player_id: 'k3', status: 'approved' },
      { id: 'g4', parent_id: 'u_p4', player_id: 'k4', status: 'pending' },
    ],
    events: [
      { id: 'e_past', team_id: 't1', type_id: 'lk_match', title: 'משחק ליגה נגד בית״ר', starts_at: at(-3, 10), ends_at: null, location: 'מגרש בית״ר', notes: '', opponent: 'בית״ר', our_score: 2, their_score: 1 },
      { id: 'e_train', team_id: 't1', type_id: 'lk_train', title: 'אימון קבוצתי', starts_at: at(1, 17, 30), ends_at: null, location: 'מגרש 3', notes: 'להגיע עם מים וקרמפונים', opponent: null, our_score: null, their_score: null },
      { id: 'e_match', team_id: 't1', type_id: 'lk_match', title: 'משחק ליגה נגד הפועל', starts_at: at(4, 10), ends_at: null, location: 'אצטדיון עירוני', notes: 'התכנסות שעה לפני', opponent: 'הפועל', our_score: null, their_score: null },
      { id: 'e_build', team_id: 't1', type_id: 'lk_build', title: 'גיבוש סוף עונה', starts_at: at(9, 16), ends_at: null, location: 'פארק הירקון', notes: '', opponent: null, our_score: null, their_score: null },
      { id: 'e_bb', team_id: 't2', type_id: 'lk_train', title: 'אימון כדורסל', starts_at: at(2, 19), ends_at: null, location: 'אולם ספורט', notes: '', opponent: null, our_score: null, their_score: null },
    ],
    event_responses: [
      { event_id: 'e_train', player_id: 'k1', status: 'attending', reason_id: null, note: '', responded_at: ago(1) },
      { event_id: 'e_train', player_id: 'k2', status: 'not_attending', reason_id: 'r_sch', note: 'מבחן במתמטיקה', responded_at: ago(1) },
      { event_id: 'e_train', player_id: 'k3', status: 'attending', reason_id: null, note: '', responded_at: ago(1) },
      { event_id: 'e_match', player_id: 'k1', status: 'attending', reason_id: null, note: '', responded_at: ago(0) },
      { event_id: 'e_match', player_id: 'k2', status: 'attending', reason_id: null, note: '', responded_at: ago(0) },
    ],
    event_stats: [
      { id: 'es1', event_id: 'e_past', player_id: 'k2', stat_type_id: 'st_goal', minute: 12, note: '' },
      { id: 'es2', event_id: 'e_past', player_id: 'k1', stat_type_id: 'st_assist', minute: 12, note: '' },
      { id: 'es3', event_id: 'e_past', player_id: 'k6', stat_type_id: 'st_goal', minute: 55, note: '' },
      { id: 'es4', event_id: 'e_past', player_id: 'k5', stat_type_id: 'st_yellow', minute: 70, note: '' },
    ],
    attribute_defs,
    attribute_values,
    tasks: [
      { id: 'tk1', team_id: 't1', title: 'מתיחות 10 דקות כל יום', description: 'לפני השינה, ולסמן כאן שבוצע', due_at: at(6, 20), created_at: ago(3) },
      { id: 'tk2', team_id: 't1', title: '100 הרמות כדור', description: 'עד האימון הבא', due_at: at(1, 17), created_at: ago(2) },
    ],
    task_assignments: [
      ...['k1', 'k2', 'k3', 'k4', 'k5', 'k6'].flatMap((p, i) => [
        { id: `ta_p_${p}`, task_id: 'tk1', player_id: p, kind: 'player', done_at: i % 2 ? ago(1) : null, done_by: null },
        { id: `ta_h_${p}`, task_id: 'tk1', player_id: p, kind: 'parent', done_at: null, done_by: null },
      ]),
      { id: 'ta_x1', task_id: 'tk2', player_id: 'k1', kind: 'player', done_at: null, done_by: null },
      { id: 'ta_x2', task_id: 'tk2', player_id: 'k2', kind: 'player', done_at: ago(1), done_by: 'u_k2' },
    ],
    surveys: [{ id: 's1', team_id: 't1', title: 'טורניר סוף עונה: מי מגיע?', description: 'הטורניר ב־20 בחודש, נשמח לדעת כמה נהיה', closes_at: null, created_at: ago(2) }],
    survey_questions: [
      { id: 'q1', survey_id: 's1', text: 'האם תגיעו?', kind: 'single', position: 1 },
      { id: 'q2', survey_id: 's1', text: 'הערות', kind: 'text', position: 2 },
    ],
    survey_options: [
      { id: 'o1', question_id: 'q1', label: 'כן', position: 1 }, { id: 'o2', question_id: 'q1', label: 'לא', position: 2 }, { id: 'o3', question_id: 'q1', label: 'אולי', position: 3 },
    ],
    survey_answers: [
      { id: 'sa1', question_id: 'q1', respondent_id: 'u_p1', option_id: 'o1', text_answer: null },
      { id: 'sa2', question_id: 'q1', respondent_id: 'u_p2', option_id: 'o3', text_answer: null },
      { id: 'sa3', question_id: 'q2', respondent_id: 'u_p2', option_id: null, text_answer: 'תלוי בשעות המשחק' },
    ],
    messages: [
      msg('ms1', 't1', 'u_admin', 'ברוכים הבאים לעונה החדשה, בהצלחה לכולם!', 12),
      msg('ms2', 't1', 'u_coach', 'שלום לכולם. אימון מחר ב־17:30, נא להגיע עם מים.', 1),
      msg('ms3', 't1', 'u_p1', 'דני יגיע :)', 1),
      msg('ms4', 't1', 'u_p2', 'רוני בלי הסעה, מישהו מסיע מהצפון?', 0.5),
    ],
    conversations: [
      { id: 'cv1', team_id: 't1', player_id: 'k1', coach_id: 'u_coach' },
      { id: 'cv2', team_id: 't1', player_id: 'k2', coach_id: 'u_coach' },
    ],
    direct_messages: [
      { id: 'dm1', conversation_id: 'cv1', author_id: 'u_coach', body: 'דני, כל הכבוד על הבישול במשחק האחרון!', created_at: ago(3) },
      { id: 'dm2', conversation_id: 'cv1', author_id: 'u_p1', body: 'תודה מאמן, הוא מאוד שמח', created_at: ago(3) },
      { id: 'dm3', conversation_id: 'cv2', author_id: 'u_coach', body: 'רוני, אין בעיה אם תחסיר אימון בגלל המבחן. תעדכן אותי.', created_at: ago(1) },
      { id: 'dm4', conversation_id: 'cv2', author_id: 'u_k2', body: 'תודה מאמן', created_at: ago(1) },
    ],
  };
}

export const PERSONAS = [
  { id: 'u_coach', title: 'אבי כץ', role: 'מאמן', blurb: 'סגל, אירועים, אישורי הגעה, דירוגים, משימות וסקרים' },
  { id: 'u_p1', title: 'שרה כהן', role: 'הורה של דני', blurb: 'אישור הגעה, משימות, סקרים והודעות. דני בלי מייל משלו' },
  { id: 'u_k2', title: 'רוני לוי', role: 'שחקן', blurb: 'הפרופיל והמשימות שלי, אישור הגעה כשהקבוצה מאפשרת' },
  { id: 'u_admin', title: 'רונית מזרחי', role: 'מנהלת מועדון וגם הורה', blurb: 'בורר מצב בכניסה: ניהול המועדון או הורה של נועה' },
  { id: 'u_sys', title: 'יוסי אברהם', role: 'מנהל מערכת', blurb: 'מועדונים ורשימות המערכת' },
] as const;
