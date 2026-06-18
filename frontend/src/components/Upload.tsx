import { useRef, useState } from "react";
import { supabase } from "../supabase";

// Async upload flow (DESIGN §4.1), avoiding API Gateway's 30s timeout:
//   1. upload the ZIP to Supabase Storage (exports/<uid>/export.zip)
//   2. POST {path} to /process -> backend marks a job and runs the worker async
//   3. poll public.upload_jobs until status is done | failed
const PROCESS_URL = import.meta.env.VITE_PROCESS_URL;

type Phase = "idle" | "uploading" | "processing" | "error";

export function Upload({ onComplete }: { onComplete: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  async function pollUntilDone(): Promise<void> {
    const deadline = Date.now() + 5 * 60 * 1000; // 5 min cap
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      const { data } = await supabase
        .from("upload_jobs")
        .select("status, error")
        .maybeSingle();
      if (data?.status === "done") return;
      if (data?.status === "failed") throw new Error(data.error ?? "Processing failed.");
    }
    throw new Error("Timed out waiting for processing.");
  }

  async function handle(file: File) {
    if (!PROCESS_URL) {
      setError("VITE_PROCESS_URL is not set — deploy the API and configure it.");
      setPhase("error");
      return;
    }
    setError(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      const userId = sess.session?.user.id;
      if (!token || !userId) throw new Error("Not signed in.");

      // 1. upload to Storage
      setPhase("uploading");
      const path = `${userId}/export.zip`;
      const up = await supabase.storage
        .from("exports")
        .upload(path, file, { upsert: true, contentType: "application/zip" });
      if (up.error) throw new Error(`Upload failed: ${up.error.message}`);

      // 2. kick off processing
      setPhase("processing");
      const res = await fetch(PROCESS_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Could not start processing (${res.status}).`);
      }

      // 3. poll for completion
      await pollUntilDone();
      onComplete();
      setPhase("idle");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handle(file);
  }

  const busy = phase === "uploading" || phase === "processing";
  const label =
    phase === "uploading" ? "Uploading…"
    : phase === "processing" ? "Processing your library… (can take a minute)"
    : "Choose export ZIP";

  return (
    <div className="panel upload">
      <p>Upload your Letterboxd export ZIP (Settings → Data → Export your data on Letterboxd).</p>
      <input
        ref={inputRef}
        type="file"
        accept=".zip,application/zip"
        onChange={onPick}
        disabled={busy}
        hidden
      />
      <button onClick={() => inputRef.current?.click()} disabled={busy}>
        {label}
      </button>
      {error && <div className="error">{error}</div>}
    </div>
  );
}
