export default function Offline() {
  return (
    <main className="pt-safe flex min-h-dvh flex-col items-center justify-center gap-3 px-8 text-center">
      <div className="text-5xl">📡</div>
      <h1 className="text-xl font-semibold">You're offline</h1>
      <p className="text-muted">Automation keeps running on the server. Reconnect to see the latest activity.</p>
    </main>
  );
}
