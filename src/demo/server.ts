// A small in-memory stand-in for the Supabase REST API, used only by the demo build.
// It serves the same tables, views and RPC names the app calls, with visibility rules that
// mirror the real row level security (permissions on writes are simplified).
import { seed, type Tables } from './seed';

type Row = Record<string, any>;

class PgError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
const STATUS: Record<string, number> = { '42501': 403, P0002: 404 };

export class DemoServer {
  t: Tables = seed();
  uid = '';
  private n = 100;

  reset() { this.t = seed(); }
  private id(prefix: string) { return `${prefix}${++this.n}`; }
  private find(table: string, id: string) { return this.t[table].find((r) => r.id === id); }

  // ------------------------------------------------------------ roles and visibility
  private get sys() { return !!this.find('profiles', this.uid)?.is_system_admin; }
  private adminOf(club: string) { return this.t.memberships.some((m) => m.user_id === this.uid && m.role === 'club_admin' && m.club_id === club); }
  private coachOf(team: string) { return this.t.memberships.some((m) => m.user_id === this.uid && m.role === 'coach' && m.team_id === team); }
  private clubOfTeam(team: string) { return this.find('teams', team)?.club_id as string; }
  private manageTeam(team: string) { return this.sys || this.coachOf(team) || this.adminOf(this.clubOfTeam(team)); }
  private teamsOf(player: string): string[] { return this.t.team_players.filter((x) => x.player_id === player).map((x) => x.team_id); }
  private parentOf(player: string) { return this.t.guardianships.some((g) => g.parent_id === this.uid && g.player_id === player && g.status === 'approved'); }
  private selfPlayer(player: string) { return this.find('players', player)?.user_id === this.uid; }
  private coachesPlayer(player: string) { return this.teamsOf(player).some((tm) => this.coachOf(tm)); }
  private managePlayer(player: string) {
    const p = this.find('players', player);
    return this.sys || this.coachesPlayer(player) || (!!p && this.adminOf(p.club_id));
  }
  private hasAccount(player: string) { return !!this.find('players', player)?.user_id; }
  private teamParent(team: string) { return this.t.team_players.some((x) => x.team_id === team && this.parentOf(x.player_id)); }
  private teamPlayer(team: string) { return this.t.team_players.some((x) => x.team_id === team && this.selfPlayer(x.player_id)); }
  private member(team: string) { return this.manageTeam(team) || this.teamParent(team) || this.teamPlayer(team) || this.adminOf(this.clubOfTeam(team)); }
  private canView(player: string) {
    return this.managePlayer(player) || this.parentOf(player) || this.selfPlayer(player) || this.teamsOf(player).some((tm) => this.member(tm));
  }
  private clubMember(club: string) {
    return this.sys || this.adminOf(club) || this.t.memberships.some((m) => m.user_id === this.uid && m.club_id === club)
      || this.t.players.some((p) => p.club_id === club && (p.user_id === this.uid || this.parentOf(p.id)));
  }
  private entityRoles(scope: string, id: string): string[] {
    const r: string[] = [];
    if (this.sys) r.push('system_admin');
    if (scope === 'player') {
      const p = this.find('players', id);
      if (p && this.adminOf(p.club_id)) r.push('club_admin');
      if (this.coachesPlayer(id)) r.push('coach');
      if (this.parentOf(id)) r.push('parent');
      if (this.selfPlayer(id)) r.push('player');
      return r;
    }
    const team = scope === 'team' ? id : this.find('events', id)?.team_id;
    if (!team) return r;
    if (this.adminOf(this.clubOfTeam(team))) r.push('club_admin');
    if (this.coachOf(team)) r.push('coach');
    if (this.teamParent(team)) r.push('parent');
    if (this.teamPlayer(team)) r.push('player');
    return r;
  }
  private assignmentVisible(a: Row) {
    const team = this.find('tasks', a.task_id)?.team_id;
    return this.manageTeam(team)
      || (a.kind === 'player' && (this.selfPlayer(a.player_id) || (this.parentOf(a.player_id) && !this.hasAccount(a.player_id))))
      || (a.kind === 'parent' && this.parentOf(a.player_id));
  }
  private convAccess(id: string) {
    const c = this.find('conversations', id);
    return !!c && (c.coach_id === this.uid || this.parentOf(c.player_id) || this.selfPlayer(c.player_id));
  }

  /** Rows of a table as the signed-in user would see them. */
  private visible(table: string): Row[] {
    const t = this.t;
    switch (table) {
      case 'profiles': case 'sports': case 'lookups': case 'attribute_defs': return t[table];
      case 'memberships': return t.memberships.filter((m) => m.user_id === this.uid || this.adminOf(m.club_id) || (m.team_id && this.coachOf(m.team_id)));
      case 'event_lineups': return t.event_lineups.filter((r) => this.manageTeam(this.find('events', r.event_id)?.team_id));
      case 'guardianships': return t.guardianships.filter((g) => g.parent_id === this.uid || this.selfPlayer(g.player_id) || this.coachesPlayer(g.player_id) || this.sys);
      case 'v_players': return t.players.filter((p) => this.canView(p.id)).map((p) => {
        const fam = this.managePlayer(p.id) || this.parentOf(p.id) || this.selfPlayer(p.id);
        return { id: p.id, club_id: p.club_id, full_name: p.full_name, birth_date: fam ? p.birth_date : null,
          photo_path: fam || p.photo_consent ? p.photo_path : null, photo_consent: p.photo_consent, has_account: !!p.user_id, is_me: p.user_id === this.uid };
      });
      case 'clubs': return t.clubs.filter((c) => this.clubMember(c.id));
      case 'teams': return t.teams.filter((x) => this.clubMember(x.club_id));
      case 'team_players': return t.team_players.filter((x) => this.member(x.team_id));
      case 'player_goals': return t.player_goals.filter((g) => this.managePlayer(g.player_id) || this.parentOf(g.player_id) || this.selfPlayer(g.player_id));
      case 'events': case 'surveys': case 'messages': case 'team_kits': return t[table].filter((r) => this.member(r.team_id));
      case 'event_responses': return t.event_responses.filter((r) => this.manageTeam(this.find('events', r.event_id)?.team_id) || this.parentOf(r.player_id) || this.selfPlayer(r.player_id));
      case 'event_stats': return t.event_stats.filter((r) => this.member(this.find('events', r.event_id)?.team_id));
      case 'attribute_values': return t.attribute_values.filter((v) => {
        const d = this.find('attribute_defs', v.def_id);
        return !!d && this.entityRoles(d.scope, v.entity_id).some((r) => (d.visible_to as string[]).includes(r));
      });
      case 'task_assignments': return t.task_assignments.filter((a) => this.assignmentVisible(a));
      case 'tasks': return t.tasks.filter((k) => this.manageTeam(k.team_id) || t.task_assignments.some((a) => a.task_id === k.id && this.assignmentVisible(a)));
      case 'survey_questions': return t.survey_questions.filter((x) => this.member(this.find('surveys', x.survey_id)?.team_id));
      case 'survey_options': return t.survey_options.filter((o) => this.member(this.find('surveys', this.find('survey_questions', o.question_id)?.survey_id)?.team_id));
      case 'survey_answers': return t.survey_answers.filter((a) => a.respondent_id === this.uid || this.manageTeam(this.find('surveys', this.find('survey_questions', a.question_id)?.survey_id)?.team_id));
      case 'conversations': return t.conversations.filter((c) => this.convAccess(c.id));
      case 'direct_messages': return t.direct_messages.filter((m) => this.convAccess(m.conversation_id));
      default: throw new PgError('42P01', `relation "${table}" does not exist`);
    }
  }

