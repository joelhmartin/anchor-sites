import { brand } from "../../config/brand.js";

export function AuthLayout({ children }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900">{brand.name}</h1>
          <p className="mt-1 text-sm text-gray-500">{brand.tagline}</p>
        </div>
        {children}
      </div>
    </div>
  );
}
