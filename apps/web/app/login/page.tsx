"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button, ErrorNote, Field, Group } from "@/components/ui";
import { InstallHint } from "@/components/InstallHint";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/auth/login", { method: "POST", json: { email, password } });
      router.replace("/");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="pt-safe mx-auto flex min-h-dvh max-w-md flex-col justify-center pb-10">
      <div className="mb-8 text-center">
        <span className="ig-gradient mx-auto mb-4 block w-fit rounded-[26px] p-[3px]">
          <img src="/icons/icon-192.png" alt="" className="block h-20 w-20 rounded-[23px]" />
        </span>
        <h1 className="ig-gradient-text text-[34px] font-bold tracking-tight">Instaauto</h1>
        <p className="mt-1 text-muted">Sign in to your team account</p>
      </div>
      <InstallHint />
      <form onSubmit={submit}>
        <Group>
          <Field label="Email" type="email" value={email} onChange={setEmail} placeholder="you@company.com" />
          <Field label="Password" type="password" value={password} onChange={setPassword} />
        </Group>
        <ErrorNote error={error} />
        <div className="mx-4">
          <Button type="submit" disabled={busy || !email || !password}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </div>
      </form>
    </main>
  );
}
