import { useAuth } from '../../auth/AuthProvider';
import { useActingRole } from '../../auth/acting';
import { AttributesPanel, DefCreator, DefList } from '../../components/Attributes';
import { Card } from '../../components/ui';
import type { EntityRole } from '../../lib/types';
import type { TeamTabProps } from './TeamPage';
import { useState } from 'react';
import { KitsCard } from './KitsCard';

export default function SettingsTab({ team }: TeamTabProps) {
  const { coachTeamIds, adminClubIds, profile } = useAuth();
  const [tick, setTick] = useState(0);
  const acting = useActingRole();
  const roles: EntityRole[] = [];
  if (profile?.is_system_admin) roles.push('system_admin');
  if (adminClubIds.includes(team.club_id)) roles.push('club_admin');
  if (coachTeamIds.includes(team.id)) roles.push('coach');
  return (
    <>
      <AttributesPanel key={tick} scope="team" entityId={team.id} myRoles={roles.filter((r) => r === acting)} clubId={team.club_id} teamIds={[team.id]} sportIds={[team.sport_id]} title="הגדרות הקבוצה" />
      <KitsCard teamId={team.id} />
      <Card title="פרמטרים לשחקני הקבוצה">
        <p className="muted">למשל דירוג מקצועי 1 עד 10. כל שמירה מוסיפה ערך חדש וההיסטוריה נשמרת, כדי לראות התקדמות לאורך זמן.</p>
        <DefList scope="player" teamId={team.id} onChanged={() => setTick((t) => t + 1)} />
      </Card>
      <Card title="פרמטר חדש לשחקנים">
        <DefCreator scope="player" clubId={team.club_id} teamId={team.id} onCreated={() => setTick((t) => t + 1)} />
      </Card>
    </>
  );
}
