import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { q, rpc, useAction, useLoad, fmtDate } from '../lib/db';
import { ENTITY_ROLES, ENTITY_ROLE_LABELS, type AttrDef, type AttrType, type AttrValue, type EntityRole } from '../lib/types';
import { Card, ErrorText, Field, Loading } from './ui';
import { LookupSelect, useLookups } from './Lookups';

/** Value shown for a stored attribute value. */
function useFormat() {
  const lookups = [
    ...useLookups('match_format', { includeInactive: true }),
    ...useLookups('formation', { includeInactive: true }),
    ...useLookups('position', { includeInactive: true }),
    ...useLookups('player_kind', { includeInactive: true }),
  ];
  return (def: AttrDef, v: unknown): string => {
    if (v === null || v === undefined) return '';
    switch (def.data_type) {
      case 'boolean': return v ? 'כן' : 'לא';
      case 'lookup': return lookups.find((l) => l.id === v)?.name_he ?? '';
      case 'date': return new Date(String(v)).toLocaleDateString('he-IL');
      default: return String(v);
    }
  };
}

function ValueInput(props: {
  def: AttrDef;
  value: unknown;
  onChange: (v: unknown) => void;
  parentValue?: string | null;
  sportId?: string | null;
}) {
  const { def, value, onChange } = props;
  const cfg = def.config as { min?: number; max?: number; options?: string[]; domain?: string };
  switch (def.data_type) {
    case 'scale': {
      const min = cfg.min ?? 1, max = cfg.max ?? 10;
      return (
        <select value={value == null ? '' : String(value)} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}>
          <option value="">—</option>
          {Array.from({ length: max - min + 1 }, (_, i) => min + i).map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      );
    }
    case 'number':
      return <input type="number" min={cfg.min} max={cfg.max} value={value == null ? '' : String(value)}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} />;
    case 'boolean':
      return (
        <select value={value == null ? '' : value ? 'y' : 'n'} onChange={(e) => onChange(e.target.value === '' ? null : e.target.value === 'y')}>
          <option value="">—</option><option value="y">כן</option><option value="n">לא</option>
        </select>
      );
    case 'date':
      return <input type="date" value={value == null ? '' : String(value)} onChange={(e) => onChange(e.target.value || null)} />;
    case 'select':
      return (
        <select value={value == null ? '' : String(value)} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">—</option>
          {(cfg.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    case 'lookup':
      return <LookupSelect domain={cfg.domain ?? ''} value={value == null ? null : String(value)} onChange={onChange}
        sportId={props.sportId} parentId={props.parentValue === undefined ? undefined : props.parentValue} />;
    default:
      return <input type="text" value={value == null ? '' : String(value)} onChange={(e) => onChange(e.target.value || null)} />;
  }
}

export interface AttributesScope {
  scope: AttrDef['scope'];
  entityId: string;
  /** roles the caller holds for this record, to show only what they may see / edit */
  myRoles: EntityRole[];
  clubId: string;
  teamIds: string[];
  sportIds: string[];
}

/** Dynamic parameters of a player / team / event, each with its full history. */
export function AttributesPanel({ scope, entityId, myRoles, clubId, teamIds, sportIds, title, hideKeys, onlyTypes, skipTypes, onSaved }: AttributesScope & {
  title?: string; hideKeys?: string[]; onlyTypes?: AttrType[]; skipTypes?: AttrType[]; onSaved?: () => void;
}) {
  const format = useFormat();
  const { data, error, loading, reload } = useLoad(async () => {
    const [defs, values] = await Promise.all([
      q<AttrDef[]>(supabase.from('attribute_defs').select('*').eq('scope', scope).eq('active', true).order('sort_order')),
      q<(AttrValue & { seq: number })[]>(supabase.from('attribute_values').select('*').eq('entity_id', entityId).order('seq', { ascending: false })),
    ]);
    return { defs, values };
  }, [scope, entityId]);
  const [drafts, setDrafts] = useState<Record<string, unknown>>({});
  const [open, setOpen] = useState<string | null>(null);
  const act = useAction();

  const mine = (list: EntityRole[]) => list.some((r) => myRoles.includes(r));
  const defs = (data?.defs ?? []).filter(
    (d) =>
      !hideKeys?.includes(d.key) &&
      (!onlyTypes || onlyTypes.includes(d.data_type)) &&
      !skipTypes?.includes(d.data_type) &&
      (!d.club_id || d.club_id === clubId) &&
      (!d.team_id || teamIds.includes(d.team_id)) &&
      (!d.sport_id || sportIds.includes(d.sport_id)) &&
      mine(d.visible_to),
  );
  const current = (id: string) => data?.values.find((v) => v.def_id === id)?.value;
  const history = (id: string) => (data?.values ?? []).filter((v) => v.def_id === id);

  async function save(def: AttrDef) {
    const v = def.id in drafts ? drafts[def.id] : current(def.id);
    await act.run(async () => {
      await rpc('set_attribute', { p_def: def.id, p_entity: entityId, p_value: v === undefined ? null : v });
      setDrafts((d) => { const n = { ...d }; delete n[def.id]; return n; });
      reload(); onSaved?.();
    });
  }

  if (loading || error) return <Loading loading={loading} error={error} />;
  if (!defs.length) return null;
  return (
    <Card title={title}>
      <ErrorText error={act.error} />
      {defs.map((def) => {
        const editable = mine(def.editable_by);
        const draft = def.id in drafts;
        const cur = draft ? drafts[def.id] : current(def.id);
        const dep = (def.config as { depends_on?: string }).depends_on;
        const depDef = dep ? defs.find((d) => d.key === dep) : undefined;
        const parentValue = depDef ? (depDef.id in drafts ? drafts[depDef.id] : current(depDef.id)) : undefined;
        const dflt = (def.config as { default?: unknown }).default;
        const hist = history(def.id);
        return (
          <div className="attr" key={def.id}>
            <div className="attr-row">
              <strong>{def.label_he}</strong>
              {editable ? (
                <>
                  <ValueInput def={def} value={cur} onChange={(v) => setDrafts((d) => ({ ...d, [def.id]: v }))}
                    parentValue={depDef ? (parentValue == null ? null : String(parentValue)) : undefined}
                    sportId={sportIds[0]} />
                  <button className="small" disabled={!draft || act.busy} onClick={() => save(def)}>שמירה</button>
                </>
              ) : (
                <span>{format(def, cur) || (dflt !== undefined ? `${format(def, dflt)} (ברירת מחדל)` : '—')}</span>
              )}
              {hist.length > 1 && (
                <button className="link small" onClick={() => setOpen(open === def.id ? null : def.id)}>
                  היסטוריה ({hist.length})
                </button>
              )}
            </div>
            {editable && cur == null && dflt !== undefined && <small className="muted">ברירת מחדל: {format(def, dflt)}</small>}
            {open === def.id && (
              <ul className="history">
                {hist.map((h) => (
                  <li key={h.id}><span>{fmtDate(h.recorded_at)}</span> <strong>{format(def, h.value) || '—'}</strong></li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </Card>
  );
}

const TYPE_LABELS: Record<AttrType, string> = {
  scale: 'דירוג (סקאלה)', number: 'מספר', text: 'טקסט', boolean: 'כן / לא', date: 'תאריך', select: 'בחירה מרשימה', lookup: 'רשימה מערכתית',
};

/** Form for a coach / club admin to define a new parameter (for example a 1-10 rating). */
export function DefCreator({ scope, clubId, teamId, sportId, onCreated }: {
  scope: AttrDef['scope']; clubId: string; teamId?: string; sportId?: string; onCreated: () => void;
}) {
  const [label, setLabel] = useState('');
  const [type, setType] = useState<AttrType>('scale');
  const [min, setMin] = useState(1);
  const [max, setMax] = useState(10);
  const [options, setOptions] = useState('');
  const [visible, setVisible] = useState<EntityRole[]>(['system_admin', 'club_admin', 'coach', 'parent', 'player']);
  const [editable, setEditable] = useState<EntityRole[]>(['coach']);
  const act = useAction();

  const toggle = (list: EntityRole[], set: (l: EntityRole[]) => void, r: EntityRole) =>
    set(list.includes(r) ? list.filter((x) => x !== r) : [...list, r]);

  async function create() {
    const config: Record<string, unknown> = {};
    if (type === 'scale') { config.min = min; config.max = max; }
    if (type === 'select') config.options = options.split(',').map((s) => s.trim()).filter(Boolean);
    const ok = await act.run(async () => {
      await rpc('create_attribute_def', {
        p_scope: scope, p_key: `c${Date.now().toString(36)}`, p_label: label.trim(), p_type: type, p_config: config,
        p_visible_to: visible, p_editable_by: editable,
        p_club: teamId ? null : clubId, p_team: teamId ?? null, p_sport: sportId ?? null,
      });
      return true;
    });
    if (ok) { setLabel(''); onCreated(); }
  }

  return (
    <div className="stack">
      <Field label="שם הפרמטר"><input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="למשל: שליטה בכדור" /></Field>
      <Field label="סוג">
        <select value={type} onChange={(e) => setType(e.target.value as AttrType)}>
          {(['scale', 'number', 'text', 'boolean', 'date', 'select'] as AttrType[]).map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
        </select>
      </Field>
      {type === 'scale' && (
        <div className="row">
          <Field label="מ־"><input type="number" value={min} onChange={(e) => setMin(Number(e.target.value))} /></Field>
          <Field label="עד"><input type="number" value={max} onChange={(e) => setMax(Number(e.target.value))} /></Field>
        </div>
      )}
      {type === 'select' && <Field label="אפשרויות (מופרדות בפסיק)"><input value={options} onChange={(e) => setOptions(e.target.value)} /></Field>}
      <fieldset><legend>מי רואה</legend>
        {ENTITY_ROLES.map((r) => (
          <label key={r} className="check"><input type="checkbox" checked={visible.includes(r)} onChange={() => toggle(visible, setVisible, r)} /> {ENTITY_ROLE_LABELS[r]}</label>
        ))}
      </fieldset>
      <fieldset><legend>מי עורך</legend>
        {ENTITY_ROLES.map((r) => (
          <label key={r} className="check"><input type="checkbox" checked={editable.includes(r)} onChange={() => toggle(editable, setEditable, r)} /> {ENTITY_ROLE_LABELS[r]}</label>
        ))}
      </fieldset>
      <ErrorText error={act.error} />
      <button disabled={!label.trim() || act.busy} onClick={create}>הוספת פרמטר</button>
    </div>
  );
}

/** Definitions that belong to a team (or club): rename, hide or show again. */
export function DefList({ scope, teamId, clubId, onChanged }: { scope: AttrDef['scope']; teamId?: string; clubId?: string; onChanged: () => void }) {
  const { data, loading, error, reload } = useLoad(
    () => {
      let query = supabase.from('attribute_defs').select('*').eq('scope', scope).order('sort_order');
      query = teamId ? query.eq('team_id', teamId) : query.eq('club_id', clubId ?? '').is('team_id', null);
      return q<AttrDef[]>(query);
    },
    [scope, teamId, clubId],
  );
  const act = useAction();
  if (loading || error) return <Loading loading={loading} error={error} />;
  if (!data?.length) return <p className="muted">עדיין לא הוגדרו פרמטרים.</p>;
  return (
    <ul className="list">
      <ErrorText error={act.error} />
      {data.map((d) => (
        <li key={d.id} className="row">
          <span className={d.active ? '' : 'muted'}>{d.label_he}</span>
          <small className="muted">{TYPE_LABELS[d.data_type]}</small>
          <button className="small" disabled={act.busy}
            onClick={() => act.run(async () => { await rpc('update_attribute_def', { p_def: d.id, p_active: !d.active }); reload(); onChanged(); })}>
            {d.active ? 'הסתרה' : 'הצגה'}
          </button>
        </li>
      ))}
    </ul>
  );
}
