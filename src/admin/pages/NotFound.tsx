import { Link } from "react-router-dom";

export function NotFound() {
  return (
    <div className="flex flex-col items-start gap-3">
      <h1 className="text-2xl font-semibold">Not found</h1>
      <p className="text-sm text-zinc-600">That admin page doesn’t exist.</p>
      <Link to="/" className="text-sm text-indigo-600 hover:underline">
        ← Back to sites
      </Link>
    </div>
  );
}
