// Shown by the service worker when a navigation fails with no cached page
// (e.g. front-desk wifi dropped on a route not visited yet).
export default function OfflinePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-3xl font-semibold sm:text-4xl">You&apos;re offline</h1>
      <p className="max-w-sm text-gray-400">
        Suitely couldn&apos;t reach the network. Check your connection — this page
        will work again once you&apos;re back online.
      </p>
    </main>
  );
}
