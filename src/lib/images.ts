import { supabase } from './supabase';

// Shrinks a photo to fit maxSide and re-encodes it as JPEG, so uploads stay small (the buckets cap files at 2 MB).
export async function shrinkImage(file: File, maxSide = 800): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('לא ניתן לקרוא את התמונה'))), 'image/jpeg', 0.85));
}

/** Uploads a shrunk copy under folder/ with a new name and returns its storage path. */
export async function uploadImage(bucket: string, folder: string, file: File): Promise<string> {
  const blob = await shrinkImage(file);
  const path = `${folder}/${Date.now()}.jpg`;
  const { error } = await supabase.storage.from(bucket).upload(path, blob, { contentType: 'image/jpeg' });
  if (error) throw error;
  return path;
}
