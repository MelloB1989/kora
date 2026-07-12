// Non-functional stub — real auth arrives in Phase 5.
export function Login() {
  return (
    <main className="mx-auto max-w-sm px-6 py-24">
      <h2 className="text-2xl font-semibold">Log in</h2>
      <form className="mt-6 flex flex-col gap-3" onSubmit={(e) => e.preventDefault()}>
        <input
          type="email"
          placeholder="Email"
          disabled
          className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm"
        />
        <input
          type="password"
          placeholder="Password"
          disabled
          className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled
          className="rounded-lg bg-neutral-700 px-3 py-2 text-sm font-semibold text-neutral-300"
        >
          Coming soon
        </button>
      </form>
    </main>
  );
}
