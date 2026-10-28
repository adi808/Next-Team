import { useEffect, useState, type ChangeEvent } from 'react';
import { supabase } from '../lib/supabase';

const urls = new Map<string, string>();

/** Signed URL for a private storage file (cached for the session); null while loading or without a path. */
export function useSignedUrl(bucket: string, path: string | null | undefined) {
  const key = path ? `${bucket}/${path}` : '';
  const [url, setUrl] = useState<string | null>(key ? urls.get(key) ?? null : null);
  useEffect(() => {
    setUrl(key ? urls.get(key) ?? null : null);
    if (!path || urls.has(key)) return;
    let cancelled = false;
    supabase.storage.from(bucket).createSignedUrl(path, 3600).then(({ data }) => {
      if (!data) return;
      urls.set(key, data.signedUrl);
      if (!cancelled) setUrl(data.signedUrl);
    });
    return () => { cancelled = true; };
  }, [bucket, path, key]);
  return url;
}

/** A stored picture, or the first letter of the name when there is none. */
export function Picture({ bucket, path, name, size = 40, square }: {
  bucket: string; path: string | null | undefined; name: string; size?: number; square?: boolean;
}) {
  const url = useSignedUrl(bucket, path);
  const style = { width: size, height: size, fontSize: size / 2.4 };
  const cls = `avatar${square ? ' square' : ''}`;
  return url ? (
    <img className={cls} style={style} src={url} alt={name} />
  ) : (
    <span className={cls} style={style} aria-label={name}>{name.trim().slice(0, 1)}</span>
  );
}

/** A button that opens the photo picker (camera or gallery on a phone). */
export function PicturePicker({ label, busy, onPick }: { label: string; busy?: boolean; onPick: (file: File) => void }) {
  function change(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) onPick(file);
  }
  return (
    <label className={`picker${busy ? ' busy' : ''}`}>
      {busy ? 'מעלה…' : label}
      <input type="file" accept="image/*" disabled={busy} onChange={change} />
    </label>
  );
}
