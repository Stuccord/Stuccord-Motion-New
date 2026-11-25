// Uploads one file to a Supabase signed upload URL, reporting progress and
// able to stop part way.
//
// Resumable (TUS, Supabase's resumable uploads): the file goes up in 6 MB
// pieces, and when the connection drops the upload carries on from the last
// piece that arrived instead of starting the whole file again. It's
// authorised by the same one-time token as a plain upload (the x-signature
// header), so the storage rules don't change. Where the resumable endpoint
// isn't there (an older or self-hosted Supabase), it falls back to a plain
// upload: exactly what supabase-js's uploadToSignedUrl sends, but with
// XMLHttpRequest, because fetch can't report upload progress.

import * as tus from "tus-js-client";
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

/** Supabase's resumable uploads must use 6 MB pieces. */
const CHUNK_SIZE = 6 * 1024 * 1024;

/**
 * How long to wait before each retry of a piece that didn't arrive (ms):
 * about two and a half minutes in all, for a connection that drops for a
 * while. Each retry carries on from the last piece that arrived.
 */
const RETRY_DELAYS = [0, 1000, 3000, 5000, 10000, 20000, 30000, 30000, 60000];

/** Answers that mean trying again won't help: too big, wrong type, not allowed. */
const isFinalStatus = (status: number) => status === 400 || status === 403 || status === 413;

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

/**
 * Where signed resumable uploads go. Supabase asks for the storage host
 * (<ref>.storage.supabase.co) for big uploads; a custom domain or a local
 * Supabase uses the project URL.
 */
export function resumableEndpoint(supabaseUrl: string) {
  const base = supabaseUrl.replace(/\/$/, "");
  const hosted = /^https:\/\/([a-z0-9]+)\.supabase\.co$/i.exec(base);
  const root = hosted ? `https://${hosted[1]}.storage.supabase.co` : base;
  return `${root}/storage/v1/upload/resumable/sign`;
}

export function uploadToSignedUrlWithProgress(
  bucket: string,
  path: string,
  token: string,
  file: File,
  onProgress: (loaded: number, total: number) => void,
  /** The file's type when the browser didn't say (some phones' .mov). */
  contentType = file.type,
): UploadHandle {
  let cancelled = false;
  let stop: (() => void) | null = null;
  const done = (async () => {
    try {
      await new Promise<void>((resolve, reject) => {
        const upload = resumableUpload(
          bucket,
          path,
          token,
          file,
          contentType,
          onProgress,
          resolve,
          reject,
        );
        stop = () => {
          void upload.abort(true).catch(() => {});
          reject(new UploadCancelled());
        };
        if (cancelled) stop();
        else upload.start();
      });
    } catch (e) {
      if (!(e instanceof NoResumable)) throw e;
      if (cancelled) throw new UploadCancelled();
      // No resumable endpoint here: the whole file in one go.
      const plain = plainUpload(bucket, path, token, file, onProgress);
      stop = plain.abort;
      await plain.done;
    }
  })();
  return {
    done,
    abort: () => {
      cancelled = true;
      stop?.();
    },
  };
}

/** The resumable endpoint isn't there: the plain upload is used instead. */
class NoResumable extends Error {}

function resumableUpload(
  bucket: string,
  path: string,
  token: string,
  file: File,
  contentType: string,
  onProgress: (loaded: number, total: number) => void,
  resolve: () => void,
  reject: (e: Error) => void,
) {
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  return new tus.Upload(file, {
    endpoint: resumableEndpoint(import.meta.env.VITE_SUPABASE_URL as string),
    chunkSize: CHUNK_SIZE,
    retryDelays: RETRY_DELAYS,
    uploadDataDuringCreation: true,
    // Each upload has its own one-time token and path, so an upload can't
    // be picked up again after the page is closed: nothing to remember.
    storeFingerprintForResuming: false,
    removeFingerprintOnSuccess: true,
    headers: {
      "x-signature": token,
      ...(key ? { apikey: key } : {}),
    },
    metadata: {
      bucketName: bucket,
      objectName: path,
      contentType: contentType || "application/octet-stream",
      cacheControl: "3600",
    },
    onProgress: (sent, total) => onProgress(sent, total),
    onSuccess: () => {
      onProgress(file.size, file.size);
      resolve();
    },
    onError: (err) => {
      const res = (err as tus.DetailedError).originalResponse;
      const status = res?.getStatus() ?? 0;
      if (status === 404 || status === 405) {
        reject(new NoResumable(`Resumable uploads not available (${status})`));
        return;
      }
      if (!res) {
        reject(new Error("Connection lost while uploading"));
        return;
      }
      const msg = messageFrom(status, res.getBody() ?? "");
      reject(isFinalStatus(status) ? new FinalUploadError(msg) : new Error(msg));
    },
  });
}

/** The whole file in one PUT, as supabase-js's uploadToSignedUrl sends it. */
function plainUpload(
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
        reject(isFinalStatus(xhr.status) ? new FinalUploadError(msg) : new Error(msg));
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
