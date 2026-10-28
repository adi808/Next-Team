import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { mutateOne, rpc, useAction } from '../lib/db';
import { uploadImage } from '../lib/images';
import { useAuth } from '../auth/AuthProvider';
import { Card, ErrorText, Field } from '../components/ui';
import { Picture, PicturePicker } from '../components/Picture';

export default function ProfilePage() {
  const { profile, reload } = useAuth();
  const [name, setName] = useState(profile?.full_name ?? '');
  const [saved, setSaved] = useState(false);
  const act = useAction();
  if (!profile) return null;

  async function setAvatar(file: File) {
    await act.run(async () => {
      const path = await uploadImage('avatars', profile!.id, file);
      await rpc('set_my_avatar', { p_path: path });
      reload();
    });
  }
  async function saveName() {
    await act.run(async () => {
      await mutateOne(supabase.from('profiles').update({ full_name: name.trim() }).eq('id', profile!.id).select('id'));
      setSaved(true);
      reload();
    });
  }

  return (
    <>
      <h2>הפרופיל שלי</h2>
      <Card>
        <div className="profile-card">
          <Picture bucket="avatars" path={profile.avatar_path} name={profile.full_name || profile.email || '?'} size={96} />
          <PicturePicker label={profile.avatar_path ? 'החלפת תמונה' : 'הוספת תמונה'} busy={act.busy} onPick={setAvatar} />
          <small className="muted"><bdi>{profile.email}</bdi></small>
        </div>
        <Field label="השם שיוצג לאחרים">
          <input value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} placeholder="שם מלא" />
        </Field>
        <ErrorText error={act.error} />
        <div className="row">
          <button disabled={!name.trim() || name.trim() === profile.full_name || act.busy} onClick={saveName}>שמירה</button>
          {saved && <span className="ok">נשמר</span>}
        </div>
      </Card>
    </>
  );
}
