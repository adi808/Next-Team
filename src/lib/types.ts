export type Mode = 'sysadmin' | 'admin' | 'coach' | 'parent' | 'player';

export const MODE_LABELS: Record<Mode, string> = {
  sysadmin: 'מנהל מערכת',
  admin: 'מנהל מועדון',
  coach: 'מאמן',
  parent: 'הורה',
  player: 'שחקן',
};

// roles an attribute can be restricted to (see attribute_defs.visible_to / editable_by)
export type EntityRole = 'system_admin' | 'club_admin' | 'coach' | 'parent' | 'player';
export const ENTITY_ROLES: EntityRole[] = ['system_admin', 'club_admin', 'coach', 'parent', 'player'];
export const ENTITY_ROLE_LABELS: Record<EntityRole, string> = {
  system_admin: 'מנהל מערכת',
  club_admin: 'מנהל מועדון',
  coach: 'מאמן',
  parent: 'הורה',
  player: 'שחקן',
};

export interface Profile {
  id: string;
  phone: string | null;
  email: string | null;
  full_name: string;
  is_system_admin: boolean;
  avatar_path: string | null;
}

export interface Membership {
  id: string;
  club_id: string;
  team_id: string | null;
  role: 'club_admin' | 'coach';
}

export interface Sport {
  id: string;
  slug: string;
  name_he: string;
  icon_path: string;
  sort_order: number;
}

export interface Club { id: string; name: string; logo_path: string | null }
export interface Team { id: string; club_id: string; name: string; sport_id: string; photo_path: string | null }

export interface Player {
  id: string;
  club_id: string;
  full_name: string;
  birth_date: string | null;
  photo_path: string | null;
  photo_consent: boolean;
  has_account: boolean;
  is_me: boolean;
}

export interface Lookup {
  id: string;
  domain: string;
  slug: string;
  name_he: string;
  icon_path: string | null;
  parent_id: string | null;
  sport_id: string | null;
  club_id: string | null;
  sort_order: number;
  meta: Record<string, unknown>;
  active: boolean;
}

export type AttrType = 'text' | 'number' | 'scale' | 'boolean' | 'date' | 'select' | 'lookup';
export interface AttrDef {
  id: string;
  scope: 'player' | 'team' | 'event';
  key: string;
  label_he: string;
  data_type: AttrType;
  config: Record<string, unknown>;
  visible_to: EntityRole[];
  editable_by: EntityRole[];
  club_id: string | null;
  team_id: string | null;
  sport_id: string | null;
  sort_order: number;
  active: boolean;
}
export interface AttrValue {
  id: string;
  def_id: string;
  entity_id: string;
  value: unknown;
  recorded_by: string | null;
  recorded_at: string;
}

export interface EventRow {
  id: string;
  team_id: string;
  type_id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  location: string;
  notes: string;
  opponent: string | null;
  our_score: number | null;
  their_score: number | null;
  kit_id: string | null;
  series_id: string | null;
}
export interface TeamKit {
  id: string;
  team_id: string;
  name: string;
  shirt: string;
  shorts: string;
  socks: string;
  sort_order: number;
  active: boolean;
}
export interface EventResponse {
  event_id: string;
  player_id: string;
  status: 'attending' | 'not_attending';
  reason_id: string | null;
  note: string;
  responded_at: string;
}
export interface EventStat {
  id: string;
  event_id: string;
  player_id: string;
  stat_type_id: string;
  minute: number | null;
  note: string;
}
