// Uploads one file to a Supabase signed upload URL, reporting progress and
// able to stop part way. It sends exactly what supabase-js's
// uploadToSignedUrl sends (a PUT of form data to /object/upload/sign/...),
// but with XMLHttpRequest, because fetch can't report upload progress.

import { supabase } from "@/integrations/supabase/client";

/** Thrown when an upload can't work by trying again (e.g. a file type the server refuses). */
export class FinalUploadError extends Error {}

/** Thrown when an upload was stopped with abort(). */
export class UploadCancelled extends Error {
  constructor() {
    super("Upload cancelled");
  }
}

export type UploadHandle = {
  /** Settles when the file is stored (or failed / was cancelled). */
  done: Promise<void>;
  /** Stops the upload; `done` rejects with UploadCancelled. */
  abort: () => void;
};

/** The server's message from an error response, or a plain one. */
function messageFrom(status: number, body: string) {
  try {
    const j = JSON.parse(body) as { message?: string; error?: string };
    if (j.message || j.error) return String(j.message ?? j.error);
  } catch {
    /* not JSON */
  }
  return body.trim().slice(0, 200) || `Upload failed (${status})`;
}

export function uploadToSignedUrlWithProgress(
  bucket: string,
  path: string,
  token: string,
  file: File,
  onProgress: (loaded: number, total: number) => void,
): UploadHandle {
  const xhr = new XMLHttpRequest();
  let cancelled = false;
  const done = (async () => {
    const api = supabase.storage.from(bucket) as unknown as { url: string };
    const encoded = path.split("/").map(encodeURIComponent).join("/");
    const url = `${api.url}/object/upload/sign/${bucket}/${encoded}?token=${encodeURIComponent(token)}`;
    const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
    const { data } = await supabase.auth.getSession();
    if (cancelled) throw new UploadCancelled();

    const body = new FormData();
    body.append("cacheControl", "3600");
    body.append("", file);

    await new Promise<void>((resolve, reject) => {
      xhr.open("PUT", url);
      xhr.setRequestHeader("x-upsert", "true");
      if (key) xhr.setRequestHeader("apikey", key);
      if (data.session?.access_token) {
        xhr.setRequestHeader("Authorization", `Bearer ${data.session.access_token}`);
      }
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded, e.total);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress(file.size, file.size);
          resolve();
          return;
        }
        const msg = messageFrom(xhr.status, xhr.responseText);
        // Too big, wrong type, not allowed: trying again won't help.
        const final = xhr.status === 400 || xhr.status === 403 || xhr.status === 413;
        reject(final ? new FinalUploadError(msg) : new Error(msg));
      };
      xhr.onerror = () => reject(new Error("Connection lost while uploading"));
      xhr.ontimeout = () => reject(new Error("The upload timed out"));
      xhr.onabort = () => reject(new UploadCancelled());
      xhr.send(body);
    });
  })();
  return {
    done,
    abort: () => {
      cancelled = true;
      xhr.abort();
    },
  };
}