  // ------------------------------------------------------------ REST (GET)
  query(table: string, params: URLSearchParams, single: boolean): { status: number; body: unknown } {
    let rows = this.visible(table).slice();
    params.forEach((val, key) => {
      if (['select', 'order', 'limit', 'offset'].includes(key)) return;
      const m = /^(not\.)?(eq|neq|in|gte|lte|is)\.(.*)$/.exec(val);
      if (!m) return;
      const [, not, op, arg] = m;
      rows = rows.filter((r) => !!not !== (() => {
        const v = r[key];
        switch (op) {
          case 'eq': return String(v) === arg;
          case 'neq': return String(v) !== arg;
          case 'in': return arg.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, '')).includes(String(v));
          case 'gte': return v !== null && v !== undefined && String(v) >= arg;
          case 'lte': return v !== null && v !== undefined && String(v) <= arg;
          case 'is': return arg === 'null' ? v === null || v === undefined : String(v) === arg;
          default: return true;
        }
      })());
    });
    const order = params.get('order');
    if (order) {
      const keys = order.split(',').map((o) => { const [col, dir] = o.split('.'); return { col, desc: dir === 'desc' }; });
      rows.sort((a, b) => {
        for (const { col, desc } of keys) {
          const x = a[col], y = b[col];
          if (x === y) continue;
          const c = x === null || x === undefined ? 1 : y === null || y === undefined ? -1 : x < y ? -1 : 1;
          return desc ? -c : c;
        }
        return 0;
      });
    }
    const select = params.get('select');
    if (select && select !== '*') {
      const cols = select.split(',').map((s) => s.trim());
      rows = rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])));
    }
    if (single) {
      if (rows.length !== 1) return { status: 406, body: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: null, hint: null } };
      return { status: 200, body: rows[0] };
    }
    return { status: 200, body: rows };
  }

  // ------------------------------------------------------------ RPC
  rpc(name: string, a: Row): unknown {
    const fn = (this.rpcs as Record<string, (a: Row) => unknown>)[name];
    if (!fn) throw new PgError('42883', `function ${name} does not exist`);
    return fn.call(this, a) ?? null;
  }

  private deny(msg = 'not allowed'): never { throw new PgError('42501', msg); }
  private bad(msg: string): never { throw new PgError('22023', msg); }

  private teamParam(team: string, key: string): unknown {
    const def = this.t.attribute_defs.find((d) => d.scope === 'team' && d.key === key && (!d.team_id || d.team_id === team));
    if (!def) return null;
    const vals = this.t.attribute_values.filter((v) => v.def_id === def.id && v.entity_id === team);
    const last = vals.sort((x, y) => y.seq - x.seq)[0];
    return last && last.value !== null ? last.value : def.config.default ?? null;
  }

  private ageOf(birth: string) {
    const b = new Date(birth), now = new Date();
    let age = now.getFullYear() - b.getFullYear();
    if (now < new Date(now.getFullYear(), b.getMonth(), b.getDate())) age -= 1;
    return age;
  }

  private rpcs = {
    create_club(this: DemoServer, a: Row) {
      if (!this.sys) this.deny('only a system admin can create clubs');
      const id = this.id('c'); this.t.clubs.push({ id, name: String(a.p_name).trim() }); return id;
    },
    create_team(this: DemoServer, a: Row) {
      if (!this.sys && !this.adminOf(a.p_club)) this.deny();
      const id = this.id('t'); this.t.teams.push({ id, club_id: a.p_club, name: String(a.p_name).trim(), sport_id: a.p_sport }); return id;
    },
    set_club_logo(this: DemoServer, a: Row) {
      if (!this.sys && !this.adminOf(a.p_club)) this.deny();
      this.find('clubs', a.p_club)!.logo_path = a.p_path;
    },
    set_team_photo(this: DemoServer, a: Row) {
      if (!this.manageTeam(a.p_team)) this.deny();
      this.find('teams', a.p_team)!.photo_path = a.p_path;
    },
    set_my_avatar(this: DemoServer, a: Row) { this.find('profiles', this.uid)!.avatar_path = a.p_path; },
    update_club(this: DemoServer, a: Row) {
      if (!this.sys && !this.adminOf(a.p_club)) this.deny();
      if (!String(a.p_name ?? '').trim()) this.bad('name is required');
      this.find('clubs', a.p_club)!.name = String(a.p_name).trim();
    },
    delete_club(this: DemoServer, a: Row) {
      if (!this.sys) this.deny('only a system admin can delete a club');
      const teams = this.t.teams.filter((t) => t.club_id === a.p_club).map((t) => t.id);
      teams.forEach((id) => this.rpcs.delete_team.call(this, { p_team: id }));
      this.t.clubs = this.t.clubs.filter((c) => c.id !== a.p_club);
      this.t.memberships = this.t.memberships.filter((m) => m.club_id !== a.p_club);
      this.t.players = this.t.players.filter((p) => p.club_id !== a.p_club);
    },
    update_team(this: DemoServer, a: Row) {
      const team = this.find('teams', a.p_team);
      if (!team || !(this.sys || this.adminOf(team.club_id))) this.deny();
      if (!String(a.p_name ?? '').trim()) this.bad('name is required');
      team!.name = String(a.p_name).trim();
      if (a.p_sport) team!.sport_id = a.p_sport;
    },
    delete_team(this: DemoServer, a: Row) {
      const team = this.find('teams', a.p_team);
      if (!team || !(this.sys || this.adminOf(team.club_id))) this.deny();
      this.t.teams = this.t.teams.filter((t) => t.id !== a.p_team);
      this.t.team_players = this.t.team_players.filter((x) => x.team_id !== a.p_team);
      this.t.memberships = this.t.memberships.filter((m) => m.team_id !== a.p_team);
      this.t.events = this.t.events.filter((e) => e.team_id !== a.p_team);
    },
    invite_by_email(this: DemoServer, a: Row) {
      if (!this.sys && !this.adminOf(a.p_club)) this.deny('only a club admin can invite staff');
      return this.id('inv');
    },
    add_player(this: DemoServer, a: Row) {
      const team = this.find('teams', a.p_team);
      if (!team) throw new PgError('P0002', 'team not found');
      if (!this.manageTeam(team.id)) this.deny('only the coach or club admin can add players');
      if (!a.p_birth_date) this.bad('birth date is mandatory');
      const id = this.id('k');
      this.t.players.push({ id, club_id: team.club_id, full_name: String(a.p_full_name).trim(), birth_date: a.p_birth_date, photo_path: null, photo_consent: false, user_id: null });
      this.t.team_players.push({ team_id: team.id, player_id: id });
      if (a.p_parent_email) this.rpcs.invite_parent.call(this, { p_player: id, p_email: a.p_parent_email });
      if (a.p_email) this.rpcs.link_player_email.call(this, { p_player: id, p_email: a.p_email });
      return id;
    },
    add_player_to_team(this: DemoServer, a: Row) { this.t.team_players.push({ team_id: a.p_team, player_id: a.p_player }); },
    remove_player_from_team(this: DemoServer, a: Row) {
      if (!this.manageTeam(a.p_team)) this.deny();
      this.t.team_players = this.t.team_players.filter((x) => !(x.team_id === a.p_team && x.player_id === a.p_player));
    },
    update_player(this: DemoServer, a: Row) {
      const p = this.find('players', a.p_player);
      if (!p || !(this.managePlayer(p.id) || this.parentOf(p.id))) this.deny();
      if (a.p_full_name) p.full_name = String(a.p_full_name).trim();
      if (a.p_birth_date) p.birth_date = a.p_birth_date;
      if (a.p_photo_path) p.photo_path = a.p_photo_path;
    },
    set_photo_consent(this: DemoServer, a: Row) {
      if (!this.parentOf(a.p_player)) this.deny('only a parent can set photo consent');
      this.find('players', a.p_player)!.photo_consent = !!a.p_consent;
    },
    invite_parent(this: DemoServer, a: Row) {
      if (!this.managePlayer(a.p_player)) this.deny();
      const id = this.id('u_inv'); this.t.profiles.push({ id, email: a.p_email, phone: null, full_name: 'הורה (הוזמן)', is_system_admin: false });
      this.t.guardianships.push({ id: this.id('g'), parent_id: id, player_id: a.p_player, status: 'approved' });
    },
    link_player_email(this: DemoServer, a: Row) {
      if (!(this.managePlayer(a.p_player) || this.parentOf(a.p_player))) this.deny();
      const id = this.id('u_pl'); this.t.profiles.push({ id, email: a.p_email, phone: null, full_name: 'שחקן (הוזמן)', is_system_admin: false });
      this.find('players', a.p_player)!.user_id = id;
    },
    request_guardianship(this: DemoServer, a: Row) {
      const email = String(a.p_other_email ?? '').trim().toLowerCase();
      const other = this.t.profiles.find((p) => p.email === email);
      if (!other) throw new PgError('P0002', 'no user with this email');
      if (other.id === this.uid && !this.sys) this.bad('cannot link to yourself');
      const player = a.p_as_parent ? this.t.players.find((p) => p.user_id === other.id) : this.t.players.find((p) => p.user_id === this.uid);
      if (!player) throw new PgError('P0002', 'the player side has no player profile');
      const id = this.id('g');
      this.t.guardianships.push({ id, parent_id: a.p_as_parent ? this.uid : other.id, player_id: player.id, status: 'pending' });
      return id;
    },
    respond_guardianship(this: DemoServer, a: Row) {
      const g = this.find('guardianships', a.p_id);
      if (!g || g.status !== 'pending') throw new PgError('P0002', 'no pending request');
      if (!this.coachesPlayer(g.player_id)) this.deny("only the player's coach can respond");
      g.status = a.p_approve ? 'approved' : 'rejected';
    },
    create_event(this: DemoServer, a: Row) {
      if (!this.manageTeam(a.p_team)) this.deny('only the coach or club admin can create events');
      if (this.find('lookups', a.p_type)?.domain !== 'event_type') this.bad('unknown event type');
      const id = this.id('e');
      this.t.events.push({ id, team_id: a.p_team, type_id: a.p_type, title: a.p_title ?? '', starts_at: a.p_starts, ends_at: a.p_ends ?? null, location: a.p_location ?? '', notes: a.p_notes ?? '', opponent: a.p_opponent ?? null, our_score: null, their_score: null, equipment: [], created_at: new Date().toISOString() });
      return id;
    },
    set_event_equipment(this: DemoServer, a: Row) {
      const e = this.find('events', a.p_event);
      if (!e || !this.manageTeam(e.team_id)) this.deny();
      const items: string[] = a.p_items ?? [];
      if (items.some((i) => !this.t.lookups.some((l) => l.id === i && l.domain === 'equipment'))) this.bad('unknown item');
      e!.equipment = [...new Set(items)];
    },
    save_player_goal(this: DemoServer, a: Row) {
      if (!this.managePlayer(a.p_player)) this.deny();
      const title = String(a.p_title ?? '').trim();
      if (!title) this.bad('title is required');
      if (!a.p_id) {
        const id = this.id('pg');
        this.t.player_goals.push({ id, player_id: a.p_player, title, target_date: a.p_target ?? null, done_at: null, archived: false, created_by: this.uid, created_at: new Date().toISOString() });
        return id;
      }
      const g = this.find('player_goals', a.p_id);
      if (!g || g.player_id !== a.p_player) throw new PgError('P0002', 'goal not found');
      Object.assign(g, { title, target_date: a.p_target ?? null, archived: !!a.p_archived, done_at: a.p_done ? g.done_at ?? new Date().toISOString() : null });
      return g.id;
    },
    save_team_kit(this: DemoServer, a: Row) {
      if (!this.manageTeam(a.p_team)) this.deny();
      if (![a.p_shirt, a.p_shorts, a.p_socks].every((c) => /^#[0-9a-fA-F]{6}$/.test(String(c)))) this.bad('colour must be #rrggbb');
      const fields = { name: String(a.p_name).trim(), shirt: a.p_shirt, shorts: a.p_shorts, socks: a.p_socks };
      if (!a.p_id) {
        const id = this.id('kit');
        this.t.team_kits.push({ id, team_id: a.p_team, ...fields, sort_order: this.t.team_kits.length, active: true });
        return id;
      }
      const k = this.find('team_kits', a.p_id);
      if (!k || k.team_id !== a.p_team) throw new PgError('P0002', 'kit not found');
      Object.assign(k, fields, { active: a.p_active ?? true });
      return k.id;
    },
    set_event_kit(this: DemoServer, a: Row) {
      const e = this.find('events', a.p_event);
      if (!e || !this.manageTeam(e.team_id)) this.deny();
      e!.kit_id = a.p_kit ?? null;
    },
    create_event_series(this: DemoServer, a: Row) {
      if (!this.manageTeam(a.p_team)) this.deny('only the coach or club admin can create events');
      const days: number[] = a.p_days ?? [];
      if (!days.length) this.bad('choose at least one weekday');
      const [h, m] = String(a.p_start).split(':').map(Number);
      const series = this.id('s');
      let n = 0;
      for (let d = new Date(`${a.p_from}T00:00`); d <= new Date(`${a.p_until}T00:00`); d.setDate(d.getDate() + 1)) {
        if (!days.includes(d.getDay())) continue;
        if (++n > 100) this.bad('too many events (at most 100 at once)');
        const start = new Date(d); start.setHours(h, m, 0, 0);
        const end = a.p_duration_min ? new Date(start.getTime() + a.p_duration_min * 60_000).toISOString() : null;
        this.t.events.push({ id: this.id('e'), team_id: a.p_team, type_id: a.p_type, title: a.p_title ?? '', starts_at: start.toISOString(), ends_at: end,
          location: a.p_location ?? '', notes: a.p_notes ?? '', opponent: null, our_score: null, their_score: null, kit_id: a.p_kit ?? null, series_id: series, equipment: [], created_at: new Date(Date.now() + n).toISOString() });
      }
      return n;
    },
    update_event(this: DemoServer, a: Row) {
      const e = this.find('events', a.p_event);
      if (!e || !this.manageTeam(e.team_id)) this.deny();
      const map: Record<string, string> = { p_title: 'title', p_starts: 'starts_at', p_location: 'location', p_notes: 'notes', p_opponent: 'opponent', p_our_score: 'our_score', p_their_score: 'their_score' };
      for (const [k, col] of Object.entries(map)) if (a[k] !== undefined && a[k] !== null) e[col] = a[k];
    },
    save_event_details(this: DemoServer, a: Row) {
      const e = this.find('events', a.p_event);
      if (!e || !this.manageTeam(e.team_id)) this.deny();
      if (this.find('lookups', a.p_type)?.domain !== 'event_type') this.bad('unknown event type');
      if (a.p_ends && a.p_ends < a.p_starts) this.bad('the end must be after the start');
      Object.assign(e, {
        type_id: a.p_type, title: String(a.p_title ?? '').trim(), starts_at: a.p_starts, ends_at: a.p_ends ?? null, location: String(a.p_location ?? '').trim(),
        notes: a.p_notes ?? '', opponent: String(a.p_opponent ?? '').trim() || null, our_score: a.p_our_score ?? null, their_score: a.p_their_score ?? null,
      });
    },
    set_event_lineup(this: DemoServer, a: Row) {
      const e = this.find('events', a.p_event);
      if (!e || !this.manageTeam(e.team_id)) this.deny();
      const ids = (a.p_players ?? []) as (string | null)[];
      if (new Set(ids.filter(Boolean)).size !== ids.filter(Boolean).length) this.bad('a player can stand in one slot only');
      this.t.event_lineups = this.t.event_lineups.filter((r) => r.event_id !== a.p_event);
      ids.forEach((player_id, slot) => { if (player_id) this.t.event_lineups.push({ event_id: a.p_event, slot, player_id }); });
    },
    set_guardian_relation(this: DemoServer, a: Row) {
      if (!((a.p_parent === this.uid && this.parentOf(a.p_player)) || this.managePlayer(a.p_player))) this.deny();
      const g = this.t.guardianships.find((x) => x.player_id === a.p_player && x.parent_id === a.p_parent && x.status === 'approved');
      if (!g) throw new PgError('P0002', 'no such parent');
      g.relation_id = a.p_relation ?? null;
    },
    player_guardians(this: DemoServer, a: Row) {
      if (!(this.managePlayer(a.p_player) || this.parentOf(a.p_player) || this.selfPlayer(a.p_player))) return [];
      return this.t.guardianships.filter((g) => g.player_id === a.p_player && g.status === 'approved').map((g) => {
        const p = this.find('profiles', g.parent_id);
        return { parent_id: g.parent_id, full_name: p?.full_name || p?.email || '', avatar_path: p?.avatar_path ?? null, relation_id: g.relation_id ?? null };
      });
    },
    set_staff_role(this: DemoServer, a: Row) {
      const m = this.find('memberships', a.p_membership);
      if (!m) throw new PgError('P0002', 'not found');
      if (!(this.sys || this.adminOf(m.club_id) || (m.team_id && this.coachOf(m.team_id)))) this.deny();
      m.staff_role_id = a.p_role ?? null;
    },
    team_staff(this: DemoServer, a: Row) {
      if (!this.member(a.p_team)) return [];
      const order = (id: string | null) => this.find('lookups', id ?? '')?.sort_order ?? 99;
      return this.t.memberships.filter((m) => m.team_id === a.p_team && m.role === 'coach')
        .sort((x, y) => order(x.staff_role_id) - order(y.staff_role_id))
        .map((m) => {
          const p = this.find('profiles', m.user_id);
          return { membership_id: m.id, user_id: m.user_id, full_name: p?.full_name || p?.email || '', avatar_path: p?.avatar_path ?? null, staff_role_id: m.staff_role_id ?? null };
        });
    },
    update_my_profile(this: DemoServer, a: Row) {
      const phone = normPhone(a.p_phone);
      if (phone && this.t.profiles.some((p) => p.phone === phone && p.id !== this.uid)) throw new PgError('23505', 'this phone number belongs to another account');
      const me = this.find('profiles', this.uid)!;
      me.full_name = String(a.p_full_name ?? '').trim() || me.full_name;
      me.phone = phone;
    },
    player_details(this: DemoServer, a: Row) {
      const p = this.find('players', a.p_player);
      if (!p || !(this.managePlayer(p.id) || this.parentOf(p.id) || this.selfPlayer(p.id))) return [];
      return [{ id: p.id, full_name: p.full_name, birth_date: p.birth_date, phone: p.phone ?? null, photo_path: p.photo_path ?? null,
        photo_consent: !!p.photo_consent, account_email: p.user_id ? this.find('profiles', p.user_id)?.email ?? null : null,
        invite_email: null, can_edit: this.managePlayer(p.id) || this.parentOf(p.id), is_parent: this.parentOf(p.id) }];
    },
    set_player_phone(this: DemoServer, a: Row) {
      if (!(this.managePlayer(a.p_player) || this.parentOf(a.p_player))) this.deny();
      this.find('players', a.p_player)!.phone = normPhone(a.p_phone);
    },
    update_club_details(this: DemoServer, a: Row) {
      if (!(this.sys || this.adminOf(a.p_club))) this.deny();
      const email = String(a.p_email ?? '').trim().toLowerCase();
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) this.bad('invalid email');
      Object.assign(this.find('clubs', a.p_club)!, { phone: normPhone(a.p_phone), email: email || null,
        address: String(a.p_address ?? '').trim(), website: String(a.p_website ?? '').trim() });
    },
    team_contacts(this: DemoServer, a: Row) {
      if (!this.member(a.p_team)) return [];
      const club = this.clubOfTeam(a.p_team);
      const person = (kind: string, id: string, extra: Row = {}) => {
        const p = this.find('profiles', id)!;
        return { kind, person_id: id, full_name: p.full_name || p.email || '', avatar_path: p.avatar_path ?? null, email: p.email ?? null,
          phone: p.phone ?? null, staff_role_id: null, note: null, ...extra };
      };
      const kids = this.t.team_players.filter((x) => x.team_id === a.p_team).map((x) => this.find('players', x.player_id)!);
      const parents = new Map<string, string[]>();
      this.t.guardianships.filter((g) => g.status === 'approved' && kids.some((k) => k.id === g.player_id))
        .forEach((g) => parents.set(g.parent_id, [...(parents.get(g.parent_id) ?? []), this.find('players', g.player_id)!.full_name]));
      const rows = [
        ...this.t.memberships.filter((m) => m.club_id === club && m.role === 'club_admin').map((m) => person('admin', m.user_id)),
        ...[...parents].map(([id, names]) => person('parent', id, { note: names.sort().join(', ') })),
        ...(this.t.guardian_contacts ?? []).filter((c) => kids.some((k) => k.id === c.player_id)).map((c) => ({ kind: 'parent', person_id: c.id,
          full_name: c.full_name, avatar_path: null, email: c.email ?? null, phone: c.phone ?? null, staff_role_id: null, note: this.find('players', c.player_id)!.full_name })),
        ...kids.map((k) => ({ kind: 'player', person_id: k.id, full_name: k.full_name, avatar_path: null,
          email: k.user_id ? this.find('profiles', k.user_id)?.email ?? null : null, phone: k.phone ?? null, staff_role_id: null, note: null })),
        ...this.t.memberships.filter((m) => m.team_id === a.p_team && m.role === 'coach').map((m) => person('staff', m.user_id, { staff_role_id: m.staff_role_id ?? null })),
      ];
      return rows.sort((x, y) => x.kind.localeCompare(y.kind) || x.full_name.localeCompare(y.full_name, 'he'));
    },
    player_parents(this: DemoServer, a: Row) {
      if (!(this.managePlayer(a.p_player) || this.parentOf(a.p_player) || this.selfPlayer(a.p_player))) return [];
      const accounts = this.t.guardianships.filter((g) => g.player_id === a.p_player && g.status === 'approved').map((g) => {
        const p = this.find('profiles', g.parent_id)!;
        return { kind: 'account', id: p.id, full_name: p.full_name || p.email || '', avatar_path: p.avatar_path ?? null, relation_id: g.relation_id ?? null, phone: p.phone ?? null, email: p.email ?? null };
      });
      const contacts = (this.t.guardian_contacts ?? []).filter((c) => c.player_id === a.p_player)
        .map((c) => ({ kind: 'contact', id: c.id, full_name: c.full_name, avatar_path: null, relation_id: c.relation_id ?? null, phone: c.phone ?? null, email: c.email ?? null }));
      const byName = (x: Row, y: Row) => String(x.full_name).localeCompare(String(y.full_name), 'he');
      return [...accounts.sort(byName), ...contacts.sort(byName)];
    },
    add_guardian(this: DemoServer, a: Row) {
      if (!(this.managePlayer(a.p_player) || this.parentOf(a.p_player))) this.deny();
      if (!String(a.p_full_name ?? '').trim()) this.bad('a name is required');
      const email = String(a.p_email ?? '').trim().toLowerCase() || null;
      const account = email ? this.t.profiles.find((p) => p.email === email) : null;
      if (account) {
        if (this.t.guardianships.some((g) => g.player_id === a.p_player && g.parent_id === account.id && g.status === 'approved')) throw new PgError('23505', 'this parent is already linked to the child');
        this.t.guardianships.push({ id: this.id('g'), parent_id: account.id, player_id: a.p_player, status: 'approved', relation_id: a.p_relation ?? null });
        return;
      }
      (this.t.guardian_contacts ??= []).push({ id: this.id('gc'), player_id: a.p_player, full_name: String(a.p_full_name).trim(), relation_id: a.p_relation ?? null, phone: normPhone(a.p_phone), email });
    },
    update_guardian_contact(this: DemoServer, a: Row) {
      const c = (this.t.guardian_contacts ?? []).find((x) => x.id === a.p_id);
      if (!c) throw new PgError('P0002', 'not found');
      if (!(this.managePlayer(c.player_id) || this.parentOf(c.player_id))) this.deny();
      Object.assign(c, { full_name: String(a.p_full_name ?? '').trim() || c.full_name, relation_id: a.p_relation ?? null, phone: normPhone(a.p_phone), email: String(a.p_email ?? '').trim().toLowerCase() || null });
    },
    remove_guardian_contact(this: DemoServer, a: Row) {
      const c = (this.t.guardian_contacts ?? []).find((x) => x.id === a.p_id);
      if (!c) throw new PgError('P0002', 'not found');
      if (!(this.managePlayer(c.player_id) || this.parentOf(c.player_id))) this.deny();
      this.t.guardian_contacts = this.t.guardian_contacts.filter((x) => x.id !== a.p_id);
    },
    unlink_guardian(this: DemoServer, a: Row) {
      if (!this.managePlayer(a.p_player)) this.deny();
      this.t.guardianships = this.t.guardianships.filter((g) => !(g.player_id === a.p_player && g.parent_id === a.p_parent));
    },
    update_parent_profile(this: DemoServer, a: Row) {
      if (!this.t.guardianships.some((g) => g.parent_id === a.p_parent && g.status === 'approved' && this.managePlayer(g.player_id))) this.deny();
      const p = this.find('profiles', a.p_parent)!;
      p.full_name = String(a.p_full_name ?? '').trim() || p.full_name;
      p.phone = normPhone(a.p_phone);
    },
    delete_player(this: DemoServer, a: Row) {
      const p = this.find('players', a.p_player);
      if (!p) throw new PgError('P0002', 'not found');
      if (!(this.sys || this.adminOf(p.club_id))) this.deny();
      const t = this.t;
      t.players = t.players.filter((x) => x.id !== p.id);
      for (const k of ['team_players', 'guardianships', 'guardian_contacts', 'event_responses', 'event_stats', 'task_assignments', 'player_goals']) {
        if (t[k]) t[k] = t[k].filter((x) => x.player_id !== p.id);
      }
      t.attribute_values = t.attribute_values.filter((v) => v.entity_id !== p.id);
    },
    club_roster(this: DemoServer, a: Row) {
      return this.t.players
        .filter((p) => p.club_id === a.p_club && (this.sys || this.adminOf(a.p_club) || this.coachesPlayer(p.id)))
        .filter((p) => !a.p_team || this.t.team_players.some((x) => x.team_id === a.p_team && x.player_id === p.id))
        .sort((x, y) => String(x.full_name).localeCompare(String(y.full_name), 'he'))
        .map((p) => {
          const teams = this.teamsOf(p.id).map((id) => this.find('teams', id)!).sort((x, y) => String(x.name).localeCompare(String(y.name), 'he'));
          return { player_id: p.id, full_name: p.full_name, birth_date: p.birth_date, phone: p.phone ?? null,
            email: p.user_id ? this.find('profiles', p.user_id)?.email ?? null : null,
            team_ids: teams.map((t) => t.id), team_names: teams.map((t) => t.name).join(', '),
            parents: this.rpcs.player_parents.call(this, { p_player: p.id }) };
        });
    },
    delete_event(this: DemoServer, a: Row) {
      const e = this.find('events', a.p_event);
      if (!e || !this.manageTeam(e.team_id)) this.deny();
      this.t.events = this.t.events.filter((x) => x.id !== a.p_event);
      this.t.event_responses = this.t.event_responses.filter((x) => x.event_id !== a.p_event);
      this.t.event_stats = this.t.event_stats.filter((x) => x.event_id !== a.p_event);
    },
    respond_event(this: DemoServer, a: Row) {
      const e = this.find('events', a.p_event);
      if (!e) throw new PgError('P0002', 'event not found');
      let allowed = this.parentOf(a.p_player);
      if (!allowed && this.selfPlayer(a.p_player)) {
        allowed = this.teamParam(e.team_id, 'players_can_respond') === true
          && this.ageOf(this.find('players', a.p_player)!.birth_date) >= Number(this.teamParam(e.team_id, 'min_response_age') ?? 0);
      }
      if (!allowed) this.deny('not allowed to answer for this player');
      if (a.p_status === 'not_attending' && !a.p_reason) this.bad('a reason is required when not attending');
      const rows = this.t.event_responses;
      const i = rows.findIndex((r) => r.event_id === a.p_event && r.player_id === a.p_player);
      const row = { event_id: a.p_event, player_id: a.p_player, status: a.p_status, reason_id: a.p_status === 'attending' ? null : a.p_reason, note: a.p_status === 'attending' ? '' : a.p_note ?? '', responded_at: new Date().toISOString() };
      if (i >= 0) rows[i] = row; else rows.push(row);
    },
    record_stat(this: DemoServer, a: Row) {
      const e = this.find('events', a.p_event);
      if (!e || !this.manageTeam(e.team_id)) this.deny();
      if (!this.find('lookups', e.type_id)?.meta?.is_match) this.bad('statistics can only be recorded on a match');
      const id = this.id('es'); this.t.event_stats.push({ id, event_id: a.p_event, player_id: a.p_player, stat_type_id: a.p_stat_type, minute: a.p_minute ?? null, note: a.p_note ?? '' }); return id;
    },
    delete_stat(this: DemoServer, a: Row) { this.t.event_stats = this.t.event_stats.filter((s) => s.id !== a.p_stat); },
    create_task(this: DemoServer, a: Row) {
      if (!this.manageTeam(a.p_team)) this.deny('only the coach or club admin can create tasks');
      const players = this.t.team_players.filter((x) => x.team_id === a.p_team && (!a.p_player_ids || a.p_player_ids.includes(x.player_id))).map((x) => x.player_id);
      if (!players.length) this.bad('no players selected');
      const id = this.id('tk');
      this.t.tasks.push({ id, team_id: a.p_team, title: String(a.p_title).trim(), description: a.p_description ?? '', due_at: a.p_due ?? null, created_at: new Date().toISOString() });
      for (const p of players) {
        if (a.p_for_players) this.t.task_assignments.push({ id: this.id('ta'), task_id: id, player_id: p, kind: 'player', done_at: null, done_by: null });
        if (a.p_for_parents) this.t.task_assignments.push({ id: this.id('ta'), task_id: id, player_id: p, kind: 'parent', done_at: null, done_by: null });
      }
      return id;
    },
    delete_task(this: DemoServer, a: Row) {
      this.t.tasks = this.t.tasks.filter((k) => k.id !== a.p_task);
      this.t.task_assignments = this.t.task_assignments.filter((x) => x.task_id !== a.p_task);
    },
    complete_assignment(this: DemoServer, a: Row) {
      const x = this.find('task_assignments', a.p_assignment);
      if (!x) throw new PgError('P0002', 'not found');
      if (!this.assignmentVisible(x) || this.manageTeam(this.find('tasks', x.task_id)?.team_id)) this.deny('not your task');
      x.done_at = a.p_done ? new Date().toISOString() : null; x.done_by = a.p_done ? this.uid : null;
    },
    create_survey(this: DemoServer, a: Row) {
      if (!this.manageTeam(a.p_team)) this.deny('only the coach or club admin can create surveys');
      if (!Array.isArray(a.p_questions) || !a.p_questions.length) this.bad('a survey needs at least one question');
      const id = this.id('s');
      this.t.surveys.push({ id, team_id: a.p_team, title: String(a.p_title).trim(), description: a.p_description ?? '', closes_at: a.p_closes ?? null, created_at: new Date().toISOString() });
      a.p_questions.forEach((q: Row, i: number) => {
        const qid = this.id('q');
        this.t.survey_questions.push({ id: qid, survey_id: id, text: q.text, kind: q.kind ?? 'single', position: i + 1 });
        if ((q.kind ?? 'single') !== 'text') {
          if ((q.options ?? []).length < 2) this.bad('a choice question needs at least two options');
          q.options.forEach((label: string, j: number) => this.t.survey_options.push({ id: this.id('o'), question_id: qid, label, position: j + 1 }));
        }
      });
      return id;
    },
    delete_survey(this: DemoServer, a: Row) { this.t.surveys = this.t.surveys.filter((s) => s.id !== a.p_survey); },
    submit_survey(this: DemoServer, a: Row) {
      const s = this.find('surveys', a.p_survey);
      if (!s || !this.member(s.team_id)) this.deny();
      const qids = this.t.survey_questions.filter((q) => q.survey_id === s.id).map((q) => q.id);
      this.t.survey_answers = this.t.survey_answers.filter((x) => !(x.respondent_id === this.uid && qids.includes(x.question_id)));
      for (const ans of a.p_answers as Row[]) {
        if (ans.text !== undefined) {
          if (String(ans.text).trim()) this.t.survey_answers.push({ id: this.id('sa'), question_id: ans.question_id, respondent_id: this.uid, option_id: null, text_answer: ans.text });
        } else for (const o of ans.option_ids ?? []) this.t.survey_answers.push({ id: this.id('sa'), question_id: ans.question_id, respondent_id: this.uid, option_id: o, text_answer: null });
      }
    },
    post_message(this: DemoServer, a: Row) {
      if (!(this.manageTeam(a.p_team) || this.teamParent(a.p_team))) this.deny('new row violates row-level security policy for table "messages"');
      const id = this.id('ms'); this.t.messages.push({ id, team_id: a.p_team, author_id: this.uid, body: String(a.p_body).trim(), created_at: new Date().toISOString() }); return id;
    },
    start_conversation(this: DemoServer, a: Row) {
      if (!this.coachOf(a.p_team)) this.deny('only the team coach can start a personal conversation');
      const ex = this.t.conversations.find((c) => c.team_id === a.p_team && c.player_id === a.p_player && c.coach_id === this.uid);
      if (ex) return ex.id;
      const id = this.id('cv'); this.t.conversations.push({ id, team_id: a.p_team, player_id: a.p_player, coach_id: this.uid }); return id;
    },
    post_direct_message(this: DemoServer, a: Row) {
      if (!this.convAccess(a.p_conversation)) this.deny();
      const id = this.id('dm'); this.t.direct_messages.push({ id, conversation_id: a.p_conversation, author_id: this.uid, body: String(a.p_body).trim(), created_at: new Date().toISOString() }); return id;
    },
    create_attribute_def(this: DemoServer, a: Row) {
      const club = a.p_team ? this.clubOfTeam(a.p_team) : a.p_club;
      if (!(this.sys || (club && this.adminOf(club)) || (a.p_team && this.coachOf(a.p_team)))) this.deny('not allowed to define parameters here');
      const id = this.id('d');
      this.t.attribute_defs.push({ id, scope: a.p_scope, key: a.p_key, label_he: a.p_label, data_type: a.p_type, config: a.p_config ?? {}, visible_to: a.p_visible_to, editable_by: a.p_editable_by, club_id: club ?? null, team_id: a.p_team ?? null, sport_id: a.p_sport ?? null, sort_order: a.p_sort ?? 50, active: true });
      return id;
    },
    update_attribute_def(this: DemoServer, a: Row) {
      const d = this.find('attribute_defs', a.p_def);
      if (!d) throw new PgError('P0002', 'not found');
      if (a.p_active !== undefined && a.p_active !== null) d.active = a.p_active;
      if (a.p_label) d.label_he = a.p_label;
    },
    set_attribute(this: DemoServer, a: Row) {
      const d = this.find('attribute_defs', a.p_def);
      if (!d || !d.active) throw new PgError('P0002', 'unknown parameter');
      if (!this.entityRoles(d.scope, a.p_entity).some((r) => (d.editable_by as string[]).includes(r))) this.deny('not allowed to edit this parameter');
      const v = a.p_value;
      if (v !== null) {
        if (d.data_type === 'scale') {
          const min = d.config.min ?? 1, max = d.config.max ?? 10;
          if (typeof v !== 'number' || !Number.isInteger(v)) this.bad('whole number expected');
          if (v < min || v > max) throw new PgError('22003', 'value out of range');
        }
        if (d.data_type === 'number' && typeof v !== 'number') this.bad('number expected');
        if (d.data_type === 'lookup' && this.find('lookups', v)?.domain !== d.config.domain) this.bad('value is not in the list');
      }
      const id = this.id('v'); const seq = this.t.attribute_values.reduce((m, x) => Math.max(m, x.seq ?? 0), 0) + 1;
      this.t.attribute_values.push({ id, seq, def_id: d.id, entity_id: a.p_entity, value: v, recorded_by: this.uid, recorded_at: new Date().toISOString() });
      return id;
    },
    team_param(this: DemoServer, a: Row) { return this.member(a.p_team) ? this.teamParam(a.p_team, a.p_key) : null; },
    upsert_lookup(this: DemoServer, a: Row) {
      if (!this.sys && !(a.p_club && this.adminOf(a.p_club))) this.deny('not allowed to manage this list');
      if (a.p_id) {
        const l = this.find('lookups', a.p_id);
        if (!l || (!this.sys && l.club_id !== a.p_club)) throw new PgError('P0002', 'value not found or not yours');
        Object.assign(l, { name_he: a.p_name_he, sort_order: a.p_sort ?? l.sort_order, active: a.p_active ?? l.active });
        return l.id;
      }
      const id = this.id('lk');
      this.t.lookups.push({ id, domain: a.p_domain, slug: a.p_slug, name_he: a.p_name_he, icon_path: null, parent_id: a.p_parent ?? null, sport_id: a.p_sport ?? null, club_id: a.p_club ?? null, sort_order: a.p_sort ?? 0, meta: a.p_meta ?? {}, active: a.p_active ?? true });
      return id;
    },
  };

  // Direct row writes the app makes (club and team edit/delete), mapped to the same permission checks.
  private write(table: string, method: string, params: URLSearchParams, body: Row) {
    const id = (params.get('id') ?? '').replace(/^eq\./, '');
    const ops: Record<string, () => void> = {
      'PATCH clubs': () => this.rpcs.update_club.call(this, { p_club: id, p_name: body.name }),
      'DELETE clubs': () => this.rpcs.delete_club.call(this, { p_club: id }),
      'PATCH teams': () => this.rpcs.update_team.call(this, { p_team: id, p_name: body.name, p_sport: body.sport_id }),
      'DELETE teams': () => this.rpcs.delete_team.call(this, { p_team: id }),
      'PATCH profiles': () => {
        if (id !== this.uid) this.deny();
        this.find('profiles', id)!.full_name = String(body.full_name ?? '').trim();
      },
    };
    const op = ops[`${method} ${table}`];
    if (!op) this.deny();
    op();
    return [{ id }];
  }

  // ------------------------------------------------------------ the fetch the Supabase client uses
  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const json = (status: number, body: unknown) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    try {
      if (url.pathname.startsWith('/rest/v1/rpc/')) {
        const name = url.pathname.split('/').pop() as string;
        const args = init?.body ? JSON.parse(String(init.body)) : {};
        return json(200, this.rpc(name, args));
      }
      if (url.pathname.startsWith('/rest/v1/')) {
        const table = url.pathname.split('/').pop() as string;
        const method = (init?.method ?? 'GET').toUpperCase();
        if (method === 'PATCH' || method === 'DELETE') {
          return json(200, this.write(table, method, url.searchParams, init?.body ? JSON.parse(String(init.body)) : {}));
        }
        const accept = new Headers(init?.headers).get('Accept') ?? '';
        const r = this.query(table, url.searchParams, accept.includes('pgrst.object'));
        return json(r.status, r.body);
      }
      if (url.pathname === '/functions/v1/league') return json(200, DEMO_LEAGUE());
      if (url.pathname.startsWith('/storage/')) {
        return json(400, { statusCode: '400', error: 'demo', message: 'העלאת תמונה אינה זמינה בדמו' });
      }
      return json(200, {});
    } catch (e) {
      const err = e as PgError;
      return json(STATUS[err.code] ?? 400, { code: err.code ?? 'P0001', message: err.message, details: null, hint: null });
    }
  };
}

// The demo's places and teams are made up, so the league tab shows a sample table instead of the real site.
const DEMO_LEAGUE = () => {
  const team = (pos: number, name: string, id: number, g: number, w: number, d: number, l: number, gf: number, ga: number) =>
    ({ cells: [String(pos), name, String(g), String(w), String(d), String(l), `${gf}-${ga}`, String(w * 3 + d)], href: `https://www.football.org.il/team-details/?team_id=${id}&season_id=28` });
  const day = (offset: number) => new Date(Date.now() + offset * 86400000).toLocaleDateString('he-IL');
  return {
    title: 'מכבי הצפון ילדים ב׳ (דמו)', sourceUrl: 'https://www.football.org.il/team-details/?team_id=8776&season_id=28',
    leagueUrl: null, teamId: '8776', fetchedAt: new Date().toISOString(),
    standings: {
      title: 'טבלת ליגה (נתוני דמו)', columns: ['מיקום', 'קבוצה', 'משחקים', 'ניצחונות', 'תיקו', 'הפסדים', 'שערים', 'נקודות'],
      rows: [
        team(1, 'הפועל השרון', 1001, 8, 6, 1, 1, 22, 8), team(2, 'מכבי הצפון ילדים ב׳', 8776, 8, 5, 2, 1, 19, 9),
        team(3, 'בית״ר העמק', 1003, 8, 4, 2, 2, 14, 11), team(4, 'עירוני הגליל', 1004, 8, 3, 1, 4, 12, 15),
        team(5, 'הכוח הכרמל', 1005, 8, 2, 2, 4, 9, 14), team(6, 'אליצור החוף', 1006, 8, 0, 2, 6, 5, 24),
      ],
    },
    games: {
      title: 'משחקי הקבוצה (נתוני דמו)', columns: ['תאריך', 'משחק', 'מגרש', 'תוצאה'],
      rows: [
        { cells: [day(-3), 'בית״ר העמק - מכבי הצפון ילדים ב׳', 'מגרש בית״ר', '1-2'], href: null },
        { cells: [day(4), 'מכבי הצפון ילדים ב׳ - הפועל השרון', 'אצטדיון עירוני', ''], href: null },
      ],
    },
  };
};

// Same rules as norm_phone in the database: digits only, a leading 0 becomes +972.
function normPhone(p: unknown): string | null {
  const raw = String(p ?? ''); const d = raw.replace(/\D/g, '');
  if (!d) return null;
  if (raw.trim().startsWith('+')) return `+${d}`;
  return d.startsWith('0') ? `+972${d.slice(1)}` : `+${d}`;
}
